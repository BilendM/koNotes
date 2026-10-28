import { normalizePath, TFile, type TFolder, type App } from "obsidian";
import type { KoNotesBook, KoNotesPayload, NoteStore, SyncResult } from "./protocol";
import { renderNote, extractManualBlock, readOverrides, type DisplayOverrides } from "./markdown";
import { noteFileName, payloadHash, sourceKey } from "./noteutils";

export interface VaultOptions {
	/** vault folder notes live in, e.g. "KOReader" */
	noteFolder: string;
	/** filename template with {{author}} / {{title}}, sans extension */
	filenameTemplate: string;
}

/** The book as displayed: payload values replaced by any vault-local overrides. */
function effectiveBook(book: KoNotesBook, o: DisplayOverrides): KoNotesBook {
	return {
		...book,
		title: o.title?.trim() || book.title,
		author: o.author ?? book.author,
	};
}

/** `last_synced` changes on every render; everything else must match for two notes to count as equal. */
function stripLastSynced(content: string): string {
	return content
		.split("\n")
		.filter((l) => !l.startsWith("last_synced:"))
		.join("\n");
}

/** What a sync did about the filename, so the UI can surface blockers. */
export type RenameOutcome = "kept" | "renamed" | "target-taken";

export type DetailedSyncResult = SyncResult & { rename?: RenameOutcome };

/** NoteStore backed by the real vault. One .md per book; regenerated from the payload each sync. */
export class VaultNoteStore implements NoteStore {
	constructor(
		private app: App,
		private options: VaultOptions,
		private now: () => Date = () => new Date(),
	) {}

	async sync(payload: KoNotesPayload): Promise<SyncResult> {
		const result = await this.syncDetailed(payload);
		return { action: result.action, path: result.path };
	}

	/** Same as sync, but also reports filename outcomes (used by rename-observing callers). */
	async syncDetailed(payload: KoNotesPayload): Promise<DetailedSyncResult> {
		const folderPath = normalizePath(this.options.noteFolder);
		await this.ensureFolder(folderPath);

		const source = sourceKey(payload.book);
		// First resolve by identity (source), with the *raw* title as the filename hint.
		const rawExpected = folderPath + "/" + noteFileName(payload.book, this.options.filenameTemplate) + ".md";
		const note = this.findNote(folderPath, rawExpected, source);

		if (!note) {
			const content = renderNote(payload, "", this.now());
			const created = await this.app.vault.create(rawExpected, content);
			return { action: "created", path: created.path, rename: "kept" };
		}

		// Overrides live on the note (vault-local): they shape H1/author/filename but
		// never reach the wire and never affect payload_hash — so editing them cannot
		// fake a payload change, and identical payloads stay `unchanged`.
		const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
		const overrides = readOverrides(fm);
		const display = effectiveBook(payload.book, overrides);
		const expectedPath = folderPath + "/" + noteFileName(display, this.options.filenameTemplate) + ".md";

		const old = await this.app.vault.read(note);
		const next = renderNote(payload, extractManualBlock(old), this.now(), overrides);
		// Unchanged iff the incoming payload hash matches the note's frontmatter hash.
		// (Pure content comparison can't work: `last_synced` drifts on every render.)
		// Fallback for notes without a hash: content comparison (deterministic apart from
		// `last_synced`), which the first regeneration then fixes by adding the hash.
		const savedHash = fm && typeof fm["payload_hash"] === "string" ? fm["payload_hash"] : null;
		let changed = savedHash !== null ? savedHash !== payloadHash(payload) : old !== next;
		// Override edits don't move the payload hash but do change the rendered text.
		// Content comparison ignores the drifting `last_synced` line, so it only flags
		// real render deltas — exactly the case the hash can't see.
		if (!changed && stripLastSynced(old) !== stripLastSynced(next)) changed = true;
		if (changed) await this.app.vault.process(note, () => next);

		// Rename only for overridden notes: with no overrides, a name the user chose in
		// Obsidian always wins and we simply re-resolve it (v1 contract).
		const wantsRename = overrides.title !== undefined || overrides.author !== undefined;
		const rename = wantsRename ? await this.renameToExpected(note, expectedPath) : "kept";
		return { action: changed ? "updated" : "unchanged", path: note.path, rename };
	}

	/** Re-points a note (typically just after its display override changed) at the filename its
	 *  frontmatter (raw `book`/`author` + overrides) now implies. Same no-fight rule as sync. */
	async renameByFrontmatter(note: TFile): Promise<RenameOutcome> {
		const fm = (this.app.metadataCache.getFileCache(note)?.frontmatter ?? {}) as Record<string, unknown>;
		const book: KoNotesBook = {
			path: "",
			title: typeof fm["book"] === "string" && fm["book"] ? fm["book"] : "Untitled",
			author: typeof fm["author"] === "string" && fm["author"] ? fm["author"] : "",
		};
		const folderPath = normalizePath(this.options.noteFolder);
		const expectedPath = folderPath + "/" + noteFileName(effectiveBook(book, readOverrides(fm)), this.options.filenameTemplate) + ".md";
		return this.renameToExpected(note, expectedPath);
	}

	/**
	 * Re-points a note's filename at its expected path (after an override change).
	 * Never fights: if the target is held by a different note, the current name stays.
	 */
	private async renameToExpected(note: TFile, expectedPath: string): Promise<RenameOutcome> {
		if (note.path === expectedPath) return "kept";
		const target = this.app.vault.getFileByPath(expectedPath);
		if (target instanceof TFile && target !== note) return "target-taken";
		await this.app.vault.rename(note, expectedPath);
		note.path = expectedPath; // real Obsidian already does this; the test shim needs it
		return "renamed";
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
