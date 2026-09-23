import { parseOsmDir } from './lib/osm-parse.mjs';
const { nodes, ways, relations } = parseOsmDir('data/osm-raw');
console.log(nodes.size, ways.size, relations.size);
const q = process.argv[2];
const byName = new Map();
for (const w of ways.values()) {
  if (!w.tags.highway || !w.tags.name) continue;
  const a = byName.get(w.tags.name) || { lat: [], lon: [], ids: [], hw: new Set() };
  for (const id of w.nds) { const n = nodes.get(id); if (n) { a.lat.push(n.lat); a.lon.push(n.lon); } }
  a.ids.push(w.id); a.hw.add(w.tags.highway);
  byName.set(w.tags.name, a);
}
if (q === 'streets') {
  for (const [name, a] of [...byName].sort()) {
    const mn = (x) => Math.min(...x).toFixed(4), mx = (x) => Math.max(...x).toFixed(4);
    console.log(name.padEnd(32), [...a.hw].join(','), 'lat', mn(a.lat), mx(a.lat), 'lon', mn(a.lon), mx(a.lon));
  }
}
if (q === 'x') {
  // intersection nodes between two street names
  const [s1, s2] = process.argv.slice(3);
  const set1 = new Set(); for (const w of ways.values()) if (w.tags.name === s1) w.nds.forEach((n) => set1.add(n));
  for (const w of ways.values()) if (w.tags.name === s2) for (const n of w.nds) if (set1.has(n)) console.log(s1, 'x', s2, nodes.get(n).lat, nodes.get(n).lon);
}
if (q === 'named') {
  const re = new RegExp(process.argv[3], 'i');
  for (const coll of [nodes, ways, relations]) for (const e of coll.values()) {
    if (Object.values(e.tags).some((v) => re.test(v))) {
      let lat = e.lat, lon = e.lon;
      if (e.nds) { const ns = e.nds.map((i) => nodes.get(i)).filter(Boolean); lat = ns.reduce((s, n) => s + n.lat, 0) / ns.length; lon = ns.reduce((s, n) => s + n.lon, 0) / ns.length; }
      console.log(e.id, JSON.stringify(e.tags).slice(0, 200), lat?.toFixed(6), lon?.toFixed(6));
    }
  }
}
