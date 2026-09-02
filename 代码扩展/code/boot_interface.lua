-- ============================================================
-- pob-web 接口层（入侵修改部分，最小化）
--
-- 本文件内容分两部分，插入 boot.lua 的不同位置：
--   Part A → 插入 boot.lua 第 142 行 dofile("Launch.lua") 之前
--   Part B → 追加到 boot.lua 文件末尾（getBuildCode() 之后）
--
-- 真正的实现在 translate_zh.lua / getBuildStats_impl.lua（独立维护）。
-- 改 boot.lua 后必须重新编译 wasm：mise run driver:build
-- ============================================================


-- ------------------------------------------------------------
-- Part A：插入 dofile("Launch.lua") 之前（第 142 行前）
--
-- 必须在 Launch 之前：翻译层要 hook DrawString / DrawStringWidth /
-- DrawStringCursorIndex，而 PoB 启动后就会开始绘制。
-- ------------------------------------------------------------
local translateOk, translateErr = pcall(require, "translate_zh")
if not translateOk then
    print("[translate] zh-rCN layer DISABLED: " .. tostring(translateErr))
end


-- ------------------------------------------------------------
-- Part A.1：插入 mainObject["OnInit"] 包装函数的 onInit(self) 之后
--
-- 必须在 launch:OnInit 执行完之后安装：此时 self.main 才存在。
-- ------------------------------------------------------------
-- self.main only exists after launch:OnInit has run, so this is the earliest
-- point where the WrapString wrapper can be installed.
if _G.installPobWebWrapStringHook then
    _G.installPobWebWrapStringHook(self.main)
end


-- ------------------------------------------------------------
-- Part B：追加到 boot.lua 文件末尾（getBuildCode() 函数之后）
--
-- 加载属性读取实现 + 声明供 C 层调用的接口函数。
-- getBuildStats_impl 只定义函数，运行时才调用 GetMainObject()，
-- 因此放在文件末尾不影响启动顺序。
-- ------------------------------------------------------------
local statsOk, statsErr = pcall(require, "getBuildStats_impl")
if not statsOk then
    print("[stats] getBuildStats_impl not loaded: " .. tostring(statsErr))
end

-- 接口函数声明：C 层 driver.c 通过 lua_getglobal 调用这两个名字
function getBuildStats()
    if _G.getBuildStats_impl then
        return _G.getBuildStats_impl()
    end
    error("getBuildStats implementation not loaded")
end

function getItemCompareStats(slotName, itemRaw)
    if _G.getItemCompareStats_impl then
        return _G.getItemCompareStats_impl(slotName, itemRaw)
    end
    error("getItemCompareStats implementation not loaded")
end
