import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { CellPickerService } from '../../core/cell-picker.service';
import { ContextMenuService } from '../../core/context-menu.service';
import {
  compositeFieldType,
  cssColor,
  effectiveType,
  formatValue,
  isAliasValue,
  isMetricType,
  typeGlyph,
} from '../../core/format';
import { parseColor, rgbaToHex } from '../../core/color';
import { inP3, inSrgb, parseOklch } from '../../core/oklch';
import { ValueCellComponent } from '../../ui/value-cell.component';
import type { ParsedToken, ReferenceInfo } from '../../core/models';

/** DTCG composite types that get a structured per-sub-property editor. */
const COMPOSITE_TYPES = new Set(['typography', 'shadow', 'border', 'gradient', 'transition']);

/** One editable sub-property of a composite token value. */
interface CompositeField {
  key: string;
  value: string;
  type: string;
  resolved: unknown;
  isNumber: boolean;
}
/** One editable stop of a gradient value. */
interface GradientStop {
  color: string;
  position: string;
  colorResolved: unknown;
}

@Component({
  selector: 'tf-inspector',
  standalone: true,
  imports: [FormsModule, ValueCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (token(); as t) {
      <aside class="w-[380px] shrink-0 bg-white border-l border-ink-200 flex flex-col h-full animate-in">
        <!-- Header -->
        <div class="px-4 py-3 border-b border-ink-200 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[11px] text-ink-400 font-mono truncate">{{ breadcrumb(t) }}</div>
            <div class="text-sm font-semibold text-ink-900 truncate">{{ leaf(t) }}</div>
            <span
              class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              [class]="badgeClass(t.type)"
            >
              <span class="opacity-70">{{ glyph(t.type) }}</span>
              {{ t.type }}
            </span>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-lg leading-none"
              title="Variable actions"
              (click)="openActions(t, $event)"
            >⋯</button>
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-lg leading-none"
              title="Close"
              (click)="close()"
            >×</button>
          </div>
        </div>

        <div class="flex-1 overflow-auto scrollbar-thin text-sm divide-y divide-ink-200">
          <!-- Description (editable, auto-saves on blur) -->
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Description</div>
            <textarea
              rows="2"
              class="w-full resize-y min-h-[2.25rem] text-ink-700 border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500 placeholder:text-ink-300"
              placeholder="Add a description…"
              [ngModel]="descDraft()"
              (ngModelChange)="descDraft.set($event)"
              (blur)="saveDescription(t)"
            ></textarea>
          </section>

          <!-- Values per mode -->
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Values</div>
            @for (mode of modes(); track mode.id) {
              <div class="mb-4 last:mb-0">
                <div class="text-xs font-medium text-ink-600 mb-1.5">{{ mode.label || mode.id }}</div>

                <!-- Composite (object): one editable field per sub-property -->
                @if (isCompositeObject(t.type)) {
                  <div class="border border-ink-200 rounded divide-y divide-ink-100">
                    @for (f of compositeFields(t, mode.id); track f.key) {
                      <div class="flex items-center gap-2 px-2 py-1.5">
                        <span class="w-24 shrink-0 text-xs text-ink-500 truncate" [title]="f.key">{{ f.key }}</span>
                        <div class="flex-1 min-w-0 flex items-center gap-1">
                          @if (f.type === 'color') {
                            <button
                              class="w-5 h-5 shrink-0 rounded border border-ink-300 checker"
                              title="Pick a colour"
                              (click)="openSubFieldPicker(t, mode.id, f, 'custom', $event)"
                            >
                              <span class="block w-full h-full rounded" [style.background]="subFieldSwatch(f)"></span>
                            </button>
                          }
                          <input
                            class="flex-1 min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forge-500"
                            [class.text-forge-700]="isAlias(f.value)"
                            [ngModel]="f.value"
                            (ngModelChange)="setCompositeField(mode.id, f.key, $event)"
                            (keyup.enter)="commitComposite(t, mode.id)"
                            (blur)="commitComposite(t, mode.id)"
                          />
                          @if (f.type === 'color' || isMetric(f.type)) {
                            <button
                              class="w-6 h-6 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100"
                              title="Link to a variable"
                              (click)="openSubFieldPicker(t, mode.id, f, 'libraries', $event)"
                            >
                              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                              </svg>
                            </button>
                          }
                        </div>
                      </div>
                    }
                  </div>

                <!-- Gradient: array of editable stops with a live preview -->
                } @else if (t.type === 'gradient') {
                  <div class="border border-ink-200 rounded p-2 flex flex-col gap-2">
                    <div class="h-4 rounded border border-ink-200" [style.background]="gradientPreview(t, mode.id)"></div>
                    @for (s of gradientStops(t, mode.id); track $index; let si = $index) {
                      <div class="flex items-center gap-1.5">
                        <button
                          class="w-6 h-6 shrink-0 rounded border border-ink-300 checker"
                          title="Pick a colour"
                          (click)="openStopPicker(t, mode.id, si, s, 'custom', $event)"
                        >
                          <span class="block w-full h-full rounded" [style.background]="stopSwatch(s)"></span>
                        </button>
                        <input
                          class="flex-1 min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forge-500"
                          [class.text-forge-700]="isAlias(s.color)"
                          [ngModel]="s.color"
                          (ngModelChange)="setStopColor(mode.id, si, $event)"
                          (keyup.enter)="commitGradient(t, mode.id)"
                          (blur)="commitGradient(t, mode.id)"
                        />
                        <input
                          type="number" min="0" max="1" step="0.05"
                          class="w-16 shrink-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forge-500"
                          [ngModel]="s.position"
                          (ngModelChange)="setStopPosition(mode.id, si, $event)"
                          (keyup.enter)="commitGradient(t, mode.id)"
                          (blur)="commitGradient(t, mode.id)"
                        />
                        <button
                          class="w-6 h-6 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400"
                          title="Remove stop"
                          [disabled]="gradientStops(t, mode.id).length <= 2"
                          (click)="removeStop(t, mode.id, si)"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /></svg>
                        </button>
                      </div>
                    }
                    <button
                      class="self-start text-xs text-forge-600 hover:text-forge-700 hover:underline"
                      (click)="addStop(t, mode.id)"
                    >+ Add stop</button>
                  </div>

                <!-- Scalar / alias: value control + colour metadata -->
                } @else {
                  @if (editingMode() === mode.id) {
                    <input
                      class="w-full min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
                      list="tf-alias-paths"
                      autofocus
                      [ngModel]="draft(t, mode.id)"
                      (ngModelChange)="setDraft(mode.id, $event)"
                      (keyup.enter)="save(t, mode.id)"
                      (keyup.escape)="cancelEdit()"
                      (blur)="save(t, mode.id)"
                    />
                  } @else {
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 text-left border border-ink-200 rounded px-2 py-1.5 hover:border-forge-400 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-forge-500"
                      title="Click to pick a value · double-click to type"
                      (click)="openPicker(t, mode.id, $event)"
                      (dblclick)="startEdit(mode.id)"
                    >
                      <tf-value-cell
                        class="flex-1 min-w-0"
                        [raw]="t.rawValuesByMode[mode.id]"
                        [resolved]="t.resolvedValuesByMode[mode.id]"
                        [type]="t.type"
                      />
                      <svg class="w-4 h-4 text-ink-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </button>
                  }
                  @if (valueMeta(t, mode.id); as meta) {
                    <div class="mt-1.5 rounded bg-ink-50 px-2 py-1.5 space-y-0.5">
                      @for (line of meta; track line.label) {
                        <div class="flex items-center justify-between gap-2 text-[11px] font-mono">
                          <span class="text-ink-400">{{ line.label }}</span>
                          <span class="text-ink-700 truncate">{{ line.value }}</span>
                        </div>
                      }
                    </div>
                  }
                  @if (multiChain(t, mode.id); as ch) {
                    <div class="mt-1 text-[11px] text-ink-400 font-mono">→ {{ ch }}</div>
                  }
                }
              </div>
            }
            <datalist id="tf-alias-paths">
              @for (p of aliasOptions(); track p) {
                <option [value]="p"></option>
              }
            </datalist>
          </section>

          <!-- References (collapsible: click to reveal the referencing tokens) -->
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">References</div>
            <button
              type="button"
              class="w-full flex items-center justify-between gap-2 py-1 text-left text-ink-700 disabled:text-ink-400"
              [class.hover:text-ink-900]="references().length"
              [disabled]="!references().length"
              (click)="refsExpanded.set(!refsExpanded())"
            >
              <span class="flex items-center gap-2 min-w-0">
                <svg class="w-4 h-4 shrink-0 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span class="truncate">Used in <span class="font-semibold">{{ references().length }}</span> token{{ references().length === 1 ? '' : 's' }}</span>
              </span>
              @if (references().length) {
                <svg class="w-4 h-4 shrink-0 text-ink-400 transition-transform" [class.rotate-90]="refsExpanded()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              }
            </button>
            @if (refsExpanded()) {
              <div class="mt-1 pl-6 space-y-0.5">
                @for (ref of references(); track ref.id) {
                  <button
                    class="block w-full text-left font-mono text-xs text-forge-600 hover:underline py-0.5 truncate"
                    [title]="ref.path.join('.')"
                    (click)="goto(ref)"
                  >
                    {{ ref.path.join('.') }}
                  </button>
                }
              </div>
            }
          </section>

          <!-- Rename (auto-commits on blur / Enter) -->
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Rename</div>
            <input
              class="w-full min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
              [ngModel]="renameDraft()"
              (ngModelChange)="onRenameInput(t, $event)"
              (keyup.enter)="commitRename(t)"
              (blur)="commitRename(t)"
              placeholder="new.path.name"
            />
            @if (renamePreview(); as p) {
              <div class="mt-1 text-[11px]" [class.text-red-500]="p.conflict" [class.text-ink-400]="!p.conflict">
                @if (p.conflict) { Path already exists. } @else {
                  {{ p.references }} reference(s) in {{ p.files }} file(s) will be updated.
                }
              </div>
            }
          </section>

          <!-- Source -->
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Source</div>
            <div class="flex items-center justify-between gap-2 font-mono text-xs text-ink-600 border border-ink-200 rounded px-2 py-1.5">
              <span class="truncate" [title]="t.source.file + ':' + (t.source.line + 1)">{{ t.source.file }}:{{ t.source.line + 1 }}</span>
              @if (t.diagnostics.length) {
                <span class="w-2 h-2 rounded-full shrink-0" [class.bg-red-500]="hasError(t)" [class.bg-amber-500]="!hasError(t)"></span>
              }
            </div>
            <button
              class="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-ink-600 border border-ink-200 rounded px-2 py-1.5 hover:border-forge-400 hover:bg-ink-50"
              (click)="openInEditor(t)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" /><path d="M10 14 21 3" />
              </svg>
              Open in editor
            </button>
          </section>

          <!-- Diagnostics -->
          @if (t.diagnostics.length) {
            <section class="p-4">
              <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Diagnostics</div>
              @for (d of t.diagnostics; track d.message) {
                <div
                  class="text-xs px-2 py-1 rounded mb-1"
                  [class.bg-red-50]="d.severity === 'error'"
                  [class.text-red-700]="d.severity === 'error'"
                  [class.bg-amber-50]="d.severity === 'warning'"
                  [class.text-amber-700]="d.severity === 'warning'"
                >
                  {{ d.message }}
                  @for (fix of d.quickFixes ?? []; track fix.action) {
                    <button
                      class="ml-2 underline"
                      (click)="applyFix(t, d.mode, fix.action, fix.data)"
                    >
                      {{ fix.label }}
                    </button>
                  }
                </div>
              }
            </section>
          }
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .animate-in {
        animation: slidein 0.15s ease-out;
      }
      @keyframes slidein {
        from {
          transform: translateX(12px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `,
  ],
})
export class InspectorComponent {
  private readonly store = inject(ProjectStore);
  private readonly picker = inject(CellPickerService);
  private readonly ctxMenu = inject(ContextMenuService);
  readonly token = this.store.inspectedToken;
  readonly modes = this.store.modes;

  readonly references = signal<ReferenceInfo[]>([]);
  /** Whether the referencing-tokens list is expanded (collapsed by default). */
  readonly refsExpanded = signal(false);
  readonly renameDraft = signal('');
  readonly renamePreview = signal<{ files: number; references: number; conflict: boolean } | null>(null);
  readonly descDraft = signal('');
  /** Mode whose raw value is currently being typed inline (double-click). */
  readonly editingMode = signal<string | null>(null);
  readonly aliasOptions = computed(() => this.store.collectionPaths().map((p) => `{${p}}`));

  private drafts = new Map<string, string>();
  /**
   * In-progress edits of composite sub-properties / gradient stops, keyed by
   * `${mode}::${key}`. A signal so swatches/previews re-render live as you type.
   * Reset whenever the inspected token changes.
   */
  private readonly cdrafts = signal<Record<string, string>>({});

  constructor() {
    // When the selected token changes, reset edit state + fetch references.
    effect(() => {
      const t = this.token();
      this.drafts.clear();
      this.cdrafts.set({});
      this.renamePreview.set(null);
      this.editingMode.set(null);
      this.refsExpanded.set(false);
      if (t) {
        this.renameDraft.set(t.path.join('.'));
        this.descDraft.set(t.description ?? '');
        void this.store.references(t.id).then((refs) => this.references.set(refs));
      } else {
        this.descDraft.set('');
        this.references.set([]);
      }
    });
  }

  close(): void {
    this.store.selectToken(null);
  }

  /** The same action menu as the table row's `⋯`, anchored to the inspector header. */
  openActions(t: ParsedToken, event: MouseEvent): void {
    this.ctxMenu.open(event, [
      { label: 'Rename', action: () => this.focusRename() },
      { label: 'Duplicate', action: () => void this.store.duplicateToken(t.id) },
      { label: 'Copy variable', action: () => this.store.copyVariables([t.id]) },
      { label: 'Cut variable', action: () => this.store.cutVariables([t.id]) },
      {
        label: 'Paste here',
        disabled: !this.store.hasCopiedVariables(),
        action: () => void this.store.pasteVariables(t.path.slice(0, -1)),
      },
      { label: 'Delete', danger: true, action: () => void this.deleteAndClose(t.id) },
    ]);
  }

  /** Move focus to the inspector's Rename field (the panel already shows it). */
  private focusRename(): void {
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>('tf-inspector input[placeholder="new.path.name"]');
      el?.focus();
      el?.select();
    });
  }

  private async deleteAndClose(id: string): Promise<void> {
    const ok = await this.store.deleteToken(id);
    if (ok) this.store.selectToken(null);
  }

  leaf(t: ParsedToken): string {
    return t.path[t.path.length - 1] ?? '';
  }
  breadcrumb(t: ParsedToken): string {
    return t.path.slice(0, -1).join(' › ') || t.collection;
  }
  glyph(type: string): string {
    return typeGlyph(type);
  }
  hasError(t: ParsedToken): boolean {
    return t.diagnostics.some((d) => d.severity === 'error');
  }
  /** Tailwind classes for the type badge, grouped by type family. */
  badgeClass(type: string): string {
    switch (type) {
      case 'color':
        return 'bg-violet-50 text-violet-700';
      case 'dimension':
      case 'number':
      case 'duration':
        return 'bg-sky-50 text-sky-700';
      case 'fontFamily':
      case 'fontWeight':
      case 'typography':
        return 'bg-amber-50 text-amber-700';
      case 'shadow':
      case 'border':
      case 'gradient':
        return 'bg-emerald-50 text-emerald-700';
      default:
        return 'bg-ink-100 text-ink-600';
    }
  }
  resolvedText(t: ParsedToken, mode: string): string {
    return formatValue(t.resolvedValuesByMode[mode], t.type);
  }
  /** Multi-hop alias chain (returned only when there are 2+ hops to show). */
  multiChain(t: ParsedToken, mode: string): string | null {
    const raw = t.rawValuesByMode[mode];
    if (!isAliasValue(raw)) return null;
    const ch = t.aliasChainsByMode?.[mode];
    if (ch && ch.length > 1) return ch.map((p) => p.join('.')).join(' → ');
    return null;
  }

  /**
   * Compact metadata lines shown under a scalar/alias value: the resolved hex,
   * OKLCH coordinates and gamut for colours; "resolves to" for non-colour
   * aliases. Returns null when there is nothing extra to show (plain literal).
   */
  valueMeta(t: ParsedToken, mode: string): { label: string; value: string }[] | null {
    const raw = t.rawValuesByMode[mode];
    const resolved = t.resolvedValuesByMode[mode];
    const eff = effectiveType(t.type, resolved, raw);
    const lines: { label: string; value: string }[] = [];
    if (eff === 'color') {
      const m = this.colorMeta(resolved);
      if (m) {
        if (m.hex) lines.push({ label: 'resolves to', value: m.hex });
        if (m.oklch) lines.push({ label: 'oklch', value: m.oklch });
        if (m.gamut) lines.push({ label: 'gamut', value: m.gamut });
      }
    } else if (isAliasValue(raw)) {
      lines.push({ label: 'resolves to', value: this.resolvedText(t, mode) });
    }
    return lines.length ? lines : null;
  }

  /** Hex / OKLCH / gamut breakdown of a resolved colour value (null if not one). */
  private colorMeta(resolved: unknown): { hex: string; oklch: string; gamut: string } | null {
    const css = cssColor(resolved);
    if (!css) return null;
    const rgba = parseColor(css);
    const o = parseOklch(css);
    if (!rgba && !o) return null;
    return {
      hex: rgba ? rgbaToHex(rgba).toUpperCase() : '',
      oklch: o ? `${round(o.l, 3)} ${round(o.c, 3)} ${round(o.h, 1)}` : '',
      gamut: o ? (inSrgb(o) ? 'sRGB ✓' : inP3(o) ? 'Display P3 ✓' : 'out of gamut') : '',
    };
  }

  // ---- Composite (object) sub-property editing ----

  isCompositeObject(type: string): boolean {
    return COMPOSITE_TYPES.has(type) && type !== 'gradient';
  }
  isMetric(type: string): boolean {
    return isMetricType(type);
  }
  isAlias(value: string): boolean {
    return isAliasValue(value);
  }

  compositeFields(t: ParsedToken, mode: string): CompositeField[] {
    const raw = (t.rawValuesByMode[mode] ?? {}) as Record<string, unknown>;
    const resolved = (t.resolvedValuesByMode[mode] ?? {}) as Record<string, unknown>;
    const drafts = this.cdrafts();
    return Object.entries(raw).map(([key, val]) => {
      const draftKey = `${mode}::${key}`;
      const base = typeof val === 'string' ? val : JSON.stringify(val);
      return {
        key,
        value: draftKey in drafts ? drafts[draftKey]! : base,
        type: compositeFieldType(t.type, key),
        resolved: resolved?.[key],
        isNumber: typeof val === 'number',
      };
    });
  }
  setCompositeField(mode: string, key: string, value: string): void {
    this.cdrafts.set({ ...this.cdrafts(), [`${mode}::${key}`]: value });
  }
  async commitComposite(t: ParsedToken, mode: string): Promise<void> {
    const fields = this.compositeFields(t, mode);
    const next: Record<string, unknown> = {};
    for (const f of fields) {
      if (isAliasValue(f.value)) next[f.key] = f.value;
      else if (f.isNumber) {
        const n = Number(f.value);
        next[f.key] = Number.isNaN(n) ? f.value : n;
      } else next[f.key] = f.value;
    }
    this.clearDrafts(mode);
    if (JSON.stringify(next) === JSON.stringify(t.rawValuesByMode[mode])) return;
    await this.store.updateValue(t.id, mode, next);
  }
  /** CSS colour for a colour sub-field's swatch (its literal, else its resolved). */
  subFieldSwatch(f: CompositeField): string {
    const v = (f.value ?? '').trim();
    if (v && !isAliasValue(v)) {
      const c = cssColor(v);
      if (c) return c;
    }
    return cssColor(f.resolved) || 'transparent';
  }
  openSubFieldPicker(
    t: ParsedToken,
    mode: string,
    f: CompositeField,
    tab: 'custom' | 'libraries',
    event: Event,
  ): void {
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.picker.open({
      tokenId: t.id,
      mode,
      type: f.type,
      raw: f.value,
      resolved: f.resolved,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
      onPick: (value) => {
        this.setCompositeField(mode, f.key, value);
        void this.commitComposite(t, mode);
      },
    });
  }

  // ---- Gradient stop editing ----

  gradientStops(t: ParsedToken, mode: string): GradientStop[] {
    const arr = t.rawValuesByMode[mode];
    const resolvedArr = t.resolvedValuesByMode[mode];
    const drafts = this.cdrafts();
    return (Array.isArray(arr) ? arr : []).map((s, i) => {
      const stop = (s ?? {}) as Record<string, unknown>;
      const rStop = (Array.isArray(resolvedArr) ? resolvedArr[i] : undefined) as
        | Record<string, unknown>
        | undefined;
      const colorKey = `${mode}::g${i}::color`;
      const posKey = `${mode}::g${i}::pos`;
      return {
        color: colorKey in drafts ? drafts[colorKey]! : typeof stop['color'] === 'string' ? (stop['color'] as string) : '',
        position: posKey in drafts ? drafts[posKey]! : String(stop['position'] ?? 0),
        colorResolved: rStop?.['color'],
      };
    });
  }
  setStopColor(mode: string, index: number, value: string): void {
    this.cdrafts.set({ ...this.cdrafts(), [`${mode}::g${index}::color`]: value });
  }
  setStopPosition(mode: string, index: number, value: string): void {
    this.cdrafts.set({ ...this.cdrafts(), [`${mode}::g${index}::pos`]: value });
  }
  private buildStops(t: ParsedToken, mode: string): { color: string; position: number }[] {
    return this.gradientStops(t, mode).map((s) => {
      const pos = Number(s.position);
      return { color: s.color, position: Number.isNaN(pos) ? 0 : pos };
    });
  }
  async commitGradient(t: ParsedToken, mode: string): Promise<void> {
    const value = this.buildStops(t, mode);
    this.clearDrafts(mode);
    if (JSON.stringify(value) === JSON.stringify(t.rawValuesByMode[mode])) return;
    await this.store.updateValue(t.id, mode, value);
  }
  async addStop(t: ParsedToken, mode: string): Promise<void> {
    const stops = this.buildStops(t, mode);
    const last = stops[stops.length - 1];
    const pos = last ? Math.min(1, (last.position || 0) + 0.1) : 0;
    stops.push({ color: '#000000', position: Math.round(pos * 1000) / 1000 });
    this.clearDrafts(mode);
    await this.store.updateValue(t.id, mode, stops);
  }
  async removeStop(t: ParsedToken, mode: string, index: number): Promise<void> {
    const stops = this.buildStops(t, mode).filter((_, i) => i !== index);
    this.clearDrafts(mode);
    await this.store.updateValue(t.id, mode, stops);
  }
  gradientPreview(t: ParsedToken, mode: string): string {
    const stops = this.gradientStops(t, mode);
    if (!stops.length) return 'transparent';
    const parts = stops.map((s) => {
      const pos = Number(s.position);
      const pct = (Number.isNaN(pos) ? 0 : Math.max(0, Math.min(1, pos))) * 100;
      return `${this.stopSwatch(s)} ${pct}%`;
    });
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  }
  stopSwatch(stop: GradientStop): string {
    const v = (stop.color ?? '').trim();
    if (v && !isAliasValue(v)) {
      const c = cssColor(v);
      if (c) return c;
    }
    return cssColor(stop.colorResolved) || 'transparent';
  }
  openStopPicker(
    t: ParsedToken,
    mode: string,
    index: number,
    stop: GradientStop,
    tab: 'custom' | 'libraries',
    event: Event,
  ): void {
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.picker.open({
      tokenId: t.id,
      mode,
      type: 'color',
      raw: stop.color,
      resolved: stop.colorResolved,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
      onPick: (value) => {
        this.setStopColor(mode, index, value);
        void this.commitGradient(t, mode);
      },
    });
  }

  /** Drop all in-progress drafts for a mode (after a commit). */
  private clearDrafts(mode: string): void {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.cdrafts())) {
      if (!k.startsWith(`${mode}::`)) next[k] = v;
    }
    this.cdrafts.set(next);
  }

  // ---- Scalar value editing: single click → picker, double click → type raw ----

  /** Open the Figma-style picker anchored to the clicked value cell. */
  openPicker(t: ParsedToken, mode: string, event: Event): void {
    const cell = event.currentTarget as HTMLElement;
    const r = cell.getBoundingClientRect();
    const raw = t.rawValuesByMode[mode];
    // Colour literals seed the colour picker; everything else opens Libraries.
    const tab =
      !isAliasValue(raw) && effectiveType(t.type, t.resolvedValuesByMode[mode], raw) === 'color'
        ? 'custom'
        : 'libraries';
    this.picker.open({
      tokenId: t.id,
      mode,
      type: t.type,
      raw,
      resolved: t.resolvedValuesByMode[mode],
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
    });
  }

  startEdit(mode: string): void {
    this.picker.close();
    this.editingMode.set(mode);
  }
  cancelEdit(): void {
    this.editingMode.set(null);
  }

  draft(t: ParsedToken, mode: string): string {
    const key = this.key(t, mode);
    if (this.drafts.has(key)) return this.drafts.get(key)!;
    return formatValue(t.rawValuesByMode[mode], t.type);
  }
  setDraft(mode: string, value: string): void {
    const t = this.token();
    if (t) this.drafts.set(this.key(t, mode), value);
  }
  async save(t: ParsedToken, mode: string): Promise<void> {
    if (this.editingMode() !== mode) return; // ignore stray blur after cancel
    const key = this.key(t, mode);
    this.editingMode.set(null);
    if (!this.drafts.has(key)) return;
    const value = this.drafts.get(key)!;
    if (value === formatValue(t.rawValuesByMode[mode], t.type)) {
      this.drafts.delete(key);
      return;
    }
    const ok = await this.store.updateValue(t.id, mode, coerce(value, t.type === 'number'));
    if (ok) this.drafts.delete(key);
  }

  async saveDescription(t: ParsedToken): Promise<void> {
    const next = this.descDraft();
    if (next.trim() === (t.description ?? '').trim()) return;
    await this.store.updateDescription(t.id, next);
  }

  goto(ref: ReferenceInfo): void {
    void this.store.revealToken(ref.id, ref.collection);
  }

  openInEditor(t: ParsedToken): void {
    void this.store.openFileInEditor(t.source.file);
  }

  onRenameInput(t: ParsedToken, value: string): void {
    this.renameDraft.set(value);
    const path = value.split('.').filter(Boolean);
    if (path.length === 0 || value === t.path.join('.')) {
      this.renamePreview.set(null);
      return;
    }
    void this.store.renamePreview(t.id, value).then((p) => this.renamePreview.set(p));
  }
  async commitRename(t: ParsedToken): Promise<void> {
    const v = this.renameDraft();
    const path = v.split('.').filter(Boolean);
    if (path.length === 0 || v === t.path.join('.') || this.renamePreview()?.conflict) return;
    await this.store.rename(t.id, path, true);
  }

  async applyFix(
    t: ParsedToken,
    mode: string | undefined,
    action: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.applyQuickFix(t.id, action, mode, data);
  }

  private key(t: ParsedToken, mode: string): string {
    return `${t.id}:${mode}`;
  }
}

function coerce(value: string, asNumber: boolean): unknown {
  if (asNumber) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

/** Round to `d` decimals, dropping trailing zeros. */
function round(n: number, d: number): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
