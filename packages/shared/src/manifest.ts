import { z } from 'zod';

/**
 * Organization manifest (`manifest.json`) — the **source of truth for token
 * organization** (collections, modes, and which files feed each mode), designed
 * to be ISO with the Figma plugin that consumes it. Tool *preferences* stay in
 * `tokenflow.config.json`; this file carries only structure.
 *
 * Shape (a collection → its modes → the file(s) each mode reads):
 * ```json
 * {
 *   "name": "Design Tokens",
 *   "collections": {
 *     "Semantics": { "modes": { "Light": ["semantics.json"], "Dark": ["semantics.json"] } },
 *     "Metrics":   { "modes": { "Mode 1": ["metrics.json"] } }
 *   }
 * }
 * ```
 * The same file may appear under several modes (modes encoded inside the file's
 * paths); distinct files per mode = one file per mode; a single mode = a plain
 * single-mode collection.
 */

export const OrgManifestCollectionSchema = z.object({
  /** Mode name → the token file(s) that feed it. Object key order is significant. */
  modes: z.record(z.array(z.string())),
});
export type OrgManifestCollection = z.infer<typeof OrgManifestCollectionSchema>;

export const OrgManifestSchema = z.object({
  name: z.string().default('Design Tokens'),
  /** Collection name → its modes. Object key order = resolution order. */
  collections: z.record(OrgManifestCollectionSchema),
});
export type OrgManifest = z.infer<typeof OrgManifestSchema>;
