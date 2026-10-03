# mini-tala

[TALA](https://github.com/d2lang/d2/tree/master/d2layouts/d2talalayout)（D2 的布局引擎）的**极简复刻**，用于学习它的核心思路，并附带一个浏览器动画演示。

真正的 TALA 有约 6.4 万行 Go、38 个流水线阶段，并且会识别树、层级、簇、序列等结构。mini-tala 只保留其中最核心的三段，算法核心约 1000 行 TypeScript：

```
① 节点放置  →  ② 正交路由  →  ③ 多 seed 竞速
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

1. **放置**：节点在网格上跳动。虚线十字是“邻居中位数 + 温度抖动”算出的目标点，右侧曲线是放置代价的收敛过程。
2. **路由**：淡青色细线是正交可见性图，青色波纹是 Dijkstra 的探索顺序，橙色线是刚找到的路线。
3. **选优**：seed 1、2、3 的最终结果并排显示，`penalty` 最低的方案胜出。

键盘：`空格` 播放或暂停，`→` 单步前进。

## 三段算法

### ① 节点放置：网格上的温度抖动局部搜索（`src/core/placement.ts`）

TALA 源码注释说这一段 *“heavily based on Graph Compact Orthogonal Layout by Freivalds and Glagolevs”*。

- **初始化**：按 BFS 序逐个放置，每个节点放到已放邻居坐标中位数附近、代价最低的空格上。
- **迭代**：`90·√N` 轮，温度从 `2·√N` 几何衰减到 `0.2`。每一轮：
  1. 随机打乱节点顺序；
  2. 目标点 = 邻居坐标**中位数** + `U(-temp, temp)` 的随机抖动；
  3. 在目标点附近的菱形区域里，移到代价最低的空格。**即使比当前位置差也照样移动**，算法靠这一点跳出局部最优；
  4. 每 9 轮压缩一次，删掉空行和空列。
- **收尾**：温度设为 0，做几轮纯贪心，只接受严格变好的移动。

代价函数（`src/core/cost.ts`）保留了 TALA 的四个核心项：

| 项 | 含义 |
|---|---|
| 距离 | 边两端的欧氏距离 |
| 对角罚 | 两端不在同一行或同一列时必须拐弯，加 `TURN_COST` |
| 遮挡罚 | 同一行或列但中间夹着其他节点时，加 `2 × TURN_COST` |
| 方向罚 | 默认偏好“向下 / 向右”，逆向的边按偏离量乘以 0.3 加罚 |

### ② 正交路由：可见性图 + Dijkstra（`src/core/ovg.ts`、`src/core/router.ts`）

- **端口**：每个节点每条边上 3 个，分别在 25%、50%、75% 处，中间端口最便宜。
- **OVG**：所有端口坐标与网格线坐标做笛卡尔积，去掉落在节点内部的点，然后只把同一行、同一列上的相邻点连起来。在这张图上走出的路径天然就是正交的。
- **Dijkstra**：搜索状态是 `(点, 到达方向)`，这样拐弯可以单独计价。每一步代价 = 线段长度 + 拐弯 + 交叉 + 与已有线重叠。
- **边的顺序**：按“短边优先”“长边优先”“声明顺序”各贪心路由一遍，每条边只路由一次，不做拆线重布（rip-up），最后取总代价最低的顺序。

### ③ 多 seed 竞速（`src/core/layout.ts`）

```
penalty = Σ边 (0.5 × 拐点数 + 3 × 斜线段数) + 交叉数
```

默认用 seed `1, 2, 3` 各跑一遍完整流程。先比 `penalty`，相同再比面积，仍然相同时取后面的 seed。全程使用确定性随机数，同一个 seed 永远得到同一张图。

## 和真正的 TALA 对照

| mini-tala | TALA 源码（`d2/d2layouts/d2talalayout/`） | 省略了什么 |
|---|---|---|
| `placement.ts` | `internal/placement/node_placement.go`、`sizeless_optimizer.go` | 带尺寸的第二阶段、stress 初始化（偶数 seed）、交换与旋转、hub 处理 |
| `cost.ts` | `internal/placementcost/edge_length.go` | 簇排列、near、herd、对称奖励、flow continuity 等十几项 |
| `ovg.ts` | `internal/routing/ovg.go` | 隧道、外围多层边界点、树边中点 |
| `router.ts` | `internal/routing/ovg_edge_router.go`、`coordinator.go` | slingshot 快速路径、簇共享端口、箭头标签避让 |
| `layout.ts` | `internal/quality/scoring.go`、`layout.go` | 标签放置评分 `(1 − labelScore)` |
| — | `internal/hierarchy/` | 完整的 Sugiyama：network simplex 分层、sifting、Brandes–Köpf |
| — | `internal/trees/`、`internal/grouping/` | 树、簇、序列的识别与折叠 |
| — | 路由后处理 10 余个阶段、`internal/labeling/` | 端口交换、线段均衡、通道分离、标签放置 |

## 测试

```sh
npm test
```

测试覆盖以下几点：

- 放置结果不重叠；同一个 seed 结果完全相同；链状图收敛成一条直线；星形图的叶子紧贴中心节点。
- 路由结果是正交的；不穿过任何节点；首尾落在节点边框上；能绕开中间节点。
- `penalty` 计分正确，并且确实选出了最低分的 seed。

## License

MIT
