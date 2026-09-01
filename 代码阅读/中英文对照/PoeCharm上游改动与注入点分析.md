# PoeCharm 上游改动与注入点分析（逆向调查）

> 调查对象：`/opt/poe/PoeCharm/`（二进制发行版，无源码） 方法：PE 导出表解析、exe/DLL 字符串提取、内嵌 Lua 源码扫描
> 日期：2026-09-01 前置文档：`PoeCharm翻译机制分析.md`（翻译数据组织）、`物品信息未翻译根因分析.md`（我们自己的机制 A/B
> 差距）

---

## 1. 核心结论

PoeCharm 的「不改上游」实际是 **「上游改动收敛到约 6 个文件的一行级注入 + C++ 外挂引擎」**：

1. `PoeCharm3.exe` 是**重新编译的宿主**（Qt 构建，约 16MB），上游 PoB 的 Lua 源码以**明文**形式内嵌在 exe 中；
2. 内嵌源码中只有少数文件被修改，每处改动仅一两行，全部是「把字符串递给 C++ 提供的 `charm` 桥接表」；
3. 翻译查表引擎、CJK 渲染完全在 C++ 侧（exe + `SimpleGraphicExtend.dll`）实现；
4. 翻译数据（CSV）与语言配置（JSON/CONF）作为纯数据外置，与程序逻辑解耦。

这与我们仓库的约束（上游 PoB 代码不可改，行为在自有包内实现）精神一致，但 PoeCharm
有编译期优势：它可以把改动直接烧进内嵌源码；Web 版则需在 `boot.lua` / driver 层做等价注入。

---

## 2. 证据与文件清单

### 2.1 目录布局

```
PoeCharm/
├── PoeCharm3.exe            # 重新编译的宿主（Qt），内嵌明文 PoB Lua 源码
├── SimpleGraphicExtend.dll  # SimpleGraphic 渲染层替换实现（含翻译 API 注册）
├── loadall.dll              # Lua C 模块加载器
├── libquickjs.dll           # JS 引擎（trade 相关功能）
├── freetype.dll / harfbuzz.dll / fribidi-0.dll   # CJK 整形 + 双向文本
├── Data/
│   ├── Translate.json       # 语言注册表
│   ├── Settings.conf        # [PathOfBuilding] TranslateTL=zh-rCN
│   ├── Fonts/               # FZ_ZY.ttf（方正准圆）+ Fontin/Liberation .tgf
│   └── Translate/
│       ├── zh-rCN/          # 70 个 csv
│       ├── ko-KR/           # 80 个 csv
│       └── zh-rTW/          # 19 个 csv（部分汉化）
```

### 2.2 关键字符串证据（exe 内偏移）

| 偏移                       | 证据                                                                                                      | 含义                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `0xD73648` (14100936) 附近 | `...if self:match(orPattern) then...if charm.TranslateMatch(self,orPattern) then...Modules/Common.lua...` | 内嵌 Lua 明文 + 注入点实锤              |
| `0xD75D10` (14112296)      | `/Launch.lua`、`/manifest.xml`、`/Translate.json`、`Parser Pob version file filed`                        | exe 自行管理版本文件与语言注册表        |
| `0xD77640` (14119936)      | `PathOfBuilding/TranslateTL..zh-rCN..UTF-8`                                                               | 读 `Settings.conf`，缺省硬编码 `zh-rCN` |
| exe @13284560              | `SimpleGraphicExtend.dll`（后随压缩数据块）                                                               | exe 显式加载 SGX                        |

### 2.3 内嵌 Lua 中出现的全部 `charm.*` 调用（穷举）

```
charm.Translate            charm.TranslateItemText   charm.TranslateItems
charm.TranslateMatch       charm.TranslatePassiveSkills
charm.UrlEncode            charm.UrlDecode
```

注入点分布（按文件）：

| 上游文件                         | 注入内容                                                                                                    | 作用                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Classes/ItemsTab.lua`           | `controls.edit.pasteFilter = function(text) return sanitiseText(charm.TranslateItemText(text)) end`         | **粘贴物品文本时整体翻译**（物品 tooltip 中文化的主通道）  |
| `Modules/Common.lua`（宝石搜索） | `charm.Translate(key)` 翻译宝石 tag；`(" "..charm.Translate(gemData.name:lower())):match(pattern)`          | 中文可搜宝石；tag 双写（原名+译名）避免查表失败            |
| `Modules/Common.lua`（通用搜索） | 在 `if self:match(orPattern) then` 旁新增 `if charm.TranslateMatch(self,orPattern) then`                    | 搜索框支持中文模糊匹配                                     |
| `Classes/ImportTab.lua`          | `ProcessJSON(charm.TranslateItems(realm, json))` / `ProcessJSON(charm.TranslatePassiveSkills(realm, json))` | 官方 API 拉回的角色物品/天赋 JSON **先翻译再解析**         |
| `Classes/ImportTab.lua`          | `charm.UrlEncode(accountName, "%")` / `charm.UrlDecode(...)`                                                | 中文账号名 URL 编码                                        |
| `Modules/Main.lua`               | `self.unicode = type(_G.charm) == "table"`                                                                  | 用 `charm` 是否存在开启 unicode 模式（原版检测 `_G.utf8`） |

---

## 3. C++ 侧能力（从 DLL 符号/字符串还原）

### 3.1 SimpleGraphicExtend.dll

- 重新实现 SimpleGraphic 全套渲染 API：`DrawString` / `DrawStringWidth` /
  `DrawStringCursorIndex`（含完整参数校验错误串与 Usage 串），另有 `LoadModule` / `PLoadModule`、`LaunchSubScript` 等；
- 动态加载 `freetype.dll` + `harfbuzz.dll`（CJK 整形）+ `fribidi-0.dll`（双向文本 `fribidi_get_bidi_types` 等）；
- 字体栈：`Fontin` / `Fontin Italic` / `Fontin SmallCaps` ... + `Data/Fonts/FZ_ZY.ttf`（中文字形）；
- 颜色码处理：字符串区可见 `["%s^7"] =`、`^x`、`^7` 等，说明 C++ 侧自行做颜色码剥离与还原（对应我们 boot.lua 的
  `StripEscapes`）。

### 3.2 翻译 API 语义（由 Usage 串推断）

| API                                      | 签名                                   | 用途                                  |
| ---------------------------------------- | -------------------------------------- | ------------------------------------- |
| `Translate(text)`                        | `Usage: Translate(text)`               | 通用精确查表                          |
| `TranslateMatch(text, keyword)`          | `Usage: TranslateMatch(text, keyword)` | 模糊/模式匹配翻译（用于搜索命中译文） |
| `TranslateItemText(text)`                | 单参                                   | 物品文本块整体翻译                    |
| `TranslateItems(realm, strJson)`         | 双参                                   | 角色物品 JSON 整体翻译                |
| `TranslatePassiveSkills(realm, strJson)` | 双参                                   | 天赋树 JSON 整体翻译                  |

### 3.3 模板占位符的归一化在 C++ 匹配侧

- PoB 源数据 `Data/StatDescriptions/stat_descriptions.lua` 有 951 处 `{0:+d}`；
- PoeCharm 的 `zh-rCN/statDescriptions.csv`（4.8MB）`{0:+d}` 出现 **0** 次，全是简化 `{0}`；
- 结论：格式说明（`:+d`/`:d`）的剥离与还原在 C++ 匹配层完成，CSV 只存简化 key。

---

## 4. 数据组织（与《PoeCharm翻译机制分析.md》互补确认）

- `Data/Translate.json`：语言注册表（name/description/value/path）；
- `Data/Settings.conf`：`[PathOfBuilding] TranslateTL=zh-rCN`；exe 内另有硬编码默认 `zh-rCN` 兜底（偏移 14119936
  处可见）；
- CSV 格式：`English,Chinese` 两列，含逗号/特殊字符的 key 用双引号包裹；`{0}` 占位符与 `^xRRGGBB` 颜色码原样保留。

---

## 5. 与 pob-web 方案的对照

| 维度          | PoeCharm（桌面）                                                                                | pob-web（浏览器）现状/计划                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 注入点        | 编译期改内嵌 Lua（6 文件，行级）                                                                | `boot.lua`（仓库自有代码，已 hook DrawString = 机制 A）                                                                      |
| UI 文本翻译   | C++ `Translate` 查表（渲染前）                                                                  | 机制 A：DrawString hook 查表（已实现）                                                                                       |
| 物品 mod 描述 | **粘贴/JSON 入口即整体翻译**（`TranslateItemText`/`TranslateItems`），早于 StatDescriber 格式化 | 机制 B 缺失：计划 hook `LoadModule`，翻译 `Data/StatDescriptions/*` 的 `text` 模板（见《物品信息未翻译根因分析.md》第 5 节） |
| 占位符归一化  | C++ 匹配层做 `{0:+d}` → `{0}` → 还原                                                            | 计划一致：`normalise → 查表 → restore`                                                                                       |
| 中文渲染      | freetype + harfbuzz + fribidi + FZ_ZY.ttf                                                       | 浏览器 Canvas 字体回退栈（`text.ts` 已加 CJK 回退，免 DLL）                                                                  |
| 中文搜索      | `TranslateMatch` 模糊匹配                                                                       | 未实现；可借鉴：查表 key 归一化后双向匹配                                                                                    |
| 语料          | `zh-rCN/*.csv` 70 个                                                                            | `tools/translate/sync-from-poecharm.py` 已 1:1 同步为 Lua 表（70470 条）                                                     |

### 5.1 对我们方案的修正与印证

1. **印证**：statDescriptions 模板层（机制 B）必须做，且「先归一化再查表、命中后还原格式」的两步法与 PoeCharm
   的数据形态（纯 `{0}` CSV）互为印证；
2. **修正**：PoeCharm 的物品翻译不只靠渲染层，而是在**数据入口**（粘贴文本、角色 JSON）就完成替换——这解释了它能覆盖物品
   tooltip 的全部文本。我们 Web 版受限于「不改上游」，等价位置是 `LoadModule` hook（模板层），可行且已论证（懒加载 +
   scope 缓存，开销可接受）；
3. **可借鉴**：`Modules/Common.lua` 的宝石 tag 双写（`gemData.tags[trTagName] = value`）思路——译文与原文 key
   并存，避免译文查表失败时丢功能；Web 版实现中文搜索时可复用。

---

## 6. 调查方法备注（可复现）

```bash
# DLL 导出表
objdump -p SimpleGraphicExtend.dll | sed -n '/Export/,/^$/p'
# 关键字符串
strings -n 6 SimpleGraphicExtend.dll | grep -iE 'drawstring|translate|freetype|harfbuzz'
# exe 内嵌明文 Lua 与 charm.* 注入点
strings -n 6 PoeCharm3.exe | grep -E 'charm\.|Modules/|/Launch.lua'
# 占位符格式验证
grep -c '{0:+d}' Data/Translate/zh-rCN/statDescriptions.csv   # 0
grep -n 'Adds {0} to {1} Physical Damage to Attacks' Data/Translate/zh-rCN/statDescriptions.csv
```

exe 内嵌 Lua 为明文，未压缩加密；`PK\x03\x04` 仅在代码段出现（zip 库常量），**没有**内嵌 zip 存档——Lua 源码直接以 C
字符串/资源形式编入 exe。
