import { normalizePath, TFile, type TFolder, type App } from "obsidian";
import type { KoNotesPayload, NoteStore, SyncResult } from "./protocol";
import { renderNote, extractManualBlock } from "./markdown";
import { noteFileName, sourceKey } from "./noteutils";

export interface VaultOptions {
	/** vault folder notes live in, e.g. "KOReader" */
	noteFolder: string;
	/** filename template with {{author}} / {{title}}, sans extension */
	filenameTemplate: string;
}

/** NoteStore backed by the real vault. One .md per book; regenerated from the payload each sync. */
export class VaultNoteStore implements NoteStore {
	constructor(
		private app: App,
		private options: VaultOptions,
		private now: () => Date = () => new Date(),
	) {}

	async sync(payload: KoNotesPayload): Promise<SyncResult> {
		const folderPath = normalizePath(this.options.noteFolder);
		await this.ensureFolder(folderPath);

		const source = sourceKey(payload.book);
		const fallbackPath = folderPath + "/" + noteFileName(payload.book, this.options.filenameTemplate) + ".md";
		const note = this.findNote(folderPath, fallbackPath, source);

		if (!note) {
			const content = renderNote(payload, "", this.now());
			const created = await this.app.vault.create(fallbackPath, content);
			return { action: "created", path: created.path };
		}

		const old = await this.app.vault.read(note);
		const next = renderNote(payload, extractManualBlock(old), this.now());
		if (old === next) return { action: "unchanged", path: note.path };
		await this.app.vault.process(note, () => next);
		return { action: "updated", path: note.path };
	}

	private folder(folderPath: string): TFolder | null {
		return this.app.vault.getFolderByPath(folderPath);
	}

	/** Expected file first; otherwise a folder scan for a note whose frontmatter `source` matches
	 *  (covers notes the user renamed in Obsidian — see PROTOCOL.md). */
	private findNote(folderPath: string, fallbackPath: string, source: string): TFile | null {
		const direct = this.app.vault.getFileByPath(fallbackPath);
		if (direct instanceof TFile) {
			const fm = this.app.metadataCache.getFileCache(direct)?.frontmatter;
			if (fm && typeof fm["source"] === "string" && fm["source"] === source) return direct;
		}
		const folder = this.folder(folderPath);
		if (!folder) return null;
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				const fm = this.app.metadataCache.getFileCache(child)?.frontmatter;
				if (fm && typeof fm["source"] === "string" && fm["source"] === source) return child;
			}
		}
		return null;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		if (this.folder(folderPath)) return;
		const parts = folderPath.split("/");
		for (let i = 1; i <= parts.length; i++) {
			const prefix = normalizePath(parts.slice(0, i).join("/"));
			if (!this.app.vault.getFolderByPath(prefix)) {
				try {
					await this.app.vault.createFolder(prefix);
				} catch {
					// exists already / race with Obsidian's own index — safe to continue
				}
			}
		}
	}
}
