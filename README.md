# koNotes

Wireless sync of **KOReader** highlights into an **Obsidian** vault — one deterministic note per book.

```
Vivlio/PocketBook (KOReader)                     Obsidian (desktop)
provider-konotes.koplugin ──HTTP POST (LAN)──▶  koNotes plugin (embedded server)
        annotations JSON  ◀─────────────────────  one .md per book, regenerated per sync
```

## Why koNotes

Existing KOReader → Obsidian paths are append-only or USB/manual. koNotes makes the note a **declaration of current state**:

- **Deletions propagate** — remove a highlight on the reader, re-sync, it disappears from Obsidian. Even "I deleted the last highlight of the book" empties the note correctly.
- **Edits propagate** — corrected text or a re-timed annotation shows up as it is on the device now, not as it once was.
- **Your writing is safe** — only content inside the note's protected `<!-- koNotes:manual --> … <!-- /koNotes:manual -->` block is preserved verbatim; everything else is derived state.
- **Idempotent** — a re-sync with no changes writes nothing (hash-guarded).

## Quick start (~5 minutes, no typing of IPs or tokens)

1. **Obsidian**: copy `main.js` + `manifest.json` (or the release zip) into `<Vault>/.obsidian/plugins/konotes/`, enable the plugin. In *Settings → koNotes* turn on the sync server and click **Pair a new device** — a 6-digit code shows for 5 minutes.
2. **Reader**: install the KOReader plugin (below), then while reading any book:
   *Export highlights → Choose formats and services → Obsidian (koNotes) → Pair with Obsidian…* → type the 6-digit code.
   The reader discovers your computer's address on its own (one UDP broadcast on port 41838, no daemons) and stores a long random token.
3. Export via the usual *Export highlights* menu. Done — afterwards, closing a book auto-syncs it (when Wi-Fi is already on; koNotes **never** enables the radio itself).

### Manual fallback (no discovery)

In the same device menu set computer IP, server port (default `8787`) and a device token manually — or in Obsidian, list such tokens under *Manual device tokens* (one per line). Full wire contract: [PROTOCOL.md](PROTOCOL.md).

## Honesty section (read this)

| Limitation | Detail |
|---|---|
| LAN + Obsidian running | Sync happens when Obsidian **desktop** is open and the device is on the same network. Remote sync is out of scope by design. |
| Plain HTTP | TLS on e-readers is impractical; tokens (or the 6-digit pairing window) are the auth. Do **not** use on untrusted networks; disable the server when not syncing. |
| Image highlights excluded | KOReader "drawer"-marks are skipped (reported in the export summary, never silently dropped). Protocol can represent them later (v1.2+). |
| File rename on reader | A book moved to another path syncs as a *new* note — book identity is the reader-local file path (frontmatter `source`). |
| Title garbage passthrough | Titles like `Book (for . .)` come from scraped EPUB metadata — KOReader's own Book info shows the same. Fix per note: *koNotes: Set display title…* (also fixes filename; survives sync). |

## Install

**Obsidian**: release assets → drop into `.obsidian/plugins/konotes/`. Or **BRAT** with `BilendM/koNotes`.

**KOReader** (≥ 2025.04, uses the official third-party `Provider` API): unzip `provider-konotes.koplugin.zip` into KOReader's `plugins/` directory (PocketBook: `<mount>/applications/koreader/plugins/` or `/mnt/onboard/.adds/koreader/plugins/`) and restart KOReader.

Device features: pairing, discovery fallback, *Auto-sync on book close* (opt-out), *Sync highlights to Obsidian (koNotes)* bindable to any gesture via KOReader's gestures/Profiles.

## Layout

```
plugin-obsidian/   TypeScript plugin: HTTP sync server, vault store, discovery responder, pairing
plugin-koreader/   Lua plugin: provider-registered exporter target + close-hook auto-sync
PROTOCOL.md        versioned JSON contract (v1.1): sync + discovery + pairing
PLAN.md            design record and roadmap
```

## Development

```bash
cd plugin-obsidian && npm install && npm test && npm run build
cd plugin-koreader/provider-konotes.koplugin && lua spec/payload_test.lua
```

CI runs both suites on push/PR.

## FAQ

- **Does it sync when Obsidian is closed?** No — the server lives inside Obsidian. Consider noting highlights at session end.
- **Does it enable Wi-Fi?** Never. Auto-sync acts only when Wi-Fi is already on (battery etiquette).
- **Where do notes go?** `<noteFolder>/<author> - <title>.md` (template- and overridable); one file per book, safe to rename manually (koNotes re-resolves by `source`).
- **Is my vault writable by anyone on my network?** Only devices holding a token; revoke any device in Settings → koNotes.
- **KOReader ≥ 2025.04?** Required — `Provider:register("exporter", …)` third-party targets.
