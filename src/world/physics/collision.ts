/** Wall colliders (building footprints) for the first-person player. */
import type { Building } from '../data/types';
import { closestOnSegment, type V2 } from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';

export interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  bottom: number;
  top: number;
}

export class Colliders {
  private grid = new SpatialGrid<Wall>(20);
  count = 0;

  addRing(ring: readonly V2[], bottom: number, top: number): void {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      this.addWall({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom, top });
    }
  }

  addWall(w: Wall): void {
    this.grid.insert(w, {
      minX: Math.min(w.ax, w.bx), maxX: Math.max(w.ax, w.bx),
      minZ: Math.min(w.az, w.bz), maxZ: Math.max(w.az, w.bz),
    });
    this.count++;
  }

  addBuilding(b: Building): void {
    this.addRing(b.outer, b.baseY - 0.5, b.baseY + b.height);
  }

  /** Circle (radius r at height range [y0,y1]) vs walls: returns pushed-out position. */
  resolve(x: number, z: number, r: number, y0: number, y1: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const w of this.grid.query(x - r, z - r, x + r, z + r)) {
        if (y1 < w.bottom || y0 > w.top - 0.05) continue;
        const [cx, cz, , d2] = closestOnSegment(x, z, w.ax, w.az, w.bx, w.bz);
        if (d2 < r * r) {
          const d = Math.sqrt(d2);
          if (d < 1e-6) {
            // exactly on the wall: push along the wall normal
            const ex = w.bx - w.ax, ez = w.bz - w.az, l = Math.hypot(ex, ez) || 1;
            x += (-ez / l) * r;
            z += (ex / l) * r;
          } else {
            x = cx + ((x - cx) / d) * r;
            z = cz + ((z - cz) / d) * r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** True if segment from a to b crosses a wall at the given height. */
  blocked(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    for (const w of this.grid.query(minX, minZ, maxX, maxZ)) {
      if (y < w.bottom || y > w.top) continue;
      const d1 = (w.bx - w.ax) * (az - w.az) - (w.bz - w.az) * (ax - w.ax);
      const d2 = (w.bx - w.ax) * (bz - w.az) - (w.bz - w.az) * (bx - w.ax);
      const d3 = (bx - ax) * (w.az - az) - (bz - az) * (w.ax - ax);
      const d4 = (bx - ax) * (w.bz - az) - (bz - az) * (w.bx - ax);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
  }
}
