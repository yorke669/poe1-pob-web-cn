# PoB 代码的解析与生成原理

> 分析对象：`PathOfBuildingCommunity/PathOfBuilding`（poe1，本仓库 `version.json` 当前 head 为 `v2.67.2`）+ 本仓库 pob-web 桥接层。
>
> 上游源码不在本仓库内，打包时由 `packages/packer/src/pack.ts` 从 GitHub `git clone --depth 1 --branch=<tag>` 拉取。因此本文对上游的说明以 tag `v2.67.2` 为准，并标注文件名；对本仓库的说明给出可跳转的路径与行号。

---

## 一、两类"代码"

PoB 里有两套互为逆操作的纯文本序列化：

| | 构筑码（Build Code / 分享码） | 物品文本（Item Raw） |
|---|---|---|
| 作用域 | 整个构筑 | 单个装备 |
| 载体 | XML → zlib → Base64 | 多行纯文本 |
| 生成 | `Build:SaveDB()` | `Item:BuildRaw()` |
| 解析 | `Build:LoadDB()` | `Item:ParseRaw()` |
| 在本项目的用途 | URL `#build=` 传入、悬浮球导出 | 装备对比接口 `getItemCompareStats(slotName, itemRaw)` |

两者不是嵌套关系而是**包含关系**：物品文本作为字符串节点嵌在构筑 XML 的 `<Item>` 里。

---

## 二、构筑码（Build Code）

### 2.1 变换管线

只有四层，且生成与解析严格互逆：

```
Build 对象 ──SaveDB──> XML 文本 ──Deflate──> zlib 字节 ──Base64──> ASCII ──gsub──> URL-safe 字符串
```

生成（上游 `src/Classes/ImportTab.lua`，Generate 按钮）：

```lua
self.controls.generateCodeOut:SetText(
    common.base64.encode(Deflate(self.build:SaveDB("code"))):gsub("+","-"):gsub("/","_"))
```

解析（`src/Classes/ImportTab.lua` 的 `importCodeHandle`，`src/Modules/Common.lua` 的 `ImportBuild`）：

```lua
local xmlText = Inflate(common.base64.decode(buf:gsub("-","+"):gsub("_","/")))
```

四个环节的技术细节：

| 环节 | 实现 | 说明 |
|---|---|---|
| XML | `common.xml = require("xml")`（`runtime/lua/xml.lua`） | PoB 自研的极简 XML 库，`ParseXML` / `ComposeXML` |
| Deflate | zlib `deflateInit`（RFC1950，带 zlib 头） | 上游是原生实现；**pob-web 换成 wasm 内的 C 实现**，见 §四 |
| Base64 | `common.base64 = require("base64")`（`runtime/lua/base64.lua`） | 输出**带** `=` 填充；decode 会先剔除所有非 base64 字符集字符，因此 `-` / `_` 必须先还原成 `+` / `/` |
| URL-safe | `+`→`-`，`/`→`_` | 只改这两个字符，**不去掉**末尾 `=` |

> 由于 encode 会补 `=`，而 URL / hash 里的 `=` 可能被截断或转义，浏览器侧解析时建议自行补齐。本仓库的参考实现见
> `packages/web/test/e2e/build-model.mts:33`：
> ```ts
> const base64 = code.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(code.length / 4) * 4, "=");
> const xml = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).text();
> ```
> `DecompressionStream("deflate")` 在浏览器中即 zlib 格式，与 PoB 的 `deflateInit` 输出一致。

### 2.2 生成：`Build:SaveDB()`

`SaveDB(fileName)` 中的 `fileName` **只用于报错信息**，`SaveDB("code")` 与保存 `.xml` 文件走的是同一个函数、产出同一份 XML。所谓"构筑码"就是这份 XML 的压缩编码结果。

```lua
function buildMode:SaveDB(fileName)
    local dbXML = { elem = "PathOfBuilding" }
    do
        local node = { elem = "Build" }
        self:Save(node)          -- 先写 Build 段
        t_insert(dbXML, node)
    end
    for elem, saver in pairs(self.savers) do   -- 再写各 Tab 段
        local node = { elem = elem }
        saver:Save(node)
        t_insert(dbXML, node)
    end
    local xmlText, errMsg = common.xml.ComposeXML(dbXML)
    ...
end
```

**分派表**（`Build.lua` 的 `Init`）：

| XML 节点 | 负责对象 | 内容 |
|---|---|---|
| `Build` | `buildMode` 自身 | 元信息 + 计算结果快照 |
| `Config` | configTab | 配置项、敌对设定 |
| `Notes` | notesTab | 备注文本 |
| `Party` | partyTab | 组队光环/诅咒 |
| `Tree` | treeTab | 天赋树（延后加载，见 2.3） |
| `TreeView` | treeTab.viewer | 视图缩放/位置 |
| `Items` | itemsTab | 装备（含 itemRaw） |
| `Skills` | skillsTab | 技能组 |
| `Calcs` | calcsTab | 计算面板展开状态 |
| `Import` | importTab | 导入来源链接 |

**`Build` 节点属性**（`buildMode:Save`）：`targetVersion` / `viewMode` / `level` / `className` / `ascendClassName` / `bandit` / `pantheonMajorGod` / `pantheonMinorGod` / `mainSocketGroup` / `characterLevelAutoMode`。

**`Build` 节点子节点**：

- `Spectre`（幽魂库，仅存 id）
- `PlayerStat`（stat + value）
- `FullDPSSkill`（TotalDPS 拆分到每个技能）
- `MinionStat`（召唤物面板）
- `TimelessData`（永恒珠宝搜索状态）

> 关键点：`PlayerStat` / `MinionStat` / `FullDPSSkill` 是**计算结果的快照**，只用于侧边栏展示和第三方站点读取，**不参与解析后的重建**。真正决定构筑的是 `Tree` / `Items` / `Skills` / `Config` 四段。

**`Items` 段与 itemRaw 的存放**（`src/Classes/ItemsTab.lua` 的 `Save`）：每件装备是一个 `<Item>` 节点，物品文本作为**裸字符串子节点**塞进去，词条范围另用 `<ModRange>` 记录：

```lua
local child = { elem = "Item", attrib = { id = ..., variant = ..., variantAlt = ... } }
item:BuildAndParseRaw()                 -- 先规范化 raw
t_insert(child, item.raw)               -- 文本节点
-- 对每个有 range 的词条行写：{ elem = "ModRange", attrib = { id = <全局序号>, range = ... } }
```

再后面是 `<ItemSet>` 节点（属性 `id` / `title` / `useSecondWeaponSet`），其下 `<Slot name itemId itemPbURL active>` 与 `<SocketIdURL name nodeId itemPbURL>` 记录"哪个槽位装了哪件"。

### 2.3 解析：从字符串到 Build 对象

**第一步：输入归一化**（`ImportTab.lua` 的 `importCodeHandle`）

1. 去首尾空白；
2. 若是 `youtube.com/redirect?` 或 `google.com/url?`，取出 `q=` 参数并 URL decode；
3. 依次匹配 `buildSites.websiteList`（pastebin、poe.ninja 等）的 `matchURL`；命中则记为"待下载链接"，点 Import 时先 `DownloadBuild` 再回到本函数；
4. devMode 下若为 JSON 且含 `character.equipment` + `character.passives`，走 JSON 导入分支；
5. 兜底：按 §2.1 的逆变换解压，成功则置 `importCodeXML` / `importCodeValid`。

**第二步：选择导入模式**（`importSelectedBuild`）

`importCodeMode` 下拉的三项：

| selIndex | 行为 |
|---|---|
| 1 | 导入至当前构筑（会弹确认框，抹除现有数据） |
| **2** | **导入至新构筑（pob-web 用这个）** |
| 3 | 作为对比构筑导入 |

三种最终都汇到 `build:Shutdown()` + `build:Init(dbFileName, buildName, importCodeXML, false, importLink)`。

**第三步：`Build:LoadDB(xmlText)`**

```lua
local dbXML, errMsg = common.xml.ParseXML(xmlText)
if dbXML[1].elem ~= "PathOfBuilding" then -- 报"根节点缺失"并退出
-- 1) 先找 Build 节点并 self:Load(node) —— 拿到 targetVersion
-- 2) 找 Import 节点的 importLink（仅当本地没有）
-- 3) 其余节点全部塞进 self.xmlSectionList，留给 Init 分派
```

**第四步：`Init` 中的分派与顺序**

```lua
self.savers = { Config=…, Notes=…, Party=…, Tree=…, TreeView=…, Items=…, Skills=…, Calcs=…, Import=… }
self.legacyLoaders = { Spec = self.treeTab }   -- 旧版字段名兼容
```

分派时有两条硬规则：

- **`Tree` 段延后到最后加载**。原因写在源码注释里：天赋树要校验珠宝插槽，而珠宝是 `Items` 段里的物品，必须先有 Items 才能连树。
- 每个 saver 加载后统一调用 `PostLoad()`；随后 `skillsTab:UpdateSocketGroups()`（技能组依赖物品），最后 `calcsTab:BuildOutput()` 产出计算结果。

**第五步：版本校验**

`targetVersion ~= liveTargetVersion` 时中断加载，弹出 `OpenConversionPopup()`。转换本质是丢弃 XML、用旧的 `dbFileName` 重新 `Init(nil, name, nil, true)`，让各 Tab 按当前版本重建。

### 2.4 保存时的防膨胀

`importTab:Save` 里有一行保护：

```lua
xml.attrib.importLink = (xml.attrib.importLink and xml.attrib.importLink:len() < 100) and xml.attrib.importLink or nil
```

避免把一整个 base64 导入链接再嵌进 XML，造成嵌套式膨胀。

---

## 三、物品文本（Item Raw）

### 3.1 生成：`Item:BuildRaw()`

严格按以下顺序拼行，`\n` 连接：

```
Rarity: <UNIQUE|RARE|MAGIC|NORMAL|RELIC>
<title>            (传奇/传承才有，否则跳过)
<namePrefix><baseName><nameSuffix>
Armour / Evasion / Energy Shield / Ward: <值>       (有则写，并附 <type>BasePercentile)
Intangibility / Unique ID / League / Unreleased
<影响> Item        (Shaper / Elder / Crusader …，可多行)
Crafted: true
Prefix: {range:0.5}{fractured}<modId>              (自制装备才有)
Suffix: …
Catalyst / CatalystQuality
Cluster Jewel Skill / Cluster Jewel Node Count
Talisman Tier / Item Level / Memory Strands
Version: … / Selected Version: …
Variant: … / Selected Variant Group: <g>=<v> / Has Alt Variant…
Quality / Sockets / LevelReq / Radius / Limited to / Requires Class
Implicits: <N>                                     ← 关键分隔标记
<enchant 词条行>
<scourge 词条行>
<classRequirement 词条行>
<implicit 词条行>      ← 恰好 N 行（enchant+scourge+implicit 合计）
<explicit 词条行>
<crucible 词条行>
Split / Mirrored / Fractured Item / Corrupted / Foil Unique (<type>)
```

词条行的前缀由 `writeModLine` 按固定顺序追加，`{}` 里是元信息，**解析时会被 `gsub` 吃掉，不参与词缀匹配**：

`{range:}` `{corruptedRange:}` `{disabled}` `{crafted}` `{enchant}` `{custom}` `{scourge}` `{crucible}` `{mutated}` `{modGroup:}` `{fractured}` `{prefix}` `{suffix}` `{exarch}` `{eater}` `{synthesis}` `{unscalable}` `{vestigial}` `{tags:…}` `{group:…}` `{variant:…}` `{version:…}`

### 3.2 `Implicits: N` 是解析的枢纽

`Implicits:` 记录"前面有多少行是隐藏/附魔/腐化词条"。解析端据此切分：

```lua
if modLine.enchant or (modLine.crafted and #enchant + #implicit < implicitLines) then
    modLines = self.enchantModLines
elseif modLine.scourge then
    modLines = self.scourgeModLines
elseif line:find("Requires Class") then
    modLines = self.classRequirementModLines
elseif modLine.implicit or (not modLine.crafted and #enchant + #scourge + #implicit < implicitLines) then
    modLines = self.implicitModLines
elseif modLine.crucible then
    modLines = self.crucibleModLines
else
    modLines = self.explicitModLines
end
```

**没有 `Implicits:` 行时**（比如直接从游戏里 Ctrl+C 的文本），`ParseRaw` 退化为状态机启发式：

```
FINDIMPLICIT → IMPLICIT → FINDEXPLICIT → EXPLICIT → DONE
```

靠"是否已经出现过 `Item Level`、`(implicit)`、`(enchant)`"等信号推断，准确率低于带 `Implicits:` 的 PoB 格式文本。

### 3.3 解析：`Item:ParseRaw(raw, rarity, highQuality)`

主循环是一次线性扫描，逐行落到四类目标：

1. **状态标记行**：`Split` / `Mirrored` / `Corrupted` / `Fractured Item` / `Synthesised Item` / `<影响> Item` / `Veiled Prefix|Suffix` → 置 bool；
2. **`--------` 分隔线** → 触发 `checkSection`，推进 `gameModeStage`；
3. **`键: 值` 形式的规格行** → 大 `if/elseif` 链写入字段。主要键：

   | 键 | 落到 |
   |---|---|
   | `Item Level` / `Unique ID` / `League` / `Source` / `Note` | 标量字段 |
   | `Quality` / `Quality (Xxx Modifiers)` | `quality` / `catalyst` + `catalystQuality` |
   | `Sockets` | `sockets`（`-` 同组，空格分组）|
   | `LevelReq` / `Requires Level` | `requirements.level` |
   | `Str/Strength`、`Dex/…`、`Int/…` | `requirements.str|dex|int` |
   | `Armour` / `Evasion Rating` / `Energy Shield` / `Ward` | `armourData` |
   | `Radius` / `Limited to`（Jewel） | `jewelRadiusLabel` / `limit` |
   | `Cluster Jewel Skill` / `Node Count` | 星团珠宝 |
   | `Implicits` | `implicitLines = N`，并把 stage 直接推到 `EXPLICIT` |
   | `Prefix` / `Suffix` | 自制词缀表（带 `{range:}`） |
   | `Crafted` / `Scourge` / `Crucible` / `Implicit` | bool |

4. **其余全是词缀行** → `modLib.parseMod(line)` 转成 `modList`，按 3.2 的规则分桶。

收尾必做三件事：`NormaliseQuality()`（护甲/武器/药剂默认补到 20%）、`BuildModList()`（把词条算成实际 ModList，同时抽走 local 词条算出 weaponData/armourData/flaskData）、必要时按 `statOrder` 重排 explicit 行。

### 3.4 数值区间与"高级复制"格式

- **范围归一化**：`+35(30-40) Life` 这类写法，取值 `35`、区间 `30-40`，归一化为 `range = (35-30)/(40-30) = 0.5`。实际生效值由 `itemLib.applyRange(line, range, valueScalar, corruptedRange)` 在解析时算回具体数字。这样拖动 roll 滑块只需改 0~1 的小数。
- **高级复制格式**：以 `{ ` 开头的行是 GGG 高级复制文本，形如 `{ Prefix Modifier "XXX" (Tier: 1) — Life, Defences }`。`ParseRaw` 从中提取词缀名去 `self.affixes` 反查 modId，并把 `—` 后面的 tag 串转成 `{tags:…}` 前缀。检测到它就置 `self.advancedCopy = true`，启用后续的范围/词缀匹配逻辑。
- **不在 0~1 内的 roll**：老版本物品可能超出当前数据区间，`ParseRaw` 会保留外推值（注释明确说明），不会因为重 Craft 而被归一化掉。

### 3.5 与本项目装备对比接口的关系

`packages/driver/translate/getBuildStats_impl.lua:143` 的 `getItemCompareStats_impl(slotName, itemRaw)` 走的正是这条解析链：

```lua
local repItem = nil
local mode = "remove"
if itemRaw and itemRaw ~= "" then
    repItem = new("Item", itemRaw)      -- → ItemClass 构造 → ParseRaw(sanitiseText(raw))
    if not repItem or not repItem.base then
        error("getItemCompareStats: invalid item raw")
    end
    repItem:BuildAndParseRaw()          -- BuildRaw 规范化 + 再解析一次，确保 raw 自洽
    mode = "replace"
end

local calcFunc, calcBase = build.calcsTab:GetMiscCalculator()
local outputNew = calcFunc({ repSlotName = slotName, repItem = repItem })
```

由此得出对调用方的两条硬约束：

1. **传入的 `itemRaw` 必须是 PoB 格式文本**，即含 `Implicits: N` 行。缺了它就会走 3.2 的启发式，implicit 容易被误判成 explicit，对比结果偏大。从 PoB 内取物品请用 `item.raw`（`BuildAndParseRaw()` 之后一定自洽），不要用游戏原始复制文本。
2. `itemRaw` 为空串 = "脱下该槽位"（`mode = "remove"`），非空 = "换上这件"（`mode = "replace"`）。

---

## 四、pob-web 的桥接层（与上游的差异）

上游的 `Deflate` / `Inflate` 是宿主原生函数；pob-web 里改由 **wasm 内的 C 实现**提供，通过 `lua_pushcclosure` 暴露成同名全局函数：

```
packages/driver/src/c/driver.c:183-279   Deflate / Inflate（zlib，输入与输出上限均 128 MiB）
packages/driver/src/c/driver.c:403-407   lua_setglobal(L, "Deflate") / ("Inflate")
```

其余环节（`common.base64`、`common.xml`、SaveDB/LoadDB、ParseRaw/BuildRaw）**完全沿用上游，未改动**。

构筑码进出的完整调用链：

```
浏览器 URL  #build=<code> / #=<code>
    packages/web/src/components/PoBWindow.tsx:72-82        hash → buildCode state
    ↓
packages/driver/src/js/driver.ts:431-440                  loadBuildFromCode / getBuildCode
    ↓
packages/driver/src/js/worker.ts:338-355                  cwrap("load_build_from_code"/"get_build_code")
    ↓
packages/driver/src/c/driver.c:584-618                    EMSCRIPTEN_KEEPALIVE，lua_getglobal + lua_pcall
    ↓
packages/driver/boot.lua:209-252                          loadBuildFromCode / getBuildCode
    ↓
上游 ImportTab.importCodeGo.onClick() / Build:SaveDB("code")
```

`boot.lua` 侧的两个实现要点：

```lua
function getBuildCode()
    local xmlText = build:SaveDB("code")
    return common.base64.encode(Deflate(xmlText)):gsub("+","-"):gsub("/","_")
end

function loadBuildFromCode(code)
    runCallback("OnFrame")                                -- 导入前先刷一帧，清掉挂起状态
    if mainObject.main.mode ~= "BUILD" then mainObject.main:SetMode("BUILD", false, "") end
    importTab.controls.importCodeIn:SetText(code, true)   -- 触发 importCodeHandle，产出 importCodeXML
    importTab.controls.importCodeMode.selIndex = 2        -- 固定"导入至新构筑"
    importTab.controls.importCodeGo.onClick()
    runCallback("OnFrame")                                -- 导入后再刷一帧
end
```

即：**pob-web 不自己实现编解码**，只是驱动 PoB 自己的 Import/Export 控件，把结果通过 C→TS 桥搬运到浏览器。

---

## 五、与中文翻译层的关系

- 翻译发生在**绘制层与词条数据层**（`translate_zh.lua` hook `DrawString` / `DrawStringWidth` / `DrawStringCursorIndex` / `main:WrapString`），**不参与代码解析与生成**。
- 构筑码内部、物品文本、XML 属性一律是**英文原始文本**；翻译层不会改写它们。
- 因此 `getBuildCode()` 产出的码与官方 PoB 完全互通，导入/导出都不受中文层影响。
- 需要注意的只有一处间接影响：`text.ts` 的 CJK 字体 fallback 缺失会让中文渲染成豆腐块，属于显示问题，与编解码无关。

---

## 六、代码位置索引

### 本仓库

| 文件 | 位置 | 内容 |
|---|---|---|
| `packages/driver/boot.lua` | 209-234 | `loadBuildFromCode` |
| `packages/driver/boot.lua` | 236-252 | `getBuildCode` |
| `packages/driver/src/c/driver.c` | 183-227 / 229-279 | `Deflate` / `Inflate`（zlib） |
| `packages/driver/src/c/driver.c` | 584-594 / 596-618 | `load_build_from_code` / `get_build_code` |
| `packages/driver/src/js/worker.ts` | 338-355 | `cwrap` 绑定 |
| `packages/driver/src/js/driver.ts` | 431-440 | Driver 层转发 |
| `packages/web/src/components/PoBWindow.tsx` | 72-82 | URL hash → buildCode |
| `packages/driver/translate/getBuildStats_impl.lua` | 143-186 | `getItemCompareStats_impl`（消费 itemRaw） |
| `packages/web/test/e2e/build-model.mts` | 27-53 | 浏览器侧解码构筑码的参考实现 |

### 上游（v2.67.2）

| 文件 | 关键符号 |
|---|---|
| `src/Modules/Build.lua` | `Init` / `LoadDB` / `LoadDBFile` / `SaveDB` / `SaveDBFile` / `Load` / `Save` |
| `src/Classes/ImportTab.lua` | `importCodeHandle` / `importSelectedBuild` / `ImportItem` / `ImportItemsAndSkills` / `ImportPassiveTreeAndJewels` |
| `src/Classes/ItemsTab.lua` | `Save` / `Load`（`<Item>` + raw 文本 + `<ModRange>` + `<ItemSet>`）|
| `src/Classes/Item.lua` | `ParseRaw` / `BuildRaw` / `BuildAndParseRaw` / `BuildModList` / `Craft` |
| `src/Modules/Common.lua` | `ImportBuild` / `common.xml` / `common.base64` / `sanitiseText` |
| `runtime/lua/base64.lua` | `encode`（补 `=`）/ `decode`（剔除非法字符）|
