// Types-only npm package: this stub stands in for the real `obsidian` module
// in unit tests. Keep parity with src/booknoteStore.ts's runtime imports.
export class TFile {
	path = "";
	extension = "md";
	basename = "";
}

export class TFolder {
	path = "";
	name = "";
	children: (TFile | TFolder)[] = [];
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}
