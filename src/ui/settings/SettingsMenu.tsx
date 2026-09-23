/** ESC menu: settings, time of day, housing coordinates, controls. */
import { useState } from 'react';
import { useGame, TIME_PRESETS, type TimePreset } from '../../store/gameStore';
import { audio } from '../../systems/audio/ambientAudio';
import { formatClock } from '../../systems/time/sun';
import { PLAYABLE_BOUNDS } from '../../world/geo/coordinates';
import { requestLock } from '../../player/FirstPersonController';
import { latLonToWorld } from '../../world/geo/projection';

export function SettingsMenu() {
  const open = useGame((s) => s.settingsOpen);
  const settings = useGame((s) => s.settings);
  const setSettings = useGame((s) => s.setSettings);
  const timeOfDay = useGame((s) => s.timeOfDay);
  const timeAuto = useGame((s) => s.timeAuto);
  const housing = useGame((s) => s.housing);
  const setHousing = useGame((s) => s.setHousing);
  const set = useGame((s) => s.set);
  const [lat, setLat] = useState(housing ? String(housing.lat) : '');
  const [lon, setLon] = useState(housing ? String(housing.lon) : '');
  const [hErr, setHErr] = useState('');
  if (!open) return null;

  const resume = () => {
    set({ settingsOpen: false });
    requestLock();
  };
  const saveHousing = () => {
    const la = parseFloat(lat), lo = parseFloat(lon);
    const b = PLAYABLE_BOUNDS;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return setHErr('Enter decimal degrees, e.g. 38.98712 and -74.82105');
    if (la < b.south || la > b.north || lo < b.west || lo > b.east) return setHErr('That point is outside the Wildwood map area.');
    setHErr('');
    setHousing({ lat: la, lon: lo, label: 'My W&T Housing' });
  };

  return (
    <div className="overlay menu">
      <div className="menu-panel">
        <h2>Paused</h2>
        <button className="primary wide" onClick={resume}>Resume walking</button>

        <h3>Time of day</h3>
        <div className="row wrap">
          {(Object.keys(TIME_PRESETS) as TimePreset[]).map((p) => (
            <button key={p} className={Math.abs(TIME_PRESETS[p] - timeOfDay) < 0.05 ? 'on' : ''} onClick={() => set({ timeOfDay: TIME_PRESETS[p] })}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <label className="slider">Clock {formatClock(timeOfDay)}
          <input type="range" min={0} max={23.99} step={0.05} value={timeOfDay} onChange={(e) => set({ timeOfDay: +e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={timeAuto} onChange={(e) => set({ timeAuto: e.target.checked })} /> Advance time (1 real minute = 1 hour)</label>

        <h3>Controls & view</h3>
        <label className="slider">Mouse sensitivity {settings.mouseSensitivity.toFixed(2)}
          <input type="range" min={0.2} max={3} step={0.05} value={settings.mouseSensitivity} onChange={(e) => setSettings({ mouseSensitivity: +e.target.value })} />
        </label>
        <label className="slider">Field of view {settings.fov}°
          <input type="range" min={50} max={100} step={1} value={settings.fov} onChange={(e) => setSettings({ fov: +e.target.value })} />
        </label>
        <label className="slider">Draw distance {settings.drawDistance} m
          <input type="range" min={400} max={2000} step={50} value={settings.drawDistance} onChange={(e) => setSettings({ drawDistance: +e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={settings.invertY} onChange={(e) => setSettings({ invertY: e.target.checked })} /> Invert mouse Y</label>
        <label className="check"><input type="checkbox" checked={settings.headBob} onChange={(e) => setSettings({ headBob: e.target.checked })} /> Head bob</label>
        <label className="check"><input type="checkbox" checked={settings.shadows} onChange={(e) => setSettings({ shadows: e.target.checked })} /> Shadows</label>
        <label className="check"><input type="checkbox" checked={settings.bloom} onChange={(e) => setSettings({ bloom: e.target.checked })} /> Night glow (bloom)</label>
        <label className="check"><input type="checkbox" checked={settings.showHud} onChange={(e) => setSettings({ showHud: e.target.checked })} /> Show HUD</label>
        <label className="slider">Volume {Math.round(settings.volume * 100)}%
          <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => { setSettings({ volume: +e.target.value }); audio.setVolume(+e.target.value); }} />
        </label>

        <h3>Work & Travel housing</h3>
        <div className="muted small">Enter your housing coordinates (right-click the building in Google Maps/OSM to copy them). A green marker appears at the exact location and the map shows walking distances from it.</div>
        <div className="row">
          <input placeholder="houseLatitude e.g. 38.98712" value={lat} onChange={(e) => setLat(e.target.value)} />
          <input placeholder="houseLongitude e.g. -74.82105" value={lon} onChange={(e) => setLon(e.target.value)} />
        </div>
        <div className="row">
          <button onClick={saveHousing}>Save housing</button>
          {housing && <button onClick={() => { setHousing(null); setLat(''); setLon(''); }}>Remove</button>}
          {housing && <button onClick={() => set({ destination: { id: 'housing', name: housing.label, lat: housing.lat, lon: housing.lon, ...toWorld(housing.lat, housing.lon) }, settingsOpen: false })}>Navigate home</button>}
        </div>
        {hErr && <div className="bad small">{hErr}</div>}

        <h3>Controls</h3>
        <div className="controls-grid small">
          <span>W A S D</span><span>Move (1.4 m/s)</span>
          <span>Shift</span><span>Run (4.5 m/s)</span>
          <span>C</span><span>Toggle fast walk (2.0 m/s)</span>
          <span>Space</span><span>Small jump</span>
          <span>M</span><span>Map</span>
          <span>F</span><span>Interact / info</span>
          <span>T</span><span>Next time-of-day preset</span>
          <span>F3</span><span>Debug info</span>
          <span>Esc</span><span>This menu</span>
        </div>
        <div className="muted small">Map data © OpenStreetMap contributors (ODbL). All sounds are synthesised in the browser.</div>
      </div>
    </div>
  );
}

function toWorld(lat: number, lon: number) {
  return latLonToWorld(lat, lon);
}
