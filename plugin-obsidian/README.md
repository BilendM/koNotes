# koNotes Obsidian plugin

Receives KOReader highlights pushed over the LAN and keeps one deterministic
note per book in your vault. Contract: [../PROTOCOL.md](../PROTOCOL.md).

## Settings

- **Enable sync server** / **Port** (default 8787; if busy, the next 10 ports are tried and the working port is kept).
- **Pair a new device**: shows a 6-digit code valid 5 minutes (5 wrong attempts max); the reader types it once and receives a long random token automatically. Paired devices can be revoked — the token stops working immediately.
- **Manual device tokens**: optional per-line tokens for hand-configured devices.
- **Folder / Filename template**: where notes live and how they are named. Notes with a display override use it instead.
- Built-in **firewall hint** for the one setup problem that needs the OS.

## Commands

- *Start/Stop sync server*
- *Pair a device (show pairing code)*
- *Set display title / Set display author* on the active koNotes note — fixes
  scraped-EPUB titles like `Designing Data-Intensive Applications (for . .)` for
  good: H1, author line and filename follow the override (renames are skipped
  rather than fought when the target name is already used by another note; a
  manually renamed note without an override is always preserved), raw values
  stay in frontmatter, and full regeneration can never undo it.
- Status bar chip shows server state + last sync and opens these settings.

## Discovery (v1.1)

While the server runs, it answers reader broadcasts on UDP 41838. Devices can
therefore find a moving (DHCP) server address on their own.

## Tests

```sh
npm test    # 37 tests: sync semantics, protocol, pairing, discovery
```
