/**
 * Building signage.
 * - Real business names from OSM POIs are put on the building that contains
 *   them (or the nearest one), on the facade facing the street.
 * - Motels get a Doo-Wop style pole sign with neon lettering (real name if
 *   OSM has one, otherwise a generic "MOTEL").
 * - Boardwalk shops without OSM data get generic category signs
 *   (PIZZA, ARCADE…) — generic labels, not invented business names.
 */
import * as THREE from 'three';
import type { Building, Poi } from '../data/types';
import { centroid, hash01, pointInRing, type V2 } from '../math/polygon';
import { SpatialGrid } from '../math/spatialGrid';
import { facadeFacing } from '../landmarks/landmarkUtils';
import type { WorldModel } from '../worldModel';

export interface Sign {
  x: number;
  y: number;
  z: number;
  /** yaw: plane +z faces this direction */
  yaw: number;
  w: number;
  h: number;
  text: string;
  kind: 'board' | 'neon' | 'pole';
  bg: string;
  fg: string;
}

const BOARDWALK_GENERIC = ['PIZZA', 'ARCADE', 'GIFTS', 'T-SHIRTS', 'FRIES', 'ICE CREAM', 'SALT WATER TAFFY', 'BURGERS', 'GAMES', 'SUBS', 'FUDGE', 'SOUVENIRS', 'LEMONADE', 'FUNNEL CAKE', 'HOT DOGS', 'SURF SHOP'];
const NEON = ['#ff4fa3', '#4fe3ff', '#ffe14f', '#7dff6a', '#ff7a3d', '#c77dff'];
const BOARD_BG = ['#b3261e', '#1b4f72', '#1e7d4b', '#6a1b9a', '#e0a100', '#263238', '#00838f'];

const SIGN_POI = new Set(['restaurant', 'cheap_food', 'shop', 'supermarket', 'convenience', 'pharmacy', 'laundromat', 'bank', 'lodging', 'attraction', 'venue']);

export function computeSigns(world: WorldModel): Sign[] {
  const signs: Sign[] = [];
  const grid = new SpatialGrid<Building>(40);
  for (const b of world.buildings) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of b.outer) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    grid.insert(b, { minX, minZ, maxX, maxZ });
  }
  const named = new Map<Building, Poi>();
  for (const p of world.data.pois) {
    if (!p.name || !SIGN_POI.has(p.cat)) continue;
    let host: Building | null = null;
    let best = 14;
    for (const b of grid.query(p.x - 14, p.z - 14, p.x + 14, p.z + 14)) {
      if (b.landmarkId) continue;
      if (pointInRing(p.x, p.z, b.outer)) { host = b; break; }
      const c = centroid(b.outer);
      const d = Math.hypot(c[0] - p.x, c[1] - p.z);
      if (d < best) { best = d; host = b; }
    }
    if (host && !named.has(host)) named.set(host, p);
  }

  const streetFacade = (b: Building) => {
    const c = centroid(b.outer);
    const n = world.roadIndex.nearest(c[0], c[1], 60, (s) => s.ref.drivable || s.ref.kind === 'pedestrian');
    let target: V2 = n ? [n.x, n.z] : c;
    if (b.style === 'boardwalk_shop' || world.distToBoardwalk(c[0], c[1]) < 25) {
      const e = world.boardwalkEdges.nearest(c[0], c[1], 60);
      if (e) target = [e.x, e.z];
    }
    return facadeFacing(b.outer, target);
  };

  for (const b of world.buildings) {
    if (b.landmarkId) continue;
    const poi = named.get(b);
    const r = hash01(b.seed + 91);
    const isMotel = b.style === 'motel' || poi?.cat === 'lodging';
    const isShop = b.style === 'shop' || b.style === 'restaurant' || b.style === 'boardwalk_shop' || b.style === 'commercial';
    if (!poi && !isMotel && !(b.style === 'boardwalk_shop') && !(isShop && r < 0.35)) continue;
    const f = streetFacade(b);
    if (!f || f.len < 4) continue;
    const text = poi?.name?.toUpperCase()
      ?? (isMotel ? 'MOTEL' : b.style === 'boardwalk_shop' ? BOARDWALK_GENERIC[Math.floor(r * BOARDWALK_GENERIC.length)] : b.style === 'restaurant' ? (r < 0.5 ? 'GRILL' : 'DINER') : r < 0.12 ? 'LIQUORS' : r < 0.24 ? 'DELI' : 'SHOP');
    if (isMotel) {
      // pole sign at the street side of the lot
      const px = f.mid[0] + f.n[0] * 4 + f.d[0] * (f.len / 2 - 1.5);
      const pz = f.mid[1] + f.n[1] * 4 + f.d[1] * (f.len / 2 - 1.5);
      const col = NEON[Math.floor(r * NEON.length)];
      signs.push({ x: px, y: world.groundAt(px, pz) + 6.2, z: pz, yaw: Math.atan2(f.d[0], f.d[1]), w: 3.6, h: 1.6, text, kind: 'pole', bg: '#101820', fg: col });
      // name along the upper facade too
      const y = b.baseY + Math.min(b.height - 0.6, 5.5);
      signs.push({ x: f.mid[0] + f.n[0] * 0.12, y, z: f.mid[1] + f.n[1] * 0.12, yaw: f.yaw, w: Math.min(f.len * 0.6, 12), h: 1.1, text, kind: 'neon', bg: '#ffffff00', fg: col });
    } else {
      const w = Math.min(f.len * 0.8, Math.max(3, text.length * 0.55));
      const y = b.baseY + Math.min(b.height - 0.7, b.style === 'boardwalk_shop' ? 3.4 : 3.9);
      const bg = BOARD_BG[Math.floor(r * BOARD_BG.length)];
      signs.push({ x: f.mid[0] + f.n[0] * 0.14, y, z: f.mid[1] + f.n[1] * 0.14, yaw: f.yaw, w, h: 0.95, text, kind: b.style === 'boardwalk_shop' ? 'neon' : 'board', bg, fg: '#ffffff' });
    }
  }
  return signs;
}

/** Texture atlas of all sign texts (one slot per unique text/style). */
export class SignAtlas {
  readonly texture: THREE.CanvasTexture;
  private slots = new Map<string, [number, number, number, number]>();
  private static COLS = 8;
  private static SW = 256;
  private static SH = 64;

  constructor(signs: Sign[]) {
    const keys = [...new Set(signs.map((s) => SignAtlas.key(s)))];
    const rows = Math.ceil(keys.length / SignAtlas.COLS);
    const W = SignAtlas.COLS * SignAtlas.SW, H = Math.max(64, Math.min(4096, rows * SignAtlas.SH));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const bySlot = new Map<string, Sign>();
    for (const s of signs) bySlot.set(SignAtlas.key(s), s);
    keys.forEach((k, i) => {
      const s = bySlot.get(k)!;
      const col = i % SignAtlas.COLS, row = Math.floor(i / SignAtlas.COLS);
      const x = col * SignAtlas.SW, y = row * SignAtlas.SH;
      if (y + SignAtlas.SH > H) return;
      const neon = s.kind !== 'board';
      if (s.bg.length <= 7) {
        ctx.fillStyle = s.bg;
        ctx.fillRect(x, y, SignAtlas.SW, SignAtlas.SH);
      }
      if (!neon) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, SignAtlas.SW - 6, SignAtlas.SH - 6);
      }
      let size = 40;
      const font = neon ? '"Brush Script MT", "Segoe Script", cursive' : 'Arial Black, Arial, sans-serif';
      ctx.font = `bold ${size}px ${font}`;
      while (ctx.measureText(s.text).width > SignAtlas.SW - 16 && size > 11) {
        size -= 1;
        ctx.font = `bold ${size}px ${font}`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (neon) {
        ctx.shadowColor = s.fg;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = s.fg;
      ctx.fillText(s.text, x + SignAtlas.SW / 2, y + SignAtlas.SH / 2 + 2);
      ctx.shadowBlur = 0;
      this.slots.set(k, [x / W, 1 - (y + SignAtlas.SH) / H, (x + SignAtlas.SW) / W, 1 - y / H]);
    });
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  static key(s: Sign): string {
    return `${s.kind}|${s.bg}|${s.fg}|${s.text}`;
  }

  uv(s: Sign): [number, number, number, number] | undefined {
    return this.slots.get(SignAtlas.key(s));
  }
}
