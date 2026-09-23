/** Uniform grid spatial index for items with bounding boxes (world XZ). */
import type { BBox } from './polygon';

export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  insert(item: T, b: BBox): void {
    const s = this.cellSize;
    const x0 = Math.floor(b.minX / s), x1 = Math.floor(b.maxX / s);
    const z0 = Math.floor(b.minZ / s), z1 = Math.floor(b.maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
    }
  }

  /** Items whose cells overlap the query box (may contain duplicates across cells → de-duplicated). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[] = []): T[] {
    const s = this.cellSize;
    const x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s);
    const single = x0 === x1 && z0 === z1;
    const seen = single ? null : new Set<T>();
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const c = this.cells.get(this.key(ix, iz));
        if (!c) continue;
        for (const it of c) {
          if (seen) {
            if (seen.has(it)) continue;
            seen.add(it);
          }
          out.push(it);
        }
      }
    }
    return out;
  }

  queryPoint(x: number, z: number): T[] {
    const c = this.cells.get(this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize)));
    return c ?? [];
  }
}
