import process from "process";
import esbuild from "esbuild";

const prod = process.argv[2] === "production";

if (prod) {
	await esbuild.build({
		banner: {
			js: "/* koNotes (Obsidian) — built file, do not edit. Source: src/main.ts */",
		},
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: ["obsidian", "electron", "node:*", "@codemirror/*", "@lezer/*"],
		format: "cjs",
		target: "es2020",
		logLevel: "info",
		sourcemap: false,
		treeShaking: true,
		outfile: "main.js",
		minify: true,
	});
} else {
	const ctx = await esbuild.context({
		banner: {
			js: "/* koNotes (Obsidian) — built file, do not edit. Source: src/main.ts */",
		},
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: ["obsidian", "electron", "node:*", "@codemirror/*", "@lezer/*"],
		format: "cjs",
		target: "es2020",
		logLevel: "info",
		sourcemap: "inline",
		treeShaking: true,
		outfile: "main.js",
		conditions: ["browser"],
	});
	await ctx.watch();
}
