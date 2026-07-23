import { DEFAULT_CURVE, type PaletteCurve, type PaletteRecipe } from './models';
import { parseOklch, oklchToHex, type Oklcha } from './oklch';

export interface RampStep {
  step: string;
  hex: string;
}

/** Ease a 0..1 fraction according to the curve's distribution. */
function ease(f: number, kind: PaletteCurve['easing']): number {
  const t = Math.max(0, Math.min(1, f));
  switch (kind) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return t * (2 - t);
    case 'ease':
    default:
      return t * t * (3 - 2 * t); // smoothstep
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Compute the OKLCH colour of one step, given the base colour and its distance
 * fraction from the base (0 at the base, 1 at the far end), on the light or dark side.
 */
function stepColor(base: Oklcha, f: number, side: 'light' | 'dark', curve: PaletteCurve): Oklcha {
  const eased = ease(f, curve.easing);
  const targetL = side === 'light' ? curve.lightMax : curve.lightMin;
  const l = lerp(base.l, targetL, eased);
  const c = base.c * (1 - curve.chromaFalloff * f);
  const hueShift = side === 'light' ? curve.hueShiftLight : curve.hueShiftDark;
  const h = base.h + hueShift * f;
  return { l, c: Math.max(0, c), h, a: base.a };
}

/**
 * Generate every step's hex value for one mode. The base step's colour is emitted
 * unchanged (round-tripped through OKLCH). Returns [] if the base colour for the
 * mode can't be parsed.
 */
export function generateScale(recipe: PaletteRecipe, mode: string): RampStep[] {
  const baseHex = recipe.bases[mode];
  const base = parseOklch(baseHex);
  if (!base) return [];
  const curve = { ...DEFAULT_CURVE, ...recipe.curve };
  const steps = recipe.steps;
  const baseIdx = Math.max(0, steps.indexOf(recipe.baseStep));
  const lastIdx = steps.length - 1;

  return steps.map((step, i) => {
    if (i === baseIdx) return { step, hex: oklchToHex(base) };
    let color: Oklcha;
    if (i < baseIdx) {
      const f = baseIdx === 0 ? 0 : (baseIdx - i) / baseIdx;
      color = stepColor(base, f, 'light', curve);
    } else {
      const f = lastIdx === baseIdx ? 0 : (i - baseIdx) / (lastIdx - baseIdx);
      color = stepColor(base, f, 'dark', curve);
    }
    return { step, hex: oklchToHex(color) };
  });
}

/** A step observed in the group: its leaf name and current colour per mode. */
export interface ObservedStep {
  step: string;
  /** Current resolved colour (hex/CSS string) per mode. */
  byMode: Record<string, string>;
}

/** Numeric step name → number for sorting (`'50'` → 50); non-numeric sort last. */
function stepOrder(name: string): number {
  const n = Number(name);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Reverse-engineer a seed recipe from the palette's existing step colours, so the
 * editor opens pre-filled even when no recipe was ever stored (e.g. a palette
 * imported from Figma, or one whose recipe was orphaned by a group rename). The
 * base is `500` when present, otherwise the middle step.
 */
export function inferRecipe(
  collection: string,
  groupPath: string[],
  observed: ObservedStep[],
  modes: string[],
): PaletteRecipe | null {
  const steps = [...observed].sort((a, b) => stepOrder(a.step) - stepOrder(b.step));
  if (steps.length < 2) return null;
  const stepNames = steps.map((s) => s.step);
  const baseStep = stepNames.includes('500')
    ? '500'
    : stepNames[Math.floor((stepNames.length - 1) / 2)];
  const baseObs = steps.find((s) => s.step === baseStep)!;

  const bases: Record<string, string> = {};
  for (const mode of modes) {
    const hex = baseObs.byMode[mode];
    if (hex) bases[mode] = hex;
  }
  if (Object.keys(bases).length === 0) return null;

  // Estimate the curve from the first mode we have data for.
  const mode = Object.keys(bases)[0];
  const oklchOf = (name: string): Oklcha | null => {
    const s = steps.find((x) => x.step === name);
    return s ? parseOklch(s.byMode[mode]) : null;
  };
  const lights = steps.map((s) => parseOklch(s.byMode[mode])).filter(Boolean) as Oklcha[];
  const base = oklchOf(baseStep);
  const lightMax = lights.length ? Math.max(...lights.map((o) => o.l)) : DEFAULT_CURVE.lightMax;
  const lightMin = lights.length ? Math.min(...lights.map((o) => o.l)) : DEFAULT_CURVE.lightMin;
  const baseC = base?.c ?? 0;
  const minC = lights.length ? Math.min(...lights.map((o) => o.c)) : 0;
  const chromaFalloff = baseC > 0 ? Math.max(0, Math.min(1, 1 - minC / baseC)) : DEFAULT_CURVE.chromaFalloff;

  return {
    collection,
    groupPath,
    steps: stepNames,
    baseStep,
    bases,
    curve: { ...DEFAULT_CURVE, lightMax, lightMin, chromaFalloff },
    detached: [],
  };
}

/** Default step names for a fresh palette (Tailwind-like 50…950). */
export const DEFAULT_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
