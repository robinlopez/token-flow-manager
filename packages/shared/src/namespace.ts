/**
 * Collection-namespace aliases (Tokens Studio / PrimeNG convention).
 *
 * A reference like `{primitives.red.100}` names the COLLECTION as its first
 * segment, not a path segment: the token lives at `red.100` inside the
 * `primitives` collection. Both the resolver and the writer need the same idea
 * of which prefixes may stand for a given collection, so the rule lives here.
 */

/**
 * Prefixes (lowercased) that may namespace `name` in an alias: the full
 * collection name, each `/`-separated segment (so an auto-detected name like
 * `primitives/themeOne` also answers to `primitives`), and a singular/plural
 * variant of each.
 */
export function collectionNamespaceVariants(name: string): string[] {
  const n = name.toLowerCase();
  const out: string[] = [];
  for (const base of new Set<string>([n, ...n.split('/')])) {
    if (!base) continue;
    const variant = base.endsWith('s') ? base.slice(0, -1) : `${base}s`;
    for (const v of [base, variant]) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
