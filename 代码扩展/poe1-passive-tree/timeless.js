/*
 * 军团珠宝计算核心 —— 端口自 Vilsol/timeless-jewels（Go, MIT）
 *
 * 原理：效果按种子实时计算，不需要预计算 LUT。RNG 是 TinyMT32 变体，
 *       用 (PassiveSkillGraphId, seed) 播种，再按天赋类型走「替换」或「追加」两条路径。
 * 本文件纯逻辑、无 DOM，主线程与 Worker 共用一份。
 *
 * 移植必须遵守的两条 Go 语义：
 *   1) 所有算术都是 uint32 环绕 —— JS 里必须显式 >>> 0 / Math.imul；
 *   2) 中点（notable）判定「是否替换」时已掷过一次 Generate(0,100)，
 *      进入 ReplacePassiveSkill / AugmentPassiveSkill 后要再丢弃一次同样的随机数。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PoTimeless = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ===================== TinyMT32 变体（random/main.go） ===================== */

  var C0 = 0x40336050, C1 = 0xCFA3723C, C2 = 0x3CAC5F6F, C3 = 0x3793FDFF;
  var MASK = 0x7FFFFFFF, ALPHA = 0x19660D, BRAVO = 0x5D588B65;
  var MAT1 = 0x8F7011EE, MAT2 = 0xFC78FF1F, TMAT = 0x3793FDFF;

  function mul32(a, b) { return Math.imul(a, b) >>> 0; }
  function mAlpha(v) { return mul32((v ^ (v >>> 27)) >>> 0, ALPHA); }
  function mBravo(v) { return mul32((v ^ (v >>> 27)) >>> 0, BRAVO); }

  function Rng() { this.s = new Uint32Array(4); }

  /** Reset(passiveSkill, timelessJewel)：状态是 (graphId, seed) 的纯函数 */
  Rng.prototype.reset = function (graphId, seed) {
    var s = this.s;
    s[0] = C0; s[1] = C1; s[2] = C2; s[3] = C3;
    this._init([graphId >>> 0, seed >>> 0]);
    return this;
  };

  Rng.prototype._init = function (seeds) {
    var s = this.s, i = 1, k, rs;
    for (k = 0; k < seeds.length; k++) {              // 带种子的轮
      rs = mAlpha(s[i % 4] ^ s[(i + 1) % 4] ^ s[(i + 3) % 4]);
      s[(i + 1) % 4] = (s[(i + 1) % 4] + rs) >>> 0;
      rs = (rs + seeds[k] + i) >>> 0;
      s[(i + 2) % 4] = (s[(i + 2) % 4] + rs) >>> 0;
      s[i % 4] = rs;
      i = (i + 1) % 4;
    }
    for (k = 0; k < 5; k++) {                         // 5 轮 Alpha（无种子）
      rs = mAlpha(s[i % 4] ^ s[(i + 1) % 4] ^ s[(i + 3) % 4]);
      s[(i + 1) % 4] = (s[(i + 1) % 4] + rs) >>> 0;
      rs = (rs + i) >>> 0;
      s[(i + 2) % 4] = (s[(i + 2) % 4] + rs) >>> 0;
      s[i % 4] = rs;
      i = (i + 1) % 4;
    }
    for (k = 0; k < 4; k++) {                         // 4 轮 Bravo
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
    var s = this.s, a = s[3];
    var b = (((s[0] & MASK) ^ s[1]) ^ s[2]) >>> 0;
    a = (a ^ (a << 1)) >>> 0;
    b = (b ^ ((b >>> 1) ^ a)) >>> 0;
    s[0] = s[1]; s[1] = s[2];
    s[2] = (a ^ (b << 10)) >>> 0; s[3] = b;
    // Go: state[1] ^= -(b & 1) & 0x8F7011EE —— uint32 取负只有 0 / 0xFFFFFFFF 两种
    if (b & 1) { s[1] = (s[1] ^ MAT1) >>> 0; s[2] = (s[2] ^ MAT2) >>> 0; }
  };

  Rng.prototype.temper = function () {
    var s = this.s;
    var b = (s[0] + (s[2] >>> 8)) >>> 0;
    var a = (s[3] ^ b) >>> 0;
    return (a ^ (b & 1 ? TMAT : 0)) >>> 0;
  };

  Rng.prototype.uint = function () { this.nextState(); return this.temper(); };
  Rng.prototype.single = function (max) { return max > 0 ? this.uint() % max : 0; };
  Rng.prototype.range = function (min, max) {
    var a = (min + 0x80000000) >>> 0, b = (max + 0x80000000) >>> 0;
    return (this.single((((b - a) >>> 0) + 1) >>> 0) + a + 0x80000000) >>> 0;
  };
  Rng.prototype.signed = function (min, max) { return this.range(min >>> 0, max >>> 0) | 0; };

  /* ============================ 数据索引 ============================ */

  var T_NONE = 0, T_SMALL_ATTR = 1, T_SMALL_NORMAL = 2, T_NOTABLE = 3, T_KEYSTONE = 4, T_JEWEL = 5;

  var D = null, byIndex = null, byGraph = null, revSkills = null, revAdds = null;
  var keystones = null, versions = null, statByIndex = null, statIndexById = null, ready = false;

  /** stat ∈ {573, 576, 579}（力/智/敏小点）。Go 用位掩码 0x49 + 位移，这里等价展开。 */
  function isSmallAttribute(stat) {
    var bit = (stat + 1) - 574;
    if (bit < 0 || bit > 6) return false;
    return (0x49 & (1 << bit)) !== 0;
  }

  function passiveTypeOf(sk) {
    if (sk.f & 4) return T_JEWEL;
    if (sk.f & 1) return T_KEYSTONE;
    if (sk.f & 2) return T_NOTABLE;
    if (sk.st.length === 1 && isSmallAttribute(sk.st[0])) return T_SMALL_ATTR;
    return T_SMALL_NORMAL;
  }

  function init(data) {
    D = data;
    byIndex = Object.create(null); byGraph = Object.create(null);
    (D.passives || []).forEach(function (p) {
      var sk = { i: p[0], g: p[1], f: p[2], st: p[3] || [] };
      byIndex[sk.i] = sk;
      if (!byGraph[sk.g]) byGraph[sk.g] = sk;
    });

    revSkills = []; revAdds = [];
    (D.altSkills || []).forEach(function (a) {
      a.t.forEach(function (t) {
        (revSkills[t] = revSkills[t] || Object.create(null));
        (revSkills[t][a.v] = revSkills[t][a.v] || []).push(a);
      });
    });
    (D.altAdditions || []).forEach(function (a) {
      a.t.forEach(function (t) {
        (revAdds[t] = revAdds[t] || Object.create(null));
        (revAdds[t][a.v] = revAdds[t][a.v] || []).push(a);
      });
    });

    // 征服者专属基石：与 Go 的 GetAlternatePassiveSkillKeyStone 一致，取第一条命中的
    keystones = Object.create(null);
    (D.altSkills || []).forEach(function (a) {
      if (a.t.indexOf(T_KEYSTONE) < 0) return;
      var key = a.v + ":" + a.ci + ":" + a.cv;
      if (!keystones[key]) keystones[key] = a;
    });

    versions = Object.create(null);
    (D.treeVersions || []).forEach(function (v) { versions[v.i] = v; });

    statByIndex = Object.create(null); statIndexById = Object.create(null);
    var stats = D.stats || {};
    Object.keys(stats).forEach(function (k) {
      var idx = Number(k), id = stats[k][0];
      statByIndex[idx] = { index: idx, id: id, text: stats[k][1] };
      if (id) statIndexById[id] = idx;
    });

    ready = true;
    return API;
  }

  /* ============================== 计算 ============================== */

  var EMPTY = { skill: null, rolls: [], additions: [] };

  function conqOf(jewelType, conqueror) {
    var m = D.conquerorIdx && D.conquerorIdx[String(jewelType)];
    return (m && m[conqueror]) || null;
  }

  /** 优雅狂妄的真实种子先 /20（Go 的 TimelessJewel.GetSeed） */
  function effectiveSeed(jewelType, seed) {
    return (jewelType === 5 ? Math.floor(seed / 20) : seed) >>> 0;
  }

  function makeCtx(sk, jewelType, conqueror, effSeed) {
    var conq = conqOf(jewelType, conqueror), ver = versions[jewelType];
    if (!conq || !ver) return null;
    var type = passiveTypeOf(sk);
    if (type === T_NONE || type === T_JEWEL) return null;
    return { sk: sk, ver: ver, conq: conq, type: type, effSeed: effSeed >>> 0 };
  }

  function isReplaced(ctx, rng) {
    if (ctx.type === T_KEYSTONE) return true;
    if (ctx.type === T_NOTABLE) {
      var w = ctx.ver.nw;
      if (w >= 100) return true;
      if (w === 0) return false;
      rng.reset(ctx.sk.g, ctx.effSeed);
      return rng.range(0, 100) < w;
    }
    if (ctx.type === T_SMALL_ATTR) return !!ctx.ver.sa;
    return !!ctx.ver.sn;
  }

  /** 掷最多 maxN 个数值；Go 的 StatRolls 是定长 [4]int32，未掷到的位置读作 0 */
  function rollStats(rng, rec, maxN) {
    var n = Math.min(rec.k.length, maxN), out = [], i, mn, mx;
    for (i = 0; i < n; i++) {
      mn = rec.s[i * 2]; mx = rec.s[i * 2 + 1];
      out.push(mx > mn ? rng.signed(mn, mx) : mn);
    }
    return out;
  }

  /** 加权挑一个追加词条（首命中即返回）；权重全 0 返回 null（Go 会 panic，这里安全退出） */
  function rollOneAddition(ctx, rng) {
    var list = (revAdds[ctx.type] && revAdds[ctx.type][ctx.ver.i]) || [];
    if (!list.length) return null;
    var total = 0, i;
    for (i = 0; i < list.length; i++) total = (total + list[i].w) >>> 0;
    if (total === 0) return null;
    var roll = rng.single(total);
    for (i = 0; i < list.length; i++) {
      if (list[i].w > roll) return list[i];
      roll -= list[i].w;
    }
    return null;
  }

  function rollAdditions(ctx, mn, mx, rng) {
    var count = (mx > mn) ? rng.range(mn, mx) : mn;
    var out = [], i, a, guard;
    for (i = 0; i < count; i++) {
      a = null; guard = 0;
      while (a === null && guard++ < 64) a = rollOneAddition(ctx, rng);
      if (!a) break;
      out.push({ addition: a, rolls: rollStats(rng, a, 2) });
    }
    return out;
  }

  function replacePassiveSkill(ctx, rng) {
    if (ctx.type === T_KEYSTONE) {
      var ks = keystones[ctx.ver.i + ":" + ctx.conq[0] + ":" + ctx.conq[1]];
      return ks ? { skill: ks, rolls: [ks.s[0]], additions: [] } : EMPTY;
    }
    var list = (revSkills[ctx.type] && revSkills[ctx.type][ctx.ver.i]) || [];
    if (!list.length) return EMPTY;

    rng.reset(ctx.sk.g, ctx.effSeed);
    if (ctx.type === T_NOTABLE) rng.range(0, 100);   // 与 IsPassiveSkillReplaced 那次对齐

    var cur = 0, picked = null, i;
    for (i = 0; i < list.length; i++) {
      cur = (cur + list[i].w) >>> 0;
      if (rng.single(cur) < list[i].w) picked = list[i];   // 后命中覆盖先命中
    }
    if (!picked) return EMPTY;

    var rolls = rollStats(rng, picked, 4);
    if (picked.rm === 0 && picked.rM === 0) return { skill: picked, rolls: rolls, additions: [] };
    return {
      skill: picked, rolls: rolls,
      additions: rollAdditions(ctx, ctx.ver.mn + picked.rm, ctx.ver.mx + picked.rM, rng)
    };
  }

  function augmentPassiveSkill(ctx, rng) {
    rng.reset(ctx.sk.g, ctx.effSeed);
    if (ctx.type === T_NOTABLE) rng.range(0, 100);   // 同上
    return rollAdditions(ctx, ctx.ver.mn, ctx.ver.mx, rng);
  }

  function evalPassive(ctx, rng) {
    return isReplaced(ctx, rng)
      ? replacePassiveSkill(ctx, rng)
      : { skill: null, rolls: [], additions: augmentPassiveSkill(ctx, rng) };
  }

  /** 查效果：某个天赋在某颗军团珠宝下的结果 */
  function calculate(passiveIndex, seed, jewelType, conqueror, rng) {
    if (!ready) return EMPTY;
    var sk = byIndex[passiveIndex];
    if (!sk) return EMPTY;
    var ctx = makeCtx(sk, jewelType, conqueror, effectiveSeed(jewelType, seed));
    return ctx ? evalPassive(ctx, rng || new Rng()) : EMPTY;
  }

  /** 把一条结果里命中的 stat 收集进 results（对应 Go ReverseSearch 的两个内层循环） */
  function collectStats(results, realSeed, passiveIndex, rec, rolls, limit, statSet) {
    var bucket = null;
    for (var j = 0; j < rec.k.length; j++) {
      var key = rec.k[j];
      if (!statSet[key]) continue;
      if (bucket === null) {
        if (!results[realSeed]) results[realSeed] = Object.create(null);
        bucket = results[realSeed][passiveIndex] ||
                 (results[realSeed][passiveIndex] = Object.create(null));
      }
      bucket[key] = (j < limit && j < rolls.length) ? rolls[j] : 0;
    }
  }

  /** 找编号：遍历种子区间 → { realSeed: { passiveIndex: { statId: value } } } */
  function reverseSearch(passiveIndices, statIds, jewelType, conqueror, onProgress) {
    if (!ready) return {};
    var sr = seedRangeOf(jewelType);
    if (!sr || !versions[jewelType] || !conqOf(jewelType, conqueror)) return {};

    var statSet = Object.create(null), i;
    for (i = 0; i < statIds.length; i++) statSet[statIds[i]] = true;

    var ctxs = [];
    for (i = 0; i < passiveIndices.length; i++) {
      var sk = byIndex[passiveIndices[i]];
      if (!sk) continue;
      var ctx = makeCtx(sk, jewelType, conqueror, 0);
      if (ctx) ctxs.push(ctx);
    }

    var results = Object.create(null), rng = new Rng();
    var step = sr.step;
    var loopMin = Math.floor(sr.min / step), loopMax = Math.floor(sr.max / step);

    for (var s = loopMin; s <= loopMax; s++) {
      var realSeed = s * step;
      if (s % 64 === 0 && onProgress && onProgress(realSeed) === false) break;
      for (i = 0; i < ctxs.length; i++) {
        var c = ctxs[i];
        c.effSeed = effectiveSeed(jewelType, realSeed);
        var res = evalPassive(c, rng);
        if (res.skill) collectStats(results, realSeed, c.sk.i, res.skill, res.rolls, 4, statSet);
        for (var a = 0; a < res.additions.length; a++) {
          collectStats(results, realSeed, c.sk.i, res.additions[a].addition,
                       res.additions[a].rolls, 2, statSet);
        }
      }
    }
    return results;
  }

  /* ================= 词条文本（skill_tree.ts 的 formatStats） ================= */

  var INDEX_HANDLERS = {
    negate: -1, times_twenty: 1 / 20, canonical_stat: 1, per_minute_to_per_second: 60,
    milliseconds_to_seconds: 1000, display_indexable_support: 1, divide_by_one_hundred: 100,
    milliseconds_to_seconds_2dp_if_required: 1000, deciseconds_to_seconds: 10,
    old_leech_percent: 1, old_leech_permyriad: 10000, times_one_point_five: 1 / 1.5,
    "30%_of_value": 100 / 30, divide_by_one_thousand: 1000, divide_by_twelve: 12,
    divide_by_six: 6, per_minute_to_per_second_2dp_if_required: 60, "60%_of_value": 100 / 60,
    double: 1 / 2, negate_and_double: 1 / -2, multiply_by_four: 1 / 4,
    per_minute_to_per_second_0dp: 60, milliseconds_to_seconds_0dp: 1000,
    mod_value_to_item_class: 1, milliseconds_to_seconds_2dp: 1000,
    multiplicative_damage_modifier: 1, divide_by_one_hundred_2dp: 100,
    per_minute_to_per_second_1dp: 60, divide_by_one_hundred_2dp_if_required: 100,
    divide_by_ten_1dp_if_required: 10, milliseconds_to_seconds_1dp: 1000, divide_by_fifty: 50,
    per_minute_to_per_second_2dp: 60, divide_by_ten_0dp: 10, divide_by_one_hundred_and_negate: -100,
    tree_expansion_jewel_passive: 1, passive_hash: 1, divide_by_ten_1dp: 10,
    affliction_reward_type: 1, divide_by_five: 5, metamorphosis_reward_description: 1,
    divide_by_two_0dp: 2, divide_by_fifteen_0dp: 15, divide_by_three: 3,
    divide_by_twenty_then_double_0dp: 10, divide_by_four: 4
  };

  function statIdx(index) { return statByIndex[index] || null; }

  /* ---------------- 国际化 ----------------
   * 词条文本由 GGG 模板（"{0:+d}% to ..."）渲染出来，翻译必须作用在**模板**上，
   * 再把数值回填进译文的 {n} 占位符。页面注入查表函数：
   *     PoTimeless.setTranslator(function (table, key) { return 中文 || null; });
   * 未注入 / 未命中一律回退英文，因此 Worker 里不注入也能正常跑。
   */

  var TRFN = null;

  function setTranslator(fn) { TRFN = fn || null; }

  function zhOf(table, key) {
    if (!TRFN || key == null) return null;
    var v = TRFN(table, String(key));
    return (v && v !== key) ? v : null;
  }

  /** GGG 用 \\n 或真实换行分隔多段描述（基石基本都是多段） */
  function splitLines(s) { return String(s).split(/\\+n|\r?\n/); }

  /** 模板归一：{0:+d} / {0:d} → {0}，好和 statDescriptions 的译文键对上 */
  function normTmpl(t) { return String(t).replace(/\{(\d+)(?::[^}]*)\}/g, "{$1}"); }

  /**
   * 把模板里的字面数字改写成占位符，用来命中「常量也是占位符」的官方译文。
   * 例："{0} to Ward per 10 Armour on Equipped Helmet"
   *   → "{0} to Ward per {1} Armour on Equipped Helmet"，nums = {"{1}": "10"}
   */
  function numVariant(key) {
    // 占位符先换成不含数字的哨兵（\x01a\x01 / \x01b\x01 …），
    // 否则 {0} 里的 0 会被下面的 \d+ 当成字面数字
    var masked = key.replace(/\{(\d+)\}/g, function (m0, d) {
      return "\x01" + String.fromCharCode(97 + Number(d)) + "\x01";
    });
    var maxIdx = -1, m, re = /\{(\d+)\}/g;
    while ((m = re.exec(key))) { if (Number(m[1]) > maxIdx) maxIdx = Number(m[1]); }
    var next = maxIdx + 1, lit = [], re2 = /\d+/g;
    while ((m = re2.exec(masked))) lit.push({ i: m.index, s: m[0] });
    if (!lit.length) return null;
    var k = "", pos = 0, nums = Object.create(null);
    for (var i = 0; i < lit.length; i++) {
      k += masked.slice(pos, lit[i].i) + "{" + (next + i) + "}";
      nums["{" + (next + i) + "}"] = lit[i].s;
      pos = lit[i].i + lit[i].s.length;
    }
    k += masked.slice(pos);
    return {
      key: k.replace(/\x01([a-z])\x01/g, function (m0, c) {
        return "{" + (c.charCodeAt(0) - 97) + "}";
      }),
      nums: nums
    };
  }

  /** 单行模板 → 中文模板（含 {n}）+ 字面数字回填表；未命中返回 null
   *  候选键按「越具体越优先」排列：原样 → 去占位符前的 "+" → 常量改占位符 */
  function zhLine(tmpl) {
    var base = normTmpl(tmpl);
    // 去占位符前的 "+"（GGG 的 {0:+d} 在两套语料里写法不一致）
    var noPlus = base.replace(/\+\{(\d+)\}/g, "{$1}");
    // 去关键词标记："[DirectFlight|Direct Flight]" → "Direct Flight"
    var noLink = base.replace(/\[[^\]\|]*\|([^\]]*)\]/g, "$1");
    var bases = [base];
    if (noPlus !== base) bases.push(noPlus);
    if (noLink !== base && bases.indexOf(noLink) < 0) bases.push(noLink);
    for (var b = 0; b < bases.length; b++) {
      var v = numVariant(bases[b]);
      var cands = v ? [{ key: bases[b], nums: null }, v]
                    : [{ key: bases[b], nums: null }];
      for (var i = 0; i < cands.length; i++) {
        var zh = zhOf("stat", cands[i].key);
        if (zh) return { zh: zh, nums: cands[i].nums };
      }
    }
    return null;
  }

  /** 中文模板 → 文本：先回填常量占位符（{1}{2}…），再填 {0} */
  function applyZh(z, v0) {
    var out = String(z.zh);
    if (z.nums) { for (var p in z.nums) out = out.split(p).join(z.nums[p]); }
    return out.replace(/\{0(?::[^}]*)?\}/g, v0);
  }

  /** 英文渲染（单行）：{0:+d} 的 "+" 在负数时丢弃 */
  function renderEn(line, v0) {
    return String(line).replace(/\{0(?::(.*?)d(.*?))\}/, function (m0, pre, suf) {
      return (pre === "+" && String(v0).charAt(0) === "-") ? (v0 + suf) : (pre + v0 + suf);
    }).replace("{0}", v0);
  }

  /** 整段模板（可能多段）→ 文本，段间用 \n 分隔；未命中的段保留英文 */
  function renderStat(tmpl, v0) {
    var lines = splitLines(tmpl), out = [], any = false, i;
    if (TRFN) {
      for (i = 0; i < lines.length; i++) {
        var z = zhLine(lines[i]);
        out[i] = z ? applyZh(z, v0) : null;
        if (z) any = true;
      }
    }
    if (!any) return lines.map(function (l) { return renderEn(l, v0); }).join("\n");
    for (i = 0; i < lines.length; i++) if (out[i] === null) out[i] = renderEn(lines[i], v0);
    return out.join("\n");
  }

  /** 无数值版：{0} → #，用于「找编号」的词条下拉；多段（基石）并成一行并截断 */
  function statLabel(statIndex) {
    var st = statIdx(statIndex);
    if (!st) return "Stat #" + statIndex;
    var desc = (D.translations || {})[st.id];
    var tmpl = (desc && desc.length && desc[0][0]) ? desc[0][0] : (st.text || st.id);
    if (!tmpl) return "Stat #" + statIndex;
    var s = renderStat(tmpl, "#").replace(/\s*\n\s*/g, " / ");
    return s.length > 96 ? s.slice(0, 96) + "…" : s;
  }

  /** 带数值版：conditions 选分支 → index_handlers 换算 → 回填 {0} */
  function statText(statIndex, roll) {
    var st = statIdx(statIndex);
    if (!st) return "Stat #" + statIndex;
    var desc = (D.translations || {})[st.id];
    if (!desc || !desc.length) return st.text || st.id;

    var sel = -1, i;
    for (i = 0; i < desc.length; i++) {
      var item = desc[i], c = item[1], matches = true;
      if (c) {
        if (c[0] != null && roll < c[0]) matches = false;
        if (c[1] != null && roll > c[1]) matches = false;
        if (c[2]) matches = !matches;
      }
      if (matches) { sel = i; break; }
    }
    if (sel < 0) return st.text || st.id;

    var datum = desc[sel], finalStat = roll;
    if (datum[2]) {
      for (i = 0; i < datum[2].length; i++) finalStat /= (INDEX_HANDLERS[datum[2][i]] || 1);
    }
    var num = String(parseFloat(finalStat.toFixed(2)));
    // {0:+d} 正数要带 "+"；负数自身带 "-"（Go 版这里会拼成 "+-"，属上游 bug）
    var v0 = (/\{0:\+d\}/.test(datum[0]) && finalStat >= 0) ? ("+" + num) : num;
    return renderStat(datum[0], v0);
  }

  /** 把 calculate() 的结果渲染成文本行数组（多段描述会拆成多行） */
  function resultLines(res) {
    var lines = [], i, a;
    function push(t) {
      String(t).split("\n").forEach(function (l) { if (l.trim()) lines.push(l); });
    }
    if (res.skill) {
      for (i = 0; i < res.skill.k.length; i++) {
        push(statText(res.skill.k[i], i < res.rolls.length ? res.rolls[i] : 0));
      }
    }
    for (a = 0; a < res.additions.length; a++) {
      var add = res.additions[a];
      for (i = 0; i < add.addition.k.length; i++) {
        push(statText(add.addition.k[i], i < add.rolls.length ? add.rolls[i] : 0));
      }
    }
    return lines;
  }

  /* ============================== 对外 API ============================== */

  function seedRangeOf(jewelType) {
    var r = D.seedRanges && D.seedRanges[String(jewelType)];
    return r ? { min: r[0], max: r[1], step: r[2] } : null;
  }

  function possibleStatsOf(jewelType) {
    return (D.possibleStats && D.possibleStats[String(jewelType)]) || {};
  }

  function conquerorsOf(jewelType) {
    return (D.conquerors && D.conquerors[String(jewelType)]) || [];
  }

  /** 被替换成的替代天赋名（英文原名，页面自行查 jewel / name 表翻译） */
  function skillNameOf(res) {
    return (res && res.skill && res.skill.n) ? res.skill.n : "";
  }

  /** 诊断用：模板里查不到中文的段落（空数组 = 全部命中），供 check_tj_i18n.js 出报表 */
  function statZhMiss(tmpl) {
    return splitLines(tmpl).filter(function (l) { return !zhLine(l); });
  }

  var API = {
    Rng: Rng,
    init: init,
    setTranslator: setTranslator,
    ready: function () { return ready; },
    treeVersion: function () { return D && D.meta ? D.meta.treeVersion : null; },
    jewels: function () { return (D && D.jewels) || {}; },
    isSmallAttribute: isSmallAttribute,
    passiveTypeOf: function (index) {
      var sk = byIndex && byIndex[index];
      return sk ? passiveTypeOf(sk) : T_NONE;
    },
    passiveByGraphId: function (graphId) { return (byGraph && byGraph[graphId]) || null; },
    passiveByIndex: function (index) { return (byIndex && byIndex[index]) || null; },
    calculate: calculate,
    reverseSearch: reverseSearch,
    seedRangeOf: seedRangeOf,
    possibleStatsOf: possibleStatsOf,
    conquerorsOf: conquerorsOf,
    statLabel: statLabel,
    statText: statText,
    resultLines: resultLines,
    skillNameOf: skillNameOf,
    statZhMiss: statZhMiss,
    T: { NONE: T_NONE, SMALL_ATTR: T_SMALL_ATTR, SMALL_NORMAL: T_SMALL_NORMAL,
         NOTABLE: T_NOTABLE, KEYSTONE: T_KEYSTONE, JEWEL: T_JEWEL }
  };

  return API;
});
