import { z } from 'zod';
import { DtcgTypeSchema, ParsedTokenSchema, ModeDefinitionSchema } from './model.js';
import { DiagnosticSchema } from './diagnostics.js';

/** Lightweight collection summary (no tokens) for the sidebar/list. */
export const CollectionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  files: z.array(z.string()),
  modes: z.array(ModeDefinitionSchema),
  /** Effective path-segment mode dimension (configured or auto-detected), if any. */
  modeDimension: z.number().int().nonnegative().optional(),
  tokenCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
export type CollectionSummary = z.infer<typeof CollectionSummarySchema>;

/** Undo/redo history summary for the UI (labels + available directions). */
export const HistoryStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  undoLabel: z.string().optional(),
  redoLabel: z.string().optional(),
  undo: z.array(z.string()),
  redo: z.array(z.string()),
});
export type HistoryState = z.infer<typeof HistoryStateSchema>;

/** One actionable structure problem surfaced to the onboarding banner. */
export const SetupIssueSchema = z.object({
  code: z.enum(['no-manifest', 'undetected-modes', 'mode-count-mismatch']),
  /** Collection the issue concerns, when collection-specific. */
  collection: z.string().optional(),
  message: z.string(),
});
export type SetupIssue = z.infer<typeof SetupIssueSchema>;

/** Where the project's token *organization* (collections/modes) currently comes from. */
export const OrganizationSourceSchema = z.enum(['manifest', 'config', 'auto']);
export type OrganizationSource = z.infer<typeof OrganizationSourceSchema>;

/** Project structural-setup status — drives the onboarding alert + guided setup. */
export const ProjectSetupSchema = z.object({
  organizationSource: OrganizationSourceSchema,
  hasManifest: z.boolean(),
  /** Empty when the structure is well understood; otherwise actionable items. */
  issues: z.array(SetupIssueSchema),
});
export type ProjectSetup = z.infer<typeof ProjectSetupSchema>;

export const ProjectStateSchema = z.object({
  /** False when no project is open yet (welcome screen). Defaults true for back-compat. */
  open: z.boolean().default(true),
  root: z.string(),
  collections: z.array(CollectionSummarySchema),
  diagnostics: z.array(DiagnosticSchema),
  tokenCount: z.number().int().nonnegative(),
  /** Undo/redo history summary (Phase 3.6). Optional for backward compat. */
  history: HistoryStateSchema.optional(),
  /** Structural-setup status (organization source + issues). Optional for back-compat. */
  setup: ProjectSetupSchema.optional(),
});

/** A directory entry returned by the local folder browser (welcome screen). */
export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isProject: z.boolean(),
});
export type DirEntry = z.infer<typeof DirEntrySchema>;

export const BrowseResponseSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(DirEntrySchema),
});
export type BrowseResponse = z.infer<typeof BrowseResponseSchema>;

/** A previously-opened project, surfaced on the welcome screen. */
export const RecentProjectSchema = z.object({
  path: z.string(),
  name: z.string(),
  exists: z.boolean(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const OpenProjectRequestSchema = z.object({ path: z.string().min(1) });
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;

/** Request body for POST /api/undo and /api/redo. */
export const UndoRedoRequestSchema = z.object({
  /** Apply even if a touched file diverged on disk (after a confirmation). */
  force: z.boolean().default(false),
});
export type UndoRedoRequest = z.infer<typeof UndoRedoRequestSchema>;

export const UndoRedoResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['empty', 'diverged']).optional(),
  label: z.string().optional(),
  tokenId: z.string().optional(),
  diverged: z.array(z.string()).optional(),
});
export type UndoRedoResult = z.infer<typeof UndoRedoResultSchema>;

// ---- CRUD payloads ----

export const CreateTokenRequestSchema = z.object({
  collection: z.string(),
  path: z.array(z.string()).min(1),
  type: DtcgTypeSchema,
  valuesByMode: z.record(z.unknown()),
  description: z.string().optional(),
});
export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>;

export const UpdateValueRequestSchema = z.object({
  mode: z.string(),
  value: z.unknown(),
});
export type UpdateValueRequest = z.infer<typeof UpdateValueRequestSchema>;

export const UpdateDescriptionRequestSchema = z.object({
  description: z.string(),
});
export type UpdateDescriptionRequest = z.infer<typeof UpdateDescriptionRequestSchema>;

export const RenameTokenRequestSchema = z.object({
  newPath: z.array(z.string()).min(1),
  /** Update all incoming references to point at the new path. */
  updateReferences: z.boolean().default(true),
});
export type RenameTokenRequest = z.infer<typeof RenameTokenRequestSchema>;

/** Batch value edits applied in one transaction (one undo item). */
export const UpdateValuesBatchRequestSchema = z.object({
  changes: z
    .array(z.object({ id: z.string(), mode: z.string(), value: z.unknown() }))
    .min(1),
});
export type UpdateValuesBatchRequest = z.infer<typeof UpdateValuesBatchRequestSchema>;

export const UpdateMetadataRequestSchema = z.object({
  description: z.string().optional(),
  deprecated: z.union([z.boolean(), z.string()]).optional(),
});
export type UpdateMetadataRequest = z.infer<typeof UpdateMetadataRequestSchema>;

export const TokenResponseSchema = z.object({
  token: ParsedTokenSchema,
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const MutationResultSchema = z.object({
  ok: z.boolean(),
  token: ParsedTokenSchema.optional(),
  /** Tokens whose resolved values changed as a side effect. */
  affectedTokenIds: z.array(z.string()).default([]),
  diagnostics: z.array(DiagnosticSchema).default([]),
});
export type MutationResult = z.infer<typeof MutationResultSchema>;

export const ReferenceInfoSchema = z.object({
  id: z.string(),
  path: z.array(z.string()),
  collection: z.string(),
  type: z.string(),
  modes: z.array(z.string()),
});
export type ReferenceInfo = z.infer<typeof ReferenceInfoSchema>;

export const ReferencesResponseSchema = z.object({
  references: z.array(ReferenceInfoSchema),
});
export type ReferencesResponse = z.infer<typeof ReferencesResponseSchema>;

export const RenamePreviewSchema = z.object({
  files: z.number().int().nonnegative(),
  references: z.number().int().nonnegative(),
  conflict: z.boolean(),
});
export type RenamePreview = z.infer<typeof RenamePreviewSchema>;

export const SearchFiltersSchema = z.object({
  /**
   * Keep only tokens whose type is in this set (empty/absent = no type filter).
   * Plain strings, not `DtcgType`, so `"unknown"` (untyped tokens) is filterable too.
   */
  types: z.array(z.string()).optional(),
  collection: z.string().optional(),
  /** `only` = aliases only, `none` = non-aliases only, absent = both. */
  alias: z.enum(['only', 'none']).optional(),
  deprecated: z.boolean().optional(),
  orphans: z.boolean().optional(),
  hasErrors: z.boolean().optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const SearchHitSchema = z.object({
  id: z.string(),
  path: z.array(z.string()),
  collection: z.string(),
  type: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitSchema),
  total: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ReorderRequestSchema = z.object({
  collection: z.string(),
  /** Path of the group whose direct children are being reordered ([] = root). */
  groupPath: z.array(z.string()),
  /** New order of the group's direct child leaf names. */
  order: z.array(z.string()),
});
export type ReorderRequest = z.infer<typeof ReorderRequestSchema>;

/** Move N tokens to new paths in one transaction (one undo item). */
export const MoveTokensRequestSchema = z.object({
  moves: z
    .array(z.object({ id: z.string(), newPath: z.array(z.string()).min(1) }))
    .min(1),
});
export type MoveTokensRequest = z.infer<typeof MoveTokensRequestSchema>;

export const MoveGroupRequestSchema = z.object({
  collection: z.string(),
  /** Path of the group to move (its last segment is the group name). */
  groupPath: z.array(z.string()).min(1),
  /** New parent path the group becomes a child of ([] = root). */
  newParentPath: z.array(z.string()),
});
export type MoveGroupRequest = z.infer<typeof MoveGroupRequestSchema>;

export const RenameGroupRequestSchema = z.object({
  collection: z.string(),
  groupPath: z.array(z.string()).min(1),
  newName: z.string().min(1),
});
export type RenameGroupRequest = z.infer<typeof RenameGroupRequestSchema>;

export const DeleteGroupRequestSchema = z.object({
  collection: z.string(),
  groupPath: z.array(z.string()).min(1),
});
export type DeleteGroupRequest = z.infer<typeof DeleteGroupRequestSchema>;

export const DuplicateGroupRequestSchema = z.object({
  collection: z.string(),
  groupPath: z.array(z.string()).min(1),
});
export type DuplicateGroupRequest = z.infer<typeof DuplicateGroupRequestSchema>;

export const UpdateConfigRequestSchema = z.object({
  strictTypes: z.boolean().optional(),
  inferTypes: z.boolean().optional(),
  writeDebounceMs: z.number().int().nonnegative().optional(),
  crossCollection: z.boolean().optional(),
  maxAliasDepth: z.number().int().positive().optional(),
  /** Resolution order (collection names, earliest first). */
  order: z.array(z.string()).optional(),
  /** Per-collection mode overrides (by name): rename/add/remove mode labels and
   * remap files → modes. Editing collections "locks" them (hand-authored). */
  collections: z
    .array(
      z.object({
        name: z.string(),
        modes: z.array(z.string()).optional(),
        fileModes: z.record(z.string()).optional(),
        /** Path depth to fold into mode columns; null clears it (back to groups). */
        modeDimension: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .optional(),
});
export type UpdateConfigRequest = z.infer<typeof UpdateConfigRequestSchema>;

/** Add a new mode to a collection, seeded by copying an existing mode. */
export const AddModeRequestSchema = z.object({
  collection: z.string(),
  /** New mode name (file label, path segment, or inline key depending on storage). */
  name: z.string().min(1),
  /** Existing mode to copy values from. Omit to seed from the collection's first mode. */
  fromMode: z.string().optional(),
});
export type AddModeRequest = z.infer<typeof AddModeRequestSchema>;

/** Rename a mode of a collection (relabel file-modes; rewrite path/inline modes). */
export const RenameModeRequestSchema = z.object({
  collection: z.string(),
  from: z.string().min(1),
  to: z.string().min(1),
});
export type RenameModeRequest = z.infer<typeof RenameModeRequestSchema>;

/** Remove (delete) a mode from a collection. */
export const DeleteModeRequestSchema = z.object({
  collection: z.string(),
  mode: z.string().min(1),
});
export type DeleteModeRequest = z.infer<typeof DeleteModeRequestSchema>;

/** Duplicate a mode of a collection (a copy seeded from it). */
export const DuplicateModeRequestSchema = z.object({
  collection: z.string(),
  mode: z.string().min(1),
});
export type DuplicateModeRequest = z.infer<typeof DuplicateModeRequestSchema>;

/** Add a new (empty) collection, backed by a freshly-created token file. */
export const AddCollectionRequestSchema = z.object({
  name: z.string().min(1),
});
export type AddCollectionRequest = z.infer<typeof AddCollectionRequestSchema>;

/** Rename a collection (config-level; files are left untouched). */
export const RenameCollectionRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type RenameCollectionRequest = z.infer<typeof RenameCollectionRequestSchema>;

/** Remove a collection from the config (its files are left on disk). */
export const DeleteCollectionRequestSchema = z.object({
  name: z.string().min(1),
});
export type DeleteCollectionRequest = z.infer<typeof DeleteCollectionRequestSchema>;

/** Copy a token under a target parent group (paste-a-variable-here). */
export const CopyTokenToRequestSchema = z.object({
  targetParentPath: z.array(z.string()),
});
export type CopyTokenToRequest = z.infer<typeof CopyTokenToRequestSchema>;

export const ApplyQuickFixRequestSchema = z.object({
  tokenId: z.string(),
  mode: z.string().optional(),
  action: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type ApplyQuickFixRequest = z.infer<typeof ApplyQuickFixRequestSchema>;

// ---- WebSocket events ----

export const RealtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tokens-changed'), affectedTokenIds: z.array(z.string()) }),
  z.object({ type: z.literal('file-changed'), file: z.string() }),
  z.object({ type: z.literal('project-reloaded') }),
  z.object({ type: z.literal('diagnostics-updated'), diagnostics: z.array(DiagnosticSchema) }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
