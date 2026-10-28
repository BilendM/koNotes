import { createHash } from "node:crypto";
import type { KoNotesBook, KoNotesPayload } from "./protocol";

/** Stable identity of a book's note. Hash of the reader-local file path (see PROTOCOL.md). */
export function sourceKey(book: KoNotesBook): string {
	return "koreader://" + createHash("sha1").update(book.path).digest("hex").slice(0, 16);
}

/** Canonical content hash — written to frontmatter; equal hash ⇒ skip write (idempotent sync). */
export function payloadHash(payload: KoNotesPayload): string {
	return createHash("sha1")
		.update(JSON.stringify(payload.book) + "\n" + JSON.stringify(payload.annotations))
		.digest("hex");
}

// Obsidian forbids these in file names.
const FORBIDDEN = /[/\\:*?"<>|#^]/g;

/** Obsidian-safe file name (no extension). */
export function sanitizeFileName(name: string): string {
	return (
		name
			.replace(FORBIDDEN, "-")
			.replace(/\s+/g, " ")
			.replace(/^\s+|\s+$/g, "")
			.replace(/\.+$/, "")
			.replace(/-+$/, "") || "Untitled"
	);
}

/** Filename base for a book, from a template containing {{author}} / {{title}}. */
export function noteFileName(book: KoNotesBook, template: string): string {
	const author = book.author.trim();
	const title = book.title.trim();
	const base = (template || "{{author}} - {{title}}")
		.replace(/\{\{author\}\}/g, author)
		.replace(/\{\{title\}\}/g, title)
		.replace(/^(?:\s*-*\s*)+/, "") // leading separator when author is empty
		.replace(/(?:\s*-*\s*)+$/, "") // trailing separator when title is empty
		.trim();
	return sanitizeFileName(base);
}
