import { describe, expect, it } from "vitest";
import { payloadHash, noteFileName, sanitizeFileName, sourceKey } from "../src/noteutils";
import type { KoNotesBook, KoNotesPayload } from "../src/protocol";

const book: KoNotesBook = {
	path: "/mnt/onboard/books/fluent_forever.epub",
	title: "Fluent Forever",
	author: "Gabriel Wyner",
};

describe("sanitizeFileName", () => {
	it("replaces forbidden characters", () => {
		expect(sanitizeFileName('a/b\\c:d#e^f|g*h?i"j<k>')).toBe("a-b-c-d-e-f-g-h-i-j-k");
	});
	it("normalizes whitespace and falls back", () => {
		expect(sanitizeFileName("  Multiple   spaces ")).toBe("Multiple spaces");
		expect(sanitizeFileName("  ")).toBe("Untitled");
	});
});

describe("noteFileName", () => {
	it("uses the template", () => {
		expect(noteFileName(book, "{{author}} - {{title}}")).toBe("Gabriel Wyner - Fluent Forever");
	});
	it("handles missing author", () => {
		expect(noteFileName({ ...book, author: "" }, "{{author}} - {{title}}")).toBe("Fluent Forever");
	});
	it("handles dots and slash-y titles", () => {
		expect(noteFileName({ ...book, title: "Book v2.0" }, "{{title}}")).toBe("Book v2.0");
	});
});

describe("sourceKey", () => {
	it("is stable and path-scoped", () => {
		expect(sourceKey(book)).toBe(sourceKey({ ...book }));
		expect(sourceKey(book)).not.toBe(sourceKey({ ...book, path: "/other.epub" }));
		expect(sourceKey(book)).toMatch(/^koreader:\/\/[0-9a-f]{16}$/);
	});
});

describe("payloadHash", () => {
	it("changes when annotations change", () => {
		const base: KoNotesPayload = { device: {}, book, annotations: [{ datetime: "d", page: "1", text: "t" }] };
		const one = payloadHash(base);
		expect(one).toBe(payloadHash(base)); // deterministic
		expect(one).not.toBe(payloadHash({ ...base, annotations: [] }));
	});
});
