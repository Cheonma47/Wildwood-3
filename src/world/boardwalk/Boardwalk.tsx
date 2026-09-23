/**
 * Wildwood Boardwalk: elevated deck built from the real OSM Boardwalk and
 * pier polygons, with pilings, tram lane markings, ramps and beach stairs.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { GeoBuilder } from '../render/geometry';
import { getMaterials } from '../render/materials';
import { DECK_HEIGHT, WalkableSurfaces } from '../physics/walkable';
import { pointInRing } from '../math/polygon';
import type { WorldModel } from '../worldModel';

export function Boardwalk({ world }: { world: WorldModel }) {
  const mats = getMaterials();
  const geos = useMemo(() => {
    const deck = new GeoBuilder();
    const skirt = new GeoBuilder();
    const lane = new GeoBuilder();
    const piles: THREE.Matrix4[] = [];
    for (const d of world.decks) {
      deck.flatPolygon(d.outer, d.holes, DECK_HEIGHT, 2);
      // outward-facing skirt from sand to deck
      const ring = d.outer;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.01) continue;
        const nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
        const outward = !pointInRing((p[0] + q[0]) / 2 + nx * 0.05, (p[1] + q[1]) / 2 + nz * 0.05, ring);
        const [a, b] = outward ? [p, q] : [q, p];
        const ya = Math.min(0, world.terrain.heightAt(a[0], a[1])) - 0.6, yb = Math.min(0, world.terrain.heightAt(b[0], b[1])) - 0.6;
        skirt.quad([[a[0], ya, a[1]], [a[0], DECK_HEIGHT, a[1]], [b[0], DECK_HEIGHT, b[1]], [b[0], yb, b[1]]], [[0, 0], [0, 0.6], [len / 2, 0.6], [len / 2, 0]]);
        // pilings every 3 m along exposed (beach) edges
        for (let t = 0; t < len; t += 3) {
          const x = p[0] + ((q[0] - p[0]) * t) / len, z = p[1] + ((q[1] - p[1]) * t) / len;
          if (world.terrain.heightAt(x, z) < -0.05 || world.terrain.classAt(x, z) === 2) {
            piles.push(new THREE.Matrix4().makeTranslation(x, 0, z));
          }
        }
      }
    }
    // tram lane: two yellow lines along the centreline
    const pts = world.boardwalkLine.map((s) => s.p);
    lane.ribbon(pts, -1.9, -1.75, DECK_HEIGHT + 0.015, 1);
    lane.ribbon(pts, 1.75, 1.9, DECK_HEIGHT + 0.015, 1);

    // ramps and stairs
    const ramps = new GeoBuilder();
    for (const s of world.surfaces.list) {
      if (s.kind === 'deck' || !s.axis) continue;
      const [c0, c1, c2, c3] = s.outer;
      const h = (p: number[]) => WalkableSurfaces.heightOn(s, p[0], p[1]) ?? s.h0;
      if (s.kind === 'ramp') {
        ramps.quad([[c0[0], h(c0) + 0.02, c0[1]], [c3[0], h(c3) + 0.02, c3[1]], [c2[0], h(c2) + 0.02, c2[1]], [c1[0], h(c1) + 0.02, c1[1]]], [[0, 0], [0, 1], [3, 1], [3, 0]]);
      } else {
        const steps = Math.max(2, Math.round((s.h1 - s.h0) / 0.18));
        const { ox, oz, dx, dz, len } = s.axis;
        for (let k = 0; k <= steps; k++) {
          const t0 = (k - 0.5) / steps, t1 = (k + 0.5) / steps;
          const y = s.h0 + ((s.h1 - s.h0) * k) / steps;
          const a = [ox + dx * len * Math.max(0, t0), oz + dz * len * Math.max(0, t0)];
          const b = [ox + dx * len * Math.min(1, t1), oz + dz * len * Math.min(1, t1)];
          ramps.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, y - 0.25, y, 4, len / steps + 0.02, Math.atan2(-dx, dz));
        }
      }
    }
    return { deck: deck.build(), skirt: skirt.build(), lane: lane.build(), ramps: ramps.build(), piles };
  }, [world]);

  const pileMesh = useMemo(() => {
    if (!geos.piles.length) return null;
    const geo = new THREE.CylinderGeometry(0.14, 0.14, 2.6, 6);
    geo.translate(0, -0.3, 0);
    const im = new THREE.InstancedMesh(geo, mats.wood, geos.piles.length);
    geos.piles.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    return im;
  }, [geos, mats]);

  return (
    <group name="boardwalk">
      {geos.deck && <mesh geometry={geos.deck} material={mats.planks} receiveShadow />}
      {geos.skirt && <mesh geometry={geos.skirt} material={mats.wood} />}
      {geos.lane && <mesh geometry={geos.lane} material={mats.markingYellow} />}
      {geos.ramps && <mesh geometry={geos.ramps} material={mats.planks} receiveShadow castShadow />}
      {pileMesh && <primitive object={pileMesh} />}
    </group>
  );
}
