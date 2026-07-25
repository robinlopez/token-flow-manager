import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { UiService } from '../../core/ui.service';
import { CellPickerService } from '../../core/cell-picker.service';
import { cssColor } from '../../core/format';
import {
  generateScale,
  inferRecipe,
  DEFAULT_STEPS,
  detectFormat,
  isValidStepName,
  suggestNextStep,
  toFormat,
  type ObservedStep,
} from '../../core/palette';
import {
  DEFAULT_CURVE,
  type PaletteCurve,
  type PaletteFormat,
  type PaletteRecipe,
} from '../../core/models';

const FORMATS: { id: PaletteFormat; label: string }[] = [
  { id: 'hex', label: 'Hex' },
  { id: 'oklch', label: 'OKLCH' },
  { id: 'p3', label: 'P3' },
];

interface PreviewCell {
  step: string;
  hex: string;
  base: boolean;
  detached: boolean;
}

@Component({
  selector: 'tf-palette-editor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (recipe(); as r) {
      <!-- scrim -->
      <div class="fixed inset-0 z-40 bg-black/20" (click)="close()"></div>
      <aside
        class="fixed right-0 top-0 bottom-0 z-50 w-[440px] max-w-[90vw] bg-white border-l border-ink-200 shadow-2xl flex flex-col"
        (keydown.escape)="close()"
      >
        <!-- Header -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-ink-200"><svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="13.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="10.5" r="2.5" /><circle cx="8.5" cy="7.5" r="2.5" /><circle cx="6.5" cy="12.5" r="2.5" />
          <path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h1a4 4 0 0 0 4-4 10 10 0 0 0-9-8Z" />
        </svg>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-ink-900 truncate">Palette — {{ groupLabel() }}</div>
            <div class="text-[11px] text-ink-400">{{ r.steps.length }} steps · base {{ r.baseStep }}</div>
          </div>
          <button type="button" class="text-ink-400 hover:text-ink-700 p-1" title="Close" (click)="close()">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div class="flex-1 overflow-auto p-4 space-y-5">
          <!-- Base colour per mode — opens the app's colour picker (custom only) -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Base colour</div>
            <div class="space-y-2">
              @for (mode of modeIds(); track mode) {
                <div class="flex items-center gap-2">
                  <span class="text-xs text-ink-500 w-24 truncate">{{ mode }}</span>
                  <button
                    type="button"
                    class="flex items-center gap-2 flex-1 min-w-0 border border-ink-200 rounded px-2 py-1 text-left hover:border-ink-300 transition-colors"
                    (click)="openBasePicker(mode, $event)"
                  >
                    <span class="w-5 h-5 rounded border border-black/10 shrink-0 checker">
                      <span class="block w-full h-full rounded" [style.background]="baseValue(mode)"></span>
                    </span>
                    <span class="flex-1 min-w-0 text-sm font-mono truncate">{{ baseValue(mode) }}</span>
                  </button>
                </div>
              }
            </div>
          </section>

          <!-- Output colour notation (follows the base picker, overridable here) -->
          <section>
            <div class="flex items-center gap-2">
              <span class="text-[11px] uppercase tracking-wide text-ink-400 w-16">Output</span>
              <div class="inline-flex rounded-md border border-ink-200 overflow-hidden text-xs">
                @for (f of formats; track f.id) {
                  <button
                    type="button"
                    class="px-2.5 py-1 transition-colors border-l first:border-l-0 border-ink-200"
                    [class.bg-forge-600]="r.format === f.id"
                    [class.text-white]="r.format === f.id"
                    [class.text-ink-600]="r.format !== f.id"
                    [class.hover:bg-ink-100]="r.format !== f.id"
                    (click)="setFormat(f.id)"
                  >
                    {{ f.label }}
                  </button>
                }
              </div>
            </div>
          </section>

          <section>
            <div class="flex items-center justify-between mb-2">
              <div class="text-[11px] uppercase tracking-wide text-ink-400">Steps</div>
              <div class="text-[10px] text-ink-400">click = base · × removes · + adds</div>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              @for (step of r.steps; track step) {
                <div class="group/step relative">
                  <button
                    type="button"
                    class="min-w-9 px-2 h-7 rounded text-xs font-medium border transition-colors"
                    [class.bg-forge-600]="step === r.baseStep"
                    [class.text-white]="step === r.baseStep"
                    [class.border-forge-600]="step === r.baseStep"
                    [class.border-ink-200]="step !== r.baseStep"
                    [class.text-ink-600]="step !== r.baseStep"
                    [class.hover:bg-ink-100]="step !== r.baseStep"
                    (click)="setBaseStep(step)"
                    [title]="step === r.baseStep ? 'Base step' : 'Set as base step'"
                  >
                    {{ step }}
                  </button>
                  @if (r.steps.length > 2) {
                    <button
                      type="button"
                      class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ink-700 text-white items-center justify-center hidden group-hover/step:flex hover:bg-red-600"
                      title="Remove this step"
                      (click)="removeStep(step); $event.stopPropagation()"
                    >
                      <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  }
                </div>
              }
              <input
                class="w-20 h-7 text-xs border border-dashed border-ink-300 rounded px-1.5 focus:outline-none focus:border-forge-400"
                inputmode="numeric"
                [placeholder]="'+ ' + suggestedStep()"
                [ngModel]="newStep()"
                (ngModelChange)="onNewStep($event)"
                (keydown.enter)="addStep(true)"
                (blur)="addStep(false)"
                spellcheck="false"
                title="Numeric steps only (50, 100, 900…). Enter adds the suggestion."
              />
            </div>
          </section>

          <!-- Curve -->
          <section class="space-y-3">
            <div class="text-[11px] uppercase tracking-wide text-ink-400">Ramp</div>

            <label class="block">
              <div class="flex justify-between text-xs text-ink-600 mb-1"><span>Lightest (L)</span><span class="font-mono">{{ r.curve.lightMax.toFixed(2) }}</span></div>
              <input type="range" min="0.5" max="1" step="0.01" class="w-full accent-forge-600"
                [ngModel]="r.curve.lightMax" (ngModelChange)="setCurve({ lightMax: +$event })" />
            </label>

            <label class="block">
              <div class="flex justify-between text-xs text-ink-600 mb-1"><span>Darkest (L)</span><span class="font-mono">{{ r.curve.lightMin.toFixed(2) }}</span></div>
              <input type="range" min="0" max="0.5" step="0.01" class="w-full accent-forge-600"
                [ngModel]="r.curve.lightMin" (ngModelChange)="setCurve({ lightMin: +$event })" />
            </label>

            <label class="block">
              <div class="flex justify-between text-xs text-ink-600 mb-1"><span>Chroma falloff</span><span class="font-mono">{{ r.curve.chromaFalloff.toFixed(2) }}</span></div>
              <input type="range" min="0" max="1" step="0.01" class="w-full accent-forge-600"
                [ngModel]="r.curve.chromaFalloff" (ngModelChange)="setCurve({ chromaFalloff: +$event })" />
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <div class="flex justify-between text-xs text-ink-600 mb-1"><span>Hue ↑light</span><span class="font-mono">{{ r.curve.hueShiftLight }}°</span></div>
                <input type="range" min="-30" max="30" step="1" class="w-full accent-forge-600"
                  [ngModel]="r.curve.hueShiftLight" (ngModelChange)="setCurve({ hueShiftLight: +$event })" />
              </label>
              <label class="block">
                <div class="flex justify-between text-xs text-ink-600 mb-1"><span>Hue ↓dark</span><span class="font-mono">{{ r.curve.hueShiftDark }}°</span></div>
                <input type="range" min="-30" max="30" step="1" class="w-full accent-forge-600"
                  [ngModel]="r.curve.hueShiftDark" (ngModelChange)="setCurve({ hueShiftDark: +$event })" />
              </label>
            </div>

            <label class="flex items-center gap-2 text-xs text-ink-600">
              <span class="w-24">Distribution</span>
              <select class="flex-1 border border-ink-200 rounded px-2 py-1 text-sm focus:outline-none"
                [ngModel]="r.curve.easing" (ngModelChange)="setCurve({ easing: $event })">
                <option value="linear">Linear</option>
                <option value="ease">Ease</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
              </select>
            </label>
          </section>

          <!-- Preview -->
          <section>
            <div class="flex items-center justify-between mb-2">
              <div class="text-[11px] uppercase tracking-wide text-ink-400">Preview</div>
              <div class="text-[10px] text-ink-400">click a swatch to detach/relink</div>
            </div>
            @for (mode of modeIds(); track mode) {
              @if (modeIds().length > 1) { <div class="text-[11px] text-ink-500 mb-1 mt-2">{{ mode }}</div> }
              <div class="flex rounded-md overflow-hidden border border-ink-200">
                @for (cell of preview(mode); track cell.step) {
                  <button
                    type="button"
                    class="flex-1 h-14 relative flex flex-col items-center justify-end pb-1 transition-transform"
                    [style.background]="cell.hex"
                    [title]="cell.step + ' — ' + cell.hex + (cell.detached ? ' (detached)' : '')"
                    (click)="toggleDetached(cell.step)"
                  >
                    @if (cell.base) {
                      <svg class="absolute top-1 right-1 w-3 h-3 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5" /></svg>
                    }
                    @if (cell.detached) {
                      <svg class="absolute top-1 left-1 w-3 h-3 text-white drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 5.5 8.5" /><path d="M15 7h2a5 5 0 0 1 1.5 8.5" /><line x1="4" y1="4" x2="20" y2="20" /></svg>
                    }
                    <span class="text-[9px] font-medium px-0.5 rounded bg-black/25 text-white leading-tight">{{ cell.step }}</span>
                  </button>
                }
              </div>
            }
          </section>
        </div>

        <!-- Footer -->
        <div class="flex items-center gap-2 px-4 py-3 border-t border-ink-200">
          @if (hasStoredRecipe()) {
            <button type="button" class="text-xs text-ink-500 hover:text-red-600" (click)="remove()">Remove recipe</button>
          }
          <span class="flex-1"></span>
          <button type="button" class="text-xs px-3 py-1.5 rounded-md border border-ink-200 text-ink-600 hover:bg-ink-100" (click)="close()">Close</button>
          <button
            type="button"
            class="text-xs font-medium px-3 py-1.5 rounded-md bg-forge-600 text-white hover:bg-forge-700 disabled:opacity-40"
            [disabled]="busy()"
            (click)="generate()"
          >
            {{ busy() ? 'Generating…' : 'Generate' }}
          </button>
        </div>
      </aside>
    }
  `,
})
export class PaletteEditorComponent {
  private readonly store = inject(ProjectStore);
  private readonly ui = inject(UiService);
  private readonly picker = inject(CellPickerService);

  /** Working copy of the recipe being edited (null when the panel is closed). */
  readonly recipe = signal<PaletteRecipe | null>(null);
  readonly busy = signal(false);
  /** Whether a recipe is already persisted for this group (drives "Remove"). */
  readonly hasStoredRecipe = signal(false);
  /** Draft name in the "add step" input. */
  readonly newStep = signal('');
  /** Steps removed in the editor — their tokens are deleted on Generate. */
  private readonly pendingDeletes = signal<Set<string>>(new Set());

  readonly modeIds = computed<string[]>(() => {
    const ids = this.store.modes().map((m) => m.id);
    return ids.length ? ids : ['default'];
  });

  readonly groupLabel = computed(() => {
    const t = this.ui.paletteEditorTarget();
    return t ? t.groupPath.join(' / ') || t.collection : '';
  });

  constructor() {
    effect(() => {
      const target = this.ui.paletteEditorTarget();
      if (!target) {
        this.recipe.set(null);
        return;
      }
      untracked(() => this.load(target.collection, target.groupPath));
    });
  }

  /** Load a stored recipe, or infer/seed one from the group's existing steps. */
  private load(collection: string, groupPath: string[]): void {
    this.newStep.set('');
    this.pendingDeletes.set(new Set());
    const stored = this.store.paletteFor(collection, groupPath);
    if (stored) {
      this.hasStoredRecipe.set(true);
      this.recipe.set(structuredClone(stored));
      return;
    }
    this.hasStoredRecipe.set(false);

    // Observe the group's current step colours (per mode) to seed the editor.
    const prefix = groupPath.join('.');
    const observed: ObservedStep[] = this.store
      .allTokens()
      .filter((t) => t.path.length === groupPath.length + 1 && t.path.slice(0, -1).join('.') === prefix)
      .map((t) => {
        const byMode: Record<string, string> = {};
        for (const mode of this.modeIds()) {
          const v = t.resolvedValuesByMode[mode] ?? t.rawValuesByMode[mode];
          const hex = typeof v === 'string' ? v : cssColor(v);
          if (hex) byMode[mode] = hex;
        }
        return { step: t.path[t.path.length - 1]!, byMode };
      });

    const inferred = inferRecipe(collection, groupPath, observed, this.modeIds());
    if (inferred) {
      this.recipe.set(inferred);
      return;
    }

    const seed = observed.find((o) => o.step === '500') ?? observed[0];
    const bases: Record<string, string> = {};
    for (const mode of this.modeIds()) bases[mode] = seed?.byMode[mode] ?? '#3b82f6';
    this.recipe.set({
      collection,
      groupPath,
      steps: [...DEFAULT_STEPS],
      baseStep: '500',
      bases,
      curve: { ...DEFAULT_CURVE },
      detached: [],
      format: detectFormat(bases[this.modeIds()[0]]),
    });
  }

  /**
   * Base colour of a mode shown in the current output notation, so every mode
   * field stays consistent when the format switches (a mode still stored as hex
   * displays as OKLCH once OKLCH is selected — matching what Generate writes).
   */
  baseValue(mode: string): string {
    const r = this.recipe();
    if (!r) return '';
    const raw = r.bases[mode];
    return raw ? toFormat(raw, r.format) : '';
  }

  openBasePicker(mode: string, event: MouseEvent): void {
    const r = this.recipe();
    if (!r) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Seed in the current output notation so the picker opens in the matching
    // sub-mode (an `oklch(…)` value opens the OKLCH tab).
    const current = this.baseValue(mode) || r.bases[mode] || '#000000';
    this.picker.open({
      tokenId: 'palette-base:' + mode,
      mode,
      type: 'color',
      raw: current,
      resolved: current,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      tab: 'custom',
      customOnly: true,
      onPick: (value) => {
        // Follow the notation the user picked (OKLCH stays OKLCH, hex stays hex).
        this.setBase(mode, value);
        this.setFormat(detectFormat(value));
      },
    });
  }

  setBase(mode: string, hex: string): void {
    this.patch((r) => ({ ...r, bases: { ...r.bases, [mode]: hex } }));
  }

  readonly formats = FORMATS;
  setFormat(format: PaletteFormat): void {
    this.patch((r) => ({ ...r, format }));
  }

  /** The next sensible step name, shown as the add-input placeholder. */
  suggestedStep(): string {
    const r = this.recipe();
    return r ? suggestNextStep(r.steps) : '';
  }

  /** Keep the add-step input to digits only (shading steps are numeric). */
  onNewStep(value: string): void {
    this.newStep.set(value.replace(/[^0-9]/g, ''));
  }

  private stepSort(a: string, b: string): number {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  }

  /**
   * Add a step. `useSuggestion` (Enter) falls back to the suggested next step
   * when the input is empty; blur never auto-adds. Names must be numeric so the
   * scale stays coherent (50, 100, 900…) — a non-numeric entry is rejected.
   */
  addStep(useSuggestion = false): void {
    const raw = this.newStep().trim();
    const name = raw || (useSuggestion ? this.suggestedStep() : '');
    this.newStep.set('');
    const r = this.recipe();
    if (!r || !name) return;
    if (!isValidStepName(name)) {
      this.ui.showToast('Step names must be numeric (50, 100, 900…).', 3500);
      return;
    }
    if (r.steps.includes(name)) return;
    this.pendingDeletes.update((s) => {
      const n = new Set(s);
      n.delete(name);
      return n;
    });
    this.recipe.set({ ...r, steps: [...r.steps, name].sort((a, b) => this.stepSort(a, b)) });
  }

  removeStep(step: string): void {
    const r = this.recipe();
    if (!r || r.steps.length <= 2) return;
    const steps = r.steps.filter((s) => s !== step);
    const detached = r.detached.filter((s) => s !== step);
    let baseStep = r.baseStep;
    if (baseStep === step) {
      baseStep = steps.includes('500') ? '500' : steps[Math.floor((steps.length - 1) / 2)]!;
    }
    this.pendingDeletes.update((s) => {
      const n = new Set(s);
      n.add(step);
      return n;
    });
    this.recipe.set({ ...r, steps, detached, baseStep });
  }
  setBaseStep(step: string): void {
    this.patch((r) => ({ ...r, baseStep: step }));
  }
  setCurve(partial: Partial<PaletteCurve>): void {
    this.patch((r) => ({ ...r, curve: { ...r.curve, ...partial } }));
  }
  toggleDetached(step: string): void {
    this.patch((r) => ({
      ...r,
      detached: r.detached.includes(step)
        ? r.detached.filter((s) => s !== step)
        : [...r.detached, step],
    }));
  }

  private patch(fn: (r: PaletteRecipe) => PaletteRecipe): void {
    const r = this.recipe();
    if (r) this.recipe.set(fn(r));
  }

  preview(mode: string): PreviewCell[] {
    const r = this.recipe();
    if (!r) return [];
    const detached = new Set(r.detached);
    return generateScale(r, mode).map((s) => {
      const isDetached = detached.has(s.step);
      const hex = isDetached ? (this.currentStepColor(s.step, mode) ?? s.hex) : s.hex;
      return { step: s.step, hex, base: s.step === r.baseStep, detached: isDetached };
    });
  }

  private currentStepColor(step: string, mode: string): string | null {
    const r = this.recipe();
    if (!r) return null;
    const path = [...r.groupPath, step].join('.');
    const tok = this.store.allTokens().find((t) => t.path.join('.') === path);
    if (!tok) return null;
    const v = tok.resolvedValuesByMode[mode] ?? tok.rawValuesByMode[mode];
    return typeof v === 'string' ? v : cssColor(v);
  }

  async generate(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    this.busy.set(true);
    const deletes = [...this.pendingDeletes()].filter((s) => !r.steps.includes(s));
    try {
      const ok = await this.store.applyPalette(r, deletes);
      if (ok) {
        this.hasStoredRecipe.set(true);
        this.pendingDeletes.set(new Set());
      }
    } finally {
      this.busy.set(false);
    }
  }

  async remove(): Promise<void> {
    const r = this.recipe();
    if (!r) return;
    await this.store.deletePalette(r.collection, r.groupPath);
    this.close();
  }

  close(): void {
    this.ui.closePaletteEditor();
  }
}
