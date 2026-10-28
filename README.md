# koNotes

Wireless sync of **KOReader** reading highlights into an **Obsidian** vault — one note per book.

```
Vivlio/PocketBook (KOReader)                Obsidian (desktop)
provider-konotes.koplugin   ──HTTP POST──▶  koNotes plugin (embedded server)
```

## What it does

- On the reader: highlights are exported to a JSON payload over the local Wi-Fi network.
- In Obsidian: the koNotes plugin receives the payload and writes/updates **exactly one note per book**, deterministically regenerated from the full annotation list each sync — so highlights you delete or edit on the reader are reflected in Obsidian too (unlike append-only sync tools).
- Manually added content inside the note's protected `<!-- koNotes:manual -->` block survives regeneration.

## Status

| Part | State |
|---|---|
| `plugin-obsidian/` (M1 — vault server) | ✅ implemented, unit + integration tested |
| `plugin-koreader/` (M2 — provider target) | 🔜 see [PLAN.md](PLAN.md) |
| `PROTOCOL.md` | ✅ v1 contract |

## Quick start (Obsidian side)

1. Build: `npm install && npm run build` inside `plugin-obsidian/`.
2. Copy `plugin-obsidian/{main.js,manifest.json}` into `YourVault/.obsidian/plugins/konotes/`.
3. Enable the plugin; in *Settings → koNotes*: enable the server, add your device's token (one per line), set the target folder.
4. Later (M2): on your device, install the KOReader counterpart and point it at your machine's IP/port.

Manual test without a device:

```bash
curl -X POST http://127.0.0.1:8787/kosync/v1/sync \
  -H "Authorization: <token from settings>" \
  -H "Content-Type: application/json" \
  -d @plugin-obsidian/fixtures/payload-fluent-forever.json
```

## Layout

```
plugin-obsidian/   Obsidian plugin (TypeScript, embedded HTTP server)
plugin-koreader/   KOReader plugin (Lua, exporter provider target) — M2
PROTOCOL.md        versioned JSON contract shared by both sides
PLAN.md            design notes and milestones
```
