// Exercises VaultNoteStore against a minimal filesystem-backed Obsidian shim,
// so the sync semantics below are verified without running the real app:
//   create → unchanged → updated(+manual preserved) → renamed note resolution
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import * as os from "os";

import { TFile } from "obsidian";
import type { App } from "obsidian";
import { VaultNoteStore, type VaultOptions } from "../src/booknoteStore";
import { MANUAL_START, MANUAL_END } from "../src/markdown";
import { validatePayload, type KoNotesPayload } from "../src/protocol";

const RAW = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "payload-fluent-forever.json"), "utf8"));
const NO_MANUAL = "<!-- koNotes:manual -->\n<!-- /koNotes:manual -->";

function payload(withExtra = false): KoNotesPayload {
	const p = JSON.parse(JSON.stringify(RAW));
	if (withExtra) {
		p.annotations.push({ datetime: "2026-10-27T19:00:00", page: "200", chapter: "The Deep Bore", text: "Extra highlight", note: null });
	}
	const v = validatePayload(p);
	if (!v.ok) throw new Error(v.error);
	return v.payload;
}

class FakeVault {
	#files = new Map<string, string>();
	#byPath = new Map<string, TFile>();

	file(p: string): TFile | null {
		return this.#files.has(p) ? this.#byPath.get(p) ?? null : null;
	}
	rename(from: string, to: string): void {
		if (!this.#files.has(from)) throw new Error("rename: no such file " + from);
		const content = this.#files.get(from) as string;
		this.#files.delete(from);
		this.#byPath.delete(from);
		this.#files.set(to, content);
		this.#byPath.set(to, new TFile());
		this.#byPath.get(to)!.path = to;
	}

	/** replace the (empty) manual block with user content, as if the user typed it */
	writeManual(file: string, content: string): void {
		const MARK_START = "<!-- koNotes:manual -->";
		const MARK_END = "<!-- /koNotes:manual -->";
		const next = this.content(file).replace(
			MARK_START + "\n" + MARK_END,
			MARK_START + "\n" + content + "\n" + MARK_END,
		);
		this.#files.set(file, next);
	}
	paths(): string[] {
		return [...this.#files.keys()];
	}
	content(p: string): string {
		if (!this.#files.has(p)) throw new Error("no such file " + p);
		return this.#files.get(p) as string;
	}
	set(p: string, content: string): void {
		if (!this.#files.has(p)) throw new Error("no such file " + p);
		this.#files.set(p, content);
	}
	app(): App {
		const vault = {
			getFileByPath: (p: string) => this.file(p),
			getFolderByPath: (p: string) =>
				[...this.#files.keys()].some((k) => k.startsWith(p + "/"))
					? { children: [...this.#byPath.values()].filter((f) => f.path.startsWith(p + "/")) }
					: null,
			createFolder: async (_p: string) => undefined,
			create: async (p: string, content: string) => {
				if (this.#files.has(p)) throw new Error("file already exists: " + p);
				this.#files.set(p, content);
				const f = new TFile();
				f.path = p;
				f.basename = p.split("/").pop() as string;
				this.#byPath.set(p, f);
				return f;
			},
			read: async (f: TFile) => this.content(f.path),
			rename: async (f: TFile, to: string) => this.rename(f.path, to),
			process: async (f: TFile, fn: (data: string) => string) => {
				const next = fn(this.content(f.path));
				this.#files.set(f.path, next);
				return next;
			},
		};
		return {
			vault,
			metadataCache: {
				getFileCache: (f: TFile) => {
					const m = this.content(f.path).match(/^---\n([\s\S]*?)\n---/);
					if (!m) return { frontmatter: undefined };
					const fm: Record<string, string> = {};
					for (const line of (m[1] as string).split("\n")) {
						const kv = line.match(/^([\w-]+):\s*(.*)$/);
						if (kv) fm[kv[1] as string] = JSON.parse(kv[2] as string);
					}
					return { frontmatter: fm };
				},
			},
		} as unknown as App;
	}
}

const OPTIONS: VaultOptions = { noteFolder: "KOReader", filenameTemplate: "{{author}} - {{title}}" };
const baseName = "KOReader/Gabriel Wyner - Fluent Forever.md";

describe("VaultNoteStore semantics", () => {
	// NOTE: a real (advancing) clock is used on purpose — a fixed clock hides
	// `last_synced` drift and would have masked the no-op guard regression fixed here.
	it("creates, then no-ops (advancing clock), then updates while preserving manual content", async () => {
		const vault = new FakeVault();
		const store = new VaultNoteStore(vault.app(), OPTIONS, () => new Date());

		const created = await store.sync(payload());
		expect(created).toEqual({ action: "created", path: baseName });
		const saved = vault.content(baseName);
		expect(saved).toContain('# Fluent Forever');
		expect(saved).toContain("## Sound First");
		expect(saved).toContain("> [!quote] Page 24 · 2026-10-26");
		expect(saved).toContain("payload_hash");
		expect(saved).toContain(NO_MANUAL);

		// resist self-similarity drift: a second identical sync must not write
		const again = await store.sync(payload());
		expect(again.action).toBe("unchanged");
		expect(vault.content(baseName)).toBe(saved);
		expect(again.path).toBe(baseName);

		// user content inside the protected block survives regeneration
		vault.writeManual(baseName, "Re: reflections about ch. 1\nkept verbatim");
		const updated = await store.sync(payload(true));
		expect(updated.action).toBe("updated");
		const next = vault.content(baseName);
		expect(next).toContain("Extra highlight");
		expect(next).toContain("highlights: 4");
		expect(next).toContain(MANUAL_START + "\nRe: reflections about ch. 1\nkept verbatim\n" + MANUAL_END);

		// hash-based guard: unchanged payload + user-edited manual block ⇒ no write
		const afterManualEdit = await store.sync(payload(true));
		expect(afterManualEdit.action).toBe("unchanged");
		expect(vault.content(baseName)).toBe(next);
	});

	it("regenerates and keeps a renamed note in sync", async () => {
		const vault = new FakeVault();
		const now = new Date("2026-10-28T12:00:00.000Z");
		const store = new VaultNoteStore(vault.app(), OPTIONS, () => now);

		await store.sync(payload());
		const renamed = "KOReader/My Book Notes.md";
		vault.rename(baseName, renamed);

		const result = await store.sync(payload(true));
		expect(result).toEqual({ action: "updated", path: renamed });
		const content = vault.content(renamed);
		expect(content).toContain("> [!quote] Page 200 · 2026-10-27");
		expect(content).toContain("highlights: 4");
		// no duplicate note was created
		expect(vault.paths()).toEqual([renamed]);
	});

	it("applies a title override: H1, frontmatter and filename change, identity stays", async () => {
		const vault = new FakeVault();
		const store = new VaultNoteStore(vault.app(), OPTIONS, () => new Date("2026-10-28T12:00:00.000Z"));

		await store.sync(payload());
		// exactly what the "Set display title…" command does
		writeFrontmatterField(vault, baseName, "title_override", "Designing Data-Intensive Applications");

		const out = await store.syncDetailed(payload());
		expect(out.rename).toBe("renamed");
		const path = "KOReader/Gabriel Wyner - Designing Data-Intensive Applications.md";
		expect(out.path).toBe(path);
		const content = vault.content(path);
		expect(content).toContain("# Designing Data-Intensive Applications");
		expect(content).toContain('book: "Fluent Forever"'); // raw provenance stays
		expect(content).toContain('title_override: "Designing Data-Intensive Applications"');
		// source key unchanged by rename
		const src = content.match(/source: "(.*)"/)![1];
		expect(src).toMatch(/^koreader:\/\//);

		// renamed note keeps being found by identity, and overrides survive regeneration
		const again = await store.sync(payload(true));
		expect(again.action).toBe("updated");
		expect(again.path).toBe(path);
		expect(vault.content(path)).toContain('title_override: "Designing Data-Intensive Applications"');
	});

	it("rename never fights over an occupied target path", async () => {
		const vault = new FakeVault();
		const store = new VaultNoteStore(vault.app(), OPTIONS, () => new Date("2026-10-28T12:00:00.000Z"));

		await store.sync(payload());
		writeFrontmatterField(vault, baseName, "title_override", "Designing Data-Intensive Applications");
		// another note already sits at the exact target name
		await vault.app().vault.create("KOReader/Gabriel Wyner - Designing Data-Intensive Applications.md", "someone else's note");

		const out = await store.syncDetailed(payload());
		expect(out.rename).toBe("target-taken");
		expect(out.path).toBe(baseName);
	});
});

/** Mimics the command's processFrontMatter write. */
function writeFrontmatterField(vault: FakeVault, file: string, key: string, value: string): void {
	const content = vault.content(file);
	const next = content.replace(/^(---\n)/, `$1${key}: ${JSON.stringify(value)}\n`);
	vault.set(file, next);
}
