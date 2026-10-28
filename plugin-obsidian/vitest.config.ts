import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		// The real `obsidian` package ships types only; tests run against this stub.
		alias: [{ find: /^obsidian$/, replacement: path.join(root, "tests", "mock-obsidian.ts") }],
	},
});
