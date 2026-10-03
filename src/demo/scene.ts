// 唯一的演示场景：examples/task-queue.d2 手工翻译成的图数据。
// 尺寸取自真实 TALA 的渲染结果（examples/task-queue.tala.svg），这样两边对比才公平。

import type { GraphSpec } from "../core/types";

const ICON = {
  go: "https://icons.d2lang.com/dev%2Fgo.svg",
  bar: "https://icons.d2lang.com/essentials%2F092-graph%20bar.svg",
  download: "https://icons.d2lang.com/essentials%2F095-download.svg",
  attach: "https://icons.d2lang.com/essentials%2F195-attachment.svg",
};

export const TASK_QUEUE: GraphSpec = {
  direction: "right",
  nodes: [
    { id: "user01", label: "User01", shape: "person", multiple: true, width: 110, height: 92 },
    { id: "user02", label: "User02", shape: "person", multiple: true, width: 110, height: 92 },
    { id: "user03", label: "User03", shape: "person", multiple: true, width: 110, height: 92 },

    { id: "container", label: "Application", icon: ICON.go, direction: "right" },
    { id: "container.task01", label: "task01", parent: "container", icon: ICON.bar, multiple: true, width: 185, height: 132 },
    { id: "container.task02", label: "task02", parent: "container", icon: ICON.download, multiple: true, width: 185, height: 132 },
    { id: "container.task03", label: "task03", parent: "container", icon: ICON.attach, multiple: true, width: 185, height: 132 },

    { id: "container.queue", label: "Queue Library", parent: "container", icon: ICON.go, fill: "honeydew" },
    { id: "container.queue.producer", label: "Producer", parent: "container.queue", fill: "PapayaWhip", mono: true, width: 196, height: 86 },
    { id: "container.queue.database", label: "Ring\nBuffer", parent: "container.queue", shape: "cylinder", mono: true, width: 158, height: 170 },
    { id: "container.queue.consumer", label: "Consumer", parent: "container.queue", fill: "PapayaWhip", mono: true, width: 197, height: 86 },

    { id: "container.worker01", label: "worker01", parent: "container", icon: ICON.bar, width: 228, height: 132 },
    { id: "container.worker02", label: "worker02", parent: "container", icon: ICON.download, width: 228, height: 132 },
    { id: "container.worker03", label: "worker03", parent: "container", icon: ICON.bar, width: 228, height: 132 },
    { id: "container.worker04", label: "worker04", parent: "container", icon: ICON.attach, width: 228, height: 132 },
  ],
  edges: [
    { from: "user01", to: "container.task01", label: "Create Task", animated: true },
    { from: "user02", to: "container.task02", label: "Create Task", animated: true },
    { from: "user03", to: "container.task03", label: "Create Task", animated: true },
    { from: "container.queue.producer", to: "container.queue.database" },
    { from: "container.queue.database", to: "container.queue.consumer" },
    { from: "container.task01", to: "container.queue.producer", label: "Enqueue Task" },
    { from: "container.task02", to: "container.queue.producer", label: "Enqueue Task" },
    { from: "container.task03", to: "container.queue.producer", label: "Enqueue Task" },
    { from: "container.queue.consumer", to: "container.worker01", label: "Dispatch Task" },
    { from: "container.queue.consumer", to: "container.worker02", label: "Dispatch Task" },
    { from: "container.queue.consumer", to: "container.worker03", label: "Dispatch Task" },
    { from: "container.queue.consumer", to: "container.worker04", label: "Dispatch Task" },
  ],
};
