/**
 * Low-level geometry builders that append into growable typed buffers, so
 * whole chunks of the city can be merged into a handful of draw calls.
 */
import * as THREE from 'three';
import type { V2 } from '../math/polygon';

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  extra: number[] = [];
  idx: number[] = [];
  private withColor: boolean;
  private withExtra: boolean;
  constructor(opts: { color?: boolean; extra?: boolean } = {}) {
    this.withColor = !!opts.color;
    this.withExtra = !!opts.extra;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0, c?: THREE.Color, e = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    if (this.withColor) this.col.push(c?.r ?? 1, c?.g ?? 1, c?.b ?? 1);
    if (this.withExtra) this.extra.push(e);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad from 4 points (a,b,c,d in order), normal computed, front face = CCW. */
  quad(p: number[][], uvs: number[][], c?: THREE.Color, e = 0): void {
    const [a, b, , d] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i0 = this.vertex(p[0][0], p[0][1], p[0][2], nx, ny, nz, uvs[0][0], uvs[0][1], c, e);
    const i1 = this.vertex(p[1][0], p[1][1], p[1][2], nx, ny, nz, uvs[1][0], uvs[1][1], c, e);
    const i2 = this.vertex(p[2][0], p[2][1], p[2][2], nx, ny, nz, uvs[2][0], uvs[2][1], c, e);
    const i3 = this.vertex(p[3][0], p[3][1], p[3][2], nx, ny, nz, uvs[3][0], uvs[3][1], c, e);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /**
   * Flat horizontal polygon at height y (with optional holes), facing up.
   * UVs are world XZ / uvScale.
   */
  flatPolygon(outer: V2[], holes: V2[][] | undefined, y: number, uvScale = 1, c?: THREE.Color, e = 0): void {
    if (outer.length < 3) return;
    const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const hs = (holes ?? []).filter((h) => h.length >= 3).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    let faces: number[][];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, hs);
    } catch {
      return;
    }
    const all = [...contour, ...hs.flat()];
    const base = this.vertexCount;
    for (const p of all) this.vertex(p.x, y, p.y, 0, 1, 0, p.x / uvScale, -p.y / uvScale, c, e);
    for (const f of faces) {
      const a = all[f[0]], b = all[f[1]], cc = all[f[2]];
      const ny = (b.y - a.y) * (cc.x - a.x) - (b.x - a.x) * (cc.y - a.y);
      if (ny >= 0) this.idx.push(base + f[0], base + f[1], base + f[2]);
      else this.idx.push(base + f[0], base + f[2], base + f[1]);
    }
  }

  /**
   * Ribbon along a polyline (miter joins), lying at height y.
   * offset0/offset1: signed lateral offsets of the two edges (left negative).
   */
  ribbon(pts: V2[], offset0: number, offset1: number, y: number, vScale = 1, c?: THREE.Color, yFn?: (x: number, z: number) => number): void {
    if (pts.length < 2) return;
    const n = pts.length;
    const normals: V2[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      let l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      let nx = -dz, nz = dx;
      if (i > 0 && i < n - 1) {
        // miter
        const a = pts[i - 1], b = pts[i], c2 = pts[i + 1];
        let d1x = b[0] - a[0], d1z = b[1] - a[1];
        l = Math.hypot(d1x, d1z) || 1; d1x /= l; d1z /= l;
        const n1x = -d1z, n1z = d1x;
        let d2x = c2[0] - b[0], d2z = c2[1] - b[1];
        l = Math.hypot(d2x, d2z) || 1; d2x /= l; d2z /= l;
        const n2x = -d2z, n2z = d2x;
        let mx = n1x + n2x, mz = n1z + n2z;
        const ml = Math.hypot(mx, mz);
        if (ml > 1e-3) {
          mx /= ml; mz /= ml;
          const dot = mx * n1x + mz * n1z;
          const scale = 1 / Math.max(0.35, dot);
          nx = mx * scale; nz = mz * scale;
        }
      }
      normals.push([nx, nz]);
    }
    let dist = 0;
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [nx, nz] = normals[i];
      const x0 = pts[i][0] + nx * offset0, z0 = pts[i][1] + nz * offset0;
      const x1 = pts[i][0] + nx * offset1, z1 = pts[i][1] + nz * offset1;
      const y0 = yFn ? yFn(x0, z0) : y, y1 = yFn ? yFn(x1, z1) : y;
      this.vertex(x0, y0, z0, 0, 1, 0, 0, dist / vScale, c);
      this.vertex(x1, y1, z1, 0, 1, 0, 1, dist / vScale, c);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      // orientation check using first quad
      const ax = this.pos[a * 3], az = this.pos[a * 3 + 2];
      const bx = this.pos[b * 3], bz = this.pos[b * 3 + 2];
      const cx = this.pos[c2 * 3], cz = this.pos[c2 * 3 + 2];
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny >= 0) this.idx.push(a, b, c2, b, d, c2);
      else this.idx.push(a, c2, b, b, c2, d);
    }
  }

  /** Axis-aligned box (optionally rotated about Y by angle) centred at (x, y0..y1, z). */
  box(x: number, z: number, y0: number, y1: number, sx: number, sz: number, angle = 0, c?: THREE.Color): void {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const P = (lx: number, lz: number): [number, number] => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    const hx = sx / 2, hz = sz / 2;
    const corners = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
    // sides
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      this.quad([[a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], c);
    }
    // top
    this.quad(
      [[corners[0][0], y1, corners[0][1]], [corners[3][0], y1, corners[3][1]], [corners[2][0], y1, corners[2][1]], [corners[1][0], y1, corners[1][1]]],
      [[0, 0], [0, 1], [1, 1], [1, 0]], c,
    );
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withExtra) g.setAttribute('tile', new THREE.Float32BufferAttribute(this.extra, 1));
    const vc = this.pos.length / 3;
    g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
