/**
 * Collection-namespace aliases (Tokens Studio / PrimeNG convention).
 *
 * A reference like `{primitives.red.100}` names the COLLECTION as its first
 * segment, not a path segment: the token lives at `red.100` inside the
 * `primitives` collection. Both the resolver and the writer need the same idea
 * of which prefixes may stand for a given collection, so the rule lives here.
 */

/**
 * Canonical form of a namespace literal, used as the map key on BOTH sides of
 * the lookup: lowercased with word separators dropped.
 *
 * A collection carries a human name ("Color Primitives", "Font theme") while the
 * alias that references it uses the identifier form the exporter produced
 * (`{colorPrimitives.gray.900}`, `{fontTheme.static.weight.bold}`). Folding
 * spaces, `_` and `-` away lets the two meet. `/` is left alone: it separates
 * the name segments {@link collectionNamespaceVariants} already splits on.
 */
export function normalizeCollectionNamespace(literal: string): string {
  return literal.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Prefixes (normalized, see {@link normalizeCollectionNamespace}) that may
 * namespace `name` in an alias: the full collection name, each `/`-separated
 * segment (so an auto-detected name like `primitives/themeOne` also answers to
 * `primitives`), and a singular/plural variant of each.
 */
export function collectionNamespaceVariants(name: string): string[] {
  const n = name.toLowerCase();
  const out: string[] = [];
  // Every variant is normalized, because every lookup key is: an unfolded form
  // like "color primitives" could never be hit (an alias segment carrying a
  // space normalizes before the lookup), so emitting it would only add a dead
  // entry to the map.
  for (const base of new Set<string>([n, ...n.split('/')].map(normalizeCollectionNamespace))) {
    if (!base) continue;
    const variant = base.endsWith('s') ? base.slice(0, -1) : `${base}s`;
    for (const v of [base, variant]) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
