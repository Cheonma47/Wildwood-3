/**
 * Procedurally generated canvas textures (no external image assets needed).
 */
import * as THREE from 'three';
import { rng } from '../math/polygon';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number, size = 1) {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / (size * size) / 2; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${amount * r()})`;
    ctx.fillRect(r() * w, r() * h, size, size);
  }
}

/** Asphalt, 1 texture repeat = 4 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#4a4c50';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 0.25, 1, 2);
  noise(ctx, 256, 256, 0.15, 2, 1);
  return tex(c);
}

/** Concrete sidewalk slabs, 1 repeat = 2 m (one slab joint). */
export function sidewalkTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#b9b5ab';
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 0.15, 3, 2);
  ctx.strokeStyle = 'rgba(80,80,80,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 1); ctx.lineTo(128, 1);
  ctx.stroke();
  return tex(c);
}

/** Boardwalk planks running across the deck (1 repeat = 2 m). Wildwood uses a herringbone-ish diagonal pattern in parts; we use straight planks. */
export function planksTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const r = rng(7);
  const planks = 16; // 16 planks per 2 m ≈ 12.5 cm boards
  for (let i = 0; i < planks; i++) {
    const shade = 120 + Math.floor(r() * 40);
    ctx.fillStyle = `rgb(${shade + 40},${shade + 10},${shade - 30})`;
    ctx.fillRect(0, (i * 256) / planks, 256, 256 / planks);
    ctx.fillStyle = 'rgba(40,25,10,0.6)';
    ctx.fillRect(0, (i * 256) / planks, 256, 1.5);
    // butt joints
    const j = r() * 256;
    ctx.fillRect(j, (i * 256) / planks, 1.5, 256 / planks);
  }
  noise(ctx, 256, 256, 0.12, 8, 1);
  return tex(c);
}

export function sandTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#e8d8ae';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 0.18, 9, 1);
  noise(ctx, 256, 256, 0.08, 10, 3);
  return tex(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(11);
  for (let i = 0; i < 6000; i++) {
    const v = 200 + Math.floor(r() * 55);
    ctx.fillStyle = `rgba(${v - 30},${v},${v - 40},0.5)`;
    ctx.fillRect(r() * 256, r() * 256, 1, 2 + r() * 2);
  }
  return tex(c);
}

/**
 * Facade atlas: 4 styles side by side (house, motel, commercial, shopfront).
 * One tile = one window bay (≈3.5 m) × one storey (3.1 m). The shader patch in
 * materials.ts tiles inside each atlas column.
 */
export function facadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 128, H = 128;
  const [c, ctx] = canvas(W * 4, H);
  const [e, ectx] = canvas(W * 4, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W * 4, H);
  const win = (x: number, y: number, w: number, h: number, frame = '#f4f1ea', glass = '#5d7890') => {
    ctx.fillStyle = frame;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = glass;
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  const lit = (x: number, y: number, w: number, h: number, col = '#ffd79a') => {
    ectx.fillStyle = col;
    ectx.fillRect(x, y, w, h);
  };
  // wall base is white so vertex colour tints it
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W * 4, H);
  // 0: house – siding lines + one window with shutters
  for (let y = 0; y < H; y += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    ctx.fillRect(0, y, W, 2);
  }
  win(40, 34, 48, 58);
  ctx.fillStyle = 'rgba(40,50,60,0.55)';
  ctx.fillRect(28, 31, 10, 64);
  ctx.fillRect(90, 31, 10, 64);
  lit(40, 34, 48, 58);
  // 1: motel – door + window, walkway rail line at bottom
  const X1 = W;
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(X1, 0, W, H);
  ctx.fillStyle = '#6b4f3a';
  ctx.fillRect(X1 + 16, 30, 30, 90);
  ctx.fillStyle = '#e8d9b0';
  ctx.fillRect(X1 + 40, 70, 3, 4);
  win(X1 + 64, 40, 46, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(X1, 118, W, 4);
  ctx.fillRect(X1, 100, W, 3);
  for (let x = 0; x < W; x += 10) ctx.fillRect(X1 + x, 100, 2, 20);
  lit(X1 + 64, 40, 46, 40, '#ffcf8a');
  // 2: commercial / apartment – big window band
  const X2 = W * 2;
  win(X2 + 10, 26, 108, 70, '#d9d9d9', '#4f6f86');
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(X2 + 62, 26, 4, 70);
  lit(X2 + 10, 26, 50, 70, '#fff2c4');
  // 3: shopfront – full-height glass with awning band on top
  const X3 = W * 3;
  win(X3 + 8, 30, 112, 90, '#333', '#3c5566');
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(X3, 0, W, 22);
  lit(X3 + 8, 30, 112, 90, '#fff0d0');
  return { map: tex(c), emissive: tex(e) };
}

/** Text texture for signs. */
export function textTexture(text: string, opts: { bg?: string; fg?: string; font?: string; w?: number; h?: number; glow?: string } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 512, h = opts.h ?? 128;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = opts.bg ?? '#1b3a5c';
  ctx.fillRect(0, 0, w, h);
  let size = h * 0.62;
  ctx.font = `bold ${size}px ${opts.font ?? 'Arial, Helvetica, sans-serif'}`;
  while (ctx.measureText(text).width > w * 0.92 && size > 10) {
    size -= 2;
    ctx.font = `bold ${size}px ${opts.font ?? 'Arial, Helvetica, sans-serif'}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = h * 0.12;
  }
  ctx.fillStyle = opts.fg ?? '#ffffff';
  ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = tex(c, false);
  t.anisotropy = 4;
  return t;
}

/** Street-name sign atlas: 4 columns of 512×48 green US street blades. */
export function streetSignAtlas(names: string[]): { texture: THREE.CanvasTexture; rectOf: Map<string, [number, number, number, number]> } {
  const COLS = 4, W = 512, RH = 48;
  const n = Math.min(names.length, 340);
  const rows = Math.max(1, Math.ceil(n / COLS));
  const [c, ctx] = canvas(W * COLS, rows * RH);
  const rectOf = new Map<string, [number, number, number, number]>();
  names.slice(0, n).forEach((name, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * W, y = row * RH;
    ctx.fillStyle = '#0b6b3a';
    ctx.fillRect(x, y, W, RH);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, W - 6, RH - 6);
    ctx.fillStyle = '#fff';
    let size = 32;
    ctx.font = `bold ${size}px Arial, sans-serif`;
    while (ctx.measureText(name).width > W - 24 && size > 12) {
      size -= 1;
      ctx.font = `bold ${size}px Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + W / 2, y + RH / 2 + 1);
    // u0, v0 (bottom), u1, v1 (top) with flipY = true
    rectOf.set(name, [x / (W * COLS), 1 - (y + RH) / (rows * RH), (x + W) / (W * COLS), 1 - y / (rows * RH)]);
  });
  const t = tex(c, false);
  return { texture: t, rectOf };
}
