/*
 * 军团珠宝移植自检 —— Node 下运行（无需浏览器）：
 *     cd 代码扩展/poe1-passive-tree && node timeless-selftest.js
 *
 * 用例来自 Vilsol/timeless-jewels 的 jewel_test.go（Go 版黄金值）。
 * 任一条红了，优先怀疑两处：uint32 环绕、中点「丢弃一次 Generate(0,100)」。
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function loadData(file) {
  var sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  return sandbox.window.POE1_TIMELESS;
}

var T = require("./timeless.js");
T.init(loadData(path.join(__dirname, "data", "timeless-data.js")));

/* 黄金向量：[jewel, conqueror, seed, passiveIndex, 替换天赋key(null=未替换), 掷值, [[追加key,值]]] */
var C = [
  // 1 光彩夺目 Glorious Vanity, seed 2000
  [1, "Xibaqua", 2000, 2312, 0, [1], []],
  [1, "Xibaqua", 2000, 411, 67, [8, 22], []],
  [1, "Xibaqua", 2000, 519, 38, [12], []],
  [1, "Xibaqua", 2000, 1190, 21, [3], []],
  [1, "Xibaqua", 2000, 88, 77, [], [[14, 6], [23, 5], [36, 11]]],
  [1, "Zerphi", 2000, 2312, 1, [1], []],
  [1, "Ahuana", 2000, 2312, 2, [1], []],
  [1, "Doryani", 2000, 2312, 3, [1], []],
  // 2 致命的骄傲 Lethal Pride, seed 12000
  [2, "Kaom", 12000, 2312, 78, [1], []],
  [2, "Kaom", 12000, 411, null, [], [[42, 20]]],
  [2, "Kaom", 12000, 519, null, [], [[39, 4]]],
  [2, "Kaom", 12000, 1190, null, [], [[39, 4]]],
  [2, "Kaom", 12000, 88, null, [], [[57, 12]]],
  [2, "Rakiata", 12000, 2312, 79, [1], []],
  [2, "Kiloava", 12000, 2312, 80, [1], []],
  [2, "Akoya", 12000, 2312, 81, [1], []],
  // 3 残酷的约束 Brutal Restraint, seed 2000
  [3, "Deshret", 2000, 2312, 82, [1], []],
  [3, "Deshret", 2000, 411, null, [], [[70, 10]]],
  [3, "Deshret", 2000, 519, null, [], [[66, 4]]],
  [3, "Deshret", 2000, 1190, null, [], [[66, 4]]],
  [3, "Deshret", 2000, 88, null, [], [[76, 20]]],
  [3, "Balbala", 2000, 2312, 83, [1], []],
  [3, "Asenath", 2000, 2312, 84, [1], []],
  [3, "Nasima", 2000, 2312, 85, [1], []],
  // 4 好战的信仰 Militant Faith, seed 2000
  [4, "Venarius", 2000, 2312, 86, [1], []],
  [4, "Venarius", 2000, 411, null, [], [[93, 5]]],
  [4, "Venarius", 2000, 519, null, [], [[92, 5]]],
  [4, "Venarius", 2000, 1190, null, [], [[92, 5]]],
  [4, "Venarius", 2000, 88, null, [], [[93, 5]]],
  [4, "Maxarius", 2000, 2312, 87, [1], []],
  [4, "Dominus", 2000, 2312, 88, [1], []],
  [4, "Avarius", 2000, 2312, 89, [1], []],
  // 5 优雅的狂妄 Elegant Hubris, seed 2000（真实种子 /20）
  [5, "Cadiro", 2000, 2312, 105, [1], []],
  [5, "Cadiro", 2000, 411, 123, [30], []],
  [5, "Cadiro", 2000, 519, 109, [], []],
  [5, "Cadiro", 2000, 1190, 109, [], []],
  [5, "Cadiro", 2000, 88, 137, [80], []],
  [5, "Victario", 2000, 2312, 106, [1], []],
  [5, "Chitus", 2000, 2312, 107, [1], []],
  [5, "Caspiro", 2000, 2312, 108, [1], []],
  // 6 英勇悲剧 Heroic Tragedy, seed 2000
  [6, "Vorana", 2000, 2312, 179, [1], []],
  [6, "Vorana", 2000, 411, 172, [12, 8], []],
  [6, "Vorana", 2000, 519, null, [], [[94, 2]]],
  [6, "Vorana", 2000, 1190, null, [], [[94, 2]]],
  [6, "Vorana", 2000, 88, 175, [20, 20], []],
  [6, "Uhtred", 2000, 2312, 180, [1], []],
  [6, "Medved", 2000, 2312, 181, [1], []]
];

/* ---------------- 断言 ---------------- */

var pass = 0, fail = 0;

function eq(actual, expect, label) {
  if (JSON.stringify(actual) === JSON.stringify(expect)) return true;
  fail++;
  console.log("  x " + label + "\n      期望 " + JSON.stringify(expect) +
              "\n      实际 " + JSON.stringify(actual));
  return false;
}

console.log("== RNG 健壮性 ==");
(function () {
  var rng = new T.Rng();
  rng.reset(30439, 2000);
  var i, v, bad = 0;
  var buckets = Object.create(null);
  for (i = 0; i < 100000; i++) {
    v = rng.uint();
    if (!isFinite(v) || v < 0 || v >= 4294967296 || v !== Math.floor(v)) bad++;
    buckets[rng.range(0, 100)] = true;
  }
  eq(bad, 0, "10 万次 uint() 全部是合法 uint32");
  eq(Object.keys(buckets).length, 101, "range(0,100) 覆盖 0..100");
  eq(new T.Rng().reset(30439, 2000).uint() === new T.Rng().reset(30439, 2000).uint(), true,
     "同一 (graphId, seed) 可复现");
  eq(new T.Rng().reset(30439, 2000).uint() !== new T.Rng().reset(30440, 2000).uint(), true,
     "不同 graphId 产生不同序列");
})();

console.log("\n== 黄金向量（jewel_test.go，共 " + C.length + " 条）==");
C.forEach(function (c) {
  var res = T.calculate(c[3], c[2], c[0], c[1]);
  var label = "jewel" + c[0] + "/" + c[1] + "/seed" + c[2] + "/passive" + c[3];
  var adds = res.additions.map(function (a) { return [a.addition.i, a.rolls[0]]; });
  var ok = eq(res.skill ? res.skill.i : null, c[4], label + " 替换天赋");
  ok = eq(res.rolls, c[5], label + " 掷值") && ok;
  ok = eq(adds, c[6], label + " 追加词条") && ok;
  if (ok) pass++;
});

console.log("\n== 词条文本 ==");
(function () {
  var r1 = T.calculate(2286, 2000, 1, "Xibaqua");      // Supreme Ego -> Divine Flesh
  console.log("  光彩夺目/Xibaqua/2000/SupremeEgo -> " + JSON.stringify(T.resultLines(r1)));
  var r2 = T.calculate(411, 12000, 2, "Kaom");         // Instability -> +20 Strength
  console.log("  致命的骄傲/Kaom/12000/Instability -> " + JSON.stringify(T.resultLines(r2)));
  eq(T.resultLines(r1).length > 0 && T.resultLines(r1)[0].indexOf("Stat #") !== 0, true,
     "基石能渲染出文本");
})();

console.log("\n== 反向搜索（找编号）==");
(function () {
  var ids = [2312, 411, 519, 1190, 88];
  var stats = Object.keys(T.possibleStatsOf(2)).slice(0, 6).map(Number);
  var t0 = Date.now();
  var out = T.reverseSearch(ids, stats, 2, "Kaom", function () { return true; });
  var seeds = Object.keys(out);
  console.log("  LethalPride/Kaom · " + ids.length + " 天赋 · 全种子扫描 -> 命中 " +
              seeds.length + " 个种子，耗时 " + (Date.now() - t0) + " ms");
  eq(seeds.length > 0, true, "反向搜索能命中种子");
})();

console.log("\n---------------------------------------");
console.log("黄金向量通过 " + pass + "/" + C.length + "，其它断言失败 " + fail + " 条");
process.exit(fail === 0 ? 0 : 1);
