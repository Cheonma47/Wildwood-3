/**
 * Pedestrian routing graph built from real OSM street/footway geometry.
 * Nodes are OSM node ids (plus synthetic negative ids for the Boardwalk
 * centreline and connectors). Edge weights are real lengths in metres.
 */
import type { Road } from '../../world/data/types';
import { closestOnSegment, type V2 } from '../../world/math/polygon';
import { SegmentIndex } from '../../world/math/segmentIndex';

interface Edge { to: number; w: number }

const NOT_WALKABLE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'raceway']);

export interface RouteResult {
  points: V2[];
  length: number;
}

export class RoadGraph {
  readonly pos = new Map<number, V2>();
  readonly adj = new Map<number, Edge[]>();
  private segs = new SegmentIndex<{ a: number; b: number }>(40);
  private nextSynthetic = -1;

  constructor(roads: Road[]) {
    for (const r of roads) {
      if (NOT_WALKABLE.has(r.kind)) continue;
      for (let i = 0; i < r.nodes.length; i++) this.pos.set(r.nodes[i], r.pts[i]);
      for (let i = 1; i < r.nodes.length; i++) this.link(r.nodes[i - 1], r.nodes[i]);
    }
  }

  private link(a: number, b: number): void {
    if (a === b) return;
    const pa = this.pos.get(a)!, pb = this.pos.get(b)!;
    const w = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    if (!this.adj.has(a)) this.adj.set(a, []);
    if (!this.adj.has(b)) this.adj.set(b, []);
    this.adj.get(a)!.push({ to: b, w });
    this.adj.get(b)!.push({ to: a, w });
    this.segs.add({ ax: pa[0], az: pa[1], bx: pb[0], bz: pb[1], ref: { a, b }, i: 0 });
  }

  /** Adds a synthetic walkable polyline (e.g. the Boardwalk centreline) and connects nearby graph ends to it. */
  addPolyline(pts: V2[], connectRadius: number): void {
    const ids: number[] = [];
    for (const p of pts) {
      const id = this.nextSynthetic--;
      this.pos.set(id, p);
      ids.push(id);
    }
    // Connect existing nodes that are dead ends or near the line.
    const existing = [...this.pos.entries()].filter(([id]) => id > 0);
    for (let i = 1; i < ids.length; i++) this.link(ids[i - 1], ids[i]);
    for (const [id, p] of existing) {
      const deg = this.adj.get(id)?.length ?? 0;
      let best = -1, bestD = connectRadius;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && (deg <= 1 || bestD < 12)) this.link(id, ids[best]);
    }
  }

  /** Snap a free position onto the nearest graph edge. */
  private snap(x: number, z: number): { a: number; b: number; p: V2; t: number; d: number } | null {
    for (const r of [60, 200, 600]) {
      const n = this.segs.nearest(x, z, r);
      if (n) return { a: n.seg.ref.a, b: n.seg.ref.b, p: [n.x, n.z], t: n.t, d: n.dist };
    }
    return null;
  }

  /** A* shortest walking route between two world positions. */
  route(from: V2, to: V2): RouteResult | null {
    const s = this.snap(from[0], from[1]);
    const g = this.snap(to[0], to[1]);
    if (!s || !g) return null;
    const START = 1e15, GOAL = 1e15 + 1;
    const pos = (id: number): V2 => (id === START ? s.p : id === GOAL ? g.p : this.pos.get(id)!);
    const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const neighbours = (id: number): Edge[] => {
      if (id === START) {
        const out = [{ to: s.a, w: dist(s.p, pos(s.a)) }, { to: s.b, w: dist(s.p, pos(s.b)) }];
        if ((s.a === g.a && s.b === g.b) || (s.a === g.b && s.b === g.a)) out.push({ to: GOAL, w: dist(s.p, g.p) });
        return out;
      }
      const base = this.adj.get(id) ?? [];
      if (id === g.a || id === g.b) return [...base, { to: GOAL, w: dist(pos(id), g.p) }];
      return base;
    };
    const goalP = g.p;
    const open = new MinHeap();
    const gScore = new Map<number, number>([[START, 0]]);
    const came = new Map<number, number>();
    open.push(START, dist(s.p, goalP));
    const closed = new Set<number>();
    while (open.size) {
      const cur = open.pop()!;
      if (cur === GOAL) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const gc = gScore.get(cur)!;
      for (const e of neighbours(cur)) {
        const ng = gc + e.w;
        if (ng < (gScore.get(e.to) ?? Infinity)) {
          gScore.set(e.to, ng);
          came.set(e.to, cur);
          open.push(e.to, ng + dist(pos(e.to), goalP));
        }
      }
    }
    if (!gScore.has(GOAL)) return null;
    const path: V2[] = [];
    let c: number | undefined = GOAL;
    while (c !== undefined) {
      path.push(pos(c));
      c = came.get(c);
    }
    path.reverse();
    const pts: V2[] = [from, ...path, to];
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
    return { points: pts, length };
  }

  /** Nearest point on the network (used for route-line snapping). */
  nearestPoint(x: number, z: number): V2 | null {
    const n = this.segs.nearest(x, z, 200);
    return n ? [n.x, n.z] : null;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number | undefined {
    if (!this.ids.length) return undefined;
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export { closestOnSegment };
