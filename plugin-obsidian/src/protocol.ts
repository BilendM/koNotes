// koNotes Sync Protocol v1 — see ../PROTOCOL.md
// No imports from "obsidian" here: this module is shared with unit/integration tests.

export type KoNotesDevice = { name?: string };

export type KoNotesBook = {
	path: string;
	title: string;
	author: string;
	/** total pages, if known */
	pages?: number;
	/** 0..1 */
	percent_finished?: number;
};

export type KoNotesAnnotation = {
	/** device-local timestamp, ISO-ish */
	datetime: string;
	datetime_updated?: string | null;
	/** string (reflowable) or number (PDF) */
	page: string | number;
	chapter?: string | number | null;
	/** may be "" for drawer/bookmark-only marks */
	text: string;
	note?: string | null;
};

export type KoNotesPayload = {
	device: KoNotesDevice;
	book: KoNotesBook;
	annotations: KoNotesAnnotation[];
};

/** Result of ingesting a payload.
 *  created: no prior note existed; updated: content changed; unchanged: identical (no write). */
export type SyncResult = {
	action: "created" | "updated" | "unchanged";
	path: string;
};

/** Abstraction the HTTP server writes through. Implemented by VaultNoteStore in the plugin. */
export interface NoteStore {
	sync(payload: KoNotesPayload): Promise<SyncResult>;
}

export type ValidateResult =
	| { ok: true; payload: KoNotesPayload }
	| { ok: false; error: string };

function isStr(v: unknown): v is string {
	return typeof v === "string";
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function validateAnnotation(raw: unknown, i: number): KoNotesAnnotation | string {
	if (typeof raw !== "object" || raw === null) return `annotations[${i}]: not an object`;
	const a = raw as Record<string, unknown>;
	if (!isStr(a.datetime) || a.datetime.length === 0) return `annotations[${i}]: datetime is required`;
	const page = a.page;
	if (!(isStr(page) || typeof page === "number")) return `annotations[${i}]: page required`;
	const text = a.text ?? "";
	if (!isStr(text)) return `annotations[${i}]: text must be a string`;
	const note = a.note ?? null;
	if (note !== null && !isStr(note)) return `annotations[${i}]: note must be a string or null`;
	if (text.length === 0 && (note === null || note.length === 0)) return `annotations[${i}]: text and note both empty`;
	const out: KoNotesAnnotation = {
		datetime: a.datetime,
		page: page,
		text: text,
	};
	if (has(a, "datetime_updated") && isStr(a.datetime_updated)) out.datetime_updated = a.datetime_updated;
	if (a.chapter !== undefined && a.chapter !== null) {
		if (!(isStr(a.chapter) || typeof a.chapter === "number")) return `annotations[${i}]: chapter must be string/number`;
		out.chapter = a.chapter;
	}
	if (has(a, "note") && a.note !== null && isStr(a.note)) out.note = a.note;
	return out;
}

/** Structural validation per PROTOCOL.md. Lenient on optional fields; strict on required ones. */
export function validatePayload(body: unknown): ValidateResult {
	if (typeof body !== "object" || body === null) return { ok: false, error: "body is not a JSON object" };
	const b = body as Record<string, unknown>;

	const device = (b.device ?? {}) as KoNotesDevice;
	if (device.name !== undefined && !isStr(device.name)) return { ok: false, error: "device.name must be a string" };

	const bookRaw = b.book;
	if (typeof bookRaw !== "object" || bookRaw === null) return { ok: false, error: "book is required" };
	const raw = bookRaw as Record<string, unknown>;
	for (const k of ["path", "title", "author"]) {
		const v = raw[k];
		if (!isStr(v)) return { ok: false, error: `book.${k} must be a string` };
		if (k !== "author" && v.length === 0) return { ok: false, error: `book.${k} must be non-empty` };
	}
	const pages = raw.pages;
	if (pages !== undefined && (typeof pages !== "number" || pages < 0)) return { ok: false, error: "book.pages must be a number >= 0" };
	const percent = raw.percent_finished;
	if (percent !== undefined && (typeof percent !== "number" || percent < 0 || percent > 1)) return { ok: false, error: "book.percent_finished must be 0..1" };

	const book: KoNotesBook = {
		path: raw.path as string,
		title: raw.title as string,
		author: raw.author as string,
	};
	if (pages !== undefined) book.pages = pages as number;
	if (percent !== undefined) book.percent_finished = percent as number;

	if (!Array.isArray(b.annotations)) return { ok: false, error: "annotations must be an array" };
	const annotations: KoNotesAnnotation[] = [];
	for (let i = 0; i < b.annotations.length; i++) {
		const out = validateAnnotation(b.annotations[i], i);
		if (typeof out === "string") return { ok: false, error: out };
		annotations.push(out);
	}

	return { ok: true, payload: { device, book, annotations } };
}
