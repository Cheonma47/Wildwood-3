/**
 * Procedural environmental audio (Web Audio API) – no recorded or
 * copyrighted material. Zones cross-fade by player location:
 *  - Beach: surf (modulated brown noise), wind, seagull calls
 *  - Boardwalk: crowd murmur, arcade blips, ride rumble, tram horn chirps
 *  - Residential streets: birds, light wind, distant traffic
 */
import { TerrainClass } from '../../world/terrain/heightfield';
import type { WorldModel } from '../../world/worldModel';

type Surface = 'street' | 'boardwalk' | 'sand' | 'grass' | 'water';

class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private zones: Record<'surf' | 'wind' | 'crowd' | 'traffic' | 'birds', GainNode> | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private mix = { beach: 0, boardwalk: 0, city: 1 };
  private timers: number[] = [];

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  resume() {
    if (!this.ctx) this.init();
    void this.ctx?.resume();
  }

  private init() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // 4 s of white noise, reused everywhere
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const loopNoise = (filterType: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.5;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f);
      src.start();
      return f;
    };
    const zone = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master!);
      return g;
    };
    this.zones = { surf: zone(), wind: zone(), crowd: zone(), traffic: zone(), birds: zone() };

    // Surf: low-passed noise with slow swell LFO
    const surf = loopNoise('lowpass', 600, 0.5);
    const surfAmp = ctx.createGain();
    surfAmp.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.45;
    lfo.connect(lfoGain).connect(surfAmp.gain);
    lfo.start();
    surf.connect(surfAmp).connect(this.zones.surf);
    // Wind: band-passed noise with slow wander
    const wind = loopNoise('bandpass', 400, 0.6);
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.05;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 200;
    windLfo.connect(windLfoGain).connect((wind as BiquadFilterNode).frequency);
    windLfo.start();
    const windAmp = ctx.createGain();
    windAmp.gain.value = 0.25;
    wind.connect(windAmp).connect(this.zones.wind);
    // Crowd murmur: several formant-ish band-passed noises
    for (const f of [300, 520, 850, 1300]) {
      const n = loopNoise('bandpass', f, 3);
      const g = ctx.createGain();
      g.gain.value = 0.18;
      const mod = ctx.createOscillator();
      mod.frequency.value = 0.3 + Math.random() * 0.8;
      const mg = ctx.createGain();
      mg.gain.value = 0.1;
      mod.connect(mg).connect(g.gain);
      mod.start();
      n.connect(g).connect(this.zones.crowd);
    }
    // Distant traffic: deep rumble
    const traffic = loopNoise('lowpass', 180, 0.7);
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    traffic.connect(tg).connect(this.zones.traffic);

    // Event sounds
    this.timers.push(window.setInterval(() => this.maybeGull(), 2300));
    this.timers.push(window.setInterval(() => this.maybeBird(), 900));
    this.timers.push(window.setInterval(() => this.maybeArcade(), 1300));
  }

  private tone(freqs: [number, number], dur: number, type: OscillatorType, gain: number, dest: AudioNode, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freqs[0], t);
    o.frequency.exponentialRampToValueAtTime(freqs[1], t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private maybeGull() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = this.mix.beach * 0.6 + this.mix.boardwalk * 0.25;
    if (Math.random() > p) return;
    const base = 900 + Math.random() * 500;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone([base * 1.3, base * 0.7], 0.28, 'sawtooth', 0.035, this.master!, i * 0.32);
  }

  private maybeBird() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (Math.random() > this.mix.city * 0.35) return;
    const base = 2500 + Math.random() * 2000;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone([base, base * (1.2 + Math.random() * 0.3)], 0.09, 'sine', 0.02, this.master!, i * 0.12);
  }

  private maybeArcade() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (Math.random() > this.mix.boardwalk * 0.55) return;
    const notes = [523, 659, 784, 1046, 880, 698];
    const n = 3 + Math.floor(Math.random() * 4);
    const start = Math.floor(Math.random() * notes.length);
    for (let i = 0; i < n; i++) {
      const f = notes[(start + i * 2) % notes.length];
      this.tone([f, f], 0.08, 'square', 0.008, this.master!, i * 0.09);
    }
  }

  /** Smoothly updates the zone mix from the player position. */
  updateZone(world: WorldModel, x: number, z: number, y: number) {
    if (!this.ctx || !this.zones) return;
    const dBw = world.distToBoardwalk(x, z);
    const onDeck = world.isOnDeck(x, z) && y > 0.6;
    const cls = world.terrain.classAt(x, z);
    const onBeach = cls === TerrainClass.Beach || cls === TerrainClass.Water;
    // distance to ocean approx via terrain height: lower = closer to water
    const h = world.terrain.heightAt(x, z);
    const nearWater = onBeach ? Math.min(1, 0.45 + (-h) * 0.7) : Math.max(0, 1 - dBw / 250) * 0.35;
    const boardwalk = onDeck ? 1 : Math.max(0, 1 - dBw / 120);
    const beach = onBeach ? 1 : 0;
    const city = Math.max(0, 1 - boardwalk - beach * 0.8);
    this.mix = { beach, boardwalk, city };
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 1.2);
    set(this.zones.surf, 0.12 + nearWater * 0.9);
    set(this.zones.wind, 0.2 + beach * 0.35);
    set(this.zones.crowd, boardwalk * 0.55);
    set(this.zones.traffic, city * 0.25);
    set(this.zones.birds, city * 0.3);
  }

  footstep(surface: Surface, run: boolean) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const cfg: Record<Surface, [BiquadFilterType, number, number, number]> = {
      street: ['bandpass', 1800, 1.2, 0.09],
      boardwalk: ['bandpass', 420, 2.5, 0.22],
      sand: ['lowpass', 900, 0.6, 0.07],
      grass: ['highpass', 2500, 0.7, 0.04],
      water: ['lowpass', 700, 0.8, 0.12],
    };
    const [type, freq, q, vol] = cfg[surface];
    f.type = type;
    f.frequency.value = freq * (0.9 + Math.random() * 0.2);
    f.Q.value = q;
    const dur = surface === 'sand' ? 0.16 : 0.07;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * (run ? 1.4 : 1), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 3, dur + 0.05);
    if (surface === 'boardwalk') {
      // hollow wooden knock
      this.tone([140, 90], 0.09, 'triangle', 0.08 * (run ? 1.3 : 1), this.master!);
    }
  }
}

export const audio = new AmbientAudio();
