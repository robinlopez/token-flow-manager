import { Injectable, effect, signal, type WritableSignal } from '@angular/core';

/** A signal whose value is mirrored to localStorage under `key` (best-effort). */
function persistedSignal<T>(key: string, fallback: T): WritableSignal<T> {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) initial = JSON.parse(raw) as T;
  } catch {
    /* ignore malformed / unavailable storage */
  }
  const sig = signal(initial);
  effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(sig()));
    } catch {
      /* ignore quota / unavailable storage */
    }
  });
  return sig;
}

/** Available accent themes. */
export type ThemeId = 'tokenflow' | 'forge';

/** Theme metadata for the Settings picker (label + primary swatch). */
export const THEMES: { id: ThemeId; label: string; primary: string; description: string }[] = [
  { id: 'tokenflow', label: 'Token Flow', primary: '#181919', description: 'Brand primary — near-black, neutral accent.' },
  { id: 'forge', label: 'Forge', primary: '#EA580C', description: 'Original warm orange accent.' },
];

/** Cross-component UI state: overlays toggled by keyboard or footer/sidebar clicks. */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly paletteOpen = signal(false);
  readonly diagnosticsOpen = signal(false);
  readonly settingsOpen = signal(false);
  /** When set, the Settings dialog jumps to this tab on open (then clears). */
  readonly settingsTab = signal<string | null>(null);
  readonly helpOpen = signal(false);
  readonly distributionOpen = signal(false);

  /** Transient status message (e.g. after undo/redo). Auto-clears. */
  readonly toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show a short-lived toast message. */
  showToast(message: string, durationMs = 2500): void {
    this.toast.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), durationMs);
  }

  // ---- Persisted layout (resizable panes / columns) ----
  /** Sidebar width in px. */
  readonly sidebarWidth = persistedSignal('tf.sidebarWidth', 256);
  /** Variables-table "Name" column width in px. */
  readonly nameColWidth = persistedSignal('tf.nameColWidth', 280);
  /** Per-mode value-column widths in px, keyed by mode id (with a default). */
  readonly modeColWidths = persistedSignal<Record<string, number>>('tf.modeColWidths', {});

  static readonly DEFAULT_MODE_COL = 224;

  // ---- Appearance / theme ----
  /** Selected accent theme. Default = Token Flow brand (primary #181919). */
  readonly theme = persistedSignal<ThemeId>('tf.theme', 'tokenflow');

  constructor() {
    // Apply the theme to <html data-theme> so the `forge-*` CSS variables swap.
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });
  }

  setTheme(theme: ThemeId): void {
    this.theme.set(theme);
  }

  togglePalette(): void {
    this.paletteOpen.update((v) => !v);
  }
  toggleDiagnostics(): void {
    this.diagnosticsOpen.update((v) => !v);
  }
  toggleHelp(): void {
    this.helpOpen.update((v) => !v);
  }
  toggleSettings(): void {
    this.settingsOpen.update((v) => !v);
  }
  /** Open Settings, optionally jumping straight to a given tab. */
  openSettings(tab?: string): void {
    if (tab) this.settingsTab.set(tab);
    this.settingsOpen.set(true);
  }
  toggleDistribution(): void {
    this.distributionOpen.update((v) => !v);
  }

  /** Width of a mode value-column, falling back to the default. */
  modeColWidth(modeId: string): number {
    return this.modeColWidths()[modeId] ?? UiService.DEFAULT_MODE_COL;
  }

  /** Set a mode column width (clamped), persisting the change. */
  setModeColWidth(modeId: string, width: number): void {
    this.modeColWidths.update((m) => ({ ...m, [modeId]: clamp(width, 96, 640) }));
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth.set(clamp(width, 180, 520));
  }
  setNameColWidth(width: number): void {
    this.nameColWidth.set(clamp(width, 160, 640));
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
