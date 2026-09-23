// Merges Overture Maps places into the POI set, skipping closed / low-confidence
// places and ones already present in OSM (same name within 60 m).
// Output: public/data/wildwood/places.json (same shape as pois.json).
import { readFileSync, writeFileSync } from 'node:fs';

const places = JSON.parse(readFileSync('data/overture/places.json', 'utf8'));
const osm = JSON.parse(readFileSync('public/data/wildwood/pois.json', 'utf8'));
const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lon - b.lon) * 86500);

function category(basic, cat) {
  const k = `${basic ?? ''} ${cat ?? ''}`;
  if (/pharmacy|drugstore/.test(k)) return 'pharmacy';
  if (/laundr|dry_clean/.test(k)) return 'laundromat';
  if (/grocery|supermarket/.test(k)) return 'supermarket';
  if (/convenience|liquor|food_and_beverage_store|beer_wine/.test(k)) return 'convenience';
  if (/\batm\b|bank|financial|credit_union/.test(k)) return 'bank';
  if (/bus_station|bus_stop|transit/.test(k)) return 'bus';
  if (/casual_eatery|fast_food|pizza|ice_cream|coffee|cafe|bakery|dessert|donut|sandwich|deli|snack|hot_dog|burger|juice/.test(k)) return 'cheap_food';
  if (/restaurant|bar\b|pub|tavern|grill|diner|seafood|eatery|brewery|night_club|lounge/.test(k)) return 'restaurant';
  if (/hotel|motel|lodging|resort|inn\b|bed_and_breakfast|vacation/.test(k)) return 'lodging';
  if (/amusement|arcade|water_park|attraction|mini_golf|entertainment/.test(k)) return 'attraction';
  if (/worship|church/.test(k)) return 'worship';
  if (/police|fire_station|hospital|clinic|urgent_care|doctor|dentist/.test(k)) return 'emergency';
  if (/post_office|library|government|city_hall/.test(k)) return 'civic';
  if (/store|shop|boutique|apparel|gift|jewel|tattoo|salon|barber|beauty|real_estate|rental|travel_service|professional|insurance|repair|surf/.test(k)) return 'shop';
  return null;
}

const out = [];
let skipped = 0;
for (const p of places) {
  if (!p.name || p.status === 'permanently_closed' || (p.conf ?? 0) < 0.55) { skipped++; continue; }
  const cat = category(p.basic, p.cat);
  if (!cat) { skipped++; continue; }
  const n = norm(p.name);
  if (osm.some((o) => dist(o, p) < 60 && (norm(o.name) === n || (n.length > 4 && (norm(o.name).includes(n) || n.includes(norm(o.name)) && norm(o.name).length > 4))))) { skipped++; continue; }
  const detail = (p.basic ?? p.cat ?? '').replace(/_/g, ' ');
  out.push({ id: 9e9 + out.length, cat, name: p.name, lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7), detail, addr: p.addr ?? undefined, src: 'overture' });
}
writeFileSync('public/data/wildwood/places.json', JSON.stringify(out));
console.log(`Overture places kept: ${out.length}, skipped: ${skipped}`);
