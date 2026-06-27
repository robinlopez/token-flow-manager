import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { RealtimeService } from '../core/realtime.service';
import { UiService } from '../core/ui.service';
import { defaultValueForType } from '../core/format';
import type {
  Collection,
  ConfigPatch,
  DtcgType,
  HistoryState,
  ParsedToken,
  ProjectConfig,
  ProjectState,
  ReferenceInfo,
  SearchFilters,
  UndoRedoResult,
} from '../core/models';

/**
 * Single source of truth for the dashboard. Plain Angular signals (the alias
 * graph maps naturally onto computed signals); a future iteration can lift this
 * into an @ngrx/signals Signal Store for undo/redo.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStore {
  private readonly api = inject(ApiService);
  private readonly realtime = inject(RealtimeService);
  private readonly ui = inject(UiService);

  readonly state = signal<ProjectState | null>(null);
  readonly config = signal<ProjectConfig | null>(null);
  readonly collection = signal<Collection | null>(null);
  /** Every token across all collections (for cross-collection alias previews). */
  readonly globalTokens = signal<ParsedToken[]>([]);
  /** Lookup: dotted path → token (last wins). Used to preview an alias target. */
  readonly globalByPath = computed(() => {
    const m = new Map<string, ParsedToken>();
    for (const t of this.globalTokens()) m.set(t.path.join('.'), t);
    return m;
  });
  readonly currentCollectionName = signal<string | null>(null);
  /** The "focused" row: selection anchor + scroll/ring target. Does NOT open the
   * inspector — that is driven by `inspectedTokenId` so a plain click only selects. */
  readonly selectedTokenId = signal<string | null>(null);
  /** The token whose detail panel (inspector) is open, or null when it is closed. */
  readonly inspectedTokenId = signal<string | null>(null);
  /** A freshly-created variable the table should drop straight into inline rename. */
  readonly pendingRenameTokenId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // ---- Multi-selection (shared by the table and the sidebar so a drag can
  // carry a selection across both) ----
  readonly selectedIds = signal<Set<string>>(new Set());
  /** Anchor row for shift-click range selection. */
  selectionAnchor: string | null = null;
  /** Multi-selected group rows (dotted paths) in the sidebar, for group moves. */
  readonly selectedGroupKeys = signal<Set<string>>(new Set());
  /** Expanded (open) sidebar group rows (dotted paths). Lifted out of the
   * recursive tree component so selecting a variable can auto-open its ancestors. */
  readonly expandedGroupKeys = signal<Set<string>>(new Set());

  /** Variable clipboard (whole-row copy/paste): the copied tokens + collection. */
  readonly copiedTokenRefs = signal<{ id: string; collection: string }[]>([]);
  /** Whether the variable clipboard holds a copy (duplicate on paste) or a cut (move on paste). */
  readonly clipboardMode = signal<'copy' | 'cut'>('copy');
  readonly hasCopiedVariables = computed(() => this.copiedTokenRefs().length > 0);
  /** Ids of variables marked for a cut in the CURRENT collection — hidden from the table. */
  readonly cutTokenIds = computed(() => {
    if (this.clipboardMode() !== 'cut') return new Set<string>();
    const col = this.currentCollectionName();
    return new Set(this.copiedTokenRefs().filter((r) => r.collection === col).map((r) => r.id));
  });

  // Search / filter state.
  readonly searchQuery = signal('');
  readonly filters = signal<SearchFilters>({});
  readonly searchHitIds = signal<Set<string> | null>(null);
  /** Path-prefix filter set by clicking a group in the sidebar. */
  readonly groupPrefix = signal<string[] | null>(null);

  readonly allTokens = computed(() => this.collection()?.tokens ?? []);
  readonly searchActive = computed(
    () => this.searchQuery().trim().length > 0 || Object.keys(this.filters()).length > 0,
  );
  readonly tokens = computed(() => {
    let list = this.allTokens();
    const prefix = this.groupPrefix();
    if (prefix) {
      list = list.filter(
        (t) => t.path.length > prefix.length && prefix.every((seg, i) => t.path[i] === seg),
      );
    }
    const hits = this.searchHitIds();
    if (this.searchActive() && hits) list = list.filter((t) => hits.has(t.id));
    // Variables marked for a cut vanish from the table until pasted (or the cut is
    // cancelled) — the true "cut" feel, without removing anything from disk yet.
    const cut = this.cutTokenIds();
    if (cut.size) list = list.filter((t) => !cut.has(t.id));
    return list;
  });
  /** Dotted paths of every token in the current collection (alias autocomplete). */
  readonly collectionPaths = computed(() => this.allTokens().map((t) => t.path.join('.')));
  readonly modes = computed(() => this.collection()?.modes ?? []);
  readonly groups = computed(() => this.collection()?.groups ?? []);
  readonly selectedToken = computed<ParsedToken | null>(() => {
    const id = this.selectedTokenId();
    // Look in the unfiltered list so selection survives an active search/filter.
    return this.allTokens().find((t) => t.id === id) ?? null;
  });
  /**
   * Dotted parent-group keys of the currently focused/selected variables. Drives
   * the sidebar's active-group highlight (the left accent bar + active styling),
   * independently of the click-to-filter `groupPrefix`.
   */
  readonly selectedTokenGroupKeys = computed<Set<string>>(() => {
    const ids = new Set(this.selectedIds());
    const focused = this.selectedTokenId();
    if (focused) ids.add(focused);
    const keys = new Set<string>();
    if (!ids.size) return keys;
    for (const t of this.allTokens()) {
      if (ids.has(t.id) && t.path.length > 1) keys.add(t.path.slice(0, -1).join('.'));
    }
    return keys;
  });
  /** The token shown in the inspector detail panel (opened via the gear icon). */
  readonly inspectedToken = computed<ParsedToken | null>(() => {
    const id = this.inspectedTokenId();
    return this.allTokens().find((t) => t.id === id) ?? null;
  });
  // ---- Undo / redo history (Phase 3.6) ----
  readonly history = computed<HistoryState | null>(() => this.state()?.history ?? null);
  readonly canUndo = computed(() => this.history()?.canUndo ?? false);
  readonly canRedo = computed(() => this.history()?.canRedo ?? false);
  readonly undoLabel = computed(() => this.history()?.undoLabel ?? null);
  readonly redoLabel = computed(() => this.history()?.redoLabel ?? null);

  readonly errorCount = computed(
    () => this.state()?.diagnostics.filter((d) => d.severity === 'error').length ?? 0,
  );
  readonly warningCount = computed(
    () => this.state()?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0,
  );

  constructor() {
    this.realtime.connect();
    // Refresh on any server push.
    effect(() => {
      const event = this.realtime.lastEvent();
      if (!event) return;
      void this.refresh();
    });
    // Navigating to a variable opens its ancestor groups in the sidebar tree, so
    // the focused row's group is always revealed (Figma-like). The expansion
    // read/write is untracked so collapsing a group by hand isn't instantly undone
    // (the effect must depend ONLY on the selection, not on expandedGroupKeys).
    effect(() => {
      const t = this.selectedToken();
      if (t) untracked(() => this.expandAncestorGroups(t.path));
    });
  }

  // ---- Sidebar group expansion ----

  isGroupExpanded(key: string): boolean {
    return this.expandedGroupKeys().has(key);
  }
  toggleGroupExpanded(key: string): void {
    const next = new Set(this.expandedGroupKeys());
    next.has(key) ? next.delete(key) : next.add(key);
    this.expandedGroupKeys.set(next);
  }
  /** Open every ancestor group of a token `path` (groups = each path prefix). */
  expandAncestorGroups(path: string[]): void {
    if (path.length <= 1) return; // a root-level token has no group to open
    const next = new Set(this.expandedGroupKeys());
    let added = false;
    for (let i = 1; i < path.length; i++) {
      const key = path.slice(0, i).join('.');
      if (!next.has(key)) {
        next.add(key);
        added = true;
      }
    }
    if (added) this.expandedGroupKeys.set(next);
  }

  /** False until a project is opened — drives the welcome screen. */
  readonly isOpen = computed(() => this.state()?.open !== false);

  async init(): Promise<void> {
    await this.refresh();
    if (!this.isOpen()) return; // welcome screen; nothing to load yet
    await this.loadConfig();
    const first = this.state()?.collections[0]?.name;
    if (first) await this.selectCollection(first);
  }

  /** Open `path` as the active project (from the welcome screen), then load it. */
  async openProject(path: string): Promise<boolean> {
    try {
      const state = await this.fetch(this.api.openProject(path));
      this.resetForProject();
      this.state.set(state);
      await this.loadConfig();
      const first = state.collections[0]?.name;
      if (first) await this.selectCollection(first);
      return true;
    } catch (err) {
      this.error.set(errMessage(err));
      return false;
    }
  }

  /** Close the current project and return to the welcome screen. */
  async closeProject(): Promise<void> {
    try {
      const state = await this.fetch(this.api.closeProject());
      this.resetForProject();
      this.state.set(state);
    } catch (err) {
      this.error.set(errMessage(err));
    }
  }

  /** Clear per-project state when switching/closing projects. */
  private resetForProject(): void {
    this.collection.set(null);
    this.currentCollectionName.set(null);
    this.groupPrefix.set(null);
    this.selectedTokenId.set(null);
    this.inspectedTokenId.set(null);
    this.clearSelection();
    this.clearGroupSelection();
    this.expandedGroupKeys.set(new Set());
    this.error.set(null);
  }

  /** Re-scan files on disk (picks up added/removed/renamed files) and re-resolve. */
  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.state.set(await this.fetch(this.api.reload()));
      await this.loadConfig();
      const names = this.state()?.collections.map((c) => c.name) ?? [];
      const current = this.currentCollectionName();
      const target = current && names.includes(current) ? current : names[0];
      if (target) await this.selectCollection(target);
      else this.collection.set(null);
    } catch (err) {
      this.error.set(errMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async loadConfig(): Promise<void> {
    try {
      this.config.set(await this.fetch(this.api.getConfig()));
    } catch {
      /* config is best-effort */
    }
  }

  async updateConfig(patch: ConfigPatch): Promise<void> {
    const res = await this.fetch(this.api.updateConfig(patch));
    this.config.set(res.config);
    await this.refresh();
  }

  /** Add a mode (column) to a collection, seeded by copying `fromMode`. */
  async addMode(collection: string, name: string, fromMode?: string): Promise<boolean> {
    try {
      await this.fetch(this.api.addMode(collection, name, fromMode));
      this.ui.showToast(`Added mode "${name}"`);
      await this.refresh();
      return true;
    } catch (err) {
      // HttpClient rejects the 422 failure; surface why (e.g. duplicate mode).
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Rename a collection's mode (relabel file-modes; rewrite path/inline modes). */
  async renameMode(collection: string, from: string, to: string): Promise<boolean> {
    try {
      await this.fetch(this.api.renameMode(collection, from, to));
      await this.refresh();
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Delete a mode from a collection. */
  async deleteMode(collection: string, mode: string): Promise<boolean> {
    try {
      await this.fetch(this.api.deleteMode(collection, mode));
      this.ui.showToast(`Deleted mode "${mode}"`);
      await this.refresh();
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Duplicate a collection's mode into a copy (named with a free suffix). */
  async duplicateMode(collection: string, mode: string): Promise<boolean> {
    try {
      await this.fetch(this.api.duplicateMode(collection, mode));
      this.ui.showToast(`Duplicated mode "${mode}"`);
      await this.refresh();
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Structural-setup status (organization source + onboarding issues). */
  readonly setup = computed(() => this.state()?.setup ?? null);
  /** Actionable structure issues for the onboarding banner. */
  readonly setupIssues = computed(() => this.setup()?.issues ?? []);

  /** Generate `manifest.json` from the current organization (server slims the config). */
  async generateManifest(): Promise<boolean> {
    try {
      await this.fetch(this.api.generateManifest());
      await this.refresh();
      this.ui.showToast('Generated manifest.json');
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Open the project's manifest.json in the OS default editor. */
  async openManifestFile(): Promise<void> {
    try {
      const res = await this.fetch(this.api.openManifest());
      if (!res.ok) this.ui.showToast('Could not open manifest.json');
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
    }
  }

  /** Create a new (empty) collection and switch to it. */
  async addCollection(name: string): Promise<boolean> {
    try {
      await this.fetch(this.api.addCollection(name));
      await this.refresh();
      await this.selectCollection(name.trim());
      this.ui.showToast(`Added collection "${name.trim()}"`);
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Rename a collection; follows the selection if the current one was renamed. */
  async renameCollection(from: string, to: string): Promise<boolean> {
    try {
      await this.fetch(this.api.renameCollection(from, to));
      await this.refresh();
      if (this.currentCollectionName() === from) await this.selectCollection(to.trim());
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Delete a collection; falls back to the first remaining one if it was active. */
  async deleteCollection(name: string): Promise<boolean> {
    try {
      await this.fetch(this.api.deleteCollection(name));
      await this.refresh();
      if (this.currentCollectionName() === name) {
        const first = this.state()?.collections[0]?.name;
        if (first) await this.selectCollection(first);
        else this.collection.set(null);
      }
      this.ui.showToast(`Deleted collection "${name}"`);
      return true;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  private refreshInFlight: Promise<void> | null = null;
  private refreshPending = false;

  /**
   * Re-fetch state + current collection. Coalesced: a single mutation emits
   * several WebSocket events (tokens-changed, diagnostics-updated,
   * project-reloaded) — without this they would stack into 3 full round-trips.
   * Concurrent calls share the in-flight fetch, and one trailing refresh runs if
   * any arrived while a fetch was active.
   */
  async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshPending = true;
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefresh();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
    if (this.refreshPending) {
      this.refreshPending = false;
      await this.refresh();
    }
  }

  private async doRefresh(): Promise<void> {
    try {
      const state = await this.fetch(this.api.getState());
      this.state.set(state);
      if (state.open === false) return; // welcome screen: nothing else to fetch
      const current = this.currentCollectionName();
      if (current) {
        this.collection.set(await this.fetch(this.api.getCollection(current)));
      }
      // Global token index (best-effort) for alias-target previews.
      this.fetch(this.api.getAllTokens())
        .then((r) => this.globalTokens.set(r.tokens))
        .catch(() => {});
    } catch (err) {
      this.error.set(errMessage(err));
    }
  }

  selectGroup(path: string[] | null): void {
    this.groupPrefix.set(path);
  }

  async selectCollection(name: string): Promise<void> {
    this.currentCollectionName.set(name);
    this.groupPrefix.set(null);
    this.loading.set(true);
    try {
      this.collection.set(await this.fetch(this.api.getCollection(name)));
    } catch (err) {
      this.error.set(errMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Open (or, with null, close) the inspector detail panel for a token. Also
   * focuses the row so it scrolls into view and gets the selection ring. The
   * plain table click only selects — opening the panel is an explicit action
   * (the row's gear icon, the context-menu "Edit", or a "go to token" link).
   */
  selectToken(id: string | null): void {
    this.inspectedTokenId.set(id);
    if (id) this.selectedTokenId.set(id);
  }

  /**
   * Resolve the token an alias raw value points at, across all collections.
   * Handles the collection-namespace convention (`{primitive.green.500}` →
   * `green.500`) by retrying without the first path segment.
   */
  aliasTargetToken(raw: unknown): ParsedToken | null {
    if (typeof raw !== 'string') return null;
    let path: string | null = null;
    const curly = /^\{([^}]+)\}$/.exec(raw);
    if (curly) path = curly[1]!;
    else if (raw.startsWith('#/')) path = raw.slice(2).replace(/\//g, '.');
    if (!path) return null;
    const byPath = this.globalByPath();
    return (
      byPath.get(path) ??
      byPath.get(path.split('.').slice(1).join('.')) ?? // strip a collection-namespace prefix
      null
    );
  }

  // ---- Multi-selection ----

  isSelected(id: string): boolean {
    return this.selectedIds().has(id) || id === this.selectedTokenId();
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  /**
   * Fully clear the row selection — multi-selection, range anchor and the
   * focused/ring token. Used when the user clicks empty space in the table to
   * dismiss the selection (the inspector panel, if open, stays as-is).
   */
  deselectAll(): void {
    this.selectedIds.set(new Set());
    this.selectionAnchor = null;
    this.selectedTokenId.set(null);
  }

  /** Single-select `id` (replaces the selection) and make it the range anchor. */
  selectOnly(id: string): void {
    this.selectedIds.set(new Set([id]));
    this.selectionAnchor = id;
    this.selectedTokenId.set(id);
  }

  /** Toggle `id` in the selection (cmd/ctrl-click). */
  toggleSelection(id: string): void {
    const next = new Set(this.selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selectedIds.set(next);
    this.selectionAnchor = id;
    this.selectedTokenId.set(id);
  }

  /** Select every id from the anchor to `id` within `orderedIds` (shift-click). */
  selectRange(orderedIds: string[], id: string): void {
    const anchor = this.selectionAnchor;
    if (!anchor) {
      this.selectOnly(id);
      return;
    }
    const a = orderedIds.indexOf(anchor);
    const b = orderedIds.indexOf(id);
    if (a < 0 || b < 0) {
      this.selectOnly(id);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.selectedIds.set(new Set(orderedIds.slice(lo, hi + 1)));
    this.selectedTokenId.set(id);
  }

  /** Switch to the token's collection if needed, then select it. */
  async revealToken(id: string, collection: string): Promise<void> {
    if (this.currentCollectionName() !== collection) {
      await this.selectCollection(collection);
    }
    this.selectedTokenId.set(id);
    this.inspectedTokenId.set(id);
  }

  /**
   * Reveal a token from just its id (e.g. a diagnostics "Go to token" link):
   * resolve its collection from the server, switch to it, clear any active
   * group/search filter so the row is visible, then select it (the table scrolls
   * to and highlights the selection).
   */
  async revealTokenById(id: string): Promise<boolean> {
    try {
      const { token } = await this.fetch(this.api.getToken(id));
      if (this.currentCollectionName() !== token.collection) {
        await this.selectCollection(token.collection);
      }
      this.groupPrefix.set(null);
      this.clearSearch();
      this.clearSelection();
      this.selectedTokenId.set(id);
      this.inspectedTokenId.set(id);
      return true;
    } catch (err) {
      this.error.set(errMessage(err));
      return false;
    }
  }

  async updateValue(id: string, mode: string, value: unknown): Promise<boolean> {
    // Optimistic: reflect the edit in the edited cell immediately so the UI
    // feels instant; the server round-trip then reconciles (and propagates
    // alias-dependent cells, which we can't compute locally).
    this.patchTokenValue(id, mode, value);
    try {
      const result = await this.fetch(this.api.updateValue(id, mode, value));
      await this.refresh();
      return result.ok;
    } catch (err) {
      this.error.set(errMessage(err));
      await this.refresh(); // roll back the optimistic patch from authority
      return false;
    }
  }

  /**
   * Apply many value edits in one server transaction (one undo item). Used by
   * paste-to-multi-selection and bulk "set value". Optimistic per cell, then a
   * single refresh reconciles.
   */
  async updateValuesBatch(
    changes: { id: string; mode: string; value: unknown }[],
  ): Promise<boolean> {
    if (changes.length === 0) return true;
    for (const c of changes) this.patchTokenValue(c.id, c.mode, c.value);
    try {
      const res = await this.fetch(this.api.updateValuesBatch(changes));
      await this.refresh();
      if (res.ok) this.ui.showToast(`Set ${changes.length} value${changes.length > 1 ? 's' : ''}`);
      return res.ok;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Set (or clear) a token's description; optimistic, then reconcile. */
  async updateDescription(id: string, description: string): Promise<boolean> {
    const col = this.collection();
    if (col) {
      const trimmed = description.trim();
      const tokens = col.tokens.map((t) =>
        t.id === id ? { ...t, description: trimmed || undefined } : t,
      );
      this.collection.set({ ...col, tokens });
    }
    try {
      const result = await this.fetch(this.api.updateDescription(id, description));
      await this.refresh();
      return result.ok;
    } catch (err) {
      this.error.set(errMessage(err));
      await this.refresh();
      return false;
    }
  }

  /** Optimistic, non-persisted value update (e.g. live colour-picker drag). */
  previewValue(id: string, mode: string, value: unknown): void {
    this.patchTokenValue(id, mode, value);
  }

  /** Patch a single token's raw (and best-effort resolved) value in-place. */
  private patchTokenValue(id: string, mode: string, value: unknown): void {
    const col = this.collection();
    if (!col) return;
    const tokens = col.tokens.map((t) => {
      if (t.id !== id) return t;
      const isAliasVal = typeof value === 'string' && value.startsWith('{') && value.endsWith('}');
      return {
        ...t,
        rawValuesByMode: { ...t.rawValuesByMode, [mode]: value },
        // Only safe to predict the resolved value when it's a literal.
        ...(isAliasVal
          ? {}
          : { resolvedValuesByMode: { ...t.resolvedValuesByMode, [mode]: value } }),
      };
    });
    this.collection.set({ ...col, tokens });
  }

  async deleteToken(id: string): Promise<boolean> {
    try {
      const res = await this.fetch(this.api.deleteToken(id));
      if (!res.ok) {
        if (res.diagnostics[0]) this.ui.showToast(res.diagnostics[0].message, 4000);
        return false;
      }
      if (this.selectedTokenId() === id) this.selectedTokenId.set(null);
      if (this.inspectedTokenId() === id) this.inspectedTokenId.set(null);
      this.selectedIds.update((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      await this.refresh();
      return true;
    } catch (err) {
      // HttpClient rejects non-2xx (e.g. 422) — surface why instead of silently
      // leaving the row in place.
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  // ---- Search / filters ----

  setQuery(q: string): void {
    this.searchQuery.set(q);
    void this.runSearch();
  }

  setFilters(filters: SearchFilters): void {
    this.filters.set(filters);
    void this.runSearch();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.filters.set({});
    this.searchHitIds.set(null);
  }

  async runSearch(): Promise<void> {
    if (!this.searchActive()) {
      this.searchHitIds.set(null);
      return;
    }
    try {
      const res = await this.fetch(this.api.search(this.searchQuery(), this.filters()));
      this.searchHitIds.set(new Set(res.hits.map((h) => h.id)));
    } catch (err) {
      this.error.set(errMessage(err));
    }
  }

  // ---- Rename / references / quick-fix ----

  async references(id: string): Promise<ReferenceInfo[]> {
    const res = await this.fetch(this.api.getReferences(id));
    return res.references;
  }

  /**
   * Open a project-relative file (e.g. a token's source) in the OS default
   * editor. Reuses the distribution open endpoint, which is confined to the
   * project root server-side.
   */
  async openFileInEditor(relPath: string): Promise<boolean> {
    try {
      const res = await this.fetch(this.api.openDistributionFile(relPath));
      return res.ok;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      return false;
    }
  }

  async renamePreview(id: string, dottedPath: string): Promise<{ files: number; references: number; conflict: boolean }> {
    return this.fetch(this.api.renamePreview(id, dottedPath));
  }

  async rename(id: string, newPath: string[], updateReferences: boolean): Promise<boolean> {
    const res = await this.fetch(this.api.rename(id, newPath, updateReferences));
    if (res.ok && res.token) this.selectedTokenId.set(res.token.id);
    await this.refresh();
    return res.ok;
  }

  async reorder(collection: string, groupPath: string[], order: string[]): Promise<boolean> {
    // Optimistic: re-order the affected children locally so the row/group snaps
    // into place instantly, then let the server write reconcile.
    this.patchReorder(groupPath, order);
    try {
      const res = await this.fetch(this.api.reorder(collection, groupPath, order));
      await this.refresh();
      return res.ok;
    } catch (err) {
      // e.g. numeric keys can't be reordered (JSON serialises them ascending) —
      // surface why, then refresh to snap the optimistic move back.
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /**
   * Reorder, in the local collection, the tokens whose direct group is
   * `groupPath` (or whose `groupPath`-th segment defines their sub-tree) to
   * follow `order`. Tokens are sorted by the new index of their relevant key;
   * everything else keeps its relative order (stable sort).
   */
  private patchReorder(groupPath: string[], order: string[]): void {
    const col = this.collection();
    if (!col) return;
    const rank = new Map(order.map((k, i) => [k, i]));
    const keyAt = (path: string[]): string | null => {
      // The key being reordered is the segment right after groupPath.
      if (path.length <= groupPath.length) return null;
      if (!groupPath.every((s, i) => path[i] === s)) return null;
      return path[groupPath.length] ?? null;
    };
    const indexed = col.tokens.map((t, i) => ({ t, i }));
    indexed.sort((a, b) => {
      const ka = keyAt(a.t.path);
      const kb = keyAt(b.t.path);
      // Only rows within the reordered group participate; keep others stable.
      if (ka === null || kb === null) return a.i - b.i;
      const ra = rank.get(ka);
      const rb = rank.get(kb);
      if (ra === undefined || rb === undefined) return a.i - b.i;
      return ra !== rb ? ra - rb : a.i - b.i;
    });
    this.collection.set({ ...col, tokens: indexed.map((x) => x.t) });
  }

  // ---- Group selection (sidebar) ----

  /** Anchor (dotted path) for sidebar group shift-click range selection. */
  groupSelectionAnchor: string | null = null;

  toggleGroupSelection(path: string[]): void {
    const key = path.join('.');
    const next = new Set(this.selectedGroupKeys());
    next.has(key) ? next.delete(key) : next.add(key);
    this.selectedGroupKeys.set(next);
    this.groupSelectionAnchor = key;
  }
  /** Replace the group selection outright (shift-click range). */
  setGroupSelection(keys: string[]): void {
    this.selectedGroupKeys.set(new Set(keys));
  }
  clearGroupSelection(): void {
    if (this.selectedGroupKeys().size) this.selectedGroupKeys.set(new Set());
    this.groupSelectionAnchor = null;
  }

  /** Re-nest a whole group under a new parent path. */
  async moveGroup(collection: string, groupPath: string[], newParentPath: string[]): Promise<boolean> {
    const res = await this.fetch(this.api.moveGroup(collection, groupPath, newParentPath));
    if (!res.ok && res.diagnostics[0]) this.error.set(res.diagnostics[0].message);
    await this.refresh();
    return res.ok;
  }

  /**
   * Re-nest the dragged group — or, if it is part of the sidebar multi-selection,
   * every selected group — under `newParentPath`. Sequential (server applies each
   * atomically) then a single refresh.
   */
  async moveGroups(collection: string, draggedPath: string[], newParentPath: string[]): Promise<void> {
    const sel = this.selectedGroupKeys();
    const draggedKey = draggedPath.join('.');
    const paths =
      sel.has(draggedKey) && sel.size > 1
        ? [...sel].map((k) => k.split('.'))
        : [draggedPath];
    let anyError = false;
    for (const p of paths) {
      const res = await this.fetch(this.api.moveGroup(collection, p, newParentPath));
      if (!res.ok && res.diagnostics[0]) {
        this.error.set(res.diagnostics[0].message);
        anyError = true;
      }
    }
    this.clearGroupSelection();
    await this.refresh();
    if (!anyError) this.error.set(null);
  }

  /** Ordered direct-child group names under `parentPath` (tree order). */
  private childGroupNames(parentPath: string[]): string[] {
    let level = this.collection()?.groups ?? [];
    for (const seg of parentPath) {
      const node = level.find((g) => g.name === seg);
      if (!node) return [];
      level = node.children;
    }
    return level.map((g) => g.name);
  }

  /** New sibling order with `movingLeaves` lifted out and re-inserted at `refLeaf`. */
  private orderAround(
    names: string[],
    movingLeaves: string[],
    refLeaf: string,
    after: boolean,
  ): string[] {
    const moving = new Set(movingLeaves);
    const block = names.filter((n) => moving.has(n)); // preserve current order
    const remaining = names.filter((n) => !moving.has(n));
    const refIdx = remaining.indexOf(refLeaf);
    const insertAt = refIdx < 0 ? remaining.length : refIdx + (after ? 1 : 0);
    const next = [...remaining];
    next.splice(insertAt, 0, ...block);
    return next;
  }

  /**
   * Drop a dragged group (and, when part of the multi-selection, the whole block)
   * at the insertion line — i.e. just before/after the sibling `refPath`. Two cases:
   *  - same parent  → a pure sibling reorder under that parent;
   *  - other parent → re-nest the group(s) under `refPath`'s parent, then reorder
   *    so the dragged group lands next to `refPath` (best-effort positioning).
   *
   * Driven entirely by the resolved drop intent, so it works regardless of which
   * CDK list reports the drop (the cross-level transfer is unreliable when sorting
   * is disabled — dropping over another level can fire on the origin list).
   */
  async moveGroupToPosition(
    collection: string,
    draggedPath: string[],
    refPath: string[],
    after: boolean,
  ): Promise<void> {
    if (draggedPath.join('/') === refPath.join('/')) return; // dropped on itself
    const targetParent = refPath.slice(0, -1);
    const refLeaf = refPath[refPath.length - 1]!;
    const draggedLeaf = draggedPath[draggedPath.length - 1]!;
    const sel = this.selectedGroupKeys();
    const useSel = sel.has(draggedPath.join('.')) && sel.size > 1;

    if (draggedPath.slice(0, -1).join('/') === targetParent.join('/')) {
      // Same parent → reorder siblings.
      const names = this.childGroupNames(targetParent);
      const movingLeaves = useSel
        ? names.filter((n) => sel.has([...targetParent, n].join('.')))
        : [draggedLeaf];
      const next = this.orderAround(names, movingLeaves, refLeaf, after);
      if (names.length === next.length && names.every((n, i) => n === next[i])) return;
      await this.reorder(collection, targetParent, next);
      if (useSel) this.clearGroupSelection();
      return;
    }

    // Different parent → re-nest under refPath's parent (moveGroups handles the
    // multi-selection + refresh), then position the dragged group next to refPath.
    await this.moveGroups(collection, draggedPath, targetParent);
    if (this.error()) return; // move was rejected (e.g. name collision)
    const names = this.childGroupNames(targetParent);
    if (!names.includes(draggedLeaf) || !names.includes(refLeaf)) return;
    const next = this.orderAround(names, [draggedLeaf], refLeaf, after);
    if (names.length !== next.length || names.some((n, i) => n !== next[i])) {
      await this.reorder(collection, targetParent, next);
    }
  }

  /**
   * Move one or more tokens to new paths (cross-group drag), then refresh once.
   * The whole batch is applied server-side in a single transaction, so a
   * multi-selection move is **one** undo item — not one per token.
   */
  async moveTokens(moves: { id: string; newPath: string[] }[]): Promise<void> {
    if (!moves.length) return;
    try {
      await this.fetch(this.api.moveTokens(moves));
    } catch (err) {
      this.error.set(errMessage(err));
    }
    await this.refresh();
  }

  /**
   * Move the dragged token — or the whole multi-selection if it includes the
   * dragged row — so each lands directly under `targetParentPath` (its leaf name
   * preserved). On a name collision in the target group, the moved variable gets
   * a `name2`-style suffix instead of failing. Used by table + sidebar drops.
   */
  async moveSelectedTokensTo(targetParentPath: string[], draggedId: string): Promise<void> {
    const sel = this.selectedIds();
    const ids = sel.has(draggedId) && sel.size > 1 ? [...sel] : [draggedId];
    this.clearSelection();
    await this.moveTokensToParent(ids, targetParentPath);
  }

  /**
   * Move the tokens with the given ids so each lands directly under
   * `targetParentPath`, preserving its leaf name. On a name collision in the
   * target group the moved variable gets a `name2`-style suffix instead of
   * failing. Tokens already in the target are skipped. Shared by drag-to-group
   * and cut/paste.
   */
  async moveTokensToParent(ids: string[], targetParentPath: string[]): Promise<void> {
    const tokens = this.allTokens();
    const moving = ids
      .map((id) => tokens.find((t) => t.id === id))
      .filter((t): t is ParsedToken => !!t);

    // Names already present under the target (excluding the ones we're moving).
    const movingKeys = new Set(moving.map((t) => t.path.join('.')));
    const target = targetParentPath.join('.');
    const taken = new Set<string>();
    for (const t of tokens) {
      if (movingKeys.has(t.path.join('.'))) continue;
      if (t.path.length > targetParentPath.length && targetParentPath.every((s, i) => t.path[i] === s)) {
        taken.add(t.path[targetParentPath.length]!);
      }
    }

    const moves: { id: string; newPath: string[] }[] = [];
    for (const t of moving) {
      if (t.path.slice(0, -1).join('.') === target) continue; // already in target group
      const leaf = nextFreeName(taken, t.path[t.path.length - 1]!);
      taken.add(leaf);
      moves.push({ id: t.id, newPath: [...targetParentPath, leaf] });
    }

    if (moves.length) await this.moveTokens(moves);
  }

  // ---- Structural ops (rename / delete / duplicate) ----

  /** Rename a token in place (change only its leaf segment), refs rewritten. */
  async renameTokenLeaf(id: string, newLeaf: string): Promise<boolean> {
    const t = this.allTokens().find((x) => x.id === id);
    if (!t) return false;
    const leaf = newLeaf.trim();
    if (!leaf || leaf === t.path[t.path.length - 1]) return true;
    return this.rename(id, [...t.path.slice(0, -1), leaf], true);
  }

  async renameGroup(collection: string, groupPath: string[], newName: string): Promise<boolean> {
    const res = await this.fetch(this.api.renameGroup(collection, groupPath, newName));
    if (!res.ok && res.diagnostics[0]) this.error.set(res.diagnostics[0].message);
    await this.refresh();
    return res.ok;
  }

  async deleteGroup(collection: string, groupPath: string[]): Promise<boolean> {
    const res = await this.fetch(this.api.deleteGroup(collection, groupPath));
    if (!res.ok && res.diagnostics[0]) this.error.set(res.diagnostics[0].message);
    if (this.groupPrefix()?.join('.') === groupPath.join('.')) this.selectGroup(null);
    await this.refresh();
    return res.ok;
  }

  async duplicateGroup(collection: string, groupPath: string[]): Promise<boolean> {
    const res = await this.fetch(this.api.duplicateGroup(collection, groupPath));
    if (!res.ok && res.diagnostics[0]) this.error.set(res.diagnostics[0].message);
    await this.refresh();
    return res.ok;
  }

  // ---- Whole-variable copy / paste (paste a row into a chosen group) ----

  /** Copy the given variables (or the current selection) to the variable clipboard. */
  copyVariables(ids?: string[]): void {
    const col = this.currentCollectionName();
    if (!col) return;
    const list = ids && ids.length ? ids : this.selectionIds();
    if (!list.length) return;
    this.copiedTokenRefs.set(list.map((id) => ({ id, collection: col })));
    this.clipboardMode.set('copy');
    this.ui.showToast(`Copied ${list.length} variable${list.length > 1 ? 's' : ''}`);
  }

  /** Cut the given variables (or the current selection): paste will MOVE them. */
  cutVariables(ids?: string[]): void {
    const col = this.currentCollectionName();
    if (!col) return;
    const list = ids && ids.length ? ids : this.selectionIds();
    if (!list.length) return;
    this.copiedTokenRefs.set(list.map((id) => ({ id, collection: col })));
    this.clipboardMode.set('cut');
    this.ui.showToast(`Cut ${list.length} variable${list.length > 1 ? 's' : ''} — paste to move, Esc to cancel`);
  }

  /** Cancel a pending cut: the hidden variables reappear in place. */
  cancelCut(): void {
    if (this.clipboardMode() !== 'cut') return;
    this.copiedTokenRefs.set([]);
    this.clipboardMode.set('copy');
  }

  /** The ids the user is acting on: the multi-selection, else the focused row. */
  selectionIds(): string[] {
    const sel = this.selectedIds();
    if (sel.size) return [...sel];
    const focused = this.selectedTokenId();
    return focused ? [focused] : [];
  }

  /**
   * Resolve where a "paste variable" should land: an explicitly selected sidebar
   * group, else the active group filter, else the focused variable's parent group.
   */
  resolvePasteParent(): string[] | null {
    const groups = [...this.selectedGroupKeys()];
    if (groups.length === 1) return groups[0]!.split('.');
    const prefix = this.groupPrefix();
    if (prefix && prefix.length) return prefix;
    const sel = this.selectedToken();
    if (sel) return sel.path.slice(0, -1);
    return null;
  }

  /** Paste the clipboard variables under a target group (explicit, or resolved). */
  async pasteVariables(explicitParent?: string[]): Promise<void> {
    const refs = this.copiedTokenRefs();
    if (!refs.length) return;
    const col = this.currentCollectionName();
    const targets = refs.filter((r) => r.collection === col);
    if (!targets.length) {
      this.ui.showToast('Copied variable is in another collection');
      return;
    }
    const parent = explicitParent ?? this.resolvePasteParent();
    if (!parent) {
      this.ui.showToast('Select a group or variable to paste into');
      return;
    }

    // Cut → MOVE the variables into the target group (one-shot), then clear.
    if (this.clipboardMode() === 'cut') {
      const ids = targets.map((r) => r.id);
      await this.moveTokensToParent(ids, parent);
      this.copiedTokenRefs.set([]);
      this.clipboardMode.set('copy');
      this.ui.showToast(`Moved ${ids.length} variable${ids.length > 1 ? 's' : ''}`);
      return;
    }

    let lastId: string | undefined;
    let okCount = 0;
    for (const r of targets) {
      try {
        const res = await this.fetch(this.api.copyTokenTo(r.id, parent));
        if (res.ok) {
          okCount++;
          if (res.token) lastId = res.token.id;
        } else if (res.diagnostics[0]) {
          this.ui.showToast(res.diagnostics[0].message, 4000);
        }
      } catch (err) {
        this.ui.showToast(errMessage(err), 4000);
      }
    }
    await this.refresh();
    if (lastId) {
      this.clearSelection();
      this.selectedTokenId.set(lastId);
    }
    if (okCount) this.ui.showToast(`Pasted ${okCount} variable${okCount > 1 ? 's' : ''}`);
  }

  /**
   * Create a new variable of `type` directly under `parentPath` (root = `[]`).
   * It lands with a free `new-variable`-style leaf name and per-mode default
   * values matching the type, gets selected, and is queued for inline rename so
   * the user can name it immediately (Figma-like). Driven by the toolbar
   * "Create variable" dropdown and each group divider's `+`.
   */
  async createVariable(type: DtcgType, parentPath: string[]): Promise<boolean> {
    const collection = this.currentCollectionName();
    if (!collection) return false;
    const leaf = nextFreeName(this.childLeafNames(parentPath), 'new-variable');
    const path = [...parentPath, leaf];

    const base = defaultValueForType(type);
    const modes = this.modes();
    const valuesByMode: Record<string, unknown> = {};
    if (modes.length) for (const m of modes) valuesByMode[m.id] = structuredClone(base);
    else valuesByMode['default'] = structuredClone(base);

    try {
      const res = await this.fetch(this.api.createToken({ collection, path, type, valuesByMode }));
      await this.refresh();
      if (res.ok && res.token) {
        // Clear any group/search filter so the new row is visible, then select it
        // and queue the inline rename.
        if (parentPath.length) this.groupPrefix.set(null);
        this.clearSearch();
        this.clearSelection();
        this.selectedTokenId.set(res.token.id);
        this.pendingRenameTokenId.set(res.token.id);
      } else if (res.diagnostics[0]) {
        this.ui.showToast(res.diagnostics[0].message, 4000);
      }
      return res.ok;
    } catch (err) {
      this.ui.showToast(errMessage(err), 4000);
      await this.refresh();
      return false;
    }
  }

  /** Names already taken (child groups + child tokens) directly under `parentPath`. */
  private childLeafNames(parentPath: string[]): Set<string> {
    const taken = new Set<string>(this.childGroupNames(parentPath));
    for (const t of this.allTokens()) {
      if (t.path.length > parentPath.length && parentPath.every((s, i) => t.path[i] === s)) {
        taken.add(t.path[parentPath.length]!);
      }
    }
    return taken;
  }

  async duplicateToken(id: string): Promise<boolean> {
    const res = await this.fetch(this.api.duplicateToken(id));
    if (!res.ok && res.diagnostics[0]) this.error.set(res.diagnostics[0].message);
    if (res.ok && res.token) this.selectedTokenId.set(res.token.id);
    await this.refresh();
    return res.ok;
  }

  /** Undo the most recent mutation (byte-exact, server-side). */
  async undo(): Promise<void> {
    await this.runHistory('undo');
  }

  /** Re-apply the most recently undone mutation. */
  async redo(): Promise<void> {
    await this.runHistory('redo');
  }

  /**
   * Drive an undo or redo. On a disk-divergence conflict (HTTP 409) the user is
   * asked whether to apply anyway (force). After a successful apply the project
   * refreshes (the server broadcasts), the affected token is re-selected, and a
   * toast confirms what changed.
   */
  private async runHistory(dir: 'undo' | 'redo'): Promise<void> {
    const call = (force: boolean) =>
      this.fetch(dir === 'undo' ? this.api.undo(force) : this.api.redo(force));
    let res: UndoRedoResult;
    try {
      res = await call(false);
    } catch (err) {
      const body = (err as { error?: UndoRedoResult }).error;
      if (body?.reason === 'diverged') {
        const files = body.diverged?.join(', ') ?? 'a file';
        const ok = confirm(
          `${files} changed on disk since this edit.\n\n${dir === 'undo' ? 'Undo' : 'Redo'} anyway and overwrite the on-disk version?`,
        );
        if (!ok) return;
        try {
          res = await call(true);
        } catch (err2) {
          this.error.set(errMessage(err2));
          return;
        }
      } else if (body?.reason === 'empty') {
        this.ui.showToast(dir === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
        return;
      } else {
        this.error.set(errMessage(err));
        return;
      }
    }
    if (!res.ok) return;
    await this.refresh();
    if (res.tokenId) void this.revealTokenById(res.tokenId);
    const verb = dir === 'undo' ? 'Undone' : 'Redone';
    this.ui.showToast(res.label ? `${verb}: ${res.label}` : verb);
  }

  async applyQuickFix(
    tokenId: string,
    action: string,
    mode: string | undefined,
    data: Record<string, unknown> | undefined,
  ): Promise<boolean> {
    const res = await this.fetch(this.api.applyQuickFix(tokenId, action, mode, data));
    await this.refresh();
    return res.ok;
  }

  private fetch<T>(obs: Observable<T>): Promise<T> {
    return firstValueFrom(obs);
  }
}

/**
 * Human-readable message from a thrown value. HttpClient rejects non-2xx
 * responses with an HttpErrorResponse whose `.error` is our `MutationResult`
 * body — surface its diagnostic instead of the useless "[object Object]".
 */
function errMessage(err: unknown): string {
  const e = err as { error?: { diagnostics?: { message?: string }[] }; message?: string };
  const diag = e?.error?.diagnostics?.[0]?.message;
  if (diag) return diag;
  if (typeof e?.message === 'string') return e.message;
  return 'Unexpected error';
}

/** First name not in `taken`: `base`, then `base2`, `base3`, … */
function nextFreeName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}${i}`;
    if (!taken.has(cand)) return cand;
  }
}
