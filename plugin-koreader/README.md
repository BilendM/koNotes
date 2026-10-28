# plugin-koreader (M2 — not yet implemented)

The KOReader side: a `provider-konotes.koplugin` that registers an Obsidian target
in the built-in *Export highlights* menu via KOReader's `Provider` API
(`Provider:register("exporter", "konotes", impl)`), then POSTs each book's
annotations to the koNotes Obsidian server.

Implementation reference targets: `exporter.koplugin/target/joplin.lua` (HTTP push)
and `koreader/contrib/provider-old-exporters.koplugin` (third-party exporter provider packaging).

Payload contract: [../PROTOCOL.md](../PROTOCOL.md). Milestone status: [../PLAN.md](../PLAN.md).
