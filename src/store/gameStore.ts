/**
 * Global UI/game state (Zustand). High-frequency values (player position,
 * FPS…) live in the mutable `telemetry` object instead, so that 60 Hz updates
 * don't re-render React; UI polls it at a lower rate.
 */
import { create } from 'zustand';
import type { V2 } from '../world/math/polygon';
import { HOUSING_DEFAULT } from '../data/wildwood/housing';

export type TimePreset = 'morning' | 'afternoon' | 'sunset' | 'evening' | 'night';
export const TIME_PRESETS: Record<TimePreset, number> = {
  morning: 8.5,
  afternoon: 14,
  sunset: 20.1,
  evening: 21.0,
  night: 23,
};

export type WatCategory =
  | 'workplace' | 'supermarket' | 'convenience' | 'pharmacy' | 'laundromat' | 'bus' | 'cheap_food'
  | 'boardwalk' | 'beach' | 'bank' | 'housing';

export const WAT_CATEGORIES: { id: WatCategory; label: string; color: string }[] = [
  { id: 'workplace', label: 'Workplace', color: '#ff3d71' },
  { id: 'housing', label: 'Housing', color: '#00c48c' },
  { id: 'supermarket', label: 'Supermarkets', color: '#3b82f6' },
  { id: 'convenience', label: 'Convenience stores', color: '#8b5cf6' },
  { id: 'pharmacy', label: 'Pharmacies', color: '#ef4444' },
  { id: 'laundromat', label: 'Laundromats', color: '#06b6d4' },
  { id: 'bus', label: 'Bus stops', color: '#f59e0b' },
  { id: 'cheap_food', label: 'Affordable food', color: '#f97316' },
  { id: 'bank', label: 'ATM / Banking', color: '#10b981' },
  { id: 'boardwalk', label: 'Boardwalk', color: '#a0522d' },
  { id: 'beach', label: 'Beach', color: '#eab308' },
];

export interface Destination {
  id: string;
  name: string;
  x: number;
  z: number;
  lat: number;
  lon: number;
}

export interface Settings {
  mouseSensitivity: number;
  invertY: boolean;
  headBob: boolean;
  fov: number;
  drawDistance: number;
  volume: number;
  shadows: boolean;
  bloom: boolean;
  showHud: boolean;
}

export interface Housing {
  lat: number;
  lon: number;
  label: string;
}

interface GameState {
  phase: 'loading' | 'ready' | 'playing' | 'paused' | 'error';
  loadingMsg: string;
  error: string | null;
  mapOpen: boolean;
  settingsOpen: boolean;
  debugOpen: boolean;
  watMode: boolean;
  watCategories: WatCategory[];
  settings: Settings;
  timeOfDay: number; // hours 0–24
  timeAuto: boolean; // advance clock (1 real minute = 1 game hour)
  destination: Destination | null;
  route: V2[] | null;
  routeLength: number | null;
  housing: Housing | null;
  measureA: { lat: number; lon: number } | null;
  measureB: { lat: number; lon: number } | null;
  infoCard: { title: string; lines: string[]; sticky?: boolean } | null;
  interactHint: string | null;

  set: (p: Partial<GameState>) => void;
  setSettings: (p: Partial<Settings>) => void;
  toggleWatCategory: (c: WatCategory) => void;
  setHousing: (h: Housing | null) => void;
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? { ...fallback, ...JSON.parse(s) } : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const defaultSettings: Settings = {
  mouseSensitivity: 1,
  invertY: false,
  headBob: true,
  fov: 70,
  drawDistance: 800,
  volume: 0.7,
  shadows: true,
  bloom: false,
  showHud: true,
};

function initialHousing(): Housing | null {
  try {
    const s = localStorage.getItem('ww.housing');
    if (s) return JSON.parse(s);
  } catch { /* ignore */ }
  if (HOUSING_DEFAULT.houseLatitude != null && HOUSING_DEFAULT.houseLongitude != null) {
    return { lat: HOUSING_DEFAULT.houseLatitude, lon: HOUSING_DEFAULT.houseLongitude, label: HOUSING_DEFAULT.label };
  }
  return null;
}

export const useGame = create<GameState>((set, get) => ({
  phase: 'loading',
  loadingMsg: 'Starting…',
  error: null,
  mapOpen: false,
  settingsOpen: false,
  debugOpen: false,
  watMode: false,
  watCategories: WAT_CATEGORIES.map((c) => c.id),
  settings: loadJSON('ww.settings.v2', defaultSettings),
  timeOfDay: TIME_PRESETS.afternoon,
  timeAuto: false,
  destination: null,
  route: null,
  routeLength: null,
  housing: initialHousing(),
  measureA: null,
  measureB: null,
  infoCard: null,
  interactHint: null,

  set: (p) => set(p),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    saveJSON('ww.settings.v2', settings);
    set({ settings });
  },
  toggleWatCategory: (c) => {
    const cur = get().watCategories;
    set({ watCategories: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
  },
  setHousing: (h) => {
    try {
      if (h) localStorage.setItem('ww.housing', JSON.stringify(h));
      else localStorage.removeItem('ww.housing');
    } catch { /* ignore */ }
    set({ housing: h });
  },
}));

/** Mutable high-frequency state. */
export const telemetry = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  speed: 0,
  mode: 'walk' as 'walk' | 'fast' | 'run',
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  chunks: { loaded: 0, detailed: 0, queued: 0, total: 0 } as { loaded: number; detailed: number; queued: number; total: number; indexMs?: number; avgBaseMs?: number; avgDetailMs?: number },
  surface: 'street' as 'street' | 'boardwalk' | 'sand' | 'grass' | 'water',
  distanceWalked: 0,
  grounded: true,
};
