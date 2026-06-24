import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { CellPickerService } from '../../core/cell-picker.service';
import { ContextMenuService } from '../../core/context-menu.service';
import { effectiveType, formatValue, isAliasValue, aliasLabel, typeGlyph } from '../../core/format';
import { ValueCellComponent } from '../../ui/value-cell.component';
import type { ParsedToken, ReferenceInfo } from '../../core/models';

@Component({
  selector: 'tf-inspector',
  standalone: true,
  imports: [FormsModule, ValueCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (token(); as t) {
      <aside class="w-[380px] shrink-0 bg-white border-l border-ink-200 flex flex-col h-full animate-in">
        <!-- Header -->
        <div class="px-4 py-3 border-b border-ink-200 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[11px] text-ink-400 font-mono truncate">{{ breadcrumb(t) }}</div>
            <div class="text-sm font-semibold text-ink-900 truncate">{{ leaf(t) }}</div>
            <span
              class="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              [class]="badgeClass(t.type)"
            >
              <span class="opacity-70">{{ glyph(t.type) }}</span>
              {{ t.type }}
            </span>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-lg leading-none"
              title="Variable actions"
              (click)="openActions(t, $event)"
            >⋯</button>
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-lg leading-none"
              title="Close"
              (click)="close()"
            >×</button>
          </div>
        </div>

        <div class="flex-1 overflow-auto scrollbar-thin p-4 space-y-5 text-sm">
          <!-- Description (editable, auto-saves on blur) -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Description</div>
            <textarea
              rows="2"
              class="w-full resize-y min-h-[2.25rem] text-ink-700 border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500 placeholder:text-ink-300"
              placeholder="Add a description…"
              [ngModel]="descDraft()"
              (ngModelChange)="descDraft.set($event)"
              (blur)="saveDescription(t)"
            ></textarea>
          </section>

          <!-- Values per mode -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Values</div>
            @for (mode of modes(); track mode.id) {
              <div class="mb-3">
                <div class="text-xs text-ink-500 mb-1">{{ mode.label || mode.id }}</div>
                @if (editingMode() === mode.id) {
                  <input
                    class="w-full min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
                    list="tf-alias-paths"
                    autofocus
                    [ngModel]="draft(t, mode.id)"
                    (ngModelChange)="setDraft(mode.id, $event)"
                    (keyup.enter)="save(t, mode.id)"
                    (keyup.escape)="cancelEdit()"
                    (blur)="save(t, mode.id)"
                  />
                } @else {
                  <button
                    type="button"
                    class="w-full flex items-center text-left border border-ink-200 rounded px-2 py-1.5 hover:border-forge-400 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-forge-500"
                    title="Click to pick a value · double-click to type"
                    (click)="openPicker(t, mode.id, $event)"
                    (dblclick)="startEdit(mode.id)"
                  >
                    <tf-value-cell
                      class="flex-1 min-w-0"
                      [raw]="t.rawValuesByMode[mode.id]"
                      [resolved]="t.resolvedValuesByMode[mode.id]"
                      [type]="t.type"
                    />
                  </button>
                }
                @if (chain(t, mode.id); as ch) {
                  <div class="mt-1 text-[11px] text-ink-400 font-mono">
                    → {{ ch }} = {{ resolvedText(t, mode.id) }}
                  </div>
                }
              </div>
            }
            <datalist id="tf-alias-paths">
              @for (p of aliasOptions(); track p) {
                <option [value]="p"></option>
              }
            </datalist>
          </section>

          <!-- References -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
              Used in {{ references().length }} token{{ references().length === 1 ? '' : 's' }}
            </div>
            @for (ref of references(); track ref.id) {
              <button
                class="block w-full text-left font-mono text-xs text-forge-600 hover:underline py-0.5"
                (click)="goto(ref)"
              >
                {{ ref.path.join('.') }}
              </button>
            }
          </section>

          <!-- Rename (auto-commits on blur / Enter) -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Rename</div>
            <input
              class="w-full min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
              [ngModel]="renameDraft()"
              (ngModelChange)="onRenameInput(t, $event)"
              (keyup.enter)="commitRename(t)"
              (blur)="commitRename(t)"
              placeholder="new.path.name"
            />
            @if (renamePreview(); as p) {
              <div class="mt-1 text-[11px]" [class.text-red-500]="p.conflict" [class.text-ink-400]="!p.conflict">
                @if (p.conflict) { Path already exists. } @else {
                  {{ p.references }} reference(s) in {{ p.files }} file(s) will be updated.
                }
              </div>
            }
          </section>

          <!-- Source -->
          <section>
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Source</div>
            <div class="font-mono text-xs text-ink-600">{{ t.source.file }}:{{ t.source.line + 1 }}</div>
          </section>

          <!-- Diagnostics -->
          @if (t.diagnostics.length) {
            <section>
              <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Diagnostics</div>
              @for (d of t.diagnostics; track d.message) {
                <div
                  class="text-xs px-2 py-1 rounded mb-1"
                  [class.bg-red-50]="d.severity === 'error'"
                  [class.text-red-700]="d.severity === 'error'"
                  [class.bg-amber-50]="d.severity === 'warning'"
                  [class.text-amber-700]="d.severity === 'warning'"
                >
                  {{ d.message }}
                  @for (fix of d.quickFixes ?? []; track fix.action) {
                    <button
                      class="ml-2 underline"
                      (click)="applyFix(t, d.mode, fix.action, fix.data)"
                    >
                      {{ fix.label }}
                    </button>
                  }
                </div>
              }
            </section>
          }
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .animate-in {
        animation: slidein 0.15s ease-out;
      }
      @keyframes slidein {
        from {
          transform: translateX(12px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `,
  ],
})
export class InspectorComponent {
  private readonly store = inject(ProjectStore);
  private readonly picker = inject(CellPickerService);
  private readonly ctxMenu = inject(ContextMenuService);
  readonly token = this.store.inspectedToken;
  readonly modes = this.store.modes;

  readonly references = signal<ReferenceInfo[]>([]);
  readonly renameDraft = signal('');
  readonly renamePreview = signal<{ files: number; references: number; conflict: boolean } | null>(null);
  readonly descDraft = signal('');
  /** Mode whose raw value is currently being typed inline (double-click). */
  readonly editingMode = signal<string | null>(null);
  readonly aliasOptions = computed(() => this.store.collectionPaths().map((p) => `{${p}}`));

  private drafts = new Map<string, string>();

  constructor() {
    // When the selected token changes, reset edit state + fetch references.
    effect(() => {
      const t = this.token();
      this.drafts.clear();
      this.renamePreview.set(null);
      this.editingMode.set(null);
      if (t) {
        this.renameDraft.set(t.path.join('.'));
        this.descDraft.set(t.description ?? '');
        void this.store.references(t.id).then((refs) => this.references.set(refs));
      } else {
        this.descDraft.set('');
        this.references.set([]);
      }
    });
  }

  close(): void {
    this.store.selectToken(null);
  }

  /** The same action menu as the table row's `⋯`, anchored to the inspector header. */
  openActions(t: ParsedToken, event: MouseEvent): void {
    this.ctxMenu.open(event, [
      { label: 'Rename', action: () => this.focusRename() },
      { label: 'Duplicate', action: () => void this.store.duplicateToken(t.id) },
      { label: 'Copy variable', action: () => this.store.copyVariables([t.id]) },
      { label: 'Cut variable', action: () => this.store.cutVariables([t.id]) },
      {
        label: 'Paste here',
        disabled: !this.store.hasCopiedVariables(),
        action: () => void this.store.pasteVariables(t.path.slice(0, -1)),
      },
      { label: 'Delete', danger: true, action: () => void this.deleteAndClose(t.id) },
    ]);
  }

  /** Move focus to the inspector's Rename field (the panel already shows it). */
  private focusRename(): void {
    queueMicrotask(() => {
      const el = document.querySelector<HTMLInputElement>('tf-inspector input[placeholder="new.path.name"]');
      el?.focus();
      el?.select();
    });
  }

  private async deleteAndClose(id: string): Promise<void> {
    const ok = await this.store.deleteToken(id);
    if (ok) this.store.selectToken(null);
  }

  leaf(t: ParsedToken): string {
    return t.path[t.path.length - 1] ?? '';
  }
  breadcrumb(t: ParsedToken): string {
    return t.path.slice(0, -1).join(' › ') || t.collection;
  }
  glyph(type: string): string {
    return typeGlyph(type);
  }
  /** Tailwind classes for the type badge, grouped by type family. */
  badgeClass(type: string): string {
    switch (type) {
      case 'color':
        return 'bg-violet-50 text-violet-700';
      case 'dimension':
      case 'number':
      case 'duration':
        return 'bg-sky-50 text-sky-700';
      case 'fontFamily':
      case 'fontWeight':
      case 'typography':
        return 'bg-amber-50 text-amber-700';
      case 'shadow':
      case 'border':
      case 'gradient':
        return 'bg-emerald-50 text-emerald-700';
      default:
        return 'bg-ink-100 text-ink-600';
    }
  }
  resolvedText(t: ParsedToken, mode: string): string {
    return formatValue(t.resolvedValuesByMode[mode], t.type);
  }
  chain(t: ParsedToken, mode: string): string | null {
    const raw = t.rawValuesByMode[mode];
    if (!isAliasValue(raw)) return null;
    const ch = t.aliasChainsByMode?.[mode];
    if (ch && ch.length) return ch.map((p) => p.join('.')).join(' → ');
    return aliasLabel(raw);
  }

  // ---- Value editing: single click → picker, double click → type raw ----

  /** Open the Figma-style picker anchored to the clicked value cell. */
  openPicker(t: ParsedToken, mode: string, event: Event): void {
    const cell = event.currentTarget as HTMLElement;
    const r = cell.getBoundingClientRect();
    const raw = t.rawValuesByMode[mode];
    // Colour literals seed the colour picker; everything else opens Libraries.
    const tab =
      !isAliasValue(raw) && effectiveType(t.type, t.resolvedValuesByMode[mode], raw) === 'color'
        ? 'custom'
        : 'libraries';
    this.picker.open({
      tokenId: t.id,
      mode,
      type: t.type,
      raw,
      resolved: t.resolvedValuesByMode[mode],
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
    });
  }

  startEdit(mode: string): void {
    this.picker.close();
    this.editingMode.set(mode);
  }
  cancelEdit(): void {
    this.editingMode.set(null);
  }

  draft(t: ParsedToken, mode: string): string {
    const key = this.key(t, mode);
    if (this.drafts.has(key)) return this.drafts.get(key)!;
    return formatValue(t.rawValuesByMode[mode], t.type);
  }
  setDraft(mode: string, value: string): void {
    const t = this.token();
    if (t) this.drafts.set(this.key(t, mode), value);
  }
  async save(t: ParsedToken, mode: string): Promise<void> {
    if (this.editingMode() !== mode) return; // ignore stray blur after cancel
    const key = this.key(t, mode);
    this.editingMode.set(null);
    if (!this.drafts.has(key)) return;
    const value = this.drafts.get(key)!;
    if (value === formatValue(t.rawValuesByMode[mode], t.type)) {
      this.drafts.delete(key);
      return;
    }
    const ok = await this.store.updateValue(t.id, mode, coerce(value, t.type === 'number'));
    if (ok) this.drafts.delete(key);
  }

  async saveDescription(t: ParsedToken): Promise<void> {
    const next = this.descDraft();
    if (next.trim() === (t.description ?? '').trim()) return;
    await this.store.updateDescription(t.id, next);
  }

  goto(ref: ReferenceInfo): void {
    void this.store.revealToken(ref.id, ref.collection);
  }

  onRenameInput(t: ParsedToken, value: string): void {
    this.renameDraft.set(value);
    const path = value.split('.').filter(Boolean);
    if (path.length === 0 || value === t.path.join('.')) {
      this.renamePreview.set(null);
      return;
    }
    void this.store.renamePreview(t.id, value).then((p) => this.renamePreview.set(p));
  }
  async commitRename(t: ParsedToken): Promise<void> {
    const v = this.renameDraft();
    const path = v.split('.').filter(Boolean);
    if (path.length === 0 || v === t.path.join('.') || this.renamePreview()?.conflict) return;
    await this.store.rename(t.id, path, true);
  }

  async applyFix(
    t: ParsedToken,
    mode: string | undefined,
    action: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.applyQuickFix(t.id, action, mode, data);
  }

  private key(t: ParsedToken, mode: string): string {
    return `${t.id}:${mode}`;
  }
}

function coerce(value: string, asNumber: boolean): unknown {
  if (asNumber) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}
