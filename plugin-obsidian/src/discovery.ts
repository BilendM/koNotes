// UDP discovery responder (PROTOCOL.md v1.1). Pure Node — testable without Obsidian.
//
// The reader broadcasts a `discover` datagram to the LAN; we answer directly to
// the sender's address, so the reader learns both our IP (source) and HTTP port.
// One datagram per reader action — this module never broadcasts on its own.
import * as dgram from "node:dgram";

export const DISCOVERY_PORT = 41838;

export type DiscoveryOffer = {
	/** HTTP (TCP) port of the sync server */
	port: number;
	/** human label; currently the vault-local crypto-random suffix, safe to show */
	name: string;
};

export class DiscoveryResponder {
	private socket: dgram.Socket | null = null;
	offer: DiscoveryOffer | null = null;

	get isRunning(): boolean {
		return this.socket !== null;
	}

	/** The UDP port actually bound (tests), or null when not running. */
	get boundPort(): number | null {
		const a = this.socket?.address();
		return a && typeof a === "object" ? a.port : null;
	}

	/** Binds 0.0.0.0:<port>? same as HTTP by default (UDP vs TCP ports don't clash). */
	start(listenPort: number = DISCOVERY_PORT): Promise<void> {
		if (this.socket) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const s = dgram.createSocket("udp4");
			s.on("error", (err) => {
				if (!this.socket) {
					reject(err);
					return;
				}
				// treat runtime errors (rare on UDP) as silence, not a crash
				s.close();
				this.socket = null;
			});
			s.on("message", (buf, rinfo) => this.onMessage(s, buf, rinfo));
			s.bind(listenPort, "0.0.0.0", () => {
				this.socket = s;
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		const s = this.socket;
		if (!s) return Promise.resolve();
		this.socket = null;
		return new Promise((resolve) => s.close(() => resolve()));
	}

	private onMessage(s: dgram.Socket, buf: Buffer, rinfo: dgram.RemoteInfo): void {
		if (!this.offer) return;
		let msg: unknown;
		try {
			msg = JSON.parse(buf.toString("utf8"));
		} catch {
			return; // not koNotes traffic
		}
		const m = msg as Record<string, unknown>;
		if (m["konotes"] !== "discover") return;
		const id = m["id"];
		if (typeof id !== "string") return;
		const reply = JSON.stringify({
			konotes: "offer",
			id: id,
			name: this.offer.name,
			port: this.offer.port,
		});
		s.send(reply, rinfo.port, rinfo.address);
	}
}
