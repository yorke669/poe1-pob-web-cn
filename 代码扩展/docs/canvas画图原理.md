# Canvas 画图原理（以 poe1-passive-tree 页面为例）

> 适用范围：解释 `代码扩展/poe1-passive-tree/index.html` 为何能用单个 `<canvas>` 渲染 3000+ 天赋节点、支持缩放平移与点击交互。核心思路与游戏引擎渲染同源：**用 immediate-mode（每帧重画）替代 retained-mode（DOM 保留对象）**，靠 GPU/矩阵获得对大量对象的掌控力。

---

## 一、为什么能渲染这么复杂

整棵树只有 **一个 `<canvas>` 元素**（`index.html:339` `getContext("2d")`），没有 3000 个 `<div>`/`<img>`。渲染时 `draw()` 逐节点发出"画圆、贴图、描边"的指令，浏览器把这些指令合成到一张位图上。

- 每个天赋点 = 几次绘制：`arc()` 画圆底 → `drawImage()` 把精灵图一小块贴上去（`index.html:473`，先 `clip` 成圆形）→ `stroke()` 描边。
- 那些"复杂花纹"图标来自 `assets/` 里**预先烘焙好的精灵图**（skills-3.jpg 等）。画节点本质就是 `drawImage` 抠一张图的一小块——看着复杂，其实是贴图。
- 连线用 `arc()` 绕 group 中心画圆弧，或直线。

**结论**：页面显示的"复杂图"不是一张现成大图，而是每帧按数据现画出来的位图。

---

## 二、缩放平移的原理 —— 相机（坐标系变换）

数据里存的是"世界坐标"（group 中心、节点 x/y）。屏幕显示靠一个**仿射变换**把世界坐标映射到屏幕像素：

```348:357:代码扩展/poe1-passive-tree/index.html
function toScreen(x, y) {
  var v = state.view, B = scaleNow();
  return { x: size.w / 2 + state.panX + (x - v.center.x) * B,
           y: size.h / 2 + state.panY + (y - v.center.y) * B };
}
function toWorld(sx, sy) { ... }   // 上面公式的逆运算
```

`toScreen` = 平移(panX) + 缩放(B)。真正绘制时一次性交给 GPU（`index.html:384`）：

```384:384:代码扩展/poe1-passive-tree/index.html
ctx.setTransform(dpr * B, 0, 0, dpr * B, dpr * t.x, dpr * t.y);
```

之后所有绘制都用**世界坐标**调用，矩阵自动把它摆到正确屏幕位置。**缩放/平移只是改 `B` 和 `panX/panY`，然后重跑一次 `draw()`**——这就是能丝滑缩放的原因。

---

## 三、为什么还流畅 —— 视锥剔除

3000 节点不会全画。每帧先算当前可见的世界范围，只画屏幕内的节点：

```359:388:代码扩展/poe1-passive-tree/index.html
function visibleBounds() { ... }          // 屏幕四角反算成世界范围
var inView = function (x, y) { return x >= vb.minX && x <= vb.maxX && ... };  // 只画范围内的
```

所以无论总节点多少，每帧实际绘制量 = 视口内可见那几百个，开销恒定。

---

## 四、点击交互的原理 —— 数学命中，不是点 DOM

Canvas 上的图形没有 DOM 节点可"点"，做法是**把鼠标坐标反算回世界坐标，再找最近节点**：

```563:575:代码扩展/poe1-passive-tree/index.html
function hitTest(clientX, clientY) {
  var w = toWorld(clientX - r.left, clientY - r.top);   // 屏幕 → 世界
  for (var i = 0; i < v.nodes.length; i++) {
    var n = v.nodes[i];
    var R = nodeRadius(n.type) + 6;
    var dx = n.x - w.x, dy = n.y - w.y;
    if (dx*dx + dy*dy <= R*R && ...) best = n;            // 距离 < 半径 即命中
  }
  return best;
}
```

点中后 `onNodeClick`（`index.html:578`）按节点类型改状态（分配/取消/选珠宝），再 `draw()` 重画。这套"坐标反算 + 最近邻"是 Canvas 交互的通用套路——**交互逻辑全在 JS 数学里，与 DOM 事件解耦**。

---

## 五、对照表

| 你看到的 | 实际原理 |
|----------|----------|
| 复杂的树 | 每帧按数据现画的位图 + 贴精灵图 |
| 缩放平移 | 改变换矩阵后重画 |
| 流畅 | 视锥剔除，只画可见部分 |
| 点击 | 反算世界坐标 + 最近邻命中 |
| 分配/连线 | 纯 JS 状态 + `draw()` 重绘 |

---

## 六、与其它方案对比

- **DOM/SVG**：每个节点是一个元素 + 事件监听，3000 个对象会带来巨大内存与重排开销，缩放卡顿。
- **Canvas 2D**：单元素、立即模式，绘制调用少、无重排，适合这种"大量同类图形 + 高频重绘"的场景。
- 代价：没有内置命中检测/可访问性，交互需自己实现 `hitTest`（见第四节）。
