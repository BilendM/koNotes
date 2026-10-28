import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { renderNote, MANUAL_START, MANUAL_END, extractManualBlock } from "../src/markdown";
import { validatePayload, type KoNotesPayload } from "../src/protocol";
import { sourceKey, payloadHash } from "../src/noteutils";

const fixturePath = path.join(__dirname, "..", "fixtures", "payload-fluent-forever.json");
const raw = JSON.parse(readFileSync(fixturePath, "utf8"));

function fixture(): KoNotesPayload {
	const v = validatePayload(raw);
	if (!v.ok) throw new Error(v.error);
	return v.payload;
}

describe("renderNote (exact)", () => {
	it("renders the fixture payload deterministically", () => {
		const payload = fixture();
		const now = new Date("2026-10-28T12:00:00.000Z");
		const note = renderNote(payload, undefined, now);

		const expected = [
			"---",
			`book: "Fluent Forever"`,
			`author: "Gabriel Wyner"`,
			`source: ${JSON.stringify(sourceKey(payload.book))}`,
			"pages: 352",
			"percent_read: 62",
			`device: "Vivlio InkPad 4"`,
			"highlights: 3",
			`last_synced: "2026-10-28T12:00:00.000Z"`,
			`payload_hash: ${JSON.stringify(payloadHash(payload))}`,
			"kosync_version: 1",
			"---",
			"",
			"# Fluent Forever",
			"*Gabriel Wyner*",
			"",
			"## Sound First",
			"",
			"> [!quote] Page 24 · 2026-10-26",
			"> The sound of a word, first spoken",
			"> out loud, ...",
			"",
			"> [!note]+ Page 36 · 2026-10-26",
			"> Persistence beats intensity.",
			"",
			"## The Deep Bore",
			"",
			"> [!quote] Page 108 · 2026-10-27",
			"> Their tastes are similar...",
			"",
			MANUAL_START,
			MANUAL_END,
			"",
		].join("\n");

		expect(note).toBe(expected);
	});

	it("preserves manual content between the markers", () => {
		const withManual = renderNote(fixture(), "my thinking\nspans lines", new Date("2026-10-28T12:00:00.000Z"));
		expect(
			withManual.endsWith([MANUAL_START, "my thinking", "spans lines", MANUAL_END, ""].join("\n")),
		).toBe(true);
		const inside = extractManualBlock(withManual);
		expect(inside).toBe("my thinking\nspans lines");
	});

	it("no manual block yields empty extraction", () => {
		expect(extractManualBlock(renderNote(fixture()))).toBe("");
	});
});

describe("validatePayload", () => {
	it("accepts the fixture", () => {
		expect(validatePayload(raw).ok).toBe(true);
	});
	it("rejects missing book", () => {
		expect(validatePayload({ device: {}, annotations: [] }).ok).toBe(false);
	});
	it("rejects empty title", () => {
		const bad = JSON.parse(JSON.stringify(raw));
		bad.book.title = "";
		expect(validatePayload(bad).ok).toBe(false);
	});
	it("rejects out-of-range percent", () => {
		const bad = JSON.parse(JSON.stringify(raw));
		bad.book.percent_finished = 1.2;
		expect(validatePayload(bad).ok).toBe(false);
	});
	it("rejects annotations that are not text or a note", () => {
		const bad = JSON.parse(JSON.stringify({ device: {}, book: raw.book, annotations: [{ datetime: "x", page: "1", text: "", note: null }] }));
		expect(validatePayload(bad).ok).toBe(false);
	});
});
