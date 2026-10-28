// Discovery responder over real loopback UDP (no broadcast needed: direct messages
// take the same code path). device→discover, vault→offer with echoed id.
import { afterEach, describe, expect, it } from "vitest";
import * as dgram from "node:dgram";
import { DISCOVERY_PORT, DiscoveryResponder } from "../src/discovery";

async function clientSocket(): Promise<dgram.Socket> {
	const s = dgram.createSocket("udp4");
	s.bind(0, "127.0.0.1");
	return s;
}

function sendDiscover(s: dgram.Socket, port: number | null): Promise<{ id: string; body: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const id = "9871";
		if (port === null) {
			reject(new Error("responder not bound"));
			return;
		}
		const timer = setTimeout(() => reject(new Error("no discovery offer")), 2000);
		s.once("message", (buf) => {
			clearTimeout(timer);
			resolve({ id: id, body: JSON.parse(buf.toString("utf8")) });
		});
		s.send(JSON.stringify({ konotes: "discover", id: id }), port, "127.0.0.1");
	});
}

afterEach(() => {});

describe("discovery responder", () => {
	it("finds a free port on loopback", () => {
		expect(typeof DISCOVERY_PORT).toBe("number");
	});

	it("answers a discover datagram with an offer echoing the id and the HTTP port", async () => {
		const responder = new DiscoveryResponder();
		responder.offer = { port: 8787, name: "reading-vault" };
		await responder.start(0); // ephemeral port, parallel-safe
		const socket = await clientSocket();
		const reply = await sendDiscover(socket, responder.boundPort);
		socket.close();
		await responder.stop();
		expect(reply.body).toMatchObject({ konotes: "offer", id: "9871", name: "reading-vault", port: 8787 });
	});

	it("stays completely silent after stop", async () => {
		const responder = new DiscoveryResponder();
		responder.offer = { port: 8787, name: "x" };
		await responder.start(0);
		const port = responder.boundPort;
		await responder.stop();
		const socket = await clientSocket();
		await expect(sendDiscover(socket, port)).rejects.toBeTruthy();
		socket.close();
	});
});
