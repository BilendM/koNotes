local Provider = require("provider")
local WidgetContainer = require("ui/widget/container/widgetcontainer")

local KonotesExporter = require("target")

local KonotesProvider = WidgetContainer:extend {
    name = "provider-konotes",
    is_doc_only = false,
}

function KonotesProvider:init()
    if not Provider:register("exporter", "konotes", KonotesExporter) then
        require("logger").warn("koNotes: failed to register exporter provider")
    end
end

return KonotesProvider
