// Pairing session (PROTOCOL.md v1.1). Pure logic — no I/O, no Obsidian imports.
import { randomInt } from "node:crypto";

export const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const PAIRING_MAX_ATTEMPTS = 5;

export type PairingState =
	| { active: true; code: string; attemptsLeft: number; expiresAt: number }
	| { active: false };

export class PairingManager {
	private session: { code: string; expiresAt: number; attemptsLeft: number } | null = null;

	/** Starts a new session, replacing any previous one. */
	start(now = Date.now()): string {
		const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
		this.session = { code, expiresAt: now + PAIRING_TTL_MS, attemptsLeft: PAIRING_MAX_ATTEMPTS };
		return code;
	}

	/** Leaves the pairing window — confirm starts refusing. */
	cancel(): void {
		this.session = null;
	}

	state(now = Date.now()): PairingState {
		if (!this.session || now >= this.session.expiresAt) return { active: false };
		return { active: true, ...this.session };
	}

	/**
	 * Checks a submitted code. Each wrong attempt burns one of the limited tries;
	 * the whole session dies when they run out. On success the session is
	 * consumed (one code pairs one device).
	 * @returns "ok" | "wrong" | "expired" | "inactive"
	 */
	confirm(submitted: string, now = Date.now()): "ok" | "wrong" | "expired" | "inactive" {
		const s = this.session;
		if (!s) return "inactive";
		if (now >= s.expiresAt) {
			this.session = null;
			return "expired";
		}
		if (submitted.replace(/[\s-]/g, "") !== s.code) {
			s.attemptsLeft -= 1;
			if (s.attemptsLeft <= 0) {
				this.session = null;
				return "expired"; // attempts exhausted: dead, same handling for the reader
			}
			return "wrong";
		}
		this.session = null;
		return "ok";
	}
}

/** Long-lived device token issued on successful pairing. */
export function generateDeviceToken(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let t = "kn_";
	for (let i = 0; i < 40; i++) t += chars[randomInt(0, chars.length)];
	return t;
}
