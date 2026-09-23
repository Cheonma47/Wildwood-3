/** Real-world road widths (metres) and classification by OSM highway type. */

const DEFAULT_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 13, primary: 13, secondary: 12, tertiary: 11,
  primary_link: 7, secondary_link: 7, tertiary_link: 7, trunk_link: 7, motorway_link: 7,
  unclassified: 9, residential: 9, living_street: 6, service: 5, track: 3,
  pedestrian: 5, footway: 2, path: 1.8, cycleway: 2.5, steps: 2, raceway: 3,
};

const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'motorway_link',
]);

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export function roadWidth(kind: string, lanes?: number, service?: string): number {
  let w = DEFAULT_WIDTH[kind] ?? 4;
  if (lanes && DRIVABLE.has(kind) && kind !== 'service') {
    // lanes × 3.3 m + parking strips, clamped to sane values
    w = Math.min(18, Math.max(w * 0.8, lanes * 3.3 + 4.4));
  }
  if (kind === 'service' && (service === 'parking_aisle' || service === 'driveway')) w = 4;
  return w;
}

export const isDrivable = (kind: string) => DRIVABLE.has(kind);
export const isMajor = (kind: string) => MAJOR.has(kind);
export const hasSidewalks = (kind: string, name: string) =>
  DRIVABLE.has(kind) && kind !== 'service' && !kind.endsWith('_link') && name !== '';

export const SIDEWALK_WIDTH = 2.0;

/** Nice display name: "East Taylor Avenue" → "E Taylor Ave". */
export function shortStreetName(name: string): string {
  return name
    .replace(/^East /, 'E ')
    .replace(/^West /, 'W ')
    .replace(/^North /, 'N ')
    .replace(/^South /, 'S ')
    .replace(/ Avenue$/, ' Ave')
    .replace(/ Boulevard$/, ' Blvd')
    .replace(/ Road$/, ' Rd')
    .replace(/ Street$/, ' St')
    .replace(/ Drive$/, ' Dr')
    .replace(/ Lane$/, ' Ln');
}
