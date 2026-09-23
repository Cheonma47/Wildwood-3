/**
 * Distance helpers.
 *
 * - geodesicDistance: "real-world" distance on the WGS84 ellipsoid (Vincenty
 *   inverse formula, sub-millimetre accuracy). This is the ground truth.
 * - haversineDistance: spherical approximation (≈0.3 % error), for reference.
 * - distanceMeters: straight-line distance between two game-world positions.
 */
import { WGS84, type GeoPoint, type WorldPoint } from './projection.ts';

const DEG = Math.PI / 180;

export function geodesicDistance(a: GeoPoint, b: GeoPoint): number {
  const { a: A, f } = WGS84;
  const B = A * (1 - f);
  const L = (b.lon - a.lon) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(a.lat * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(b.lat * DEG));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L;
  let prev: number;
  let iter = 0;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  do {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - prev) > 1e-12 && ++iter < 200);

  const uSq = (cos2Alpha * (A * A - B * B)) / (B * B);
  const kA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const kB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const dSigma = kB * sinSigma * (cos2SigmaM + (kB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
    (kB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return B * kA * (sigma - dSigma);
}

export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line horizontal distance between two game-world positions (metres). */
export function distanceMeters(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Length of a world-space polyline (metres). */
export function polylineLength(pts: readonly WorldPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceMeters(pts[i - 1], pts[i]);
  return d;
}

/** Walking speeds in metres per second. */
export const WALK_SPEED = 1.4;
export const FAST_WALK_SPEED = 2.0;
export const RUN_SPEED = 4.5;

/** Estimated walking time in seconds at normal pace (1.4 m/s). */
export function walkingTimeSeconds(meters: number, speed = WALK_SPEED): number {
  return meters / speed;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  const min = seconds / 60;
  if (min < 1) return '< 1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min - h * 60)} min`;
}

/** Initial bearing from a to b in degrees clockwise from true north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG, Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}
