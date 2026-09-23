/**
 * Wildwood geographic bounds and conversions between the map's lat/lon
 * bounds and world-space rectangles.
 */
import { latLonToWorld, worldToLatLon, WILDWOOD_ORIGIN, type GeoPoint, type WorldPoint } from './projection.ts';

export { latLonToWorld, worldToLatLon, WILDWOOD_ORIGIN };
export type { GeoPoint, WorldPoint };

export interface GeoBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

/**
 * Area covered by the preprocessed OSM data (scripts/bounds.mjs must match).
 * Covers all of the City of Wildwood plus the edges of North Wildwood,
 * Wildwood Crest and West Wildwood so streets/beach are complete.
 */
export const DATA_BOUNDS: GeoBounds = { south: 38.965, north: 39.005, west: -74.84, east: -74.79 };

/** Where the player is allowed to walk (slightly inside the data bounds). */
export const PLAYABLE_BOUNDS: GeoBounds = { south: 38.9665, north: 39.0035, west: -74.8385, east: -74.7915 };

export interface WorldRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Axis-aligned world rectangle that encloses a lat/lon box. */
export function boundsToWorldRect(b: GeoBounds): WorldRect {
  const corners = [
    latLonToWorld(b.south, b.west),
    latLonToWorld(b.south, b.east),
    latLonToWorld(b.north, b.west),
    latLonToWorld(b.north, b.east),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.z)),
    maxZ: Math.max(...corners.map((c) => c.z)),
  };
}

export const DATA_RECT = boundsToWorldRect(DATA_BOUNDS);
export const PLAYABLE_RECT = boundsToWorldRect(PLAYABLE_BOUNDS);

/** Compass heading (degrees, 0 = north, 90 = east) for a world-space yaw. */
export function yawToHeading(yaw: number): number {
  // Camera looks down -z at yaw 0 (north); positive yaw rotates left (towards -x / west).
  return (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
}

export function headingToCompass(h: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(h / 45) % 8];
}
