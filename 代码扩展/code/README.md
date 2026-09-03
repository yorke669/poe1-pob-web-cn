# pob-web 自定义功能维护指南

> **给 AI / 开发者**：版本升级后，照本文档把自定义功能重新接入新代码。
> 设计原则：**实现独立维护，上游只留接口**。入侵修改从 +1012 行降到 **+32 行**（仅 boot.lua）。
>
> ⚠️ **改 `boot.lua` 或 `driver.c` 后必须重编译 wasm**：`mise run driver:build`（仅重启 dev 无效）。

---

## 一、目录结构与文件去向

```
代码扩展/code/
├── README.md                 ← 本文档（唯一说明）
├── translate_zh.lua          → packages/driver/translate/translate_zh.lua
├── getBuildStats_impl.lua    → packages/driver/translate/getBuildStats_impl.lua
├── FloatingStatsButton.tsx   → packages/driver/src/js/overlay/FloatingStatsButton.tsx
├── boot_interface.lua        → 内容插入 boot.lua（不拷贝）
└── invasions/                ← 其余入侵修改的 patch（boot.lua 不用 patch，见 §3）
    ├── driver.c.patch
    ├── driver.ts.patch
    ├── worker.ts.patch
    ├── OverlayContainer.tsx.patch
    ├── text.ts.patch
    └── pack.ts.patch（可不用，见 §4.7）
```

### 一键拷贝（3 个实现文件）

```bash
bash 代码扩展/scripts/copy-code.sh
```

映射逻辑：
```
code/translate_zh.lua        → packages/driver/translate/translate_zh.lua
code/getBuildStats_impl.lua  → packages/driver/translate/getBuildStats_impl.lua
code/FloatingStatsButton.tsx → packages/driver/src/js/overlay/FloatingStatsButton.tsx
```

### 翻译词条（另外生成，不在此目录）

```bash
python3 代码扩展/scripts/generate-translate.py   # data/zh-rCN/*.csv → packages/driver/translate/*.lua + translate_manifest.lua
```

---

## 二、修改类型定义

| 类型 | 说明 | 维护方式 |
|------|------|---------|
| **新增文件（A）** | 全新文件，不碰上游代码 | 直接 `cp` |
| **入侵修改（M）** | 改了上游已有文件 | 应用 patch 或按 §4 手工改 |

### 当前入侵修改总览（7 个文件）

| # | 文件 | 行数 | 状态 | 是否必须 |
|---|------|------|------|---------|
| 1 | `packages/driver/boot.lua` | **+32** | 已改造为接口层 | ✅ 必须（已优化） |
| 2 | `packages/driver/src/c/driver.c` | +49 | patch 已还原 | ✅ 必须 |
| 3 | `packages/driver/src/js/driver.ts` | +24 | patch 已还原 | ✅ 必须 |
| 4 | `packages/driver/src/js/worker.ts` | +20 | patch 已还原 | ✅ 必须 |
| 5 | `.../overlay/OverlayContainer.tsx` | +10 | patch 已还原 | ✅ 必须 |
| 6 | `packages/driver/src/js/renderer/text.ts` | +18 | patch 已还原 | ✅ 必须（CJK 字体） |
| 7 | `packages/packer/src/pack.ts` | +16 | patch 已还原 | ⭕ 可用脚本替代 |

> **当前工作区状态**：#1 已应用（273 行），#2-#7 已还原为上游原始版。
> 需要功能完整时，按 §4 应用 #2-#7。

---

## 三、boot.lua 改法（改动 #1，已完成）

### 原始结构（main 分支，241 行）

| 行号 | 内容 |
|------|------|
| 1-54 | 基础设置（`package.path`、`unpack`、`bit`、`setfenv`、`arg`、`jit`、`coroutine.yield`） |
| 55-140 | 全局函数（`LoadModule`、`PLoadModule`、`DrawString` 相关等） |
| **142** | `dofile("Launch.lua")` ← 启动 PoB |
| 147 | `local mainObject = GetMainObject()`（**局部**变量） |
| 161/187 | `installOAuthLogoutHook` / `runCallback` |
| 198 | `function loadBuildFromCode(code)` |
| **225-241** | `function getBuildCode()` ← 文件末尾 |

### 改动（2 处，取自 `boot_interface.lua`）

**Part A —— 插入第 142 行 `dofile("Launch.lua")` 之前**（净增 6 行）：

```lua
-- [pob-web] 加载翻译实现（必须在 Launch 之前：要 hook DrawString 等绘制函数）
local translateOk, translateErr = pcall(require, "translate_zh")
if not translateOk then
    print("[translate] zh-rCN layer DISABLED: " .. tostring(translateErr))
end

dofile("Launch.lua")
```

> **为什么必须在 Launch 前**：翻译层要 hook `DrawString`/`DrawStringWidth`/`DrawStringCursorIndex`，
> PoB 启动后立即绘制，晚于 Launch 则早期文本翻译不到。

**Part A.1 —— 插入 `mainObject["OnInit"] = function(self)` 中的 `onInit(self)` 之后**（净增 5 行）：

```lua
-- self.main only exists after launch:OnInit has run, so this is the earliest
-- point where the WrapString wrapper can be installed.
if _G.installPobWebWrapStringHook then
    _G.installPobWebWrapStringHook(self.main)
end
```

> **为什么必须加**：浮华珠宝长句必须先经过 `main:WrapString` 整句翻译再拆行；
> 少了这段，`T()` 只能拿到碎片（如 `Magic` / `Jewels`），会复现半中半英。

**Part B —— 追加到文件末尾（`getBuildCode()` 之后）**（净增 21 行）：

```lua
-- [pob-web] 加载属性读取实现
local statsOk, statsErr = pcall(require, "getBuildStats_impl")
if not statsOk then
    print("[stats] getBuildStats_impl not loaded: " .. tostring(statsErr))
end

-- [pob-web] 接口函数声明：C 层 driver.c 通过 lua_getglobal 调用这两个名字
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
```

### 改动后结构（273 行）

```
1-54     基础设置                       （不动）
55-140   全局函数                       （不动）
141-148  [Part A] require translate_zh   ← 新增
150      dofile("Launch.lua")            （不动）
...      原有函数                        （不动）
225-241  getBuildCode()                  （不动）
247-273  [Part B] require impl + 接口声明 ← 新增
```

### 关键坑：mainObject 是局部变量

`boot.lua` 第 147 行 `local mainObject` 是**局部**的，独立文件访问不到。
**已在 `getBuildStats_impl.lua` 内部解决**（不碰 boot.lua）：

```lua
_G.getBuildStats_impl = function()
    local mainObject = GetMainObject()   -- 自行调用全局函数获取
    if not mainObject.main then ... end
```

---

## 四、其余入侵修改改法（#2-#7）

上下文未变时直接 apply：

```bash
cd 代码扩展/code/invasions
git apply driver.c.patch driver.ts.patch worker.ts.patch \
          OverlayContainer.tsx.patch text.ts.patch
```

失败时用 `git apply --reject xxx.patch` 定位，再按下面逐条手工改。

### 4.1 driver.c（+49，C 接口层）

**位置**：文件**末尾**（`get_build_code()` 之后追加）
**内容**：2 个静态缓冲 + 2 个 `EMSCRIPTEN_KEEPALIVE` 函数

```c
static char *s_build_stats = NULL;
static char *s_item_compare_stats = NULL;

EMSCRIPTEN_KEEPALIVE
const char* get_build_stats() { /* lua_getglobal "getBuildStats" → pcall → 复制返回值 */ }

EMSCRIPTEN_KEEPALIVE
const char* get_item_compare_stats(const char *slot_name, const char *item_raw) { /* 同理，2 个参数 */ }
```

改完**必须重编译 wasm**。

### 4.2 driver.ts（+24，TS 接口层）

**4 处改动**：

| 位置 | 修改 |
|------|------|
| `Driver` 构造函数（~359 行） | 新增 `console.log("[FloatingStatsButton] driver overlay initial render", ...)` |
| **首次** `render()`（~373 行） | 传 `onGetStats` / `onGetItemCompareStats` |
| `getBuildCode()` 后（~440 行） | 新增 `async getBuildStats()` / `async getItemCompareStats()` |
| `updateOverlayWithTransform()`（~512 行） | 再次传这两个回调 |

```typescript
async getBuildStats(): Promise<string> {
  const stats = await this.driverWorker?.getBuildStats();
  if (!stats) throw new Error("getBuildStats failed");
  return stats;
}
```

> ⚠️ **踩过的坑**：首次 `render()` 也必须传 `onGetStats`，否则悬浮球初始不渲染。

### 4.3 worker.ts（+20，cwrap 绑定）

**3 处改动**：

| 位置 | 修改 |
|------|------|
| `type Imports`（~54 行） | 新增 `getBuildStats` / `getItemCompareStats` 类型 |
| `DriverWorker` 类（~262 行） | 新增两个 `async` 方法转发到 `this.imports` |
| `resolveImports()`（~341 行） | 新增两行 `cwrap` |

```typescript
getBuildStats: module.cwrap("get_build_stats", "string", []),
getItemCompareStats: module.cwrap("get_item_compare_stats", "string", ["string", "string"]),
```

### 4.4 OverlayContainer.tsx（+10，UI 注入）

**4 处改动**：import 区、`OverlayContainerProps` 接口、解构参数、渲染区、`ReactOverlayManager.render` 类型联合。

```tsx
import { FloatingStatsButton } from "./FloatingStatsButton.tsx";
// ...
{onGetStats && onGetItemCompareStats && (
  <FloatingStatsButton onGetStats={onGetStats} onGetItemCompareStats={onGetItemCompareStats} />
)}
```

**依赖**：`FloatingStatsButton.tsx` 必须已 cp 到同目录。

### 4.5 text.ts（+18，CJK 字体 —— 无法提取，必须改）

**位置**：`font()` 函数内（~29 行），`switch (fontNum)` 之前

```typescript
const cjk = ', "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif';
// 7 个 case 的 return 全部改为：return `${fontSize}px XXX${cjk}`;
```

**为什么不能提取**：渲染层字体选择，无接口可 hook。
**不加的后果**：中文全部渲染成豆腐块（□）。

### 4.6 boot.lua（见 §3）

### 4.7 pack.ts（+16，⭕ 推荐用脚本替代，去掉这个入侵）

**原改动**：遍历 `packages/driver/translate/*.lua` 打进 zip 的 `lua/` 下。

**✅ 推荐替代**（不改 pack.ts）：用 `tools/merge/translate-inject.ts` 把 lua 复制到
`packages/packer/r2/games/{game}/versions/{tag}/root/lua/`，
pack.ts **原有的** `walk(luaPath)` 会自动打包。

---

## 五、功能调用链

```
悬浮球 (FloatingStatsButton.tsx)              [新增]
    ↓ onGetStats()
driver.ts  getBuildStats()                    [#3]
    ↓
worker.ts  → cwrap("get_build_stats")         [#4]
    ↓
driver.c   get_build_stats()                  [#2]
    ↓ lua_getglobal
boot.lua   getBuildStats() → _G.xxx_impl()    [#1]
    ↓
getBuildStats_impl.lua（读 PoB 数据返回 JSON） [新增]

中文显示链路：
boot.lua → require translate_zh → hook DrawString   [#1]
text.ts CJK 字体 fallback                            [#5，否则豆腐块]
```

**最小必要入侵集**（无法消除）：#2+#3+#4+#5 = 121 行。
**已优化**：#1 从 875 行 → 32 行。**可去掉**：#7。

---

## 六、完整升级流程

```bash
# 1. 拉取上游新版本
git pull origin main

# 2. 拷贝独立实现文件
bash 代码扩展/scripts/copy-code.sh

# 3. 生成翻译词条
python3 代码扩展/scripts/generate-translate.py

# 4. 改 boot.lua（按 §3 插入 Part A / Part B）

# 5. 应用其余入侵修改
cd 代码扩展/code/invasions
git apply driver.c.patch driver.ts.patch worker.ts.patch \
          OverlayContainer.tsx.patch text.ts.patch
cd ../../..

# 6. 重新编译（boot.lua + driver.c 改动必须）
mise run driver:build

# 7. 启动验证
mise run driver:dev --game poe1 --version <新版本>
```

---

## 七、验证清单

- [ ] 控制台出现 `[translate] zh-rCN layer ACTIVE`
- [ ] 无 `[translate] zh-rCN layer DISABLED`
- [ ] 界面中文正常，**非豆腐块**
- [ ] 悬停物品/技能 tooltip 显示中文
- [ ] 悬浮球显示、点击展开
- [ ] 「获取当前属性」返回 JSON
- [ ] 装备对比返回 before/after 差异

**排查** `DISABLED`：
1. `packages/driver/translate/translate_zh.lua` 是否存在
2. `packages/driver/translate/translate_manifest.lua` 是否存在且包含模块列表
3. 翻译词条是否已生成
4. 翻译文件是否已同步到 `packages/packer/r2/games/{game}/versions/{tag}/root/lua/`
5. `package.path` 是否含 `/app/root/lua/?.lua`（boot.lua 第 3 行）

**排查** `loaded X modules, Y failed`：
- 若报 `']' expected near '\\'` / `'}' expected near char(...)`，通常是 CSV 转 Lua 的转义错误。
- 必须用 Python `csv.reader` 解析 CSV，并用 `lua_string()` 转义 `\\`、`"`、换行；不要手写 `split(',')`。
- 修复后重新运行：`python3 代码扩展/scripts/generate-translate.py`，再把 `packages/driver/translate/*.lua` 同步到 `root/lua/`。

**悬浮球不显示**：检查 driver.ts 首次 `render()` 是否传了 `onGetStats`（§4.2 的坑）。

---

## 八、当前状态速查

| 项 | 状态 |
|----|------|
| boot.lua | ✅ 已改造（273 行，+32） |
| driver.c / driver.ts / worker.ts | ⬜ 已还原，需 apply patch |
| OverlayContainer.tsx | ⬜ 已还原，需 apply patch |
| text.ts | ⬜ 已还原，需 apply patch（否则豆腐块） |
| pack.ts | ⬜ 已还原，推荐用注入脚本替代 |
| 实现文件（3 个） | ✅ 已拷贝到位 |
| 翻译词条 | ✅ 已生成（71 个） |
