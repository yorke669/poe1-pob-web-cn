# PoE1 天赋树页面 —— 设计方案

> 范围：仅覆盖 `代码扩展/poe1-passive-tree/` 这个独立页面（一个可离线打开、可交互规划天赋、可看珠宝半径的静态页面）。
> 数据源版本：当前内置 `3_29`（PoB `v2.67.2`）；另含 `3_26`（PoB `v2.49.0`），页面顶部「数据源」下拉框可即时切换对比。各版本均由 `convert_tree.py` 从 PoB 官方仓库 `src/TreeData/<ver>/` 的 `tree.lua` + `sprites.lua` 生成。

---

## 一、目标与现状

- **目标**：不依赖 WASM / PoB 运行时，用一份烘焙好的树数据 + Canvas 2D 自绘，做一个可缩放、可分配、可查珠宝半径的天赋树查看/规划页面。
- **当前状态**：功能完整、可离线运行（`python3 -m http.server` 起服务即可）。已与 pobzh 预计算的 `timeless-jewel-socket-radius` 表逐插槽比对 **57/57 完全一致**。

---

## 二、整体架构（三层 + 文件）

```
poe1-passive-tree/
├── index.html            # 页面 + 全部逻辑（原生 JS，单 <script>，无框架无构建）+ 顶部「数据源」下拉框
├── poe1-tree.js          # 1.7MB，3_29 参考数据（window.POE1_TREE）
├── poe1-tree-3.29.js     # 由官方 Lua 生成（3_29）
├── poe1-tree-3_26.js     # 由官方 Lua 生成（3_26）
├── convert_tree.py       # 官方 Lua（tree.lua + sprites.lua）→ JS 转换脚本
├── source/               # 官方原始 Lua 归档（按版本号命名，审计凭据）
│   ├── TreeData_3_29.lua / Sprites_3_29.lua
│   └── TreeData_3_26.lua / Sprites_3_26.lua
└── assets/               # 5 张官方精灵图（skills-3.jpg / skills-disabled-3.jpg /
                         #        mastery-3.png / mastery-active-selected-3.png / mastery-disabled-3.png）
```

| 层 | 职责 | 关键函数 / 变量 |
|----|------|----------------|
| **数据层** | 加载 + 过滤节点 | `poe1-tree.js`、`isVisible()` |
| **渲染层** | 世界↔屏幕变换、绘制 | `toScreen/toWorld`、`fitScale/scaleNow`、`draw()` |
| **交互层** | 缩放/平移/命中/分配/搜索/半径 | `wheel/pointer*`、`onNodeClick`、`prune()`、`renderJewel()` |

---

## 三、数据层设计

### 3.1 `poe1-tree.js` 结构

```js
window.POE1_TREE = {
  meta:     { game: "poe1", version: "3_29", packTag: "v2.67.2" },
  constants:{ orbitRadii: [0,82,162,335,493,662,846], skillsPerOrbit:[1,6,16,16,40,72,72] },
  groups:   { "<groupId>": { x:Number, y:Number }, ... },        // 804 组，x/y 为世界坐标
  nodes:    { "<nodeId>": { type, name, x, y, group, orbit, out:[...],
                            sprite:{sheet,x,y,w,h}, inactiveSprite:{...},
                            stats:[...], ascendancy?, isProxy?, expansionJewel?, masteryEffects? }, ... }
}
```

- 节点总数 **3396**，可见（渲染）**2351**。
- 权威来源链：**PoB 官方仓库** `PathOfBuildingCommunity/PathOfBuilding` 的 `src/TreeData/3_29/tree.lua` + `sprites.lua`（每个游戏版本一个子目录，`-3` 后缀标识 3.x 美术资源）→ pobzh 在构建期把该数据内联进 `BuildShowcase.js` 前端 chunk → 我们从中提取 poe1 分支重组而成。结构与原站 / 与 PoB 一致，未自造字段。
- 官方原始文件已归档到本目录 `source/`（按"版本号命名"）：`TreeData_3_29.lua`/`Sprites_3_29.lua`、`TreeData_3_26.lua`/`Sprites_3_26.lua`，可作为数据来源审计凭据。版本对应：PoB release `v2.67.2` ↔ tree data `3_29`、`v2.49.0` ↔ `3_26`（两套编号，需区分）。浏览器运行时消费的是 JSON 形态的 `poe1-tree*.js`，即上述官方数据同源导出。
- `sprite.sheet` 索引 → `assets/` 文件顺序：`0=skills-3.jpg`（活跃）、`1=skills-disabled-3.jpg`（未激活）、`2=mastery-3.png`、`3=mastery-active-selected-3.png`、`4=mastery-disabled-3.png`。
- 精灵图本地加载，失败自动回退官方 CDN（`https://web.poecdn.com/image/passive-skill/`），所以缺失资源也能显示。

### 3.2 过滤规则（`isVisible`）

| 规则 | 原因 |
|------|------|
| `group === undefined || group < 0` → 不渲染 | 402 个 `group=-1` 条目坐标都是 `(0,0)`，PoB 未放置到树上，否则全部堆在原点 |
| `isProxy` → 不渲染 | Position Proxy 是连线用的定位点，非天赋 |
| `expansionJewel.size !== 2 && !showCluster` → 不渲染 | Small/Medium 星团插槽默认隐藏，与 PoB 一致；勾选"显示全部珠宝插槽"才显示 |
| `type === "ascendancy" || ascendancy` → 仅当选中对应升华时显示 | 升华树按 `n.ascendancy` 名匹配 |

---

### 3.3 官方 Lua → JS 转换脚本（convert_tree.py）

将 PoB 官方仓库 `src/TreeData/<ver>/tree.lua` + `sprites.lua` 转换为与 `poe1-tree.js` 同构的 `poe1-tree-<ver>.js`，用 `slpp` 解析 Lua 表（无需手写解析器）。输出后用 `poe1-tree.js`（3_29 参考）自动做交叉验证。

运行（需先 `pip install slpp`）：

```bash
# 生成 3.26（对应 PoB v2.49.0）
python3 convert_tree.py --version 3_26 --packtag v2.49.0
# 生成 3.29（对应 PoB v2.67.2）
python3 convert_tree.py --version 3_29 --packtag v2.67.2
```

- `--version`：树数据版本（即 `src/TreeData/` 下目录名，如 `3_26` / `3_29`）。自动推导输入 `source/TreeData_<ver>.lua` + `Sprites_<ver>.lua` 与输出 `poe1-tree-<ver>.js`。
- `--packtag`：对应 PoB release 版本号，仅展示用，写入 `meta.packTag`。
- 坐标公式复刻 PoB 官方 `AssignNodePositions`：`angle = orbitAngles[orbit][orbitIndex]`（**非均匀角度表**，非简单均匀分布）；`x = group.x + sin(angle)*r`，`y = group.y - cos(angle)*r`。
- 交叉验证：类型判定与 `sprite.sheet` 不一致应为 0；跨版本出现的少量坐标大偏差是 GGG 在不同版本间真实移动过的节点，非转换错误。
- 新生成的 `poe1-tree-<ver>.js` 需在 `index.html` 的 `DATA_FILES` 中登记，才会出现在顶部「数据源」下拉框。

## 四、渲染层设计

- **单 `<canvas>` 2D**，`setTransform(dpr*B, 0, 0, dpr*B, dpr*t.x, dpr*t.y)` 做世界→屏幕映射（`B = fitScale() * scale`，`fitScale` 让全树适配视口，`scale` 用户缩放 0.6~8，DPR 限 `min(dpr,2)`）。
- **视锥剔除**：每帧用反变换算出可见世界范围，只绘制范围内的节点与边，2351 个节点下交互流畅。
- **绘制顺序**（与 pobzh 对齐）：① 珠宝半径环 → ② 连线（同 group 同 orbit 且 `orbit>0` 的走 `arc()` 圆弧，圆心=group 中心、半径=`orbitRadii[orbit]`，否则直线）→ ③ 节点（圆底 + 圆形 `clip` 后 `drawImage` 贴精灵图 + 描边；socket 额外画内圆）→ ④ 可分配高亮（青色圈）/ 选中高亮（青色亮圈）/ hover 高亮（灰圈）。
- 节点半径（世界单位）：normal 30 / notable 42 / keystone 54 / mastery 40 / socket 34 / classStart 46 / ascendancy 40。
- 连线宽：已分配 `max(20, 2.4/B)` 金色，未分配 `max(12, 1.5/B)` 灰色。

---

## 五、交互与计算

| 能力 | 实现要点 |
|------|----------|
| 缩放 | `wheel`：以指针为锚点缩放 |
| 平移 | `pointerdown/move/up`（移动 >4px 才算拖拽，避免误触分配） |
| 命中 | 反变换后遍历可见节点，取距离最近且 `< r+6` 的 |
| 分配 / 取消 | 点击节点：插槽→切半径；已分配→删除并 `prune()`；未分配且相邻已分配→加入 |
| 连通性 | `prune()` 从职业起点 BFS，删除不再连通的已分配节点 |
| 搜索 | 名称 / 词条模糊匹配（前 40 条），点击定位到该节点 |
| 珠宝半径 | 点插槽画金色虚线圈；档位 Small 960 / Medium 1440 / Large 1800 / Very Large 2400 / Massive 2880，支持环形 `[本档, 下一档]`（960→1320、1440→1680、1800→2040、2400→2880、2880→3360） |

### 珠宝半径统计规则（已验证）

排除：升华 / 专精 / 插槽 / 职业起点 / 未放置条目（`group<0`）；**计入 `isProxy`**（定位代理）。已分配天赋排在列表前。该规则下与 pobzh 预计算表 **57/57** 匹配。

---

## 六、后续升级与改造建议

> 结论：当前页面**无需改造即可使用**（查看 / 规划 / 看半径）。下列为按需扩展，核心三层架构可复用，不必重写。

| 场景 | 是否需改造 | 改造点 |
|------|-----------|--------|
| **升级 PoB 版本**（换树数据） | 需批量刷新数据 | 从 PoB 官方仓库下载新版 `src/TreeData/<ver>/tree.lua` + `sprites.lua` 到 `source/`，运行 `python3 convert_tree.py --version <ver> --packtag <PoB版本>` 生成 `poe1-tree-<ver>.js`，再到 `index.html` 的 `DATA_FILES` 登记即可。**逻辑零改动**（字段结构稳定）。 |
| **天赋名/词条中文化** | 需小改 | 复用 `代码扩展/data/zh-rCN/` 的 `tree_dn.csv`（名）、`tree_sd.csv`（词条）：加载建 `en→zh` 映射，tooltip 与搜索结果展示中文。`isVisible`/`draw` 不动。 |
| **接入军团珠宝计算** | 需较大改造 | 自研 LUT（pobzh 的 `.bin`）成本高、且涉及授权；**建议复用** PoB 的 `LegionPassives` + `NodeIndexMapping` 数据（pobzh 静态数据已声明来源）。页面加 LUT 加载 + 解码即可，渲染层不变。 |
| **嵌入主项目（driver overlay）** | 需适配 | 页面已是自包含 widget；嵌到 `packages/driver/src/js/overlay/` 时主要处理层级/坐标与 React 生命周期，渲染逻辑可直接搬运。 |
| **性能 / 体验**（移动端手势、离屏预渲染、精灵图合并） | 可选优化 | 节点预渲染到离屏 canvas 再 `drawImage`；双指手势缩放；精灵图合并为单 sheet 减少请求。当前 2351 节点已流畅，非必须。 |

---

## 七、文件清单

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.html` | 31KB | 页面 + 全部逻辑 + 顶部「数据源」下拉框 |
| `poe1-tree.js` | 1.7MB | 3_29 参考数据（`window.POE1_TREE`） |
| `poe1-tree-3.29.js` | 1.7MB | 由官方 Lua 生成（3_29） |
| `poe1-tree-3_26.js` | 1.75MB | 由官方 Lua 生成（3_26） |
| `convert_tree.py` | ~11KB | 官方 Lua → JS 转换脚本（见 §3.3） |
| `source/TreeData_3_29.lua` | 2.8MB | 官方原始树数据（审计凭据） |
| `source/Sprites_3_29.lua` | 709KB | 官方原始精灵配置 |
| `source/TreeData_3_26.lua` | 2.7MB | 官方原始树数据（3_26） |
| `source/Sprites_3_26.lua` | 624KB | 官方原始精灵配置（3_26） |
| `assets/skills-3.jpg` | 738KB | 天赋精灵图（活跃） |
| `assets/skills-disabled-3.jpg` | 529KB | 天赋精灵图（未激活） |
| `assets/mastery-3.png` | 629KB | 专精精灵图 |
| `assets/mastery-active-selected-3.png` | 715KB | 专精（选中） |
| `assets/mastery-disabled-3.png` | 307KB | 专精（未激活） |

本地预览：`cd 代码扩展/poe1-passive-tree && python3 -m http.server 8123`，浏览器开 `http://127.0.0.1:8123/index.html`（或直接用 `file://` 打开 `index.html`，下拉框切换数据源无需服务器）。

重新生成数据：`python3 convert_tree.py --version 3_29 --packtag v2.67.2`（详见 §3.3）。
