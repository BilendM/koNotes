// Embedded LAN HTTP server. Pure Node — no "obsidian" imports, so it can run in tests.
import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KoNotesPayload, NoteStore } from "./protocol";
import { validatePayload } from "./protocol";
import { PairingManager, generateDeviceToken } from "./pairing";

const SYNC_PATH = "/kosync/v1/sync";
const PING_PATH = "/kosync/v1/ping";
const PAIR_PATH = "/kosync/v1/pair/confirm";
const MAX_BODY = 10 * 1024 * 1024; // 10 MB, per PROTOCOL.md
const VERSION = 1;

export type ServerHook =
	| { kind: "synced"; action: string; path: string }
	| { kind: "error"; message: string };

function send(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}

export class KoNotesServer {
	private server: http.Server | null = null;
	private tokens = new Set<string>();

	/** Fires from request handling (not on start/stop errors, which reject). */
	onHook: ((hook: ServerHook) => void) | null = null;
	/** Pairing window; routing to /pair/confirm refuses when unset or no session. */
	pairing: PairingManager | null = null;
	/** Called on successful pairing, before the response — must persist the token. */
	onPairDevice: ((name: string, token: string) => Promise<void>) | null = null;

	constructor(private store: NoteStore) {}

	get isRunning(): boolean {
		return this.server !== null;
	}

	/** Refreshes the token allowlist without closing the socket (used when pairing succeeds). */
	setTokens(tokens: readonly string[]): void {
		this.tokens = new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0));
	}

	/** Bound port (for tests), or null when not running. */
	get port(): number | null {
		const a = this.server?.address();
		return a && typeof a === "object" ? a.port : null;
	}

	/** Starts on 0.0.0.0:<port>. Rejects (e.g. EADDRINUSE) if the port can't be taken. */
	start(port: number, tokens: readonly string[]): Promise<void> {
		if (this.server) return Promise.resolve();
		this.tokens = new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0));
		return new Promise<void>((resolve, reject) => {
			const s = http.createServer((req, res) => void this.handle(req, res));
			s.on("error", (err) => {
				if (!this.server) {
					reject(err);
				} else {
					this.onHook?.({ kind: "error", message: String(err) });
				}
			});
			s.listen(port, "0.0.0.0", () => {
				this.server = s;
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		const s = this.server;
		if (!s) return Promise.resolve();
		this.server = null;
		return new Promise((resolve) => {
			s.closeAllConnections();
			s.close(() => resolve());
		});
	}

	private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			return send(res, 405, { ok: false, error: "pair/confirm expects POST" });
		}
		if (!this.pairing || !this.onPairDevice) {
			return send(res, 403, { ok: false, error: "pairing is not active; start it in the koNotes settings" });
		}
		const { body, error, tooLarge } = await this.readJson(req);
		if (tooLarge) return send(res, 413, { ok: false, error: `body exceeds ${MAX_BODY} bytes` });
		if (error !== undefined) return send(res, 400, { ok: false, error });

		const b = body as Record<string, unknown>;
		if (typeof b["code"] !== "string") return send(res, 400, { ok: false, error: "code is required" });
		const name = typeof b["name"] === "string" && b["name"].trim() !== "" ? b["name"].trim() : "KOReader device";

		switch (this.pairing.confirm(b["code"])) {
			case "ok": {
				const token = generateDeviceToken();
				await this.onPairDevice(name, token);
				this.onHook?.({ kind: "synced", action: "paired", path: name });
				return send(res, 200, { ok: true, token: token });
			}
			case "wrong":
				return send(res, 403, { ok: false, error: "wrong pairing code" });
			case "inactive":
			case "expired":
				return send(res, 403, { ok: false, error: "pairing code invalid or expired" });
		}
	}

	private authorized(req: IncomingMessage): boolean {
		if (this.tokens.size === 0) return false;
		const raw = (req.headers["authorization"] ?? "").trim();
		const token = raw.replace(/^Bearer\s+/i, "").trim();
		return token.length > 0 && this.tokens.has(token);
	}

	private readJson(req: IncomingMessage): Promise<{ body?: unknown; error?: string; tooLarge?: boolean }> {
		return new Promise((resolve) => {
			let size = 0;
			const chunks: Buffer[] = [];
			let aborted = false;
			req.on("data", (chunk: Buffer) => {
				if (aborted) return;
				size += chunk.length;
				if (size > MAX_BODY) {
					aborted = true;
					resolve({ tooLarge: true });
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("error", () => {
				if (!aborted) resolve({ error: "connection error while reading body" });
			});
			req.on("end", () => {
				if (aborted) return;
				const raw = Buffer.concat(chunks).toString("utf8");
				try {
					resolve({ body: JSON.parse(raw) });
				} catch {
					resolve({ error: "body is not valid JSON" });
				}
			});
		});
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const path = (req.url ?? "").split("?")[0];

		if (path === PING_PATH) {
			if (req.method !== "GET") return send(res, 405, { ok: false, error: "ping expects GET" });
			return send(res, 200, { ok: true, plugin: "koNotes", version: VERSION });
		}
		if (path === PAIR_PATH) {
			return await this.handlePair(req, res);
		}
		if (path !== SYNC_PATH) return send(res, 404, { ok: false, error: "unknown path" });
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			return send(res, 405, { ok: false, error: "sync expects POST" });
		}

		if (!this.authorized(req)) {
			res.setHeader("WWW-Authenticate", "devicetoken");
			return send(res, 401, { ok: false, error: "unknown or missing device token" });
		}

		const contentType = String(req.headers["content-type"] ?? "");
		if (!contentType.toLowerCase().startsWith("application/json")) {
			return send(res, 415, { ok: false, error: "Content-Type must be application/json" });
		}

		const { body, error, tooLarge } = await this.readJson(req);
		if (tooLarge) return send(res, 413, { ok: false, error: `body exceeds ${MAX_BODY} bytes` });
		if (error !== undefined) return send(res, 400, { ok: false, error });

		const checked = validatePayload(body);
		if (!checked.ok) return send(res, 422, { ok: false, error: checked.error });

		try {
			const result = await this.store.sync(checked.payload as KoNotesPayload);
			send(res, 200, {
				ok: true,
				action: result.action,
				book: checked.payload.book.title,
				note: result.path,
				highlights: checked.payload.annotations.length,
			});
			if (result.action !== "unchanged") {
				this.onHook?.({ kind: "synced", action: result.action, path: result.path });
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.onHook?.({ kind: "error", message });
			send(res, 500, { ok: false, error: message });
		}
	}
}
