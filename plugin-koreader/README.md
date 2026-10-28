# provider-konotes.koplugin

KOReader-side half of koNotes: adds an **Obsidian (koNotes)** target to KOReader's
built-in *Export highlights* menu and pushes each book's annotations to the
koNotes Obsidian plugin over Wi-Fi. Contract: [../PROTOCOL.md](../PROTOCOL.md).

Requires **KOReader ≥ 2025.04** (third-party exporter provider support).

## Install

1. Copy the whole `provider-konotes.koplugin` folder into KOReader's `plugins/`
   directory. On PocketBook/Vivlio installs that is typically
   `/mnt/onboard/.adds/koreader/plugins/` (this user's device mounts at
   `applications/koreader/plugins/`).
2. Restart KOReader if it was running.
3. *Tools (wrench) → More tools → Plugin management* — confirm **koNotes** is enabled.
4. While reading a book, open *Export highlights → Choose formats and services →
   Obsidian (koNotes)* and pair once: **Pair with Obsidian…** → type the 6-digit
   code Obsidian's koNotes settings shows for 5 minutes. IP, port and token are
   filled in automatically.

   Manual fallback (same menu): *Set computer address (IP)* (your Mac/PC local
   IP), *Set server port* (default `8787`), *Set device token* (from
   *Obsidian → Settings → koNotes → Manual device tokens*), then run
   **Test connection** — it should say "koNotes server reachable".
5. Export with *Export highlights → Export all notes in your library*.

## What syncs by itself (v1.1)

- **Auto-sync on book close** (on by default): koNotes re-exports the book when
  its annotations changed since the last sync — and only when Wi-Fi is already
  on. It never enables the radio, never shows a dialog silently-fails. Turn it
  off in the koNotes menu (**Auto-sync on book close**).
- **Discovery**: without a manually configured IP, one UDP broadcast finds a
  running koNotes server per export/pair/test flow. DHCP IP changes stop
  breaking sync.
- **Sync now**: *Tools → More gestures / Profiles* exposes the
  **Sync highlights to Obsidian (koNotes)** action to bind to any gesture.

## Notes

- Obsidian must be running with the koNotes sync server enabled; both devices
  on the same Wi-Fi.
- The device name sent in the payload defaults to `Device.model`.
- v1 skips image ("drawer") highlights and empty marks; they are counted in the
  per-export summary so nothing silently disappears.
- `payload_hash` on the Obsidian side derives from JSON key order; rare key
  reordering (e.g. after a KOReader upgrade) causes at most one redundant
  rewrite of unchanged content — harmless.

## Tests (payload shaping, no KOReader needed)

```sh
cd provider-konotes.koplugin
lua spec/payload_test.lua   # or luac -p main.lua target.lua for a syntax check
```

## Troubleshooting

- *Test connection* fails → check Obsidian is running, the koNotes server is
  enabled, IP/port are right, and no firewall blocks the port.
- Export errors → `crash.log` in your KOReader data dir contains the details
  (grep for `koNotes:`).
- Menu target doesn't appear → KOReader version is older than 2025.04.
