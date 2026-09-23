/**
 * Terrain raster over the data rectangle.
 *
 * Built from real OSM polygons: coastline-derived water, beaches, wetlands,
 * parks. Heights are derived from distance to water so beaches slope gently
 * into the ocean. Wildwood is essentially flat (≈ 1–3 m above sea level), so
 * dry land is modelled at y = 0.
 */
import { DATA_RECT } from '../geo/coordinates';
import type { V2 } from '../math/polygon';

export const TerrainClass = {
  Land: 0,
  Water: 1,
  Beach: 2,
  Wetland: 3,
  Grass: 4,
  Scrub: 5,
} as const;
export type TerrainClass = (typeof TerrainClass)[keyof typeof TerrainClass];

export const SEA_LEVEL = -0.55;

export class Terrain {
  readonly res: number;
  readonly minX: number;
  readonly minZ: number;
  readonly nx: number;
  readonly nz: number;
  readonly cls: Uint8Array;
  readonly height: Float32Array;

  constructor(res = 4) {
    this.res = res;
    this.minX = Math.floor(DATA_RECT.minX) - 20;
    this.minZ = Math.floor(DATA_RECT.minZ) - 20;
    this.nx = Math.ceil((DATA_RECT.maxX + 20 - this.minX) / res) + 1;
    this.nz = Math.ceil((DATA_RECT.maxZ + 20 - this.minZ) / res) + 1;
    this.cls = new Uint8Array(this.nx * this.nz);
    this.height = new Float32Array(this.nx * this.nz);
  }

  /** Scanline-fills polygon rings (even-odd, so holes work) with a class value. */
  fill(rings: V2[][], value: number, onlyOver?: number[]): void {
    const { res, minX, minZ, nx, nz, cls } = this;
    let zMin = Infinity, zMax = -Infinity;
    for (const r of rings) for (const p of r) { zMin = Math.min(zMin, p[1]); zMax = Math.max(zMax, p[1]); }
    const j0 = Math.max(0, Math.floor((zMin - minZ) / res));
    const j1 = Math.min(nz - 1, Math.ceil((zMax - minZ) / res));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = minZ + j * res;
      xs.length = 0;
      for (const r of rings) {
        for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
          const a = r[k], b = r[i];
          if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - minX) / res));
        const i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - minX) / res));
        for (let i = i0; i <= i1; i++) {
          const idx = j * nx + i;
          if (onlyOver && !onlyOver.includes(cls[idx])) continue;
          cls[idx] = value;
        }
      }
    }
  }

  /** Two-pass chamfer distance (metres) to the nearest cell where `isTarget` holds. */
  private distanceTo(isTarget: (c: number) => boolean): Float32Array {
    const { nx, nz, cls, res } = this;
    const d = new Float32Array(nx * nz);
    const INF = 1e9;
    for (let i = 0; i < d.length; i++) d[i] = isTarget(cls[i]) ? 0 : INF;
    const a = res, b = res * Math.SQRT2;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, d[k - nx] + a);
          if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
          if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
        }
        d[k] = v;
      }
    }
    for (let j = nz - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        let v = d[k];
        if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
        if (j < nz - 1) {
          v = Math.min(v, d[k + nx] + a);
          if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
          if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
        }
        d[k] = v;
      }
    }
    return d;
  }

  computeHeights(): void {
    const toWater = this.distanceTo((c) => c === TerrainClass.Water);
    const toLand = this.distanceTo((c) => c !== TerrainClass.Water);
    const { cls, height } = this;
    for (let k = 0; k < cls.length; k++) {
      if (cls[k] === TerrainClass.Water) {
        height[k] = -0.9 - Math.min(toLand[k], 250) * 0.016;
      } else {
        const t = Math.min(toWater[k], 36) / 36;
        // smoothstep slope over the last 36 m before the water line
        height[k] = -0.9 + 0.9 * (t * t * (3 - 2 * t));
      }
    }
  }

  private idx(i: number, j: number): number {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return j * this.nx + i;
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.minX) / this.res, fz = (z - this.minZ) / this.res;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.height;
    const h00 = h[this.idx(i, j)], h10 = h[this.idx(i + 1, j)];
    const h01 = h[this.idx(i, j + 1)], h11 = h[this.idx(i + 1, j + 1)];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  classAt(x: number, z: number): TerrainClass {
    const i = Math.round((x - this.minX) / this.res), j = Math.round((z - this.minZ) / this.res);
    return this.cls[this.idx(i, j)] as TerrainClass;
  }
}
