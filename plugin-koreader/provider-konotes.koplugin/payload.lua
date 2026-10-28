-- Builds the koNotes sync payload (PROTOCOL.md v1) from parsed booknotes,
-- as produced by exporter.koplugin/clip.lua.
--
-- No KOReader dependencies on purpose: this logic is exercised standalone by
-- spec/payload_test.lua. All user-facing strings live in target.lua.

local Payload = {}

local function stringOf(v)
    if type(v) == "string" then return v end
    return nil
end

-- Same trim as clip.lua:getText
local function trim(v)
    if type(v) ~= "string" then return "" end
    return v:match("^%s*(.-)%s*$") or ""
end

-- device-local wall-clock time (clipping.time comes from os.time(); os.date
-- renders it back in the same timezone, no suffix — see PROTOCOL.md)
local function datetimeOf(clipping)
    local t = math.floor(tonumber(clipping.time) or os.time())
    return os.date("%Y-%m-%dT%H:%M:%S", t)
end

local function chapterOf(clipping)
    local chapter = clipping.chapter
    local kind = type(chapter)
    if kind == "string" then
        chapter = trim(chapter)
        if chapter ~= "" then return chapter end
    elseif kind == "number" then
        return chapter
    end
    return nil
end

-- v1 skips image ("drawer") highlights and empty marks; they cannot be
-- represented in PROTOCOL.md v1 and full-regeneration must not send flaky
-- placeholders (deleting such an annotation must also delete it in Obsidian).
local function skip(clipping, text, note)
    if clipping.image then return true end
    return text == "" and note == nil
end

function Payload.fromBooknotes(booknotes, device_name)
    -- __jsontype = "array": rapidjson must encode this as a JSON array even when
    -- empty (a Lua empty table is otherwise serialized as an object, which
    -- Obsidian's validator rejects — the exact failure when every highlight
    -- of a book has just been deleted).
    local annotations = setmetatable({}, { __jsontype = "array" })
    local skipped = 0

    for _, entry in ipairs(booknotes) do
        for _, clipping in ipairs(entry) do
            local text = trim(clipping.text)
            local note = clipping.note
            if trim(note) == "" then note = nil end
            if skip(clipping, text, note) then
                skipped = skipped + 1
            else
                local annotation = {
                    datetime = datetimeOf(clipping),
                    page = clipping.page,
                    text = text,
                }
                if note ~= nil then annotation.note = note end
                local chapter = chapterOf(clipping)
                if chapter ~= nil then annotation.chapter = chapter end
                table.insert(annotations, annotation)
            end
        end
    end

    -- KOReader separates multi-author doc props with newlines; upper user cases
    -- end with an extraneous newline (hence trim *before* separator), and a
    -- single comma-separated line keeps frontmatter/YAML-safe rendering.
    local author = trim(booknotes.author):gsub("[\r\n]+", ", "):gsub("%s+", " ")
    local book = {
        path = booknotes.file or ("myclippings/" .. tostring(booknotes.title or "unknown")),
        title = tostring(booknotes.title or "Unknown Book"),
        author = author,
    }
    if type(booknotes.number_of_pages) == "number" then
        book.pages = booknotes.number_of_pages
    end

    return {
        device = { name = device_name },
        book = book,
        annotations = annotations,
    }, skipped
end

return Payload
