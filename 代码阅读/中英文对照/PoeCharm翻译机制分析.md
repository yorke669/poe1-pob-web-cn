# PoeCharm 翻译机制分析

> 分析对象：`/Users/xingyuke/Windows/code/ai/POE/PoeCharm`（基于 Path of Building 的汉化客户端）
> 目的：为 poe1-pob-web 的中英对照 / 汉化功能提供参考

## 1. 核心结论

PoeCharm 的翻译本质是 **“英文原文当 key 的 CSV 对照表 + 运行时字符串替换”**。

PoB 源码 / UI 里原本就写的是英文文案，PoeCharm 在渲染时把英文 key 查表替换成译文。
翻译数据全部以静态 CSV 形式存放在 `Data/Translate/<语言>/` 下，由客户端在运行时加载。

## 2. 目录与配置结构

```
Data/
├── Translate.json        # 语言注册表（声明有哪些语言）
├── Settings.conf         # 当前启用的语言开关
└── Translate/
    ├── zh-rCN/           # 简体中文（70 个 csv，最完整）
    ├── ko-KR/            # 韩文（80 个 csv）
    └── zh-rTW/           # 繁体中文（仅 19 个 csv，部分汉化）
```

### 2.1 语言注册表 `Data/Translate.json`
每项声明一种语言，包含展示名、描述、区域码和路径：

```json
[
  { "name": "中文", "description": "中文(简体)", "value": "zh-rCN", "path": "Data/Translate/zh-rCN" },
  { "name": "中文(繁體)", "description": "中文(繁體)", "value": "zh-rTW", "path": "Data/Translate/zh-rTW" }
]
```

### 2.2 当前语言开关 `Data/Settings.conf`
通过 `TranslateTL` 指定加载哪一套语言：

```ini
[PathOfBuilding]
TranslateTL=zh-rCN
```

## 3. CSV 对照表格式

每个文件是 **`英文Key,译文`** 两列，文件名对应 PoB 的 UI 模块 / 数据类别。

```csv
All,全部
Set Name,设定名称
"Delete All",删除全部
"Requires Level {0}","需求 等级 {0}"
"Can support Strength threshold jewels","可以选择 ^xE05030力量 ^7门槛珠宝"
```

### 关键规则
- **key 含逗号 / 特殊字符时用双引号包裹**（如 `"Delete All"`）。
- **`{0}` 占位符原样保留**：运行时由 PoB 注入动态数值，翻译时不能改动。
- **`^xRRGGBB` 颜色码原样保留**：这是 PoB 的文本着色语法（如 `^xE05030红 ^7`），翻译时只改文字不改颜色标记。
- 空行可留白，用于对齐维护，不影响加载。
- 部分 key 带有前导制表符（ko-KR 的 `statDescriptions` 中存在），替换时需连同前导空白一并匹配。

## 4. 翻译内容分类

对照表按内容性质分三类，覆盖 UI 文案、游戏数据、天赋树：

| 类别 | 代表文件 | 说明 |
|------|----------|------|
| ① 纯 UI 文案 | `GUI.csv`、`Main.csv`、`CalcSections.csv`、`CalcsTab.csv`、`TreeTab.csv`、`ImportTab.csv`、`ConfigTab.csv` | 界面对话框、按钮、计算面板标题等 |
| ② 物品 / 数据 | `Items_*.csv`、`Gems_*.csv`、`Gems_data.csv`、`Uniques.txt.csv`、`stats_words_prefix.csv`、`stats_words_suffix.csv`、`Flask_tag.csv`、`Monsters.csv` | 传奇译名（如 `Astramentis,均衡之符`）、词缀前缀后缀、宝石名等 |
| ③ 天赋树节点 | `passiveTree.csv`、`tree_dn.csv`、`tree_sd.csv`、`tree_rt.csv` | 力量 / 敏捷 / 智慧、火 / 冰 / 电抗性等节点名 |

## 5. 语言覆盖度差异

- `zh-rCN`：70 个 csv，覆盖最全（UI + 物品 + 词缀 + 天赋树）。
- `ko-KR`：80 个 csv，除通用模块外还有按版本 / 物品细分的文件（如 `3.23_고난리그_고유.csv`、各类武器单独成表）。
- `zh-rTW`：仅 19 个 csv，为部分汉化，缺少大量 UI 与计算模块。

说明翻译是**渐进式维护**的：新增 UI / 新版本内容时，往对应 csv 追加 key-value 即可，无需改动程序逻辑。

## 6. 与 poe1-pob-web 的关联

poe1-pob-web 在浏览器中运行上游 PoB 的 Lua 代码，可借鉴 PoeCharm 的对照表思路实现中英对照 / 汉化：

1. **复用现成语料**：PoeCharm 的 `zh-rCN/*.csv` 已是高质量的「英文原文 → 中文」对照表，可直接作为 Web 版汉化数据源（比纯机翻准确，尤其词缀 / 传奇名 / 天赋节点）。
2. **实现差异**：PoeCharm 是 **C++ 客户端侧**做字符串拦截；Web 版需要在 **Lua↔JS 桥接层**（packages/driver、packages/game）注入一层“英文 key → 译文”的替换逻辑，才能使 UI 文案、物品名、天赋节点显示中文。
3. **数据格式转换**：可将 CSV 转为 Web 友好的 JSON（按模块拆分，或合并为单一映射表），保留 `{0}` 与 `^x` 标记由运行时处理。

## 7. 移植到 poe1-pob-web 的可行性

### 7.1 结论：可行，且比 PoeCharm 更简单

poe1-pob-web 的渲染管线是：

```
PoB Lua
  → DrawString(x,y,align,height,font,text)   [C/WASM 全局函数, packages/driver/src/c/draw.c]
  → 写入字节缓冲（DrawStringCommand）
  → DrawCommandCompiler 解码 (packages/driver/src/js/draw.ts)
  → Renderer.drawString → 按颜色分段 → GlyphAtlas.draw (packages/driver/src/js/renderer/renderer.ts + text.ts)
  → 浏览器 Canvas 2D fillText 光栅化字形到图集纹理
```

最干净的 hook 点在 **`boot.lua`**：`DrawString` 是以 Lua 全局函数形式注册的（`lua_setglobal(L, "DrawString")`），PoB 主程序以全局方式调用它。`boot.lua` 本身已是 SimpleGraphic 的适配层，且已有“包裹全局函数”的成熟模式（`mainObject` 的方法就是在 `boot.lua` 里被包裹重写的，见 `OnInit`/`ShowErrMsg`）。因此无需改动上游 PoB 的 Lua、也无需重编 C/WASM，只要在 `boot.lua` 里包裹 `DrawString`（以及 `DrawStringWidth`、`DrawStringCursorIndex`）即可。

### 7.2 需要实现的三个部分

| 部分 | 做法 | 侵入性 |
|------|------|--------|
| ① 字符串替换层（核心机制） | 在 `boot.lua` 包裹 `DrawString`/`DrawStringWidth`/`DrawStringCursorIndex`，对文本做 `T(text) = table[StripEscapes(text)] or text` 查表替换 | 仅改 `boot.lua`，零上游改动 |
| ② 中文字体 | 加载一款 CJK 网页字体（如 Noto Sans SC 的 woff），并在 `text.ts` 的 `font()` 里把它作为**回退字体**追加到每个字体族列表（如 `"Fontin Regular", "Noto Sans SC", sans-serif`）。浏览器按字形回退，英文走 Fontin、中文走 CJK 字体，无需逐字逻辑 | 仅改 `text.ts` |
| ③ 翻译数据 | 将 PoeCharm 的 `zh-rCN/*.csv` 合并为一张「去转义后的英文 → 中文」映射表，在 `boot.lua` 启动时加载（可内嵌或作为 lua 数据文件放到 `/app/root/lua/`） | 新增数据文件 |

### 7.3 关键陷阱（与 PoeCharm 一致，必须处理）

1. **查表前必须先 `StripEscapes`**：PoB 原文里很多文案带 `^xRRGGBB` / `^#` 颜色码（如 `"Can support ^xE05030Strength ^7threshold jewels"`），但 PoeCharm 的 CSV **key 不带颜色码**。所以查表 key 必须是 `StripEscapes(text)`，`boot.lua` 里已存在该函数，直接复用即可。译文里再按需自带自己的颜色码。
2. **`DrawStringWidth` 也必须替换**：PoB 用它在布局前测量文本宽度。若只替换 `DrawString` 而不替换宽度测量，中文比英文宽，会导致文字被裁切/重叠。PoeCharm 同样同时 hook 了两者。
3. **`{0}` 占位符的限制**：与 PoeCharm 一样，CSV key 里 `"Requires Level {0}"` 这类模板在运行时已被 `string.format` 替换为 `"Requires Level 60"`，精确匹配会失效。这类动态模板占比小，可逐步用模糊/正则匹配补齐，MVP 先覆盖静态文案即可。
4. **`DrawStringCursorIndex`**（输入框光标定位）：搜索框等需要 IME/光标正确性的场景，建议一并替换，否则中文输入时光标错位。

### 7.4 相比 PoeCharm 的优势

- PoeCharm 需自带 `freetype.dll`/`harfbuzz.dll`/`FZ_ZY.ttf` 做 CJK 整形；Web 端直接用浏览器 Canvas `FontFace` + 字体回退，**免去 freetype/harfbuzz 依赖**。
- 替换层是纯 Lua 字符串查表，不碰 C/WASM，调试与热更新都更方便。
- 翻译数据源可直接复用 PoeCharm 已校验的 `zh-rCN` 语料，质量远高于机翻。

### 7.5 风险与待确认

- 翻译表加载方式（内嵌 `boot.lua` vs 独立 lua 数据文件）取决于 web 构建如何打包 `/app/root/lua/` 下的额外文件，需确认打包链路。
- 字体文件体积（CJK woff 通常数 MB）需做子集化或按需加载，避免首屏过大。
- 物品名 / 宝石名等来自数据文件的动态字符串，PoeCharm 用 `Items_*.csv`/`Gems_*.csv` 覆盖，可直接复用同名 CSV 作为 key。

## 8. 自动同步脚本（已实现，Python + 分文件）

> 文件：`tools/translate/sync-from-poecharm.py`（Python 3）

**作用**：每次运行，从 PoeCharm 的 `Data/Translate/zh-rCN/*.csv` 重新生成 pob-web 的翻译数据文件。
因为后续 PoB 版本升级时 PoeCharm 的汉化必然变化，所以提供“一键重新拷贝”的脚本，保证语料始终与上游同步。

**改为分文件的原因**：
- 合并成单文件后，难以直观看出“某个 CSV 里哪些 key 没生效、哪些 CSV 根本没被 PoB 使用”；
- 保持 `CSV 文件名 ↔ Lua 文件名` 一一对应，方便逐文件对照检查缺漏。

**原理**：
1. 递归读取 `zh-rCN/*.csv`，用 Python 标准库 `csv.reader` 处理带引号/逗号的字段；
2. 对**每个 key 做 `strip_escapes`**（去掉 `^xRRGGBB` / `^#` 颜色码）——因为运行时 PoB 传入 `DrawString` 的文本带颜色码，而 CSV key 不带，查表前必须去转义才能命中；
3. **每个 csv 输出一个同名 Lua 表文件**（如 `Gems_data.txt.csv` → `packages/driver/translate/Gems_data.txt.lua`），内容 `return { ["key"] = "value", ... }`；
4. 额外生成 `translate_manifest.lua`，列出所有生成的 Lua 文件名，供 `boot.lua` 按名加载；
5. 译文里的 `^x` 颜色码与 `{0}` 占位符原样保留，由运行时处理。

**运行**：
```bash
# 默认源 = $POECHARM_TRANSLATE_DIR 或 /Users/.../PoeCharm/Data/Translate/zh-rCN
# 默认产物 = packages/driver/translate/*.lua + translate_manifest.lua
python3 tools/translate/sync-from-poecharm.py
# 也可（显式指定源目录与输出目录）：
cd /Users/xingyuke/Windows/code/ai/POE/poe1-pob-web && python3 tools/translate/sync-from-poecharm.py /Users/xingyuke/Windows/code/ai/POE/PoeCharm/Data/Translate/zh-rCN packages/driver/translate
cd /Users/xingyuke/Windows/code/ai/POE/poe1-pob-web && python3 tools/translate/sync-from-poecharm.py /Users/xingyuke/Windows/code/ai/POE/PoeCharm/Data/Translate/zh-rCN packages/driver/translate

```

**产物**：70 个 Lua 文件 + `translate_manifest.lua`（共 70470 条）。已验证：key 无 `^x` 残留，文件命名与源 CSV 完全一致。

## 9. MVP 改造方案（已实现最小闭环）

集成思路（改的是仓库自有代码，未动上游 PoB）：

| 改动点 | 文件 | 内容 |
|--------|------|------|
| ① 字符串替换层 | `packages/driver/boot.lua` | 从 `translate_manifest.lua` 读取文件列表，用 `loadfile("lua/<file>")` 逐个加载并合并；包裹 `DrawString`/`DrawStringWidth`/`DrawStringCursorIndex`：`T(text)=translateTable[StripEscapes(text)] or text`；加载失败则静默跳过，绝不崩应用 |
| ② 数据注入 | `packages/packer/src/pack.ts` | 打包 `root.zip` 时，将 `packages/driver/translate/*.lua` 注入到 `lua/` 目录（与上游 `runtime/lua` 同路径），使 `boot.lua` 能加载；并让打包缓存随该目录变化失效 |
| ③ 中文字体 | `packages/driver/src/js/renderer/text.ts` | 在 `font()` 的每个字体族后追加 CJK 回退栈 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif`，浏览器按字形回退，无需额外字体资源 |

**为什么这样集成可靠**：
- `driver.c` 先 `draw_init(L)` 注册 `DrawString` 全局，再 `dofile(boot_lua)` 运行 `boot.lua` → 包裹发生在全局注册之后，不会被覆盖；
- `boot.lua` 已是 SimpleGraphic 适配层且有包裹全局函数的先例，属于仓库自有代码；
- 翻译数据走 `root.zip`（ZenFS 挂载）加载，与上游 `Launch.lua` 同源，不修改上游 PoB；
- 用 `loadfile` 而非 `require` 加载翻译文件，避免 Lua 把文件名中的 `.` 解析为目录分隔符（例如 `Gems_data.txt` 不会被当成 `Gems_data/txt`）；
- 字体用系统/浏览器回退，**免去 PoeCharm 那套 freetype/harfbuzz DLL**。

## 10. 验证方式

- 静态校验已通过：`deno check packages/packer/src/pack.ts`、`deno check packages/driver/src/js/renderer/text.ts`、`python3 tools/translate/sync-from-poecharm.py` 均能正常生成。
- 端到端验证（需本机环境）：
  1. `mise run setup`（首次，装依赖 / 子模块 / WASM 工具链）；
  2. 运行 `python3 tools/translate/sync-from-poecharm.py` 生成分文件翻译数据；
  3. 重新打包使所有 `.lua` 进入 `root.zip`（`mise run pack --game poe1 --tag v2.67.2` 或把 `packages/packer/build/poe1/v2.67.2/root.zip` 拷贝到 `packages/packer/r2/games/poe1/versions/v2.67.2/root.zip` 并解压 `root/`）；
  4. `mise run driver:dev --game poe1 --version v2.67.2` 启动 driver，浏览器打开 PoB 界面；
  5. 预期：UI 文案（按钮、面板标题、词缀、物品名、天赋节点）显示中文；英文原文作为 key 无命中时仍显示英文（优雅降级）。

## 11. 已知限制与后续

- **`{0}` 动态模板**：运行时已被 `string.format` 替换（如 `"Requires Level 60"`），精确 key 匹配失效。占比小，可后续用“先去数字/去格式化再查表”或正则补齐。
- **字体回退质量**：依赖用户系统装有 CJK 字体（macOS PingFang / Windows YaHei）。若要跨平台一致，可改为加载一款 CJK woff（如 Noto Sans SC）并在 `loadFonts()` 注册。
- **数据体积**：67k 条目 / 6.4MB，zip 后尚可；后续可只保留 UI 相关 key、或按需懒加载进一步瘦身。
- **语言切换 UI**：当前写死 zh-rCN；可参照 PoeCharm 的 `Translate.json`+`Settings.conf` 做多语言注册与切换界面。
- **增量同步**：版本升级后重跑脚本，产物按 key 排序、确定性输出，可直接 `git diff` 看出本次翻译变化。
