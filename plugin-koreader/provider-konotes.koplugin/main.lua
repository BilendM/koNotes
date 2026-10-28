-- koNotes provider plugin (KOReader side).
-- Registers the "konotes" exporter target (manual export flow) and adds
-- v1.1 behavior: auto-sync on book close + a dispatcher "sync now" action.
-- Auto-sync is silent & conditional: only fires when Wi-Fi is already on,
-- never prompts, never enables the radio, and skips unchanged books by hash.
local Provider = require("provider")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local Dispatcher = require("dispatcher")
local NetworkMgr = require("ui/network/manager")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local md5 = require("ffi/sha2").md5
local rapidjson = require("rapidjson")
local _ = require("gettext")

local KonotesExporter = require("target")
local Payload = require("payload")

local KonotesProvider = WidgetContainer:extend {
    name = "provider-konotes",
    is_doc_only = true, -- no filemanager instance needed; reader gets auto-sync hooks
}

function KonotesProvider:init()
    Provider:register("exporter", "konotes", KonotesExporter)
    self:onDispatcherRegisterActions()
end

function KonotesProvider:onDispatcherRegisterActions()
    Dispatcher:registerAction("konotes_sync_now", {
        category = "none",
        event = "KonotesSyncNow",
        title = _("Sync highlights to Obsidian (koNotes)"),
        reader = true,
    })
end

-- -- target's settings live in G_reader_settings.exporter.konotes (same table --)
local function targetConfigured(target)
    return target and target:isEnabled() and target:isReadyToExport()
end

-- Parses the currently open book the same way the built-in exporter does.
-- Gracefully degrades to doc_props for the empty case (deletion propagation).
local function currentBooknotes(ui)
    local exporter = ui and ui["exporter"]
    if not (exporter and exporter.parser) then return nil end
    if ui.document == nil then return nil end
    ui.annotation:updatePageNumbers(true)
    local clippings = exporter.parser:parseCurrentDoc()
    for _title, booknotes in pairs(clippings) do
        return booknotes
    end
    -- zero annotations left in the doc (or parser refused): synchronize emptiness
    local props = ui.doc_props or {}
    local file = ui.document.file
    local base = file and file:match("^.*/(.*)$") or "Untitled"
    local title = props.title or (base:match("^(.*)%.") or base)
    return { file = file, title = title, author = props.author or "" }
end

-- Shared sync path: hash-guarded, silent except for an optional notice.
function KonotesProvider:syncCurrentBook(notify)
    local target = KonotesExporter
    if not targetConfigured(target) then return end
    if not NetworkMgr:isOnline() then return end

    local ok, booknotes = pcall(currentBooknotes, self.ui)
    if not ok or booknotes == nil then
        logger.dbg("koNotes: auto-sync skipped — no current book parsed")
        return
    end

    -- change detection: md5 of the exact JSON we would send, keyed by book path
    local ok_h, payload = pcall(Payload.fromBooknotes, booknotes, target:getDeviceName())
    if not ok_h then
        logger.warn("koNotes: auto-sync payload build failed", payload)
        return
    end
    local ok_e, encoded = pcall(rapidjson.encode, payload)
    if not ok_e or not encoded then
        logger.warn("koNotes: auto-sync encode failed", encoded)
        return
    end
    local hash = md5(encoded)
    target.settings.synced_hashes = target.settings.synced_hashes or {}
    local hashes = target.settings.synced_hashes
    if hashes[payload.book.path] == hash then
        logger.dbg("koNotes: book unchanged, no sync needed")
        return
    end

    local sent, err = target:exportBooknotes(booknotes)
    if sent then
        hashes[payload.book.path] = hash
        target:saveSettings()
        if notify then
            UIManager:show(InfoMessage:new {
                text = _("koNotes: this book was synced to Obsidian."),
                timeout = 2,
            })
        end
        logger.dbg("koNotes: auto-synced", payload.book.path)
    else
        -- silent on failure by design: next close (or manual export) retries
        logger.warn("koNotes: auto-sync failed", err)
    end
end

-- Dispatcher action: user-bound gesture/menu → explicit one-tap sync.
function KonotesProvider:onKonotesSyncNow()
    self:syncCurrentBook(true)
end

-- Book close: sync if annotations changed since last sync (and Wi-Fi was on).
-- Honors the per-target opt-out; the explicit "Sync now" action ignores it.
function KonotesProvider:onCloseDocument()
    if KonotesExporter.settings.auto_sync == false then
        return
    end
    self:syncCurrentBook(false)
end

return KonotesProvider
