# koNotes Sync Protocol v1

Both koNotes halves speak this contract. Changes must bump the version.

## Transport

- Plain HTTP on the local network (TLS is impractical on e-readers; auth is by shared token). Do not use over untrusted networks.
- Obsidian binds an IPv4 HTTP server on `0.0.0.0:<port>` (default `8787`).
- Character encoding: UTF-8. Body format: JSON.

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
- The server is an editor with write access to your vault, gated only by tokens; disable the server when not syncing.
