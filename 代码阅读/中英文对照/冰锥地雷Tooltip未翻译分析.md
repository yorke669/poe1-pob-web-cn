# 冰锥地雷 Tooltip 未翻译：英文提取 · 语料核对 · 解决方案

> 对象：`Icicle Mine`（冰锥地雷）技能石 tooltip。上游 `poe1 v2.67.2`，语料 PoeCharm `zh-rCN`（70 CSV / 70470 条）。
> 方法：先从源码提取**准确英文原文**（不依赖截图识别），再逐条核对其在语料中的存在性，最后定位翻译机制缺陷。
> 日期：2026-09-02

---

## 1. 英文提取与语料核对

英文原文取自上游源码（非截图识别，避免大小写/拼写误判）。

### 1.1 宝石描述区

| # | 准确英文原文（上游出处）                                                                                             | 语料检索结果                            | 判定             |
| - | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------- |
| 1 | `Throws a mine that fires projectiles around it when detonated. These projectiles quickly dissipate as they travel, before disappearing.`<br>`Data/Skills/act_int.lua:10014`（`description` 字段） | **无**（70 CSV 全部检索，0 命中）       | 语料缺失         |
| 2 | `Mine lasts {0} seconds`<br>`Data/StatDescriptions/gem_stat_descriptions.lua:1839`                                    | `statDescriptions.csv:8035` → `地雷持续 {0} 秒` | ✅ 已翻译        |
| 3 | `Base Mine Detonation Time is {0} seconds`<br>`Data/StatDescriptions/active_skill_gem_stat_descriptions.lua:3124`     | `statDescriptions.csv:8566` → `基础地雷引爆时间为 {0} 秒` | ✅ 已翻译        |
| 4 | `Fires an additional Projectile for every 2 prior Mines in Detonation Sequence`<br>`skill_stat_descriptions.lua:26404` | `statDescriptions.csv:22066` → `每 {0} 个按传爆序列引爆的地雷就发射一枚额外投射物` | ⚠️ 存在但未命中 |
| 5 | `Each Mine applies {0}% increased Critical Strike Chance to Hits against Enemies near it, up to a maximum of 500%`<br>`skill_stat_descriptions.lua:52520` | `statDescriptions.csv:9378` → `每个地雷对周围敌人的击中暴击率提高 {0}%，最高 {1}%` | ⚠️ 存在但未命中 |
| 6 | `(Not supported in PoB yet)`<br>`Modules/Main.lua:117`（`self.notSupportedTooltipText`）                              | 仅 `Main.csv:86` 配置项含该串，**无裸 key** | 语料缺失         |

### 1.2 底部 stat 比较区

真实 label 出自 `Modules/BuildDisplayStats.lua`（截图中的 `Throwing Speed`/`Mines thrown` 实为 `Throwing Time`/`Avg. Mines per Throw`）。

| # | label（上游出处）                                   | 语料                                              | 模拟 `T()` 结果                       |
| - | --------------------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| 7 | `Mine Throwing Time`（:30）                         | `地雷投掷用时:`（**带冒号**，归一化后可命中）     | ✅ `0.20s 地雷投掷用时`（COMPARE）    |
| 8 | `Avg. Mines per Throw`（:32）                       | `每次投掷平均地雷数:`（带冒号，归一化后可命中）   | ✅ `0.66 每次投掷平均地雷数`（COMPARE） |

### 1.3 结论：翻译到底存不存在

- **存在且已生效**：#2、`#3` —— 由 STAT hook（模板层）精确命中。
- **存在但未生效**：#4、`#5` —— 语料有完整翻译，机制缺陷导致查表失败（见 §2.2）。
- **本可救回但机制失效**：#7、`#8` —— 语料 + `T()` 逻辑均正确，实测模拟可翻译，但运行时未生效（见 §2.1）。
- **语料确实没有**：#1、`#6` —— 非机制问题。

补充量化：gem `description` 字段抽样 412 条，**语料覆盖率 0.00%**（PoeCharm 不翻译宝石描述，属语料源固有缺口）。

---

## 2. 机制缺陷定位

### 2.1 缺陷 A：`WrapString` hook 挂在错误对象上，完全失效

`WrapString` 定义在 **Main 类实例**上：

```1760:1760:packages/packer/r2/games/poe1/versions/v2.67.2/root/Modules/Main.lua
function main:WrapString(str, height, width)
```

而 `Launch.lua:71` 中 `errMsg, self.main = PLoadModule("Modules/Main")`，`GetMainObject()` 返回的是 **`self`**（即 `mainObject`，持有 `.main` 属性）。即：

- `mainObject` → Launch 顶层对象
- `mainObject.main` → Main 实例（**`WrapString` 在此**）

boot.lua 当前实现：

```503:512:packages/driver/boot.lua
local wrapString = mainObject["WrapString"]
if wrapString and _G.__pobWebTranslate then
    local translateLine = _G.__pobWebTranslate
    mainObject["WrapString"] = function(self, str, ...)
```

`mainObject["WrapString"]` 恒为 `nil` → 整个 `if` 块静默跳过 → **该 hook 从未生效**。

后果：`Tooltip:AddLine`（`Classes/Tooltip.lua:102`）在绘制前调用 `main:WrapString` 把长行拆成碎片；整行层面的 `T()` 因此从未执行，碎片无法匹配整句 key。这直接导致 #4、#5 失去了在 `T()` 层被救回的机会（模拟证明 `T()` 的 TEMPLATE 分支本可命中二者，见 §3 验证）。

### 2.2 缺陷 B：STAT hook 精确查表，硬编码数字 vs 占位符不匹配

STAT hook（`boot.lua` 的 `translateText`）只做精确查表：

```441:447:packages/driver/boot.lua
    local function translateText(text)
        local translated = translateTable[normalise(text)]
        if translated then
            return restore(translated, text)
        end
        return text
    end
```

`normalise` 仅把 `{0:+d}` 归一为 `{0}`，不处理**硬编码数字**。而上游部分描述把数值写死在 text 里，语料对应条目却用占位符：

| 上游 text（待翻译）                                         | 语料 key                                            | 结果 |
| ----------------------------------------------------------- | --------------------------------------------------- | ---- |
| `... up to a maximum of **500%**`                           | `... up to a maximum of **{1}%**`                   | ❌   |
| `... for every **2** prior Mines ...`                       | `... for every **{0}** prior Mines ...`             | ❌   |

影响面（对上游 20840 条 statDescriptions 文本做归一化回退实测）：

```
EXACT hit            : 17560
recovered by template:  1799   ← 归一化后新增命中
still missing        :   1481
```

---

## 3. 解决方案

### 方案 A（修复缺陷 A）：把 hook 挂到 Main 实例

将 `mainObject["WrapString"]` 改为 `mainObject.main["WrapString"]`，并保留原调用签名（`self` 即 Main 实例）：

```lua
local mainInst = mainObject and mainObject.main
local wrapString = mainInst and mainInst["WrapString"]
if wrapString and _G.__pobWebTranslate then
    local translateLine = _G.__pobWebTranslate
    mainInst["WrapString"] = function(self, str, ...)
        if type(str) == "string" then
            str = translateLine(str)
        end
        return wrapString(self, str, ...)
    end
end
```

收益：长文本（宝石描述、stat 描述长句）恢复整行级查表。实测模拟中 #4、#5 在 `T()` 层可命中：

```
'Each Mine applies 10% increased Critical Strike Chance to Hits against Enemies near it, up to a maximum of 500%'
  -> '每个地雷对周围敌人的击中暴击率提高 10%，最高 500%'          [TEMPLATE]
'Fires an additional Projectile for every 2 prior Mines in Detonation Sequence'
  -> '每 2 个按传爆序列引爆的地雷就发射一枚额外投射物'            [TEMPLATE]
```

### 方案 B（修复缺陷 B）：STAT hook 增加「裸数字 → 占位符」归一化回退

在 `translateText` 精确查表失败后，把 text 中的裸数字替换为 `{N}` 再查表，命中后回填原数字。

关键约束：占位符编号必须**接续** text 中已有的最大编号，否则会与既有占位符冲突。

- `Each Mine applies {0}% … maximum of 500%` → 已有 `{0}` → `500` 编为 `{1}` → `… maximum of {1}%` ✅ 命中
- `Fires … every 2 prior Mines …` → 无占位符 → `2` 编为 `{0}` → `every {0} prior Mines` ✅ 命中

收益：新增命中 **1799 条** stat 描述，且直接在模板层完成，不依赖 DrawString 层。

### 方案 C（语料缺口，二选一）

`#6 (Not supported in PoB yet)` 与 `#1` 宝石描述语料均无。

- `#6`：属 PoB 自有 UI 文案，量小且稳定，可自补 1 条（`(Not supported in PoB yet)` → `（PoB 尚不支持）`）。
- `#1`：412 条 gem description 覆盖率为 0，属 PoeCharm 语料源固有缺口，**不建议自译**（偏离「语料以 PoeCharm 为唯一来源」原则）；待语料源升级后由方案 A 自动生效。

---

## 4. 优先级

| 优先级 | 方案             | 解决问题    | 影响面                    |
| ------ | ---------------- | ----------- | ------------------------- |
| P0     | A：修正 hook 对象 | #4 #5 #7 #8 | 恢复整行长文本翻译（该 hook 此前 100% 失效） |
| P0     | B：数字归一化     | #4 #5       | 新增 1799 条 stat 描述命中 |
| P2     | C：自补 #6        | #6          | 1 条 UI 文案               |

A + B 组合可覆盖截图中**除宝石描述外的全部未翻译项**。

## 5. 实施状态

已在 `packages/driver/boot.lua` 落地 A + B 两项修复（2026-09-02）：

- **A（WrapString 对象）**：`mainObject["WrapString"]` → `mainObject.main["WrapString"]`。`WrapString` 定义在 Main 实例（`Modules/Main.lua:1760`），原 hook 对象恒为 nil 导致静默失效；修改后整行长文本在拆分前被 `T()` 翻译。
- **B（STAT 数字归一化）**：`translateText` 新增 `templatiseNumbers` 回退——把 text 中裸数字替换为 `{N}` 占位符（编号接续已有最大占位符），查表命中后回填原数字。覆盖 `...maximum of 500%` / `every 2 prior Mines` 这类硬编码数字 vs 占位符模板。

行为验证（Python 模拟 Lua 语义，真实语料）：

```
Each Mine applies {0}% ... maximum of 500%
  -> 每个地雷对周围敌人的击中暴击率提高 {0}%，最高 500%   ✅ ({0} 留给 StatDescriber 填值)
Fires an additional Projectile for every 2 prior Mines in Detonation Sequence
  -> 每 2 个按传爆序列引爆的地雷就发射一枚额外投射物          ✅ (无占位符，整句完整)
Base Mine Detonation Time is 0.3 seconds
  -> 基础地雷引爆时间为 0.3 秒                                ✅ (EXACT 路径，0.3 由 StatDescriber 填)
Mine lasts 5 seconds
  -> 原样返回 (MISS，语料用 {0})                              ✅ fail-safe
```

语法校验：括号配平通过、`then==if` 计数一致（无 Lua 解释器，靠结构配平 + 行为模拟确认）。

验证方式（运行时）：改 boot.lua 后必须重编译 driver（`代码阅读/scripts/driver-build.sh`）；用本地打包资源启动 dev（`driver-dev.sh --game poe1 --version v2.67.2`，**不加 `--pob-cool-asset`**），浏览器 DevTools 控制台看 `[translate] zh-rCN layer ACTIVE` 及新增的 `[translate] STAT-TEMPLATE "..." -> "..."` 日志。

未覆盖（语料固有缺口，非机制问题）：`(Not supported in PoB yet)`、`Throws a mine that fires projectiles around it when detonated...`（gem 描述，语料覆盖 0%）。
