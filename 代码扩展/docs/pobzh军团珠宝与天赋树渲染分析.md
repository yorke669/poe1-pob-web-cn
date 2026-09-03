# pobzh.cn 军团珠宝计算器技术分析

分析对象：https://pobzh.cn/timeless-jewel
分析方式：抓取线上构建产物（Vite 打包的 JS）逆向，**无后端参与，全部逻辑在浏览器**。

抓包产物见同目录 `pobzh-timeless-jewel/`（文件清单见文末）。

---

## 0. 站点骨架与定位方法

React Router v7 SPA（`ssr:false, isSpaMode:true`）+ Vite。

定位链路：`/assets/manifest-0abc7080.js` → `routes/timeless-jewel.path = "timeless-jewel"` → 模块 `timeless-jewel-Cqut9Zji.js`，imports 列表即该页面全部依赖。

| 模块 | 大小 | 作用 |
|---|---|---|
| `timeless-jewel-Cqut9Zji.js` | 52KB | 页面本体 + 主线程 LUT 解码 + 逆向求值 |
| `BuildShowcase-CM4VFbZx.js` | 4.0MB | 天赋树数据 + `PassiveTreeCanvas` 渲染组件 |
| `search.worker-CkprZuVP.js` | 2.1MB | 找编号的暴力枚举 Worker（含 poe1 节点名表） |
| `timeless-jewels-DZPuKf-U.js`（本地 `tj-data.js`） | 287KB | 军团珠宝静态数据 |
| `timeless-jewels.zh-cn-BA2GnSzi.js` | — | 征服者/基石/词条中文化 |
| `timeless-jewel-socket-radius-CIT7jO94.js` | 52KB | 预计算的插槽影响范围 |
| `assets.pobzh.cn/.../timeless-jewel/*.bin` | 3.4MB~103MB | 预计算查找表（LUT） |

---

## 1. 天赋树怎么渲染

### 1.1 数据：构建期烘焙，运行时零请求

poe1 / poe2 两份树数据以 `JSON.parse('...')` 大字符串**内联在 `BuildShowcase` chunk** 里：

```js
Kt="poe1", Ut="3_29", Vt="v2.67.2",
Yt={orbitRadii:[0,82,162,335,493,662,846], skillsPerOrbit:[1,6,16,16,40,72,72]},
_t={game:Kt, version:Ut, packTag:Vt, constants:Yt, groups:Jt, spriteSheets:$t, nodes:Qt},
Le={poe1:_t, poe2:ci}          // PASSIVE_TREE_BY_GAME
```

- `version:"3_29"` = 游戏版本，`packTag:"v2.67.2"` = **PoB v2.67.2 的树导出**（与本项目同源）。
- `groups`：组中心坐标，用于画轨道弧线。
- `nodes`：`{x, y, name, type, out[], stats[], icon, sprite:{sheet,x,y,w,h}, ...}`，`type` ∈ normal/notable/keystone/mastery/socket/ascendancy/classStart。
- `spriteSheets`：原地址是官方 CDN
  `web.poecdn.com/image/passive-skill/skills-3.jpg?1540b3b6`、`skills-disabled-3.jpg`、`mastery-3.png`、`mastery-active-selected-3.png`、`mastery-disabled-3.png`；
  运行时 `je()` **按文件名改写成打包进 `/assets/` 的本地副本**（`skills-3-DX1Tgq-G.jpg` 等），避免直连 GGG CDN：

```js
Yi={"skills-3.jpg":ti, "skills-disabled-3.jpg":ii, "mastery-3.png":Xt, ...}
function je(e){ const t = e.split("?")[0].split("/").pop() || ""; return Yi[t] || e }
```

### 1.2 几何：`getTreeRender(game, ascendancies, cluster)`

- 过滤：去掉 `isProxy`、非 2 槽的 `expansionJewel`、未选中的升华节点；
- 建边：同 `group` 同 `orbit` 且 `orbit > 0` → 走**圆弧**（圆心 = 组中心，半径 = `orbitRadii[orbit]`），否则直线；
- 算 bounds（minX/maxX/minY/maxY）；
- 结果按 `` `${game}:${asc}:${cluster?"cluster":"base"}` `` 缓存到模块级 `Fe`。

### 1.3 渲染：`PassiveTreeCanvas`（Canvas 2D，非 SVG / 非 WebGL）

单个 `<canvas>` + `getContext("2d")`，DPR = `min(devicePixelRatio, 2)`。
世界→屏幕通过一次 `setTransform(b*B, 0, 0, b*B, b*z, b*N)` 完成，其中 `B = min(w/W, h/H) * userScale`，锚点为树中心。
**没有 rAF 循环**，依赖变化触发一次全量重绘。

绘制顺序：

| 顺序 | 内容 | 关键样式 |
|---|---|---|
| 1 | 珠宝半径环 `jewelRadii` | 环形 `rgba(242,184,75,.12)` + 金色虚线圆（`evenodd` 挖内圈） |
| 2 | 边 `edges` | 已分配 `#e8c56a` / 未分配 `#667386`；武器组 1 红 2 绿；圆弧用 `arc(cx,cy,arcRadius,...)` |
| 3 | 节点圆底 | 按 type 取色；`ke(type)` 决定半径，未激活 ×0.84 |
| 4 | 图标 | `arc()` 裁剪 → `drawImage(sheet, sx,sy,sw,sh, x-r, y-r, 2r, 2r)`；已分配用 `sprite`，未激活用 `inactiveSprite` |
| 5 | 节点描边 | 已分配 `#fff1bf`；socket 额外画内圈（有珠宝紫色，空槽深色） |
| 6 | 状态覆盖 | `pickedNodeIds` 绿框 `#34d399`；`jumpAllocatableSet` 青圈 `#67e8f9`；`nodeOverlays` 按 tone 画虚线圈 + 半透明填充（add 绿 / small 灰 / replace 橙）；`selectedSocketId` 青圈 `#22d3ee`；`socketLabels` 带描边文字 |

精灵图：`new Image()` 懒加载，模块级 `Map` 缓存（`we`），`load` 后 `setState` 触发重绘。

### 1.4 交互

- 缩放：`wheel`（`passive:false`），×1.15，clamp `[0.6, 8]`，以指针为锚点；
- 平移：`pointerdown/move/up` + `setPointerCapture`，位移 > 4px 才算拖拽，否则判为点击；
- 命中：屏幕坐标反变换后按半径就近取节点 → `onNodeClick(nodeId)`；
- Tooltip：**绝对定位的 HTML div**，不画在 canvas 上。

### 1.5 本页用法

```js
wt = useMemo(() => getTreeRender("poe1", undefined, false), [])   // 整棵只读树
<PassiveTreeCanvas
  allocatedSet={空集}
  render={wt}
  jewelRadii={[{ innerRadius:0, outerRadius:1800, socketNodeId, affectedNodeIds }]}
  nodeOverlays={Mt}          // 橙=替换 / 绿=追加 / 灰=小点
  pickedNodeIds={筛选点}      // 绿框
  onNodeClick={...} />       // 点插槽选位置 / 点天赋加筛选
```

半径 **1800** 来自 `timeless-jewel-socket-radius-CIT7jO94.js`（`const a=1800`），预计算了每个插槽 1800 半径内的节点 id 列表，并带 `near` 字段（最近天赋名）供下拉框展示。

---

## 2. 军团珠宝计算

### 2.1 静态数据

`timeless-jewels-DZPuKf-U.js` 头部即声明数据来源：

```js
{ source: "PathOfBuildingCommunity (MIT) LegionPassives + NodeIndexMapping", additionsOffset: 337 }
```

| 字段 | 内容 |
|---|---|
| `types` | 1 光彩夺目 / 2 致命的骄傲 / 3 残酷的约束 / 4 好战的信仰 / 5 优雅的狂妄 / 6 英勇悲剧 / 7 溃烂复仇 / 8 熄灭之握 / 9 噩兆统御 / 10 毁灭渴望 / 11 再造恶意 |
| `binNames` | 7~11 → `AbyssTecrod / AbyssUlaman / AbyssKurgal / AbyssAmanamu / AbyssZorath` |
| `conqType` | 1 vaal / 2 karui / 3 maraketh / 4 templar / 5 eternal / 6 kalguur / 7-11 abyss_murderous…abyss_special |
| `nodeIndex` | `{size:1937, sizeNotable:454, map:{全局nodeId → [nodeIdx, altIdx]}}`，`localToGlobal` 做深渊 id 映射 |
| `additions` / `nodes` | 两张词条定义表：`{dn, sd[], stats{key:{index,min,max,fmt}}, ks}`，`id >= 337(additionsOffset)` 为替换，否则为追加 |
| `seedMin` / `seedMax` | 每种珠宝的种子范围 |

`timeless-jewels.zh-cn-*.js` 覆盖 `dnZh` / `sdZh` / 征服者中文名。

### 2.2 LUT 下载与缓存

```js
url = `https://assets.pobzh.cn/games/poe1/timeless-jewel/${binName}.bin`
caches.open("timeless-jewel-lut-v1") → match → 命中直接用；否则 fetch 后 put
```

实测大小：

| 文件 | 大小 |
|---|---|
| LethalPride / MilitantFaith | 3.63 MB |
| BrutalRestraint | 3.41 MB |
| ElegantHubris / HeroicTragedy | 3.59 MB |
| GloriousVanity | **51.6 MB**（变长记录） |
| AbyssTecrod / Ulaman / Kurgal / Amanamu | 74.3 / 73.2 / 73.8 / 73.0 MB |
| AbyssZorath | **102.7 MB** |

### 2.3 经典珠宝（type 1–6）LUT 格式

扁平 `Uint8Array`，`Re()` 直接寻址：

```
seedCount = seedMax - seedMin + 1
index     = nodeIdx * seedCount + (seed - seedMin)      // type 5(EH): seed 先 /20
value     = lut[index]
```

- 非 GV：读 1 字节 → `id`；`id >= additionsOffset(337)` 视为**替换**，否则 **追加**。
- Glorious Vanity（type 1）是**变长记录**：先建前缀和表

```js
Le(): 对每个 nodeIdx 前缀和 prefix[idx][h] = Σ lut[idx*seedCount + i], i < h
```

  再 `offset = size*seedCount + Σ(前 u 个节点的记录长度) + prefix[u][h]`，读出 `len = lut[A+h]` 个变长字节。

### 2.4 深渊珠宝（type 7–11）容器格式

游标读取器 `B`：`u8()` / `u16()`（小端）/ `skip(n)` / `str(n)`。

```
HEADER
  0..3   magic      "ABYS"（按插槽块）或 "ABYN"（按节点块）
  4      version    = 1
  5      jewelType  必须等于请求的 type
  6..7   seedMin    u16
  8..9   seedMax    u16
  10..11 seedInc    u16（种子步长）
  seedCount = floor((seedMax - seedMin) / seedInc) + 1

ABYS：
  u8 socketCount → u16 socketId × N        // 插槽清单
  每个插槽连续 seedCount 个块，块 = $()：
      u8 n → 重复 n 次 { u16 nodeId ; q() }
ABYN：
  u16 nodeCount → u16 nodeId × N
  每个节点连续 seedCount 个块，块 = q()
  "ASCS" → u16 ascCount → { u8 len, str(len) 升华名 } 各自 seedCount 个 Ne() 块

q()  = u8 componentCount → 重复 { 3 字节头 + rollCount × u16 }
Ne() = u8 n → skip(n*2)                    // 升华：n 个 u16
解析结束时要求 r.o === buf.length
```

组件实际解码 `X()`：

```
u8 componentCount
每个组件： u8 type, u8 globalId(经 localToGlobal 映射), u8 rollCount, rollCount × u16(有符号，>=32768 则 -65536)
  type === 1 → 替换：nodes[globalId - additionsOffset]
  type === 2 → 追加：additions[globalId]
值填充：Ge() 取 rolls[stat.index - 1]，< 0 时取绝对值并以 stat.min 兜底
```

### 2.5 变换算法

主线程 `vs/rt`、Worker `J()` 为同一份逻辑：

- **Keystone**：查 `` `${conqType}_keystone_${conquerorId}` ``（回退 `_keystone`）整节点替换并改名；
- **Normal 且非 vaal**：按种族输出固定词条 —— karui `+2/+4 力量`、maraketh `+2/+4 敏捷`、kalguur `1%/2% 护卫`、templar `+5 奉献`（属性点旁则走 `templar_devotion_node`）、eternal 空节点；
- **Notable**：读 LUT → `id >= 337` 查 `additions` 替换并改名，`< 337` 查 `nodes` 追加词条；
- **GV 特例**：记录长 2/3 = 指定基石替换；长 6/8 = 前半段 `<=21 ? +1 : -1` 求和，≥0 → `Might of the Vaal`，否则 `Legacy of the Vaal`，再按 `(statId, value)` 成对累加；
- **数值回填** `L()`：把词条模板里的 `(min-max)` 占位符替换为实际值，并做单位换算
  `per_minute → /60`、`permyriad → /100`、`_ms → /1000`。

### 2.6 两种模式

**查效果（编号 → 效果）：主线程 `ws()`**

1. 下载并解析 bin；
2. 对范围内每个节点算一次（深渊要求先选插槽，因其变换与插槽绑定）；
3. 结果按 `Keystone → Notable → Normal` 排序；
4. 写入 `nodeOverlays` → canvas 画橙（替换）/ 绿（追加）/ 灰（小点）虚线圈，右侧列明细。

**找编号（词条 → 编号）：Web Worker**

主线程 `ds()` 发消息，bin 以 `ArrayBuffer` transfer 给 worker（同类型只传一次，用 `at` 去重）：

```js
{ type:"search", id, jewelType, bin, query, socketId, topN }
// query: { wants:[{tmpl,minValue,weight}], scope, nodeIds, explicitNodeIds, requireAll, minTotalWeight, conquerorId }
```

Worker 逻辑：

- 线性枚举 `seedMin → seedMax`（步长：GV=1，EH=20）；
- 每 64 次回传一次 `progress`，收到 `cancel` 时把 id 加入 `Z` 集合，循环检测到就中止；
- 匹配器 `O`：把词条行模板化（连续数字归一为 `#`，`(#-#)` → `#`）建 `Map`，命中后比较数值阈值 `minValue`；
- 计分 `weight / matches / distinctWants`，受 `requireAll`（必须命中全部词条）与 `minTotalWeight` 过滤；
- 排序 `weight ↓, distinctWants ↓, matches ↓, seed ↑`，截断 topN；
- 对前 `min(topN, 50)` 个结果回填 `details`（每个命中节点的行文本 + `matchedLineIndexes`）。

### 2.7 其他

- **粘贴识别**：纯本地正则解析物品文本（征服者名 → 珠宝类型 + 编号），不联网；
- **市集**：只调官方 `poe.game.qq.com` / `www.pathofexile.com` 的 `/api/trade/data/{leagues,stats}` 取赛季与 stat id，最终生成官方 trade 搜索 URL 跳转，不请求自建后端。

---

## 3. 关键结论

1. **天赋树不是运行时从 PoB/Lua 生成的**，而是构建期把 PoB v2.67.2 的树导出（版本 3_29）连同官方精灵图一起烘焙成静态资源；渲染层是通用 Canvas 2D 组件，靠 `jewelRadii / nodeOverlays / pickedNodeIds` 三个 props 参数化所有高亮。
2. **军团珠宝计算 = 预计算 LUT + 本地二进制解码**，把「数万种子 × 近两千节点」的穷举成本转嫁给离线生成 `.bin`（最大 103MB），前端只做 O(1) 查表和 O(种子数) 线性扫描。
3. 求值代码在主线程与 Worker **各打一份**（共享模块），主线程只做单次求值，重活进 Worker 且 bin 用 transfer 避免拷贝。
4. 数据根基是 **PoB Community 的 `LegionPassives` + `NodeIndexMapping`**，与本项目同源；若要在本地复刻，树数据和珠宝词条表可直接复用 PoB 上游，只需额外实现「种子 × 节点 → 结果」的离线枚举生成 `.bin`。

---

## 附：本地抓包文件清单（`pobzh-timeless-jewel/`）

| 文件 | 说明 |
|---|---|
| `manifest.js` | 全站路由 manifest |
| `timeless-jewel-Cqut9Zji.js` | 页面模块（主线程解码 + 求值） |
| `BuildShowcase.js` | 4MB chunk：poe1/poe2 树数据 + `getTreeRender` + `PassiveTreeCanvas` |
| `search.worker-CkprZuVP.js` | 找编号 Worker（含 poe1 节点名表） |
| `tj-data.js` | `timeless-jewels-DZPuKf-U.js` 珠宝静态数据 |
| `timeless-jewel-socket-radius-CIT7jO94.js` | 插槽半径 1800 影响节点表 |
| `passive-jewel-radius-BaTdXdvm.js` | 通用珠宝半径计算（Dijkstra 距离） |
| `api-client-Bw-NmqnX.js` / `trade.js` | 接口封装 / 官方 trade 搜索 |
