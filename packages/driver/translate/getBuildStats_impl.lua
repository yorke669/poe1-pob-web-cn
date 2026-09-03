local function pobWebJsonEscape(value)
    return tostring(value):gsub('[%z\1-\31\\"]', function(char)
        local escapes = {
            ['\\'] = '\\\\',
            ['"'] = '\\"',
            ['\b'] = '\\b',
            ['\f'] = '\\f',
            ['\n'] = '\\n',
            ['\r'] = '\\r',
            ['\t'] = '\\t',
        }
        return escapes[char] or string.format('\\u%04x', char:byte())
    end)
end

local function pobWebJsonArray(value)
    return setmetatable(value, { __pobWebJsonType = "array" })
end

local function pobWebJsonEncode(value)
    local valueType = type(value)
    if valueType == "nil" then
        return "null"
    elseif valueType == "boolean" then
        return value and "true" or "false"
    elseif valueType == "number" then
        if value ~= value or value == math.huge or value == -math.huge then
            return "null"
        end
        return tostring(value)
    elseif valueType == "string" then
        return '"' .. pobWebJsonEscape(value) .. '"'
    elseif valueType == "table" then
        local meta = getmetatable(value)
        local forceArray = meta and meta.__pobWebJsonType == "array"
        local maxIndex = 0
        local count = 0
        local isArray = forceArray
        if not forceArray then
            isArray = true
            for key in pairs(value) do
                if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
                    isArray = false
                    break
                end
                if key > maxIndex then
                    maxIndex = key
                end
                count = count + 1
            end
            isArray = isArray and count == maxIndex and count > 0
        else
            maxIndex = #value
        end

        local parts = {}
        if isArray then
            for i = 1, maxIndex do
                parts[#parts + 1] = pobWebJsonEncode(value[i])
            end
            return "[" .. table.concat(parts, ",") .. "]"
        end

        for key, item in pairs(value) do
            parts[#parts + 1] = '"' .. pobWebJsonEscape(key) .. '":' .. pobWebJsonEncode(item)
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end

_G.getBuildStats_impl = function()
    local mainObject = GetMainObject()
    if not mainObject.main then
        error("getBuildStats: mainObject.main is nil")
    end

    local build = mainObject.main.modes["BUILD"]
    if not build then
        error("getBuildStats: not in BUILD mode")
    end

    local calcsTab = build.calcsTab
    if not calcsTab or not calcsTab.mainOutput then
        error("getBuildStats: calcsTab or mainOutput not available")
    end

    local mainOutput = calcsTab.mainOutput
    local stats = {}

    -- Collect displayStats (key attributes shown in PoB UI)
    if build.displayStats then
        for _, statData in ipairs(build.displayStats) do
            local statName = statData.stat
            if statName and mainOutput[statName] ~= nil then
                stats[statName] = mainOutput[statName]
            end
            -- Handle childStat (nested stats like SkillDPS)
            if statData.childStat and mainOutput[statData.childStat] then
                stats[statData.childStat] = mainOutput[statData.childStat]
            end
        end
    end

    -- Collect extraSaveStats (additional important stats)
    if build.extraSaveStats then
        for _, statData in ipairs(build.extraSaveStats) do
            local statName = statData.stat
            if statName and mainOutput[statName] ~= nil then
                stats[statName] = mainOutput[statName]
            end
        end
    end

    return pobWebJsonEncode(stats)
end

local function pobWebMatchFlags(reqFlags, notFlags, flags)
    flags = flags or {}
    if type(reqFlags) == "string" then
        reqFlags = { reqFlags }
    end
    if reqFlags then
        for _, flag in ipairs(reqFlags) do
            if not flags[flag] then
                return false
            end
        end
    end
    if type(notFlags) == "string" then
        notFlags = { notFlags }
    end
    if notFlags then
        for _, flag in ipairs(notFlags) do
            if flags[flag] then
                return false
            end
        end
    end
    return true
end

local function pobWebFormatNumber(value)
    local s = tostring(value)
    local sign = ""
    if s:sub(1, 1) == "+" or s:sub(1, 1) == "-" then
        sign = s:sub(1, 1)
        s = s:sub(2)
    end
    local integer, decimal = s:match("^(%d+)(%.%d+)$")
    if not integer then
        integer = s
        decimal = ""
    end
    local formatted = integer:reverse():gsub("(%d%d%d)", "%1,"):reverse():gsub("^,", "")
    return sign .. formatted .. decimal
end

local function pobWebTranslateLabel(label)
    if _G.__pobWebTranslate then
        local translated = _G.__pobWebTranslate(label)
        if translated and translated ~= label then
            return translated
        end
    end
    return label
end

local function pobWebCompareOutput(build, baseOutput, compareOutput, actor, statList)
    local changes = pobWebJsonArray({})
    local flags = actor and actor.mainSkill and actor.mainSkill.skillFlags or {}
    for _, statData in ipairs(statList or {}) do
        if statData.stat and pobWebMatchFlags(statData.flag, statData.notFlag, flags) and not statData.childStat and statData.stat ~= "SkillDPS" then
            local statVal1 = compareOutput[statData.stat] or 0
            local statVal2 = baseOutput[statData.stat] or 0
            local diff = statVal1 - statVal2
            if statData.stat == "FullDPS" and not compareOutput[statData.stat] then
                diff = 0
            end
            if (diff > 0.001 or diff < -0.001) and (not statData.condFunc or statData.condFunc(statVal1, compareOutput) or statData.condFunc(statVal2, baseOutput)) then
                local val = diff * ((statData.pc or statData.mod) and 100 or 1)
                local fmt = statData.fmt or ".0f"
                local valStr = string.format("%+" .. fmt, val)
                local number, suffix = valStr:match("^([%+%-]?%d+%.%d+)(%D*)$")
                if number then
                    valStr = number:gsub("0+$", ""):gsub("%.$", "") .. suffix
                end
                valStr = pobWebFormatNumber(valStr)
                local percent = nil
                local percentText = ""
                if statData.compPercent and statVal1 ~= 0 and statVal2 ~= 0 then
                    percent = statVal1 / statVal2 * 100 - 100
                    percentText = string.format(" (%+.1f%%)", percent)
                end
                local positive = (statData.lowerIsBetter and diff < 0) or ((not statData.lowerIsBetter) and diff > 0)
                local label = pobWebTranslateLabel(statData.label or statData.stat)
                table.insert(changes, {
                    stat = statData.stat,
                    label = label,
                    before = statVal2,
                    after = statVal1,
                    diff = val,
                    percent = percent,
                    positive = positive,
                    lowerIsBetter = statData.lowerIsBetter and true or false,
                    text = valStr .. " " .. label .. percentText,
                })
            end
        end
    end
    return changes
end

_G.getItemCompareStats_impl = function(slotName, itemRaw)
    local mainObject = GetMainObject()
    if not mainObject.main then
        error("getItemCompareStats: mainObject.main is nil")
    end
    local build = mainObject.main.modes["BUILD"]
    if not build then
        error("getItemCompareStats: not in BUILD mode")
    end
    if not slotName or slotName == "" then
        error("getItemCompareStats: slotName is required")
    end

    local itemsTab = build.itemsTab
    if not itemsTab or not itemsTab.slots or not itemsTab.slots[slotName] then
        error("getItemCompareStats: slot not found: " .. tostring(slotName))
    end
    if not build.calcsTab or not build.calcsTab.GetMiscCalculator then
        error("getItemCompareStats: calculator not available")
    end

    local repItem = nil
    local mode = "remove"
    if itemRaw and itemRaw ~= "" then
        repItem = new("Item", itemRaw)
        if not repItem or not repItem.base then
            error("getItemCompareStats: invalid item raw")
        end
        repItem:BuildAndParseRaw()
        mode = "replace"
    end

    local calcFunc, calcBase = build.calcsTab:GetMiscCalculator()
    local outputNew = calcFunc({ repSlotName = slotName, repItem = repItem })
    local actor = build.calcsTab.mainEnv and build.calcsTab.mainEnv.player
    local changes = pobWebCompareOutput(build, calcBase, outputNew, actor, build.displayStats)

    return pobWebJsonEncode({
        slotName = slotName,
        mode = mode,
        itemName = repItem and repItem.name or nil,
        changes = changes,
    })
end
