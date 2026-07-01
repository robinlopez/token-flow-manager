import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { ApiService } from '../../core/api.service';
import { UiService } from '../../core/ui.service';
import { ResolverWizardComponent } from './resolver-wizard.component';
import { SdWizardComponent } from './sd-wizard.component';
import type { DistBuildReport, DistMatrix, DistributionMode, DistributionState } from '../../core/models';

/** The configurator state machine (landing + configure + overview + link). */
type View = 'landing' | 'configure' | 'overview' | 'link';
/** Which build engine the "Configure the conversion" flow drives. */
type Engine = 'resolver' | 'style-dictionary';

type OutputFile = DistBuildReport['outputs'][number];
/** Output files bucketed by format family for the collapsible report view. */
interface OutputGroup {
  type: string;
  label: string;
  files: OutputFile[];
  bytes: number;
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

/** Human label for an active mode (overview badge). */
const MODE_LABEL: Record<DistributionMode, string> = {
  resolver: 'Deterministic resolver',
  'style-dictionary': 'Style Dictionary',
  linked: 'External build',
  none: 'Not configured',
};

/**
 * Distribution configurator shell — a 4-state machine:
 *  • landing   — choose to configure (an engine) or link an existing build
 *  • configure — pick the engine (Resolver / Style Dictionary) and drive its wizard
 *  • overview  — summary of the configured pipeline (active mode) + change mode
 *  • link      — point at the project's own config + build command
 * The opening view is routed from the server's detected `activeMode`. Switching
 * to an engine that differs from the active mode shows a warning banner (the
 * shared `tokens.build.mjs` has one owner) with an opt-in "clean previous".
 */
@Component({
  selector: 'tf-distribution',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, ResolverWizardComponent, SdWizardComponent],
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
              @if (view() === 'configure') { <span class="text-ink-400">Configure the conversion</span> }
            </div>
            @if (showSdBadge()) {
              <span class="text-[11px] font-mono px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                [class.bg-green-50]="sdInstalled()" [class.text-green-700]="sdInstalled()"
                [class.bg-ink-100]="!sdInstalled()" [class.text-ink-500]="!sdInstalled()"
                [title]="sdTitle()">{{ sdInstalled() ? '✓ ' : '' }}Style Dictionary {{ sdLabel() }}</span>
            }
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
                        [disabled]="!hasCollections()" (click)="goConfigure()">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-2xl">⚙️</span>
                          <span class="text-[10px] uppercase tracking-wide font-medium text-forge-700 bg-forge-100 px-2 py-0.5 rounded-full">Recommended</span>
                        </div>
                        <div class="font-semibold text-ink-900 mb-1">Configure the conversion</div>
                        <p class="text-xs text-ink-500">Generate a build from your tokens — a deterministic SD-free resolver (recommended) or a Style Dictionary pipeline. Test it in a sandbox before writing.</p>
                        @if (!hasCollections()) { <p class="text-[11px] text-amber-700 mt-2">No token collection detected.</p> }
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
                    @if (activeMode() !== 'none') {
                      <button class="mt-6 text-xs text-ink-500 hover:text-forge-700" (click)="view.set('overview')">← Back to current configuration ({{ modeLabel(activeMode()) }})</button>
                    }
                  </div>
                }

                @case ('link') {
                  <div class="max-w-xl mx-auto">
                    <h2 class="text-base font-semibold text-ink-900 mb-1">Hook into your existing build</h2>
                    <p class="text-ink-500 text-xs mb-5">TFM generates nothing in this mode: it points at your config and runs your command.</p>

                    @if (linkWarning(); as w) {
                      <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 mb-4">
                        <div class="font-medium mb-0.5">⚠️ Switching mode</div>
                        <div>{{ w }}</div>
                        <label class="flex items-center gap-1.5 mt-2 cursor-pointer"><input type="checkbox" [ngModel]="cleanPrevious()" (ngModelChange)="cleanPrevious.set($event)" /> {{ cleanLabel() }}</label>
                      </div>
                    }

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
                    <span class="text-[11px] font-medium px-2 py-1 rounded-md bg-ink-100 text-ink-700">{{ modeLabel(activeMode()) }}</span>
                    <button class="text-sm font-medium px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40 flex items-center gap-2"
                      [disabled]="testing()" (click)="overviewMode() === 'v5' ? runTest() : runExternal()">
                      @if (testing()) { <span class="w-3.5 h-3.5 border-2 border-ink-300 border-t-ink-600 rounded-full tf-spin"></span> Running… }
                      @else if (overviewMode() === 'v5') { ▸ Test build }
                      @else { <span class="text-forge-600">▶</span> Run build }
                    </button>
                    <button class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800" (click)="modify()">Edit</button>
                    <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="goConfigure()">Change mode</button>
                    @if (openablePath()) {
                      <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="openFiles()">Open files</button>
                    }
                    @if (activeMode() === 'linked') {
                      <button class="text-sm px-3.5 py-2 rounded-lg border border-ink-200 text-ink-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200" [disabled]="unlinking()" (click)="doUnlink()">Unlink</button>
                    }
                    <span class="flex-1"></span>
                    @if (report()) {
                      <span class="text-xs px-2 py-0.5 rounded-full font-medium" [class.bg-green-100]="report()!.ok" [class.text-green-700]="report()!.ok" [class.bg-red-100]="!report()!.ok" [class.text-red-700]="!report()!.ok">
                        {{ report()!.ok ? '✓ OK' : '✗ Failed' }}@if (report()!.durationMs) { · {{ report()!.durationMs }}ms }
                      </span>
                    }
                  </div>

                  @if (activeMode() === 'linked') {
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
                      <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Pipeline managed by TFM ({{ modeLabel(activeMode()) }})</div>
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
                      } @else {
                        <p class="text-xs text-ink-400">Open "Edit" to review or change this pipeline.</p>
                      }
                    </div>
                  }

                  @if (report()) { <ng-container [ngTemplateOutlet]="reportBlock" /> }
                  @else { <p class="text-ink-400 text-xs">{{ overviewHint() }}</p> }
                }

                @case ('configure') {
                  <div>
                    <!-- Engine selector (segmented control) -->
                    <div class="flex items-center gap-2.5 flex-wrap">
                      <span class="text-xs font-medium text-ink-500">Engine</span>
                      <div class="inline-flex items-center gap-1 rounded-xl bg-ink-100 p-1">
                        <button type="button" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] transition-all duration-150"
                          [class.bg-white]="engine() === 'resolver'" [class.text-forge-700]="engine() === 'resolver'" [class.shadow-sm]="engine() === 'resolver'" [class.font-medium]="engine() === 'resolver'"
                          [class.text-ink-500]="engine() !== 'resolver'" [class.hover:text-ink-800]="engine() !== 'resolver'"
                          (click)="setEngine('resolver')">
                          Deterministic resolver
                          <span class="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full leading-none"
                            [class.bg-forge-100]="engine() === 'resolver'" [class.text-forge-700]="engine() === 'resolver'"
                            [class.bg-ink-200]="engine() !== 'resolver'" [class.text-ink-500]="engine() !== 'resolver'">rec</span>
                        </button>
                        <button type="button" class="px-3.5 py-1.5 rounded-lg text-[13px] transition-all duration-150"
                          [class.bg-white]="engine() === 'style-dictionary'" [class.text-forge-700]="engine() === 'style-dictionary'" [class.shadow-sm]="engine() === 'style-dictionary'" [class.font-medium]="engine() === 'style-dictionary'"
                          [class.text-ink-500]="engine() !== 'style-dictionary'" [class.hover:text-ink-800]="engine() !== 'style-dictionary'"
                          (click)="setEngine('style-dictionary')">Style Dictionary</button>
                      </div>
                    </div>

                    <!-- Switch warning banner -->
                    @if (switchWarning(); as w) {
                      <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 mt-4">
                        <div class="font-medium mb-0.5">⚠️ Switching mode</div>
                        <div>{{ w }}</div>
                        <label class="flex items-center gap-1.5 mt-2 cursor-pointer"><input type="checkbox" [ngModel]="cleanPrevious()" (ngModelChange)="cleanPrevious.set($event)" /> {{ cleanLabel() }}</label>
                      </div>
                    }

                    <!-- The engine's wizard (separated from the selector) -->
                    <div class="mt-6 pt-6 border-t border-ink-100">
                      @if (engine() === 'resolver') {
                        <tf-resolver-wizard [state]="state()!" [cleanPrevious]="cleanPrevious()" (persisted)="onPersisted()" (done)="backToLanding()" />
                      } @else {
                        <tf-sd-wizard [state]="state()!" [cleanPrevious]="cleanPrevious()" (persisted)="onPersisted()" (done)="backToLanding()" />
                      }
                    </div>
                  </div>
                }
              }
            </div>

            <div class="shrink-0 border-t border-ink-200 px-5 py-3 flex items-center gap-3">
              <span class="text-[11px] text-ink-400">Saved locally</span>
              <span class="flex-1"></span>
              @if (view() === 'overview' || view() === 'link' || view() === 'configure') {
                <button class="text-sm px-3 py-1.5 rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50" (click)="backToLanding()">Home</button>
              }
            </div>
          }
        </div>
      </div>

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

  readonly state = signal<DistributionState | null>(null);
  readonly view = signal<View>('landing');
  readonly engine = signal<Engine>('resolver');
  /** Opt-in: also remove the previously-active mode's sidecar when saving a switch. */
  readonly cleanPrevious = signal(false);
  readonly loading = signal(false);
  readonly testing = signal(false);
  readonly linking = signal(false);
  readonly unlinking = signal(false);
  readonly report = signal<DistBuildReport | null>(null);
  readonly linkConfigPath = signal('');
  readonly linkCommand = signal('');

  readonly activeMode = computed<DistributionMode>(() => this.state()?.activeMode ?? 'none');
  readonly sdInstalled = computed(() => !!this.state()?.sdVersion.installed);
  readonly sdLabel = computed(() => {
    const v = this.state()?.sdVersion;
    return v?.installed ? `v${v.installed}` : 'not installed';
  });
  readonly sdTitle = computed(() => {
    const v = this.state()?.sdVersion;
    if (!v?.installed) return 'Style Dictionary is not installed in this project — the Style Dictionary build script needs it. (The deterministic resolver needs no dependency.)';
    if (v.mode === 'v5') return `Style Dictionary v${v.installed} detected — the Style Dictionary wizard can generate and test a build.`;
    return `Style Dictionary v${v.installed} detected. The wizard targets SD v5+; use "I already have my config" to run your existing v${v.installed} build.`;
  });
  /** The Style Dictionary badge is only meaningful when SD is the current context. */
  readonly showSdBadge = computed(() => {
    const v = this.view();
    if (v === 'configure') return this.engine() === 'style-dictionary';
    if (v === 'overview') return this.activeMode() === 'style-dictionary';
    if (v === 'link') return true;
    return false;
  });

  readonly linked = computed(() => this.state()?.linked ?? null);
  readonly detectedConfigs = computed(() => this.state()?.detectedConfigs ?? []);
  readonly hasCollections = computed(() => (this.state()?.collections?.length ?? 0) > 0);
  readonly npmScripts = computed(() => this.state()?.npmScripts ?? []);
  readonly suggestedCommand = computed(() => suggestCommand(this.state()));

  /** Read-only view of the persisted SD matrix (drives the overview summary + test build). */
  readonly matrix = computed<DistMatrix | null>(() => (this.state()?.savedMatrix as DistMatrix | null) ?? null);
  /** In overview: an external (linked) build runs its own command; everything else tests a sandboxed build. */
  readonly overviewMode = computed<'v5' | 'external'>(() => (this.activeMode() === 'linked' ? 'external' : 'v5'));
  readonly overviewHint = computed(() =>
    this.overviewMode() === 'v5'
      ? '"Test build" runs the conversion in a sandbox — your project is never written.'
      : '"Run build" executes your command — its output files will be written to disk.',
  );
  /** Best-effort file to open from the overview (the build script, or the linked config). */
  readonly openablePath = computed(() => {
    const s = this.state();
    if (!s) return null;
    if (this.activeMode() === 'linked') return s.linked?.configPath || null;
    return s.v5ScriptPath ?? s.buildScriptPath ?? null;
  });

  /** Warning shown in `configure` when the chosen engine differs from the active mode. */
  readonly switchWarning = computed<string | null>(() => this.warnFor(this.engine()));
  /** Warning shown in `link` when linking would take over a managed build. */
  readonly linkWarning = computed<string | null>(() => this.warnFor('linked'));
  readonly cleanLabel = computed(() => {
    switch (this.activeMode()) {
      case 'resolver': return 'Also remove the old resolver config (.tokenflow/distribution.config.json)';
      case 'style-dictionary': return 'Also remove the old Style Dictionary matrix + its style-dictionary devDependency';
      case 'linked': return 'Also unlink the external build';
      default: return '';
    }
  });

  constructor() {
    effect(() => {
      if (this.ui.distributionOpen()) void this.load();
    });
  }

  close(): void {
    this.ui.distributionOpen.set(false);
  }
  kb(b: number): string {
    return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} kB`;
  }
  modeLabel(m: DistributionMode): string {
    return MODE_LABEL[m] ?? m;
  }

  /** Build the switch-mode warning when `target` differs from the active mode. */
  private warnFor(target: DistributionMode): string | null {
    const am = this.activeMode();
    if (am === 'none' || am === target) return null;
    const targetLabel = MODE_LABEL[target];
    if (am === 'resolver' || am === 'style-dictionary') {
      return `This project is already configured with ${MODE_LABEL[am]}. Continuing in ${targetLabel} will replace the active build (scripts/tokens.build.mjs) and switch the active mode.`;
    }
    if (am === 'linked') {
      const cmd = this.linked()?.buildCommand ?? 'external build';
      return `This project is linked to an external build (${cmd}). Configuring a TFM-managed build will take over at launch; the link will be ignored.`;
    }
    return null;
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

  private async load(): Promise<void> {
    this.loading.set(true);
    this.report.set(null);
    try {
      const s = await firstValueFrom(this.api.getDistribution());
      this.state.set(s);
      // Prefill the link fields from the existing pointer or detections.
      this.linkConfigPath.set(s.linked?.configPath ?? s.detectedConfigs[0] ?? '');
      this.linkCommand.set(s.linked?.buildCommand ?? suggestCommand(s) ?? '');
      this.routeForMode(s.activeMode);
    } catch {
      this.state.set(null);
      this.view.set('landing');
    } finally {
      this.loading.set(false);
    }
  }

  /** Open the view of the detected active mode. */
  private routeForMode(mode: DistributionMode): void {
    switch (mode) {
      case 'resolver':
        this.engine.set('resolver');
        this.cleanPrevious.set(false);
        this.view.set('configure');
        break;
      case 'style-dictionary':
      case 'linked':
        this.view.set('overview');
        break;
      default:
        this.view.set('landing');
    }
  }

  // ---- navigation ----
  /** Enter the configure flow with an engine (defaults to the active mode's engine, else resolver). */
  goConfigure(engine?: Engine): void {
    if (!this.state()?.collections?.length) return;
    const am = this.activeMode();
    this.engine.set(engine ?? (am === 'style-dictionary' ? 'style-dictionary' : 'resolver'));
    this.cleanPrevious.set(false);
    this.report.set(null);
    this.view.set('configure');
  }
  setEngine(engine: Engine): void {
    if (this.engine() === engine) return;
    this.engine.set(engine);
    this.cleanPrevious.set(false);
  }
  goLink(): void {
    this.report.set(null);
    this.cleanPrevious.set(false);
    this.view.set('link');
  }
  backToLanding(): void {
    this.report.set(null);
    this.view.set('landing');
  }
  /** Overview "Edit" → the right flow for the current mode. */
  modify(): void {
    if (this.activeMode() === 'linked') this.goLink();
    else this.goConfigure(this.activeMode() === 'style-dictionary' ? 'style-dictionary' : 'resolver');
  }

  /** A wizard saved — refresh state so the active mode/badges/overview reflect it. */
  async onPersisted(): Promise<void> {
    try {
      this.state.set(await firstValueFrom(this.api.getDistribution()));
      this.cleanPrevious.set(false);
    } catch {
      /* keep current state */
    }
  }

  // ---- test / run (overview) ----
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
      const s = await firstValueFrom(this.api.linkExisting(this.linkConfigPath().trim(), cmd, this.cleanPrevious()));
      this.state.set(s);
      this.report.set(null);
      this.cleanPrevious.set(false);
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
      this.routeForMode(s.activeMode);
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

/** Suggest a build command from the project's token-related npm scripts. */
function suggestCommand(s: DistributionState | null): string {
  if (!s?.npmScripts.length) return '';
  const hit = s.npmScripts.find((x) => /token|theme|generate|build.*token|sd|style.?dict/i.test(x.name))
    ?? s.npmScripts[0]!;
  return `npm run ${hit.name}`;
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { error?: { error?: string }; message?: string };
  return e?.error?.error ?? e?.message ?? fallback;
}
