import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { ApiService } from '../../core/api.service';
import type {
  DistBuildReport,
  DistConfig,
  DistributionState,
  ModeAxis,
  Output,
  TokenFormat,
} from '../../core/models';

type OutputFile = DistBuildReport['outputs'][number];
interface OutputGroup { type: string; label: string; files: OutputFile[]; bytes: number; downloadable: boolean }
const OUTPUT_GROUPS: { type: string; label: string }[] = [
  { type: 'scss', label: 'SCSS' },
  { type: 'css', label: 'CSS' },
  { type: 'typescript', label: 'TypeScript' },
  { type: 'json', label: 'JSON' },
  { type: 'other', label: 'Other' },
];
function groupTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'scss' || ext === 'sass') return 'scss';
  if (ext === 'css') return 'css';
  if (ext === 'ts' || ext === 'js') return 'typescript';
  if (ext === 'json') return 'json';
  return 'other';
}

const FORMAT_LABEL: Record<TokenFormat, string> = {
  'css-vars': 'CSS variables',
  'scss-vars': 'SCSS variables',
  'scss-mixin': 'SCSS mixin',
  ts: 'TypeScript',
  json: 'JSON',
};
const FORMAT_HINT: Record<TokenFormat, string> = {
  'css-vars': 'Modes render as :root + attribute selectors / @media, from each collection’s mapping below.',
  'scss-vars': 'Flat $variables, case preserved. No selectors — best for mode-less tokens.',
  'scss-mixin': 'A themes map + @mixin emitting CSS variables, with per-brand activation classes.',
  ts: 'Nested objects, modes as keys. References resolved to literal values.',
  json: 'Nested JSON, modes as keys. References resolved to literal values.',
};
const FORMATS: TokenFormat[] = ['css-vars', 'scss-vars', 'scss-mixin', 'ts', 'json'];

/**
 * Deterministic-resolver wizard. Outputs are tabs (one per emitter: format +
 * destination + the collections it writes); the mode mapping lives once per
 * collection and every format interprets it (selectors for CSS / SCSS-mixin,
 * nested keys for TS / JSON, ignored by flat SCSS vars). The same tokens can be
 * emitted in several formats to different folders.
 */
@Component({
  selector: 'tf-resolver-wizard',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (config(); as cfg) {
      <div class="space-y-4">
        <!-- Build & test -->
        <div class="flex items-center gap-2.5 flex-wrap">
          <button class="text-sm font-medium px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 flex items-center gap-2"
            [disabled]="testing()" (click)="runTest()">
            @if (testing()) { <span class="w-3.5 h-3.5 border-2 border-ink-300 border-t-ink-600 rounded-full tf-spin"></span> Testing… }
            @else { <svg class="w-5 h-5 text-forge-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" /></svg> Test build }
          </button>
          <button class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40 flex items-center gap-2"
            [disabled]="saving()" (click)="save()">
            @if (saving()) { <span class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full tf-spin"></span> Saving… } @else { 💾 Save script }
          </button>
          <button class="text-sm px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="resetProposal()" title="Discard edits and reload the auto-detected proposal">↺ Reset</button>
          <button class="text-sm px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="done.emit()">Home</button>
          <label class="flex items-center gap-1.5 text-xs text-ink-500 cursor-pointer ml-1"><input type="checkbox" [ngModel]="cfg.manifest" (ngModelChange)="setManifest($event)" /> Emit manifest</label>
          <span class="flex-1"></span>
          @if (saved()) { <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ Saved {{ saved()!.scriptPath }}</span> }
          @if (report(); as r) {
            <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class.bg-green-100]="r.ok" [class.text-green-700]="r.ok" [class.bg-red-100]="!r.ok" [class.text-red-700]="!r.ok">
              {{ r.ok ? '✓ OK' : '✗ Failed' }}@if (r.durationMs) { · {{ r.durationMs }}ms }
            </span>
          }
        </div>

        <!-- Output tabs -->
        <div class="flex items-center gap-1 border-b border-ink-200 flex-wrap">
          @for (o of cfg.outputs; track o.id; let i = $index) {
            <button class="px-3 py-2 text-[13px] -mb-px border-b-2"
              [class.border-forge-500]="active() === i" [class.text-forge-700]="active() === i" [class.font-medium]="active() === i"
              [class.border-transparent]="active() !== i" [class.text-ink-500]="active() !== i"
              (click)="active.set(i)">{{ formatLabel(o.format) }}</button>
          }
          <span class="flex-1"></span>
          <button class="text-[13px] px-2.5 py-1.5 text-ink-600 hover:text-forge-700" (click)="addOutput()">+ Add output</button>
        </div>

        @if (cfg.outputs[active()]; as out) {
          <!-- Format + path -->
          <div class="flex items-center gap-3 flex-wrap">
            <label class="flex items-center gap-1.5 text-xs"><span class="text-ink-400">Format</span>
              <select class="border border-ink-200 rounded px-2 py-1 text-[13px]" [ngModel]="out.format" (ngModelChange)="setFormat(active(), $event)">
                @for (f of formats; track f) { <option [value]="f">{{ formatLabel(f) }}</option> }
              </select>
            </label>
            <label class="flex items-center gap-1.5 text-xs flex-1 min-w-[200px]"><span class="text-ink-400">Path</span>
              <input class="border border-ink-200 rounded px-2 py-1 font-mono text-[11px] flex-1" [ngModel]="out.destination" (ngModelChange)="setDest(active(), $event)" />
            </label>
            @if (cfg.outputs.length > 1) {
              <button class="text-[11px] text-ink-400 hover:text-red-600" (click)="removeOutput(active())">Remove output</button>
            }
          </div>
          <div class="text-[11px] text-forge-700 bg-forge-50 border border-forge-100 rounded-md px-2.5 py-1.5">{{ formatHint(out.format) }}</div>

          <!-- Collections in this output -->
          <div class="text-[11px] uppercase tracking-wide text-ink-400">Collections in this output</div>
          @for (c of cfg.collections; track c.id; let ci = $index) {
            <div class="border border-ink-200 rounded-lg p-3" [class.opacity-55]="!included(out, c.id)">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-ink-900 text-sm">{{ c.id }}</span>
                <span class="flex-1"></span>
                @if (included(out, c.id)) {
                  <label class="flex items-center gap-1.5 text-[11px]"><span class="text-ink-400">prefix</span>
                    <input class="border border-ink-200 rounded px-1.5 py-0.5 font-mono w-28" [ngModel]="c.prefix" (ngModelChange)="setPrefix(ci, $event)" placeholder="(none)" />
                  </label>
                  @if (usesScssName(out.format)) {
                    <label class="flex items-center gap-1.5 text-[11px] cursor-pointer"><input type="checkbox" [ngModel]="c.preserveCase" (ngModelChange)="setPreserveCase(ci, $event)" /> <span class="text-ink-500">preserveCase</span></label>
                  }
                }
                <button class="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border"
                  [class.text-green-700]="included(out, c.id)" [class.bg-green-50]="included(out, c.id)" [class.border-green-200]="included(out, c.id)"
                  [class.text-ink-500]="!included(out, c.id)" [class.bg-ink-50]="!included(out, c.id)" [class.border-ink-200]="!included(out, c.id)"
                  (click)="toggleCollection(active(), c.id)">{{ included(out, c.id) ? 'Included' : 'Ignored' }}</button>
              </div>

              @if (included(out, c.id)) {
                @if (usesSelectors(out.format)) {
                  @for (a of c.modeAxes; track a.name; let ai = $index) {
                    <div class="rounded-md bg-ink-50/70 border border-ink-100 p-2.5 mt-2">
                      <div class="flex items-center gap-2 flex-wrap mb-1.5 text-[11px]">
                        <span class="font-medium text-ink-700">{{ a.name }}</span>
                        <span class="px-1.5 py-0.5 rounded bg-white border border-ink-200 text-ink-500">source: {{ a.source }}</span>
                        <label class="flex items-center gap-1"><span class="text-ink-400">render</span>
                          <select class="border border-ink-200 rounded px-1 py-0.5" [ngModel]="a.strategy" (ngModelChange)="setStrategy(ci, ai, $event)">
                            <option value="selectors">selectors</option><option value="media">@media</option><option value="files">files</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1"><span class="text-ink-400">default</span>
                          <select class="border border-ink-200 rounded px-1 py-0.5" [ngModel]="a.default" (ngModelChange)="setDefault(ci, ai, $event)">
                            @for (m of modesOf(a); track m) { <option [value]="m">{{ m }}</option> }
                          </select>
                        </label>
                      </div>
                      <div class="space-y-1">
                        @for (m of modesOf(a); track m) {
                          <div class="flex items-center gap-2 text-[11px]">
                            <span class="font-mono w-32 shrink-0 truncate" [class.text-forge-700]="m === a.default" [title]="m">{{ m }}</span>
                            @if (m === a.default) {
                              <span class="font-mono text-ink-400">:root <span class="text-ink-300">(default)</span></span>
                            } @else {
                              <input class="border border-ink-200 rounded px-2 py-0.5 font-mono flex-1"
                                [ngModel]="a.map[m] || ''" (ngModelChange)="setMap(ci, ai, m, $event)"
                                [placeholder]="a.strategy === 'media' ? '(min-width: 768px)' : '[data-' + a.name + '=…]'" />
                            }
                          </div>
                        }
                      </div>
                    </div>
                  } @empty {
                    <p class="text-[11px] text-ink-400 mt-1">No modes — emitted once under <code>:root</code>.</p>
                  }
                } @else if (c.modeAxes.length) {
                  <p class="text-[11px] text-ink-400 mt-1">{{ modeHint(out.format) }}</p>
                }
              }
            </div>
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
                      <span class="font-medium">{{ d.level === 'error' ? '●' : '▲' }}</span> {{ d.message }}@if (d.reference) { <code class="font-mono">  {{ d.reference }}</code> }
                    </div>
                  }
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between gap-2 mb-1.5">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400">Output files ({{ r.outputs.length }})</div>
                  @if (anyDownloadable()) { <button type="button" class="text-[11px] text-forge-600 hover:underline shrink-0" (click)="downloadAll()">⬇ Download all (.zip)</button> }
                </div>
                @if (r.outputs.length === 0) { <p class="text-xs text-ink-400">No file produced.</p> }
                <div class="space-y-1.5">
                  @for (g of outputGroups(); track g.type) {
                    <div class="border border-ink-200 rounded overflow-hidden">
                      <div class="flex items-center gap-2 px-2 py-1.5 bg-ink-50">
                        <button type="button" class="flex items-center gap-1.5 min-w-0 flex-1 text-left" (click)="toggleGroup(g.type)">
                          <svg class="w-3.5 h-3.5 shrink-0 text-ink-400 transition-transform" [class.rotate-90]="!collapsed()[g.type]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                          <span class="text-[11px] font-medium text-ink-700">{{ g.label }}</span>
                          <span class="text-[10px] text-ink-400">{{ g.files.length }} file{{ g.files.length === 1 ? '' : 's' }} · {{ kb(g.bytes) }}</span>
                        </button>
                      </div>
                      @if (!collapsed()[g.type]) {
                        <div class="px-2 py-1.5 space-y-1.5">
                          @for (o of g.files; track $index) {
                            <div>
                              <div class="flex items-center gap-2 text-xs">
                                <span class="font-mono truncate flex-1">{{ o.file }}</span>
                                <span class="text-ink-400 text-[10px]">{{ kb(o.bytes) }}</span>
                                @if (o.content != null) { <button type="button" class="text-ink-400 hover:text-forge-600 text-[11px]" (click)="togglePreview(o.file)">{{ shown()[o.file] ? 'hide' : 'view' }}</button> }
                              </div>
                              @if (shown()[o.file] && o.content != null) {
                                <pre class="mt-1 max-h-48 overflow-auto scrollbar-thin bg-ink-950 text-ink-100 rounded p-2 text-[10px] leading-relaxed font-mono">{{ o.content }}</pre>
                              }
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
    } @else {
      <p class="text-sm text-ink-400">No collections detected.</p>
    }
  `,
  styles: [`.tf-spin { animation: tf-rot 0.7s linear infinite; } @keyframes tf-rot { to { transform: rotate(360deg); } }`],
})
export class ResolverWizardComponent {
  private readonly api = inject(ApiService);

  readonly state = input.required<DistributionState>();
  /** Also clean the previously-active mode's sidecar on save (opt-in from the host). */
  readonly cleanPrevious = input(false);
  readonly done = output<void>();
  /** Emitted after a successful save so the host can refresh its state (activeMode, badges). */
  readonly persisted = output<void>();

  readonly config = signal<DistConfig | null>(null);
  readonly active = signal(0);
  readonly testing = signal(false);
  readonly saving = signal(false);
  readonly report = signal<DistBuildReport | null>(null);
  readonly saved = signal<{ scriptPath: string } | null>(null);
  readonly collapsed = signal<Record<string, boolean>>({});
  readonly shown = signal<Record<string, boolean>>({});

  readonly formats = FORMATS;
  private seq = 0;

  constructor() {
    effect(() => {
      const s = this.state();
      if (s && !this.config()) this.config.set(this.clone(s.savedConfig ?? s.proposedConfig));
    });
  }

  formatLabel(f: TokenFormat): string { return FORMAT_LABEL[f] ?? f; }
  formatHint(f: TokenFormat): string { return FORMAT_HINT[f] ?? ''; }
  usesSelectors(f: TokenFormat): boolean { return f === 'css-vars' || f === 'scss-mixin'; }
  usesScssName(f: TokenFormat): boolean { return f === 'scss-vars' || f === 'scss-mixin'; }
  modeHint(f: TokenFormat): string { return f === 'scss-vars' ? 'Modes are flattened (default mode wins).' : 'Modes become nested object keys.'; }

  private clone(c: DistConfig): DistConfig { return JSON.parse(JSON.stringify(c)) as DistConfig; }
  private patch(fn: (c: DistConfig) => void): void {
    const next = this.clone(this.config()!);
    fn(next);
    this.config.set(next);
    this.saved.set(null);
  }

  modesOf(a: ModeAxis): string[] {
    const s = new Set<string>();
    if (a.default) s.add(a.default);
    for (const k of Object.keys(a.map ?? {})) s.add(k);
    if (a.fileMap) for (const v of Object.values(a.fileMap)) s.add(v);
    return [...s];
  }

  included(out: Output, id: string): boolean {
    return out.collections === 'all' || out.collections.includes(id);
  }
  toggleCollection(oi: number, id: string): void {
    this.patch((c) => {
      const out = c.outputs[oi]!;
      const allIds = c.collections.map((x) => x.id);
      let list = out.collections === 'all' ? [...allIds] : [...out.collections];
      list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      out.collections = allIds.length > 0 && allIds.every((x) => list.includes(x)) ? 'all' : list;
    });
  }

  setManifest(v: boolean): void { this.patch((c) => { c.manifest = v; }); }
  setFormat(oi: number, v: TokenFormat): void { this.patch((c) => { c.outputs[oi]!.format = v; }); }
  setDest(oi: number, v: string): void { this.patch((c) => { c.outputs[oi]!.destination = v; }); }
  addOutput(): void {
    const cur = this.config();
    const dest = cur?.outputs[this.active()]?.destination ?? 'src/styles/generated';
    this.patch((c) => { c.outputs.push({ id: `out-${++this.seq}-${c.outputs.length}`, format: 'css-vars', destination: dest, collections: 'all' }); });
    this.active.set(this.config()!.outputs.length - 1);
  }
  removeOutput(oi: number): void {
    this.patch((c) => { if (c.outputs.length > 1) c.outputs.splice(oi, 1); });
    this.active.set(Math.max(0, Math.min(this.active(), this.config()!.outputs.length - 1)));
  }

  setPrefix(ci: number, v: string): void { this.patch((c) => { c.collections[ci]!.prefix = v; }); }
  setPreserveCase(ci: number, v: boolean): void { this.patch((c) => { c.collections[ci]!.preserveCase = v; }); }
  setStrategy(ci: number, ai: number, v: ModeAxis['strategy']): void { this.patch((c) => { c.collections[ci]!.modeAxes[ai]!.strategy = v; }); }
  setDefault(ci: number, ai: number, v: string): void { this.patch((c) => { c.collections[ci]!.modeAxes[ai]!.default = v; }); }
  setMap(ci: number, ai: number, mode: string, v: string): void {
    this.patch((c) => { c.collections[ci]!.modeAxes[ai]!.map = { ...c.collections[ci]!.modeAxes[ai]!.map, [mode]: v }; });
  }

  resetProposal(): void {
    this.config.set(this.clone(this.state().proposedConfig));
    this.active.set(0);
    this.report.set(null);
    this.saved.set(null);
  }

  async runTest(): Promise<void> {
    const cfg = this.config();
    if (!cfg || this.testing()) return;
    this.testing.set(true);
    this.report.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.testBuildResolver(cfg)));
    } catch (err) {
      this.report.set({ ok: false, outputs: [], diagnostics: [], error: (err as Error).message });
    } finally {
      this.testing.set(false);
    }
  }

  async save(): Promise<void> {
    const cfg = this.config();
    if (!cfg || this.saving()) return;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.api.writeResolver(cfg, this.cleanPrevious()));
      this.saved.set({ scriptPath: res.scriptPath });
      this.persisted.emit();
    } catch (err) {
      this.report.set({ ok: false, outputs: [], diagnostics: [{ level: 'error', message: (err as Error).message }] });
    } finally {
      this.saving.set(false);
    }
  }

  kb(b: number): string { return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} kB`; }
  toggleGroup(type: string): void { this.collapsed.set({ ...this.collapsed(), [type]: !this.collapsed()[type] }); }
  togglePreview(file: string): void { this.shown.set({ ...this.shown(), [file]: !this.shown()[file] }); }

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

  async downloadAll(): Promise<void> {
    const zip = new JSZip();
    for (const o of this.report()?.outputs ?? []) if (o.content != null) zip.file(o.file, o.content);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tokens-distribution.zip';
    a.click();
    URL.revokeObjectURL(url);
  }
}
