import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { ApiService } from '../../core/api.service';
import { UiService } from '../../core/ui.service';
import type {
  DistBuildReport,
  DistMatrix,
  DistributionState,
  MatrixSource,
  MatrixTarget,
  RenderStrategy,
  TargetRendering,
  WriteDistributionResult,
} from '../../core/models';

type Step = 1 | 2 | 3;
type OutputFile = DistBuildReport['outputs'][number];
interface OutputGroup { type: string; label: string; files: OutputFile[]; bytes: number; downloadable: boolean }
const OUTPUT_GROUPS: { type: string; label: string }[] = [
  { type: 'css', label: 'CSS' },
  { type: 'scss', label: 'SCSS' },
  { type: 'less', label: 'Less' },
  { type: 'typescript', label: 'JavaScript / TypeScript' },
  { type: 'json', label: 'JSON' },
  { type: 'other', label: 'Other' },
];
function groupTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'css') return 'css';
  if (ext === 'scss' || ext === 'sass') return 'scss';
  if (ext === 'less') return 'less';
  if (ext === 'ts' || ext === 'js' || ext === 'mjs') return 'typescript';
  if (ext === 'json') return 'json';
  return 'other';
}
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'files';
}

/** Friendly output presets → SD format + a sensible default folder. */
const TARGET_PRESETS: { label: string; format: string; dest: string }[] = [
  { label: 'CSS variables', format: 'css/variables', dest: 'src/styles/generated' },
  { label: 'SCSS variables', format: 'scss/variables', dest: 'src/styles/generated' },
  { label: 'TypeScript', format: 'javascript/es6', dest: 'src/app/theme/tokens' },
  { label: 'JSON', format: 'json/nested', dest: 'src/tokens' },
];
const STRATEGY_LABELS: { id: RenderStrategy; label: string }[] = [
  { id: 'selectors', label: 'CSS selectors' },
  { id: 'media', label: 'Media queries' },
  { id: 'files', label: 'Separate files' },
  { id: 'single', label: 'Single (flat)' },
];
const TOKENS_STUDIO_HINT =
  'Adds the @tokens-studio/sd-transforms preprocessor before the build. Enable it only if your tokens follow the Tokens Studio format (composite typography/shadow/border objects, rem math, references like {…}). Leave off for plain DTCG tokens.';

/**
 * Style Dictionary wizard — Variants → Outputs → Build & test, driven by a
 * `DistMatrix` (sources × targets × per-source render strategy). Mirrors the
 * resolver wizard's self-contained shape (own test/save/persist), but its build
 * is a real Style Dictionary v5 pipeline: the generated `tokens.build.mjs`
 * imports `style-dictionary`, so the badge/warnings remind the user to install
 * it. The host chooses this engine via the segmented control.
 */
@Component({
  selector: 'tf-sd-wizard',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (matrix(); as mx) {
      <div class="space-y-4">
        <!-- Step tabs + persistent actions -->
        <div class="flex items-center gap-1 border-b border-ink-200 flex-wrap">
          @for (s of steps; track s.n) {
            <button class="px-3 py-2 text-[13px] -mb-px border-b-2"
              [class.border-forge-500]="step() === s.n" [class.text-forge-700]="step() === s.n" [class.font-medium]="step() === s.n"
              [class.border-transparent]="step() !== s.n" [class.text-ink-500]="step() !== s.n"
              (click)="step.set(s.n)">{{ s.n }}. {{ s.label }}</button>
          }
          <span class="flex-1"></span>
          <button class="text-sm font-medium px-3 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 inline-flex items-center gap-2"
            [disabled]="testing()" (click)="runTest()">
            @if (testing()) { <span class="w-3.5 h-3.5 border-2 border-ink-300 border-t-ink-600 rounded-full tf-spin"></span> Testing… } @else { ▸ Test build }
          </button>
          <button class="text-sm font-medium px-3 py-1.5 rounded-md bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40 inline-flex items-center gap-2"
            [disabled]="saving()" (click)="save()">
            @if (saving()) { <span class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full tf-spin"></span> Saving… } @else { 💾 Save build }
          </button>
          <button class="text-sm px-3 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="done.emit()">Home</button>
        </div>

        @switch (step()) {
          @case (1) {
            <p class="text-ink-500 max-w-2xl text-xs">Variants detected per collection (modes or theme files). No meaning is inferred — adjust the list if a detection is wrong.</p>
            <div class="space-y-2">
              @for (s of mx.sources; track s.id; let i = $index) {
                <div class="border border-ink-200 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-medium text-ink-900 w-32 shrink-0">{{ s.label }}</span>
                    <div class="flex-1 flex flex-wrap items-center gap-1.5">
                      @for (v of s.variants; track $index; let vi = $index) {
                        <span class="font-mono text-[11px] bg-ink-100 text-ink-700 px-2 py-0.5 rounded-md flex items-center gap-1.5">
                          {{ v.name }}@if (v.file) { <span class="text-ink-400" title="theme file">⛁</span> }
                          <button class="text-ink-400 hover:text-red-600" (click)="removeVariant(i, vi)">×</button>
                        </span>
                      }
                      @if (s.variants.length === 0) { <span class="text-xs text-ink-400">no variant</span> }
                      <input class="w-28 border border-ink-200 rounded px-2 py-0.5 text-[11px]" placeholder="+ variant" [ngModel]="addDraft()[s.id] || ''" (ngModelChange)="setAddDraft(s.id, $event)" (keydown.enter)="addVariant(i)" />
                    </div>
                    <label class="text-[11px] text-ink-500 flex items-center gap-1.5 shrink-0">wrap
                      <input class="w-24 border border-ink-200 rounded px-2 py-0.5 font-mono text-[11px]" [ngModel]="s.wrapUnder || ''" (ngModelChange)="setWrap(i, $event)" placeholder="(none)" />
                    </label>
                  </div>
                  <div class="font-mono text-[11px] text-ink-400 truncate">{{ s.files.join(' · ') }}</div>
                </div>
              }
            </div>
            <label class="mt-4 flex items-center gap-3 text-xs text-ink-500">Source root
              <input class="w-56 border border-ink-200 rounded px-2 py-1 font-mono text-xs" [ngModel]="mx.sourceRoot" (ngModelChange)="setSourceRoot($event)" placeholder="(project root)" />
            </label>
          }

          @case (2) {
            <div class="flex items-center justify-between mb-3">
              <p class="text-ink-500 max-w-xl text-xs">What to generate and where. For each collection with variants, choose the render strategy (prefilled from the names).</p>
              <div class="flex items-center gap-2">
                <select class="border border-ink-200 rounded px-2 py-1 text-xs bg-white" [ngModel]="newPreset()" (ngModelChange)="newPreset.set($event)">
                  @for (p of presets; track p.label) { <option [value]="p.label">{{ p.label }}</option> }
                </select>
                <button class="text-xs font-medium px-2.5 py-1 rounded-md bg-ink-950 text-white hover:bg-ink-800" (click)="addTarget()">+ Output</button>
              </div>
            </div>
            @if (mx.targets.length === 0) { <p class="text-xs text-ink-400">No output — add one.</p> }
            <div class="space-y-3">
              @for (t of mx.targets; track t.id; let ti = $index) {
                <div class="border border-ink-200 rounded-lg p-3">
                  <div class="flex items-center gap-2 mb-2">
                    <input class="font-medium text-ink-900 border-b border-transparent hover:border-ink-200 focus:border-forge-500 focus:outline-none w-40" [ngModel]="t.label" (ngModelChange)="setTarget(ti, 'label', $event)" />
                    <input list="tf-sd-formats" class="border border-ink-200 rounded px-2 py-1 text-xs w-40" [ngModel]="t.format" (ngModelChange)="setTarget(ti, 'format', $event)" />
                    <span class="text-ink-300 text-xs">→</span>
                    <input class="flex-1 border border-ink-200 rounded px-2 py-1 font-mono text-[11px]" [ngModel]="t.destination" (ngModelChange)="setTarget(ti, 'destination', $event)" />
                    <input class="w-20 border border-ink-200 rounded px-2 py-1 font-mono text-[11px]" [ngModel]="t.prefix || ''" (ngModelChange)="setTarget(ti, 'prefix', $event)" placeholder="prefix" />
                    <button class="text-ink-300 hover:text-red-600 text-xs" (click)="removeTarget(ti)">Remove</button>
                  </div>
                  <div class="space-y-2 pl-1">
                    @for (s of sourcesWithVariants(); track s.id) {
                      <div class="border border-ink-100 rounded-md px-3 py-2 bg-ink-50/40">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="font-medium text-xs w-28">{{ s.label }}</span>
                          <select class="border border-ink-200 rounded px-2 py-0.5 text-xs bg-white" [ngModel]="rendering(t, s).strategy" (ngModelChange)="setStrategy(ti, s.id, $event)">
                            @for (st of strategies; track st.id) { <option [value]="st.id">{{ st.label }}</option> }
                          </select>
                          <span class="text-[10px] text-ink-400">{{ variantNames(s).length }} variant(s)</span>
                        </div>
                        @if (rendering(t, s).strategy === 'selectors' || rendering(t, s).strategy === 'media') {
                          <div class="grid grid-cols-2 gap-1.5">
                            @for (vn of variantNames(s); track vn) {
                              <div class="flex items-center gap-2 text-[11px]">
                                <span class="font-mono w-20 shrink-0 text-ink-500 truncate">{{ vn }}</span>
                                <input class="flex-1 border border-ink-200 rounded px-2 py-0.5 font-mono text-[11px]" [ngModel]="mapOf(t, s, vn)" (ngModelChange)="setMap(ti, s.id, vn, $event)"
                                  [placeholder]="rendering(t, s).strategy === 'selectors' ? ':root' : '(min-width: …)'" />
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                    @if (sourcesWithVariants().length === 0) { <p class="text-[11px] text-ink-400">No collection with variants — flat output.</p> }
                  </div>
                </div>
              }
            </div>
          }

          @case (3) {
            <div class="flex items-center gap-3 flex-wrap">
              <label class="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" [checked]="mx.tokensStudio === true" (change)="setTokensStudio($event)" /> Tokens Studio preset
                <span class="w-3.5 h-3.5 rounded-full border border-ink-300 text-ink-400 text-[9px] flex items-center justify-center cursor-help" [title]="tokensStudioHint">i</span>
              </label>
              <span class="flex-1"></span>
              @if (saved()) { <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Saved {{ saved()!.scriptPath }}</span> }
              @if (report()) {
                <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class.bg-green-100]="report()!.ok" [class.text-green-700]="report()!.ok" [class.bg-red-100]="!report()!.ok" [class.text-red-700]="!report()!.ok">
                  {{ report()!.ok ? '✓ Build OK' : '✗ Failed' }}@if (report()!.durationMs) { · {{ report()!.durationMs }}ms }
                </span>
              }
            </div>
            @if (written(); as w) {
              <div class="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-xs text-green-800 mt-3">
                <div class="font-medium mb-1">✓ Style Dictionary build saved to your project</div>
                <div>Script: <code class="font-mono">{{ w.scriptPath }}</code> · matrix persisted (<code class="font-mono">.tokenflow/distribution.json</code>)</div>
                @if (w.addedDependencies.length) {
                  <div class="mt-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1.5">
                    Added to <code class="font-mono">devDependencies</code>: {{ w.addedDependencies.join(', ') }}.
                    Run <code class="font-mono bg-amber-100 px-1.5 py-0.5 rounded">npm install</code> before building.
                  </div>
                }
                <div class="mt-1.5">Run the conversion: <code class="font-mono bg-green-100 px-1.5 py-0.5 rounded">npm run {{ w.npmScript.name }}</code>{{ w.npmAdded ? ' (added to package.json)' : ' (npm script already present)' }}</div>
              </div>
            }
            @if (!report()) {
              <p class="text-ink-400 text-xs mt-3">"Test build" runs the conversion in a sandbox (your project is never written). "Save build" writes the script + the npm script into your project.</p>
            }
          }
        }

        <!-- Report -->
        @if (report(); as r) {
          <div class="border-t border-ink-200 pt-3">
            @if (r.error) { <div class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 mb-3">{{ r.error }}</div> }
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Diagnostics ({{ r.diagnostics.length }})</div>
                @if (r.diagnostics.length === 0) { <p class="text-xs text-green-600">No issues.</p> }
                <div class="space-y-1">
                  @for (d of r.diagnostics; track $index) {
                    <div class="text-xs rounded-md px-2 py-1.5 border"
                      [class.border-red-200]="d.level === 'error'" [class.bg-red-50]="d.level === 'error'" [class.text-red-700]="d.level === 'error'"
                      [class.border-amber-200]="d.level !== 'error'" [class.bg-amber-50]="d.level !== 'error'" [class.text-amber-800]="d.level !== 'error'">
                      <span class="font-medium">{{ d.level === 'error' ? '●' : '▲' }}</span> {{ d.message }}
                    </div>
                  }
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between gap-2 mb-1.5">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400">Output files ({{ r.outputs.length }})</div>
                  @if (anyDownloadable()) { <button type="button" class="text-[11px] text-forge-600 hover:underline shrink-0" (click)="downloadAll()">⬇ Download all (.zip)</button> }
                </div>
                @if (r.outputs.length === 0) { <p class="text-xs text-ink-400">No file listed.</p> }
                <div class="space-y-1.5">
                  @for (g of outputGroups(); track g.type) {
                    <div class="border border-ink-200 rounded overflow-hidden">
                      <div class="flex items-center gap-2 px-2 py-1.5 bg-ink-50">
                        <button type="button" class="flex items-center gap-1.5 min-w-0 flex-1 text-left" (click)="toggleGroup(g.type)">
                          <svg class="w-3.5 h-3.5 shrink-0 text-ink-400 transition-transform" [class.rotate-90]="!collapsed()[g.type]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                          <span class="text-[11px] font-medium text-ink-700">{{ g.label }}</span>
                          <span class="text-[10px] text-ink-400">{{ g.files.length }} file{{ g.files.length === 1 ? '' : 's' }} · {{ kb(g.bytes) }}</span>
                        </button>
                        @if (g.downloadable) { <button type="button" class="text-[11px] text-forge-600 hover:underline shrink-0" (click)="downloadGroup(g)">⬇ .zip</button> }
                      </div>
                      @if (!collapsed()[g.type]) {
                        <div class="px-2 py-1.5 space-y-1">
                          @for (o of g.files; track $index) {
                            <div class="flex items-center gap-2 text-xs">
                              <span class="px-1.5 py-0.5 rounded bg-ink-100 text-ink-600 text-[10px]">{{ o.target }}</span>
                              <span class="font-mono truncate flex-1">{{ o.file }}</span>
                              <span class="text-ink-400 text-[10px]">{{ kb(o.bytes) }}</span>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
          </div>
        }
      </div>
      <datalist id="tf-sd-formats">@for (f of formatOptions; track f) { <option [value]="f"></option> }</datalist>
    } @else {
      <p class="text-sm text-ink-400">No token collection detected in this project.</p>
    }
  `,
  styles: [`.tf-spin { animation: tf-rot 0.7s linear infinite; } @keyframes tf-rot { to { transform: rotate(360deg); } }`],
})
export class SdWizardComponent {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);

  readonly state = input.required<DistributionState>();
  /** Also clean the previously-active mode's sidecar on save (opt-in from the host). */
  readonly cleanPrevious = input(false);
  readonly done = output<void>();
  /** Emitted after a successful save so the host can refresh its state (activeMode, badges). */
  readonly persisted = output<void>();

  readonly steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Variants' },
    { n: 2, label: 'Outputs' },
    { n: 3, label: 'Build & test' },
  ];
  readonly presets = TARGET_PRESETS;
  readonly strategies = STRATEGY_LABELS;
  readonly formatOptions = [...new Set(TARGET_PRESETS.map((p) => p.format))];
  readonly tokensStudioHint = TOKENS_STUDIO_HINT;

  readonly matrix = signal<DistMatrix | null>(null);
  readonly step = signal<Step>(1);
  readonly testing = signal(false);
  readonly saving = signal(false);
  readonly report = signal<DistBuildReport | null>(null);
  readonly written = signal<WriteDistributionResult | null>(null);
  readonly saved = signal<{ scriptPath: string } | null>(null);
  readonly newPreset = signal(TARGET_PRESETS[0]!.label);
  readonly addDraft = signal<Record<string, string>>({});
  readonly collapsed = signal<Record<string, boolean>>({});

  readonly sourcesWithVariants = computed(() => (this.matrix()?.sources ?? []).filter((s) => s.variants.length > 0));

  constructor() {
    effect(() => {
      const s = this.state();
      if (s && !this.matrix()) {
        this.matrix.set((s.savedMatrix as DistMatrix | null) ?? this.restore(s) ?? deriveMatrix(s) ?? { sourceRoot: '', sources: [], targets: [] });
      }
    });
  }

  // ---- persistence (draft scoped by projectId) ----
  private draftKey(s: DistributionState): string { return `tf.dist.matrix:${s.projectId}`; }
  private restore(s: DistributionState): DistMatrix | null {
    try {
      const raw = localStorage.getItem(this.draftKey(s));
      return raw ? (JSON.parse(raw) as DistMatrix) : null;
    } catch { return null; }
  }
  private persist(): void {
    try { localStorage.setItem(this.draftKey(this.state()), JSON.stringify(this.matrix())); } catch { /* ignore */ }
  }
  private mutate(fn: (m: DistMatrix) => void): void {
    const m = this.matrix();
    if (!m) return;
    const next = structuredClone(m);
    fn(next);
    this.matrix.set(next);
    this.saved.set(null);
    this.persist();
  }

  variantNames(s: MatrixSource): string[] { return s.variants.map((v) => v.name); }
  kb(b: number): string { return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} kB`; }
  toggleGroup(type: string): void { this.collapsed.set({ ...this.collapsed(), [type]: !this.collapsed()[type] }); }

  // ---- step 1: variants ----
  setWrap(i: number, v: string): void {
    this.mutate((m) => { const s = m.sources[i]; if (s) { if (v.trim()) s.wrapUnder = v.trim(); else delete s.wrapUnder; } });
  }
  setSourceRoot(v: string): void { this.mutate((m) => { m.sourceRoot = v; }); }
  removeVariant(i: number, vi: number): void { this.mutate((m) => m.sources[i]?.variants.splice(vi, 1)); }
  setAddDraft(id: string, v: string): void { this.addDraft.update((d) => ({ ...d, [id]: v })); }
  addVariant(i: number): void {
    const s = this.matrix()?.sources[i];
    if (!s) return;
    const name = (this.addDraft()[s.id] || '').trim();
    if (!name) return;
    this.mutate((m) => { if (!m.sources[i]!.variants.some((v) => v.name === name)) m.sources[i]!.variants.push({ name }); });
    this.setAddDraft(s.id, '');
  }

  // ---- step 2: targets ----
  addTarget(): void {
    const p = TARGET_PRESETS.find((x) => x.label === this.newPreset()) ?? TARGET_PRESETS[0]!;
    this.mutate((m) => {
      const id = uniqueId(m.targets.map((t) => t.id), p.format.split('/')[0]!);
      m.targets.push({ id, label: p.label, format: p.format, destination: p.dest, sources: 'all' });
    });
  }
  setTarget(i: number, key: 'label' | 'format' | 'destination' | 'prefix', v: string): void {
    this.mutate((m) => {
      const t = m.targets[i];
      if (!t) return;
      if (key === 'label') t.label = v;
      else if (key === 'format') t.format = v;
      else if (key === 'destination') t.destination = v;
      else if (v.trim()) t.prefix = v;
      else delete t.prefix;
    });
  }
  removeTarget(i: number): void { this.mutate((m) => m.targets.splice(i, 1)); }

  /** Effective rendering for (target, source): explicit override else heuristic default. */
  rendering(t: MatrixTarget, s: MatrixSource): TargetRendering {
    return t.rendering?.[s.id] ?? defaultRendering(s, t.format);
  }
  mapOf(t: MatrixTarget, s: MatrixSource, variant: string): string {
    return this.rendering(t, s).map?.[variant] ?? '';
  }
  private ensureRendering(t: MatrixTarget, sid: string): TargetRendering {
    const s = this.matrix()!.sources.find((x) => x.id === sid)!;
    return t.rendering?.[sid] ?? defaultRendering(s, t.format);
  }
  setStrategy(ti: number, sid: string, strategy: RenderStrategy): void {
    this.mutate((m) => {
      const t = m.targets[ti]!;
      const cur = this.ensureRendering(t, sid);
      t.rendering = { ...(t.rendering ?? {}), [sid]: { strategy, map: cur.map } };
    });
  }
  setMap(ti: number, sid: string, variant: string, value: string): void {
    this.mutate((m) => {
      const t = m.targets[ti]!;
      const cur = this.ensureRendering(t, sid);
      const map = { ...(cur.map ?? {}) };
      if (value.trim()) map[variant] = value;
      else delete map[variant];
      t.rendering = { ...(t.rendering ?? {}), [sid]: { strategy: cur.strategy, map } };
    });
  }
  setTokensStudio(e: Event): void {
    const on = (e.target as HTMLInputElement).checked;
    this.mutate((m) => { if (on) m.tokensStudio = true; else delete m.tokensStudio; });
  }

  // ---- test / save ----
  async runTest(): Promise<void> {
    const m = this.matrix();
    if (!m || this.testing()) return;
    this.testing.set(true);
    this.report.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.testBuild(m)));
    } catch (err) {
      this.report.set({ ok: false, outputs: [], diagnostics: [], error: errMsg(err, 'Test build failed') });
    } finally {
      this.testing.set(false);
    }
  }

  async save(): Promise<void> {
    const m = this.matrix();
    if (!m || this.saving()) return;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.api.writeDistribution(m, this.cleanPrevious()));
      this.written.set(res);
      this.saved.set({ scriptPath: res.scriptPath });
      this.step.set(3);
      this.ui.showToast(res.npmAdded ? `Created · npm run ${res.npmScript.name}` : `Build script written: ${res.scriptPath}`);
      this.persisted.emit();
    } catch (err) {
      this.ui.showToast(errMsg(err, 'Write failed'), 4000);
    } finally {
      this.saving.set(false);
    }
  }

  readonly outputGroups = computed<OutputGroup[]>(() => {
    const byType = new Map<string, OutputGroup>();
    for (const o of this.report()?.outputs ?? []) {
      const type = groupTypeOf(o.file);
      let g = byType.get(type);
      if (!g) { g = { type, label: OUTPUT_GROUPS.find((x) => x.type === type)?.label ?? type, files: [], bytes: 0, downloadable: false }; byType.set(type, g); }
      g.files.push(o);
      g.bytes += o.bytes;
      if (o.content != null) g.downloadable = true;
    }
    return OUTPUT_GROUPS.map((x) => byType.get(x.type)).filter((g): g is OutputGroup => !!g);
  });
  readonly anyDownloadable = computed(() => this.outputGroups().some((g) => g.downloadable));

  async downloadGroup(g: OutputGroup): Promise<void> {
    const zip = new JSZip();
    for (const o of g.files) if (o.content != null) zip.file(`${safeName(o.target)}/${o.file}`, o.content);
    await this.saveZip(zip, `tokens-${g.type}.zip`);
  }
  async downloadAll(): Promise<void> {
    const zip = new JSZip();
    for (const o of this.report()?.outputs ?? []) if (o.content != null) zip.file(`${groupTypeOf(o.file)}/${safeName(o.target)}/${o.file}`, o.content);
    await this.saveZip(zip, 'tokens-all.zip');
  }
  private async saveZip(zip: JSZip, filename: string): Promise<void> {
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** Build a starter matrix from the detected collections. */
function deriveMatrix(s: DistributionState): DistMatrix | null {
  if (!s.collections.length) return null;
  const sources: MatrixSource[] = s.collections.map((c) => {
    const id = c.name.replace(/[^a-zA-Z0-9]+/g, '-');
    let variants: MatrixSource['variants'] = [];
    if (c.files.length > 1 && c.modes.length === c.files.length) variants = c.files.map((f, i) => ({ name: c.modes[i] ?? baseName(f), file: f }));
    else if (c.modes.length > 1) variants = c.modes.map((mn) => ({ name: mn }));
    const src: MatrixSource = { id, label: c.name, files: c.files, variants };
    if (/primitive/i.test(c.name)) src.wrapUnder = 'primitives';
    return src;
  });
  const targets: MatrixTarget[] = [
    { id: 'css', label: 'CSS variables', format: 'css/variables', destination: 'src/styles/generated', sources: 'all' },
  ];
  return { sourceRoot: '', sources, targets };
}

/** Client mirror of the server heuristic, so the UI shows sensible defaults. */
function defaultRendering(s: MatrixSource, format: string): TargetRendering {
  const modes = s.variants.filter((v) => !v.file).map((v) => v.name);
  const fileVars = s.variants.some((v) => v.file);
  const css = format === 'css/variables';
  let strategy: RenderStrategy;
  if (fileVars) strategy = 'files';
  else if (!modes.length) strategy = 'single';
  else if (!css) strategy = 'single';
  else if (modes.every((mn) => /light|dark|theme/i.test(mn))) strategy = 'selectors';
  else if (modes.some((mn) => /desktop|tablet|mobile|width|screen|^(xs|sm|md|lg|xl)$/i.test(mn))) strategy = 'media';
  else strategy = 'files';
  const map: Record<string, string> = {};
  for (const mn of modes) {
    if (strategy === 'selectors') map[mn] = /dark/i.test(mn) ? "[data-theme='dark']" : ':root';
    else if (strategy === 'media') map[mn] = /tablet/i.test(mn) ? '(min-width: 1024px)' : /desktop/i.test(mn) ? '(min-width: 1440px)' : '';
  }
  return { strategy, map };
}

function baseName(p: string): string {
  return (p.split('/').pop() ?? p).replace(/\.(json|tokens\.json)$/i, '');
}
function uniqueId(taken: string[], base: string): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}${i}`)) return `${base}${i}`;
}
function errMsg(err: unknown, fallback: string): string {
  const e = err as { error?: { error?: string }; message?: string };
  return e?.error?.error ?? e?.message ?? fallback;
}
