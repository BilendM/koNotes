import { type App, PluginSettingTab, Setting } from "obsidian";
import type KoNotesPlugin from "./main";

export interface KoNotesSettings {
	serverEnabled: boolean;
	port: number;
	/** one token per line */
	deviceTokens: string;
	noteFolder: string;
	filenameTemplate: string;
}

export const DEFAULT_SETTINGS: KoNotesSettings = {
	serverEnabled: false,
	port: 8787,
	deviceTokens: "",
	noteFolder: "KOReader",
	filenameTemplate: "{{author}} - {{title}}",
};

export function parseTokens(raw: string): string[] {
	return raw
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

export class KoNotesSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: KoNotesPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Sync server").setHeading();

		new Setting(containerEl)
			.setName("Enable sync server")
			.setDesc("Starts a local HTTP listener and begins it automatically whenever Obsidian runs.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.serverEnabled).onChange(async (v) => {
					this.plugin.settings.serverEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Port")
			.setDesc("HTTP port. Default 8787.")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.port)).onChange(async (v) => {
					const port = Number(v);
					if (Number.isInteger(port) && port > 0 && port < 65536) {
						this.plugin.settings.port = port;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Device tokens")
			.setDesc("One random token per line; KOReader devices must send one in the Authorization header.")
			.addTextArea((t) =>
				t.setValue(this.plugin.settings.deviceTokens).onChange(async (v) => {
					this.plugin.settings.deviceTokens = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName("Notes").setHeading();

		new Setting(containerEl)
			.setName("Folder")
			.setDesc("Vault folder the book notes are written to.")
			.addText((t) =>
				t.setValue(this.plugin.settings.noteFolder).onChange(async (v) => {
					this.plugin.settings.noteFolder = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Filename template")
			.setDesc("Uses {{author}} and {{title}}. Default: {{author}} - {{title}}.")
			.addText((t) =>
				t.setValue(this.plugin.settings.filenameTemplate).onChange(async (v) => {
					this.plugin.settings.filenameTemplate = v.trim() || DEFAULT_SETTINGS.filenameTemplate;
					await this.plugin.saveSettings();
				}),
			);
	}
}
