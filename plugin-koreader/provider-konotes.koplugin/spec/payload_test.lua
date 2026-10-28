-- Standalone test for payload.lua (no KOReader required):
--   lua spec/payload_test.lua
-- Mirrors the booknotes shape produced by exporter.koplugin/clip.lua, whose
-- documented structure is:
--   clippings[title] = { file=..., title=..., author=..., number_of_pages=...,
--                        { { clipping } }, { { clipping } }, ... }

local Payload = require("payload")

local asserts, failures = 0, 0
local function check(cond, message)
    asserts = asserts + 1
    if not cond then
        failures = failures + 1
        print("FAIL: " .. tostring(message))
    end
end

math.randomseed(42)

-- ---- basic book with clippings of each supported shape ----
local now = os.time({ year = 2026, month = 10, day = 26, hour = 21, min = 3, sec = 11 })
local now2 = os.time({ year = 2026, month = 10, day = 27, hour = 10, min = 2, sec = 0 })

local booknotes = {
    file = "/mnt/onboard/books/fluent_forever.epub",
    title = "Fluent Forever",
    author = "Gabriel Wyner",
    number_of_pages = 352,
    -- plain highlight
    { { page = 24, time = now, text = "  The sound of a word, first spoken out loud.  ", sort = "highlight" } },
    -- highlight with a user note
    { { page = 27, time = now, text = "Second highlight text.", note = "Persistence beats intensity.", sort = "highlight" } },
    -- note-only clipping (empty text, note kept)
    { { page = 36, time = now2, text = "", note = "Question for ch. 2.", sort = "highlight" } },
    -- image ("drawer") highlight → skipped as unsupported in v1
    { { page = 42, time = now2, text = "", sort = "highlight", image = { png = "PNGDATA", hash = "hash" } } },
    -- fully-empty clipping → skipped
    { { page = 43, time = now2, text = "", note = "", sort = "highlight" } },
    -- whitespace-only highlight with no note → skipped
    { { page = 44, time = now2, text = "    ", sort = "highlight" } },
    -- chapter metadata (string) preserved, and trimmed
    { { page = 108, time = now2, text = "Their tastes are similar...", chapter = "  The Deep Bore  " } },
    -- numeric chapter preserved (paged docs)
    { { page = 200, time = now2, text = "Table annotation.", chapter = 9 } },
}

local payload, skipped = Payload.fromBooknotes(booknotes, "Vivlio InkPad 4")

check(skipped == 3, "skipped count (image + empty + whitespace-only), got " .. tostring(skipped))

check(payload.device.name == "Vivlio InkPad 4", "device name")
check(payload.book.path == "/mnt/onboard/books/fluent_forever.epub", "book path")
check(payload.book.title == "Fluent Forever", "book title")
check(payload.book.author == "Gabriel Wyner", "book author")
check(payload.book.pages == 352, "book pages")

check(#payload.annotations == 5, "annotation count, got " .. tostring(#payload.annotations))

local a1 = payload.annotations[1]
check(a1.datetime == "2026-10-26T21:03:11", "datetime rendered from clipping.time (device-local), got " .. tostring(a1.datetime))
check(a1.page == 24, "page passthrough")
check(a1.text == "The sound of a word, first spoken out loud.", "text trimmed")
check(a1.note == nil, "no note field added when absent")
check(a1.chapter == nil, "no chapter field added when absent")

local a2 = payload.annotations[2]
check(a2.note == "Persistence beats intensity.", "note passthrough")

local a3 = payload.annotations[3]
check(a3.text == "", "note-only clipping keeps empty text")
check(a3.note == "Question for ch. 2.", "note-only kept")

local a4 = payload.annotations[4]
check(a4.chapter == "The Deep Bore", "string chapter trimmed")
local a5 = payload.annotations[5]
check(a5.chapter == 9, "numeric chapter passthrough")

-- ---- book from Kindle "My Clippings" has no file path: stable synthetic path ----
local payload2 = Payload.fromBooknotes({
    title = "An Imported Book",
    author = "Somebody",
    [1] = { { page = "7", time = now, text = "Hi there." } },
}, "Vivlio InkPad 4")
check(payload2.book.path == "myclippings/An Imported Book", "synthetic path for bookless clippings, got " .. tostring(payload2.book.path))

-- ---- regression: crash.log 2026-10-28 — author doc props separated by "\n" ----
local payload4 = Payload.fromBooknotes({
    file = "/books/ddia.epub",
    title = "DDIA",
    author = "Martin Kleppmann\nChris Riccomini",
    [1] = { { page = 10, time = now, text = "There are hundreds of databases to choose from." } },
}, "PBVerseProColor")
check(payload4.book.author == "Martin Kleppmann, Chris Riccomini", "multi-author newline normalized, got " .. tostring(payload4.book.author))
local payload4b = Payload.fromBooknotes({
    file = "/books/x.epub", title = "X", author = "Solo Author\n", [1] = { { page = 1, text = "hello", time = now } },
}, "Vivlio InkPad 4")
check(payload4b.book.author == "Solo Author", "trailing author newline dropped, got " .. tostring(payload4b.book.author))

-- ---- regression: crash.log 2026-10-28 — empty annotations must stay a JSON array ----
local deleted = { file = "/books/ddia.epub", title = "DDIA", author = "Martin Kleppmann" }
local payload4d, newskipped = Payload.fromBooknotes(deleted, "PBVerseProColor")
check(type(payload4d.annotations) == "table" and #payload4d.annotations == 0, "deleted-all book yields empty annotations")
check(getmetatable(payload4d.annotations) ~= nil and getmetatable(payload4d.annotations).__jsontype == "array",
    "annotations tagged as JSON array for rapidjson")
check(newskipped == 0, "empty book skipped count 0, got " .. tostring(newskipped))
-- non-empty case must carry the metatable too (rapidjson honours it on every path)
check(getmetatable(payload.annotations) ~= nil and getmetatable(payload.annotations).__jsontype == "array",
    "non-empty annotations also tagged as array")

-- ---- regression: crash.log 2026-10-28 — mixed separators collapse cleanly ----
local payload5 = Payload.fromBooknotes({
    file = "/books/x.epub", title = "X", author = "A\r\nB", [1] = { { page = 1, text = "hello", time = now } },
}, "Vivlio InkPad 4")
check(payload5.book.author == "A, B", "CRLF author separator normalized, got " .. tostring(payload5.book.author))
local payload3 = Payload.fromBooknotes({
    file = "/books/x.epub", title = "X", author = "", [1] = { { page = 1, text = "hello" } },
}, "Vivlio InkPad 4")
check(type(payload3.annotations[1].datetime) == "string" and payload3.annotations[1].datetime:match("^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d$") ~= nil,
    "datetime format fallback")

print(("payload tests: %d checks, %d failures"):format(asserts, failures))
if failures > 0 then os.exit(1) end
print("OK")
