import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { UiService } from '../../core/ui.service';
import { GroupTreeComponent } from './group-tree.component';

@Component({
  selector: 'tf-sidebar',
  standalone: true,
  imports: [GroupTreeComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="relative shrink-0 bg-ink-50 border-r border-ink-200 flex flex-col h-full"
      [style.width.px]="ui.sidebarWidth()"
    >
      <!-- Collection selector -->
      <div class="p-3 border-b border-ink-200">
        <div class="flex items-center justify-between">
          <label class="text-[11px] uppercase tracking-wide text-ink-400">Collection</label>
          <button
            class="w-5 h-5 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100"
            title="Add a collection"
            (click)="startAdd()"
          >
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        @if (editing(); as mode) {
          <input
            #collInput
            class="mt-1 w-full text-sm bg-white border border-forge-500 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
            [placeholder]="mode === 'add' ? 'New collection name' : 'Collection name'"
            [ngModel]="editValue()"
            (ngModelChange)="editValue.set($event)"
            (keydown)="onEditKeydown($event)"
            (blur)="commitEdit()"
          />
        } @else {
          <select
            class="mt-1 w-full text-sm bg-white border border-ink-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-forge-500"
            [value]="current() ?? ''"
            (change)="onSelect($event)"
          >
            @for (c of collections(); track c.name) {
              <option [value]="c.name">{{ c.name }} ({{ c.tokenCount }})</option>
            }
          </select>
          @if (current()) {
            <div class="mt-1.5 flex gap-3 text-[11px]">
              <button class="text-ink-500 hover:text-forge-600 hover:underline" (click)="startRename()">
                Rename
              </button>
              <button
                class="text-ink-500 hover:text-red-600 hover:underline disabled:opacity-40 disabled:no-underline disabled:hover:text-ink-500"
                [disabled]="collections().length <= 1"
                title="Delete this collection (files are left on disk)"
                (click)="deleteCurrent()"
              >
                Delete
              </button>
            </div>
          }
        }
      </div>

      <!-- Groups -->
      <div class="flex-1 overflow-auto scrollbar-thin p-2 text-sm">
        <div
          class="px-2 py-1.5 rounded hover:bg-ink-100 cursor-pointer flex justify-between"
          [class.bg-forge-50]="noGroupFilter()"
          [class.text-forge-700]="noGroupFilter()"
          (click)="allVariables()"
        >
          <span>All variables</span><span class="text-ink-400">{{ tokenCount() }}</span>
        </div>
        <tf-group-tree [nodes]="groups()" [depth]="0" />
      </div>

      <!-- Diagnostics -->
      <div class="border-t border-ink-200 p-3 text-sm">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[11px] uppercase tracking-wide text-ink-400">Diagnostics</span>
          <button class="text-[11px] text-forge-600 hover:underline" (click)="ui.toggleDiagnostics()">
            view
          </button>
        </div>
        <button class="flex items-center gap-2 text-ink-600" (click)="ui.toggleDiagnostics()">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>{{ errorCount() }} errors
        </button>
        <button class="flex items-center gap-2 text-ink-600 mt-0.5" (click)="ui.toggleDiagnostics()">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span>{{ warningCount() }} warnings
        </button>
      </div>

      <!-- Resize handle (drag the right edge to widen / narrow the sidebar) -->
      <div
        class="absolute top-0 right-0 w-1.5 h-full cursor-col-resize -mr-0.5 z-10 flex justify-end hover:bg-forge-300/40"
        title="Drag to resize · double-click to reset"
        (pointerdown)="startResize($event)"
        (dblclick)="ui.setSidebarWidth(256)"
      >
        <div class="w-0.5 h-full transition-colors" [class.bg-forge-400]="resizing()"></div>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  private readonly store = inject(ProjectStore);
  readonly ui = inject(UiService);
  readonly collections = computed(() => this.store.state()?.collections ?? []);
  readonly current = this.store.currentCollectionName;
  readonly groups = this.store.groups;
  readonly tokenCount = computed(() => this.store.allTokens().length);
  readonly errorCount = this.store.errorCount;
  readonly warningCount = this.store.warningCount;
  readonly noGroupFilter = computed(() => this.store.groupPrefix() === null);

  readonly resizing = signal(false);

  // ---- Add / rename a collection (inline input replaces the select) ----
  // `editing` holds only the active mode (not the text) so the focus effect fires
  // once on start, not on every keystroke (which would re-select-all and block typing).
  readonly editing = signal<'add' | 'rename' | null>(null);
  readonly editValue = signal('');
  private readonly collInput = viewChild<ElementRef<HTMLInputElement>>('collInput');

  constructor() {
    effect(() => {
      if (this.editing()) queueMicrotask(() => this.collInput()?.nativeElement.select());
    });
  }

  onSelect(event: Event): void {
    const name = (event.target as HTMLSelectElement).value;
    void this.store.selectCollection(name);
  }

  startAdd(): void {
    this.editValue.set('');
    this.editing.set('add');
  }
  startRename(): void {
    const name = this.current();
    if (!name) return;
    this.editValue.set(name);
    this.editing.set('rename');
  }
  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.editing.set(null);
    }
  }
  async commitEdit(): Promise<void> {
    const mode = this.editing();
    if (!mode) return;
    this.editing.set(null);
    const name = this.editValue().trim();
    if (!name) return;
    if (mode === 'add') {
      await this.store.addCollection(name);
    } else {
      const from = this.current();
      if (from && name !== from) await this.store.renameCollection(from, name);
    }
  }

  async deleteCurrent(): Promise<void> {
    const name = this.current();
    if (!name || this.collections().length <= 1) return;
    if (!confirm(`Delete collection "${name}"?\n\nIts token files are left on disk.`)) return;
    await this.store.deleteCollection(name);
  }

  allVariables(): void {
    this.store.selectGroup(null);
  }

  /** Drag the right edge to resize the sidebar (pointer-capture based). */
  startResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startW = this.ui.sidebarWidth();
    this.resizing.set(true);
    const move = (e: PointerEvent) => this.ui.setSidebarWidth(startW + (e.clientX - startX));
    const up = () => {
      this.resizing.set(false);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
}
