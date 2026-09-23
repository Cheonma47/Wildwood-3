/**
 * Custom landmark renderers. Each one uses the real OSM footprint (so the
 * position, size and orientation are geographically exact) and adds
 * recognisable details on top.
 *
 * NOTE: exterior colours/signage are best-effort approximations and should be
 * refined against reference photos. Geometry position is from OSM.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { LANDMARKS } from '../../data/wildwood/landmarks';
import { latLonToWorld } from '../geo/projection';
import { centroid, type V2 } from '../math/polygon';
import { GeoBuilder } from '../render/geometry';
import { getMaterials, registerNightMaterial } from '../render/materials';
import { textTexture } from '../render/textures';
import type { Building } from '../data/types';
import type { WorldModel } from '../worldModel';
import { extrude, facadeFacing, onFacade, outwardEdges } from './landmarkUtils';
import { MoreysPier } from './MoreysPiers';

function useSignMaterial(text: string, opts: Parameters<typeof textTexture>[1], night = 1.6) {
  return useMemo(() => {
    const map = textTexture(text, opts);
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.25, roughness: 0.5 });
    registerNightMaterial(m, night);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
}

function nearestRoadPoint(world: WorldModel, p: V2, name: RegExp): V2 {
  let best: V2 = p, bd = Infinity;
  for (const r of world.data.roads) {
    if (!name.test(r.name)) continue;
    for (const q of r.pts) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return best;
}

// --------------------------------------------------------------- Dogtooth
function Dogtooth({ b, world }: { b: Building; world: WorldModel }) {
  const mats = getMaterials();
  const c = centroid(b.outer);
  const taylor = nearestRoadPoint(world, c, /Taylor Avenue/);
  const njave = nearestRoadPoint(world, c, /^New Jersey Avenue/);
  const front = facadeFacing(b.outer, taylor);
  const side = facadeFacing(b.outer, njave);
  const H = 7.4;
  const { walls, trim, roof } = useMemo(() => {
    const walls = new GeoBuilder({ color: true });
    const trim = new GeoBuilder({ color: true });
    const roof = new GeoBuilder({ color: true });
    // two-tone: dark charcoal lower storey, weathered cedar upper storey
    extrude(b.outer, b.baseY - 0.3, b.baseY + 3.6, walls, null, new THREE.Color('#2e3236'));
    extrude(b.outer, b.baseY + 3.6, b.baseY + H, walls, roof, new THREE.Color('#9c7a57'), new THREE.Color('#55585c'));
    // red trim band between storeys and at the roofline
    extrude(b.outer.map(scaleFrom(c, 1.01)), b.baseY + 3.5, b.baseY + 3.85, trim, null, new THREE.Color('#b3261e'));
    extrude(b.outer.map(scaleFrom(c, 1.012)), b.baseY + H - 0.35, b.baseY + H + 0.25, trim, null, new THREE.Color('#b3261e'));
    return { walls: walls.build(), trim: trim.build(), roof: roof.build() };
  }, [b, c]);
  const signMat = useSignMaterial('DOGTOOTH BAR & GRILL', { bg: '#141414', fg: '#ffffff', glow: '#ff4d3d', w: 1024, h: 160 });
  const smallSign = useSignMaterial('DOGTOOTH', { bg: '#b3261e', fg: '#ffffff', w: 512, h: 128 });
  const windowMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#23313b', roughness: 0.15, metalness: 0.4, emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.05 });
    registerNightMaterial(m, 1.1);
    return m;
  }, []);
  const signW = Math.min(front.len * 0.8, 11);
  const winCount = Math.max(2, Math.floor(front.len / 3.2));
  return (
    <group name="Dogtooth Bar & Grill">
      {walls && <mesh geometry={walls} material={mats.vertexColor} castShadow receiveShadow />}
      {trim && <mesh geometry={trim} material={mats.vertexColor} />}
      {roof && <mesh geometry={roof} material={mats.roof} />}
      {/* main sign on the Taylor Ave facade */}
      <mesh {...onFacade(front, 0, b.baseY + 4.9, 0.12)} material={signMat}>
        <planeGeometry args={[signW, signW * 0.156]} />
      </mesh>
      {/* corner blade sign on New Jersey Ave facade */}
      <mesh {...onFacade(side, side.len * 0.3, b.baseY + 5.2, 0.12)} material={smallSign}>
        <planeGeometry args={[4, 1]} />
      </mesh>
      {/* ground-floor windows */}
      {Array.from({ length: winCount }, (_, i) => {
        const u = -front.len / 2 + (i + 0.5) * (front.len / winCount);
        if (Math.abs(u) < 1.4) return null;
        return (
          <mesh key={i} {...onFacade(front, u, b.baseY + 1.7, 0.06)} material={windowMat}>
            <planeGeometry args={[2.2, 1.8]} />
          </mesh>
        );
      })}
      {/* entrance door + awning facing Taylor Ave */}
      <mesh {...onFacade(front, 0, b.baseY + 1.2, 0.07)}>
        <planeGeometry args={[1.8, 2.4]} />
        <meshStandardMaterial color="#5a2d1c" roughness={0.6} />
      </mesh>
      <group {...onFacade(front, 0, b.baseY + 2.8, 0.9)}>
        <mesh rotation={[0.35, 0, 0]}>
          <boxGeometry args={[3.6, 0.08, 1.8]} />
          <meshStandardMaterial color="#b3261e" roughness={0.7} />
        </mesh>
      </group>
      {/* outdoor lights above the door (warm) */}
      <mesh {...onFacade(front, -1.4, b.baseY + 2.6, 0.2)} material={mats.lampGlow}>
        <sphereGeometry args={[0.12, 8, 6]} />
      </mesh>
      <mesh {...onFacade(front, 1.4, b.baseY + 2.6, 0.2)} material={mats.lampGlow}>
        <sphereGeometry args={[0.12, 8, 6]} />
      </mesh>
    </group>
  );
}

function scaleFrom(c: V2, s: number) {
  return (p: V2): V2 => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s];
}

// --------------------------------------------------------------- McDonald's
function McDonalds({ b, world }: { b: Building; world: WorldModel }) {
  const mats = getMaterials();
  const c = centroid(b.outer);
  const park = nearestRoadPoint(world, c, /^Park Boulevard/);
  const front = facadeFacing(b.outer, park);
  const H = 5.2;
  const { walls, band, roof } = useMemo(() => {
    const walls = new GeoBuilder({ color: true });
    const band = new GeoBuilder({ color: true });
    const roof = new GeoBuilder({ color: true });
    extrude(b.outer, b.baseY - 0.3, b.baseY + H - 1.3, walls, null, new THREE.Color('#c9b8a0'));
    // modern grey fascia band with yellow accent
    extrude(b.outer.map(scaleFrom(c, 1.02)), b.baseY + H - 1.3, b.baseY + H, band, roof, new THREE.Color('#3b3d40'), new THREE.Color('#6d6f72'));
    extrude(b.outer.map(scaleFrom(c, 1.025)), b.baseY + H - 1.35, b.baseY + H - 1.2, band, null, new THREE.Color('#ffc72c'));
    return { walls: walls.build(), band: band.build(), roof: roof.build() };
  }, [b, c]);
  const nameSign = useSignMaterial("McDonald's", { bg: '#3b3d40', fg: '#ffffff', w: 512, h: 128 });
  const archSign = useSignMaterial('M', { bg: '#da291c', fg: '#ffc72c', w: 256, h: 256, font: 'Georgia, serif' }, 2.2);
  const glass = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#2a3a45', roughness: 0.1, metalness: 0.5, emissive: new THREE.Color('#fff1c9'), emissiveIntensity: 0.05 });
    registerNightMaterial(m, 1.3);
    return m;
  }, []);
  // pylon sign on the corner lot towards Park Blvd
  const pylon: V2 = [front.mid[0] + front.n[0] * 9 + front.d[0] * (front.len / 2), front.mid[1] + front.n[1] * 9 + front.d[1] * (front.len / 2)];
  const edges = outwardEdges(b.outer);
  return (
    <group name="McDonald's">
      {walls && <mesh geometry={walls} material={mats.vertexColor} castShadow receiveShadow />}
      {band && <mesh geometry={band} material={mats.vertexColor} castShadow />}
      {roof && <mesh geometry={roof} material={mats.roof} />}
      {edges.filter((e) => e.len > 4).map((e, i) => (
        <mesh key={i} {...onFacade(e, 0, b.baseY + 1.6, 0.05)} material={glass}>
          <planeGeometry args={[e.len * 0.7, 2.2]} />
        </mesh>
      ))}
      <mesh {...onFacade(front, 0, b.baseY + H - 0.65, 0.14)} material={nameSign}>
        <planeGeometry args={[5, 1.25]} />
      </mesh>
      <group position={[pylon[0], world.groundAt(pylon[0], pylon[1]), pylon[1]]} rotation={[0, front.yaw, 0]}>
        <mesh position={[0, 5, 0]}>
          <cylinderGeometry args={[0.18, 0.22, 10, 8]} />
          <meshStandardMaterial color="#8d9196" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 11, 0]} material={archSign}>
          <boxGeometry args={[2.8, 2.8, 0.5]} />
        </mesh>
      </group>
    </group>
  );
}

// --------------------------------------------------------------- Convention Center
function ConventionCenter({ b, world }: { b: Building; world: WorldModel }) {
  const mats = getMaterials();
  const c = centroid(b.outer);
  const bw = world.boardwalkEdges.nearest(c[0], c[1], 400);
  const front = facadeFacing(b.outer, bw ? [bw.x, bw.z] : c);
  const H = 17;
  const { walls, glass, roof } = useMemo(() => {
    const walls = new GeoBuilder({ color: true });
    const glass = new GeoBuilder({ color: true });
    const roof = new GeoBuilder({ color: true });
    extrude(b.outer, b.baseY - 0.4, b.baseY + H, walls, roof, new THREE.Color('#e9e6de'), new THREE.Color('#9aa3ab'));
    // blue-green glass band wrapping the building
    extrude(b.outer.map(scaleFrom(c, 1.004)), b.baseY + 6, b.baseY + 11.5, glass, null, new THREE.Color('#2f6f87'));
    return { walls: walls.build(), glass: glass.build(), roof: roof.build() };
  }, [b, c]);
  const sign = useSignMaterial('WILDWOODS CONVENTION CENTER', { bg: '#0f3a5a', fg: '#ffffff', w: 1024, h: 128 });
  const glassMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.6, emissive: new THREE.Color('#bfe3ff'), emissiveIntensity: 0.05 });
    registerNightMaterial(m, 0.6);
    return m;
  }, []);
  return (
    <group name="Wildwoods Convention Center">
      {walls && <mesh geometry={walls} material={mats.vertexColor} castShadow receiveShadow />}
      {glass && <mesh geometry={glass} material={glassMat} />}
      {roof && <mesh geometry={roof} material={mats.roof} />}
      <mesh {...onFacade(front, 0, b.baseY + 13.8, 0.15)} material={sign}>
        <planeGeometry args={[Math.min(front.len * 0.85, 40), Math.min(front.len * 0.85, 40) / 8]} />
      </mesh>
      {/* entrance canopy */}
      <group {...onFacade(front, 0, b.baseY + 4.2, 3)}>
        <mesh>
          <boxGeometry args={[Math.min(front.len * 0.4, 18), 0.4, 6]} />
          <meshStandardMaterial color="#1c5d7a" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

// --------------------------------------------------------------- WILDWOODS sign
function WildwoodsSign({ world }: { world: WorldModel }) {
  const l = LANDMARKS.find((x) => x.id === 'wildwoods-sign')!;
  const p = latLonToWorld(l.latitude, l.longitude);
  const letters = 'WILDWOODS'.split('');
  const colors = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#e53935', '#fb8c00', '#fdd835'];
  const mats = useMemo(() => letters.map((ch, i) => {
    const map = textTexture(ch, { bg: 'rgba(0,0,0,0)', fg: colors[i], w: 256, h: 256, glow: colors[i] });
    const m = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.3, emissiveMap: map, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.2, side: THREE.DoubleSide });
    registerNightMaterial(m, 1.8);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const y = world.terrain.heightAt(p.x, p.z);
  // letters face the boardwalk (NW), line runs along the shore (SW→NE)
  const yaw = Math.atan2(-Math.SQRT1_2, -Math.SQRT1_2);
  return (
    <group position={[p.x, y, p.z]} rotation={[0, yaw, 0]} name="WILDWOODS sign">
      {letters.map((_, i) => (
        <mesh key={i} position={[(i - 4) * 3.1, 2.1, 0]} material={mats[i]}>
          <planeGeometry args={[3.6, 3.6]} />
        </mesh>
      ))}
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[29, 0.3, 1.2]} />
        <meshStandardMaterial color="#d8d2c4" />
      </mesh>
    </group>
  );
}

export function Landmarks({ world }: { world: WorldModel }) {
  const byId = useMemo(() => {
    const m = new Map<string, Building>();
    for (const b of world.buildings) if (b.landmarkId) m.set(b.landmarkId, b);
    return m;
  }, [world]);
  const piers = useMemo(() => LANDMARKS.filter((l) => l.model === 'moreys-pier'), []);
  return (
    <group name="landmarks">
      {byId.get('dogtooth') && <Dogtooth b={byId.get('dogtooth')!} world={world} />}
      {byId.get('mcdonalds') && <McDonalds b={byId.get('mcdonalds')!} world={world} />}
      {byId.get('convention-center') && <ConventionCenter b={byId.get('convention-center')!} world={world} />}
      <WildwoodsSign world={world} />
      {piers.map((l) => {
        const area = world.data.areas.find((a) => a.id === l.osmAreaId);
        return area ? <MoreysPier key={l.id} landmark={l} area={area} world={world} /> : null;
      })}
    </group>
  );
}
