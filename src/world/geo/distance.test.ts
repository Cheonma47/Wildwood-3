import { describe, expect, it } from 'vitest';
import { createProjection, latLonToWorld, worldToLatLon } from './projection.ts';
import { distanceMeters, geodesicDistance, haversineDistance, walkingTimeSeconds } from './distance.ts';
import { LANDMARKS } from '../../data/wildwood/landmarks.ts';

const byId = (id: string) => {
  const l = LANDMARKS.find((x) => x.id === id)!;
  return { lat: l.latitude, lon: l.longitude };
};

/** Compare real (ellipsoidal) distance with game-world distance. */
function scaleError(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const real = geodesicDistance(a, b);
  const game = distanceMeters(latLonToWorld(a.lat, a.lon), latLonToWorld(b.lat, b.lon));
  return { real, game, error: Math.abs(game - real) / real };
}

describe('geodesic reference', () => {
  it('Vincenty matches a known long baseline', () => {
    // Flinders Peak → Buninyong (classic Vincenty test): 54 972.271 m
    const d = geodesicDistance({ lat: -37.95103342, lon: 144.42486789 }, { lat: -37.65282114, lon: 143.92649554 });
    expect(d).toBeCloseTo(54972.271, 2);
  });
  it('one degree of latitude at 39°N is ≈ 111 023 m', () => {
    const d = geodesicDistance({ lat: 38.5, lon: -74.8 }, { lat: 39.5, lon: -74.8 });
    expect(Math.abs(d - 111023)).toBeLessThan(15);
  });
  it('haversine is within 0.5 % of Vincenty locally', () => {
    const a = byId('dogtooth'), b = byId('mcdonalds');
    expect(Math.abs(haversineDistance(a, b) / geodesicDistance(a, b) - 1)).toBeLessThan(0.005);
  });
});

describe('projection', () => {
  it('origin maps to (0,0)', () => {
    const p = createProjection({ lat: 38.985, lon: -74.815 });
    const w = p.latLonToWorld(38.985, -74.815);
    expect(Math.abs(w.x)).toBeLessThan(1e-9);
    expect(Math.abs(w.z)).toBeLessThan(1e-9);
  });
  it('north is -z and east is +x', () => {
    const n = latLonToWorld(38.995, -74.815);
    const e = latLonToWorld(38.985, -74.805);
    expect(n.z).toBeLessThan(-1000);
    expect(e.x).toBeGreaterThan(800);
  });
  it('round-trips lat/lon to sub-millimetre precision', () => {
    for (const l of LANDMARKS) {
      const w = latLonToWorld(l.latitude, l.longitude);
      const g = worldToLatLon(w.x, w.z);
      const back = geodesicDistance(g, { lat: l.latitude, lon: l.longitude });
      expect(back).toBeLessThan(0.001);
    }
  });
});

describe('real-world scale validation (target < 2 %)', () => {
  const pairs: [string, string][] = [
    ['dogtooth', 'mcdonalds'],
    ['dogtooth', 'convention-center'],
    ['dogtooth', 'moreys-mariners'],
    ['dogtooth', 'boardwalk-taylor'],
    ['mcdonalds', 'moreys-surfside'],
    ['convention-center', 'moreys-surfside'],
  ];
  for (const [a, b] of pairs) {
    it(`${a} → ${b}`, () => {
      const r = scaleError(byId(a), byId(b));
      // Log for the developer: `npm run validate:distances`
      console.log(`${a} → ${b}: real ${r.real.toFixed(2)} m, game ${r.game.toFixed(2)} m, error ${(r.error * 100).toFixed(4)} %`);
      expect(r.error).toBeLessThan(0.0005); // far below the 2 % target
    });
  }
  it('corner-to-corner of the whole study area stays under 0.05 %', () => {
    const r = scaleError({ lat: 38.965, lon: -74.84 }, { lat: 39.005, lon: -74.79 });
    expect(r.error).toBeLessThan(0.0005);
  });
  it('walking time is computed from distance at 1.4 m/s', () => {
    expect(walkingTimeSeconds(840)).toBeCloseTo(600, 5);
  });
});
