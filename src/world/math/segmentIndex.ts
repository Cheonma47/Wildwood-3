/** Spatial index of 2D line segments supporting nearest-segment queries. */
import { SpatialGrid } from './spatialGrid';
import { closestOnSegment, type V2 } from './polygon';

export interface Seg<T> {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ref: T;
  /** Index of the segment within its source polyline. */
  i: number;
}

export interface NearestSeg<T> {
  seg: Seg<T>;
  dist: number;
  x: number;
  z: number;
  t: number;
}

export class SegmentIndex<T> {
  private grid: SpatialGrid<Seg<T>>;
  constructor(cellSize = 40) {
    this.grid = new SpatialGrid(cellSize);
  }

  addPolyline(pts: readonly V2[], ref: T, closed = false): void {
    const n = pts.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.add({ ax: a[0], az: a[1], bx: b[0], bz: b[1], ref, i });
    }
  }

  add(s: Seg<T>): void {
    this.grid.insert(s, {
      minX: Math.min(s.ax, s.bx), maxX: Math.max(s.ax, s.bx),
      minZ: Math.min(s.az, s.bz), maxZ: Math.max(s.az, s.bz),
    });
  }

  query(x: number, z: number, r: number): Seg<T>[] {
    return this.grid.query(x - r, z - r, x + r, z + r);
  }

  nearest(x: number, z: number, maxR: number, filter?: (s: Seg<T>) => boolean): NearestSeg<T> | null {
    let best: NearestSeg<T> | null = null;
    let bestD = maxR * maxR;
    for (const s of this.query(x, z, maxR)) {
      if (filter && !filter(s)) continue;
      const [cx, cz, t, d2] = closestOnSegment(x, z, s.ax, s.az, s.bx, s.bz);
      if (d2 <= bestD) {
        bestD = d2;
        best = { seg: s, dist: Math.sqrt(d2), x: cx, z: cz, t };
      }
    }
    return best;
  }
}
