# 技能石 Tooltip 未翻译：语料检索与机制结论

> 背景：pob-web 中技能石 tooltip（以「怒焰奔腾」为例）有两处未翻译： ① 顶部宝石描述（"Strikes enemies in front of you
> with a surge of flame..."）； ② 底部「选择这个技能宝石会给你:」下的 stat 比较行（"+667.5 Average Hit (±33.5%)" 等）。
> 方法：先检索语料确认翻译条目是否存在（`tools/translate/search-corpus.py`），再定位翻译机制。 日期：2026-09-02

---

## 1. 语料检索结果（工具：`tools/translate/search-corpus.py`）

对 PoeCharm `zh-rCN` 全部 70 个 CSV 逐条检索截图中的英文文本：

| 检索文本                                           | 语料命中   | 位置                                                      |
| -------------------------------------------------- | ---------- | --------------------------------------------------------- |
| `Strikes enemies in front of you...`（及所有片段） | **无**     | —                                                         |
| `Selecting this gem will give you:`                | EXACT      | `GUI.csv:254`                                             |
| `Average Hit`                                      | EXACT      | `SkillsTab.csv:16` → 平均击中                             |
| `Average Damage`                                   | EXACT      | `Unsorted.csv:77` → 平均伤害                              |
| `Attack Rate`                                      | EXACT      | `Unsorted.csv:78` → 攻击速率                              |
| `Crit Chance`                                      | EXACT      | `Data.csv:20` → 暴击几率                                  |
| `Hit Chance`                                       | EXACT      | `Unsorted.csv:84` → 命中率                                |
| `Hit DPS`                                          | EXACT      | `SkillsTab.csv:15` → 击中DPS                              |
| `AoE Radius`                                       | EXACT      | `Unsorted.csv:97` → 范围效果半径                          |
| `Unreserved Mana` / `Movement Speed Modifier`      | EXACT      | `Unsorted.csv`                                            |
| `Mana Cost` / `Mana Cost per second`               | 仅带冒号   | `BuildDisplayStats.csv:65/66` → 魔力消耗: / 每秒魔力消耗: |
| `Maximum Mana`                                     | 仅括号形式 | `CalcDefence.csv:5` → `(最大魔力)`                        |

### 结论一：stat 比较行的 label 语料全部存在

`BuildDisplayStats.csv` 实际是上游 `Modules/BuildDisplayStats.lua` 全部 label 的**带冒号 key 版本**（如 `Average Hit:` →
`平均击中:`）；裸 label key 散布在 `Unsorted.csv` / `SkillsTab.csv` / `Data.csv`。**不需要自补语料**。

### 结论二：宝石描述 PoeCharm 也未翻译

语料中无宝石描述 key。PoeCharm 自己的运行截图（`/opt/poe/PoeCharm/搜索技能.png`）中宝石描述 "Supports any skill that
hits enemies." 同样显示英文。这与 PoeCharm 行为一致，非 pob-web
缺陷；语料同步升级时若上游补充了描述翻译，机制会自动命中（见 §3 WrapString）。

---

## 2. 机制定位（stat 比较行怎么翻）

### 2.1 文本生成路径（上游 v2.67.2）

- 行文本：`Modules/Build.lua:1905` `s_format("%s%s %s", color, valStr, statData.label)`，可选追加
  `" (+x%)"`（`compPercent`）；
- label 来源：`Modules/BuildDisplayStats.lua`（侧栏/装备比较）与 `Classes/SkillsTab.lua`（宝石等级比较，如
  `Maximum Mana`）；
- 最终经 `Tooltip:AddLine` → 逐行 `DrawString`，即到达我们机制 A（DrawString hook）的文本是 **"数值+label+百分比"
  的已格式化行**。

### 2.2 PoeCharm 的做法（截图实证）

PoeCharm 运行截图中 `-110 最大魔力 (±33.5%)`、`-1,177 每秒魔力消耗 (±35.5%)`、`+27% 未保留魔力 (+100.0%)`
全部翻译。这些行的 label（`Maximum Mana`、`Mana Cost per second`）在语料中**没有裸 key**，只有 `带冒号/括号` 形式——说明
PoeCharm 的 C++ `Translate`/`TranslateMatch` 在匹配时对两侧做了**归一化**（小写、去括号、去尾冒号）后查表。

### 2.3 pob-web 的实现（boot.lua）

`T()` 新增 COMPARE 分支，等价复刻该机制，全部使用 PoeCharm 现有语料：

1. 拆分：`<数值[单位字母|%]> <label> [<带括号百分比>]`（Lua 模式 `^([%+%-~]?[%d%.,]+%%?%a?)%s+(.+)$` + 尾部 `%b()`）；
2. label 查表顺序：裸 key → 小写 key → **归一化
   key**（`fuzzyLabelTable`：小写、去括号、去尾冒号；值同样去尾冒号/首尾括号）；
3. 命中后重组：`数值 + 译文 + (百分比)`。

示例命中链：

- `+667.5 Average Hit (+133.5%)` → 裸 key `Average Hit` → `+667.5 平均击中 (+133.5%)`
- `-110 Maximum Mana (±33.5%)` → 归一化 `(maximum mana)` → `-110 最大魔力 (±33.5%)`
- `-1,177 Mana Cost per second (-35.5%)` → 归一化 `Mana Cost per second:` → `-1,177 每秒魔力消耗 (-35.5%)`

### 2.4 整段长文本（宝石描述等）的机制预留

`Tooltip:AddLine`（`Classes/Tooltip.lua:102`）在绘制前调用 `main:WrapString` 把长行**拆成碎片**，碎片无法匹配整句
key。boot.lua 已包装 `mainObject:WrapString`：在拆行**前**对整行做 `T()` 查表。当前语料无描述 key 时该 hook
无副作用；未来语料（升级同步）若含整句 key 即自动生效——与 PoeCharm `TranslateItemText`「在文本入口整体翻译」的思路对应。

---

## 3. 改动记录（2026-09-02 本次会话）

### 3.1 `packages/driver/boot.lua`（仅翻译层，未动上游）

| 位置                                  | 改动                                                                                                                                                                                                                               | 目的                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `translateTableLower` 构建之后        | 新增 `normLabel()` / `normValue()` / `fuzzyLabelTable` 归一化索引：对语料中含括号或冒号的 key（如 `(maximum mana)`、`Mana Cost per second:`）建立「小写+去括号+去尾冒号」镜像表，值同步归一化（去首尾配对括号、去尾冒号）          | 复刻 PoeCharm `TranslateMatch` 的两侧归一化匹配，覆盖裸 key 缺失、只有冒号/括号 key 的 label                                                     |
| `T()` TEMPLATE 分支后、最长前缀回退前 | 新增 COMPARE 分支：`^([%+%-~]?[%d%.,]+%%?%a?)%s+(.+)$` 拆出 `<数值[单位/%]>` + `<label>`，剥尾部 `%b()` 百分比；label 按「裸 key → 小写 key → `fuzzyLabelTable`」三级查表；命中后重组 `数值 译文 (百分比)` 并带 `COMPARE` 调试日志 | 让 `+667.5 Average Hit (+133.5%)`、`-110 Maximum Mana (±33.5%)`、`-1,177 Mana Cost per second (-35.5%)` 命中现有语料                             |
| `T()` 定义之后                        | 新增 `_G.__pobWebTranslate = T` 暴露点                                                                                                                                                                                             | 供 `dofile("Launch.lua")` 之后才存在的 `mainObject` 包装引用                                                                                     |
| `mainObject["ShowErrMsg"]` 包装之后   | 新增 `mainObject["WrapString"]` 包装：整行文本先 `T()` 再交给原 WrapString 拆行                                                                                                                                                    | `Tooltip:AddLine`（`Classes/Tooltip.lua:102`）绘制前把长行拆成碎片，整句 key 必须在拆行前命中；当前语料无描述 key 时无副作用，语料升级后自动生效 |

### 3.2 `tools/translate/search-corpus.py`（新增）

语料检索工具：对 PoeCharm `zh-rCN`（或指定目录）全部 CSV 逐条检索英文文本，报告 EXACT（key 整串相等）/
SUBSTR（子串）匹配及所在文件行号。内置本次截图全部未翻译片段为默认查询，支持
`python3 tools/translate/search-corpus.py [corpusDir] [queryFile|-]` 自定义。

### 3.3 `packages/driver/translate/*.lua`（无变化）

重跑同步确认产物纯净：70 模块 / 70470 条，与 PoeCharm 语料严格 1:1。

### 3.4 `tools/translate/sync-from-poecharm.py`（已还原）

调查中途曾加入「extra 自补语料目录合并」机制，后按「不加语料、语料始终以 PoeCharm
为唯一来源」原则**整体还原**，最终与改动前完全一致。

### 3.5 已撤销的尝试（教训记录）

- 曾手写 `extra/BuildDisplayStats.csv`（自译 100+ 条 label）与
  `extra/GemDescriptions.csv`（自译怒焰奔腾描述）——**已删除**。语料检索证明 stat 行 label 全部已在 PoeCharm
  语料中（此前只查了 SkillsTab/BuildDisplayStats 两个文件而漏了 Unsorted.csv 等），宝石描述则 PoeCharm
  本身也未翻，自译既无必要也会偏离语料源。

### 3.6 未做（明确排除）

不自补语料；PoeCharm 升级后重跑 `sync-from-poecharm.py` 即可让语料与机制自动对齐。

---

## 4. 验证建议

1. 重打包（`mise run pack --game poe1 --tag v2.67.2` 或解包 root.zip）后 `mise run driver:dev` 启动；
2. 打开任意技能石 tooltip（如怒焰奔腾）：
   - 底部「选择这个技能宝石会给你:」各行应显示 `+667.5 平均击中 (+133.5%)` 等；
   - 开启 `POE_TRANSLATE_DEBUG=1` 可见 `[translate] COMPARE` 日志；
3. 回归：侧栏属性（`平均击中: 1070.7`）、物品 tooltip、天赋节点翻译不受影响。
