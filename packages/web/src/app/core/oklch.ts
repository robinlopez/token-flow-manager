/**
 * OKLCH colour helpers, isolated from the rest of the app: `culori` is imported
 * here and nowhere else. The picker works in the plain {@link Oklcha} shape
 * (l 0–1, c 0–~0.4, h 0–360, a 0–1) and converts to CSS strings on commit.
 */
import { clampChroma, converter, parse } from 'culori';
import type { Rgba } from './color';

export interface Oklcha {
  l: number; // 0–1   lightness
  c: number; // 0–~0.4 chroma
  h: number; // 0–360 hue
  a: number; // 0–1   alpha
}

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const toP3 = converter('p3');

/** culori uses an undefined hue for achromatic colours; fall back to 0. */
function asOklcha(o: { l?: number; c?: number; h?: number; alpha?: number } | undefined): Oklcha | null {
  if (!o) return null;
  return { l: o.l ?? 0, c: o.c ?? 0, h: o.h ?? 0, a: o.alpha ?? 1 };
}

/** culori oklch object from our flat shape (preserving the chosen hue). */
function culoriOklch(o: Oklcha) {
  return { mode: 'oklch' as const, l: o.l, c: o.c, h: o.h, alpha: o.a };
}

/**
 * Parse a CSS colour string straight to OKLCH (preserves wide-gamut values that
 * the canvas-based `parseColor` would clamp to sRGB). Returns null if unparsable.
 */
export function parseOklch(input: unknown): Oklcha | null {
  if (typeof input !== 'string') return null;
  const parsed = parse(input.trim());
  return parsed ? asOklcha(toOklch(parsed)) : null;
}

/** From our 0–255 RGBA - used to seed/sync OKLCH from the RGB (HSV) mode. */
export function rgbaToOklch(c: Rgba): Oklcha {
  return (
    asOklcha(toOklch({ mode: 'rgb', r: c.r / 255, g: c.g / 255, b: c.b / 255, alpha: c.a })) ?? {
      l: 0,
      c: 0,
      h: 0,
      a: c.a,
    }
  );
}

/** To our 0–255 RGBA, gamut-mapped into sRGB (for previews and the HSV mode). */
export function oklchToRgba(o: Oklcha): Rgba {
  const rgb = toRgb(clampChroma(culoriOklch(o), 'oklch', 'rgb'));
  return {
    r: clamp255((rgb.r ?? 0) * 255),
    g: clamp255((rgb.g ?? 0) * 255),
    b: clamp255((rgb.b ?? 0) * 255),
    a: rgb.alpha ?? o.a,
  };
}

/** `oklch(L C H)` (or `… / a` with alpha) - the wide-gamut output format. */
export function formatOklch(o: Oklcha): string {
  const base = `oklch(${r3(o.l)} ${r3(o.c)} ${r1(o.h)}`;
  return o.a < 1 ? `${base} / ${r3(o.a)})` : `${base})`;
}

/** `color(display-p3 r g b)` (or `… / a`), gamut-mapped into the P3 space. */
export function formatP3(o: Oklcha): string {
  const p3 = toP3(clampChroma(culoriOklch(o), 'oklch', 'p3'));
  const base = `color(display-p3 ${r4(p3.r ?? 0)} ${r4(p3.g ?? 0)} ${r4(p3.b ?? 0)}`;
  return o.a < 1 ? `${base} / ${r3(o.a)})` : `${base})`;
}

/** `#rrggbb`/`#rrggbbaa`, gamut-mapped into sRGB. */
export function oklchToHex(o: Oklcha): string {
  const c = oklchToRgba(o);
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a < 1 ? base + hex2(c.a * 255) : base;
}

/**
 * Whether each channel sits in [0, 1] with a tiny tolerance, so boundary
 * colours (pure white/black, primaries) aren't reported "out of gamut" because
 * the round-trip conversion lands a hair past 1.0 in floating point.
 */
function withinUnit(c: { r?: number; g?: number; b?: number }): boolean {
  const eps = 1e-4;
  const ok = (n: number | undefined): boolean => (n ?? 0) >= -eps && (n ?? 0) <= 1 + eps;
  return ok(c.r) && ok(c.g) && ok(c.b);
}
export function inSrgb(o: Oklcha): boolean {
  return withinUnit(toRgb(culoriOklch(o)));
}
export function inP3(o: Oklcha): boolean {
  return withinUnit(toP3(culoriOklch(o)));
}

const clamp255 = (n: number): number => Math.round(Math.max(0, Math.min(255, n)));
const hex2 = (n: number): string => clamp255(n).toString(16).padStart(2, '0');
/** Round to `d` decimals, dropping trailing zeros (`0.650` → `0.65`). */
const round = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;
const r1 = (n: number): number => round(n, 1);
const r3 = (n: number): number => round(n, 3);
const r4 = (n: number): number => round(n, 4);
