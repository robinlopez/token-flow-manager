import { z } from 'zod';
import { DTCG_TYPES } from './dtcg.js';
import { DiagnosticSchema } from './diagnostics.js';

export const DtcgTypeSchema = z.enum(DTCG_TYPES);

/** Path of a token within its tree, e.g. ['color', 'brand', 'primary']. */
export const TokenPathSchema = z.array(z.string());
export type TokenPath = z.infer<typeof TokenPathSchema>;

export const TokenSourceSchema = z.object({
  file: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});
export type TokenSource = z.infer<typeof TokenSourceSchema>;

/**
 * The internal, manipulation-friendly representation of a token.
 * Pivot shape for the Figma-like table: one token = one row, one mode = one column.
 */
export const ParsedTokenSchema = z.object({
  /** Stable hash of path + collection. */
  id: z.string(),
  path: TokenPathSchema,
  collection: z.string(),
  /** Top-level group (surface, spacing, ...). */
  group: z.string(),
  /** Canonical DTCG type, an inferred type, or a generic fallback ("unknown"). */
  type: z.string(),
  /** Raw (unresolved) value per mode, e.g. { light: '#fff', dark: '{color.black}' }. */
  rawValuesByMode: z.record(z.unknown()),
  /** Fully resolved value per mode. */
  resolvedValuesByMode: z.record(z.unknown()),
  isAlias: z.boolean(),
  /** For each mode, the chain of paths an alias traverses. */
  aliasChainsByMode: z.record(z.array(TokenPathSchema)).optional(),
  description: z.string().optional(),
  deprecated: z.union([z.boolean(), z.string()]).optional(),
  extensions: z.record(z.unknown()).optional(),
  source: TokenSourceSchema,
  diagnostics: z.array(DiagnosticSchema),
});
export type ParsedToken = z.infer<typeof ParsedTokenSchema>;

export const ModeDefinitionSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
});
export type ModeDefinition = z.infer<typeof ModeDefinitionSchema>;

/** A node in the group tree (used by the sidebar). */
export interface GroupNode {
  name: string;
  path: TokenPath;
  type?: string;
  description?: string;
  children: GroupNode[];
  tokenCount: number;
}

export const GroupNodeSchema: z.ZodType<GroupNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: TokenPathSchema,
    type: z.string().optional(),
    description: z.string().optional(),
    children: z.array(GroupNodeSchema),
    tokenCount: z.number().int().nonnegative(),
  }),
);

export const CollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  files: z.array(z.string()),
  modes: z.array(ModeDefinitionSchema),
  groups: z.array(GroupNodeSchema),
  tokens: z.array(ParsedTokenSchema),
});
export type Collection = z.infer<typeof CollectionSchema>;
