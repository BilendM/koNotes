# koNotes Sync Protocol v1.1

Both koNotes halves speak this contract. Changes must bump the version.

## Changelog

- **v1.1** — adds UDP discovery and HTTP pairing (both optional; manual
  host/port/token configuration of v1 keeps working unchanged). The `sync`
  endpoint itself is byte-for-byte identical to v1.
- **v1** — initial contract.

## Transport

- Plain HTTP on the local network (TLS is impractical on e-readers; auth is by shared token). Do not use over untrusted networks.
- Obsidian binds an IPv4 HTTP server on `0.0.0.0:<port>` (default `8787`).
- Character encoding: UTF-8. Body format: JSON.

## Discovery (UDP, optional, v1.1)

Lets an unconfigured (or DHCP-broken) reader find the running koNotes server without typing an IP.

- The Obsidian plugin keeps a UDP socket bound to `0.0.0.0:41838` (-background-free: only while the HTTP server runs).
- The reader **broadcasts one datagram** on port 41838 and waits up to a few seconds for an unicast reply:

```json
{"konotes": "discover", "id": "17853"}
```

- The server replies **from its UDP socket to the sender's address**:

```json
{ "konotes": "offer", "id": "17853", "name": "my vault", "port": 8787 }
```

- `id` is echoed so stale replies can be ignored; `port` is the HTTP (TCP) port; the reply's source IP is the server address (the offer carries no `host` — the reader uses the sender's address).
- Exactly one broadcast per manual export / test / pairing flow — never periodic, never in the background. If no offer arrives, the reader falls back to its manually configured host/port.

## Pairing (v1.1)

Replaces hand-typing of long tokens. HTTP, no auth for step 1 (it only accepts a code a human is currently displaying inside Obsidian), token output for step 2.

### Precondition

The user started **Pair a device** in the koNotes settings. The plugin then holds one active session:

```json
{ "code": "413 269", "expiresAt": "2026-10-28T13:05:00Z", "attemptsLeft": 5 }
```

- The code is 6 digits, valid **5 minutes**, and accepts at most **5 wrong attempts** before the session is invalidated (must be restarted).
- Only one session at a time.

### `POST /kosync/v1/pair/confirm`

Body:

```json
{ "code": "413269", "name": "PBVerseProColor" }
```

| Status | Meaning |
|---|---|
| `200` | `{"ok":true,"token":"kn_\u2026"}` — a new long random token, already registered server-side with `name` as the device label |
| `400` | Malformed body |
| `403` | Wrong code, expired, or attempts exhausted (`{"ok":false,"error":"pairing code invalid or expired"}`) |

The reader immediately stores the token and does not show it again. Revocation happens in the Obsidian settings (paired device list → delete token).

## Endpoints

### `GET /kosync/v1/ping`

For the KOReader plugin's config dialog to verify reachability before exporting.

Response `200`:

```json
{ "ok": true, "plugin": "koNotes", "version": 1 }
```

No authorization required.

### `POST /kosync/v1/sync`

**Headers**

| Header | Required | Meaning |
|---|---|---|
| `Authorization` | yes | Device token, exactly as configured in Obsidian. Raw value, or `Bearer <token>`. |
| `Content-Type` | yes | `application/json` |

**Body**

```json
{
  "device": {
    "name": "Vivlio InkPad 4"
  },
  "book": {
    "path": "/mnt/onboard/books/fluent_forever.epub",
    "title": "Fluent Forever",
    "author": "Gabriel Wyner",
    "pages": 352,
    "percent_finished": 0.62
  },
  "annotations": [
    {
      "datetime": "2026-10-26T21:03:11",
      "datetime_updated": null,
      "page": "24",
      "chapter": "Sound First",
      "text": "The sound of a word, first spoken out loud...",
      "note": null
    },
    {
      "datetime": "2026-10-27T10:02:00",
      "datetime_updated": "2026-10-27T10:04:00",
      "page": "108",
      "chapter": "The Deep Bore",
      "text": "Their tastes are similar...",
      "note": "Compare with …"
    }
  ]
}
```

Field rules:

- `book.path` is the reader-local absolute path. It is hashed into the note's stable identity (`source` frontmatter). Renaming the file on the reader creates a new note.
- `book.title` and `book.author` are non-empty strings; `author` may be `""` (falls back to title-only filename).
- `book.pages` is an integer ≥ 0; `book.percent_finished` is 0…1.
- `annotations` is ordered by reading position (the device's own order is preserved).
- Each annotation: `datetime` ISO-ish local device time; `page` string or number; `chapter` optional; `text` may be `""` (bookmark/image placeholder); `note` is the user's annotation text or `null`; `datetime_updated` optional.

**Semantics**

The payload is a **declaration of state**: the note is regenerated from the full `annotations` list on every sync. Therefore:

- Adding/remove/editing annotations on the device is reflected in Obsidian.
- Manually added Obsidian content survives only inside the `<!-- koNotes:manual --> … <!-- /koNotes:manual -->` block.
- If the rendered content would be byte-identical to what is on disk (checked via `payload_hash` in the note's frontmatter), Obsidian writes nothing and answers `unchanged`.

**Responses**

| Status | Meaning |
|---|---|
| `200` | `{"ok":true,"action":"created"\|"updated"\|"unchanged","note":"KOReader/Author - Title.md","highlights":42}` |
| `400` | Body is not valid JSON |
| `401` | Missing/unknown token |
| `404` | Unknown path |
| `405` | Wrong method (includes `Allow`) |
| `413` | Body larger than 10 MB |
| `422` | Structurally invalid payload (Field rules violated) |
| `500` | Vault write error |

**Note file**

- Location: `<folder>/<author> - <title>.md` (template configurable), `KOReader/` by default.
- The note is found by first trying the expected filename, then by scanning the folder for a note whose frontmatter `source` equals the book's key — so renaming the note file in Obsidian re-resolves instead of duplicating.

## Security notes

- Token = a random opaque string configured identically on Obsidian and reader. Fine for a home LAN; not for hostile networks.
- Pairing's short-lived 6-digit code is a LAN-local password: brute-forcing it on the LAN is bounded by the 5-attempt / 5-minute window. Confirm endpoint refuses when no session is active, so disable pairing between pairings.
- The server is an editor with write access to your vault, gated only by tokens; disable the server when not syncing.

## Vault-local behavior (not on the wire)

These are Obsidian-side conventions that don't change the payload:

- **Title/author overrides.** A note's frontmatter may carry `title_override` / `author_override`; when present they replace the payload's `book.title` / `book.author` for the H1, author line and filename. The raw values stay visible as `book` / `author`. Overrides are preserved across regeneration and never affect `payload_hash`.
- **Auto-sync (device side).** After a successful sync the reader keeps an md5 of the encoded payload per book; on book close it re-exports only if the payload would differ AND Wi-Fi is already on. It never enables Wi-Fi and never shows UI.
