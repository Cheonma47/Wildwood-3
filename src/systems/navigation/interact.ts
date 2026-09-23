/** "Press F" interaction: nearest landmark / point of interest info card. */
import { LANDMARKS } from '../../data/wildwood/landmarks';
import { latLonToWorld, worldToLatLon } from '../../world/geo/projection';
import { formatDistance, formatDuration, geodesicDistance, walkingTimeSeconds } from '../../world/geo/distance';
import type { WorldModel } from '../../world/worldModel';
import { useGame } from '../../store/gameStore';

const CAT_LABEL: Record<string, string> = {
  supermarket: 'Supermarket', convenience: 'Convenience store', pharmacy: 'Pharmacy', laundromat: 'Laundromat',
  bus: 'Bus stop', bank: 'Bank / ATM', cheap_food: 'Quick food', restaurant: 'Restaurant / bar', lodging: 'Motel / hotel',
  toilets: 'Public restrooms', emergency: 'Emergency services', attraction: 'Attraction', worship: 'Place of worship',
  civic: 'Civic', shop: 'Shop', venue: 'Venue',
};

export interface Interactable {
  title: string;
  lines: string[];
}

export function findInteractable(world: WorldModel, x: number, z: number): Interactable | null {
  const here = worldToLatLon(x, z);
  const dogtooth = LANDMARKS[0];
  const fromDogtooth = (lat: number, lon: number) => {
    const d = geodesicDistance({ lat, lon }, { lat: dogtooth.latitude, lon: dogtooth.longitude });
    return `From Dogtooth: ${formatDistance(d)} (≈ ${formatDuration(walkingTimeSeconds(d))} walk)`;
  };
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const l of LANDMARKS) {
    const p = latLonToWorld(l.latitude, l.longitude);
    const d = Math.hypot(p.x - x, p.z - z);
    const r = l.category === 'amusement' || l.category === 'venue' ? 70 : l.category === 'beach' ? 80 : 30;
    if (d < r && d < bestD) {
      bestD = d;
      best = {
        title: l.name,
        lines: [l.address ?? '', l.description ?? '', l.id === 'dogtooth' ? 'This is your workplace.' : fromDogtooth(l.latitude, l.longitude)].filter(Boolean),
      };
    }
  }
  const housing = useGame.getState().housing;
  if (housing) {
    const p = latLonToWorld(housing.lat, housing.lon);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < 25 && d < bestD) {
      bestD = d;
      best = { title: housing.label, lines: [`${housing.lat.toFixed(6)}, ${housing.lon.toFixed(6)}`, fromDogtooth(housing.lat, housing.lon)] };
    }
  }
  if (bestD > 12) {
    for (const p of world.data.pois) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 16 && d < bestD) {
        bestD = d;
        best = {
          title: p.name || CAT_LABEL[p.cat] || 'Place',
          lines: [CAT_LABEL[p.cat] ?? p.cat, p.addr ?? '', fromDogtooth(p.lat, p.lon), 'Source: OpenStreetMap'].filter(Boolean),
        };
      }
    }
  }
  void here;
  return best;
}
