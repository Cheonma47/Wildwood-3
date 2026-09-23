// Downloads raw OpenStreetMap data for the Wildwood study area from the
// official OSM API (map call), tiling the bounding box so each request stays
// well under the API's node limit. Output: data/osm-raw/tile_<i>_<j>.osm
//
// Usage: node scripts/fetch-osm.mjs
// Uses curl so that HTTPS proxies / CA bundles configured in the shell apply.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FETCH_BOUNDS } from './bounds.mjs';

const OUT = 'data/osm-raw';
const STEP = 0.01; // degrees per tile side
mkdirSync(OUT, { recursive: true });

const tiles = [];
for (let lat = FETCH_BOUNDS.south; lat < FETCH_BOUNDS.north - 1e-9; lat += STEP) {
  for (let lon = FETCH_BOUNDS.west; lon < FETCH_BOUNDS.east - 1e-9; lon += STEP) {
    tiles.push([lon, lat, Math.min(lon + STEP, FETCH_BOUNDS.east), Math.min(lat + STEP, FETCH_BOUNDS.north)]);
  }
}

let i = 0;
for (const [w, s, e, n] of tiles) {
  const file = join(OUT, `tile_${i++}.osm`);
  if (existsSync(file) && statSync(file).size > 1000) continue;
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      execFileSync('curl', ['-sS', '-f', '-m', '120', '-o', file, url], { stdio: 'inherit' });
      console.log(`ok ${file} ${url}`);
      break;
    } catch {
      console.warn(`retry ${url}`);
      execFileSync('sleep', [String(2 ** (attempt + 1))]);
    }
  }
}
console.log(`fetched ${tiles.length} tiles`);
