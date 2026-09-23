// Converts raw OSM XML tiles (data/osm-raw) into compact geographic JSON used
// by the simulator (public/data/wildwood/*.json).
//
// All geometry stays in WGS84 latitude/longitude here. Projection to local
// metres happens at runtime in src/world/geo/projection.ts so the data layer
// stays independent of rendering.
//
// Output coordinate arrays are flat: [lat0, lon0, lat1, lon1, ...] (7 d.p.).
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseOsmDir } from './lib/osm-parse.mjs';
import { FETCH_BOUNDS as B } from './bounds.mjs';

const OUT = 'public/data/wildwood';
mkdirSync(OUT, { recursive: true });

const { nodes, ways, relations } = parseOsmDir('data/osm-raw');
console.log(`parsed ${nodes.size} nodes, ${ways.size} ways, ${relations.size} relations`);

const r7 = (v) => Math.round(v * 1e7) / 1e7;
const inBounds = (n) => n.lat >= B.south && n.lat <= B.north && n.lon >= B.west && n.lon <= B.east;

function wayNodes(w) {
  return w.nds.map((id) => nodes.get(id)).filter(Boolean);
}
function flat(ns) {
  const out = [];
  for (const n of ns) out.push(r7(n.lat), r7(n.lon));
  return out;
}
function anyInside(ns) {
  return ns.some(inBounds);
}
function centroid(ns) {
  let lat = 0, lon = 0;
  for (const n of ns) { lat += n.lat; lon += n.lon; }
  return { lat: lat / ns.length, lon: lon / ns.length };
}
const isClosed = (w) => w.nds.length > 3 && w.nds[0] === w.nds[w.nds.length - 1];

// ---------------------------------------------------------------- multipolygons
/** Joins member ways into closed rings (node-id lists). */
function assembleRings(memberWays) {
  const segs = memberWays.map((w) => [...w.nds]);
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (ring[0] !== ring[ring.length - 1] && guard++ < 10000) {
      const end = ring[ring.length - 1];
      const i = segs.findIndex((s) => s[0] === end || s[s.length - 1] === end);
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (s[0] !== end) s = s.reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length > 3 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}

function relationPolygons(rel) {
  const outer = [], inner = [];
  for (const m of rel.members) {
    if (m.type !== 'way') continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    (m.role === 'inner' ? inner : outer).push(w);
  }
  const toNodes = (ring) => ring.map((id) => nodes.get(id)).filter(Boolean);
  return {
    outer: assembleRings(outer).map(toNodes),
    inner: assembleRings(inner).map(toNodes),
  };
}

// ---------------------------------------------------------------- roads
const ROAD_KINDS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'pedestrian', 'footway', 'path', 'cycleway', 'steps', 'track',
  'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'motorway_link', 'raceway',
]);
const roads = [];
for (const w of ways.values()) {
  const hw = w.tags.highway;
  if (!hw || !ROAD_KINDS.has(hw)) continue;
  if (w.tags.area === 'yes') continue;
  const ns = wayNodes(w);
  if (ns.length < 2 || !anyInside(ns)) continue;
  roads.push({
    id: w.id,
    kind: hw,
    name: w.tags.name ?? '',
    lanes: w.tags.lanes ? +w.tags.lanes : undefined,
    oneway: w.tags.oneway === 'yes' ? 1 : undefined,
    surface: w.tags.surface,
    bridge: w.tags.bridge === 'yes' ? 1 : undefined,
    layer: w.tags.layer ? +w.tags.layer : undefined,
    service: w.tags.service,
    footway: w.tags.footway,
    nodes: w.nds.filter((id) => nodes.has(id)),
    pts: flat(ns),
  });
}

// ---------------------------------------------------------------- buildings
const buildings = [];
function pushBuilding(id, tags, outerNs, holes = []) {
  if (outerNs.length < 4 || !anyInside(outerNs)) return;
  buildings.push({
    id,
    type: tags.building,
    name: tags.name,
    levels: tags['building:levels'] ? parseFloat(tags['building:levels']) : undefined,
    height: tags.height ? parseFloat(tags.height) : undefined,
    minHeight: tags.min_height ? parseFloat(tags.min_height) : undefined,
    amenity: tags.amenity,
    shop: tags.shop,
    tourism: tags.tourism,
    leisure: tags.leisure,
    color: tags['building:colour'],
    roof: tags['roof:shape'],
    addr: tags['addr:housenumber'] ? `${tags['addr:housenumber']} ${tags['addr:street'] ?? ''}`.trim() : undefined,
    pts: flat(outerNs),
    holes: holes.length ? holes.map(flat) : undefined,
  });
}
for (const w of ways.values()) {
  if (!w.tags.building || !isClosed(w)) continue;
  pushBuilding(w.id, w.tags, wayNodes(w));
}
for (const r of relations.values()) {
  if (!r.tags.building || r.tags.type !== 'multipolygon') continue;
  const { outer, inner } = relationPolygons(r);
  for (const o of outer) pushBuilding(r.id, r.tags, o, inner);
}

// ---------------------------------------------------------------- areas
function areaKind(t) {
  if (t.highway === 'pedestrian' || t['highway:area'] === 'pedestrian' || (t.highway && t.area === 'yes'))
    return /boardwalk/i.test(t.name ?? '') || t.surface === 'wood' ? 'boardwalk' : 'plaza';
  if (t.man_made === 'pier') return 'pier';
  if (t.natural === 'beach') return 'beach';
  if (t.natural === 'water' || t.natural === 'bay' || t.water) return 'water';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'scrub' || t.natural === 'grassland' || t.natural === 'heath') return 'scrub';
  if (t.tourism === 'theme_park' || t.leisure === 'water_park') return 'themepark';
  if (t.amenity === 'parking') return 'parking';
  if (t.leisure === 'swimming_pool') return 'pool';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium') return 'pitch';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.leisure === 'dog_park' ||
      t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.leisure === 'miniature_golf') return 'park';
  if (t.landuse === 'residential' || t.landuse === 'commercial' || t.landuse === 'retail') return 'landuse';
  if (t.landuse === 'brownfield' || t.landuse === 'construction') return 'brownfield';
  return null;
}
const areas = [];
function pushArea(id, tags, outerNs, holes = []) {
  const kind = areaKind(tags);
  if (!kind || outerNs.length < 4 || !anyInside(outerNs)) return;
  if (kind === 'landuse' || kind === 'water' && outerNs.length > 5000) return;
  areas.push({
    id, kind, name: tags.name,
    layer: tags.layer ? +tags.layer : undefined,
    pts: flat(outerNs),
    holes: holes.length ? holes.map(flat) : undefined,
  });
}
for (const w of ways.values()) {
  if (w.tags.building) continue;
  if (isClosed(w)) pushArea(w.id, w.tags, wayNodes(w));
}
for (const r of relations.values()) {
  if (r.tags.type !== 'multipolygon' || r.tags.building) continue;
  const { outer, inner } = relationPolygons(r);
  for (const o of outer) pushArea(r.id, r.tags, o, inner);
}
// Open piers / boardwalk lines (man_made=pier as a line) – kept as lines.
const lines = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (isClosed(w) && !t.highway && !t.power && !t.barrier) continue;
  let kind = null;
  if (t.man_made === 'pier') kind = 'pier';
  else if (t.power === 'line' || t.power === 'minor_line') kind = 'powerline';
  else if (t.man_made === 'groyne' || t.man_made === 'breakwater') kind = 'groyne';
  else if (t.barrier === 'fence' || t.barrier === 'wall') kind = t.barrier;
  else if (t.railway) kind = 'rail';
  if (!kind) continue;
  const ns = wayNodes(w);
  if (ns.length < 2 || !anyInside(ns)) continue;
  lines.push({ id: w.id, kind, name: t.name, pts: flat(ns) });
}

// ---------------------------------------------------------------- coastline → water polygons
// OSM convention: land is on the LEFT of the coastline direction.
// We clip coastline chains to the study rectangle and close them along the
// rectangle boundary (clockwise) to obtain polygons of water.
function buildCoastWater() {
  const coast = [...ways.values()].filter((w) => w.tags.natural === 'coastline');
  // Chain ways end-to-start (direction preserved).
  const segs = coast.map((w) => [...w.nds]);
  const chains = [];
  while (segs.length) {
    let c = segs.shift();
    let grew = true;
    while (grew) {
      grew = false;
      const end = c[c.length - 1];
      const i = segs.findIndex((s) => s[0] === end);
      if (i >= 0) { c = c.concat(segs.splice(i, 1)[0].slice(1)); grew = true; }
      const start = c[0];
      const j = segs.findIndex((s) => s[s.length - 1] === start);
      if (j >= 0) { c = segs.splice(j, 1)[0].slice(0, -1).concat(c); grew = true; }
    }
    chains.push(c.map((id) => nodes.get(id)).filter(Boolean));
  }
  // Planar coordinates: x = lon, y = lat (fine for topology over ~5 km).
  const R = { x0: B.west, x1: B.east, y0: B.south, y1: B.north };
  const inside = (p) => p.x >= R.x0 && p.x <= R.x1 && p.y >= R.y0 && p.y <= R.y1;
  // Perimeter parameter, clockwise starting at the north-west corner
  // (north edge west→east, east edge north→south, south edge east→west, west edge south→north).
  const W = R.x1 - R.x0, H = R.y1 - R.y0, P = 2 * (W + H);
  const perim = (p) => {
    const e = 1e-9;
    if (Math.abs(p.y - R.y1) < e) return p.x - R.x0;
    if (Math.abs(p.x - R.x1) < e) return W + (R.y1 - p.y);
    if (Math.abs(p.y - R.y0) < e) return W + H + (R.x1 - p.x);
    return 2 * W + H + (p.y - R.y0);
  };
  const corners = [
    { t: 0, p: { x: R.x0, y: R.y1 } }, { t: W, p: { x: R.x1, y: R.y1 } },
    { t: W + H, p: { x: R.x1, y: R.y0 } }, { t: 2 * W + H, p: { x: R.x0, y: R.y0 } },
  ];
  // Liang–Barsky segment clip.
  function clipSeg(a, b) {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    const pq = [[-dx, a.x - R.x0], [dx, R.x1 - a.x], [-dy, a.y - R.y0], [dy, R.y1 - a.y]];
    for (const [p, q] of pq) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
  }
  const pieces = []; // open pieces entering and leaving the rectangle
  const closedWater = []; // islands handled separately (land) – ignored for water
  for (const ch of chains) {
    const pts = ch.map((n) => ({ x: n.lon, y: n.lat }));
    const closed = ch.length > 3 && ch[0] === ch[ch.length - 1];
    if (closed && pts.every(inside)) { closedWater.push(pts); continue; }
    let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const c = clipSeg(pts[i], pts[i + 1]);
      if (!c) { if (cur) { pieces.push(cur); cur = null; } continue; }
      const aIn = inside(pts[i]);
      if (!cur) cur = [c[0]];
      else if (!aIn) { pieces.push(cur); cur = [c[0]]; }
      cur.push(c[1]);
      if (!inside(pts[i + 1])) { pieces.push(cur); cur = null; }
    }
    if (cur) pieces.push(cur);
  }
  // Discard pieces that do not start and end on the boundary (data gaps).
  const onEdge = (p) => Math.abs(p.x - R.x0) < 1e-9 || Math.abs(p.x - R.x1) < 1e-9 || Math.abs(p.y - R.y0) < 1e-9 || Math.abs(p.y - R.y1) < 1e-9;
  const good = pieces.filter((p) => p.length >= 2 && onEdge(p[0]) && onEdge(p[p.length - 1]));
  console.log(`coastline: ${chains.length} chains, ${pieces.length} clipped pieces, ${good.length} usable, ${closedWater.length} islands`);
  const used = new Set();
  const polys = [];
  for (let s = 0; s < good.length; s++) {
    if (used.has(s)) continue;
    const ring = [];
    let k = s;
    let guard = 0;
    while (!used.has(k) && guard++ < 1000) {
      used.add(k);
      const piece = good[k];
      ring.push(...piece);
      // Walk the boundary clockwise from the exit point to the next entry.
      const tExit = perim(piece[piece.length - 1]);
      let best = -1, bestD = Infinity;
      for (let m = 0; m < good.length; m++) {
        const d = (perim(good[m][0]) - tExit + P) % P;
        if (d < bestD) { bestD = d; best = m; }
      }
      for (const c of corners) {
        const d = (c.t - tExit + P) % P;
        if (d > 0 && d < bestD) ring.push({ ...c.p, _d: d });
      }
      // corners must be in order along the walk
      const tail = ring.splice(ring.length - ring.filter((p) => p._d !== undefined).length);
      tail.sort((a, b) => a._d - b._d).forEach((p) => ring.push({ x: p.x, y: p.y }));
      k = best;
    }
    polys.push(ring);
  }
  return polys.map((ring) => ring.flatMap((p) => [r7(p.y), r7(p.x)]));
}
const water = buildCoastWater();

// ---------------------------------------------------------------- points of interest
function poiCategory(t) {
  if (t.shop === 'supermarket' || t.shop === 'greengrocer') return 'supermarket';
  if (t.shop === 'convenience' || t.shop === 'variety_store' || t.shop === 'alcohol' && false) return 'convenience';
  if (t.amenity === 'pharmacy' || t.shop === 'chemist') return 'pharmacy';
  if (t.shop === 'laundry' || t.amenity === 'laundry') return 'laundromat';
  if (t.highway === 'bus_stop' || t.public_transport === 'platform' || t.public_transport === 'station' || t.amenity === 'bus_station') return 'bus';
  if (t.amenity === 'atm' || t.amenity === 'bank') return 'bank';
  if (t.amenity === 'fast_food' || t.amenity === 'cafe' || t.amenity === 'ice_cream' || t.amenity === 'food_court') return 'cheap_food';
  if (t.amenity === 'restaurant' || t.amenity === 'bar' || t.amenity === 'pub') return 'restaurant';
  if (t.tourism === 'motel' || t.tourism === 'hotel' || t.tourism === 'guest_house' || t.tourism === 'apartment') return 'lodging';
  if (t.amenity === 'toilets') return 'toilets';
  if (t.amenity === 'police' || t.amenity === 'fire_station' || t.amenity === 'hospital' || t.amenity === 'clinic' || t.amenity === 'doctors') return 'emergency';
  if (t.leisure === 'amusement_arcade' || t.tourism === 'attraction' || t.tourism === 'theme_park' || t.leisure === 'water_park') return 'attraction';
  if (t.amenity === 'place_of_worship') return 'worship';
  if (t.amenity === 'post_office' || t.amenity === 'townhall' || t.amenity === 'library') return 'civic';
  if (t.shop) return 'shop';
  if (t.amenity === 'conference_centre' || t.amenity === 'events_venue') return 'venue';
  return null;
}
const pois = [];
function pushPoi(id, t, ll) {
  const cat = poiCategory(t);
  if (!cat) return;
  if (!inBounds(ll)) return;
  if (!t.name && !['bus', 'toilets', 'bank'].includes(cat)) return;
  pois.push({
    id, cat, name: t.name ?? '', lat: r7(ll.lat), lon: r7(ll.lon),
    detail: t.shop ?? t.amenity ?? t.tourism ?? t.leisure ?? t.highway,
    brand: t.brand, addr: t['addr:housenumber'] ? `${t['addr:housenumber']} ${t['addr:street'] ?? ''}`.trim() : undefined,
  });
}
for (const n of nodes.values()) pushPoi(n.id, n.tags, n);
for (const w of ways.values()) {
  if (!isClosed(w)) continue;
  const ns = wayNodes(w);
  if (ns.length) pushPoi(w.id, w.tags, centroid(ns));
}
for (const r of relations.values()) {
  if (r.tags.type !== 'multipolygon') continue;
  const { outer } = relationPolygons(r);
  if (outer.length) pushPoi(r.id, r.tags, centroid(outer[0]));
}

// ---------------------------------------------------------------- point features
const points = [];
for (const n of nodes.values()) {
  if (!inBounds(n)) continue;
  const t = n.tags;
  let kind = null;
  if (t.natural === 'tree') kind = 'tree';
  else if (t.highway === 'traffic_signals') kind = 'signal';
  else if (t.highway === 'stop') kind = 'stop';
  else if (t.highway === 'crossing') kind = 'crossing';
  else if (t.power === 'pole' || t.power === 'tower') kind = 'pole';
  else if (t.highway === 'street_lamp') kind = 'lamp';
  else if (t.amenity === 'bench') kind = 'bench';
  else if (t.amenity === 'bicycle_parking') kind = 'bike_parking';
  else if (t.attraction === 'big_wheel') kind = 'big_wheel';
  else if (t.attraction === 'roller_coaster') kind = 'roller_coaster';
  else if (t.attraction) kind = 'ride';
  if (!kind) continue;
  points.push({ kind, lat: r7(n.lat), lon: r7(n.lon), name: t.name });
}
// Ride ways (roller coaster tracks, water slides) as lines for silhouettes.
for (const w of ways.values()) {
  const a = w.tags.attraction;
  if (!a) continue;
  const ns = wayNodes(w);
  if (ns.length < 2 || !anyInside(ns)) continue;
  lines.push({ id: w.id, kind: `attraction:${a}`, name: w.tags.name, pts: flat(ns) });
}

const meta = {
  source: 'OpenStreetMap contributors (ODbL 1.0) — https://www.openstreetmap.org/copyright',
  fetchedBounds: B,
  generated: new Date().toISOString(),
  counts: { roads: roads.length, buildings: buildings.length, areas: areas.length, lines: lines.length, water: water.length, pois: pois.length, points: points.length },
};
const write = (name, data) => {
  const s = JSON.stringify(data);
  writeFileSync(`${OUT}/${name}.json`, s);
  console.log(`${name}.json ${(s.length / 1024).toFixed(0)} KB`);
};
write('meta', meta);
write('roads', roads);
write('buildings', buildings);
write('areas', areas);
write('lines', lines);
write('water', water);
write('pois', pois);
write('points', points);
console.log(meta.counts);
