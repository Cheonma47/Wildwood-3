/**
 * Approximate solar position for Wildwood in early July (Work & Travel season).
 * Clock time is Eastern Daylight Time.
 */
import { WILDWOOD_ORIGIN } from '../../world/geo/projection';

const DEG = Math.PI / 180;
const DECLINATION = 22 * DEG; // early July
const LAT = WILDWOOD_ORIGIN.lat * DEG;

export interface SunState {
  elevation: number; // radians
  azimuth: number; // radians clockwise from north
  /** unit vector in world space (x east, y up, z south) */
  dir: [number, number, number];
  /** 0 = full day, 1 = full night */
  night: number;
  /** 0..1 how much sunset colouring to apply */
  golden: number;
}

export function sunAt(clockHours: number): SunState {
  // EDT = UTC-4; standard meridian for EST is 75°W. Solar time ≈ clock − 1 h + (lon + 75)·4 min + EoT(≈ −4 min).
  const solar = clockHours - 1 + ((WILDWOOD_ORIGIN.lon + 75) * 4) / 60 - 4 / 60;
  const H = (solar - 12) * 15 * DEG;
  const sinEl = Math.sin(LAT) * Math.sin(DECLINATION) + Math.cos(LAT) * Math.cos(DECLINATION) * Math.cos(H);
  const elevation = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(DECLINATION) * Math.cos(LAT)) + Math.PI;
  const ce = Math.cos(elevation);
  const dir: [number, number, number] = [Math.sin(az) * ce, Math.sin(elevation), -Math.cos(az) * ce];
  const elDeg = elevation / DEG;
  const night = smooth(4, -9, elDeg);
  const golden = smooth(18, 2, elDeg) * (1 - smooth(-1, -7, elDeg));
  return { elevation, azimuth: az, dir, night, golden };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function formatClock(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}
