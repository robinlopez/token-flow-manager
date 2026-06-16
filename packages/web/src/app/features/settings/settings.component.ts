import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ProjectStore } from '../../stores/project.store';
import { ApiService } from '../../core/api.service';
import { UiService, THEMES, type ThemeId } from '../../core/ui.service';
import type { ConfigCollection } from '../../core/models';

interface DimCandidate {
  depth: number;
  segs: string[];
}

type Tab = 'general' | 'appearance' | 'resolution' | 'collections';

@Component({
  selector: 'tf-settings',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.settingsOpen()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30" (click)="close()">
        <div
          class="w-[760px] max-w-[94vw] h-[560px] max-h-[88vh] bg-white rounded-xl shadow-2xl border border-ink-200 flex flex-col overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <div class="px-5 py-3 border-b border-ink-200 flex items-center justify-between shrink-0">
            <div class="font-semibold text-sm flex items-center gap-2">
              <svg class="w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </div>
            <button class="text-ink-400 hover:text-ink-700 text-xl leading-none" (click)="close()">×</button>
          </div>

          <div class="flex flex-1 min-h-0">
            <!-- Tabs -->
            <nav class="w-44 shrink-0 border-r border-ink-200 bg-ink-50/60 p-2 space-y-0.5 text-sm">
              @for (t of tabs; track t.id) {
                <button
                  class="w-full text-left px-3 py-2 rounded-md flex items-center gap-2"
                  [class.bg-white]="tab() === t.id"
                  [class.shadow-sm]="tab() === t.id"
                  [class.text-forge-700]="tab() === t.id"
                  [class.font-medium]="tab() === t.id"
                  [class.text-ink-600]="tab() !== t.id"
                  [class.hover:bg-ink-100]="tab() !== t.id"
                  (click)="tab.set(t.id)"
                >
                  {{ t.label }}
                </button>
              }
              <div class="pt-3 px-3 text-[11px] text-ink-400 leading-relaxed">
                @if (tab() === 'appearance') {
                  Stored in this browser
                } @else {
                  Saved to <code class="text-ink-600">tokenflow.config.json</code>
                  @if (saving()) { <span class="text-forge-600">· saving…</span> }
                }
              </div>
            </nav>

            <!-- Content -->
            <div class="flex-1 overflow-auto scrollbar-thin p-5 text-sm">
              @switch (tab()) {
                @case ('general') {
                  <div class="space-y-5">
                    <div class="text-[11px] uppercase tracking-wide text-ink-400">Type checking</div>
                    <label class="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" class="mt-0.5" [checked]="strict()" (change)="setBool('strictTypes', $event)" />
                      <span>
                        <span class="text-ink-900 font-medium">Strict types</span>
                        <span class="block text-ink-500 text-xs">Error when a token has no valid DTCG <code>$type</code>. Off (default) is tolerant.</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" class="mt-0.5" [checked]="infer()" [disabled]="strict()" (change)="setBool('inferTypes', $event)" />
                      <span>
                        <span class="text-ink-900 font-medium">Infer types from values</span>
                        <span class="block text-ink-500 text-xs">Guess a type from the value (#fff → color, 2px → dimension) when <code>$type</code> is missing.</span>
                      </span>
                    </label>

                    <div class="text-[11px] uppercase tracking-wide text-ink-400 pt-2 border-t border-ink-100">File watching</div>
                    <label class="flex items-center justify-between gap-3">
                      <span>
                        <span class="text-ink-900 font-medium">Reload debounce</span>
                        <span class="block text-ink-500 text-xs">Delay (ms) after an external change to a token file before the dashboard reloads it from disk.</span>
                      </span>
                      <input type="number" min="0" step="50" class="w-24 border border-ink-200 rounded px-2 py-1 text-right" [ngModel]="debounce()" (change)="setNumber('writeDebounceMs', $event)" />
                    </label>
                  </div>
                }

                @case ('appearance') {
                  <div class="space-y-4">
                    <div class="text-[11px] uppercase tracking-wide text-ink-400">Theme</div>
                    <p class="text-xs text-ink-500 -mt-2">Accent colour used across the dashboard. Applies instantly and is remembered on this device.</p>
                    <div class="grid grid-cols-2 gap-3">
                      @for (t of themes; track t.id) {
                        <button
                          type="button"
                          class="text-left rounded-lg border p-3 transition-colors focus:outline-none"
                          [class.border-forge-500]="theme() === t.id"
                          [class.ring-1]="theme() === t.id"
                          [class.ring-forge-400]="theme() === t.id"
                          [class.bg-forge-50]="theme() === t.id"
                          [class.border-ink-200]="theme() !== t.id"
                          [class.hover:border-ink-300]="theme() !== t.id"
                          (click)="setTheme(t.id)"
                        >
                          <div class="flex items-center gap-2.5">
                            <span class="w-7 h-7 rounded-full border border-ink-200 shrink-0" [style.background]="t.primary"></span>
                            <div class="min-w-0">
                              <div class="font-medium text-ink-900 flex items-center gap-1.5">
                                {{ t.label }}
                                @if (theme() === t.id) {
                                  <span class="text-[10px] uppercase tracking-wide text-forge-600">Active</span>
                                }
                              </div>
                              <div class="font-mono text-[11px] text-ink-400">{{ t.primary }}</div>
                            </div>
                          </div>
                          <p class="text-xs text-ink-500 mt-2">{{ t.description }}</p>
                        </button>
                      }
                    </div>
                  </div>
                }

                @case ('resolution') {
                  <div class="space-y-5">
                    <label class="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" class="mt-0.5" [checked]="crossCollection()" (change)="setBool('crossCollection', $event)" />
                      <span>
                        <span class="text-ink-900 font-medium">Cross-collection aliases</span>
                        <span class="block text-ink-500 text-xs">Allow a token to alias another collection (subject to the order below).</span>
                      </span>
                    </label>
                    <label class="flex items-center justify-between gap-3">
                      <span>
                        <span class="text-ink-900 font-medium">Max alias depth</span>
                        <span class="block text-ink-500 text-xs">Warn when an alias chain is deeper than this.</span>
                      </span>
                      <input type="number" min="1" class="w-24 border border-ink-200 rounded px-2 py-1 text-right" [ngModel]="maxDepth()" (change)="setNumber('maxAliasDepth', $event)" />
                    </label>

                    <div class="pt-2 border-t border-ink-100">
                      <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Resolution order</div>
                      <p class="text-xs text-ink-500 mb-2">Earlier collections resolve first; a collection may only reference those above it.</p>
                      <div class="space-y-1">
                        @for (name of order(); track name; let i = $index) {
                          <div class="flex items-center gap-2 border border-ink-200 rounded-md px-2 py-1.5">
                            <span class="w-5 text-ink-400 text-xs">{{ i + 1 }}</span>
                            <span class="flex-1 font-mono text-xs text-ink-800 truncate">{{ name }}</span>
                            <button class="w-6 h-6 rounded hover:bg-ink-100 disabled:opacity-30" [disabled]="i === 0" (click)="moveOrder(i, -1)">↑</button>
                            <button class="w-6 h-6 rounded hover:bg-ink-100 disabled:opacity-30" [disabled]="i === order().length - 1" (click)="moveOrder(i, 1)">↓</button>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                }

                @case ('collections') {
                  <div class="space-y-4">
                    <div class="rounded-lg bg-ink-50 border border-ink-200 p-3 text-xs text-ink-600 space-y-1.5">
                      <p>
                        Your collections, their modes (the value columns, e.g. Light/Dark or
                        Desktop/Tablet) and which files feed each mode are described in
                        <span class="font-mono text-ink-800">manifest.json</span> — the source of
                        truth for your token structure that the tool reads and writes.
                      </p>
                      <p>
                        Modes are the columns of a collection. For file-per-theme collections you can
                        rename modes and remap files below; changes are saved back to the manifest.
                      </p>
                      <div class="flex items-center gap-3 pt-0.5">
                        @if (hasManifest()) {
                          <button class="text-forge-600 hover:underline" (click)="openManifest()">
                            Open manifest.json
                          </button>
                        } @else {
                          <button class="text-forge-600 hover:underline" (click)="generateManifest()">
                            Generate manifest.json
                          </button>
                        }
                      </div>
                    </div>
                    @for (c of collections(); track c.name) {
                      <div class="border border-ink-200 rounded-lg p-3">
                        <div class="flex items-center justify-between">
                          <div class="font-medium text-ink-900">{{ c.name }}</div>
                          <span class="text-[11px] text-ink-400">{{ fileList(c).length }} file(s)</span>
                        </div>

                        @if (isFileMode(c)) {
                          <div class="mt-2 space-y-1.5">
                            @for (f of fileList(c); track f) {
                              <div class="flex items-center gap-2">
                                <span class="flex-1 font-mono text-[11px] text-ink-500 truncate" [title]="f">{{ short(f) }}</span>
                                <span class="text-ink-300 text-xs">mode</span>
                                <input
                                  class="w-32 border border-ink-200 rounded px-2 py-1 text-xs"
                                  [ngModel]="c.fileModes?.[f]"
                                  (change)="setFileMode(c, f, $event)"
                                />
                              </div>
                            }
                          </div>
                        } @else if (isFolded(c)) {
                          <!-- already split into mode columns -->
                          <div class="mt-2 flex flex-wrap items-center gap-1.5">
                            <span class="text-[11px] text-ink-400">modes:</span>
                            @for (m of summaryModes(c.name); track m) {
                              <span class="px-2 py-0.5 rounded-md bg-forge-50 border border-forge-200 text-xs font-mono text-forge-700">{{ m }}</span>
                            }
                            <button
                              class="ml-1 text-[11px] text-ink-500 hover:text-ink-800 underline"
                              (click)="setDim(c, '-1')"
                            >
                              Reset to groups
                            </button>
                          </div>
                        } @else {
                          <!-- not detected as modes — let the user pick the level -->
                          <div class="mt-2 flex items-center gap-2">
                            <span class="text-ink-500 text-xs shrink-0">Modes from level</span>
                            <select
                              class="flex-1 border border-ink-200 rounded px-2 py-1 text-xs bg-white"
                              [ngModel]="dimOf(c)"
                              (ngModelChange)="setDim(c, $event)"
                            >
                              <option value="-1">None — keep as nested groups</option>
                              @for (cand of candidatesFor(c.name); track cand.depth) {
                                <option [value]="cand.depth">
                                  Level {{ cand.depth + 1 }} — {{ cand.segs.join(', ') }}
                                </option>
                              }
                            </select>
                          </div>
                          @if (candidatesFor(c.name).length === 0) {
                            <p class="mt-1 text-[11px] text-ink-400">Single value — no levels to fold.</p>
                          }
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class SettingsComponent {
  private readonly store = inject(ProjectStore);
  private readonly api = inject(ApiService);
  readonly ui = inject(UiService);

  /** Candidate mode dimensions per collection (path depths with 2–8 distinct segments). */
  private readonly candidates = signal<Record<string, DimCandidate[]>>({});
  private readonly summaries = computed(() => this.store.state()?.collections ?? []);

  constructor() {
    // When the panel opens, fetch each collection's tokens to offer "which level
    // is the mode dimension?" choices (can't fold what we can't see).
    effect(() => {
      if (!this.ui.settingsOpen()) return;
      const names = this.collections().map((c) => c.name);
      void this.loadCandidates(names);
    });
    // Honor a requested tab (e.g. the onboarding banner deep-links to "collections").
    effect(() => {
      const requested = this.ui.settingsTab();
      if (this.ui.settingsOpen() && requested) {
        if (this.tabs.some((t) => t.id === requested)) this.tab.set(requested as Tab);
        this.ui.settingsTab.set(null);
      }
    });
  }

  private async loadCandidates(names: string[]): Promise<void> {
    const out: Record<string, DimCandidate[]> = {};
    for (const name of names) {
      try {
        const col = await firstValueFrom(this.api.getCollection(name));
        const byDepth = new Map<number, Set<string>>();
        for (const t of col.tokens) {
          for (let d = 0; d < t.path.length - 1; d++) {
            let set = byDepth.get(d);
            if (!set) byDepth.set(d, (set = new Set()));
            set.add(t.path[d]!);
          }
        }
        out[name] = [...byDepth.entries()]
          .filter(([, s]) => s.size >= 2 && s.size <= 8)
          .sort((a, b) => a[0] - b[0])
          .map(([depth, s]) => ({ depth, segs: [...s] }));
      } catch {
        out[name] = [];
      }
    }
    this.candidates.set(out);
  }

  candidatesFor(name: string): DimCandidate[] {
    return this.candidates()[name] ?? [];
  }
  /** Effective mode dimension as a select value (string; "-1" = none). */
  dimOf(c: ConfigCollection): string {
    const summary = this.summaries().find((s) => s.name === c.name);
    return String(summary?.modeDimension ?? c.modeDimension ?? -1);
  }
  summaryModes(name: string): string[] {
    const summary = this.summaries().find((s) => s.name === name);
    return (summary?.modes ?? []).map((m) => m.id);
  }
  /** A collection is "folded" when it already exposes more than one mode column. */
  isFolded(c: ConfigCollection): boolean {
    const summary = this.summaries().find((s) => s.name === c.name);
    return summary?.modeDimension !== undefined || this.summaryModes(c.name).length > 1;
  }
  setDim(c: ConfigCollection, value: string): void {
    const depth = Number(value);
    if (depth < 0) {
      void this.store.updateConfig({ collections: [{ name: c.name, modeDimension: null }] });
      return;
    }
    const cand = this.candidatesFor(c.name).find((x) => x.depth === depth);
    void this.store.updateConfig({
      collections: [{ name: c.name, modeDimension: depth, modes: cand?.segs ?? [] }],
    });
  }

  /** Whether a manifest.json exists (drives Open vs Generate in the Collections tab). */
  readonly hasManifest = computed(() => this.store.setup()?.hasManifest ?? false);
  async openManifest(): Promise<void> {
    await this.store.openManifestFile();
  }
  async generateManifest(): Promise<void> {
    await this.store.generateManifest();
  }

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'resolution', label: 'Resolution' },
    { id: 'collections', label: 'Collections & modes' },
  ];
  readonly tab = signal<Tab>('general');
  readonly themes = THEMES;
  readonly theme = this.ui.theme;
  setTheme(id: ThemeId): void {
    this.ui.setTheme(id);
  }

  private readonly config = this.store.config;
  readonly strict = computed(() => this.config()?.strictTypes ?? false);
  readonly infer = computed(() => this.config()?.inferTypes ?? true);
  readonly debounce = computed(() => this.config()?.writeDebounceMs ?? 200);
  readonly crossCollection = computed(() => this.config()?.resolution.crossCollection ?? true);
  readonly maxDepth = computed(() => this.config()?.resolution.maxAliasDepth ?? 10);
  readonly collections = computed(() => this.config()?.collections ?? []);
  readonly order = computed(
    () => this.config()?.resolution.order ?? this.collections().map((c) => c.name),
  );
  readonly saving = computed(() => this.store.loading());

  close(): void {
    this.ui.settingsOpen.set(false);
  }

  setBool(key: 'strictTypes' | 'inferTypes' | 'crossCollection', e: Event): void {
    void this.store.updateConfig({ [key]: (e.target as HTMLInputElement).checked });
  }
  setNumber(key: 'writeDebounceMs' | 'maxAliasDepth', e: Event): void {
    const n = Number((e.target as HTMLInputElement).value);
    if (!Number.isNaN(n)) void this.store.updateConfig({ [key]: n });
  }

  moveOrder(i: number, dir: -1 | 1): void {
    const next = [...this.order()];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    void this.store.updateConfig({ order: next });
  }

  // ---- Collections / modes ----
  isFileMode(c: ConfigCollection): boolean {
    return !!c.fileModes && Object.keys(c.fileModes).length > 0;
  }
  fileList(c: ConfigCollection): string[] {
    if (c.fileModes) return Object.keys(c.fileModes);
    return Array.isArray(c.files) ? c.files : [c.files];
  }
  modesOf(c: ConfigCollection): string[] {
    return c.modes ?? [];
  }
  short(file: string): string {
    return file.split('/').pop() ?? file;
  }
  setFileMode(c: ConfigCollection, file: string, e: Event): void {
    const value = (e.target as HTMLInputElement).value.trim();
    if (!value) return;
    const fileModes = { ...(c.fileModes ?? {}), [file]: value };
    const modes = [...new Set(Object.values(fileModes))];
    void this.store.updateConfig({ collections: [{ name: c.name, modes, fileModes }] });
  }
}
