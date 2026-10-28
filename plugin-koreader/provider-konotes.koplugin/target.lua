-- koNotes exporter target: pushes parsed booknotes to the koNotes Obsidian plugin
-- (PROTOCOL.md v1.1). Modeled on exporter.koplugin targets joplin.lua and the
-- flomo.lua pattern from the upstream provider example.
--
-- v1.1 adds: UDP discovery (no more typing IPs), 6-digit pairing (no more typing
-- tokens), and a silent mode for auto-sync on book close.
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

local DISCOVERY_PORT = 41838
local DISCOVERY_TIMEOUT = 2 -- seconds listening for an offer

-- BaseExporter lives in exporter.koplugin and resolves to its base.lua via
-- KOReader's plugin package.path injection (same mechanism as flomo/memos).
local KonotesExporter = require("base"):new {
    name = "konotes",
    title = _("Obsidian (koNotes)"),
    is_remote = true,
    version = "1.1.0",
    help_text = _([[Syncs reading highlights to the koNotes plugin in Obsidian.

In Obsidian: enable the koNotes sync server, then either
- "Pair with Obsidian…": type the 6-digit code Obsidian shows, or
- enter the computer's IP, server port and a device token manually.

See the koNotes plugin's PROTOCOL.md for details.]]),
}

-- ---- discovery ---------------------------------------------------------------

-- One broadcast; returns host, port or nil on silence. Never errors.
function KonotesExporter:discoverHost()
    local ok, host, port = pcall(function()
        local s = socket.udp()
        s:settimeout(0.5)
        s:setoption("broadcast", true)
        local id = tostring(math.random(10000, 99999))
        s:sendto(rapidjson.encode({ konotes = "discover", id = id }), "255.255.255.255", DISCOVERY_PORT)
        local deadline = socket.gettime() + DISCOVERY_TIMEOUT
        while socket.gettime() < deadline do
            s:settimeout(deadline - socket.gettime())
            local data, addr = s:receive()
            if data then
                local offer = rapidjson.decode(data)
                if type(offer) == "table" and offer.konotes == "offer" and offer.id == id
                        and type(offer.port) == "number" and addr then
                    s:close()
                    return addr, offer.port
                end
            end
        end
        s:close()
        return nil
    end)
    if not ok then
        logger.warn("koNotes: discovery failed", host)
        return nil
    end
    if host then
        logger.dbg("koNotes: discovered", host, port)
    end
    return host, port
end

-- ---- pairing -----------------------------------------------------------------

function KonotesExporter:doPair(code_input)
    local code = (code_input or ""):gsub("%s", "")
    if #code ~= 6 or not code:match("^%d-$") then
        UIManager:show(InfoMessage:new {
            text = _("koNotes: enter the 6-digit code shown in Obsidian."),
        })
        return
    end
    local host, port = self:discoverHost()
    if not host then
        UIManager:show(InfoMessage:new {
            text = _("koNotes: no server answered. Open Obsidian's koNotes settings, start 'Pair device', and check both devices are on the same Wi-Fi."),
        })
        return
    end
    local url = string.format("http://%s:%s", host, tostring(port))
    local response, err = self:makeJsonRequest(url .. "/kosync/v1/pair/confirm", "POST", {
        code = code,
        name = self:getDeviceName(),
    })
    if response == nil or response.ok ~= true or type(response.token) ~= "string" then
        local message = response ~= nil and response.error or err or "pairing failed"
        UIManager:show(InfoMessage:new {
            text = T(_("koNotes: pairing rejected — %1\nStart 'Pair device' again in Obsidian to get a new code."), tostring(message)),
        })
        return
    end
    self.settings.host = host -- pairing pins the setup; discovery covers later IP changes too
    self.settings.port = tostring(port)
    self.settings.token = response.token
    self:saveSettings()
    UIManager:show(InfoMessage:new {
        text = T(_("koNotes: paired with %1.\nHighlights sync to your vault whenever you export — device token no longer needed."), url),
    })
end

function KonotesExporter:genPairMenuItem()
    return {
        text = _("Pair with Obsidian…"),
        keep_menu_open = true,
        callback = function()
            local dialog
            dialog = InputDialog:new {
                title = _("Pair with Obsidian"),
                description = _("Open Obsidian → koNotes settings → 'Pair device', then type the shown 6-digit code."),
                input = "",
                hint = "000000",
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
                            text = _("Pair"),
                            is_enter_default = true,
                            callback = function()
                                local input = dialog:getInputText()
                                UIManager:close(dialog)
                                self:doPair(input)
                            end,
                        },
                    },
                },
            }
            UIManager:show(dialog)
            dialog:onShowKeyboard()
        end,
    }
end

-- ---- config menu (manual fallback still fully supported) ---------------------

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
            self:genPairMenuItem(),
            {
                text = _("Auto-sync on book close"),
                checked_func = function()
                    return self.settings.auto_sync ~= nil and self.settings.auto_sync ~= false
                end,
                keep_menu_open = true,
                callback = function()
                    self.settings.auto_sync = not self.settings.auto_sync
                    self:saveSettings()
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

-- ---- sync --------------------------------------------------------------------

-- IP is the manually configured one; otherwise one discovery broadcast takes over.
function KonotesExporter:baseURL()
    if self.settings.host and self.settings.host ~= "" and self.settings.port and self.settings.port ~= "" then
        return string.format("http://%s:%s", self.settings.host, self.settings.port)
    end
    local host, port = self:discoverHost()
    if host then
        return string.format("http://%s:%s", host, tostring(port))
    end
    return nil
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

-- Exports one parsed booknotes table; no dialogs — used by auto-sync on close.
-- Caller must have checked isReadyToExport(); returns ok, error.
function KonotesExporter:exportBooknotes(booknotes)
    if not NetworkMgr:isOnline() then return false, "offline" end
    local base_url = self:baseURL()
    if not base_url then return false, "server unreachable (no config, no discovery offer)" end
    local payload = Payload.fromBooknotes(booknotes, self:getDeviceName())
    return self:postBook(base_url, payload)
end

function KonotesExporter:export(t)
    return self:exportWithOptions(t, nil)
end

function KonotesExporter:exportWithOptions(t, opts)
    opts = opts or {}
    local silent = opts.silent == true

    if not self:isReadyToExport() then
        if not silent then
            UIManager:show(InfoMessage:new {
                text = _("koNotes: not configured. Use 'Pair with Obsidian…', or set IP, port and token."),
            })
        end
        return false
    end

    if not NetworkMgr:isOnline() then
        if not silent then
            UIManager:show(InfoMessage:new {
                text = _("koNotes: Wi-Fi is off. Turn it on and export again."),
            })
        end
        return false
    end

    local base_url = self:baseURL()
    if not base_url then
        if not silent then
            UIManager:show(InfoMessage:new {
                text = _("koNotes server not reachable. Run 'Test connection' or 'Pair with Obsidian…'."),
            })
        end
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

    if silent then
        if #failures > 0 then
            for _i, message in ipairs(failures) do
                logger.warn("koNotes auto-sync failed book:", message)
            end
        end
        return #failures == 0
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
