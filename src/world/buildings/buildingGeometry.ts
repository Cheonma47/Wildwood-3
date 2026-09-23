/** Merged building meshes (walls with facade atlas + roofs) for one chunk. */
import * as THREE from 'three';
import type { Building, BuildingStyle } from '../data/types';
import { GeoBuilder } from '../render/geometry';
import { hash01, pointInRing, polygonArea, type V2 } from '../math/polygon';

const PALETTES: Record<BuildingStyle, string[]> = {
  house: ['#f4f1ea', '#e9e2d0', '#c9d8e4', '#d8d4c8', '#f1e3b5', '#bcc9c0', '#e4d0c0', '#9fb8c8', '#ffffff'],
  motel: ['#7fd1d8', '#f6a6c1', '#fbe38a', '#ffffff', '#9fd6a9', '#f9c28b', '#b7c9f2', '#f5f0e0'],
  apartment: ['#e8e1d3', '#d3c7b4', '#f0ece2', '#c7d1d9', '#e7d7c1', '#ffffff'],
  commercial: ['#d9cfbf', '#b85b4b', '#e6e0d4', '#c8b79d', '#9ea7ae', '#ffffff'],
  shop: ['#f0e6d2', '#c05a4a', '#6aa6b8', '#f3d27a', '#ffffff', '#88b27a'],
  restaurant: ['#c9513f', '#f2e8d6', '#3f6f8f', '#f0c66b', '#ffffff'],
  boardwalk_shop: ['#ff6f61', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ffffff', '#f8961e', '#90be6d'],
  civic: ['#d8d2c4', '#bfb6a5', '#e8e4da'],
  garage: ['#bdb8ad', '#9a958b'],
  industrial: ['#a9a9a4'],
};

const ROOF_COLORS = ['#5b5d61', '#6e6258', '#4c5563', '#7a7f85', '#8a5a44', '#3f4a3c'];
const FLAT_ROOF = ['#8d8f91', '#a3a19c', '#77797b', '#b4b1aa'];

const TILE: Record<BuildingStyle, number> = {
  house: 0, motel: 1, apartment: 0, commercial: 2, civic: 2, industrial: 2, garage: 2,
  shop: 3, restaurant: 3, boardwalk_shop: 3,
};

export function buildingColor(b: Building): THREE.Color {
  const p = PALETTES[b.style] ?? PALETTES.commercial;
  return new THREE.Color(p[Math.floor(hash01(b.seed + 17) * p.length)]);
}

/** Ensure the left-hand normal of each edge points outward. */
function outwardRing(ring: V2[]): V2[] {
  const a = ring[0], b = ring[1];
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const l = Math.hypot(ex, ez) || 1;
  const nx = ez / l, nz = -ex / l; // left normal (see geometry.ts)
  const mx = (a[0] + b[0]) / 2 + nx * 0.05, mz = (a[1] + b[1]) / 2 + nz * 0.05;
  return pointInRing(mx, mz, ring) ? [...ring].reverse() : ring;
}

const FLOOR = 3.1;
const BAY = 3.4;

export function buildBuildingsChunk(buildings: Building[]): { walls: THREE.BufferGeometry | null; roofs: THREE.BufferGeometry | null } {
  const walls = new GeoBuilder({ color: true, extra: true });
  const roofs = new GeoBuilder({ color: true });

  for (const b of buildings) {
    if (b.landmarkId) continue; // custom landmark renderer
    const color = buildingColor(b);
    const ring = outwardRing(b.outer);
    const y0 = b.baseY - 0.3, y1 = b.baseY + b.height;
    const groundBand = (b.style === 'shop' || b.style === 'restaurant' || b.style === 'boardwalk_shop') ? Math.min(3.8, b.height) : 0;
    const tile = TILE[b.style] ?? 2;
    const upperTile = groundBand ? 2 : tile;
    const floorsTop = (y1 - b.baseY - groundBand) / FLOOR;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.05) continue;
      const bays = Math.max(1, Math.round(len / BAY));
      if (groundBand) {
        walls.quad(
          [[p[0], y0, p[1]], [p[0], b.baseY + groundBand, p[1]], [q[0], b.baseY + groundBand, q[1]], [q[0], y0, q[1]]],
          [[0, 0], [0, 1], [bays, 1], [bays, 0]], color, 3,
        );
        if (b.height > groundBand + 0.3) {
          walls.quad(
            [[p[0], b.baseY + groundBand, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], b.baseY + groundBand, q[1]]],
            [[0, 0], [0, floorsTop], [bays, floorsTop], [bays, 0]], color, upperTile,
          );
        }
      } else {
        const floors = (y1 - b.baseY) / FLOOR;
        walls.quad(
          [[p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], [q[0], y0, q[1]]],
          [[0, -0.3 / FLOOR], [0, floors], [bays, floors], [bays, -0.3 / FLOOR]], color, b.style === 'garage' ? 2 : tile,
        );
      }
    }

    // Roofs: houses get a gable roof over their oriented bounding rectangle
    const isHouse = b.style === 'house' || (b.source === 'osm' && b.type === 'house');
    let gable: V2[] | null = null;
    if (isHouse && ring.length <= 12) {
      const obb = minAreaRect(ring);
      if (obb && polygonArea(ring) / polygonArea(obb) > 0.72) gable = outwardRing(obb);
    }
    const roofColor = new THREE.Color(ROOF_COLORS[Math.floor(hash01(b.seed) * ROOF_COLORS.length)]);
    if (gable) {
      const long01 = Math.hypot(gable[1][0] - gable[0][0], gable[1][1] - gable[0][1]) >= Math.hypot(gable[2][0] - gable[1][0], gable[2][1] - gable[1][1]);
      gableRoof(walls, roofs, gable, y1, color, roofColor, long01);
    } else {
      const rc = new THREE.Color(FLAT_ROOF[Math.floor(hash01(b.seed) * FLAT_ROOF.length)]);
      roofs.flatPolygon(ring, b.holes, y1, 4, rc);
      // parapet cap
      if (b.style !== 'house') {
        const cap = color.clone().multiplyScalar(0.85);
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          roofs.quad([[p[0], y1, p[1]], [p[0], y1 + 0.5, p[1]], [q[0], y1 + 0.5, q[1]], [q[0], y1, q[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], cap);
        }
      }
    }
    if (b.front && b.front.len > 3) streetDetails(walls, b, color, roofColor);
  }
  return { walls: walls.build(), roofs: roofs.build() };
}

/** Solid-colour UV spot in the facade atlas (white wall area of tile 2). */
const SOLID: [number, number] = [0.03, 0.05];
const DOOR = new THREE.Color('#5b3a29');
const PORCH_FLOOR = new THREE.Color('#b9ab94');
const TRIM = new THREE.Color('#f5f3ee');
const AWNINGS = ['#b3261e', '#1e6f4f', '#1f4e8c', '#e0a100', '#6a1b9a', '#d35400', '#00796b'];

/** Doors, porches, stairs and shop awnings on the street-facing facade. */
function streetDetails(g: GeoBuilder, b: Building, wall: THREE.Color, roofColor: THREE.Color) {
  const f = b.front!;
  const e: V2 = [-f.n[1], f.n[0]]; // along the facade, oriented so quads face outward
  const ang = Math.atan2(e[1], e[0]);
  const at = (u: number, out: number): V2 => [f.mid[0] + e[0] * u + f.n[0] * out, f.mid[1] + e[1] * u + f.n[1] * out];
  const y = b.baseY;
  const r = hash01(b.seed + 5);
  const flatQuad = (u0: number, u1: number, y0: number, y1: number, out: number, c: THREE.Color) => {
    const A = at(u0, out), B = at(u1, out);
    g.quad([[A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], [B[0], y0, B[1]]], [SOLID, SOLID, SOLID, SOLID], c, 2);
  };
  if (b.style === 'house') {
    const du = (r - 0.5) * Math.max(0, f.len - 4) * 0.6;
    const raised = r < 0.45 ? 0.9 : 0.45; // many shore houses sit a few steps up
    flatQuad(du - 0.5, du + 0.5, y + raised, y + raised + 2.1, 0.05, DOOR);
    flatQuad(du - 0.62, du + 0.62, y + raised + 2.1, y + raised + 2.25, 0.06, TRIM);
    if (f.len > 6.5 && f.len < 16) {
      // front porch: deck, two posts, roof slab, steps
      const pw = Math.min(f.len * 0.65, 8);
      const c = at(du, 1.1);
      g.box(c[0], c[1], y, y + raised, pw, 2.2, ang, PORCH_FLOOR, SOLID, 2);
      for (const s of [-1, 1]) {
        const p = at(du + s * (pw / 2 - 0.15), 2.05);
        g.box(p[0], p[1], y + raised, y + raised + 2.5, 0.16, 0.16, ang, TRIM, SOLID, 2);
      }
      g.box(c[0], c[1], y + raised + 2.5, y + raised + 2.62, pw + 0.3, 2.4, ang, TRIM, SOLID, 2);
      const st = at(du, 2.6);
      g.box(st[0], st[1], y, y + raised * 0.5, 1.3, 0.9, ang, PORCH_FLOOR, SOLID, 2);
    } else {
      const st = at(du, 0.5);
      g.box(st[0], st[1], y, y + raised, 1.3, 1.0, ang, PORCH_FLOOR, SOLID, 2);
    }
  } else if (b.style === 'shop' || b.style === 'restaurant' || b.style === 'boardwalk_shop') {
    // entrance door + slanted awning over the shopfront
    flatQuad(-0.55, 0.55, y, y + 2.3, 0.05, new THREE.Color('#2b2b2b'));
    const w = Math.min(f.len * 0.85, 14) / 2;
    const col = new THREE.Color(AWNINGS[Math.floor(r * AWNINGS.length)]);
    const A0 = at(-w, 0.02), B0 = at(w, 0.02), A1 = at(-w, 1.5), B1 = at(w, 1.5);
    const top = y + Math.min(b.height - 0.3, 3.5), low = top - 0.7;
    g.quad([[A0[0], top, A0[1]], [A1[0], low, A1[1]], [B1[0], low, B1[1]], [B0[0], top, B0[1]]], [SOLID, SOLID, SOLID, SOLID], col, 2);
    g.quad([[B0[0], top, B0[1]], [B1[0], low, B1[1]], [A1[0], low, A1[1]], [A0[0], top, A0[1]]], [SOLID, SOLID, SOLID, SOLID], col.clone().multiplyScalar(0.7), 2);
    flatQuad(-w, w, low - 0.25, low, 1.5, col);
  } else if (b.style === 'motel' || b.style === 'apartment') {
    flatQuad(-0.6, 0.6, y, y + 2.2, 0.05, DOOR);
  }
  void wall;
  void roofColor;
}

/** Minimum-area oriented bounding rectangle of a polygon (rotating edges). */
function minAreaRect(ring: V2[]): V2[] | null {
  let best: V2[] | null = null, bestA = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 0.5) continue;
    const ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of ring) {
      const a = v[0] * ux + v[1] * uz, bb = -v[0] * uz + v[1] * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, bb); b1 = Math.max(b1, bb);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestA) {
      bestA = area;
      const P = (a: number, bb: number): V2 => [a * ux - bb * uz, a * uz + bb * ux];
      best = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
    }
  }
  return best;
}

function gableRoof(walls: GeoBuilder, roofs: GeoBuilder, ring: V2[], y: number, wallColor: THREE.Color, roofColor: THREE.Color, alongFirst: boolean) {
  // ring has 4 corners; choose ridge along edge 0→1 (or 1→2)
  const r = alongFirst ? ring : [ring[1], ring[2], ring[3], ring[0]];
  const [a, b, c, d] = r; // a→b and d→c are the long sides (eaves), b→c, d→a gables
  const w = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const rise = Math.min(4, w * 0.35);
  const m1: V2 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
  const m2: V2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const yr = y + rise;
  const o = 0.4; // overhang
  const ov = (p: V2, m: V2): V2 => {
    const dx = p[0] - m[0], dz = p[1] - m[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] + (dx / l) * o, p[1] + (dz / l) * o];
  };
  const A = ov(a, m1), B = ov(b, m2), C = ov(c, m2), D = ov(d, m1);
  const ylow = y - o * (rise / (w / 2));
  // slope 1 (a-b side)
  roofs.quad([[A[0], ylow, A[1]], [m1[0], yr, m1[1]], [m2[0], yr, m2[1]], [B[0], ylow, B[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], roofColor);
  // slope 2 (c-d side)
  roofs.quad([[C[0], ylow, C[1]], [m2[0], yr, m2[1]], [m1[0], yr, m1[1]], [D[0], ylow, D[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], roofColor);
  // gable triangles (wall colour)
  const tri = (p: V2, q: V2, m: V2) => {
    const n = walls.vertexCount;
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const l = Math.hypot(ex, ez) || 1;
    const nx = ez / l, nz = -ex / l;
    walls.vertex(p[0], y, p[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.vertex(m[0], yr, m[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.vertex(q[0], y, q[1], nx, 0, nz, 0.5, 0.95, wallColor, 2);
    walls.tri(n, n + 1, n + 2);
  };
  tri(b, c, m2);
  tri(d, a, m1);
  // make the roof visible from below too (cheap: duplicate reversed)
  void 0;
}
