import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
/** The configurator is a 3-state machine (landing + the two flows + overview). */
type View = 'landing' | 'assistant' | 'overview' | 'link';

type OutputFile = DistBuildReport['outputs'][number];
/** Output files bucketed by format family for the collapsible report view. */
interface OutputGroup {
  type: string;
  label: string;
  files: OutputFile[];
  bytes: number;
  /** At least one file has content the client can put into a zip. */
  downloadable: boolean;
}
/** Display order + label for each output-format bucket. */
const OUTPUT_GROUPS: { type: string; label: string }[] = [
  { type: 'css', label: 'CSS' },
  { type: 'scss', label: 'SCSS' },
  { type: 'less', label: 'Less' },
  { type: 'typescript', label: 'JavaScript / TypeScript' },
  { type: 'json', label: 'JSON' },
  { type: 'other', label: 'Other' },
];

/** Map an output filename to its format-group bucket via its extension. */
function groupTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'css') return 'css';
  if (ext === 'scss' || ext === 'sass') return 'scss';
  if (ext === 'less') return 'less';
  if (ext === 'ts' || ext === 'js' || ext === 'mjs') return 'typescript';
  if (ext === 'json') return 'json';
  return 'other';
}
/** Sanitize a target label into a safe zip folder name. */
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
 * Phase 4 (redesign) — Distribution configurator with a 3-state machine:
 *  • landing   — choose to configure (assistant) or link an existing build
 *  • assistant — Variants → Outputs → Build & test (TFM-managed v5)
 *  • overview  — summary of the configured pipeline (v5 or external)
 *  • link      — point at the project's own config + build command
 * The opening view is routed from the server state (saved matrix / v5 script /
 * linked external config). A collection has named variants (no guessed nature);
 * each target renders them with a generic per-source strategy.
 */
@Component({
  selector: 'tf-distribution',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.distributionOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30" (click)="close()">
        <div class="w-[1000px] max-w-[97vw] h-[680px] max-h-[93vh] bg-white rounded-xl shadow-2xl border border-ink-200 flex flex-col overflow-hidden" (click)="$event.stopPropagation()">

          <div class="px-5 py-3 border-b border-ink-200 flex items-center gap-3 shrink-0">
            <div class="font-semibold text-sm flex items-center gap-2">
              <svg class="w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>
              Distribution
            </div>
            <div class="flex-1 flex items-center justify-center gap-1 text-xs">
              @if (view() === 'assistant') {
                @for (s of steps; track s.n) {
                  <button class="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    [class.bg-forge-50]="step() === s.n" [class.text-forge-700]="step() === s.n" [class.font-medium]="step() === s.n"
                    [class.text-ink-400]="step() !== s.n" (click)="step.set(s.n)">
                    <span class="w-4 h-4 rounded-full text-[10px] flex items-center justify-center"
                      [class.bg-forge-600]="step() === s.n" [class.text-white]="step() === s.n"
                      [class.bg-ink-200]="step() !== s.n" [class.text-ink-600]="step() !== s.n">{{ s.n }}</span>
                    {{ s.label }}
                  </button>
                }
              }
            </div>
            <span class="text-[11px] font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              [class.bg-green-50]="sdInstalled()" [class.text-green-700]="sdInstalled()"
              [class.bg-ink-100]="!sdInstalled()" [class.text-ink-500]="!sdInstalled()"
              [title]="sdTitle()">{{ sdInstalled() ? '✓ ' : '' }}Style Dictionary {{ sdLabel() }}</span>
            <button class="text-ink-400 hover:text-ink-700 text-xl leading-none" (click)="close()">×</button>
          </div>

          @if (loading()) {
            <div class="flex-1 flex items-center justify-center text-sm text-ink-400">Loading…</div>
          } @else {
            <div class="flex-1 overflow-auto scrollbar-thin p-6 text-sm">
              @switch (view()) {

                @case ('landing') {
                  <div class="h-full flex flex-col items-center justify-center">
                    <h2 class="text-lg font-semibold text-ink-900 mb-1">Convert your tokens</h2>
                    <p class="text-ink-500 mb-7 text-center max-w-md">Generate CSS / SCSS / TS from your tokens, or hook into the build your project already has.</p>
                    <div class="grid grid-cols-2 gap-4 w-full max-w-2xl">
                      <button class="text-left border-2 border-forge-300 bg-forge-50/40 rounded-xl p-5 hover:border-forge-500 hover:bg-forge-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        [disabled]="!matrix()" (click)="goAssistant()">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-2xl">⚙️</span>
                          <span class="text-[10px] uppercase tracking-wide font-medium text-forge-700 bg-forge-100 px-2 py-0.5 rounded-full">Recommended</span>
                        </div>
                        <div class="font-semibold text-ink-900 mb-1">Configure the conversion</div>
                        <p class="text-xs text-ink-500">A wizard detects your variants (themes, modes) and generates the build script — testable in a sandbox before writing.</p>
                        @if (!matrix()) { <p class="text-[11px] text-amber-700 mt-2">No token collection detected.</p> }
                      </button>
                      <button class="text-left border-2 border-ink-200 rounded-xl p-5 hover:border-ink-400 hover:bg-ink-50 transition" (click)="goLink()">
                        <div class="mb-2"><span class="text-2xl">🔗</span></div>
                        <div class="font-semibold text-ink-900 mb-1">I already have my config</div>
                        <p class="text-xs text-ink-500">Hook into your existing config file and build command. TFM runs them for you.</p>
                        @if (detectedConfigs().length) {
                          <p class="text-[11px] text-ink-400 mt-2 font-mono truncate">detected: {{ detectedConfigs().join(' · ') }}</p>
                        } @else if (suggestedCommand()) {
                          <p class="text-[11px] text-ink-400 mt-2 font-mono truncate">command: {{ suggestedCommand() }}</p>
                        }
                      </button>
                    </div>
                  </div>
                }

                @case ('link') {
                  <div class="max-w-xl mx-auto">
                    <h2 class="text-base font-semibold text-ink-900 mb-1">Hook into your existing build</h2>
                    <p class="text-ink-500 text-xs mb-5">TFM generates nothing in this mode: it points at your config and runs your command.</p>

                    <label class="block mb-1 text-xs font-medium text-ink-700">Config file <span class="text-ink-400 font-normal">(optional)</span></label>
                    <input class="w-full border border-ink-200 rounded-md px-3 py-2 font-mono text-xs mb-1.5" [ngModel]="linkConfigPath()" (ngModelChange)="linkConfigPath.set($event)" placeholder="e.g. style-dictionary.config.js" />
                    @if (detectedConfigs().length) {
                      <div class="flex flex-wrap gap-1.5 mb-4">
                        @for (c of detectedConfigs(); track c) {
                          <button class="font-mono text-[11px] px-2 py-0.5 rounded-md border border-ink-200 hover:border-forge-400 hover:bg-forge-50" (click)="linkConfigPath.set(c)">{{ c }}</button>
                        }
                      </div>
                    } @else { <div class="mb-4"></div> }

                    <label class="block mb-1 text-xs font-medium text-ink-700">Build command</label>
                    <input class="w-full border border-ink-200 rounded-md px-3 py-2 font-mono text-xs mb-1.5" [ngModel]="linkCommand()" (ngModelChange)="linkCommand.set($event)" placeholder="e.g. npm run generate:tokens" />
                    @if (npmScripts().length) {
                      <div class="flex flex-wrap gap-1.5 mb-4">
                        @for (s of npmScripts(); track s.name) {
                          <button class="font-mono text-[11px] px-2 py-0.5 rounded-md border border-ink-200 hover:border-forge-400 hover:bg-forge-50" (click)="linkCommand.set('npm run ' + s.name)" [title]="s.command">npm run {{ s.name }}</button>
                        }
                      </div>
                    } @else { <div class="mb-4"></div> }

                    <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 mb-5">
                      ⚠️ Running this build executes your project's real command and <b>writes its output files</b> to disk (this is not a sandbox test).
                    </div>

                    <div class="flex items-center gap-3">
                      <button class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40 flex items-center gap-2" [disabled]="linking() || !linkCommand().trim()" (click)="doLink()">
                        @if (linking()) { <span class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full tf-spin"></span> Linking… } @else { 🔗 Link }
                      </button>
                      <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="backToLanding()">Cancel</button>
                    </div>
                  </div>
                }

                @case ('overview') {
                  <div class="flex items-center gap-3 mb-4 flex-wrap">
                    <button class="text-sm font-medium px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 flex items-center gap-2"
                      [disabled]="testing()" (click)="overviewMode() === 'v5' ? runTest() : runExternal()">
                      @if (testing()) { <span class="w-3.5 h-3.5 border-2 border-ink-300 border-t-ink-600 rounded-full tf-spin"></span> Running… }
                      @else if (overviewMode() === 'v5') { ▸ Test build }
                      @else { <span class="text-forge-600">▶</span> Run build }
                    </button>
                    <button class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800" (click)="modify()">Edit</button>
                    @if (openablePath()) {
                      <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="openFiles()">Open files</button>
                    }
                    @if (overviewMode() === 'external') {
                      <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200" [disabled]="unlinking()" (click)="doUnlink()">Unlink</button>
                    }
                    <span class="flex-1"></span>
                    @if (report()) {
                      <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class.bg-green-100]="report()!.ok" [class.text-green-700]="report()!.ok" [class.bg-red-100]="!report()!.ok" [class.text-red-700]="!report()!.ok">
                        {{ report()!.ok ? '✓ OK' : '✗ Failed' }}@if (report()!.durationMs) { · {{ report()!.durationMs }}ms }
                      </span>
                    }
                  </div>

                  @if (overviewMode() === 'external') {
                    <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 mb-4">
                      ⚠️ "Run build" executes your project's real command and <b>writes its outputs</b> to disk (not a sandbox test).
                    </div>
                    <div class="border border-ink-200 rounded-lg p-4 mb-4">
                      <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Linked external build</div>
                      @if (linked()?.configPath) {
                        <div class="flex items-center gap-2 text-sm mb-1"><span class="text-ink-400 w-20 shrink-0">Config</span><code class="font-mono text-xs">{{ linked()!.configPath }}</code></div>
                      }
                      <div class="flex items-center gap-2 text-sm"><span class="text-ink-400 w-20 shrink-0">Command</span><code class="font-mono text-xs bg-ink-100 px-1.5 py-0.5 rounded">{{ linked()!.buildCommand }}</code></div>
                    </div>
                  } @else {
                    <div class="border border-ink-200 rounded-lg p-4 mb-4">
                      <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Pipeline managed by TFM (Style Dictionary v5)</div>
                      @if (state()?.v5ScriptPath) {
                        <div class="text-xs text-ink-500 mb-3">Script: <code class="font-mono">{{ state()!.v5ScriptPath }}</code></div>
                      }
                      @if (matrix(); as mx) {
                        <div class="grid grid-cols-2 gap-5">
                          <div>
                            <div class="text-[11px] font-medium text-ink-600 mb-1.5">Sources ({{ mx.sources.length }})</div>
                            <div class="space-y-1.5">
                              @for (s of mx.sources; track s.id) {
                                <div class="text-xs">
                                  <span class="font-medium text-ink-800">{{ s.label }}</span>
                                  @if (s.variants.length) {
                                    <span class="text-ink-400"> — </span>
                                    @for (v of s.variants; track $index) { <span class="font-mono text-[10px] bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded ml-0.5">{{ v.name }}</span> }
                                  }
                                </div>
                              }
                            </div>
                          </div>
                          <div>
                            <div class="text-[11px] font-medium text-ink-600 mb-1.5">Targets ({{ mx.targets.length }})</div>
                            <div class="space-y-1.5">
                              @for (t of mx.targets; track t.id) {
                                <div class="text-xs flex items-center gap-2">
                                  <span class="px-1.5 py-0.5 rounded bg-ink-100 text-ink-600 text-[10px]">{{ t.format }}</span>
                                  <span class="font-mono text-[11px] text-ink-500 truncate">→ {{ t.destination }}</span>
                                </div>
                              }
                            </div>
                          </div>
                        </div>
                      }
                    </div>
                  }

                  @if (report()) { <ng-container [ngTemplateOutlet]="reportBlock" /> }
                  @else { <p class="text-ink-400 text-xs">{{ overviewHint() }}</p> }
                }

                @case ('assistant') {
                  @if (!matrix()) {
                    <div class="flex-1 flex items-center justify-center text-sm text-ink-400 p-8 text-center">No token collection detected in this project.</div>
                  } @else {
                    @switch (step()) {

                      @case (1) {
                        <p class="text-ink-500 mb-4 max-w-2xl">Variants detected per collection (modes or theme files). No meaning is inferred — adjust the list if a detection is wrong.</p>
                        <div class="space-y-2">
                          @for (s of m().sources; track s.id; let i = $index) {
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
                          <input class="w-56 border border-ink-200 rounded px-2 py-1 font-mono text-xs" [ngModel]="m().sourceRoot" (ngModelChange)="setSourceRoot($event)" placeholder="(project root)" />
                        </label>
                      }

                      @case (2) {
                        <div class="flex items-center justify-between mb-3">
                          <p class="text-ink-500 max-w-xl">What to generate and where. For each collection with variants, choose the render strategy (prefilled from the names).</p>
                          <div class="flex items-center gap-2">
                            <select class="border border-ink-200 rounded px-2 py-1 text-xs bg-white" [ngModel]="newPreset()" (ngModelChange)="newPreset.set($event)">
                              @for (p of presets; track p.label) { <option [value]="p.label">{{ p.label }}</option> }
                            </select>
                            <button class="text-xs font-medium px-2.5 py-1 rounded-md bg-ink-950 text-white hover:bg-ink-800" (click)="addTarget()">+ Output</button>
                          </div>
                        </div>
                        @if (m().targets.length === 0) { <p class="text-xs text-ink-400">No output — add one.</p> }
                        <div class="space-y-3">
                          @for (t of m().targets; track t.id; let ti = $index) {
                            <div class="border border-ink-200 rounded-lg p-3">
                              <div class="flex items-center gap-2 mb-2">
                                <input class="font-medium text-ink-900 border-b border-transparent hover:border-ink-200 focus:border-forge-500 focus:outline-none w-40" [ngModel]="t.label" (ngModelChange)="setTarget(ti, 'label', $event)" />
                                <input list="tf-formats" class="border border-ink-200 rounded px-2 py-1 text-xs w-40" [ngModel]="t.format" (ngModelChange)="setTarget(ti, 'format', $event)" />
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
                        <div class="flex items-center gap-3 mb-4">
                          <button class="text-sm font-medium px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 flex items-center gap-2" [disabled]="testing()" (click)="runTest()">
                            @if (testing()) { <span class="w-3.5 h-3.5 border-2 border-ink-300 border-t-ink-600 rounded-full tf-spin"></span> Running… } @else { ▸ Test build }
                          </button>
                          <button class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40 flex items-center gap-2" [disabled]="saving()" (click)="create()">
                            @if (saving()) { <span class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full tf-spin"></span> Writing… } @else { Save build }
                          </button>
                          <label class="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" [checked]="m().tokensStudio === true" (change)="setTokensStudio($event)" /> Tokens Studio preset
                            <span class="w-3.5 h-3.5 rounded-full border border-ink-300 text-ink-400 text-[9px] flex items-center justify-center cursor-help" [title]="tokensStudioHint">i</span>
                          </label>
                          <span class="flex-1"></span>
                          @if (report()) {
                            <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class.bg-green-100]="report()!.ok" [class.text-green-700]="report()!.ok" [class.bg-red-100]="!report()!.ok" [class.text-red-700]="!report()!.ok">
                              {{ report()!.ok ? '✓ Build OK' : '✗ Failed' }} · {{ report()!.durationMs }}ms
                            </span>
                          }
                        </div>
                        @if (written(); as w) {
                          <div class="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-xs text-green-800 mb-4">
                            <div class="font-medium mb-1">✓ Build saved to your project</div>
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
                          <p class="text-ink-400 text-xs">"Test build" runs the conversion in a sandbox (your project is never written). "Save build" writes the script + the npm script into your project.</p>
                        } @else { <ng-container [ngTemplateOutlet]="reportBlock" /> }
                      }
                    }
                  }
                }
              }
            </div>

            <div class="shrink-0 border-t border-ink-200 px-5 py-3 flex items-center gap-3">
              <span class="text-[11px] text-ink-400">Saved locally</span>
              <span class="flex-1"></span>
              @if (view() === 'assistant') {
                <button class="text-sm px-3 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="step() === 1 ? backToLanding() : step.set(prev())">{{ step() === 1 ? 'Home' : 'Back' }}</button>
                @if (step() < 3) { <button class="text-sm font-medium px-3.5 py-1.5 rounded-md bg-ink-950 text-white hover:bg-ink-800" (click)="step.set(next())">Next</button> }
              } @else if (view() === 'overview' || view() === 'link') {
                <button class="text-sm px-3 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="backToLanding()">Home</button>
              }
            </div>
          }
        </div>
      </div>
      <datalist id="tf-formats">@for (f of formatOptions; track f) { <option [value]="f"></option> }</datalist>

      <ng-template #reportBlock>
        @if (report(); as r) {
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
                @if (anyDownloadable()) {
                  <button type="button" class="text-[11px] text-forge-600 hover:underline shrink-0" (click)="downloadAll()">⬇ Download all (.zip)</button>
                }
              </div>
              @if (r.outputs.length === 0) { <p class="text-xs text-ink-400">No file listed.</p> }
              <div class="space-y-1.5">
                @for (g of outputGroups(); track g.type) {
                  <div class="border border-ink-200 rounded overflow-hidden">
                    <div class="flex items-center gap-2 px-2 py-1.5 bg-ink-50">
                      <button type="button" class="flex items-center gap-1.5 min-w-0 flex-1 text-left" (click)="toggleGroup(g.type)">
                        <svg class="w-3.5 h-3.5 shrink-0 text-ink-400 transition-transform" [class.rotate-90]="!collapsedGroups()[g.type]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        <span class="text-[11px] font-medium text-ink-700">{{ g.label }}</span>
                        <span class="text-[10px] text-ink-400">{{ g.files.length }} file{{ g.files.length === 1 ? '' : 's' }} · {{ kb(g.bytes) }}</span>
                      </button>
                      @if (g.downloadable) {
                        <button type="button" class="text-[11px] text-forge-600 hover:underline shrink-0" (click)="downloadGroup(g)">⬇ .zip</button>
                      }
                    </div>
                    @if (!collapsedGroups()[g.type]) {
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
        }
      </ng-template>
    }
  `,
  styles: [`.tf-spin { animation: tf-rot 0.7s linear infinite; } @keyframes tf-rot { to { transform: rotate(360deg); } }`],
})
export class DistributionComponent {
  private readonly api = inject(ApiService);
  readonly ui = inject(UiService);

  readonly steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Variants' },
    { n: 2, label: 'Outputs' },
    { n: 3, label: 'Build & test' },
  ];
  readonly presets = TARGET_PRESETS;
  readonly strategies = STRATEGY_LABELS;
  readonly formatOptions = [...new Set(TARGET_PRESETS.map((p) => p.format))];
  readonly tokensStudioHint = TOKENS_STUDIO_HINT;

  readonly state = signal<DistributionState | null>(null);
  readonly matrix = signal<DistMatrix | null>(null);
  readonly view = signal<View>('landing');
  readonly step = signal<Step>(1);
  readonly loading = signal(false);
  readonly testing = signal(false);
  readonly saving = signal(false);
  readonly linking = signal(false);
  readonly unlinking = signal(false);
  readonly report = signal<DistBuildReport | null>(null);
  readonly written = signal<WriteDistributionResult | null>(null);
  readonly newPreset = signal(TARGET_PRESETS[0]!.label);
  readonly addDraft = signal<Record<string, string>>({});
  readonly linkConfigPath = signal('');
  readonly linkCommand = signal('');

  readonly sdMode = computed(() => this.state()?.sdVersion.mode ?? 'none');
  readonly sdInstalled = computed(() => !!this.state()?.sdVersion.installed);
  readonly sdLabel = computed(() => {
    const v = this.state()?.sdVersion;
    return v?.installed ? `v${v.installed}` : 'not installed';
  });
  readonly sdTitle = computed(() => {
    const v = this.state()?.sdVersion;
    if (!v?.installed) return 'Style Dictionary is not installed in this project — the v5 wizard build needs it. (External builds run your own command regardless.)';
    if (v.mode === 'v5') return `Style Dictionary v${v.installed} detected — the v5 wizard can generate and test a build.`;
    return `Style Dictionary v${v.installed} detected. The v5 wizard targets SD v5+; use "I already have my config" to run your existing v${v.installed} build.`;
  });
  readonly sourcesWithVariants = computed(() => (this.matrix()?.sources ?? []).filter((s) => s.variants.length > 0));
  readonly linked = computed(() => this.state()?.linked ?? null);
  readonly detectedConfigs = computed(() => this.state()?.detectedConfigs ?? []);
  readonly npmScripts = computed(() => this.state()?.npmScripts ?? []);
  readonly suggestedCommand = computed(() => suggestCommand(this.state()));
  /** In overview: the project is TFM-managed (v5) when a matrix/script exists, else external. */
  readonly overviewMode = computed<'v5' | 'external'>(() => {
    const s = this.state();
    return s?.savedMatrix || s?.v5ScriptPath ? 'v5' : 'external';
  });
  readonly overviewHint = computed(() =>
    this.overviewMode() === 'v5'
      ? '"Test build" runs the conversion in a sandbox — your project is never written.'
      : '"Run build" executes your command — its output files will be written to disk.',
  );
  /** Best-effort file to open from the overview (the v5 script, or the linked config). */
  readonly openablePath = computed(() => {
    const s = this.state();
    if (!s) return null;
    if (this.overviewMode() === 'v5') return s.v5ScriptPath ?? s.buildScriptPath ?? null;
    return s.linked?.configPath || null;
  });

  constructor() {
    effect(() => {
      if (this.ui.distributionOpen()) void this.load();
    });
  }

  m(): DistMatrix {
    return this.matrix()!;
  }
  close(): void {
    this.ui.distributionOpen.set(false);
  }
  prev(): Step {
    return Math.max(1, this.step() - 1) as Step;
  }
  next(): Step {
    return Math.min(3, this.step() + 1) as Step;
  }
  kb(b: number): string {
    return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} kB`;
  }

  /** Collapsed state per output-format group (expanded by default). */
  readonly collapsedGroups = signal<Record<string, boolean>>({});
  /** Output files of the current report bucketed by format family, ordered. */
  readonly outputGroups = computed<OutputGroup[]>(() => {
    const outs = this.report()?.outputs ?? [];
    const byType = new Map<string, OutputGroup>();
    for (const o of outs) {
      const type = groupTypeOf(o.file);
      let g = byType.get(type);
      if (!g) {
        g = { type, label: OUTPUT_GROUPS.find((x) => x.type === type)?.label ?? type, files: [], bytes: 0, downloadable: false };
        byType.set(type, g);
      }
      g.files.push(o);
      g.bytes += o.bytes;
      if (o.content != null) g.downloadable = true;
    }
    return OUTPUT_GROUPS.map((x) => byType.get(x.type)).filter((g): g is OutputGroup => !!g);
  });
  readonly anyDownloadable = computed(() => this.outputGroups().some((g) => g.downloadable));

  toggleGroup(type: string): void {
    this.collapsedGroups.set({ ...this.collapsedGroups(), [type]: !this.collapsedGroups()[type] });
  }

  /** Build and download a zip of one format group, namespaced by target folder. */
  async downloadGroup(g: OutputGroup): Promise<void> {
    const zip = new JSZip();
    for (const o of g.files) {
      if (o.content == null) continue;
      zip.file(`${safeName(o.target)}/${o.file}`, o.content);
    }
    await this.saveZip(zip, `tokens-${g.type}.zip`);
  }

  /** Build and download a single zip of all files, grouped by type then target. */
  async downloadAll(): Promise<void> {
    const zip = new JSZip();
    for (const o of this.report()?.outputs ?? []) {
      if (o.content == null) continue;
      zip.file(`${groupTypeOf(o.file)}/${safeName(o.target)}/${o.file}`, o.content);
    }
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
  variantNames(s: MatrixSource): string[] {
    return s.variants.map((v) => v.name);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.report.set(null);
    try {
      const s = await firstValueFrom(this.api.getDistribution());
      this.state.set(s);
      this.written.set(null);
      // Prefer the server-persisted matrix, then the local draft, then a derived one.
      this.matrix.set((s.savedMatrix as DistMatrix | null) ?? this.restore(s) ?? deriveMatrix(s));
      // Prefill the link fields from the existing pointer or detections.
      this.linkConfigPath.set(s.linked?.configPath ?? s.detectedConfigs[0] ?? '');
      this.linkCommand.set(s.linked?.buildCommand ?? suggestCommand(s) ?? '');
      // Route to the opening view from the server state.
      this.view.set(s.savedMatrix || s.v5ScriptPath || s.linked ? 'overview' : 'landing');
    } catch {
      this.state.set(null);
      this.matrix.set(null);
      this.view.set('landing');
    } finally {
      this.loading.set(false);
    }
  }

  // ---- navigation between the 3 states ----
  goAssistant(): void {
    if (!this.matrix()) return;
    this.step.set(1);
    this.view.set('assistant');
  }
  goLink(): void {
    this.report.set(null);
    this.view.set('link');
  }
  backToLanding(): void {
    this.report.set(null);
    this.view.set('landing');
  }
  /** Overview "Edit" → the right flow for the current mode. */
  modify(): void {
    if (this.overviewMode() === 'v5') this.goAssistant();
    else this.goLink();
  }

  // ---- persistence ----
  // Drafts are scoped by projectId (the project root) — keying by manifestPath
  // collided across projects that have no manifest (both keyed by ''), leaking
  // the previous project's files into the wizard.
  private draftKey(s: DistributionState): string {
    return `tf.dist.matrix:${s.projectId}`;
  }
  private key(): string {
    const s = this.state();
    return s ? this.draftKey(s) : 'tf.dist.matrix:';
  }
  private restore(s: DistributionState): DistMatrix | null {
    try {
      const raw = localStorage.getItem(this.draftKey(s));
      return raw ? (JSON.parse(raw) as DistMatrix) : null;
    } catch {
      return null;
    }
  }
  private persist(): void {
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.matrix()));
    } catch {
      /* ignore */
    }
  }
  private mutate(fn: (m: DistMatrix) => void): void {
    const m = this.matrix();
    if (!m) return;
    const next = structuredClone(m);
    fn(next);
    this.matrix.set(next);
    this.persist();
  }

  // ---- step 1: variants ----
  setWrap(i: number, v: string): void {
    this.mutate((m) => { const s = m.sources[i]; if (s) { if (v.trim()) s.wrapUnder = v.trim(); else delete s.wrapUnder; } });
  }
  setSourceRoot(v: string): void {
    this.mutate((m) => { m.sourceRoot = v; });
  }
  removeVariant(i: number, vi: number): void {
    this.mutate((m) => m.sources[i]?.variants.splice(vi, 1));
  }
  setAddDraft(id: string, v: string): void {
    this.addDraft.update((d) => ({ ...d, [id]: v }));
  }
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
  removeTarget(i: number): void {
    this.mutate((m) => m.targets.splice(i, 1));
  }

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

  // ---- step 3: write files ----
  async create(): Promise<void> {
    const m = this.matrix();
    if (!m) return;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.api.writeDistribution(m));
      this.written.set(res);
      this.ui.showToast(res.npmAdded ? `Created · npm run ${res.npmScript.name}` : `Build script written: ${res.scriptPath}`);
    } catch (err) {
      this.ui.showToast(errMsg(err, 'Write failed'), 4000);
    } finally {
      this.saving.set(false);
    }
  }

  // ---- test (v5 sandbox) ----
  async runTest(): Promise<void> {
    const m = this.matrix();
    if (!m) return;
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

  // ---- external build (real — writes outputs) ----
  async runExternal(): Promise<void> {
    const cmd = this.linked()?.buildCommand;
    if (!cmd) return;
    this.testing.set(true);
    this.report.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.runCommand(cmd)));
    } catch (err) {
      this.report.set({ ok: false, outputs: [], diagnostics: [], error: errMsg(err, 'Build command failed') });
    } finally {
      this.testing.set(false);
    }
  }

  async doLink(): Promise<void> {
    const cmd = this.linkCommand().trim();
    if (!cmd) return;
    this.linking.set(true);
    try {
      const s = await firstValueFrom(this.api.linkExisting(this.linkConfigPath().trim(), cmd));
      this.state.set(s);
      this.report.set(null);
      this.view.set('overview');
      this.ui.showToast('External build linked');
    } catch (err) {
      this.ui.showToast(errMsg(err, 'Link failed'), 4000);
    } finally {
      this.linking.set(false);
    }
  }

  async doUnlink(): Promise<void> {
    this.unlinking.set(true);
    try {
      const s = await firstValueFrom(this.api.unlinkDistribution());
      this.state.set(s);
      this.report.set(null);
      this.view.set(s.savedMatrix || s.v5ScriptPath ? 'overview' : 'landing');
      this.ui.showToast('External build unlinked');
    } catch (err) {
      this.ui.showToast(errMsg(err, 'Unlink failed'), 4000);
    } finally {
      this.unlinking.set(false);
    }
  }

  async openFiles(): Promise<void> {
    const p = this.openablePath();
    if (!p) return;
    try {
      const res = await firstValueFrom(this.api.openDistributionFile(p));
      if (!res.ok) this.ui.showToast('Could not open the file', 3000);
    } catch {
      this.ui.showToast('Could not open the file', 3000);
    }
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

/** Suggest a build command from the project's token-related npm scripts. */
function suggestCommand(s: DistributionState | null): string {
  if (!s?.npmScripts.length) return '';
  const hit = s.npmScripts.find((x) => /token|theme|generate|build.*token|sd|style.?dict/i.test(x.name))
    ?? s.npmScripts[0]!;
  return `npm run ${hit.name}`;
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
