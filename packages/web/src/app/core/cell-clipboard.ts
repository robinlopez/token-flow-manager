import { isAliasValue } from './format';
import { parseOklch } from './oklch';

const COMPOSITE_TYPES = new Set(['typography', 'shadow', 'border', 'gradient', 'transition']);

export type CellParse = { ok: true; value: unknown } | { ok: false; error: string };

export function cellClipboardText(raw: unknown, type: string): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  const dim = dimensionParts(raw);
  if (dim) return `${dim.value}${dim.unit}`;
  return JSON.stringify(raw);
}

export function normalizeCellText(text: string): string {
  let s = text.replace(/\u00a0/g, ' ').trim();
  const isJson = /^[[{]/.test(s) && !isAliasValue(s);
  if (!isJson && /[\r\n]/.test(s)) {
    s = s.split(/[\r\n]+/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  }
  if (!isJson) {
    s = s.replace(/;$/, '').trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(s);
    if (quoted) s = quoted[2]!.trim();
  }
  return s;
}

export function parseCellText(text: string, type: string, current?: unknown): CellParse {
  const s = normalizeCellText(text);
  if (!s) return { ok: false, error: 'Nothing to paste' };

  if (isAliasValue(s)) return { ok: true, value: s };
  if (/^\{[^}]*$/.test(s)) return { ok: false, error: `"${trunc(s)}" is not a complete alias` };

  if (/^[[{]/.test(s)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return { ok: false, error: 'The clipboard holds malformed JSON' };
    }
    if (parsed !== null && typeof parsed === 'object') {
      if (COMPOSITE_TYPES.has(type) || type === 'cubicBezier' || type === 'unknown') {
        return { ok: true, value: parsed };
      }
      if (dimensionParts(parsed)) return { ok: true, value: parsed };
      return { ok: false, error: `A structured value cannot go in a ${type} cell` };
    }
    return { ok: false, error: `"${trunc(s)}" is not a valid ${type} value` };
  }

  if (COMPOSITE_TYPES.has(type)) {
    return { ok: false, error: `"${trunc(s)}" is not a valid ${type} value` };
  }

  switch (type) {
    case 'color': {
      const c = withHash(s);
      return parseOklch(c)
        ? { ok: true, value: c }
        : { ok: false, error: `"${trunc(s)}" is not a colour` };
    }
    case 'number': {
      const n = Number(s);
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: `"${trunc(s)}" is not a number` };
    }
    case 'fontWeight': {
      const n = Number(s);
      if (Number.isFinite(n)) return { ok: true, value: n };
      // DTCG also allows the keyword scale ("bold", "extra-light").
      return /^[a-z][a-z -]*$/i.test(s)
        ? { ok: true, value: s }
        : { ok: false, error: `"${trunc(s)}" is not a font weight` };
    }
    case 'dimension':
    case 'duration': {
      if (!/^-?\d*\.?\d+/.test(s)) {
        return { ok: false, error: `"${trunc(s)}" is not a ${type} value` };
      }
      return { ok: true, value: withUnit(s, type, current) };
    }
    default:
      return { ok: true, value: s };
  }
}

export function coerceTypedText(text: string, type: string, current?: unknown): unknown {
  const parsed = parseCellText(text, type, current);
  if (parsed.ok) return parsed.value;
  const s = text.trim();
  if (type === 'number') {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
  }
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    active?.focus();
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

function dimensionParts(value: unknown): { value: unknown; unit: unknown } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (!('value' in o) || !('unit' in o)) return null;
  return { value: o['value'], unit: o['unit'] };
}

function withHash(s: string): string {
  return /^[0-9a-fA-F]{3,8}$/.test(s) && [3, 4, 6, 8].includes(s.length) ? `#${s}` : s;
}

function withUnit(s: string, type: string, current: unknown): string | number {
  if (!/^-?\d*\.?\d+$/.test(s)) return s;
  if (typeof current === 'number') return Number(s);
  const dim = dimensionParts(current);
  if (dim && typeof dim.unit === 'string') return `${s}${dim.unit}`;
  const unit =
    typeof current === 'string' ? /^-?\d*\.?\d+([a-z%]+)$/i.exec(current.trim())?.[1] : undefined;
  return `${s}${unit ?? (type === 'duration' ? 'ms' : 'px')}`;
}

function trunc(s: string): string {
  return s.length > 24 ? `${s.slice(0, 24)}...` : s;
}
