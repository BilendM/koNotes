import { Notice, Plugin, type TFile } from "obsidian";
import { KoNotesServer, type ServerHook } from "./server";
import { DiscoveryResponder } from "./discovery";
import { PairingManager } from "./pairing";
import { VaultNoteStore } from "./booknoteStore";
import {
	DEFAULT_SETTINGS,
	KoNotesSettingTab,
	PairModeModal,
	PromptModal,
	allTokens,
	type KoNotesSettings,
} from "./settings";

export default class KoNotesPlugin extends Plugin {
	settings: KoNotesSettings = DEFAULT_SETTINGS;
	private server = new KoNotesServer({
		sync: (payload) => new VaultNoteStore(this.app, this.settings).sync(payload),
	});
	private discovery = new DiscoveryResponder();
	private pairing = new PairingManager();
	/** to restart the listener when port/tokens change while running */
	private runningPort?: number;
	private runningTokens?: string;
	private statusChip: HTMLElement | null = null;
	private lastSynced: Date | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new KoNotesSettingTab(this.app, this));
		this.server.onHook = (hook: ServerHook) => this.onHook(hook);
		this.server.onPairDevice = (name, token) => this.registerPairedDevice(name, token);
		this.statusChip = this.addStatusBarItem();
		this.statusChip.onclick = () => this.openSettings();
		this.addCommand({
			id: "start-server",
			name: "Start sync server",
			callback: () => void this.startServer().catch((e) => new Notice("koNotes: " + e.message)),
		});
		this.addCommand({
			id: "stop-server",
			name: "Stop sync server",
			callback: () => void this.stopServer(),
		});
		this.addCommand({
			id: "pair-device",
			name: "Pair a device (show pairing code)",
			callback: () => void this.startPairing(),
		});
		this.addCommand({
			id: "set-display-title",
			name: "Set display title (fix the book's name) on the active note",
			checkCallback: (checking) => this.isKoNoteCallback(checking, "title_override"),
		});
		this.addCommand({
			id: "set-display-author",
			name: "Set display author on the active note",
			checkCallback: (checking) => this.isKoNoteCallback(checking, "author_override"),
		});
		this.updateStatusBar();
		if (this.settings.serverEnabled) {
			void this.startServer().catch((e) => new Notice("koNotes: " + e.message));
		}
	}

	onunload(): Promise<void> {
		return this.stopServer();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<KoNotesSettings>);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.applyServerState();
	}

	/** server should follow tokens without a restart that quoting side effects would cause */
	private async registerPairedDevice(name: string, token: string): Promise<void> {
		this.settings.pairedDevices = [
			...this.settings.pairedDevices.filter((d) => d.name !== name),
			{ name: name, token: token, pairedAt: new Date().toISOString().slice(0, 10) },
		];
		await this.saveData(this.settings);
		this.server.setTokens(allTokens(this.settings));
	}

	// ---- server lifecycle -------------------------------------------------

	private async startServer(): Promise<void> {
		await this.stopServer().catch(() => undefined);
		for (let port = this.settings.port; port <= this.settings.port + 10; port++) {
			try {
				await this.server.start(port, allTokens(this.settings));
				if (port !== this.settings.port) {
					this.settings.port = port;
					await this.saveData(this.settings); // persist the working port, no restart dance
					new Notice(`koNotes: port ${this.settings.port} was busy — using ${port}`);
				}
				this.runningPort = port;
				this.runningTokens = this.settings.deviceTokens;
				this.startDiscovery();
				this.updateStatusBar();
				return;
			} catch (e) {
				const code = (e as NodeJS.ErrnoException).code;
				if (code !== "EADDRINUSE" && code !== "EACCES") throw e;
			}
		}
		throw new Error(`could not find a free port near ${this.settings.port}`);
	}

	private async stopServer(): Promise<void> {
		await this.server.stop();
		await this.discovery.stop();
		this.runningPort = undefined;
		this.runningTokens = undefined;
		this.updateStatusBar();
	}

	/** start/stop/restart so the running server always matches settings; notices on change.
	 *  Enable alone keeps the server up even with zero tokens: sync requests are refused
	 *  (401) but the pairing endpoint must be able to run — otherwise a fresh install
	 *  has no running server to pair with (observed 2026-10-30). */
	private async applyServerState(): Promise<void> {
		const want = this.settings.serverEnabled;
		const unchanged =
			this.server.isRunning && this.runningPort === this.settings.port && this.runningTokens === this.settings.deviceTokens;
		if (want && unchanged) {
			this.server.setTokens(allTokens(this.settings));
			return;
		}
		if (want) {
			await this.startServer();
			new Notice(`koNotes: listening on port ${this.settings.port}`);
		} else if (this.server.isRunning) {
			await this.stopServer();
			new Notice("koNotes: sync server stopped");
		} else {
			this.updateStatusBar();
		}
	}

	/** UDP responder answers discovery broadcasts only while the server runs. */
	private startDiscovery(): void {
		this.discovery.offer = { port: this.server.port ?? this.settings.port, name: this.app.vault.getName() };
		if (!this.discovery.isRunning) {
			void this.discovery.start().catch((e) => new Notice("koNotes: discovery responder failed — manual setup still works (" + e.message + ")"));
		}
	}

	// ---- pairing ----------------------------------------------------------

	async startPairing(): Promise<void> {
		if (this.server.pairing) {
			new Notice("koNotes: a pairing window is already open");
			return;
		}
		if (!this.server.isRunning) {
			// pairing needs a live server (the UDP responder answers its broadcasts),
			// even with no tokens yet — that's the whole point of cold-start pairing.
			this.settings.serverEnabled = true;
			try {
				await this.startServer();
			} catch (e) {
				new Notice("koNotes: " + (e instanceof Error ? e.message : String(e)));
				return;
			}
			new Notice(`koNotes: server started on port ${this.settings.port} for pairing`);
		}
		this.server.pairing = this.pairing;
		const code = this.pairing.start();
		new PairModeModal(this.app, code, () => {
			this.pairing.cancel();
			this.server.pairing = null;
		}).open();
	}

	// ---- display overrides -------------------------------------------------

	/** Commands must only run on koNotes book notes. */
	private isKoNoteCallback(checking: boolean, key: "title_override" | "author_override"): boolean {
		const file = this.app.workspace.getActiveFile();
		const fm = file && this.app.metadataCache.getFileCache(file)?.frontmatter;
		const isKoNote = !!fm && typeof fm["source"] === "string" && String(fm["source"]).startsWith("koreader://");
		if (checking) return isKoNote;
		if (file && isKoNote) void this.setOverride(file, key);
		return false;
	}

	private async setOverride(file: TFile, key: "title_override" | "author_override"): Promise<void> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const current = typeof fm[key] === "string" ? (fm[key] as string) : "";
		new PromptModal(
			this.app,
			key === "title_override" ? "Display title (empty resets)" : "Display author (empty resets)",
			current,
			async (value: string) => {
				await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
					const v = value.trim();
					if (v === "") delete frontmatter[key];
					else frontmatter[key] = v;
				});
				const store = new VaultNoteStore(this.app, this.settings);
				const rename = await store.renameByFrontmatter(file);
				new Notice(
					rename === "renamed"
						? `koNotes: note renamed to ${file.path}`
						: rename === "target-taken"
							? "koNotes: override saved, but the expected filename is already used by another note"
							: "koNotes: override saved",
				);
			},
		).open();
	}

	// ---- ui ---------------------------------------------------------------

	private openSettings(): void {
		const setting = (this.app as unknown as {
			setting?: { open: () => void; openTabById?: (id: string) => void };
		}).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById?.(this.manifest.id);
	}

	private updateStatusBar(): void {
		if (!this.statusChip) return;
		const base = this.server.isRunning ? `koNotes: open :${this.server.port ?? this.settings.port}` : "koNotes: server off";
		const sync = this.lastSynced ? ` · last sync ${this.lastSynced.toTimeString().slice(0, 5)}` : "";
		this.statusChip.textContent = base + sync;
	}

	private onHook(hook: ServerHook): void {
		switch (hook.kind) {
			case "synced":
				if (hook.action === "paired") {
					new Notice(`koNotes: device "${hook.path}" paired — it can sync now`);
				} else {
					this.lastSynced = new Date();
					new Notice(`koNotes: ${hook.action} ${hook.path}`);
				}
				this.updateStatusBar();
				break;
			case "error":
				new Notice("koNotes: " + hook.message);
				break;
		}
	}
}
