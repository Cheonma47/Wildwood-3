/**
 * Data types. `Raw*` = geographic data as produced by scripts/build-osm.mjs
 * (flat [lat, lon, ...] arrays). Non-raw = projected into world metres.
 */
import type { V2 } from '../math/polygon';

export interface RawRoad {
  id: number;
  kind: string;
  name: string;
  lanes?: number;
  oneway?: 1;
  surface?: string;
  bridge?: 1;
  layer?: number;
  service?: string;
  footway?: string;
  nodes: number[];
  pts: number[];
}

export interface RawBuilding {
  id: number;
  type: string;
  name?: string;
  levels?: number;
  height?: number;
  minHeight?: number;
  amenity?: string;
  shop?: string;
  tourism?: string;
  leisure?: string;
  color?: string;
  roof?: string;
  addr?: string;
  pts: number[];
  holes?: number[][];
}

export type AreaKind =
  | 'boardwalk' | 'plaza' | 'pier' | 'beach' | 'water' | 'wetland' | 'scrub' | 'themepark'
  | 'parking' | 'pool' | 'pitch' | 'park' | 'brownfield';

export interface RawArea {
  id: number;
  kind: AreaKind;
  name?: string;
  layer?: number;
  pts: number[];
  holes?: number[][];
}

export interface RawLine {
  id: number;
  kind: string;
  name?: string;
  pts: number[];
}

export type PoiCategory =
  | 'supermarket' | 'convenience' | 'pharmacy' | 'laundromat' | 'bus' | 'bank' | 'cheap_food'
  | 'restaurant' | 'lodging' | 'toilets' | 'emergency' | 'attraction' | 'worship' | 'civic' | 'shop' | 'venue';

export interface RawPoi {
  id: number;
  cat: PoiCategory;
  name: string;
  lat: number;
  lon: number;
  detail?: string;
  brand?: string;
  addr?: string;
}

export interface RawPoint {
  kind: string;
  lat: number;
  lon: number;
  name?: string;
}

// ------------------------------------------------------------------ projected

export interface Road {
  id: number;
  kind: string;
  name: string;
  oneway: boolean;
  /** Carriageway width in metres. */
  width: number;
  /** True for roads cars drive on (not footways/paths). */
  drivable: boolean;
  /** Roads that get sidewalks on both sides. */
  hasSidewalk: boolean;
  nodes: number[];
  pts: V2[];
  surface?: string;
}

export interface Building {
  id: number;
  source: 'osm' | 'procedural';
  type: string;
  name?: string;
  outer: V2[];
  holes?: V2[][];
  height: number;
  baseY: number;
  style: BuildingStyle;
  amenity?: string;
  shop?: string;
  tourism?: string;
  /** Landmark renderer replaces the procedural mesh when set. */
  landmarkId?: string;
  /** Orientation for procedural rectangular lots: direction of the street frontage. */
  frontDir?: V2;
  seed: number;
}

export type BuildingStyle =
  | 'house' | 'motel' | 'shop' | 'restaurant' | 'apartment' | 'commercial' | 'civic' | 'boardwalk_shop' | 'garage' | 'industrial';

export interface Area {
  id: number;
  kind: AreaKind;
  name?: string;
  outer: V2[];
  holes?: V2[][];
}

export interface Line {
  id: number;
  kind: string;
  name?: string;
  pts: V2[];
}

export interface Poi {
  id: number;
  cat: PoiCategory;
  name: string;
  lat: number;
  lon: number;
  x: number;
  z: number;
  detail?: string;
  brand?: string;
  addr?: string;
}

export interface PointFeature {
  kind: string;
  x: number;
  z: number;
  name?: string;
}
