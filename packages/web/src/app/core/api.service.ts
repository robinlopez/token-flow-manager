import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { getAuthToken } from './auth';
import type {
  BrowseResponse,
  Collection,
  ConfigPatch,
  DistBuildReport,
  DistMatrix,
  DistConfig,
  DistributionState,
  DtcgType,
  MutationResult,
  TokenConfigManifest,
  ParsedToken,
  ProjectConfig,
  ProjectState,
  RecentProject,
  ReferenceInfo,
  RenamePreview,
  SearchFilters,
  SearchResponse,
  UndoRedoResult,
  WriteDistributionResult,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly token = getAuthToken();

  private params(): HttpParams {
    return this.token ? new HttpParams().set('token', this.token) : new HttpParams();
  }

  getState(): Observable<ProjectState> {
    return this.http.get<ProjectState>('/api/state', { params: this.params() });
  }

  reload(): Observable<ProjectState> {
    return this.http.post<ProjectState>('/api/reload', {}, { params: this.params() });
  }

  // ---- Project picker (welcome screen) ----
  getRecents(): Observable<{ recents: RecentProject[] }> {
    return this.http.get<{ recents: RecentProject[] }>('/api/recents', { params: this.params() });
  }

  browse(path?: string): Observable<BrowseResponse> {
    const params = path ? this.params().set('path', path) : this.params();
    return this.http.get<BrowseResponse>('/api/browse', { params });
  }

  /** Open the OS-native folder picker on the server machine; resolves to the path or null. */
  pickFolder(): Observable<{ path: string | null }> {
    return this.http.post<{ path: string | null }>('/api/pick-folder', {}, { params: this.params() });
  }

  removeRecent(path: string): Observable<{ recents: RecentProject[] }> {
    return this.http.post<{ recents: RecentProject[] }>(
      '/api/recents/remove',
      { path },
      { params: this.params() },
    );
  }

  openProject(path: string): Observable<ProjectState> {
    return this.http.post<ProjectState>('/api/open', { path }, { params: this.params() });
  }

  closeProject(): Observable<ProjectState> {
    return this.http.post<ProjectState>('/api/close', {}, { params: this.params() });
  }

  getConfig(): Observable<ProjectConfig> {
    return this.http.get<ProjectConfig>('/api/config', { params: this.params() });
  }

  updateConfig(patch: ConfigPatch): Observable<{ config: ProjectConfig }> {
    return this.http.patch<{ config: ProjectConfig }>('/api/config', patch, {
      params: this.params(),
    });
  }

  getToken(id: string): Observable<{ token: ParsedToken }> {
    return this.http.get<{ token: ParsedToken }>(`/api/tokens/${id}`, { params: this.params() });
  }

  getAllTokens(): Observable<{ tokens: ParsedToken[] }> {
    return this.http.get<{ tokens: ParsedToken[] }>('/api/tokens', { params: this.params() });
  }

  /** Create a new token (variable) in a collection with default per-mode values. */
  createToken(req: {
    collection: string;
    path: string[];
    type: DtcgType;
    valuesByMode: Record<string, unknown>;
    description?: string;
  }): Observable<MutationResult> {
    return this.http.post<MutationResult>('/api/tokens', req, { params: this.params() });
  }

  getCollection(name: string): Observable<Collection> {
    return this.http.get<Collection>(`/api/collections/${encodeURIComponent(name)}`, {
      params: this.params(),
    });
  }

  updateValue(id: string, mode: string, value: unknown): Observable<MutationResult> {
    return this.http.patch<MutationResult>(
      `/api/tokens/${id}/values/${encodeURIComponent(mode)}`,
      { value },
      { params: this.params() },
    );
  }

  updateDescription(id: string, description: string): Observable<MutationResult> {
    return this.http.patch<MutationResult>(
      `/api/tokens/${id}/description`,
      { description },
      { params: this.params() },
    );
  }

  updateValuesBatch(
    changes: { id: string; mode: string; value: unknown }[],
  ): Observable<MutationResult> {
    return this.http.patch<MutationResult>('/api/tokens/batch', { changes }, { params: this.params() });
  }

  deleteToken(id: string): Observable<MutationResult> {
    return this.http.delete<MutationResult>(`/api/tokens/${id}`, { params: this.params() });
  }

  getReferences(id: string): Observable<{ references: ReferenceInfo[] }> {
    return this.http.get<{ references: ReferenceInfo[] }>(`/api/tokens/${id}/references`, {
      params: this.params(),
    });
  }

  renamePreview(id: string, dottedPath: string): Observable<RenamePreview> {
    return this.http.get<RenamePreview>(`/api/tokens/${id}/rename-preview`, {
      params: this.params().set('path', dottedPath),
    });
  }

  rename(id: string, newPath: string[], updateReferences: boolean): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      `/api/tokens/${id}/rename`,
      { newPath, updateReferences },
      { params: this.params() },
    );
  }

  /** Add a new mode to a collection, seeded from an existing mode. */
  addMode(collection: string, name: string, fromMode?: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/modes/add',
      { collection, name, ...(fromMode ? { fromMode } : {}) },
      { params: this.params() },
    );
  }

  /** Rename a mode of a collection. */
  renameMode(collection: string, from: string, to: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/modes/rename',
      { collection, from, to },
      { params: this.params() },
    );
  }

  /** Delete a mode from a collection. */
  deleteMode(collection: string, mode: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/modes/delete',
      { collection, mode },
      { params: this.params() },
    );
  }

  /** Duplicate a mode of a collection (a copy seeded from it). */
  duplicateMode(collection: string, mode: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/modes/duplicate',
      { collection, mode },
      { params: this.params() },
    );
  }

  /** Generate `manifest.json` from the current organization (and slim the config). */
  generateManifest(): Observable<MutationResult> {
    return this.http.post<MutationResult>('/api/manifest/generate', {}, { params: this.params() });
  }

  /** Open the project's `manifest.json` in the OS default editor. */
  openManifest(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/manifest/open', {}, { params: this.params() });
  }

  /** Add a new (empty) collection, backed by a freshly-created token file. */
  addCollection(name: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/collections/add',
      { name },
      { params: this.params() },
    );
  }

  /** Rename a collection (config-level; files keep their names). */
  renameCollection(from: string, to: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/collections/rename',
      { from, to },
      { params: this.params() },
    );
  }

  /** Delete a collection (its files are left on disk). */
  deleteCollection(name: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/collections/delete',
      { name },
      { params: this.params() },
    );
  }

  /** Move N tokens to new paths in one transaction (a single undo item). */
  moveTokens(moves: { id: string; newPath: string[] }[]): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/tokens/move',
      { moves },
      { params: this.params() },
    );
  }

  search(query: string, filters: SearchFilters): Observable<SearchResponse> {
    let params = this.params().set('q', query);
    for (const [k, v] of Object.entries(filters)) {
      if (v === undefined || v === false || v === '') continue;
      if (Array.isArray(v)) {
        if (v.length) params = params.set(k, v.join(','));
      } else {
        params = params.set(k, String(v));
      }
    }
    return this.http.get<SearchResponse>('/api/search', { params });
  }

  reorder(collection: string, groupPath: string[], order: string[]): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/tokens/reorder',
      { collection, groupPath, order },
      { params: this.params() },
    );
  }

  moveGroup(
    collection: string,
    groupPath: string[],
    newParentPath: string[],
  ): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/groups/move',
      { collection, groupPath, newParentPath },
      { params: this.params() },
    );
  }

  renameGroup(collection: string, groupPath: string[], newName: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/groups/rename',
      { collection, groupPath, newName },
      { params: this.params() },
    );
  }

  deleteGroup(collection: string, groupPath: string[]): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/groups/delete',
      { collection, groupPath },
      { params: this.params() },
    );
  }

  duplicateGroup(collection: string, groupPath: string[]): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/groups/duplicate',
      { collection, groupPath },
      { params: this.params() },
    );
  }

  duplicateToken(id: string): Observable<MutationResult> {
    return this.http.post<MutationResult>(`/api/tokens/${id}/duplicate`, {}, { params: this.params() });
  }

  copyTokenTo(id: string, targetParentPath: string[]): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      `/api/tokens/${id}/copy-to`,
      { targetParentPath },
      { params: this.params() },
    );
  }

  undo(force = false): Observable<UndoRedoResult> {
    return this.http.post<UndoRedoResult>('/api/undo', { force }, { params: this.params() });
  }

  redo(force = false): Observable<UndoRedoResult> {
    return this.http.post<UndoRedoResult>('/api/redo', { force }, { params: this.params() });
  }

  applyQuickFix(
    tokenId: string,
    action: string,
    mode: string | undefined,
    data: Record<string, unknown> | undefined,
  ): Observable<MutationResult> {
    return this.http.post<MutationResult>(
      '/api/quick-fix',
      { tokenId, action, mode, data },
      { params: this.params() },
    );
  }

  // ---- Distribution (Phase 4 — token-config.json) ----

  getDistribution(): Observable<DistributionState> {
    return this.http.get<DistributionState>('/api/distribution', { params: this.params() });
  }

  updateManifest(manifest: TokenConfigManifest): Observable<DistributionState> {
    return this.http.put<DistributionState>('/api/distribution', { manifest }, { params: this.params() });
  }

  initDistribution(scaffoldScript: boolean): Observable<DistributionState> {
    return this.http.post<DistributionState>(
      '/api/distribution/init',
      { scaffoldScript },
      { params: this.params() },
    );
  }

  scaffoldBuildScript(): Observable<DistributionState> {
    return this.http.post<DistributionState>('/api/distribution/scaffold-script', {}, { params: this.params() });
  }

  /** Dry-run a v5 matrix; returns a concise report (errors/warnings/files). */
  testBuild(matrix: DistMatrix): Observable<DistBuildReport> {
    return this.http.post<DistBuildReport>('/api/distribution/test-build', { matrix }, { params: this.params() });
  }

  /** Write the v5 build script + npm script and persist the matrix. */
  writeDistribution(matrix: DistMatrix): Observable<WriteDistributionResult> {
    return this.http.post<WriteDistributionResult>('/api/distribution/write', { matrix }, { params: this.params() });
  }

  /** Dry-run the deterministic resolver for a config (sandboxed; no writes). */
  testBuildResolver(config: DistConfig): Observable<DistBuildReport> {
    return this.http.post<DistBuildReport>('/api/distribution/resolver/test-build', { config }, { params: this.params() });
  }

  /** Write the resolver build script + npm script and persist the config. */
  writeResolver(config: DistConfig): Observable<WriteDistributionResult> {
    return this.http.post<WriteDistributionResult>('/api/distribution/resolver/write', { config }, { params: this.params() });
  }

  /** Link an existing external config + build command ("I have my config"). */
  linkExisting(configPath: string, buildCommand: string): Observable<DistributionState> {
    return this.http.post<DistributionState>('/api/distribution/link', { configPath, buildCommand }, { params: this.params() });
  }

  /** Remove the external-build pointer. */
  unlinkDistribution(): Observable<DistributionState> {
    return this.http.post<DistributionState>('/api/distribution/unlink', {}, { params: this.params() });
  }

  /** Run the project's REAL build command (writes real outputs — not a dry-run). */
  runCommand(buildCommand: string): Observable<DistBuildReport> {
    return this.http.post<DistBuildReport>('/api/distribution/run-command', { buildCommand }, { params: this.params() });
  }

  /** Open a project-relative file in the OS default editor (best-effort). */
  openDistributionFile(path: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/distribution/open', { path }, { params: this.params() });
  }
}
