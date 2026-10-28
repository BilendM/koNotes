import { Notice, Plugin } from "obsidian";
import { KoNotesServer, type ServerHook } from "./server";
import { VaultNoteStore } from "./booknoteStore";
import { DEFAULT_SETTINGS, KoNotesSettingTab, parseTokens, type KoNotesSettings } from "./settings";

export default class KoNotesPlugin extends Plugin {
	settings: KoNotesSettings = DEFAULT_SETTINGS;
	private server = new KoNotesServer({
		sync: (payload) => new VaultNoteStore(this.app, this.settings).sync(payload),
	});
	/** to restart the listener when port/tokens change while running */
	private runningPort?: number;
	private runningTokens?: string;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new KoNotesSettingTab(this.app, this));
		this.server.onHook = (hook: ServerHook) => this.onHook(hook);
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

	private tokens(): string[] {
		return parseTokens(this.settings.deviceTokens);
	}

	private async startServer(): Promise<void> {
		await this.stopServer().catch(() => undefined);
		await this.server.start(this.settings.port, this.tokens());
		this.runningPort = this.settings.port;
		this.runningTokens = this.settings.deviceTokens;
	}

	private async stopServer(): Promise<void> {
		await this.server.stop();
		this.runningPort = undefined;
		this.runningTokens = undefined;
	}

	/** start/stop/restart so the running server always matches settings; notices on change. */
	private async applyServerState(): Promise<void> {
		const want = this.settings.serverEnabled && this.tokens().length > 0;
		const unchanged =
			this.server.isRunning && this.runningPort === this.settings.port && this.runningTokens === this.settings.deviceTokens;
		if (want && unchanged) return;
		if (want) {
			await this.startServer();
			new Notice(`koNotes: listening on port ${this.settings.port}`);
		} else if (this.server.isRunning) {
			await this.stopServer();
			new Notice("koNotes: sync server stopped");
		}
	}

	private onHook(hook: ServerHook): void {
		switch (hook.kind) {
			case "synced":
				new Notice(`koNotes: ${hook.action} ${hook.path}`);
				break;
			case "error":
				new Notice("koNotes: " + hook.message);
				break;
		}
	}
}
