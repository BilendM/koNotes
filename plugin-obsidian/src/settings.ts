import { type App, PluginSettingTab, Setting, Modal, Notice } from "obsidian";
import type KoNotesPlugin from "./main";

export interface PairedDevice {
	/** label the reader reported itself with at pairing time */
	name: string;
	token: string;
	pairedAt: string;
}

export interface KoNotesSettings {
	serverEnabled: boolean;
	port: number;
	/** one token per line (manual setup) */
	deviceTokens: string;
	/** devices that completed the 6-digit pairing flow */
	pairedDevices: PairedDevice[];
	noteFolder: string;
	filenameTemplate: string;
}

export const DEFAULT_SETTINGS: KoNotesSettings = {
	serverEnabled: false,
	port: 8787,
	deviceTokens: "",
	pairedDevices: [],
	noteFolder: "KOReader",
	filenameTemplate: "{{author}} - {{title}}",
};

export function parseTokens(raw: string): string[] {
	return raw
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

export function allTokens(settings: KoNotesSettings): string[] {
	return [...parseTokens(settings.deviceTokens), ...settings.pairedDevices.map((d) => d.token)];
}

/** Show the pairing code while the window is open (device must confirm within TTL). */
export class PairModeModal extends Modal {
	constructor(
		app: App,
		private readonly code: string,
		private readonly onCancel: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Pair a KOReader device" });
		this.contentEl.createEl("p", {
			text: "On the device: Export highlights → Obsidian (koNotes) → Pair with Obsidian…, then enter this code. Valid for 5 minutes.",
		});
		const code = this.contentEl.createEl("p", { cls: "konotes-pairing-code" });
		code.style.fontSize = "2em";
		code.style.letterSpacing = "0.3em";
		code.style.fontWeight = "bold";
		code.textContent = this.code.slice(0, 3) + " " + this.code.slice(3);
		this.contentEl.createEl("button", { text: "Cancel pairing" }).onclick = () => this.close();
	}

	onClose(): void {
		this.onCancel();
	}
}

/** Small single-field prompt used for the display title/author overrides. */
export class PromptModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private initial: string,
		private onSubmit: (value: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: this.title });
		const input = this.contentEl.createEl("input", {
			type: "text",
			value: this.initial,
		});
		input.style.width = "100%";
		this.contentEl.createDiv().style.marginTop = "0.6em";
		const buttons = this.contentEl.createDiv();
		buttons.style.display = "flex";
		buttons.style.justifyContent = "flex-end";
		buttons.style.gap = "0.5em";
		buttons.style.marginTop = "0.8em";
		const cancel = buttons.createEl("button", { text: "Cancel" });
		const save = buttons.createEl("button", { text: "Save" });
		save.addClass("mod-cta");
		cancel.onclick = () => this.close();
		save.onclick = () => {
			this.close();
			void this.onSubmit(input.value);
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.close();
				void this.onSubmit(input.value);
			}
		});
	}

	onClose(): void {}
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
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Port")
			.setDesc("HTTP port. Default 8787. If it is taken by another app, koNotes tries the next ports up to 8797 and keeps the one that worked.")
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
			.setName("Firewall hint")
			.setDesc("If the device cannot connect: macOS System Settings → Network → Firewall → allow incoming connections on the port above (usually needed only once).")
			.setClass("konotes-firewall-hint");

		new Setting(containerEl).setName("Devices").setHeading();

		new Setting(containerEl)
			.setName("Pair a new device")
			.setDesc("Shows a 6-digit code to enter on the reader once; a long random token is created automatically — no more typing by hand.")
			.addButton((b) =>
				b
					.setButtonText("Pair device")
					.setCta()
					.onClick(() => void this.plugin.startPairing()),
			);

		for (const device of this.plugin.settings.pairedDevices) {
			new Setting(containerEl)
				.setName(device.name)
				.setDesc(`paired ${device.pairedAt} · token ${device.token.slice(0, 10)}…`)
				.addButton((b) =>
					b.setButtonText("Revoke").onClick(async () => {
						this.plugin.settings.pairedDevices = this.plugin.settings.pairedDevices.filter((d) => d.token !== device.token);
						await this.plugin.saveSettings();
						new Notice(`koNotes: device "${device.name}" revoked`);
						this.display();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Manual device tokens")
			.setDesc("Optional: one random token per line for devices you configure by hand instead of pairing.")
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
			.setDesc("Uses {{author}} and {{title}}. Default: {{author}} - {{title}}. Notes with a title/author override use it instead.")
			.addText((t) =>
				t.setValue(this.plugin.settings.filenameTemplate).onChange(async (v) => {
					this.plugin.settings.filenameTemplate = v.trim() || DEFAULT_SETTINGS.filenameTemplate;
					await this.plugin.saveSettings();
				}),
			);
	}
}
