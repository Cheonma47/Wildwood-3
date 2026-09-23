/**
 * 2D map renderer (Canvas 2D) drawn directly from the projected OSM data.
 * Used by both the full-screen map (M) and the HUD minimap.
 * Screen x = world x (east), screen y = world z (south) → north is up.
 */
import { LANDMARKS } from '../../data/wildwood/landmarks';
import type { Poi } from '../../world/data/types';
import { latLonToWorld } from '../../world/geo/projection';
import { shortStreetName } from '../../world/roads/roadStyle';
import type { V2 } from '../../world/math/polygon';
import type { WorldModel } from '../../world/worldModel';
import { WAT_CATEGORIES, type WatCategory } from '../../store/gameStore';

export interface MapView {
  cx: number; // world x at canvas centre
  cz: number;
  scale: number; // pixels per metre
}

export interface Marker {
  id: string;
  name: string;
  x: number;
  z: number;
  color: string;
  size: number;
  kind: 'landmark' | 'poi' | 'housing' | 'destination' | 'pin';
  lat: number;
  lon: number;
}

function ringPath(p: Path2D, ring: V2[]) {
  if (ring.length < 2) return;
  p.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) p.lineTo(ring[i][0], ring[i][1]);
  p.closePath();
}

const POI_TO_WAT: Record<string, WatCategory | undefined> = {
  supermarket: 'supermarket', convenience: 'convenience', pharmacy: 'pharmacy', laundromat: 'laundromat',
  bus: 'bus', bank: 'bank', cheap_food: 'cheap_food',
};

export class MapRenderer {
  private layers: {
    water: Path2D; beach: Path2D; park: Path2D; wetland: Path2D; parking: Path2D; deck: Path2D;
    bOsm: Path2D; bProc: Path2D; roadsMajor: Path2D; roadsMinor: Path2D; roadsService: Path2D; paths: Path2D;
  };
  private labels: { name: string; x: number; z: number; angle: number; major: boolean }[] = [];
  readonly world: WorldModel;
  readonly pois: Poi[];

  constructor(world: WorldModel) {
    this.world = world;
    const L = {
      water: new Path2D(), beach: new Path2D(), park: new Path2D(), wetland: new Path2D(), parking: new Path2D(), deck: new Path2D(),
      bOsm: new Path2D(), bProc: new Path2D(), roadsMajor: new Path2D(), roadsMinor: new Path2D(), roadsService: new Path2D(), paths: new Path2D(),
    };
    for (const w of world.data.water) ringPath(L.water, w);
    for (const a of world.data.areas) {
      const target = a.kind === 'beach' ? L.beach : a.kind === 'water' || a.kind === 'pool' ? L.water : a.kind === 'park' || a.kind === 'pitch' ? L.park
        : a.kind === 'wetland' || a.kind === 'scrub' ? L.wetland : a.kind === 'parking' ? L.parking : null;
      if (target) ringPath(target, a.outer);
    }
    for (const d of world.decks) ringPath(L.deck, d.outer);
    for (const b of world.buildings) ringPath(b.source === 'osm' ? L.bOsm : L.bProc, b.outer);
    for (const r of world.data.roads) {
      const target = ['primary', 'secondary', 'tertiary'].includes(r.kind) ? L.roadsMajor
        : r.kind === 'service' ? L.roadsService : r.drivable ? L.roadsMinor : L.paths;
      target.moveTo(r.pts[0][0], r.pts[0][1]);
      for (let i = 1; i < r.pts.length; i++) target.lineTo(r.pts[i][0], r.pts[i][1]);
    }
    this.layers = L;
    // street labels: one per street name per ~350 m
    const placed: { name: string; x: number; z: number }[] = [];
    const roads = [...world.data.roads].filter((r) => r.name && r.drivable && r.kind !== 'service');
    roads.sort((a, b) => b.width - a.width);
    for (const r of roads) {
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 60) continue;
        const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
        if (placed.some((p) => p.name === r.name && Math.hypot(p.x - x, p.z - z) < 350)) continue;
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        const name = shortStreetName(r.name);
        placed.push({ name: r.name, x, z });
        this.labels.push({ name, x, z, angle, major: ['primary', 'secondary', 'tertiary'].includes(r.kind) });
      }
    }
    this.pois = world.data.pois;
  }

  toScreen(v: MapView, w: number, h: number, x: number, z: number): [number, number] {
    return [(x - v.cx) * v.scale + w / 2, (z - v.cz) * v.scale + h / 2];
  }

  toWorld(v: MapView, w: number, h: number, sx: number, sy: number): [number, number] {
    return [(sx - w / 2) / v.scale + v.cx, (sy - h / 2) / v.scale + v.cz];
  }

  markers(opts: { wat: boolean; cats: WatCategory[]; housing: { lat: number; lon: number; label: string } | null; destination: { name: string; x: number; z: number; lat: number; lon: number } | null; minPriority: number }): Marker[] {
    const out: Marker[] = [];
    for (const l of LANDMARKS) {
      if (l.priority > opts.minPriority && !(opts.wat && l.category === 'workplace')) continue;
      const p = latLonToWorld(l.latitude, l.longitude);
      const color = l.category === 'workplace' ? '#ff3d71' : l.category === 'food' ? '#ffb300' : l.category === 'amusement' ? '#e040fb' : l.category === 'beach' ? '#eab308' : l.category === 'boardwalk' ? '#a0522d' : '#29b6f6';
      out.push({ id: l.id, name: l.name, x: p.x, z: p.z, color, size: l.priority === 1 ? 9 : 7, kind: 'landmark', lat: l.latitude, lon: l.longitude });
    }
    if (opts.wat) {
      for (const p of this.pois) {
        const cat = POI_TO_WAT[p.cat];
        if (!cat || !opts.cats.includes(cat)) continue;
        const c = WAT_CATEGORIES.find((x) => x.id === cat)!;
        out.push({ id: `poi-${p.id}`, name: p.name || c.label, x: p.x, z: p.z, color: c.color, size: 5.5, kind: 'poi', lat: p.lat, lon: p.lon });
      }
    }
    if (opts.housing && (!opts.wat || opts.cats.includes('housing'))) {
      const p = latLonToWorld(opts.housing.lat, opts.housing.lon);
      out.push({ id: 'housing', name: opts.housing.label, x: p.x, z: p.z, color: '#00c48c', size: 9, kind: 'housing', lat: opts.housing.lat, lon: opts.housing.lon });
    }
    if (opts.destination) {
      out.push({ id: 'destination', name: opts.destination.name, x: opts.destination.x, z: opts.destination.z, color: '#00e5ff', size: 7, kind: 'destination', lat: opts.destination.lat, lon: opts.destination.lon });
    }
    return out;
  }

  draw(ctx: CanvasRenderingContext2D, v: MapView, w: number, h: number, extras: {
    player?: { x: number; z: number; heading: number };
    route?: V2[] | null;
    markers?: Marker[];
    selected?: string | null;
    measure?: V2[];
    labels?: boolean;
    watBoardwalkBeach?: boolean;
    dpr?: number;
  } = {}): void {
    const dpr = extras.dpr ?? 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eceadf';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, (w / 2 - v.cx * v.scale) * dpr, (h / 2 - v.cz * v.scale) * dpr);
    const L = this.layers;
    const px = 1 / v.scale; // one screen pixel in metres
    ctx.fillStyle = '#d7e3c3'; ctx.fill(L.wetland);
    ctx.fillStyle = '#bfe0a8'; ctx.fill(L.park);
    ctx.fillStyle = '#f5e5b8'; ctx.fill(L.beach);
    ctx.fillStyle = '#9cc9ee'; ctx.fill(L.water, 'evenodd');
    ctx.fillStyle = '#d5d5d5'; ctx.fill(L.parking);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(4, 2.5 * px); ctx.stroke(L.roadsService);
    ctx.lineWidth = Math.max(9, 2.5 * px); ctx.stroke(L.roadsMinor);
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = Math.max(12, 3.5 * px); ctx.stroke(L.roadsMajor);
    if (v.scale > 0.6) {
      ctx.strokeStyle = '#c8b8a8';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = Math.max(1.5, 1 * px); ctx.stroke(L.paths);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = extras.watBoardwalkBeach ? '#c0703a' : '#b98657';
    ctx.fill(L.deck);
    ctx.fillStyle = '#cdbfae'; ctx.fill(L.bProc);
    ctx.fillStyle = '#b3a38f'; ctx.fill(L.bOsm);

    // route
    if (extras.route && extras.route.length > 1) {
      ctx.strokeStyle = '#00b8d4';
      ctx.lineWidth = Math.max(4 * px, 3);
      ctx.beginPath();
      ctx.moveTo(extras.route[0][0], extras.route[0][1]);
      for (const p of extras.route) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    // measurement line
    if (extras.measure && extras.measure.length) {
      ctx.strokeStyle = '#d50000';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([8 * px, 5 * px]);
      ctx.beginPath();
      ctx.moveTo(extras.measure[0][0], extras.measure[0][1]);
      for (const p of extras.measure) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (extras.labels !== false && v.scale > 0.22) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const lb of this.labels) {
        if (!lb.major && v.scale < 0.45) continue;
        const [sx, sy] = this.toScreen(v, w, h, lb.x, lb.z);
        if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(lb.angle);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(lb.name, 0, 0);
        ctx.fillStyle = '#4a4036';
        ctx.fillText(lb.name, 0, 0);
        ctx.restore();
      }
    }
    for (const p of extras.measure ?? []) {
      const [sx, sy] = this.toScreen(v, w, h, p[0], p[1]);
      ctx.fillStyle = '#d50000';
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const m of extras.markers ?? []) {
      const [sx, sy] = this.toScreen(v, w, h, m.x, m.z);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const sel = extras.selected === m.id;
      ctx.beginPath();
      ctx.arc(sx, sy, m.size + (sel ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = sel ? 3 : 2;
      ctx.strokeStyle = sel ? '#111' : '#fff';
      ctx.stroke();
      if (m.kind !== 'poi' || v.scale > 0.9 || sel) {
        ctx.font = `${m.kind === 'landmark' ? 700 : 600} 12px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeText(m.name, sx + m.size + 4, sy);
        ctx.fillStyle = '#1b1b1b';
        ctx.fillText(m.name, sx + m.size + 4, sy);
      }
    }
    if (extras.player) {
      const [sx, sy] = this.toScreen(v, w, h, extras.player.x, extras.player.z);
      const a = (extras.player.heading * Math.PI) / 180;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(8, 9);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fillStyle = '#1565c0';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}
