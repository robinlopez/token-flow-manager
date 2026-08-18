import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { ExtensionsEditorComponent } from '../../ui/extensions-editor.component';
import type { MetadataChange } from '../../core/models';

@Component({
  selector: 'tf-bulk-inspector',
  standalone: true,
  imports: [FormsModule, ExtensionsEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active()) {
      <aside class="w-[380px] shrink-0 bg-white border-l border-ink-200 flex flex-col h-full animate-in">
        <div class="px-4 py-3 border-b border-ink-200 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[11px] text-ink-400 font-mono truncate">Multi-edit</div>
            <div class="text-sm font-semibold text-ink-900 truncate">
              {{ tokens().length }} variables selected
            </div>
          </div>
          <button
            class="w-7 h-7 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100 text-lg leading-none"
            title="Close"
            (click)="close()"
          >×</button>
        </div>

        <div class="flex-1 overflow-auto scrollbar-thin text-sm divide-y divide-ink-200">
          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Selection</div>
            <div class="max-h-28 overflow-auto scrollbar-thin rounded border border-ink-200 divide-y divide-ink-100">
              @for (t of tokens(); track t.id) {
                <div class="px-2 py-1 font-mono text-[11px] text-ink-600 truncate" [title]="t.path.join('.')">
                  {{ t.path.join('.') }}
                </div>
              }
            </div>
          </section>

          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Description</div>
            <textarea
              rows="2"
              class="w-full resize-y min-h-[2.25rem] text-ink-700 border border-ink-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500 placeholder:text-ink-300"
              [placeholder]="mixed() ? 'Multiple values' : 'Add a description…'"
              [ngModel]="descDraft()"
              (ngModelChange)="onDescInput($event)"
            ></textarea>
            <div class="mt-1.5 flex items-center justify-between gap-2">
              <span class="text-[11px] text-ink-400 truncate">
                @if (touched()) {
                  {{ changeCount() }} of {{ tokens().length }} will change
                } @else if (mixed()) {
                  Descriptions differ across the selection
                } @else {
                  Same description on every selected variable
                }
              </span>
              <button
                type="button"
                class="shrink-0 text-xs px-2 py-1 rounded bg-forge-500 text-white hover:bg-forge-600 disabled:opacity-40 disabled:hover:bg-forge-500"
                [disabled]="!touched() || changeCount() === 0"
                (click)="applyDescription()"
              >
                Apply to {{ changeCount() }}
              </button>
            </div>
          </section>

          <section class="p-4">
            <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Extensions</div>
            <tf-extensions-editor [tokens]="tokens()" />
          </section>
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
export class BulkInspectorComponent {
  private readonly store = inject(ProjectStore);
  readonly active = this.store.bulkEditActive;
  readonly tokens = this.store.selectedTokens;

  readonly descDraft = signal('');
  readonly touched = signal(false);

  private readonly selectionKey = computed(() => this.tokens().map((t) => t.id).join('|'));

  readonly mixed = computed(() => {
    const values = new Set(this.tokens().map((t) => t.description ?? ''));
    return values.size > 1;
  });

  private readonly commonDescription = computed(() => {
    const values = new Set(this.tokens().map((t) => t.description ?? ''));
    return values.size === 1 ? [...values][0]! : '';
  });

  readonly changeCount = computed(() => {
    const next = this.descDraft().trim();
    return this.tokens().filter((t) => (t.description ?? '') !== next).length;
  });

  constructor() {
    effect(() => {
      this.selectionKey();
      untracked(() => {
        this.descDraft.set(this.commonDescription());
        this.touched.set(false);
      });
    });
  }

  onDescInput(value: string): void {
    this.descDraft.set(value);
    this.touched.set(true);
  }

  close(): void {
    this.store.closeBulkEdit();
  }

  async applyDescription(): Promise<void> {
    const description = this.descDraft().trim();
    const changes: MetadataChange[] = this.tokens()
      .filter((t) => (t.description ?? '') !== description)
      .map((t) => ({ id: t.id, description }));
    if (changes.length === 0) return;
    const label = description
      ? `Described ${changes.length} variable${changes.length > 1 ? 's' : ''}`
      : `Cleared ${changes.length} description${changes.length > 1 ? 's' : ''}`;
    const ok = await this.store.updateMetadataBatch(changes, label);
    if (ok) this.touched.set(false);
  }
}
