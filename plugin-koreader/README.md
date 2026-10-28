# provider-konotes.koplugin

KOReader-side half of koNotes: adds an **Obsidian (koNotes)** target to KOReader's
built-in *Export highlights* menu and pushes each book's annotations to the
koNotes Obsidian plugin over Wi-Fi. Contract: [../PROTOCOL.md](../PROTOCOL.md).

Requires **KOReader ≥ 2025.04** (third-party exporter provider support).

## Install

1. Copy the whole `provider-konotes.koplugin` folder into KOReader's `plugins/`
   directory. On PocketBook/Vivlio installs that is typically
   `/mnt/onboard/.adds/koreader/plugins/`.
2. Restart KOReader if it was running.
3. *Tools (wrench) → More tools → Plugin management* — confirm **koNotes** is enabled.
4. While reading a book, open *Export highlights → Choose formats and services →
   Obsidian (koNotes)*:
   - set **computer address (IP)** (your Mac/PC local IP, e.g. `192.168.1.10`),
   - **server port** (default `8787`),
   - **device token** (one of the tokens configured in Obsidian → Settings → koNotes),
   - run **Test connection** — it should say "koNotes server reachable".
5. Export with *Export highlights → Export all notes in your library*.

## Notes

- Obsidian must be running with the koNotes sync server enabled; both devices
  on the same Wi-Fi.
- Manual sync only in v1 (by design — see PLAN.md). Wi-Fi is never turned on
  automatically; koNotes tells you when it's off.
- The device name sent in the payload defaults to `Device.model`.
- v1 skips image ("drawer") highlights and empty marks; they are counted in the
  per-export summary so nothing silently disappears.
- `payload_hash` on the Obsidian side derives from JSON key order; rare key
  reordering (e.g. after a KOReader upgrade) causes at most one redundant
  rewrite of unchanged content — harmless.

## Tests (payload shaping, no KOReader needed)

```sh
cd provider-konotes.koplugin
lua spec/payload_test.lua
```

## Troubleshooting

- *Test connection* fails → check Obsidian is running, the koNotes server is
  enabled, IP/port are right, and no firewall blocks the port.
- Export errors → `crash.log` in your KOReader data dir contains the details
  (grep for `koNotes:`).
- Menu target doesn't appear → KOReader version is older than 2025.04.
