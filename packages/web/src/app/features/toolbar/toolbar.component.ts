import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { typeGlyph } from '../../core/format';
import type { DtcgType, SearchFilters } from '../../core/models';

type BoolFilterKey = 'deprecated' | 'orphans' | 'hasErrors';
type AliasMode = 'all' | 'only' | 'none';

interface BoolFilter {
  key: BoolFilterKey;
  label: string;
}

/** Boolean facets shown as checkboxes in the filter panel. */
const BOOL_FILTERS: BoolFilter[] = [
  { key: 'deprecated', label: 'Deprecated' },
  { key: 'orphans', label: 'Orphans (unreferenced)' },
  { key: 'hasErrors', label: 'With errors' },
];

const ALIAS_OPTIONS: { value: AliasMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'only', label: 'Aliases only' },
  { value: 'none', label: 'Without alias' },
];

/** The DTCG types offered in the "Create variable" dropdown, with their glyphs. */
const CREATE_TYPES: { type: DtcgType; label: string }[] = [
  { type: 'color', label: 'Color' },
  { type: 'dimension', label: 'Dimension' },
  { type: 'number', label: 'Number' },
  { type: 'duration', label: 'Duration' },
  { type: 'fontFamily', label: 'Font family' },
  { type: 'fontWeight', label: 'Font weight' },
  { type: 'cubicBezier', label: 'Cubic bézier' },
  { type: 'strokeStyle', label: 'Stroke style' },
  { type: 'typography', label: 'Typography' },
  { type: 'shadow', label: 'Shadow' },
  { type: 'border', label: 'Border' },
  { type: 'transition', label: 'Transition' },
  { type: 'gradient', label: 'Gradient' },
];

/**
 * Types offered in the filter panel: every DTCG type plus `unknown` (untyped
 * tokens — these can't be *created*, but they exist and must be filterable).
 */
const FILTER_TYPES: { type: string; label: string }[] = [
  ...CREATE_TYPES,
  { type: 'unknown', label: 'Unknown' },
];

@Component({
  selector: 'tf-toolbar',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2 px-3 py-2 border-b border-ink-200 bg-white">
      <div class="relative w-72 shrink-0">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          class="w-full text-sm border border-ink-200 rounded-md pl-9 pr-2 py-2 focus:outline-none focus:ring-2 focus:ring-forge-500"
          placeholder="Search tokens…"
          [ngModel]="query()"
          (ngModelChange)="onQuery($event)"
        />
      </div>

      <!-- Filters: a single icon button opening a panel that consolidates the
           token-type, alias and boolean facets. A badge shows how many are active. -->
      <div class="relative shrink-0">
        <button
          type="button"
          class="relative flex items-center gap-1.5 text-sm px-2.5 py-2 rounded-md border transition-colors"
          [class.bg-ink-900]="filterCount() > 0"
          [class.text-white]="filterCount() > 0"
          [class.border-ink-900]="filterCount() > 0"
          [class.border-ink-200]="filterCount() === 0"
          [class.text-ink-600]="filterCount() === 0"
          title="Filters"
          (click)="toggleFilters()"
        >
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          @if (filterCount() > 0) {
            <span class="text-xs font-medium tabular-nums">{{ filterCount() }}</span>
          }
        </button>
        @if (filterOpen()) {
          <div class="fixed inset-0 z-40" (click)="closeFilters()"></div>
          <div
            class="absolute right-0 top-full mt-1 z-50 w-72 rounded-md border border-ink-200 bg-white shadow-lg p-3"
            (keydown.escape)="closeFilters()"
          >
            <!-- Token types: "All" (default, = no type filter) + multi-select toggle grid. -->
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Token type</div>
            <button
              type="button"
              class="w-full mb-1 px-2 py-1 rounded text-sm text-left transition-colors"
              [class.bg-ink-900]="selectedTypes().length === 0"
              [class.text-white]="selectedTypes().length === 0"
              [class.text-ink-700]="selectedTypes().length > 0"
              [class.hover:bg-ink-100]="selectedTypes().length > 0"
              (click)="clearTypes()"
            >
              All types
            </button>
            <div class="grid grid-cols-2 gap-1">
              @for (t of typeOptions; track t.type) {
                <button
                  type="button"
                  class="flex items-center gap-2 px-2 py-1 rounded text-sm text-left transition-colors"
                  [class.bg-forge-50]="typeActive(t.type)"
                  [class.text-forge-700]="typeActive(t.type)"
                  [class.text-ink-700]="!typeActive(t.type)"
                  [class.hover:bg-ink-100]="!typeActive(t.type)"
                  (click)="toggleType(t.type)"
                >
                  <span class="w-4 text-center text-ink-400">{{ glyph(t.type) }}</span>
                  <span class="truncate">{{ t.label }}</span>
                </button>
              }
            </div>

            <!-- Alias: tri-state. "Without alias" answers showing only non-alias variables. -->
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mt-3 mb-1.5">Alias</div>
            <div class="flex rounded-md border border-ink-200 overflow-hidden">
              @for (opt of aliasOptions; track opt.value) {
                <button
                  type="button"
                  class="flex-1 text-xs py-1.5 transition-colors border-l first:border-l-0 border-ink-200"
                  [class.bg-ink-900]="aliasMode() === opt.value"
                  [class.text-white]="aliasMode() === opt.value"
                  [class.text-ink-600]="aliasMode() !== opt.value"
                  [class.hover:bg-ink-100]="aliasMode() !== opt.value"
                  (click)="setAlias(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>

            <!-- Other boolean facets. -->
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mt-3 mb-1">Status</div>
            @for (f of boolFilters; track f.key) {
              <label class="flex items-center gap-2 px-1 py-1 text-sm text-ink-700 cursor-pointer hover:bg-ink-100 rounded">
                <input
                  type="checkbox"
                  class="accent-forge-600"
                  [checked]="boolActive(f.key)"
                  (change)="toggleBool(f.key)"
                />
                <span>{{ f.label }}</span>
              </label>
            }

            @if (filterCount() > 0) {
              <button
                class="mt-2 w-full text-xs text-forge-600 hover:underline text-center py-1"
                (click)="resetFilters()"
              >
                Reset all filters
              </button>
            }
          </div>
        }
      </div>

      <span class="flex-1"></span>
      @if (storeActive()) {
        <span class="text-xs text-ink-400">{{ count() }} shown</span>
        <button class="text-xs text-forge-600 hover:underline" (click)="clear()">Clear</button>
      }

      <!-- Create variable: pick a type, the row is added to the current group
           (sidebar filter) or the collection root, with default values. -->
      <div class="relative shrink-0">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-forge-600 text-white hover:bg-forge-700 disabled:opacity-40"
          [disabled]="!canCreate()"
          title="Create a new variable in this collection"
          (click)="toggleMenu()"
        >
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create variable
        </button>
        @if (menuOpen()) {
          <div class="fixed inset-0 z-40" (click)="closeMenu()"></div>
          <div
            class="absolute right-0 top-full mt-1 z-50 w-52 max-h-80 overflow-auto rounded-md border border-ink-200 bg-white shadow-lg py-1"
            (keydown.escape)="closeMenu()"
          >
            <div class="px-3 py-1.5 text-[11px] uppercase tracking-wide text-ink-400">New variable</div>
            @for (t of createTypes; track t.type) {
              <button
                type="button"
                class="w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-sm text-ink-700 hover:bg-ink-100"
                (click)="create(t.type)"
              >
                <span class="w-4 text-center text-ink-400">{{ glyph(t.type) }}</span>
                <span>{{ t.label }}</span>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class ToolbarComponent {
  private readonly store = inject(ProjectStore);
  readonly boolFilters = BOOL_FILTERS;
  readonly aliasOptions = ALIAS_OPTIONS;
  readonly createTypes = CREATE_TYPES;
  /** Filter panel offers every DTCG type plus `unknown`. */
  readonly typeOptions = FILTER_TYPES;
  readonly query = this.store.searchQuery;
  readonly storeActive = this.store.searchActive;
  readonly count = computed(() => this.store.tokens().length);
  readonly menuOpen = signal(false);
  readonly filterOpen = signal(false);

  /** Currently selected token types (empty = no type filter). */
  readonly selectedTypes = computed<string[]>(() => this.store.filters().types ?? []);
  /** Number of active filter facets, shown as a badge on the icon. */
  readonly filterCount = computed(() => {
    const f = this.store.filters();
    let n = f.types?.length ?? 0;
    if (f.alias) n += 1;
    if (f.deprecated) n += 1;
    if (f.orphans) n += 1;
    if (f.hasErrors) n += 1;
    return n;
  });
  /** A collection must be open before a variable can be created. */
  readonly canCreate = computed(() => this.store.currentCollectionName() !== null);

  glyph(type: string): string {
    return typeGlyph(type);
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Create the chosen type under the active group filter, else the collection root. */
  create(type: DtcgType): void {
    this.menuOpen.set(false);
    void this.store.createVariable(type, this.store.groupPrefix() ?? []);
  }

  onQuery(value: string): void {
    this.store.setQuery(value);
  }

  toggleFilters(): void {
    this.filterOpen.update((v) => !v);
  }
  closeFilters(): void {
    this.filterOpen.set(false);
  }

  // ---- Token types (multi-select) ----
  typeActive(type: string): boolean {
    return this.selectedTypes().includes(type);
  }
  toggleType(type: string): void {
    const current = this.selectedTypes();
    const types = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    this.patch('types', types.length ? types : undefined);
  }
  clearTypes(): void {
    this.patch('types', undefined);
  }

  // ---- Alias (tri-state) ----
  aliasMode(): AliasMode {
    return this.store.filters().alias ?? 'all';
  }
  setAlias(mode: AliasMode): void {
    this.patch('alias', mode === 'all' ? undefined : mode);
  }

  // ---- Boolean facets ----
  boolActive(key: BoolFilterKey): boolean {
    return this.store.filters()[key] === true;
  }
  toggleBool(key: BoolFilterKey): void {
    this.patch(key, this.boolActive(key) ? undefined : true);
  }

  resetFilters(): void {
    this.store.setFilters({});
  }

  clear(): void {
    this.store.clearSearch();
  }

  /**
   * Update one filter key, dropping it entirely when the value is empty so the
   * store's `searchActive` (which keys on `Object.keys(filters).length`) doesn't
   * treat an empty facet as an active search.
   */
  private patch<K extends keyof SearchFilters>(key: K, value: SearchFilters[K] | undefined): void {
    const next: SearchFilters = { ...this.store.filters() };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.store.setFilters(next);
  }
}
