/**
 * Geographic projection: WGS84 latitude/longitude <-> local Wildwood metres.
 *
 * World axes (three.js convention):
 *   +x = east, -z = north (so +z = south), +y = up.
 *   1 world unit = 1 metre.
 *
 * Projection: a local "equidistant meridian" projection on the WGS84
 * ellipsoid, centred on WILDWOOD_ORIGIN:
 *   north (m) = meridian arc length from origin latitude to point latitude
 *   east  (m) = Δλ · N(φ) · cos φ     (length along the point's own parallel)
 * Both N–S distances along meridians and E–W distances along parallels are
 * exact; residual distortion for diagonal distances inside the ~5 km study
 * area is below 0.05 % (verified by distance.test.ts against Vincenty).
 *
 * This file intentionally has no imports so it can be reused by Node
 * preprocessing scripts (via type stripping) and tests.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

export const WGS84 = {
  a: 6378137.0,
  f: 1 / 298.257223563,
} as const;

const E2 = WGS84.f * (2 - WGS84.f);
const DEG = Math.PI / 180;

/** Projection origin: centre of the Wildwood study area. */
export const WILDWOOD_ORIGIN: GeoPoint = { lat: 38.985, lon: -74.815 };

/** Prime-vertical radius of curvature N(φ). */
export function primeVerticalRadius(latRad: number): number {
  const s = Math.sin(latRad);
  return WGS84.a / Math.sqrt(1 - E2 * s * s);
}

/** Meridian radius of curvature M(φ). */
export function meridianRadius(latRad: number): number {
  const s = Math.sin(latRad);
  return (WGS84.a * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5);
}

/** Meridian arc length from the equator to latitude φ (metres). */
export function meridianArc(latRad: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const A0 = 1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const A2 = (3 / 8) * (E2 + e4 / 4 + (15 * e6) / 128);
  const A4 = (15 / 256) * (e4 + (3 * e6) / 4);
  const A6 = (35 * e6) / 3072;
  return (
    WGS84.a *
    (A0 * latRad - A2 * Math.sin(2 * latRad) + A4 * Math.sin(4 * latRad) - A6 * Math.sin(6 * latRad))
  );
}

export interface Projection {
  origin: GeoPoint;
  latLonToWorld(lat: number, lon: number): WorldPoint;
  worldToLatLon(x: number, z: number): GeoPoint;
}

export function createProjection(origin: GeoPoint = WILDWOOD_ORIGIN): Projection {
  const phi0 = origin.lat * DEG;
  const arc0 = meridianArc(phi0);

  function latLonToWorld(lat: number, lon: number): WorldPoint {
    const phi = lat * DEG;
    const north = meridianArc(phi) - arc0;
    const east = (lon - origin.lon) * DEG * primeVerticalRadius(phi) * Math.cos(phi);
    return { x: east, z: -north };
  }

  function worldToLatLon(x: number, z: number): GeoPoint {
    const target = arc0 - z; // meridian arc of the point
    // Newton iteration on meridianArc(φ) = target (converges in 2–3 steps).
    let phi = phi0 + -z / meridianRadius(phi0);
    for (let i = 0; i < 5; i++) {
      phi -= (meridianArc(phi) - target) / meridianRadius(phi);
    }
    const lon = origin.lon + x / (primeVerticalRadius(phi) * Math.cos(phi)) / DEG;
    return { lat: phi / DEG, lon };
  }

  return { origin, latLonToWorld, worldToLatLon };
}

/** Default Wildwood projection used throughout the game. */
export const wildwoodProjection = createProjection(WILDWOOD_ORIGIN);

export const latLonToWorld = (lat: number, lon: number): WorldPoint =>
  wildwoodProjection.latLonToWorld(lat, lon);

export const worldToLatLon = (x: number, z: number): GeoPoint =>
  wildwoodProjection.worldToLatLon(x, z);
