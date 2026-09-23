/** F3 debug overlay: geographic + performance information. */
import { useEffect, useState } from 'react';
import { DOGTOOTH } from '../../data/wildwood/landmarks';
import { useGame, telemetry } from '../../store/gameStore';
import { geodesicDistance } from '../../world/geo/distance';
import { worldToLatLon } from '../../world/geo/projection';
import { yawToHeading } from '../../world/geo/coordinates';
import type { WorldModel } from '../../world/worldModel';

export function DebugOverlay({ world }: { world: WorldModel }) {
  const open = useGame((s) => s.debugOpen);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => tick((t) => t + 1), 200);
    return () => window.clearInterval(id);
  }, [open]);
  if (!open) return null;
  const g = worldToLatLon(telemetry.x, telemetry.z);
  const dDog = geodesicDistance(g, { lat: DOGTOOTH.latitude, lon: DOGTOOTH.longitude });
  const street = world.nearestStreet(telemetry.x, telemetry.z);
  const c = telemetry.chunks;
  return (
    <div className="debug">
      <div className="debug-title">DEBUG (F3)</div>
      <Row k="Latitude" v={g.lat.toFixed(7)} />
      <Row k="Longitude" v={g.lon.toFixed(7)} />
      <Row k="World X" v={`${telemetry.x.toFixed(2)} m`} />
      <Row k="World Z" v={`${telemetry.z.toFixed(2)} m`} />
      <Row k="Feet height (y)" v={`${telemetry.y.toFixed(2)} m`} />
      <Row k="Heading" v={`${yawToHeading(telemetry.yaw).toFixed(1)}°`} />
      <Row k="Walking speed" v={`${telemetry.speed.toFixed(2)} m/s (${telemetry.mode})`} />
      <Row k="Distance from Dogtooth" v={`${dDog.toFixed(1)} m`} />
      <Row k="Current street" v={street?.name ?? '—'} />
      <Row k="Surface" v={telemetry.surface} />
      <Row k="Distance walked" v={`${telemetry.distanceWalked.toFixed(0)} m`} />
      <Row k="FPS" v={`${telemetry.fps.toFixed(0)} (${telemetry.frameMs.toFixed(1)} ms)`} />
      <Row k="Loaded chunks" v={`${c.loaded} / ${c.total} (detail ${c.detailed}${c.queued ? `, queued ${c.queued}` : ''})`} />
      <Row k="Chunk build (avg)" v={`base ${(c.avgBaseMs ?? 0).toFixed(1)} ms · detail ${(c.avgDetailMs ?? 0).toFixed(1)} ms · index ${(c.indexMs ?? 0).toFixed(0)} ms`} />
      <Row k="Draw calls" v={String(telemetry.drawCalls)} />
      <Row k="Triangles" v={`${(telemetry.triangles / 1000).toFixed(0)} k`} />
      <Row k="Buildings" v={`${world.stats.osmBuildings} OSM + ${world.stats.proceduralBuildings} procedural`} />
      <Row k="World build" v={`${world.stats.buildMs.toFixed(0)} ms`} />
      <div className="muted small">Scale: 1 unit = 1 m · projection origin 38.985°N, 74.815°W</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="debug-row">
      <span>{k}:</span>
      <b>{v}</b>
    </div>
  );
}
