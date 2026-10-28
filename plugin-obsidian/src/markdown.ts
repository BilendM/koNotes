import type { KoNotesPayload } from "./protocol";
import { payloadHash, sourceKey } from "./noteutils";

export const MANUAL_START = "<!-- koNotes:manual -->";
export const MANUAL_END = "<!-- /koNotes:manual -->";

const VER = 1;

/** Year-month-day of a device timestamp; "—" when absent/odd. */
function dateOf(dt: string | undefined): string {
	const m = dt?.match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : "—";
}

function yamlString(v: string): string {
	// JSON.stringify produces a valid YAML double-quoted scalar for one-line strings.
	return JSON.stringify(v);
}

/** Pull the text between the manual markers (unmodified user content). */
export function extractManualBlock(content: string): string {
	const i = content.indexOf(MANUAL_START);
	if (i < 0) return "";
	const j = content.indexOf(MANUAL_END, i + MANUAL_START.length);
	return (j < 0 ? content.slice(i + MANUAL_START.length) : content.slice(i + MANUAL_START.length, j))
		.replace(/^\r?\n/, "")
		.replace(/\r?\n\s*$/, "");
}

/** Prefix every line of a highlight/annotation body for use inside a callout. */
function calloutBody(text: string): string {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	return lines.map((l) => (l === "" ? ">" : "> " + l)).join("\n");
}

/**
 * Deterministic note body for a sync payload (M1 semantics: full regeneration).
 * `manual` is user-owned content preserved verbatim; `now` isolates timestamps for tests.
 */
export function renderNote(payload: KoNotesPayload, manual?: string, now: Date = new Date()): string {
	const b = payload.book;
	const percent = b.percent_finished !== undefined ? Math.round(b.percent_finished * 100) : undefined;

	const fm: string[] = [
		"book: " + yamlString(b.title),
		"author: " + yamlString(b.author),
		"source: " + yamlString(sourceKey(b)),
	];
	if (b.pages !== undefined) fm.push("pages: " + b.pages);
	if (percent !== undefined) fm.push("percent_read: " + percent);
	if (payload.device.name) fm.push("device: " + yamlString(payload.device.name));
	fm.push("highlights: " + payload.annotations.length);
	fm.push("last_synced: " + yamlString(now.toISOString()));
	fm.push("payload_hash: " + JSON.stringify(payloadHash(payload)));
	fm.push("kosync_version: " + String(VER));

	const body: string[] = [`# ${b.title}`];
	if (b.author.trim()) body.push(`*${b.author.trim()}*`);

	// exactly one blank line between blocks
	const ensureGap = () => {
		if (body.length && body[body.length - 1] !== "") body.push("");
	};

	let chapter: string = "";
	for (const a of payload.annotations) {
		const heading = a.chapter !== undefined && a.chapter !== null ? String(a.chapter).trim() : "Highlights";
		if (heading !== chapter) {
			ensureGap();
			body.push(`## ${heading}`, "");
			chapter = heading;
		} else {
			ensureGap();
		}
		if (a.text.trim()) {
			body.push(`> [!quote] Page ${a.page} · ${dateOf(a.datetime)}`);
			body.push(calloutBody(a.text), "");
		}
		if (a.note) {
			body.push(`> [!note]+ Page ${a.page} · ${dateOf(a.datetime_updated ?? a.datetime)}`);
			body.push(calloutBody(a.note), "");
		}
		if (!a.text.trim() && !a.note) {
			body.push(`> [!quote] Page ${a.page} · ${dateOf(a.datetime)}`, ">", "");
		}
	}

	const manualLines: string[] = [];
	if (manual !== undefined && manual.trim() !== "") manualLines.push(manual.trim());

	ensureGap();
	return [
		"---",
		...fm,
		"---",
		"",
		...body,
		MANUAL_START,
		...(manualLines.length ? [...manualLines, MANUAL_END] : [MANUAL_END]),
		"",
	].join("\n");
}
