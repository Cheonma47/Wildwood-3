/**
 * Full-screen map (M): pan/zoom, landmarks, WAT Mode overlay, destination
 * selection with real walking distance + time, and the developer distance
 * validation tool.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LANDMARKS } from '../../data/wildwood/landmarks';
import { useGame, telemetry, WAT_CATEGORIES } from '../../store/gameStore';
import { yawToHeading } from '../../world/geo/coordinates';
import {
  distanceMeters, formatDistance, formatDuration, geodesicDistance, walkingTimeSeconds, FAST_WALK_SPEED, RUN_SPEED,
} from '../../world/geo/distance';
import { latLonToWorld, worldToLatLon } from '../../world/geo/projection';
import type { V2 } from '../../world/math/polygon';
import type { WorldModel } from '../../world/worldModel';
import { MapRenderer, type MapView, type Marker } from './mapRenderer';
import { requestLock } from '../../player/FirstPersonController';

interface Selection {
  marker: Marker;
  straight: number;
  route: number | null;
  routePts: V2[] | null;
}

export function MapScreen({ world }: { world: WorldModel }) {
  const open = useGame((s) => s.mapOpen);
  const wat = useGame((s) => s.watMode);
  const cats = useGame((s) => s.watCategories);
  const housing = useGame((s) => s.housing);
  const destination = useGame((s) => s.destination);
  const route = useGame((s) => s.route);
  const set = useGame((s) => s.set);
  const toggleCat = useGame((s) => s.toggleWatCategory);
  const renderer = useMemo(() => new MapRenderer(world), [world]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<MapView>({ cx: telemetry.x, cz: telemetry.z, scale: 0.6 });
  const [sel, setSel] = useState<Selection | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measure, setMeasure] = useState<V2[]>([]);
  const drag = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (open) setView((v) => ({ ...v, cx: telemetry.x, cz: telemetry.z }));
  }, [open]);

  const markers = useMemo(
    () => renderer.markers({ wat, cats, housing, destination, minPriority: view.scale > 0.35 ? 2 : 1 }),
    [renderer, wat, cats, housing, destination, view.scale],
  );

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    renderer.draw(ctx, view, w, h, {
      player: { x: telemetry.x, z: telemetry.z, heading: yawToHeading(telemetry.yaw) },
      route: sel?.routePts ?? route,
      markers,
      selected: sel?.marker.id ?? null,
      measure,
      watBoardwalkBeach: wat && cats.includes('boardwalk'),
      dpr,
    });
  }, [renderer, view, markers, sel, route, measure, wat, cats]);

  useEffect(() => {
    if (!open) return;
    draw();
    const id = window.setInterval(draw, 250);
    window.addEventListener('resize', draw);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', draw);
    };
  }, [open, draw]);

  const select = (m: Marker) => {
    const from: V2 = [telemetry.x, telemetry.z];
    const straight = distanceMeters({ x: from[0], z: from[1] }, { x: m.x, z: m.z });
    const r = world.graph.route(from, [m.x, m.z]);
    setSel({ marker: m, straight, route: r?.length ?? null, routePts: r?.points ?? null });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, cx: d.cx - dx / v.scale, cz: d.cz - dy / v.scale }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wz] = renderer.toWorld(view, c.clientWidth, c.clientHeight, sx, sy);
    if (measureMode) {
      setMeasure((m) => (m.length >= 2 ? [[wx, wz]] : [...m, [wx, wz]]));
      return;
    }
    // hit-test markers
    let best: Marker | null = null, bd = 14;
    for (const m of markers) {
      const [mx, my] = renderer.toScreen(view, c.clientWidth, c.clientHeight, m.x, m.z);
      const d2 = Math.hypot(mx - sx, my - sy);
      if (d2 < bd) { bd = d2; best = m; }
    }
    if (best) select(best);
    else {
      const g = worldToLatLon(wx, wz);
      const street = world.nearestStreet(wx, wz);
      select({ id: `pin-${wx.toFixed(0)}-${wz.toFixed(0)}`, name: street ? `Pin near ${street.name}` : 'Dropped pin', x: wx, z: wz, color: '#00e5ff', size: 6, kind: 'pin', lat: g.lat, lon: g.lon });
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wz] = renderer.toWorld(view, c.clientWidth, c.clientHeight, sx, sy);
    const f = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(8, Math.max(0.08, view.scale * f));
    // keep the point under the cursor fixed
    setView({ scale, cx: wx - (sx - c.clientWidth / 2) / scale, cz: wz - (sy - c.clientHeight / 2) / scale });
  };

  if (!open) return null;

  const measureInfo = measure.length === 2 ? (() => {
    const a = worldToLatLon(measure[0][0], measure[0][1]);
    const b = worldToLatLon(measure[1][0], measure[1][1]);
    const real = geodesicDistance(a, b);
    const game = distanceMeters({ x: measure[0][0], z: measure[0][1] }, { x: measure[1][0], z: measure[1][1] });
    return { a, b, real, game, diff: game - real, err: Math.abs(game - real) / real };
  })() : null;

  // scale bar
  const barM = [50, 100, 200, 500, 1000, 2000].find((m) => m * view.scale > 80) ?? 2000;

  return (
    <div className="overlay map-screen" onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvas}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: measureMode ? 'crosshair' : 'grab' }}
      />
      <div className="map-topbar">
        <strong>Wildwood, NJ</strong>
        <span className="muted">1 game metre = 1 real metre · drag to pan · scroll to zoom · click a marker</span>
        <button onClick={() => setView((v) => ({ ...v, cx: telemetry.x, cz: telemetry.z }))}>Center on me</button>
        <button className={wat ? 'on' : ''} onClick={() => set({ watMode: !wat })}>WAT Mode</button>
        <button className={measureMode ? 'on' : ''} onClick={() => { setMeasureMode(!measureMode); setMeasure([]); }}>Measure</button>
        <button onClick={() => { set({ mapOpen: false }); requestLock(); }}>Close (M)</button>
      </div>
      <div className="scale-bar" style={{ width: barM * view.scale }}>
        <span>{formatDistance(barM)}</span>
      </div>

      <div className="map-side">
        {sel && (
          <div className="card">
            <div className="card-title">{sel.marker.name}</div>
            <div className="muted small">{sel.marker.lat.toFixed(6)}, {sel.marker.lon.toFixed(6)}</div>
            <table className="kv">
              <tbody>
                <tr><td>Walking route</td><td>{sel.route != null ? formatDistance(sel.route) : '—'}</td></tr>
                <tr><td>Straight line</td><td>{formatDistance(sel.straight)}</td></tr>
                <tr><td>Walk (1.4 m/s)</td><td><b>{formatDuration(walkingTimeSeconds(sel.route ?? sel.straight))}</b></td></tr>
                <tr><td>Fast walk (2.0 m/s)</td><td>{formatDuration(walkingTimeSeconds(sel.route ?? sel.straight, FAST_WALK_SPEED))}</td></tr>
                <tr><td>Run (4.5 m/s)</td><td>{formatDuration(walkingTimeSeconds(sel.route ?? sel.straight, RUN_SPEED))}</td></tr>
              </tbody>
            </table>
            <div className="row">
              <button className="primary" onClick={() => { set({ destination: { id: sel.marker.id, name: sel.marker.name, x: sel.marker.x, z: sel.marker.z, lat: sel.marker.lat, lon: sel.marker.lon }, mapOpen: false }); requestLock(); }}>
                Set destination
              </button>
              {sel.marker.kind === 'pin' && (
                <button onClick={() => useGame.getState().setHousing({ lat: sel.marker.lat, lon: sel.marker.lon, label: 'My W&T Housing' })}>Set as my housing</button>
              )}
            </div>
            <div className="muted small">Navigation never teleports you – walk the route yourself.</div>
          </div>
        )}
        {destination && (
          <div className="card">
            <div className="card-title">Destination: {destination.name}</div>
            <button onClick={() => set({ destination: null })}>Clear destination</button>
          </div>
        )}
        {wat && (
          <div className="card">
            <div className="card-title">WAT Mode – useful places</div>
            {WAT_CATEGORIES.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggleCat(c.id)} />
                <span className="dot" style={{ background: c.color }} /> {c.label}
              </label>
            ))}
            {!housing && <div className="muted small">Tip: click the map where your housing is and choose “Set as my housing”, or enter coordinates in Settings.</div>}
            <div className="muted small">Places come from OpenStreetMap and may be incomplete.</div>
          </div>
        )}
        {measureMode && (
          <div className="card">
            <div className="card-title">Distance validation tool</div>
            {measure.length < 2 && <div className="muted">Click point {measure.length === 0 ? 'A' : 'B'} on the map.</div>}
            {measureInfo && (
              <table className="kv">
                <tbody>
                  <tr><td>Location A</td><td>{measureInfo.a.lat.toFixed(6)}, {measureInfo.a.lon.toFixed(6)}</td></tr>
                  <tr><td>Location B</td><td>{measureInfo.b.lat.toFixed(6)}, {measureInfo.b.lon.toFixed(6)}</td></tr>
                  <tr><td>Real geographic distance</td><td>{measureInfo.real.toFixed(2)} m</td></tr>
                  <tr><td>Game-world distance</td><td>{measureInfo.game.toFixed(2)} m</td></tr>
                  <tr><td>Difference</td><td>{measureInfo.diff >= 0 ? '+' : ''}{measureInfo.diff.toFixed(3)} m</td></tr>
                  <tr><td>Scale error</td><td className={measureInfo.err < 0.02 ? 'ok' : 'bad'}>{(measureInfo.err * 100).toFixed(4)} %</td></tr>
                </tbody>
              </table>
            )}
            <ValidationTable />
          </div>
        )}
        <div className="card legend">
          <div><span className="dot" style={{ background: '#ff3d71' }} /> Workplace</div>
          <div><span className="dot" style={{ background: '#b3a38f' }} /> Real OSM buildings</div>
          <div><span className="dot" style={{ background: '#cdbfae' }} /> Microsoft building footprints</div>
          <div className="muted small">Map data © OpenStreetMap contributors · Microsoft Building Footprints (ODbL) · Overture Maps</div>
        </div>
      </div>
    </div>
  );
}

/** Real vs game distance between fixed landmark pairs (Vincenty on WGS84 vs projected world metres). */
export function ValidationTable() {
  const rows = useMemo(() => {
    const ids: [string, string][] = [
      ['dogtooth', 'mcdonalds'], ['dogtooth', 'boardwalk-taylor'], ['dogtooth', 'convention-center'],
      ['dogtooth', 'moreys-mariners'], ['mcdonalds', 'moreys-surfside'], ['convention-center', 'moreys-surfside'],
    ];
    return ids.map(([a, b]) => {
      const A = LANDMARKS.find((l) => l.id === a)!, B = LANDMARKS.find((l) => l.id === b)!;
      const real = geodesicDistance({ lat: A.latitude, lon: A.longitude }, { lat: B.latitude, lon: B.longitude });
      const wa = latLonToWorld(A.latitude, A.longitude), wb = latLonToWorld(B.latitude, B.longitude);
      const game = distanceMeters(wa, wb);
      return { a: A.name, b: B.name, real, game, err: Math.abs(game - real) / real };
    });
  }, []);
  return (
    <table className="kv small">
      <thead><tr><td>Pair</td><td>Real</td><td>Game</td><td>Error</td></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.a + r.b}>
            <td>{r.a.split(' ')[0]} → {r.b.split(' ')[0]}</td>
            <td>{r.real.toFixed(1)} m</td>
            <td>{r.game.toFixed(1)} m</td>
            <td className={r.err < 0.02 ? 'ok' : 'bad'}>{(r.err * 100).toFixed(3)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
