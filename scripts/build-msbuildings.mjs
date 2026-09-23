// Extracts Microsoft Global ML Building Footprints (ODbL) for the Wildwood
// study area and removes any that duplicate an OSM building.
// Input:  data/msbuildings/q.csv.gz  (quadkey 032010123, UnitedStates)
// Output: public/data/wildwood/msbuildings.json  [{ h, pts:[lat,lon,...] }]
//
// Download: see README ("Updating the map data").
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FETCH_BOUNDS as B } from './bounds.mjs';

const osm = JSON.parse(readFileSync('public/data/wildwood/buildings.json', 'utf8'));
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const inside = (lat, lon) => lat >= B.south && lat <= B.north && lon >= B.west && lon <= B.east;

function pip(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// OSM rings as [lon,lat] with bbox grid for dedupe
const osmRings = osm.map((b) => {
  const r = [];
  for (let i = 0; i < b.pts.length; i += 2) r.push([b.pts[i + 1], b.pts[i]]);
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  return { r, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
});
const CELL = 0.002;
const grid = new Map();
for (const o of osmRings) {
  for (let x = Math.floor(o.minX / CELL); x <= Math.floor(o.maxX / CELL); x++)
    for (let y = Math.floor(o.minY / CELL); y <= Math.floor(o.maxY / CELL); y++) {
      const k = x + ',' + y;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
}
function overlapsOsm(ring) {
  // sample centroid + vertices; duplicate if centroid or ≥ half the vertices fall in an OSM building
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cands = grid.get(Math.floor(cx / CELL) + ',' + Math.floor(cy / CELL)) ?? [];
  for (const o of cands) {
    if (pip(cx, cy, o.r)) return true;
    let n = 0;
    for (const p of ring) if (pip(p[0], p[1], o.r)) n++;
    if (n >= ring.length / 2) return true;
    let m = 0;
    for (const p of o.r) if (pip(p[0], p[1], ring)) m++;
    if (m >= o.r.length / 2) return true;
  }
  return false;
}

const lines = gunzipSync(readFileSync('data/msbuildings/q.csv.gz')).toString('utf8').split('\n');
const out = [];
let seen = 0, dup = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const f = JSON.parse(line);
  if (f.geometry.type !== 'Polygon') continue;
  const ring = f.geometry.coordinates[0];
  const [lon, lat] = ring[0];
  if (!inside(lat, lon)) continue;
  seen++;
  if (overlapsOsm(ring)) { dup++; continue; }
  const pts = [];
  for (const [x, y] of ring) pts.push(r7(y), r7(x));
  const h = f.properties.height > 0 ? Math.round(f.properties.height * 10) / 10 : undefined;
  out.push(h ? { h, pts } : { pts });
}
writeFileSync('public/data/wildwood/msbuildings.json', JSON.stringify(out));
console.log(`MS footprints in area: ${seen}, duplicates of OSM: ${dup}, kept: ${out.length}`);
