import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { aliasLabel, cssColor, effectiveType, formatValue, isAliasValue, typeGlyph } from '../core/format';

/** Numeric kinds whose resolved value is worth showing beside an alias chip. */
const NUMERIC = new Set(['number', 'dimension', 'duration']);

/**
 * Renders one mode-cell of a token: an alias chip, a color swatch + value, or a
 * plain literal — matching the Figma-variables look. For a colour alias the chip
 * leads with the resolved colour bullet (no hex text); numeric aliases show the
 * resolved value beside the chip; other aliases show just the chip.
 */
@Component({
  selector: 'tf-value-cell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center min-w-0 leading-none' },
  template: `
    @if (rawIsAlias()) {
      <span class="inline-flex items-center gap-1.5 max-w-full" [title]="resolvedText()">
        <span
          class="inline-flex items-center gap-1.5 min-w-0 rounded-md bg-ink-100 border border-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-700"
        >
          <!-- Figma-style leading bullet: the resolved colour for colour aliases,
               otherwise the type glyph. -->
          @if (swatch()) {
            <span class="w-3.5 h-3.5 rounded-[4px] border border-black/10 shrink-0 checker cursor-pointer">
              <span class="block w-full h-full rounded-[4px]" [style.background]="swatch()"></span>
            </span>
          } @else {
            <span class="text-ink-400">{{ glyph() }}</span>
          }
          <span class="truncate">{{ aliasText() }}</span>
        </span>
        <!-- Resolved value only for numeric types (colours read from the bullet). -->
        @if (showResolved()) {
          <span class="text-xs font-mono text-ink-400 shrink-0">{{ resolvedText() }}</span>
        }
      </span>
    } @else if (swatch()) {
      <span class="inline-flex items-center gap-2">
        <span class="w-4 h-4 rounded-[4px] border border-black/10 checker cursor-pointer shrink-0" title="Open the colour picker">
          <span class="block w-full h-full rounded-[4px]" [style.background]="swatch()"></span>
        </span>
        <span class="font-mono text-xs text-ink-700">{{ resolvedText() }}</span>
      </span>
    } @else {
      <span class="font-mono text-xs text-ink-700">{{ literalText() }}</span>
    }
  `,
})
export class ValueCellComponent {
  readonly raw = input<unknown>();
  readonly resolved = input<unknown>();
  readonly type = input.required<string>();

  /** Effective type: declared, or inferred from the (resolved) value if unknown. */
  private readonly effType = computed(() => effectiveType(this.type(), this.resolved(), this.raw()));
  readonly rawIsAlias = computed(() => isAliasValue(this.raw()));
  readonly aliasText = computed(() => (this.rawIsAlias() ? aliasLabel(this.raw() as string) : ''));
  readonly resolvedText = computed(() => formatValue(this.resolved(), this.type()));
  /**
   * Text for a non-alias literal cell. Composite values (objects) render their
   * RAW shape so alias sub-properties read as `{group.token}` rather than their
   * resolved value (matching the on-disk JSON); scalars use the resolved value.
   */
  readonly literalText = computed(() => {
    const raw = this.raw();
    if (raw !== null && typeof raw === 'object') return formatValue(raw, this.type());
    return this.resolvedText();
  });
  readonly swatch = computed(() => (this.effType() === 'color' ? cssColor(this.resolved()) : null));
  /** Show the resolved value text beside an alias chip only for numeric types. */
  readonly showResolved = computed(() => NUMERIC.has(this.effType()));
  readonly glyph = computed(() => typeGlyph(this.type()));
}
