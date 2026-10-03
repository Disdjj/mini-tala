// 最小二叉堆，Dijkstra 使用。
// TALA 用的是 routing/priority_queue.go（同样是二叉堆 + decrease-key）；
// 这里用"惰性删除"代替 decrease-key：重复入堆，出堆时跳过过期项。

export class MinHeap<T> {
  private items: { pri: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(pri: number, value: T): void {
    const items = this.items;
    items.push({ pri, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].pri <= items[i].pri) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { pri: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].pri < items[m].pri) m = l;
        if (r < items.length && items[r].pri < items[m].pri) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }
}
