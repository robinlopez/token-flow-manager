import { z } from 'zod';

/**
 * Starter design-system templates offered on the welcome screen, for users with
 * no token project yet (or who want a fresh source of truth to push to a repo).
 *
 * A template is a flat set of DTCG token files plus the `manifest.json` that
 * declares their organization (collections, modes, files): exactly the shape
 * the app already reads, so a scaffolded folder opens with its collections and
 * mode columns already in place.
 */

/** Logo the dashboard renders for a template (inline SVG, keyed by id). */
export const TemplateLogoSchema = z.enum(['tailwind', 'semantic-ds', 'figma', 'material']);
export type TemplateLogo = z.infer<typeof TemplateLogoSchema>;

/** Provenance badge: shipped by the design system's authors, or community-made. */
export const TemplateOriginSchema = z.enum(['official', 'community']);
export type TemplateOrigin = z.infer<typeof TemplateOriginSchema>;

/** One collection a template will create, as it will appear in the sidebar. */
export const TemplateCollectionSchema = z.object({
  name: z.string(),
  /** Mode names, left to right (the first one is the collection's default). */
  modes: z.array(z.string()),
  /** Logical variables (mode segments folded away), as the table will show them. */
  tokenCount: z.number().int().nonnegative(),
});
export type TemplateCollection = z.infer<typeof TemplateCollectionSchema>;

export const TokenTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One-line pitch shown under the title on the card. */
  tagline: z.string(),
  /** Longer explanation shown in the scaffold dialog. */
  description: z.string(),
  origin: TemplateOriginSchema,
  logo: TemplateLogoSchema,
  /** Brand colour (hex) used for the card's accent and selected state. */
  accent: z.string(),
  /** Reference link (design system home / Figma Community file). */
  url: z.string().optional(),
  /** Folder name pre-filled in the scaffold dialog. */
  suggestedFolder: z.string(),
  collections: z.array(TemplateCollectionSchema),
  tokenCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  /** Total uncompressed size of the files written on disk. */
  bytes: z.number().int().nonnegative(),
  /** Whether the template ships Figma text/effect styles (`styles.tokens.json`). */
  hasStyles: z.boolean(),
});
export type TokenTemplate = z.infer<typeof TokenTemplateSchema>;

export const TemplatesResponseSchema = z.object({
  templates: z.array(TokenTemplateSchema),
});
export type TemplatesResponse = z.infer<typeof TemplatesResponseSchema>;

/**
 * A folder name: one path segment, created under a directory the user picked.
 *
 * Separators are rejected so the name cannot redirect the write elsewhere, and a
 * leading dot is rejected so `.` and `..` (and hidden folders) are out. Control
 * characters are rejected rather than handed to the filesystem: NUL makes Node
 * throw, and the rest only produce names nobody can see or delete.
 */
const FolderNameSchema = z
  .string()
  .max(120)
  .refine((s) => !/[/\\]/.test(s), { message: 'Folder name cannot contain a path separator' })
  .refine((s) => !s.startsWith('.'), { message: 'Folder name cannot start with a dot' })
  // Escaped ranges, never literal control bytes in the source.
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), {
    message: 'Folder name cannot contain control characters',
  })
  .refine((s) => s.trim() === s && s.length > 0, { message: 'Folder name cannot be blank or padded' });

export const ScaffoldTemplateRequestSchema = z.object({
  templateId: z.string().min(1),
  /** Existing directory the user picked. */
  parent: z.string().min(1),
  /** New folder created under `parent`; omit to write straight into `parent`. */
  folder: FolderNameSchema.optional(),
  /** Overwrite same-named files instead of reporting a conflict. */
  overwrite: z.boolean().default(false),
});
export type ScaffoldTemplateRequest = z.infer<typeof ScaffoldTemplateRequestSchema>;

export const ScaffoldTemplateResultSchema = z.object({
  ok: z.boolean(),
  /** Absolute path of the scaffolded project (the folder to open). */
  path: z.string(),
  /** File names written, relative to `path`. */
  files: z.array(z.string()),
  /** Files that already existed, set when `ok` is false and nothing was written. */
  conflicts: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type ScaffoldTemplateResult = z.infer<typeof ScaffoldTemplateResultSchema>;

/**
 * Why the OS folder dialog is being opened, so it can label itself.
 *
 * A closed set, not free text: the label is interpolated into an AppleScript /
 * PowerShell snippet on the server, and no request body should ever reach a
 * script interpreter. The server owns the wording.
 */
export const PickFolderPurposeSchema = z.enum(['open', 'scaffold']);
export type PickFolderPurpose = z.infer<typeof PickFolderPurposeSchema>;

export const PickFolderRequestSchema = z.object({
  purpose: PickFolderPurposeSchema.default('open'),
});
export type PickFolderRequest = z.infer<typeof PickFolderRequestSchema>;
