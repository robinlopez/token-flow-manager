import { z } from 'zod';

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;

/** Stable codes so the UI can offer targeted quick-fixes. */
export const DiagnosticCodeSchema = z.enum([
  'json-parse-error',
  'invalid-token',
  'unknown-type',
  'missing-type',
  'broken-alias',
  'alias-cycle',
  'alias-type-mismatch',
  'alias-too-deep',
  'cross-collection-order',
  'duplicate-token',
  'incomplete-mode-override',
  'merge-conflict',
]);
export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;

export const QuickFixSchema = z.object({
  label: z.string(),
  /** Opaque payload the server knows how to apply. */
  action: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type QuickFix = z.infer<typeof QuickFixSchema>;

export const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  severity: DiagnosticSeveritySchema,
  message: z.string(),
  /** Token id this diagnostic is attached to, if any. */
  tokenId: z.string().optional(),
  /** Mode the diagnostic applies to, if mode-specific. */
  mode: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  quickFixes: z.array(QuickFixSchema).optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export function makeDiagnostic(
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  message: string,
  extra: Partial<Omit<Diagnostic, 'code' | 'severity' | 'message'>> = {},
): Diagnostic {
  return { code, severity, message, ...extra };
}
