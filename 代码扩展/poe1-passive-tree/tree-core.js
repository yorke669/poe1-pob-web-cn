/*
 * 天赋树渲染/交互核心（与页面解耦的可复用模块）
 * 每个页面用 createTreeView() 创建一个独立实例，各自拥有：
 *   - 独立的 state（缩放/平移/已分配/选中的珠宝孔/视口）
 *   - 独立的 canvas / ctx / size
 *   - 独立的交互模式：'build'（可点多个天赋构建）或 'socket'（只能点一个珠宝孔）
 * 数据文件（poe1-tree-*.js、translations.js）由页面以 <script> 预先注入 window.POE1_TREE。
 */
(function (root) {
  "use strict";

  var NODE_R = { normal: 30, notable: 42, keystone: 54, mastery: 40, socket: 34, classStart: 46, ascendancy: 40 };
  var NODE_FILL = {
    normal: "#566274", notable: "#806b3b", keystone: "#8a5d20", mastery: "#5d4b86",
    socket: "#426b80", ascendancy: "#793b53", classStart: "#87909c"
  };
  var TYPE_ZH = {
    normal: "小点", notable: "中点", keystone: "基石", mastery: "专精",
    socket: "珠宝插槽", classStart: "职业起点", ascendancy: "升华"
  };

  function createTreeView(opts) {
    var mode = opts.mode === "socket" ? "socket" : (opts.mode === "jewel" ? "jewel" : "build");
    var canvas = opts.canvas;
    var ctx = canvas.getContext("2d");
    var stage = opts.stage;
    var tooltip = opts.tooltip || null;

    var TREE, NODES, GROUPS, ORBIT_RADII;
    var ALL_TREES = {};

    // 精灵图：本地优先，失败回退官方 CDN
    var SHEET_FILES = ["skills-3.jpg", "skills-disabled-3.jpg", "mastery-3.png",
                       "mastery-active-selected-3.png", "mastery-disabled-3.png"];
    var CDN = "https://web.poecdn.com/image/passive-skill/";
    var sheets = SHEET_FILES.map(function (file) {
      var img = new Image();
      img.onload = function () { api.draw(); };
      img.onerror = function () { if (img.src.indexOf(CDN) < 0) img.src = CDN + file; };
      img.src = "assets/" + file;
      return img;
    });

    var classStarts = [], ascStarts = [], ascByClass = {};
    var size = { w: 1, h: 1 };

    var state = {
      classIndex: 0,
      asc: "",
      showCluster: false,
      radius: 1800,
      ring: false,
      allocated: Object.create(null),
      selectedSocket: null,
      selectedNode: null,
      highlightNodes: Object.create(null),
      ringKeys: Object.create(null),
      ringSelected: Object.create(null),
      // 军团珠宝效果覆盖：{ graphId: { replaced, name, lines[] } }，由页面注入
      nodeEffects: null,
      hover: null,
      scale: 1, panX: 0, panY: 0,
      view: null
    };

    // ---------------- 数据 ----------------
    function loadTreeFile(file) {
      return new Promise(function (resolve, reject) {
        if (ALL_TREES[file]) return resolve(ALL_TREES[file]);
        var s = document.createElement("script");
        s.src = file + "?v=" + Date.now();
        s.onload = function () {
          var t = window.POE1_TREE;
          ALL_TREES[file] = t;
          s.remove();
          resolve(t);
        };
        s.onerror = function () { reject(new Error("加载失败: " + file)); };
        document.head.appendChild(s);
      });
    }

    function computeStarts() {
      classStarts = []; ascStarts = []; ascByClass = {};
      Object.keys(NODES).forEach(function (id) {
        var n = NODES[id];
        if (n.type === "classStart") classStarts.push({ id: id, node: n });
        if (n.isAscendancyStart) ascStarts.push({ id: id, node: n });
      });
      classStarts.sort(function (a, b) { return a.node.classStartIndex - b.node.classStartIndex; });
      classStarts.forEach(function (c) {
        var ci = c.node.classStartIndex;
        (c.node.out || []).forEach(function (o) {
          var an = NODES[o];
          if (an && an.isAscendancyStart) {
            (ascByClass[ci] = ascByClass[ci] || []).push({ id: o, name: an.ascendancy, isBloodline: !!an.isBloodline });
          }
        });
      });
      Object.keys(ascByClass).forEach(function (ci) {
        ascByClass[ci].sort(function (x, y) { return (x.isBloodline ? 1 : 0) - (y.isBloodline ? 1 : 0) || x.name.localeCompare(y.name); });
      });
    }

    function isVisible(id, n) {
      if (n.group === undefined || n.group < 0) return false;
      if (n.isProxy) return false;
      if (id === "root") return false;
      if (n.expansionJewel && n.expansionJewel.size !== 2 && !state.showCluster) return false;
      return true;
    }

    function buildView() {
      var list = [], ids = {};
      Object.keys(NODES).forEach(function (id) {
        var n = NODES[id];
        if (!isVisible(id, n)) return;
        var v = { id: id, x: n.x, y: n.y, type: n.type, name: n.name, sp: n.sprite || null, isp: n.inactiveSprite || null };
        list.push(v); ids[id] = true;
      });
      var edges = [], seen = {};
      list.forEach(function (v) {
        var n = NODES[v.id], out = n.out || [];
        for (var i = 0; i < out.length; i++) {
          var b = String(out[i]);
          if (!ids[b] || !NODES[b]) continue;
          var key = v.id < b ? v.id + "-" + b : b + "-" + v.id;
          if (seen[key]) continue;
          seen[key] = true;
          var m = NODES[b];
          var e = { a: v.id, b: b, ax: v.x, ay: v.y, bx: m.x, by: m.y };
          var sameOrbit = n.group !== undefined && n.group >= 0 && n.group === m.group &&
                          n.orbit !== undefined && n.orbit === m.orbit && n.orbit > 0;
          if (sameOrbit) {
            var g = GROUPS[String(n.group)];
            if (g) { e.arcRadius = ORBIT_RADII[n.orbit]; e.cx = g.x; e.cy = g.y; }
          }
          edges.push(e);
        }
      });
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      list.forEach(function (v) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      });
      var pad = 400;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      state.view = {
        nodes: list, edges: edges,
        bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        worldW: maxX - minX, worldH: maxY - minY
      };
    }

    function adjacency() {
      if (!state._adj || state._adjKey !== state.asc + "|" + state.showCluster) {
        var adj = {};
        state.view.edges.forEach(function (e) {
          (adj[e.a] = adj[e.a] || []).push(e.b);
          (adj[e.b] = adj[e.b] || []).push(e.a);
        });
        state._adj = adj;
        state._adjKey = state.asc + "|" + state.showCluster;
      }
      return state._adj;
    }

    function startId() {
      var cs = classStarts[state.classIndex];
      return cs ? cs.id : null;
    }
    function resetAllocated() {
      state.allocated = Object.create(null);
      if (mode === "build") {
        var s = startId();
        if (s) state.allocated[s] = true;
      }
    }
    function hasBuild() {
      if (mode !== "build") return false;
      var keys = Object.keys(state.allocated);
      if (keys.length === 0) return false;
      if (keys.length === 1) return keys[0] !== startId();
      return true;
    }
    function prune() {
      var adj = adjacency(), s = startId();
      var reach = Object.create(null), queue = [s];
      if (s) reach[s] = true;
      while (queue.length) {
        var cur = queue.pop();
        (adj[cur] || []).forEach(function (nb) {
          if (state.allocated[nb] && !reach[nb]) { reach[nb] = true; queue.push(nb); }
        });
      }
      Object.keys(state.allocated).forEach(function (id) {
        if (!reach[id]) delete state.allocated[id];
      });
    }
    function canAllocate(id) {
      if (mode !== "build") return false;
      if (state.allocated[id]) return false;
      var adj = adjacency();
      return (adj[id] || []).some(function (nb) { return !!state.allocated[nb]; });
    }

    // ---------------- 坐标 ----------------
    function fitScale() {
      var v = state.view;
      return Math.min(size.w / v.worldW, size.h / v.worldH);
    }
    function scaleNow() { return fitScale() * state.scale; }
    function toScreen(x, y) {
      var v = state.view, B = scaleNow();
      return { x: size.w / 2 + state.panX + (x - v.center.x) * B,
               y: size.h / 2 + state.panY + (y - v.center.y) * B };
    }
    function toWorld(sx, sy) {
      var v = state.view, B = scaleNow();
      return { x: (sx - size.w / 2 - state.panX) / B + v.center.x,
               y: (sy - size.h / 2 - state.panY) / B + v.center.y };
    }
    function visibleBounds() {
      var a = toWorld(0, 0), b = toWorld(size.w, size.h), m = 120;
      return { minX: a.x - m, minY: a.y - m, maxX: b.x + m, maxY: b.y + m };
    }
    function nodeRadius(type) { return NODE_R[type] || 30; }

    var RING_OUTER = { 960: 1320, 1440: 1680, 1800: 2040, 2400: 2880, 2880: 3360 };
    function ringRange(radius, ring) {
      return ring ? { inner: radius, outer: RING_OUTER[radius] || radius + 480 }
                  : { inner: 0, outer: radius };
    }

    function rebuildRing() {
      state.ringKeys = Object.create(null);
      var s = state.selectedSocket;
      if (!s || !NODES[s]) return;
      var n = NODES[s];
      var rng = ringRange(state.radius, state.ring);
      var outer = rng.outer, inner = rng.inner;
      Object.keys(NODES).forEach(function (k) {
        var m = NODES[k];
        if (m.group === undefined || m.group < 0) return;
        if (m.ascendancy || m.type === "ascendancy" || m.type === "mastery" ||
            m.type === "socket" || m.type === "classStart") return;
        if (m.isProxy) return;
        var dx = m.x - n.x, dy = m.y - n.y, d2 = dx * dx + dy * dy;
        if (d2 >= outer * outer || (inner > 0 && d2 < inner * inner)) return;
        state.ringKeys[k] = true;
      });
    }
    function pruneRingSelected() {
      Object.keys(state.ringSelected).forEach(function (k) { if (!state.ringKeys[k]) delete state.ringSelected[k]; });
    }

    // ---------------- 绘制 ----------------
    function draw() {
      if (!state.view) return;
      var v = state.view, B = scaleNow();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
        canvas.width = Math.round(size.w * dpr);
        canvas.height = Math.round(size.h * dpr);
      }
      canvas.style.width = size.w + "px";
      canvas.style.height = size.h + "px";

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#07090d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      var t = toScreen(0, 0);
      ctx.setTransform(dpr * B, 0, 0, dpr * B, dpr * t.x, dpr * t.y);
      ctx.lineCap = "round";

      var vb = visibleBounds();
      var inView = function (x, y) { return x >= vb.minX && x <= vb.maxX && y >= vb.minY && y <= vb.maxY; };

      // 1. 珠宝半径（独立 state，互不干扰）
      if (state.selectedSocket && NODES[state.selectedSocket]) {
        var s = NODES[state.selectedSocket];
        var ring = ringRange(state.radius, state.ring);
        var outer = ring.outer, inner = ring.inner;
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, outer, 0, Math.PI * 2);
        if (inner > 0) ctx.arc(s.x, s.y, inner, 0, Math.PI * 2, true);
        ctx.fillStyle = "rgba(242,184,75,.12)";
        ctx.fill("evenodd");
        ctx.strokeStyle = "#f2b84b";
        ctx.lineWidth = Math.max(16, 1.5 / B);
        ctx.setLineDash([38, 28]);
        ctx.beginPath(); ctx.arc(s.x, s.y, outer, 0, Math.PI * 2); ctx.stroke();
        if (inner > 0) { ctx.beginPath(); ctx.arc(s.x, s.y, inner, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      }

      // 2. 连线
      var adj = adjacency();
      for (var i = 0; i < v.edges.length; i++) {
        var e = v.edges[i];
        if (!inView(e.ax, e.ay) && !inView(e.bx, e.by)) continue;
        var na = NODES[e.a], nb = NODES[e.b];
        var aAsc = na.type === "ascendancy" || na.ascendancy;
        var bAsc = nb.type === "ascendancy" || nb.ascendancy;
        if (aAsc !== bAsc) continue;
        var on = !!state.allocated[e.a] && !!state.allocated[e.b];
        ctx.beginPath();
        ctx.strokeStyle = on ? "#e8c56a" : "#667386";
        ctx.globalAlpha = on ? 0.95 : 0.82;
        ctx.lineWidth = Math.max(on ? 20 : 12, (on ? 2.4 : 1.5) / B);
        if (e.arcRadius !== undefined) {
          var a1 = Math.atan2(e.ay - e.cy, e.ax - e.cx);
          var a2 = Math.atan2(e.by - e.cy, e.bx - e.cx) - a1;
          while (a2 <= -Math.PI) a2 += Math.PI * 2;
          while (a2 > Math.PI) a2 -= Math.PI * 2;
          ctx.arc(e.cx, e.cy, e.arcRadius, a1, a1 + a2, a2 < 0);
        } else {
          ctx.moveTo(e.ax, e.ay); ctx.lineTo(e.bx, e.by);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 3. 节点
      var canSet = Object.create(null);
      if (mode === "build") {
        Object.keys(state.allocated).forEach(function (id) {
          (adj[id] || []).forEach(function (nb) { if (!state.allocated[nb]) canSet[nb] = true; });
        });
      }
      for (var j = 0; j < v.nodes.length; j++) {
        var n = v.nodes[j];
        if (!inView(n.x, n.y)) continue;
        var node = NODES[n.id];
        var isAsc = node.type === "ascendancy" || node.ascendancy;
        var ascDim = state.asc && isAsc && node.ascendancy !== state.asc;
        var inRing = mode === "jewel" && state.selectedSocket && state.ringKeys[n.id];
        var selInRing = mode === "jewel" && !!state.ringSelected[n.id];
        var R = nodeRadius(n.type);
        var alloc = mode === "jewel" ? selInRing : !!state.allocated[n.id];
        var sp = alloc ? (n.sp || n.isp) : (n.isp || n.sp);
        var dimOut = mode === "jewel" && state.selectedSocket && !state.ringKeys[n.id] && n.type !== "socket";
        var cancelled = mode === "jewel" && inRing && !selInRing;
        ctx.globalAlpha = (dimOut || cancelled) ? 0.4 : (ascDim ? 0.4 : 1);

        if (mode === "build" && !alloc && canSet[n.id]) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 18, 0, Math.PI * 2);
          ctx.strokeStyle = "#67e8f9";
          ctx.lineWidth = Math.max(8, 1.5 / B);
          ctx.stroke();
        }
        if (mode === "jewel" && selInRing) {
          // 生效（选中）节点：青色高亮环，亮起
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 14, 0, Math.PI * 2);
          ctx.strokeStyle = "#67e8f9";
          ctx.lineWidth = Math.max(7, 1.2 / B);
          ctx.stroke();
        }
        if (mode === "jewel" && effectOf(n.id) && effectOf(n.id).replaced) {
          // 被军团珠宝替换（基石/中点改名）的节点：金色外环
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 24, 0, Math.PI * 2);
          ctx.strokeStyle = "#e8c56a";
          ctx.lineWidth = Math.max(6, 1.4 / B);
          ctx.stroke();
        }
        if (state.highlightNodes[n.id]) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 44, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255, 38, 0, .28)";
          ctx.fill();
          ctx.strokeStyle = "#ff2600";
          ctx.lineWidth = Math.max(18, 4 / B);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + 18, 0, Math.PI * 2);
          ctx.strokeStyle = "#fff200";
          ctx.lineWidth = Math.max(10, 2.4 / B);
          ctx.stroke();
          ctx.restore();
        }
        if (state.selectedNode === n.id || state.hover === n.id) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, R + (state.selectedNode === n.id ? 26 : 16), 0, Math.PI * 2);
          ctx.strokeStyle = state.selectedNode === n.id ? "#22d3ee" : "#9aa7b8";
          ctx.lineWidth = Math.max(10, 2 / B);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
        var fillColor;
        if (state.asc && isAsc && node.ascendancy === state.asc) fillColor = "#9a6b2f";
        else if (alloc) fillColor = NODE_FILL[n.type] || "#566274";
        else if (cancelled) fillColor = "#39414f";
        else fillColor = NODE_FILL[n.type] || "#566274";
        ctx.fillStyle = fillColor;
        ctx.fill();

        var img = sp ? sheets[sp.sheet] : null;
        if (img && img.complete && img.naturalWidth > 0 && n.type !== "socket") {
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, Math.max(8, R - 2), 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, sp.x, sp.y, sp.w, sp.h, n.x - R, n.y - R, R * 2, R * 2);
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
        if (state.asc && isAsc && node.ascendancy === state.asc) {
          ctx.strokeStyle = "#f5c542";
          ctx.lineWidth = Math.max(6, 2 / B);
        } else if (alloc) {
          ctx.strokeStyle = "#67e8f9";
          ctx.lineWidth = Math.max(5, 1 / B);
        } else {
          ctx.strokeStyle = cancelled ? "#5b6677" : (n.type === "classStart" ? "#f8fafc" : "#9aa7b8");
          ctx.lineWidth = Math.max(2.5, 1 / B);
        }
        ctx.stroke();

        if (n.type === "socket") {
          ctx.beginPath();
          ctx.arc(n.x, n.y, Math.max(8, R * 0.38), 0, Math.PI * 2);
          ctx.fillStyle = state.selectedSocket === n.id ? "#c084fc" : "#111827";
          ctx.fill();
          ctx.strokeStyle = state.selectedSocket === n.id ? "#f3e8ff" : "#7dd3fc";
          ctx.lineWidth = Math.max(5, 1.5 / B);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------------- 尺寸 / 交互 ----------------
    function resize() {
      size.w = Math.max(1, stage.clientWidth);
      size.h = Math.max(1, stage.clientHeight);
      draw();
    }
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);

    function hitTest(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var w = toWorld(clientX - r.left, clientY - r.top);
      var best = null, bestD = Infinity, v = state.view;
      for (var i = 0; i < v.nodes.length; i++) {
        var n = v.nodes[i];
        var R = nodeRadius(n.type) + 6;
        var dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy;
        if (d <= R * R && d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    function onNodeClick(id) {
      var n = NODES[id];
      state.selectedNode = id;
      if (mode === "socket") {
        if (n.type === "socket") {
          state.selectedSocket = state.selectedSocket === id ? null : id;
          if (opts.onSocketChange) opts.onSocketChange(state.selectedSocket);
        }
        renderDetail(id);
        if (opts.onNodeInfo) opts.onNodeInfo(id);
        draw();
        return;
      }
      if (mode === "jewel") {
        if (n.type === "socket") {
          if (state.selectedSocket === id) {
            state.selectedSocket = null;
            state.ringKeys = Object.create(null);
            state.ringSelected = Object.create(null);
          } else {
            state.selectedSocket = id;
            state.ringSelected = Object.create(null);
            rebuildRing();
            // 选中珠宝孔后，圈内天赋默认全部生效（全选）
            Object.keys(state.ringKeys).forEach(function (k) { state.ringSelected[k] = true; });
          }
          if (opts.onSocketChange) opts.onSocketChange(state.selectedSocket);
        } else if (state.selectedSocket && state.ringKeys[id]) {
          if (state.ringSelected[id]) delete state.ringSelected[id];
          else state.ringSelected[id] = true;
          if (opts.onRingSelect) opts.onRingSelect(id);
        }
        renderDetail(id);
        if (opts.onNodeInfo) opts.onNodeInfo(id);
        draw();
        return;
      }
      // build 模式
      if (n.type === "socket") {
        state.selectedSocket = state.selectedSocket === id ? null : id;
        if (opts.onSocketChange) opts.onSocketChange(state.selectedSocket);
      } else if (state.allocated[id]) {
        if (id !== startId()) { delete state.allocated[id]; prune(); }
      } else if (canAllocate(id)) {
        state.allocated[id] = true;
      }
      renderDetail(id);
      if (opts.onNodeInfo) opts.onNodeInfo(id);
      renderJewel();
      renderStats();
      draw();
    }

    canvas.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var r = canvas.getBoundingClientRect();
      var mx = ev.clientX - r.left, my = ev.clientY - r.top;
      var f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      var next = Math.min(8, Math.max(0.6, state.scale * f));
      var k = next / state.scale;
      state.panX = mx - size.w / 2 - (mx - size.w / 2 - state.panX) * k;
      state.panY = my - size.h / 2 - (my - size.h / 2 - state.panY) * k;
      state.scale = next;
      draw();
    }, { passive: false });

    var drag = null;
    canvas.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      canvas.setPointerCapture(ev.pointerId);
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, px: state.panX, py: state.panY, moved: false };
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", function (ev) {
      if (drag && drag.id === ev.pointerId) {
        if (Math.abs(ev.clientX - drag.x) > 4 || Math.abs(ev.clientY - drag.y) > 4) drag.moved = true;
        if (drag.moved) {
          state.panX = drag.px + ev.clientX - drag.x;
          state.panY = drag.py + ev.clientY - drag.y;
          draw();
        }
        return;
      }
      var hit = hitTest(ev.clientX, ev.clientY);
      var id = hit ? hit.id : null;
      if (id !== state.hover) { state.hover = id; draw(); }
      showTooltip(ev.clientX, ev.clientY, id);
    });
    canvas.addEventListener("pointerup", function (ev) {
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      var d = drag; drag = null;
      if (!d || d.moved) return;
      var hit = hitTest(ev.clientX, ev.clientY);
      if (hit) onNodeClick(hit.id);
    });
    canvas.addEventListener("pointerleave", function () {
      state.hover = null; hideTooltip(); draw();
    });

    // ---------------- 文本 / 翻译 ----------------
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }
    function cleanNewlines(s) {
      return String(s).replace(/\\+n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    }
    function tr(text, table) {
      if (text == null) return text;
      var k = String(text).trim();
      if (!k) return text;
      var dict = (window.POE1_TREE_TR && window.POE1_TREE_TR[table]) || {};
      var mk = cleanNewlines(k);
      if (dict[mk]) return cleanNewlines(dict[mk]);
      if (table === "stat") {
        var nk = normKey(mk);
        var dk = normIndex()[nk];
        if (dk) {
          var val = dict[dk];
          var nums = mk.match(/[+-]?\d+(?:\.\d+)?/g) || [];
          var out = val.replace(/\{(\d+)\}/g, function (_, n) { return nums[+n] != null ? nums[+n] : "{" + n + "}"; });
          return cleanNewlines(out);
        }
      }
      var segs = mk.split(/\s*\/\s*|\n/);
      if (segs.length > 1) {
        var joined = segs.map(function (s) { return tr(s, table); }).join(" / ");
        if (joined !== mk) return joined;
      }
      return cleanNewlines(text);
    }
    function normKey(s) {
      return cleanNewlines(s).replace(/\{\d+\}/g, "#").replace(/[+-]?\d+(?:\.\d+)?/g, "#");
    }
    var _normCache = null;
    function normIndex() {
      if (_normCache) return _normCache;
      var dict = (window.POE1_TREE_TR && window.POE1_TREE_TR.stat) || {};
      var seen = {};
      for (var dk in dict) {
        var nk = normKey(dk), ph = dk.indexOf("{") >= 0;
        if (!seen[nk]) seen[nk] = { dk: dk, ph: ph };
        else if (ph && !seen[nk].ph) seen[nk] = { dk: dk, ph: true };
      }
      var idx = {};
      for (var k in seen) idx[k] = seen[k].dk;
      _normCache = idx;
      return idx;
    }
    function statsHtml(n) {
      var stats = n.stats || [];
      if (n.type === "mastery" && n.masteryEffects && n.masteryEffects.length) {
        stats = n.masteryEffects.map(function (e) { return (e.stats || []).join(" / "); });
      }
      var html = "";
      if (stats.length) {
        html += "<ul>" + stats.slice(0, 12).map(function (s) { return "<li>" + escapeHtml(tr(s, "stat")) + "</li>"; }).join("") + "</ul>";
      }
      var rt = n.reminderText || [];
      if (rt.length) {
        html += '<div class="reminder">' + rt.map(function (s) { return escapeHtml(tr(s, "reminder")); }).join("<br>") + "</div>";
      }
      return html;
    }

    // ---------------- 军团珠宝效果覆盖 ----------------
    function effectOf(id) {
      return (state.nodeEffects && state.nodeEffects[id]) || null;
    }
    /** 显示名：被替换的节点用军团珠宝赋予的新名 */
    function displayName(id, n) {
      var e = effectOf(id);
      if (e && e.replaced && e.name) return e.name;
      return tr(n.name, "name");
    }
    /** 词条：替换则只显示新词条；追加则原词条 + 追加词条 */
    function statsHtmlEff(id, n) {
      var e = effectOf(id);
      if (!e) return statsHtml(n);
      var tag = '<div style="color:#e8c56a;font-size:11px;margin:4px 0 2px;font-weight:600">' +
        (e.replaced ? "替换为「" + escapeHtml(e.name || "替代天赋") + "」"
                    : "追加 " + (e.lines || []).length + " 条") + "</div>";
      var ul = "<ul>" + (e.lines || []).map(function (l) { return "<li>" + escapeHtml(l) + "</li>"; }).join("") + "</ul>";
      return e.replaced ? (tag + ul) : (statsHtml(n) + tag + ul);
    }

    function showTooltip(clientX, clientY, id) {
      if (!tooltip) return;
      if (!id) { hideTooltip(); return; }
      var n = NODES[id];
      tooltip.innerHTML = '<div class="t-name">' + escapeHtml(displayName(id, n)) + "</div>" +
        '<div class="t-type">' + (TYPE_ZH[n.type] || n.type) + (n.ascendancy ? " · " + escapeHtml(tr(n.ascendancy, "name")) : "") + "</div>" +
        statsHtmlEff(id, n);
      tooltip.style.display = "block";
      var r = stage.getBoundingClientRect();
      var x = clientX - r.left + 16, y = clientY - r.top + 16;
      if (x + tooltip.offsetWidth > r.width) x = clientX - r.left - tooltip.offsetWidth - 16;
      if (y + tooltip.offsetHeight > r.height) y = r.height - tooltip.offsetHeight - 8;
      tooltip.style.left = x + "px";
      tooltip.style.top = y + "px";
    }
    function hideTooltip() { if (tooltip) tooltip.style.display = "none"; }

    // ---------------- 面板 / 控件 ----------------
    var detail = opts.detail || null;
    function renderDetail(id) {
      if (!detail) return;
      if (!id || !NODES[id]) {
        detail.innerHTML = mode === "build"
          ? '<div class="hint">在树上悬停查看天赋，点击可分配（需与起点连通）。</div>'
          : '<div class="hint">在树上点击珠宝插槽（紫色）选择要分析的珠宝孔。</div>';
        return;
      }
      var n = NODES[id];
      var alloc = !!state.allocated[id];
      detail.innerHTML =
        '<div class="node-name">' + escapeHtml(displayName(id, n)) + "</div>" +
        '<div class="node-type">' + (TYPE_ZH[n.type] || n.type) +
          (n.ascendancy ? " · " + escapeHtml(n.ascendancy) : "") +
          (mode === "build" && alloc ? " · <span style='color:#e8c56a'>已分配</span>" : (mode === "build" && canAllocate(id) ? " · <span style='color:#67e8f9'>可分配</span>" : "")) +
        "</div>" +
        statsHtmlEff(id, n) +
        '<div class="hint" style="margin-top:8px">节点 ID ' + id + (n.group !== undefined ? " · group " + n.group + " · orbit " + n.orbit : "") + "</div>";
    }
    var statPoints = opts.statPoints || null, statSockets = opts.statSockets || null, statAsc = opts.statAsc || null;
    function renderStats() {
      if (!statPoints) return;
      if (mode !== "build") return;
      var pts = 0, socks = 0, asc = 0;
      Object.keys(state.allocated).forEach(function (id) {
        var n = NODES[id];
        if (n.type === "classStart") return;
        pts++; if (n.type === "socket") socks++; if (n.type === "ascendancy") asc++;
      });
      statPoints.textContent = pts; statSockets.textContent = socks; statAsc.textContent = asc;
    }

    var jewelBlock = opts.jewelBlock || null;
    function renderJewel() {
      if (!jewelBlock) return;
      var id = state.selectedSocket;
      if (!id) { jewelBlock.style.display = "none"; return; }
      var s = NODES[id];
      var rng = ringRange(state.radius, state.ring);
      var outer = rng.outer, inner = rng.inner;
      var list = [], proxyCount = 0;
      Object.keys(NODES).forEach(function (k) {
        var n = NODES[k];
        if (n.group === undefined || n.group < 0) return;
        if (n.ascendancy || n.type === "ascendancy" || n.type === "mastery" ||
            n.type === "socket" || n.type === "classStart") return;
        var dx = n.x - s.x, dy = n.y - s.y, d2 = dx * dx + dy * dy;
        if (d2 >= outer * outer || (inner > 0 && d2 < inner * inner)) return;
        if (n.isProxy) { proxyCount++; return; }
        list.push({ id: k, name: n.name, type: n.type, alloc: !!state.allocated[k] });
      });
      list.sort(function (a, b) { return Number(b.alloc) - Number(a.alloc) || a.name.localeCompare(b.name); });
      jewelBlock.style.display = "block";
      if (opts.jewelName) opts.jewelName.textContent = (tr(s.name, "name") || "插槽") + " #" + id;
      if (opts.jewelRadius) opts.jewelRadius.textContent = state.ring ? inner + " ~ " + outer : "≤ " + outer;
      if (opts.jewelCount) opts.jewelCount.textContent =
        list.length + " 天赋（含定位代理共 " + (list.length + proxyCount) + "，已分配 " +
        list.filter(function (x) { return x.alloc; }).length + "）";
      if (opts.jewelDetail) opts.jewelDetail.innerHTML = list.slice(0, 60).map(function (x) {
        return '<button class="result-item" data-node="' + x.id + '">' +
          escapeHtml(tr(x.name, "name")) + (x.alloc ? ' <span style="color:#e8c56a">·已分配</span>' : "") +
          "<br><small>" + (TYPE_ZH[x.type] || x.type) + " · " + x.id + "</small></button>";
      }).join("");
    }

    function focusNode(id) {
      var n = NODES[id];
      if (!n) return;
      state.selectedNode = id;
      centerView(n.x, n.y, 3);
      if (opts.onNodeInfo) opts.onNodeInfo(id);
    }
    function centerView(cx, cy, scale) {
      state.scale = scale;
      var B = fitScale() * scale;
      state.panX = -(cx - state.view.center.x) * B;
      state.panY = -(cy - state.view.center.y) * B;
      draw();
    }
    function focusClass() {
      var cs = classStarts[state.classIndex];
      if (!cs) return;
      centerView(NODES[cs.id].x, NODES[cs.id].y, 2.0);
    }
    function focusAscendancy() {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
      state.view.nodes.forEach(function (v) {
        var n = NODES[v.id];
        if (n.type === "ascendancy" || n.ascendancy) {
          found = true;
          if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        }
      });
      if (!found) return;
      var pad = 500, w = (maxX - minX) + 2 * pad, h = (maxY - minY) + 2 * pad;
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      var B = Math.min(size.w / w, size.h / h);
      centerView(cx, cy, B / fitScale());
    }

    function rebuild(keepView) {
      buildView();
      resetAllocated();
      state.selectedSocket = null;
      state.ringKeys = Object.create(null);
      state.ringSelected = Object.create(null);
      state.selectedNode = null;
      state.highlightNodes = Object.create(null);
      renderJewel();
      if (detail) renderDetail(null);
      renderStats();
      if (!keepView) { state.scale = 1; state.panX = 0; state.panY = 0; }
      draw();
    }

    function setActiveTree(tree) {
      if (!tree) return;
      TREE = tree; NODES = tree.nodes; GROUPS = tree.groups; ORBIT_RADII = tree.constants.orbitRadii;
      computeStarts();
      rebuild(false);
    }

    var api = {
      state: state,
      draw: draw, resize: resize,
      focusClass: focusClass, focusAscendancy: focusAscendancy, focusNode: focusNode,
      highlightNodes: function (ids) {
        state.highlightNodes = Object.create(null);
        (ids || []).forEach(function (id) { if (NODES[id]) state.highlightNodes[id] = true; });
        draw();
      },
      fit: function () { state.scale = 1; state.panX = 0; state.panY = 0; draw(); },
      ringRange: ringRange,
      setRadius: function (r) { state.radius = r; rebuildRing(); pruneRingSelected(); renderJewel(); draw(); },
      setRing: function (on) { state.ring = on; rebuildRing(); pruneRingSelected(); renderJewel(); draw(); },
      selectAllInRing: function () { if (!state.selectedSocket) return; Object.keys(state.ringKeys).forEach(function (k) { state.ringSelected[k] = true; }); draw(); },
      clearRing: function () { state.ringSelected = Object.create(null); draw(); },
      getSelectedInRing: function () { return Object.keys(state.ringSelected); },
      getRingKeys: function () { return Object.keys(state.ringKeys); },
      /** 注入军团珠宝效果覆盖：{ graphId: { replaced, name, lines[] } }（null 清除） */
      setNodeEffects: function (map) {
        state.nodeEffects = map || null;
        if (detail) renderDetail(state.selectedNode);
        draw();
      },
      rebuild: rebuild,
      load: function (dataFiles) {
        return Promise.all(dataFiles.map(function (d) {
          return loadTreeFile(d.file).catch(function (e) { console.error(e); return null; });
        })).then(function (trees) {
          var first = trees[0] || Object.keys(ALL_TREES).map(function (k) { return ALL_TREES[k]; })[0];
          setActiveTree(first);
          return first;
        });
      },
      getNODES: function () { return NODES; },
      getClassStarts: function () { return classStarts; },
      getAscByClass: function () { return ascByClass; },
      getStartId: function () { return startId(); }
    };

    // 页面级控件（职业/升华）由页面自己创建，调用 api 的方法
    api.setClassIndex = function (idx) {
      state.classIndex = idx; state.asc = "";
      var list = (ascByClass[classStarts[idx].node.classStartIndex] || []);
      if (opts.fillAsc) opts.fillAsc(list);
      rebuild(false); focusClass();
    };
    api.setAsc = function (name) {
      state.asc = name; resetAllocated(); state.selectedNode = null;
      if (detail) renderDetail(null);
      draw();
    };
    api.setShowCluster = function (on) { state.showCluster = on; rebuild(true); };

    return api;
  }

  root.createTreeView = createTreeView;
})(typeof self !== "undefined" ? self : this);
