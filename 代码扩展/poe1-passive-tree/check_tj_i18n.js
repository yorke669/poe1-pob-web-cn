/*
 * 军团珠宝国际化覆盖率检查 / 未翻译报表生成
 *
 *     cd 代码扩展/poe1-passive-tree && node check_tj_i18n.js
 *
 * 检查范围（全部走 timeless.js 的翻译链路，与页面完全一致）：
 *   1. 珠宝类型名 / 征服者名 / 替代基石名  -> POE1_TREE_TR.jewel（回退 name）
 *   2. 词条模板的每一个分支、每一段描述     -> POE1_TREE_TR.stat
 *
 * 输出：
 *   控制台摘要 + ../docs/poe1-passive-tree-军团珠宝未翻译词条.md（待补译清单）
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = __dirname;
var OUT = path.join(ROOT, "..", "docs", "poe1-passive-tree-军团珠宝未翻译词条.md");

/* ---------- 载入（模拟浏览器：window 上挂数据 + 字典） ---------- */
var sandboxWindow = {};
function loadGlobal(rel, key) {
  var src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  /* eslint-disable no-new-func */
  new Function("window", src)(sandboxWindow);
  return sandboxWindow[key];
}
var D = loadGlobal(path.join("data", "timeless-data.js"), "POE1_TIMELESS");
var TR = loadGlobal(path.join("data", "translations.js"), "POE1_TREE_TR");

var T = require("./timeless.js");
T.init(D);

function cleanNewlines(s) {
  return String(s).replace(/\\+n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}
T.setTranslator(function (table, key) {
  var dict = TR[table] || {};
  return dict[cleanNewlines(key)] || null;
});

function trTj(text) {
  var a = TR.jewel ? TR.jewel[text] : null;
  if (a) return a;
  return TR.name ? (TR.name[text] || text) : text;
}

/* ---------- 1. 珠宝 / 征服者 / 替代基石 ---------- */
var nameMiss = [];
function chkName(en, kind) {
  if (!en) return;
  var zh = trTj(en);
  if (zh === en) nameMiss.push({ kind: kind, en: en });
}

Object.keys(D.jewels).forEach(function (id) { chkName(D.jewels[id], "军团珠宝类型"); });
Object.keys(D.conquerors).forEach(function (id) {
  D.conquerors[id].forEach(function (n) { chkName(n, "征服者"); });
});

var keystoneNames = {};
D.altSkills.forEach(function (a) {
  if (a.t.indexOf(4) >= 0 && a.n) keystoneNames[a.n] = 1;
});
Object.keys(keystoneNames).forEach(function (n) { chkName(n, "替代基石"); });

/* ---------- 2. 词条模板（逐分支、逐段） ---------- */
var indexOfSid = {};
Object.keys(D.stats).forEach(function (k) {
  if (D.stats[k][0]) indexOfSid[D.stats[k][0]] = Number(k);
});

var segTotal = 0, segZh = 0, statMiss = [];
Object.keys(D.translations).forEach(function (sid) {
  var desc = D.translations[sid] || [];
  var missSegs = [];
  desc.forEach(function (item) {
    String(item[0]).split(/\\+n|\r?\n/).forEach(function (seg) {
      segTotal++;
      if (T.statZhMiss(seg).length) {
        seg = cleanNewlines(seg);
        if (missSegs.indexOf(seg) < 0) missSegs.push(seg);
      } else {
        segZh++;
      }
    });
  });
  if (missSegs.length) statMiss.push({ sid: sid, index: indexOfSid[sid], segs: missSegs });
});

/* ---------- 摘要 ---------- */
var statTotal = Object.keys(D.translations).length;
console.log("== 军团珠宝国际化覆盖率 ==");
console.log("  珠宝/征服者/基石名 : " + (nameMiss.length ? "缺 " + nameMiss.length + " 条" : "全命中"));
nameMiss.forEach(function (m) { console.log("    x [" + m.kind + "] " + m.en); });
console.log("  词条段落          : " + segZh + " / " + segTotal +
            "（" + (segTotal ? (segZh / segTotal * 100).toFixed(1) : 0) + "%）");
console.log("  含未翻译段的词条  : " + statMiss.length + " / " + statTotal);

/* ---------- 报表 ---------- */
var L = [];
L.push("# 军团珠宝 —— 未翻译词条清单");
L.push("");
L.push("> 自动生成，请勿手改。生成方式：");
L.push(">");
L.push("> ```bash");
L.push("> cd 代码扩展/poe1-passive-tree && node check_tj_i18n.js");
L.push("> ```");
L.push(">");
L.push("> 语料来源：`国际化资料/zh-rCN/`（PoB 中文社区翻译包），经 `build_translations.py` 合并进");
L.push("> `data/translations.js` 的 `jewel` / `stat` 表。补译后把新条目加进对应 CSV，重跑构建脚本即可。");
L.push("");
L.push("## 当前状态");
L.push("");
L.push("| 检查项 | 结果 |");
L.push("|--------|------|");
L.push("| 珠宝类型 / 征服者 / 替代基石名 | " +
       (nameMiss.length ? "缺 " + nameMiss.length + " 条" : "全部命中") + " |");
L.push("| 词条模板段落（逐分支逐段） | " + segZh + " / " + segTotal +
       "（" + (segTotal ? (segZh / segTotal * 100).toFixed(1) : 0) + "%） |");
L.push("| 含未翻译段的词条 | " + statMiss.length + " / " + statTotal + " |");
L.push("");

if (nameMiss.length) {
  L.push("## 待补译：名称");
  L.push("");
  L.push("| 类别 | 英文 |");
  L.push("|------|------|");
  nameMiss.forEach(function (m) { L.push("| " + m.kind + " | `" + m.en + "` |"); });
  L.push("");
}

if (statMiss.length) {
  L.push("## 待补译：词条描述");
  L.push("");
  L.push("列为未命中的模板段落（`{0}` 是掷值占位符）。补译时按**英文原段**做键写进 `statDescriptions.csv`，");
  L.push("中文里保留 `{0}` `{1}` 等占位符。");
  L.push("");
  L.push("| stat id | stat index | 未命中段落 |");
  L.push("|---------|-----------|-----------|");
  statMiss.forEach(function (m) {
    L.push("| `" + m.sid + "` | " + (m.index == null ? "-" : m.index) + " | " +
           m.segs.map(function (s) { return "`" + s.replace(/\|/g, "\\|") + "`"; }).join("<br>") + " |");
  });
  L.push("");
} else {
  L.push("## 待补译：词条描述");
  L.push("");
  L.push("无 —— 全部 " + segTotal + " 段模板描述都能查到中文。");
  L.push("");
  L.push("升级游戏版本 / 更新树数据后重跑本脚本，新增未命中的条目会自动出现在这里。");
  L.push("");
}

fs.writeFileSync(OUT, L.join("\n"), "utf8");
console.log("\n报表写出：" + OUT);
process.exit(0);
