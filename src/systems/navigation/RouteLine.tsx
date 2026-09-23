/**
 * Draws the walking route (following real streets/sidewalks) and a tall
 * beacon at the destination. The route is re-planned from the player's
 * position every few seconds – no teleporting, you walk it yourself.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame, telemetry } from '../../store/gameStore';
import { GeoBuilder } from '../../world/render/geometry';
import type { V2 } from '../../world/math/polygon';
import type { WorldModel } from '../../world/worldModel';
import { latLonToWorld } from '../../world/geo/projection';

export function planRoute(world: WorldModel, from: V2, to: V2): { points: V2[]; length: number } | null {
  return world.graph.route(from, to);
}

export function RouteLine({ world }: { world: WorldModel }) {
  const destination = useGame((s) => s.destination);
  const route = useGame((s) => s.route);
  const timer = useRef(0);

  useEffect(() => {
    if (!destination) {
      useGame.setState({ route: null, routeLength: null });
      return;
    }
    const r = planRoute(world, [telemetry.x, telemetry.z], [destination.x, destination.z]);
    useGame.setState({ route: r?.points ?? null, routeLength: r?.length ?? null });
  }, [destination, world]);

  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 3 || !destination) return;
    timer.current = 0;
    const r = planRoute(world, [telemetry.x, telemetry.z], [destination.x, destination.z]);
    useGame.setState({ route: r?.points ?? null, routeLength: r?.length ?? null });
    const arrived = Math.hypot(destination.x - telemetry.x, destination.z - telemetry.z) < 15;
    if (arrived) {
      useGame.setState({
        destination: null,
        infoCard: { title: `Arrived: ${destination.name}`, lines: ['You walked there at real-world scale.'], sticky: true },
      });
    }
  });

  const geo = useMemo(() => {
    if (!route || route.length < 2) return null;
    // resample so the ribbon hugs the ground
    const pts: V2[] = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(d / 4));
      for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    pts.push(route[route.length - 1]);
    const g = new GeoBuilder();
    g.ribbon(pts, -0.35, 0.35, 0, 3, undefined, (x, z) => world.groundAt(x, z) + 0.25);
    return g.build();
  }, [route, world]);

  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#00e5ff', transparent: true, opacity: 0.75, depthWrite: false }), []);
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#00e5ff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }), []);
  useFrame(({ clock }) => {
    mat.opacity = 0.55 + Math.sin(clock.elapsedTime * 3) * 0.2;
  });

  return (
    <group name="route">
      {geo && <mesh geometry={geo} material={mat} renderOrder={5} />}
      {destination && (
        <mesh position={[destination.x, world.groundAt(destination.x, destination.z) + 40, destination.z]} material={beaconMat} renderOrder={6}>
          <cylinderGeometry args={[1.5, 1.5, 80, 16, 1, true]} />
        </mesh>
      )}
      <HousingMarker world={world} />
    </group>
  );
}

function HousingMarker({ world }: { world: WorldModel }) {
  const housing = useGame((s) => s.housing);
  if (!housing) return null;
  const p = latLonToWorld(housing.lat, housing.lon);
  const y = world.groundAt(p.x, p.z);
  return (
    <group position={[p.x, y, p.z]} name="housing marker">
      <mesh position={[0, 20, 0]}>
        <cylinderGeometry args={[0.8, 0.8, 40, 12, 1, true]} />
        <meshBasicMaterial color="#00c48c" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2, 2.6, 32]} />
        <meshBasicMaterial color="#00c48c" />
      </mesh>
    </group>
  );
}
