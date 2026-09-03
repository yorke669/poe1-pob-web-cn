# PoE1 天赋树页面「军团珠宝 Tab」改造方案

> **For Claude:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 逐任务实施；每任务结束先跑自检再提交。

**目标**：把 `代码扩展/poe1-passive-tree/index.html` 拆成两个 Tab —— Tab1「天赋模拟」（现状不变）、Tab2「军团珠宝」（只能点珠宝孔并高亮，可**查效果**、可**找编号**）；军团珠宝的计算**不用 pobzh 的 LUT**，改为把 `/opt/poe/timeless-jewels`（Vilsol，Go/MIT）的**实时算法**移植成 JS。

**架构**：
1. 数据层：`build_timeless_data.py` 从 `timeless-jewels/data/embedded/*.json.gz` 抽表、裁剪，产出 `data/timeless-data.js`（`window.POE1_TIMELESS`），页面零外部请求；
2. 计算层：`timeless.js` 实现 TinyMT32 变体 RNG + `Calculate()` + `ReverseSearch()`，主逻辑与 Worker 共用一份；
3. 渲染/交互层：`index.html` 加 Tab 外壳 + `timelessOverlays` 覆盖圈，Tab2 下 `onNodeClick` 只接受 `type === "socket"`。

**技术栈**：原生 JS（无框架无构建，与现有页面一致）／Canvas 2D／Python 3（仅构建期）／Web Worker（找编号，失败降级主线程分片）。

---

## 零、方案选型：为什么不用 pobzh 的 LUT

| 维度 | pobzh LUT 方案（`pobzh军团珠宝与天赋树渲染分析.md` §2） | **Vilsol 实时算法方案（本方案）** |
|---|---|---|
| 需要下载 | `assets.pobzh.cn/.../*.bin`，3.4 MB ~ **102.7 MB**，全套 ~350 MB | 无。算法 + 4 张表 |
| 数据体积 | 巨型二进制 | 原始 `*.json.gz` 共 ~1.8 MB，裁剪后 **~0.4 MB** |
| 数据根基 | 声明来自 PoB `LegionPassives` + `NodeIndexMapping`（LUT 由 pobzh 自研生成） | 直接读 GGG 的 `AlternatePassiveSkills` / `AlternatePassiveAdditions` / `AlternateTreeVersions` / `PassiveSkills`，**按种子现算** |
| 授权/依赖 | 需抓第三方 CDN 产物 | MIT（Vilsol/timeless-jewels），且 PoB 官方仓库 `src/Data/TimelessJewelData/` 也自证这条路（它自己就 ship `LethalPride.zip` 等预计算表 + 4 个 Lua 定义表） |
| 版本 | 绑定 pobzh 构建版本 | 仓库 git log 已是 `feat: upgrade assets to 3.29`，与页面当前树数据 `3_29 / v2.67.2` **同版本** |
| 「查效果」 | O(1) 查表 | O(影响节点数 ≈ 60)，<1 ms |
| 「找编号」 | O(种子数) 扫描 bin | O(种子数 × 影响节点数) ≈ 8000 × 60 ≈ 50 万次求值，JS 约 **1~3 s**（Worker + 进度条） |
| 交叉验证 | — | 关键巧合：pobzh 的 `additionsOffset: 337` 恰好等于 GGG `AlternatePassiveAdditions` 条目数 **337**，两边同源可互校 |

**结论**：移植 Vilsol 的实时算法。不引入任何运行时下载，不引入深渊系（type 7–11）珠宝（本需求未涉及，YAGNI，且只有经典 6 种有 `AlternateTreeVersion` 1–6）。

---

## 一、军团珠宝计算原理（源码逐层拆解）

### 1.1 源码地图（`/opt/poe/timeless-jewels`）

| 文件 | 作用 |
|---|---|
| `random/main.go` | **TinyMT32 变体** PRNG，`Reset(graphId, seed)` → 确定性序列 |
| `calculator/main.go` | `Calculate()`（查效果）与 `ReverseSearch()`（找编号） |
| `calculator/tree_manager.go` | `IsPassiveSkillReplaced` / `ReplacePassiveSkill` / `AugmentPassiveSkill` / `RollAdditions` |
| `data/jewels.go` | 珠宝类型枚举、征服者 → (Index, Version)、**种子范围** |
| `data/types.go` | 表结构与字段映射（GGG 的 `Var1/Var5/Var9…`） |
| `data/manager.go` | `GetPassiveSkillType` / `IsSmallAttribute` / 反查表 |
| `data/internal_types.go` | `PassiveSkillType` 枚举、`GetSeed()`（优雅狂妄 /20） |
| `data/embedded/*.json.gz` | 10 张游戏数据表（构建期 embed） |
| `frontend/src/lib/skill_tree.ts` | 影响范围 `getAffectedNodes`、词条文本 `formatStats/translateStat` |
| `frontend/src/routes/tree/+page.svelte` | 交互与展示（点插槽 → 选类型/征服者 → 查效果/找编号） |
| `jewel_test.go` | **黄金校验值**（6 种珠宝 × 5 个天赋），移植对拍用 |

### 1.2 数据表（我们真正需要的）

| 文件(gz) | 条目数 | 是否要 | 用途 |
|---|---|---|---|
| `passive_skills.json.gz` | 5798 | ✅ | `_key`=被动索引、`PassiveSkillGraphId`=**树节点 id**、`IsKeystone/IsNotable/IsJewelSocket`、`Stats[]` |
| `alternate_passive_skills.json.gz` | 408 | ✅ | 替换天赋池（含征服者专属基石） |
| `alternate_passive_additions.json.gz` | 337 | ✅ | 追加词条池 |
| `alternate_tree_versions.json.gz` | 7(0..6) | ✅ | 每种珠宝的行为开关 |
| `stats.json.gz` | 23398 | 部分 | stat id → 文本（只保留被引用的） |
| `stat_descriptions.json.gz` | — | 部分 | 词条模板翻译（只保留被引用的 descriptor） |
| `passive_skill_stat_descriptions.json.gz` | — | 部分 | 同上，优先级其次 |
| `possible_stats.json.gz` | — | ✅ 1.2 KB | `{jewelType: {statId: 出现次数}}`，「找编号」的词条下拉 + 稀有度排序 |
| `SkillTree.json.gz` | — | ❌ | **不需要**，页面已有自己的树数据 |

**关键对应**：`PassiveSkillGraphId` 就是天赋树的节点 id。已验证 `Lava Lash = 30439` 同时存在于 `passive_skills.json` 与本页 `poe1-tree-3.29.js` 的节点键中 —— 两边 id 空间一致，无需额外映射表。
`TreeToPassive`（vilsol 用整棵树算出来的）在我们这里退化为：**`passive_skills` 的 `PassiveSkillGraphId → _key` 一张 Map**。

### 1.3 珠宝行为开关（`alternate_tree_versions`，`_key` = 珠宝类型）

| _key | Id | 珠宝 | Var1 小属性点被替换 | Var2 小普通点被替换 | Var5/Var6 追加数 min/max | Var9 中点替换权重 |
|---|---|---|---|---|---|---|
| 1 | Vaal | 光彩夺目 | ✔ | ✔ | 0/0 | 100 |
| 2 | Karui | 致命的骄傲 | ✘ | ✘ | 1/1 | 0 |
| 3 | Maraketh | 残酷的约束 | ✘ | ✘ | 1/1 | 0 |
| 4 | Templar | 好战的信仰 | ✔ | ✘ | 1/1 | 20 |
| 5 | Eternal | 优雅的狂妄 | ✔ | ✔ | 0/0 | 100 |
| 6 | Kalguuran | 英勇悲剧 | ✘ | ✘ | 1/1 | 100 |

- Var9 = 0 → 中点**永不**替换（走追加）；= 100 → **必定**替换；1–99 → 掷 `Generate(0,100) < Var9`。
- 基石**永远**被替换（替换为该征服者的专属基石，且 `RandomMin/Max == 0` 不再追加词条）。

### 1.4 RNG：TinyMT32 变体（`random/main.go`）

- 初始状态常量 `C0..C3 = 0x40336050, 0xCFA3723C, 0x3CAC5F6F, 0x3793FDFF`；
- `Initialize([graphId, seed])`：`index` 从 **1** 开始，先按种子表做 2 轮混合（`roundState += seed + index`），再做 5 轮无种子混合（`+ index`），再做 4 轮 Bravo 混合（加法改异或、`- index`），最后空转 8 次 `GenerateNextState()`；
- 状态转移用 `MAT1 = 0x8F7011EE / MAT2 = 0xFC78FF1F / TMAT = 0x3793FDFF`，仅在 `b & 1` 时异或；
- 取值：`GenerateSingle(max) = GenerateUInt() % max`；`Generate(min,max)` 与 `GenerateSigned(min,max)` 都走 **`±0x80000000` 偏移的 uint32 环绕**。
- **种子特殊化**：优雅狂妄（type 5）真实种子先 `/20`（`GetSeed()`），反向搜索时 `seed` 步长 1、`realSeed = seed*20`（`TimelessJewelSeedRanges[5].Special`）。

### 1.5 计算主流程 `Calculate(passiveIndex, seed, jewelType, conqueror)`

```
skill = passives[passiveIndex]            // 珠宝插槽 / 空 → 返回空
ver   = treeVersions[jewelType]
conq  = TimelessJewelConquerors[jewelType][conqueror]   // {Index, Version}
effSeed = (jewelType == 5) ? seed/20 : seed

if (IsPassiveSkillReplaced())  → ReplacePassiveSkill()
else                           → AugmentPassiveSkill()
```

`IsPassiveSkillReplaced`：基石→true；中点→按 §1.3 的 Var9；单属性小点（stat ∈ {573,576,579}，见 `IsSmallAttribute`）→Var1；其余小点→Var2。

`ReplacePassiveSkill`：
1. 基石 → 在 `AlternatePassiveSkills` 里找 `AlternateTreeVersionsKey == ver && ConquerorIndex == conq.Index && ConquerorVersion == conq.Version && PassiveType 含 KeyStone` 的那条，`StatRolls[0] = Stat1Min`，结束。
2. 其它 → 取 `revSkills[节点类型][ver]` 候选池；`rng.Reset`；**若是中点，先丢弃一次 `Generate(0,100)`**（与 `IsPassiveSkillReplaced` 里那次对齐）；
3. 加权挑选：遍历候选，`cur += SpawnWeight; if (GenerateSingle(cur) < SpawnWeight) picked = 候选`，**后命中覆盖先命中**；
4. 掷数值：`for i in [0, min(StatsKeys.length, 4))`，先取 min，若 `max > min` 则 `GenerateSigned(min, max)`；
5. 若 `RandomMin == 0 && RandomMax == 0` → 结束；否则再追加 `(ver.Var5 + RandomMin) ~ (ver.Var6 + RandomMax)` 个词条。

`AugmentPassiveSkill`：`rng.Reset`；中点先丢弃一次 `Generate(0,100)`；然后 `RollAdditions(ver.Var5, ver.Var6)`。

`RollAdditions(min,max)`：`count = (max > min) ? Generate(min,max) : min`；每个词条：`RollAlternatePassiveAddition`（按总权重掷一次，**首命中即返回，返回 null 则重试**）+ 掷最多 2 个数值（同上的 min/max 规则）。

### 1.6 反向搜索 `ReverseSearch(passiveIndices, statIds, jewelType, conqueror)`

```
for seed in [seedMin, seedMax]（优雅狂妄：循环变量 /20，realSeed = seed*20）:
    for skill in 指定天赋（已过滤无效/插槽）:
        result = 同 Calculate 的替换/追加结果（每 (realSeed, skill) 缓存一次）
        收集 result 里 StatsKeys[i] ∈ statIds 的 (statId → StatRolls[i])
返回 { realSeed: { passiveIndex: { statId: value } } }
```
Go 版每 10 个种子回调一次进度。前端 `sync_worker.ts` 再做：按 stat 计 `weight`（权重之和）、按"命中的天赋数"分组、按 `minTotalWeight` 与每项的 `min` 过滤、按 `weight ↓` 排序。

### 1.7 前端行为（我们要复刻的交互）

- **影响范围** `getAffectedNodes(socket)`：以插槽为中心，< **1800**（`baseJewelRadius`，Large）的天赋；树渲染时已排除 proxy / classStart / 星团子节点 / blighted / 升华；再排除 `isJewelSocket` 与 `isMastery`。
- **模式 A「查效果」**：类型 → 征服者 → 输入种子 → 对范围内每个天赋 `Calculate`，结果按 stat 聚合显示 `(命中天赋数) 词条文本`，并可切换 全部/中点/小点、按 数量/字母/稀有度/价值 排序。
- **模式 B「找编号」**：类型 → 征服者 → 勾选若干词条（每项有 `weight`/`min`）→ `ReverseSearch` → 结果按命中天赋数分组、按权重排序 → 点某条结果把它设为当前种子并在树上高亮。
- **树上的点选**：点珠宝插槽 = 选位置；点普通天赋 = 加入/移出"排除集"（该天赋不参与搜索）。
- **粘贴识别**：粘贴物品文本自动识别珠宝类型 + 编号（可选）。

---

## 二、JS 移植规格

### 2.1 文件布局（新增）

```
poe1-passive-tree/
├── index.html                  # 改造：Tab 外壳 + Tab2 交互/面板（script 抽到 timeless-ui 段）
├── timeless.js                 # ★ 纯逻辑：RNG + 索引 + calculate + reverseSearch + statText（无 DOM）
├── timeless.worker.js          # 找编号 Worker（importScripts timeless.js + timeless-data.js）
├── timeless-selftest.html      # 对拍页：跑 §2.5 的黄金向量，全绿才算移植完成
├── build_timeless_data.py      # 构建：embedded/*.json.gz → data/timeless-data.js
├── data/timeless-data.js       # 产物（不入库也行，可重生成）
└── data/timeless-i18n.js       # 可选：珠宝/征服者/基石/词条中文
```

`timeless.js` 用 UMD 式导出，主页面 `window.PoTimeless`、Worker 内 `self.PoTimeless` 都能拿到：

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PoTimeless = factory();
})(typeof self !== "undefined" ? self : this, function () { /* … */ return API; });
```

### 2.2 uint32 语义（**最容易错的地方**）

Go 全是 `uint32`，JS 必须显式回绕，否则种子一大就整体错位：

| Go | JS |
|---|---|
| `a * 0x19660D`（uint32） | `Math.imul(a, 0x19660D) >>> 0` |
| `a >> 27`（uint32 逻辑右移） | `a >>> 27` |
| `a + b` / `a - b` | `(a + b) >>> 0` / `(a - b) >>> 0` |
| `-(b & 1) & 0x8F7011EE` | `(b & 1) ? 0x8F7011EE : 0`（uint32 取负只有 0/0xFFFFFFFF 两种） |
| `int32(uint32(x))` | `x \| 0` |
| `uint32(int32Value)` | `int32Value >>> 0` |

参考实现（直接可用的骨架）：

```js
var C0 = 0x40336050, C1 = 0xCFA3723C, C2 = 0x3CAC5F6F, C3 = 0x3793FDFF;
var MASK = 0x7FFFFFFF, ALPHA = 0x19660D, BRAVO = 0x5D588B65;
var MAT1 = 0x8F7011EE, MAT2 = 0xFC78FF1F, TMAT = 0x3793FDFF;

function mul32(a, b) { return Math.imul(a, b) >>> 0; }
function mAlpha(v) { return mul32((v ^ (v >>> 27)) >>> 0, ALPHA); }
function mBravo(v) { return mul32((v ^ (v >>> 27)) >>> 0, BRAVO); }

function Rng() { this.s = new Uint32Array(4); }

Rng.prototype.reset = function (graphId, seed) {
  var s = this.s;
  s[0] = C0; s[1] = C1; s[2] = C2; s[3] = C3;
  this._init([graphId >>> 0, seed >>> 0]);
  return this;
};

Rng.prototype._init = function (seeds) {
  var s = this.s, i = 1, k, rs;
  for (k = 0; k < seeds.length; k++) {            // 带种子的轮
    rs = mAlpha(s[i % 4] ^ s[(i + 1) % 4] ^ s[(i + 3) % 4]);
    s[(i + 1) % 4] = (s[(i + 1) % 4] + rs) >>> 0;
    rs = (rs + seeds[k] + i) >>> 0;
    s[(i + 2) % 4] = (s[(i + 2) % 4] + rs) >>> 0;
    s[i % 4] = rs;
    i = (i + 1) % 4;
  }
  for (k = 0; k < 5; k++) {                        // 5 轮 Alpha（无种子）
    rs = mAlpha(s[i % 4] ^ s[(i + 1) % 4] ^ s[(i + 3) % 4]);
    s[(i + 1) % 4] = (s[(i + 1) % 4] + rs) >>> 0;
    rs = (rs + i) >>> 0;
    s[(i + 2) % 4] = (s[(i + 2) % 4] + rs) >>> 0;
    s[i % 4] = rs;
    i = (i + 1) % 4;
  }
  for (k = 0; k < 4; k++) {                        // 4 轮 Bravo
    rs = mBravo((s[i % 4] + s[(i + 1) % 4] + s[(i + 3) % 4]) >>> 0);
    s[(i + 1) % 4] = (s[(i + 1) % 4] ^ rs) >>> 0;
    rs = (rs - i) >>> 0;
    s[(i + 2) % 4] = (s[(i + 2) % 4] ^ rs) >>> 0;
    s[i % 4] = rs;
    i = (i + 1) % 4;
  }
  for (k = 0; k < 8; k++) this.nextState();
};

Rng.prototype.nextState = function () {
  var s = this.s;
  var a = s[3];
  var b = (((s[0] & MASK) ^ s[1]) ^ s[2]) >>> 0;
  a = (a ^ (a << 1)) >>> 0;
  b = (b ^ ((b >>> 1) ^ a)) >>> 0;
  s[0] = s[1];
  s[1] = s[2];
  s[2] = (a ^ (b << 10)) >>> 0;
  s[3] = b;
  if (b & 1) { s[1] = (s[1] ^ MAT1) >>> 0; s[2] = (s[2] ^ MAT2) >>> 0; }
};

Rng.prototype.temper = function () {
  var s = this.s;
  var b = (s[0] + (s[2] >>> 8)) >>> 0;
  var a = (s[3] ^ b) >>> 0;
  return (a ^ (b & 1 ? TMAT : 0)) >>> 0;
};

Rng.prototype.uint   = function () { this.nextState(); return this.temper(); };
Rng.prototype.single = function (max) { return this.uint() % max; };
Rng.prototype.range  = function (min, max) {
  var a = (min + 0x80000000) >>> 0, b = (max + 0x80000000) >>> 0;
  var roll = this.single((((b - a) >>> 0) + 1) >>> 0);
  return (roll + a + 0x80000000) >>> 0;
};
Rng.prototype.signed = function (min, max) { return this.range(min >>> 0, max >>> 0) | 0; };
```

> Go 的 `Reset` 里有按 `(graphId, seed)` 的记忆化优化（`seededState`），**纯粹是性能**，不改变数值。JS 端口直接每次 `reset()` 重算即可，结果必须逐位一致。

### 2.3 计算层 API（`timeless.js`）

```js
PoTimeless.init(data)                       // data = window.POE1_TIMELESS，建 6 张索引
PoTimeless.isSmallAttribute(statId)         // (stat+1-574) ∈ [0,6] 且 0x49 对应位为 1 → {573,576,579}
PoTimeless.passiveTypeOf(skill)             // 5 插槽 / 4 基石 / 3 中点 / 1 小属性 / 2 小普通
PoTimeless.passiveByGraphId(graphId)        // 树节点 id → 被动（找不到 = 该天赋不受军团珠宝影响）
PoTimeless.calculate(passiveIndex, seed, jewelType, conqueror)
    // → { skill: 替换天赋|null, rolls: [int32 × ≤4], additions: [{ addition, rolls: [int32 × ≤2] }] }
PoTimeless.reverseSearch(passiveIndices, statIds, jewelType, conqueror, onProgress)
    // → { [realSeed]: { [passiveIndex]: { [statId]: value } } }
PoTimeless.statText(statId, roll)           // → 词条文本（数值回填 + index_handlers 换算）
PoTimeless.seedRangeOf(jewelType)           // → { min, max, step }（优雅狂妄 step=20）
PoTimeless.possibleStatsOf(jewelType)       // → { statId: count }
PoTimeless.conquerorsOf(jewelType)          // → ['Xibaqua','Zerphi','Ahuana','Doryani'] …
```

`reverseSearch` 内循环要点：每 `(realSeed, passiveIndex)` 复用一次 `calculate` 结果；每 64 个种子 `onProgress(realSeed)`；`onProgress` 返回 `false` 或外部置 `cancelled` 时中止。

### 2.4 数据管线 `build_timeless_data.py`

```bash
python3 build_timeless_data.py --src /opt/poe/timeless-jewels/data/embedded \
                               --tree poe1-tree-3.29.js --out data/timeless-data.js
```

- 读 4 个 `*.json.gz`（`gzip` + `json`），输出 `window.POE1_TIMELESS = {meta, passives, altSkills, altAdditions, treeVersions, stats, translations, possibleStats, jewels, conquerors, seedRanges}`；
- **裁剪**（这是把 1.8 MB 压到 ~0.4 MB 的关键）：
  - `passives` 只留 `[_key, PassiveSkillGraphId, isKeystone, isNotable, isJewelSocket, stats]`，且**只保留 GraphId 在本页树数据里存在的**（`--tree` 传入，读 `window.POE1_TREE` 的节点键）→ 预计 ~1400 条；
  - `stats` 只留被 `altSkills/altAdditions/possibleStats` 引用的 id（保留 `_key/Id/Text`）；
  - `translations` 只留能命中上述 stat `Id` 的 descriptor（`{ids, list:[{string, conditions, index_handlers}]}`），三个 description 文件按 vilsol 的优先级合并（`stat_descriptions` → `passive_skill_stat_descriptions` → `passive_skill_aura_stat_descriptions`，**先出现的优先**）；
  - `jewels/conquerors/seedRanges` 由 `data/jewels.go` 的常量硬编码进脚本（6 种 × 征服者表，见 §1.3）；
- 产物里写 `meta = { treeVersion: "3_29", source: "Vilsol/timeless-jewels @ e8d5de3", builtAt }`，页面据此做**版本守卫**（§五 Task 6）。

### 2.5 黄金校验向量（来自 `jewel_test.go`，移植必须全绿）

| 珠宝 | 征服者 | seed | passiveIndex（天赋） | 期望 |
|---|---|---|---|---|
| 1 光彩夺目 | Xibaqua | 2000 | 2286 Supreme Ego | altSkill#0, rolls `[1]` |
| 1 | Xibaqua | 2000 | 411 Instability | altSkill#67, rolls `[8,22]` |
| 1 | Xibaqua | 2000 | 519 Intelligence | altSkill#38, rolls `[12]` |
| 1 | Xibaqua | 2000 | 1190 Elemental Damage | altSkill#21, rolls `[3]` |
| 1 | Xibaqua | 2000 | 88 Eagle Eye | altSkill#77, rolls `[]`, additions `[14→6, 23→5, 36→11]` |
| 1 | Zerphi / Ahuana / Doryani | 2000 | 2286 | altSkill#1 / #2 / #3, rolls `[1]` |
| 2 致命的骄傲 | Kaom | 12000 | 2286 | altSkill#78, rolls `[1]` |
| 2 | Kaom | 12000 | 411 | additions `[42→20]` |
| 2 | Kaom | 12000 | 519 / 1190 | additions `[39→4]` / `[39→4]` |
| 2 | Kaom | 12000 | 88 | additions `[57→12]` |
| 2 | Rakiata / Kiloava / Akoya | 12000 | 2286 | altSkill#79 / #80 / #81 |
| 3 残酷的约束 | Deshret | 2000 | 2286 | altSkill#82 |
| 3 | Deshret | 2000 | 411 / 519 / 1190 / 88 | additions `[70→10] / [66→4] / [66→4] / [76→20]` |
| 4 好战的信仰 | Venarius | 2000 | 2286 | altSkill#86 |
| 4 | Venarius | 2000 | 411 / 519 | additions `[93→5] / [92→…]` |
| 5 优雅狂妄 | Cadiro | 2000（**/20**） | 2286 / 411 / 519 / 1190 / 88 | altSkill#105 / #123 `[30]` / #109 `[]` / #109 `[]` / #137 `[80]` |
| 6 英勇悲剧 | Vorana | 2000 | 2286 / 411 / 519 / 88 | altSkill#179 / #172 `[12,8]` / additions `[94→2]` / altSkill#175 `[20,20]` |

> 优雅狂妄那组是 **`/20` 语义**的唯一守门用例，必须单独断言。
> 另有 `reverse_test.go` 的 `TestReverseGloriousVanity / TestReverseElegantHubris` 可对拍 `reverseSearch`。

---

## 三、页面改造设计

### 3.1 Tab 外壳

```html
<nav id="tabs">
  <button data-tab="tree" class="active">天赋模拟</button>
  <button data-tab="timeless">军团珠宝</button>
</nav>
```

- `state.tab = 'tree' | 'timeless'`；切换时**不重置** `state.allocated`（Tab2 只是改交互/面板，Tab1 的加点保留，回到 Tab1 立刻可见）。
- `header` 里 Tab2 专属控件（珠宝类型 / 征服者 / 模式 / 种子 / 词条）用一个 `<div id="timeless-bar">` 包住，切 Tab 时 `display` 切换，避免两 Tab 控件互相干扰。
- 底部 `#searchbar` 在 Tab2 下隐藏（Tab2 的"词条选择"放在右侧面板）。

### 3.2 Tab2 交互：只有珠宝孔可点

```js
function onNodeClick(id) {
  if (state.tab === "timeless") {
    var n = NODES[id];
    if (n.type !== "socket") return;               // ← 非插槽：不分配、不选中、不提示
    state.selectedSocket = (state.selectedSocket === id) ? null : id;
    state.timeless.seed = 0; state.timeless.overlays = null; state.timeless.results = null;
    renderTimeless(); draw();
    return;
  }
  /* … 原 Tab1 逻辑不变 … */
}
```

**珠宝孔高亮**（进入 Tab2 即生效，绘在节点之后、状态高亮之前）：

| 状态 | 画法 |
|---|---|
| 所有珠宝孔（Tab2 默认） | 外圈紫色环 `#c084fc`，`lineWidth = max(6, 1.5/B)`，让可点位置一目了然 |
| 当前选中插槽 | 内圆填充 `#c084fc`（复用现有 socket 内圆逻辑）+ 青色外圈 `#22d3ee` |
| 半径环 | 复用现有画法，**固定 1800**（Large），金色虚线 + `rgba(242,184,75,.12)` 填充 |
| 受影响天赋覆盖圈 | 替换=橙 `#fb923c`，追加=绿 `#34d399`，虚线圈 + 8% 同色填充 |
| hover 插槽 | tooltip 追加一行「点击选择此珠宝孔」 |

> Tab1 的 `sel-radius` / `ck-ring` 在 Tab2 下禁用（军团珠宝恒为 Large 1800 实心）。

### 3.3 受影响天赋（Tab2 专用口径）

复用现有 `renderJewel()` 的距离计算，但口径改成与 vilsol 一致：

```
排除：珠宝插槽 / 专精(mastery) / 升华(n.ascendancy) / 职业起点(classStart)
      / 定位代理(n.isProxy) / 未放置(n.group < 0)
保留：距离 < 1800，且该节点 id 在 POE1_TIMELESS.passives 的 GraphId 索引中存在
```

（与 Tab1 半径统计的唯一差别是**排除 isProxy**；Tab1 的口径已与 pobzh 的 57/57 对过，保持不变，两套口径各自独立函数，互不污染。）

### 3.4 模式 A「查效果」（种子 → 结果）

右侧面板：珠宝类型 → 征服者 → 输入种子（`min/max` 由 `seedRangeOf` 决定，优雅狂妄的 `step=20` 用 `<input step>` 提示）→ 实时计算。

- 对 `affectedNodes` 逐个 `calculate`，结果两类展示：
  1. **按词条聚合**（vilsol 同款）：`(命中天赋数) 词条文本`，可切 全部/中点/小点，排序 数量/稀有度（`possibleStats` 的 count 升序 = 越稀有越靠前）/价值（`values.ts` 的 `statValues` 表，可选）；点一行 → 树上只高亮贡献该词条的天赋；
  2. **按天赋列表**：`天赋名 → 替换后的名字 + 掷出的词条（带数值）`，点一行 → `focusNode()` 定位。
- 树上同步画覆盖圈（橙=替换 / 绿=追加 / 灰=无变化）。

### 3.5 模式 B「找编号」（词条 → 种子）

右侧面板：勾选词条（下拉来自 `possibleStatsOf(珠宝类型)`，每项可设 `weight` 与 `min`）+ `minTotalWeight` → 「搜索」。

- Worker：`new Worker('timeless.worker.js')`，内部 `importScripts('../timeless.js', '../data/timeless-data.js')`；
- **`file://` 降级**：`try { new Worker(URL.createObjectURL(blob)) } catch { 主线程分片 }`。主线程降级用 `setTimeout(fn, 0)` 每片 200 个种子刷新进度条（约 40 片，UI 短暂无响应但可用）。设计文档本就推荐 `python3 -m http.server 8123`，降级只是兜底。
- 结果按"命中天赋数"分组、组内按 `weight ↓` 排序；点一条 → 设为当前种子 → 自动切到模式 A 的效果视图并高亮。
- 每个受影响天赋可单独「排除」（点树上的天赋切换 `state.timeless.disabled`），与 vilsol 的 `disabled` 集合同款。

### 3.6 状态与绘制顺序

```js
state.timeless = {
  jewelType: 1, conqueror: 'Xibaqua', mode: 'seed',      // 'seed' | 'stats'
  seed: 0, selectedStats: {}, minTotalWeight: 0,
  disabled: Object.create(null),                          // 树节点 id → true
  overlays: null,                                          // { [nodeId]: 'replace' | 'add' | 'none' }
  results: null, searching: false, progress: 0
};
```

绘制顺序（在现有 4 步基础上插入一步）：
`① 珠宝半径环 → ② 连线 → ③ 节点 → ④ **Tab2 珠宝孔高亮 + 覆盖圈** → ⑤ 可点/选中/hover 高亮`

---

## 四、中文化

- 珠宝/征服者名：`代码扩展/data/zh-rCN/TimelessJewelListControl.csv` 已有「光彩夺目/致命的骄傲/残酷的约束/好战的信仰/优雅的狂妄/英勇悲剧」等；征服者名在 `Items_Jewels.txt.csv` / `Tree.csv` 中检索；fallback 英文。
- 基石名（Divine Flesh / Eternal Youth …）：`tree_dn.csv` + `passiveTree.csv` 里捞，捞不到用英文。
- 词条文本：`statDescriptions.csv` 是**英→中整句**对照，构建期（`build_timeless_data.py`）按 `translation.list[].string` 建 `{英文模板 → 中文模板}` 附在产物里；运行时 `statText()` 先回填数值再查这张表，查不到回落英文。原则上复用现有 `tr()` 的「整条优先、再按 ` / ` 拆段」策略。

---

## 五、任务分解

### Task 1：数据管线 `build_timeless_data.py`

**Files:** Create `poe1-passive-tree/build_timeless_data.py`；Create `poe1-passive-tree/data/timeless-data.js`

1. 读 `embedded/passive_skills.json.gz` 等 4 个表 + `possible_stats.json.gz` + 3 个 description 表；
2. 用 `--tree poe1-tree-3.29.js` 的节点键集过滤 `passives`；
3. 按 §2.4 裁剪 `stats` / `translations`；
4. 写 `window.POE1_TIMELESS`（含 `meta.treeVersion = "3_29"`）；
5. 运行：`python3 build_timeless_data.py --src /opt/poe/timeless-jewels/data/embedded --tree poe1-tree-3.29.js --out data/timeless-data.js`
6. 验收：产物 < 800 KB；`passives` 命中数 ≥ 1300（`console` 打印）；`possibleStats` 6 个 key 齐全。
7. `jj commit -m "feat(passive-tree): 军团珠宝数据表构建脚本"`

### Task 2：`timeless.js` —— RNG + 自检对拍

**Files:** Create `poe1-passive-tree/timeless.js`；Create `poe1-passive-tree/timeless-selftest.html`

1. 落地 §2.2 的 `Rng`（`reset/init/nextState/temper/uint/single/range/signed`）；
2. 健壮性自检：连续 10 万次 `uint()` 无 `NaN`、全部落在 `[0, 2^32)`、`range(0,100)` 分布均匀、`reset()` 对同一 `(graphId, seed)` 可复现；
3. **不需要 Go 侧的 RNG 基准**（WSL 内未安装 Go，且 `jewel_test.go` 只提供端到端断言）：RNG 的正确性由 Task 3 的 §2.5 黄金向量端到端兜底 —— 只要 30 条全绿，RNG 与调用顺序就都对了。若日后装了 Go，可补 `go test ./random/ -run . -v` 打印 `(graphId=30439, seed=2000)` 的前 5 个 `uint()` 作为回归基准。
4. 提交。

### Task 3：`timeless.js` —— 索引 + `calculate()` 对拍黄金向量

**Files:** Modify `timeless.js`；Modify `timeless-selftest.html`

1. 实现 `init()` 建 6 张索引（`passives by _key` / `byGraphId` / `revSkills[type][ver]` / `revAdditions[type][ver]` / `keystoneByConq` / `stats by _key`）；
2. 实现 `isSmallAttribute` / `passiveTypeOf` / `calculate`（严格照 §1.5 的调用顺序，**中点要丢弃一次 `Generate(0,100)`**）；
3. 把 §2.5 全表写成 `selftest` 用例（约 30 条）；
4. 运行：浏览器打开 `timeless-selftest.html`，期望 **全绿**；任一条红 → 优先怀疑 uint32 回绕与「中点丢弃一次 roll」两处。
5. 提交。

### Task 4：词条文本 `statText()`

**Files:** Modify `timeless.js`（+ `build_timeless_data.py` 补 translations 裁剪）

1. 端口 `formatStats(translation, stat)`：`conditions[0]` 的 `min/max/negated` 选择分支 → `index_handlers` 除法表（vilsol `skill_tree.ts` 的 `indexHandlers` 有 40 项，照抄）→ `{0}` / `{0:xd}` 回填；
2. `translateStat(id)` 无数值版：`{n}` → `#`，用于词条下拉；
3. 验收：随机 20 个 `possibleStats[1]` 的 stat id 都能渲染出非空文本。
4. 提交。

### Task 5：`reverseSearch()` + Worker

**Files:** Modify `timeless.js`；Create `timeless.worker.js`

1. 端口 §1.6 的双层循环 + 每 `(seed, passive)` 缓存 + 每 64 种子 `onProgress` + `cancelled` 中止；
2. Worker 收 `{passiveIndices, statIds, jewelType, conqueror}`，回 `{progress}` / `{done, results}`；
3. 对拍 `reverse_test.go`（`TestReverseGloriousVanity` / `TestReverseElegantHubris`）；
4. 性能验收：`LethalPride + 60 个天赋 + 3 个词条` 全种子扫描（8001 种子）在 Worker 内 < 5 s。
5. 提交。

### Task 6：`index.html` Tab 外壳

**Files:** Modify `index.html`（`<style>` + `header` + `state`）

1. 加 `#tabs` 两个按钮、`#timeless-bar` 容器、`.tab-active` 样式；
2. `state.tab` / `setTab()`；切 Tab 时只切控件显隐 + 重绘，**不动 `allocated`**；
3. 载入 `data/timeless-data.js` 与 `timeless.js`（放在 `translations.js` 之后）；若 `POE1_TIMELESS.meta.treeVersion !== TREE.meta.version` → Tab2 按钮禁用并提示「军团珠宝数据为 3_29，当前数据源 X 不匹配」；
4. 验收：切 Tab 无报错；Tab1 全部原有功能回归通过（缩放/平移/加点/搜索/半径）。
5. 提交。

### Task 7：Tab2 —— 只点插槽 + 珠宝孔高亮

**Files:** Modify `index.html`（`onNodeClick` / `draw`）

1. `onNodeClick` 加 Tab2 分支（§3.2）；
2. `draw()` 在节点循环后加珠宝孔紫环；选中插槽复用现有内圆 + 青圈；半径环固定 1800；
3. `pointermove` 的 hover 在 Tab2 下对非插槽节点不画 hover 圈（提示"不可点"）；
4. 验收：Tab2 下点普通天赋**无任何反应**；点插槽高亮并出现半径环；右侧面板显示受影响天赋数。
5. 提交。

### Task 8：Tab2 —— 模式 A「查效果」

**Files:** Modify `index.html`（面板 + 覆盖圈绘制）

1. 珠宝类型/征服者/种子三个控件 + 模式切换按钮；
2. `affectedNodes()` 用 §3.3 口径；
3. 调 `calculate` → 填 `state.timeless.overlays` + 渲染「按词条聚合 / 按天赋列表」两个视图（可切）；
4. `draw()` 画橙/绿覆盖圈；点列表行 `focusNode()`；
5. 验收：选 光彩夺目/Xibaqua/seed 2000 + 任意插槽 → 基石节点必然显示替换后的征服者基石名；列表与 vilsol 站点同参数结果一致（人工抽 3 组对比）。
6. 提交。

### Task 9：Tab2 —— 模式 B「找编号」

**Files:** Modify `index.html`；Modify `timeless.worker.js`

1. 词条下拉（`possibleStatsOf`）+ `weight`/`min` 输入 + `minTotalWeight` + 搜索/取消按钮 + 进度条；
2. Worker 启动 + `file://` 降级为主线程分片（§3.5）；
3. 结果列表：按命中天赋数分组、组内 `weight ↓`；点一行设为种子并跳模式 A；
4. 树上点非插槽天赋切换 `disabled`（Tab2 下"点天赋"= 排除，与"只能点珠宝孔"不冲突：这属于**结果筛选**而非分配，需在 UI 上标注「点天赋=排除出搜索」）；
5. 验收：`LethalPride / Kaom / 60 天赋 / 选 +# to Strength` → 结果与 vilsol 站点前 10 一致（人工对比）。
6. 提交。

### Task 10：中文化 + 文档

**Files:** Modify `build_timeless_data.py` / `timeless.js`；Modify `代码扩展/docs/poe1-passive-tree-设计方案.md`

1. 按 §四 接入中文（珠宝/征服者/基石/词条），未命中回落英文；
2. 更新设计方案文档：§六 的「接入军团珠宝计算」一行改为**已实现**，并补 §九「军团珠宝 Tab」（原理、数据管线、文件清单、本地预览命令）；
3. 全文回归：Tab1 + Tab2 全功能手测一遍。
4. 提交。

---

## 六、风险与开放问题

| 风险 | 说明 | 处置 |
|---|---|---|
| **版本对齐** | `POE1_TIMELESS` 的 `PassiveSkillGraphId` 只对 3_29 成立；切到 3_26 数据源会大面积 miss | Task 6 的版本守卫：不匹配则禁用 Tab2。若要支持 3_26，需 Vilsol 仓库切回 `3cae056^` 重新导出资产（成本较高，暂不做） |
| **`file://` 下 Worker** | Chrome 会拒绝 blob worker | 主线程分片降级（Task 9）；文档推荐 `python3 -m http.server 8123` |
| **覆盖圈与现有高亮撞色** | 已有青色"可点圈"/金色"已分配圈" | 覆盖圈用**虚线 + 低透明度填充**，且半径 `R + 22`，与实线高亮区分 |
| **深渊系珠宝缺失** | type 7–11 无 `AlternateTreeVersion`，Vilsol 仓库也未实现 | 明确不在范围内；UI 只列 6 种 |
| **与 pobzh 结果差异** | pobzh 用 LUT、我们用算法；同一套 GGG 数据应一致 | Task 8/9 各抽 3 组人工对比；若不一致，优先查「中点丢弃一次 roll」与 `/20` 两处 |
| **`AlternatePassiveSkills` 为空导致 nil** | Go 会 panic | JS 端口返回 `{skill:null, rolls:[], additions:[]}`，UI 显示"无变化" |

---

## 附：字段速查

```js
// data/timeless-data.js
window.POE1_TIMELESS = {
  meta: { treeVersion: "3_29", source: "Vilsol/timeless-jewels", builtAt: "…" },
  jewels:      { 1: "Glorious Vanity", 2: "Lethal Pride", 3: "Brutal Restraint",
                 4: "Militant Faith", 5: "Elegant Hubris", 6: "Heroic Tragedy" },
  conquerors:  { 1: ["Xibaqua","Zerphi","Ahuana","Doryani"],
                 2: ["Kaom","Rakiata","Kiloava","Akoya"],
                 3: ["Deshret","Balbala","Asenath","Nasima"],
                 4: ["Venarius","Maxarius","Dominus","Avarius"],
                 5: ["Cadiro","Victario","Chitus","Caspiro"],
                 6: ["Vorana","Uhtred","Medved"] },
  seedRanges:  { 1: {min:100,  max:8000,   step:1},
                 2: {min:10000,max:18000,  step:1},
                 3: {min:500,  max:8000,   step:1},
                 4: {min:2000, max:10000,  step:1},
                 5: {min:2000, max:160000, step:20},   // 真实种子 = 循环变量 * 20
                 6: {min:100,  max:8000,   step:1} },
  treeVersions:[ {_key, smallAttrReplaced, smallNormalReplaced, minAdditions, maxAdditions, notableWeight} ],
  passives:    [ {i:_key, g:PassiveSkillGraphId, ks:bool, nt:bool, js:bool, st:[statId…]} ],
  altSkills:   [ {i, name, ver, types:[…], keys:[statId…], s1min,s1max,s2min,s2max,s3min,s3max,s4min,s4max,
                  spawn, conqIdx, conqVer, rndMin, rndMax} ],
  altAdditions:[ {i, id, ver, spawn, keys:[statId…], s1min,s1max,s2min,s2max, types:[…]} ],
  stats:       { [index]: { id, text } },
  translations:{ [statId]: { list:[{ string, conditions, index_handlers }] } },
  possibleStats:{ [jewelType]: { [statId]: count } }
};
```
