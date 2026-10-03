# mini-tala

[TALA](https://github.com/d2lang/d2/tree/master/d2layouts/d2talalayout)（D2 的布局引擎）的**极简复刻**，用于学习它的核心思路，并附带一个浏览器动画演示。

真正的 TALA 有约 6.4 万行 Go、38 个流水线阶段。mini-tala 只保留其中最能体现思路的 6 个阶段，算法核心约 1900 行 TypeScript：

```
① 结构识别 → ② 逐层放置 → ③ 轴对齐 → ④ 正交路由 → ⑤ 标签放置 → ⑥ 多 seed 竞速
```

## 动画演示

**在线体验：<https://disdjj.github.io/mini-tala/>**（也可以通过 [Gist 预览](https://gistpreview.github.io/?6b738c2422ab87fff842f9cfb568c9e8) 打开）

本地运行：

```sh
npm install
npm run dev      # 本地开发
npm run build    # 打包成单文件 dist/index.html，双击即可打开
```

演示会依次播放：

1. **结构识别**：先描出容器树（Queue Library 先排，Application 后排），再把 4 个 worker 圈成一个簇。
2. **逐层放置**：一层一层地看节点在网格上跳动。已经排好的内层容器作为整体跟着移动；虚线十字是“邻居中位数 + 温度抖动”算出的目标点。
3. **轴对齐**：中心连线从红色（歪）逐条变成绿色（直）。
4. **路由**：淡青色细线是可见性图，青色波纹是 Dijkstra 的探索顺序；最后 worker 的 4 条边合并成一个分叉。
5. **标签**：每个标签的候选位置用红、黄、绿框显示得分。
6. **选优**：seed 1、2、3 的结果并排显示，旁边是真实 TALA 的输出。

键盘：`空格` 播放或暂停，`← →` 单步；拖动进度条或点击阶段名可以直接跳转。

## 演示场景

只用一张图：[`examples/task-queue.d2`](examples/task-queue.d2)。它是一个任务队列架构，包含 3 层嵌套容器、14 个节点、12 条边和 10 个边标签。真实 TALA 对这张图的输出存在 [`examples/task-queue.tala.svg`](examples/task-queue.tala.svg)，演示最后一步会把两者并排对比。

## 流水线

| 阶段 | 文件 | 做什么 | 对照 TALA 源码 |
|---|---|---|---|
| ① 结构识别 | `hierarchy.ts`、`clusters.ts` | 建立容器树；邻居完全相同的兄弟节点（worker01..04）折叠成一个簇 | `layoutgraph`、`grouping/clusters.go` |
| ② 逐层放置 | `nested.ts`、`placement.ts`、`cost.ts` | 自底向上：每个容器内部做网格上的温度抖动局部搜索，排好后整体当成一个盒子交给上一层 | `placement/node_placement.go`、`placementcost/edge_length.go` |
| ③ 轴对齐 | `align.ts` | 把相连节点平移到同一条中心线上，让边变直 | `placement/alignment.go` |
| ④ 正交路由 | `ovg.ts`、`router.ts`、`fork.ts` | 正交可见性图上跑 Dijkstra，按 3 种边顺序取最优；一对多的簇边改成“主干 + 分叉” | `routing/ovg.go`、`ovg_edge_router.go`、`postprocess.go` |
| ⑤ 标签放置 | `labels.ts` | 候选位置打分，依次放置，已放的标签成为后续标签的障碍 | `labeling/placement.go` |
| ⑥ 多 seed 竞速 | `layout.ts` | seed 1、2、3 各跑一遍，`penalty = 0.5×拐点 + 3×斜线 + 交叉 + (1−labelScore)` 最低的胜出 | `quality/scoring.go`、`layout.go` |

### 几个关键点

- **边上提（edge abduction）**：排 Application 这一层时，`user01 → task01` 这条边被看作“task01 和外界相连”。task01 因此被拉到外圈，才能和容器外的 user 对上。
- **方位提示**：排最外层时，Application 已经排好了。`user02 → task02` 会读出 task02 位于容器顶部，于是把 user02 拉到上方，而不是随便放到左边。
- **方向继承**：Queue Library 自己没写 `direction`，沿祖先链继承到 `right`，所以 producer → ring buffer → consumer 排成一行。
- **簇分叉**：consumer 到 4 个 worker 的边共用一段主干，在汇合线上分叉，标签排在各自支线的高度上。

## 测试

```sh
npm test
```

测试覆盖以下几点：

- 自底向上的放置顺序；簇识别正确（worker 成簇，task 不成簇）；节点都在自己的容器里；兄弟节点互不重叠。
- 12 条边全部路由成功；路线正交、不穿过无关节点、没有交叉；consumer → worker 共用主干。
- 10 个标签全部放好且两两不重叠；`penalty` 计分正确；多 seed 选优结果确定。

## License

MIT
