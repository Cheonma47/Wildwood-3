/** In-game HUD: compass, street, clock, destination panel, minimap, hints. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, telemetry } from '../../store/gameStore';
import { headingToCompass, yawToHeading } from '../../world/geo/coordinates';
import { formatDistance, formatDuration, walkingTimeSeconds } from '../../world/geo/distance';
import { formatClock } from '../../systems/time/sun';
import type { WorldModel } from '../../world/worldModel';
import { MapRenderer } from '../map/mapRenderer';

function usePoll<T>(fn: () => T, ms: number): T {
  const [v, setV] = useState(fn);
  useEffect(() => {
    const id = window.setInterval(() => setV(fn()), ms);
    return () => window.clearInterval(id);
  }, [fn, ms]);
  return v;
}

const pollPose = () => ({ x: telemetry.x, z: telemetry.z, heading: yawToHeading(telemetry.yaw), speed: telemetry.speed, mode: telemetry.mode });

export function Hud({ world }: { world: WorldModel }) {
  const phase = useGame((s) => s.phase);
  const showHud = useGame((s) => s.settings.showHud);
  const destination = useGame((s) => s.destination);
  const routeLength = useGame((s) => s.routeLength);
  const timeOfDay = useGame((s) => s.timeOfDay);
  const hint = useGame((s) => s.interactHint);
  const infoCard = useGame((s) => s.infoCard);
  const mapOpen = useGame((s) => s.mapOpen);
  const pose = usePoll(pollPose, 150);
  const street = useMemo(() => world.nearestStreet(pose.x, pose.z)?.name ?? '', [world, Math.round(pose.x / 3), Math.round(pose.z / 3)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!infoCard?.sticky) return;
    const id = window.setTimeout(() => useGame.setState({ infoCard: null }), 7000);
    return () => window.clearTimeout(id);
  }, [infoCard]);

  if (phase !== 'playing' && phase !== 'paused') return null;
  if (!showHud || mapOpen) return null;

  let destInfo = null as null | { dist: number; rel: number };
  if (destination) {
    const dx = destination.x - pose.x, dz = destination.z - pose.z;
    const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    destInfo = { dist: routeLength ?? Math.hypot(dx, dz), rel: bearing - pose.heading };
  }

  return (
    <div className="hud">
      <Compass heading={pose.heading} destRel={destInfo?.rel ?? null} />
      <div className="hud-tl">
        <div className="street">{street || '—'}</div>
        <div className="muted">{formatClock(timeOfDay)} · {headingToCompass(pose.heading)} {Math.round(pose.heading)}°</div>
      </div>
      <div className="hud-bl">
        <div className={`mode mode-${pose.mode}`}>{pose.mode === 'run' ? 'RUN' : pose.mode === 'fast' ? 'FAST WALK' : 'WALK'}</div>
        <div>{pose.speed.toFixed(1)} m/s · {(pose.speed * 3.6).toFixed(1)} km/h</div>
        <div className="muted small">Shift run · C fast walk · M map · F interact · T time · F3 debug · Esc menu</div>
      </div>
      {destination && destInfo && (
        <div className="hud-tr card">
          <div className="muted small">Destination</div>
          <div className="card-title">{destination.name}</div>
          <div className="big">{formatDistance(destInfo.dist)}</div>
          <div>≈ {formatDuration(walkingTimeSeconds(destInfo.dist))} walking</div>
          <div className="arrow" style={{ transform: `rotate(${destInfo.rel}deg)` }}>▲</div>
        </div>
      )}
      <Minimap world={world} x={pose.x} z={pose.z} heading={pose.heading} />
      <div className="crosshair" />
      {hint && !infoCard && <div className="hint">{hint}</div>}
      {infoCard && (
        <div className="info-card card">
          <div className="card-title">{infoCard.title}</div>
          {infoCard.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

function Compass({ heading, destRel }: { heading: number; destRel: number | null }) {
  const marks = [];
  for (let d = -90; d <= 90; d += 15) {
    const h = (((heading + d) % 360) + 360) % 360;
    const snapped = Math.round(h / 15) * 15;
    const off = (snapped - heading + 540) % 360 - 180;
    const label = snapped % 90 === 0 ? ['N', 'E', 'S', 'W'][snapped / 90 % 4] : snapped % 45 === 0 ? ['NE', 'SE', 'SW', 'NW'][Math.floor(snapped / 90) % 4] : '·';
    marks.push(<span key={d} style={{ left: `${50 + (off / 90) * 50}%` }} className={label.length && label !== '·' ? 'cardinal' : ''}>{label}</span>);
  }
  const rel = destRel === null ? null : ((destRel + 540) % 360) - 180;
  return (
    <div className="compass">
      {marks}
      {rel !== null && Math.abs(rel) <= 90 && <span className="dest-mark" style={{ left: `${50 + (rel / 90) * 50}%` }}>◆</span>}
      <div className="compass-center" />
    </div>
  );
}

function Minimap({ world, x, z, heading }: { world: WorldModel; x: number; z: number; heading: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(() => new MapRenderer(world), [world]);
  const route = useGame((s) => s.route);
  const destination = useGame((s) => s.destination);
  const housing = useGame((s) => s.housing);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext('2d')!;
    const markers = renderer.markers({ wat: false, cats: [], housing, destination, minPriority: 1 });
    renderer.draw(ctx, { cx: x, cz: z, scale: 0.9 }, w, h, { player: { x, z, heading }, route, markers, labels: true, dpr });
  }, [renderer, x, z, heading, route, destination, housing]);
  return <canvas ref={ref} className="minimap" />;
}
