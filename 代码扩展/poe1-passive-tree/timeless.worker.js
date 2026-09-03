/*
 * 军团珠宝「找编号」Web Worker —— 在后台线程跑种子区间扫描（reverseSearch），
 * 避免阻塞 UI。主线程通过 postMessage 调起，结果回传。
 *
 * 本文件被 Worker 直接加载，路径相对于本文件所在目录：
 *   importScripts('data/timeless-data.js', 'timeless.js')
 * 两个文件都把数据/接口挂到 self 上（见数据文件 __TJ_G__ 兼容写法）。
 */
"use strict";

importScripts("data/timeless-data.js", "timeless.js");

PoTimeless.init(self.POE1_TIMELESS);

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.cmd !== "reverse") return;

  var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  var sr = PoTimeless.seedRangeOf(m.jewelType) || { min: 0, max: 0, step: 1 };
  var step = sr.step || 1;
  var loopMin = Math.floor(sr.min / step), loopMax = Math.floor(sr.max / step);

  var results = PoTimeless.reverseSearch(
    m.passiveIndices, m.statIds, m.jewelType, m.conqueror,
    function (realSeed) {
      if (m.onProgress && (realSeed - sr.min) % (step * 256) === 0) {
        self.postMessage({ type: "progress", seed: realSeed, max: sr.max });
      }
      return true;
    }
  );

  var t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());

  // 结果整理：按命中数量降序，再按种子升序，便于用户挑选
  var arr = [];
  Object.keys(results).forEach(function (seed) {
    var byNode = results[seed];
    var count = 0;
    Object.keys(byNode).forEach(function (pid) { count += Object.keys(byNode[pid]).length; });
    arr.push({ seed: Number(seed), count: count, byNode: byNode });
  });
  arr.sort(function (a, b) { return b.count - a.count || a.seed - b.seed; });

  self.postMessage({ type: "result", results: arr, total: arr.length, ms: Math.round(t1 - t0), max: sr.max });
};
