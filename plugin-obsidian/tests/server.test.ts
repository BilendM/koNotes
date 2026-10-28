import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { KoNotesServer } from "../src/server";
import type { KoNotesPayload, NoteStore, SyncResult } from "../src/protocol";
import { readFileSync } from "fs";
import * as path from "path";

const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "payload-fluent-forever.json"), "utf8"));
const TOKEN = "tok-abc123";

let server: KoNotesServer;
let store: { sync: ReturnType<typeof vi.fn> & NoteStore["sync"] };
let url: string;

beforeAll(async () => {
	store = {
		sync: vi.fn(async (payload: KoNotesPayload): Promise<SyncResult> =>
			payload.annotations.length === 0
				? { action: "unchanged", path: "KOReader/Empty.md" }
				: { action: "created", path: "KOReader/Gabriel Wyner - Fluent Forever.md" },
		),
	};
	server = new KoNotesServer(store);
	await server.start(0, [TOKEN]);
	url = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
	await server.stop();
});

const post = (body: string, headers: Record<string, string>) =>
	fetch(url + "/kosync/v1/sync", { method: "POST", headers, body });

function postFixture(token = TOKEN): Promise<Response> {
	return post(JSON.stringify(FIXTURE), { Authorization: token, "Content-Type": "application/json" });
}

describe("ping", () => {
	it("answers the reachability check", async () => {
		const res = await fetch(url + "/kosync/v1/ping");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, plugin: "koNotes", version: 1 });
	});
	it("rejects non-GET", async () => {
		const res = await fetch(url + "/kosync/v1/ping", { method: "POST" });
		expect(res.status).toBe(405);
	});
});

describe("sync routing & auth", () => {
	it("404s unknown paths", async () => {
		expect((await fetch(url + "/kosync/v2/sync")).status).toBe(404);
	});
	it("405s GET (with Allow)", async () => {
		const res = await fetch(url + "/kosync/v1/sync");
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("POST");
	});
	it("401s without token", async () => {
		expect((await postFixture("")).status).toBe(401);
	});
	it("401s with a wrong token", async () => {
		expect((await postFixture("tok-wrong")).status).toBe(401);
	});
	it("accepts Bearer-wrapped tokens", async () => {
		const res = await postFixture(`Bearer ${TOKEN}`);
		expect(res.status).toBe(200);
	});
});

describe("sync body handling", () => {
	it("415s non-JSON content type", async () => {
		const raw = await post("{}", { Authorization: TOKEN, "Content-Type": "text/plain" });
		expect(raw.status).toBe(415);
	});
	it("400s invalid JSON", async () => {
		const res = await post("{oops", { Authorization: TOKEN, "Content-Type": "application/json" });
		expect(res.status).toBe(400);
	});
	it("422s structurally invalid payloads", async () => {
		const bad = { device: {}, book: { ...FIXTURE.book, percent_finished: 7 }, annotations: [] };
		const res = await post(JSON.stringify(bad), { Authorization: TOKEN, "Content-Type": "application/json" });
		expect(res.status).toBe(422);
	});
	it("passes a validated payload to the store and reports the result", async () => {
		store.sync.mockClear();
		const res = await postFixture();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			ok: true,
			action: "created",
			book: "Fluent Forever",
			note: "KOReader/Gabriel Wyner - Fluent Forever.md",
			highlights: 3,
		});
		const passed = (store.sync.mock.calls[0]?.[0] ?? null) as KoNotesPayload | null;
		expect(passed?.book.title).toBe("Fluent Forever");
	});
	it("reports store failures as 500", async () => {
		store.sync.mockImplementationOnce(async () => {
			throw new Error("disk full");
		});
		const res = await postFixture();
		expect(res.status).toBe(500);
		expect((await res.json())).toMatchObject({ ok: false, error: "disk full" });
	});
});
