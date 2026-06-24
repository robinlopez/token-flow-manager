/** Minimal colour math for the custom picker (no external dependency). */

export interface Rgba {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
  a: number; // 0–1
}

export interface Hsva {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
  a: number; // 0–1
}

/**
 * Normalise any CSS colour string to a canonical form via the canvas 2D context
 * (handles named colours, #rgb/#rrggbb/#rrggbbaa, rgb/rgba, hsl…). Returns null
 * for inputs the engine can't parse (e.g. exotic oklch on older browsers).
 */
function normalizeCss(input: string): string | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = input;
  const a = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = input;
  const b = ctx.fillStyle;
  return a === b ? a : null; // differs → the input didn't take → invalid
}

export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== 'string') return null;
  const norm = normalizeCss(input.trim());
  if (!norm) return null;
  if (norm.startsWith('#')) {
    const h = norm.slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /rgba?\(([^)]+)\)/.exec(norm);
  if (m) {
    const p = m[1]!.split(',').map((s) => parseFloat(s));
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
  }
  return null;
}

const hex2 = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when the colour has alpha < 1. */
export function rgbaToHex({ r, g, b, a }: Rgba): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a < 1 ? base + hex2(a * 255) : base;
}

/** Hex when opaque, `rgba(…)` when translucent (round-trips through tokens). */
export function rgbaToCss(c: Rgba): string {
  if (c.a >= 1) return rgbaToHex(c);
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 100) / 100})`;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbaToHsva(c: Rgba): Hsva {
  const { h, s, v } = rgbToHsv(c.r, c.g, c.b);
  return { h, s, v, a: c.a };
}

export function hsvaToRgba(c: Hsva): Rgba {
  const { r, g, b } = hsvToRgb(c.h, c.s, c.v);
  return { r, g, b, a: c.a };
}
