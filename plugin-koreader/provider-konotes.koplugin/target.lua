-- koNotes exporter target: pushes parsed booknotes to the koNotes Obsidian
-- plugin (PROTOCOL.md v1). Modeled on exporter.koplugin targets joplin.lua
-- and the flomo.lua pattern from the upstream provider example.
--
-- Requires KOReader >= 2025.04 (Provider API + third-party exporter fixes).

local InputDialog = require("ui/widget/inputdialog")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local NetworkMgr = require("ui/network/manager")
local Device = require("device")
local logger = require("logger")
local http = require("socket.http")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")
local rapidjson = require("rapidjson")
local _ = require("gettext")
local T = require("ffi/util").template

local Payload = require("payload")

-- BaseExporter lives in exporter.koplugin and resolves to its base.lua via
-- KOReader's plugin package.path injection (same mechanism as flomo/memos).
local KonotesExporter = require("base"):new {
    name = "konotes",
    title = _("Obsidian (koNotes)"),
    is_remote = true,
    version = "0.1.0",
    help_text = _([[Syncs reading highlights to the koNotes plugin in Obsidian.

In Obsidian: enable the koNotes sync server, add a device token, and note
your computer's IP and the server port. Enter them here.

See https://github.com/koreader/koreader/wiki for provisioning details.]]),
}

function KonotesExporter:isReadyToExport()
    return self.settings.host ~= nil and self.settings.host ~= ""
        and self.settings.port ~= nil and self.settings.port ~= ""
        and self.settings.token ~= nil and self.settings.token ~= ""
end

function KonotesExporter:setDialog(field, title)
    local dialog
    dialog = InputDialog:new {
        title = title,
        input = self.settings[field],
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    is_enter_default = true,
                    callback = function()
                        self.settings[field] = dialog:getInputText()
                        self:saveSettings()
                        UIManager:close(dialog)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function KonotesExporter:getMenuTable()
    return {
        text = _("Obsidian (koNotes)"),
        checked_func = function()
            return self:isEnabled()
        end,
        sub_item_table = {
            {
                text = _("Export to Obsidian"),
                checked_func = function()
                    return self:isEnabled()
                end,
                callback = function()
                    self:toggleEnabled()
                end,
            },
            {
                text = _("Set computer address (IP)"),
                keep_menu_open = true,
                callback = function()
                    self:setDialog("host", _("IP address of the computer running Obsidian"))
                end,
            },
            {
                text = _("Set server port"),
                keep_menu_open = true,
                callback = function()
                    self:setDialog("port", _("koNotes server port (default 8787)"))
                end,
            },
            {
                text = _("Set device token"),
                keep_menu_open = true,
                callback = function()
                    self:setDialog("token", _("Token from Obsidian → Settings → koNotes"))
                end,
            },
            {
                text = _("Test connection"),
                keep_menu_open = true,
                callback = function()
                    local address = string.format("http://%s:%s/kosync/v1/ping",
                        self.settings.host or "?", self.settings.port or "?")
                    if self:ping(address) then
                        UIManager:show(InfoMessage:new {
                            text = T(_("koNotes server reachable at %1"), address),
                        })
                    else
                        UIManager:show(InfoMessage:new {
                            text = T(_("koNotes server NOT reachable at %1.\n\nCheck: Obsidian is running, koNotes server is enabled, IP/port are correct, both devices are on the same Wi-Fi."), address),
                        })
                    end
                end,
            },
        },
    }
end

local function ping(url)
    local sink = {}
    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local code, _, status = socket.skip(1, http.request {
        url = url,
        method = "GET",
        sink = ltn12.sink.table(sink),
    })
    socketutil:reset_timeout()
    if code ~= 200 then
        logger.dbg("koNotes: ping failed", status or code or "network unreachable")
        return false
    end
    return (table.concat(sink or {}) or ""):find("koNotes") ~= nil
end

-- expose ping as method for stubbing in the target menu above
function KonotesExporter:ping(url_)
    return ping(url_)
end

function KonotesExporter:postBook(base_url, payload)
    local headers = { Authorization = self.settings.token }
    local response, err = self:makeJsonRequest(base_url .. "/kosync/v1/sync", "POST", payload, headers)
    if not response then
        logger.warn("koNotes: sync request failed", err)
        return false, err
    end
    if response.ok ~= true then
        local message = response.error or "unexpected server response"
        logger.warn("koNotes: server rejected payload", message)
        return false, message
    end
    logger.dbg("koNotes: server response", rapidjson.encode(response))
    return true, response
end

function KonotesExporter:export(t)
    if not self:isReadyToExport() then
        UIManager:show(InfoMessage:new {
            text = _("koNotes: set the computer address, port and token first."),
        })
        return false
    end

    if not NetworkMgr:isOnline() then
        UIManager:show(InfoMessage:new {
            text = _("koNotes: Wi-Fi is off. Turn it on and export again."),
        })
        return false
    end

    local base_url = string.format("http://%s:%s", self.settings.host, self.settings.port)
    if not self:ping(base_url .. "/kosync/v1/ping") then
        UIManager:show(InfoMessage:new {
            text = _("koNotes server not reachable. Run 'Test connection' in the koNotes menu for details."),
        })
        return false
    end

    local exported = 0
    local unsupported = 0
    local failures = {}
    -- NOTE: never name a loop variable "_": it shadows gettext's `_` and the
    -- next gettext call inside the loop crashes (seen as
    -- "attempt to call local '_' (a number value)" in crash.log).
    for _bookno, booknotes in ipairs(t) do
        local payload, skipped = Payload.fromBooknotes(booknotes, self:getDeviceName())
        unsupported = unsupported + (skipped or 0)
        local ok, err = self:postBook(base_url, payload)
        if ok then
            exported = exported + 1
        else
            table.insert(failures, T(_("%1 (%2)"), tostring(booknotes.title or "unknown book"), tostring(err)))
        end
    end

    if #failures == 0 then
        local message = T(_("koNotes: %1 of %2 books synced successfully."), exported, #t)
        if unsupported > 0 then
            message = message .. "\n" .. T(_("%1 unsupported marks were skipped (image highlights or empty)."), unsupported)
        end
        UIManager:show(InfoMessage:new { text = message })
        logger.dbg("koNotes: exported books:", exported, "unsupported marks skipped:", unsupported)
    else
        UIManager:show(InfoMessage:new {
            text = T(_("koNotes: %1 books synced, %2 failed.\n\nFailed:\n%3"), exported, #failures,
                table.concat(failures, "\n")),
        })
        for _i, message in ipairs(failures) do
            logger.warn("koNotes failed book:", message)
        end
    end
    return #failures == 0
end

function KonotesExporter:getDeviceName()
    return self.settings.device_name or Device.model or "KOReader"
end

return KonotesExporter
