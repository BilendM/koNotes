# koNotes — Wireless KOReader → Obsidian Highlights Sync

> Working title `koSync` — renamed because KOReader already ships a built-in plugin named **KOSync** (progress sync vs. `koreader-sync-server`). Proposed name: **koNotes** (alternatives: *koread-bridge*, *InkImport*). KOReader-side plugin id: `provider-konotes.koplugin`, keeping it distinct from KOSync in plugin menus.

## Goal

One-tap (plus optional automatic on book close) wireless sync of KOReader annotations to an Obsidian vault. **One note per book**, deterministically regenerated on every sync. Primary test device: PocketBook **Vivlio**.

## Decisions locked (with user)

| Decision | Choice |
|---|---|
| Sync direction | **Push** from reader → Obsidian HTTP server (LAN) |
| Update semantics | **Regenerate whole note** from full annotation payload on each sync |
| Scope | **Both plugins, new code** in one repo |
| Name | Rename from koSync → **koNotes** (TBC) |
| Test devices | Vivlio (PocketBook) only for now |

## Prior art researched

| Project | Approach | Gap it leaves |
|---|---|---|
| KOReader built-in Exporter (Joplin, Readwise, Nextcloud, JSON/HTML/MD) | Lua; HTTP or file targets | No Obsidian target; local exports not wireless |
| breno5g/koreader-sync (Obsidian) | Obsidian plugin runs local HTTP server; KOReader pushes JSON; one `.md` per book with callouts | Proves the exact pattern; young/small client; append-only update semantics (deleted highlights never propagate) |
| t5k6/obsidian-koreader-highlights (Obsidian) | Scans device files via USB/MTP mount | Not wireless, manual |
| Edo78/obsidian-koreader-sync | USB-based scan | Same limitation |

Key KOReader capability (late 2024+): official **`Provider` API** —
`Provider:register("exporter", "konotes", impl)` — a third-party plugin can add a target to the *built-in* Export Highlights menu. KOReader developers advise naming third-party plugins with a `provider-` prefix so they load first. Packaging reference: `koreader/contrib/provider-old-exporters.koplugin`; also `fairlygood/koreader-highlights-webdav`.

## Architecture

```
┌─────────────────────────────┐      HTTP POST /kosync/v1/sync          ┌──────────────────────────────┐
│  Vivlio — KOReader          │      (LAN, JSON, device token)          │  PC — Obsidian               │
│  provider-konotes.koplugin  │ ────────────────────────────────────────▶│  koNotes Obsidian plugin     │
│  • registers exporter target│                                         │  • embedded Node HTTP server │
│    via Provider API         │                                         │  • per-book note, idempotent │
│  • reuses built-in parser   │                                         │    regeneration + frontmatter│
└─────────────────────────────┘                                         └──────────────────────────────┘
```

### KOReader side (Lua) — `plugin-koreader/provider-konotes.koplugin`

- Registers as exporter provider → appears under **Export highlights → Choose formats and services → koNotes** for free.
- Inherits exporter's `base` (/? see shim note below) so highlight parsing via `MyClipping` is reused — never parse `.sdr` sidecar files directly.
- Modeled on `exporter.koplugin/target/joplin.lua`:
  - `isReadyToExport()` when host/port/token configured.
  - Config dialog (InputDialog) for host, port, token; enable toggle.
  - Per-book JSON POST via `socket.http` + `ltn12`; inherit `base`'s `makeJsonRequest` if accessible.
- Wi-Fi etiquette: check `NetworkMgr:isWifiOn()`; if off, *prompt* to connect (never silently enable — battery conventions).
- Triggers: manual export (current book / all history via standard exporter menu), optional sync-on-book-close hook (M4).
- Failure isolation: one book failing must not abort the whole export; InfoMessage feedback with diagnostics.

### Obsidian side (TypeScript) — `plugin-obsidian/`

- esbuild scaffold (obsidian-sample-plugin layout). Obsidian plugins have full Node access — embed a small `http` server bound on the LAN.
- Settings tab:
  - Enable server / server status (Online/Offline, EADDRINUSE handling)
  - Port (default `8787`; avoid 8088 KOSync, 9090 breno5g)
  - Authorized device-token allowlist (one per line; show device names)
  - Target folder (default `KOReader/`)
  - Filename template (`{{author}} - {{title}}` sanitized)
  - Note template customization
- Per book payload: stable note key = hash of book file path (fallback hash of title+author). Create or update `KOReader/Author - Title.md` via vault API (instant indexing).
- Regeneration semantics:
  - Note content is derived state; rewrite deterministically each sync so deletions/edits on device propagate.
  - Protected manual block preserved across regenerations: `<!-- koNotes:manual --> … <!-- /koNotes:manual -->`.
  - No-op guard: payload hash in frontmatter; unchanged payload skips write (no vault churn).
- Notices: "Synced N ✔", errors shown via Obsidian `Notice`.

## Protocol v1 (versioned contract, both sides)

```
POST /kosync/v1/sync
Authorization: <device-token>        # allowlist in Obsidian settings
Content-Type: application/json
X-KoSync-Version: 1

{
  "device":   { "token": "...", "name": "Vivlio InkPad 4" },
  "book":     { "path": "/mnt/onboard/…", "title": "Fluent Forever",
                "author": "Gabriel Wyner", "pages": 352,
                "percent_finished": 0.62 },
  "annotations": [
    { "datetime": "…", "datetime_updated": null,
      "page": "24", "chapter": "Sound First",
      "text": "…", "note": null }
  ]
}
```

- Full payload each time = declaration of state (idempotent).
- Responses: 200 OK `{ "updated": true, "note": "KOReader/…​.md" }` · 401 unknown/missing token · 400 malformed.
- Plain HTTP is LAN-only (TLS on readers painful); auth via token allowlist. Document security caveats.

## Note format

```markdown
---
book: Fluent Forever
author: Gabriel Wyner
source: koreader://<book-path-hash>
pages: 352
percent_finished: 62
device: Vivlio InkPad 4
last_synced: 2026-10-27T20:11:00Z
payload_hash: <sha1>
kosync_version: 1
---
# Highlights — Fluent Forever
> Synced from KOReader · 42 highlights

## Sound First                       ← chapter sections
> [!quote] Page 24 · 2026-10-26      ← [!note] when user attached an annotation
> The highlight text

<!-- koNotes:manual -->
(protected user content survives regeneration)
<!-- /koNotes:manual -->
```

## Repo layout

```
koSync/                       (folder may keep name; visible naming is koNotes)
├── README.md
├── PROTOCOL.md               versioned JSON contract + note format spec
├── plugin-koreader/
│   ├── _meta.lua
│   ├── main.lua               Provider:register("exporter", "konotes", target)
│   ├── target.lua             export → serialize + POST (joplin.lua pattern)
│   ├── fixtures/              sample parsed booknotes JSON
│   └── spec/                  busted tests (payload shaping, escaping)
└── plugin-obsidian/
    ├── manifest.json
    ├── src/
    │   ├── main.ts            lifecycle, settings, server start/stop
    │   ├── server.ts          http listener, auth, routing, size limits
    │   ├── booknoteStore.ts   key lookup, create/update, manual block preserve
    │   ├── markdown.ts        annotations → callouts render
    │   └── settings.ts
    ├── fixtures/              payloads + expected markdown snapshots
    └── tests/                 vitest
```

## Milestones

1. **M0 — Protocol + fixtures**: sample parsed `booknotes` JSON → expected note markdown snapshots. Lock contract before code.
2. **M1 — Obsidian server MVP**: settings, listener, create/update notes, manual-block preservation. Testable with `curl` + fixtures — no device needed.
3. **M2 — KOReader target MVP**: Provider registration, config UI, Wi-Fi gating, POST. Busted unit tests for payload shaping. Requires resolving exporter-`base` access from a third-party plugin (vendored copy fallback, per `provider-old-exporters.koplugin` precedent).
4. **M3 — End-to-end**: KOReader macOS emulator if convenient, then sideload plugin on Vivlio, verify real LAN sync.
5. **M4 — Polish**: install zip + README, pages/percent metadata, optional sync-on-book-close, image highlights (`pboxes`) as stretch.

## Audience & delivery framing (confirmed 2026-10-28)

Build **for the user first, then the community**. Practical consequences:

- Scope discipline: no template engine, pairing flow, or format zoo in v1 — only what daily use demands.
- Success metric v1.0: *the user's own Vivlio → Obsidian flow is correct enough to trust blindly* (deletions propagate, no data loss).
- Community polish is deliberately deferred to M5.

**M5 — Community delivery (post-1.0, once dogfooded):**
1. Stabilize protocol; publish `PROTOCOL.md` so others can build targets.
2. Obsidian side: follow community plugin review guidelines (no eval, server lifecycle hygiene, graceful port-conflict handling) and submit to the community store. Precedent: Local REST API plugin.
3. KOReader side: consider contributing as `provider-konotes.koplugin` upstream (or to `koreader/contrib`) following `provider-old-exporters.koplugin` precedent.
4. README with screenshots, Vivlio/PocketBook quickstart, known caveats section.
5. Template engine, pairing/PIN flow, image-highlight support — promote from stretch to backlog based on reported demand.

## Risks / caveats

- Obsidian server only receives syncs while Obsidian desktop runs on the same network → keep manual "Sync now" as primary UX.
- Plain HTTP on LAN; token allowlist mitigates; not for untrusted networks.
- PocketBook on-device keyboard makes typing host/token tedious — v1 manual entry; future "pairing" flow (PIN exchange) possible.
- Device clock skew — timestamps advisory only.
- Exporter `base` module access from third-party plugin: minor shim; vendor if needed.
- Obsidian community plugin submission (optional later): precedent exists (Local REST API plugin).

*Plan written 2026-10-27. Next step when switching out of plan mode: M0 + M1 (Obsidian side first, testable with curl).*
