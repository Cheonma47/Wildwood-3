/** Assigns a visual style and height to real OSM building footprints. */
import type { BuildingStyle, RawBuilding } from '../data/types';
import { hash01, polygonArea, type V2 } from '../math/polygon';

const LEVEL_HEIGHT = 3.1;

export function classifyOsmBuilding(b: RawBuilding, outer: V2[], nearBoardwalk: boolean, onBoardwalkDeck: boolean): { style: BuildingStyle; height: number } {
  const area = polygonArea(outer);
  const r = hash01(b.id);
  let style: BuildingStyle = 'commercial';
  let levels: number;

  if (onBoardwalkDeck) style = 'boardwalk_shop';
  else if (b.tourism === 'motel') style = 'motel';
  else if (b.tourism === 'hotel' || b.type === 'hotel') style = 'motel';
  else if (b.amenity === 'restaurant' || b.amenity === 'fast_food' || b.amenity === 'bar' || b.amenity === 'pub' || b.amenity === 'cafe') style = 'restaurant';
  else if (b.shop) style = 'shop';
  else if (b.type === 'house' || b.type === 'detached') style = 'house';
  else if (b.type === 'apartments' || b.type === 'residential') style = 'apartment';
  else if (b.type === 'garage' || b.type === 'garages' || b.type === 'roof' || b.type === 'boathouse') style = 'garage';
  else if (b.type === 'church' || b.type === 'school' || b.type === 'civic' || b.amenity === 'place_of_worship' || b.amenity === 'townhall' || b.amenity === 'conference_centre') style = 'civic';
  else if (nearBoardwalk) style = area > 250 ? (r < 0.5 ? 'motel' : 'commercial') : 'boardwalk_shop';
  else if (area < 160) style = 'house';
  else if (area < 450) style = r < 0.55 ? 'apartment' : r < 0.8 ? 'motel' : 'commercial';
  else style = r < 0.5 ? 'motel' : 'commercial';

  switch (style) {
    case 'house': levels = 1.5 + Math.round(r * 2) * 0.5; break;
    case 'motel': levels = b.tourism === 'hotel' || b.type === 'hotel' ? 5 + Math.floor(r * 4) : 2 + Math.floor(r * 2.2); break;
    case 'apartment': levels = 2 + Math.floor(r * 2.5); break;
    case 'restaurant': levels = 1 + Math.floor(r * 1.8); break;
    case 'shop': levels = 1 + Math.floor(r * 1.6); break;
    case 'boardwalk_shop': levels = 1 + Math.floor(r * 1.7); break;
    case 'garage': levels = 1; break;
    case 'civic': levels = area > 2000 ? 3 : 2; break;
    default: levels = area > 800 ? 2 + Math.floor(r * 3) : 1 + Math.floor(r * 2.5);
  }
  if (b.levels) levels = b.levels;
  let height = b.height ?? levels * LEVEL_HEIGHT + (style === 'house' ? 0 : 0.6);
  if (style === 'garage') height = Math.min(height, 3.5);
  return { style, height: Math.max(2.8, height) };
}
