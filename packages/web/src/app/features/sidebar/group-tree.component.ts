import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../../stores/project.store';
import { GroupDndService } from './group-dnd.service';
import { ContextMenuService } from '../../core/context-menu.service';
import type { GroupNode } from '../../core/models';

/**
 * Recursive, collapsible group tree for the sidebar with custom pointer-based
 * drag-and-drop (Finder-style): drop a group onto another to nest it, or between
 * two groups to reorder. The gesture is owned by {@link GroupDndService}; this
 * component only renders the rows, the insertion line, the nest highlight and the
 * cursor badge from the service's reactive state.
 */
@Component({
  selector: 'tf-group-tree',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Cursor badge, rendered once (root level) and following the pointer. -->
    @if (depth() === 0 && dnd.isDragging()) {
      <div
        class="fixed z-50 pointer-events-none px-2.5 py-1 bg-ink-900 text-white text-xs rounded-md shadow-xl font-medium"
        [style.left.px]="dnd.previewX() + 12"
        [style.top.px]="dnd.previewY() + 8"
      >
        {{ dnd.dragBadge() }}
      </div>
    }

    <div>
      @for (node of nodes(); track node.path.join('.')) {
        <!-- The row is a nest target AND a drag source. The service resolves, from
             the pointer's vertical band, whether a drag would drop INTO this folder
             (middle → highlighted) or reorder around it (edges → insertion line). -->
        <div
          [attr.data-tf-folder]="node.path.join('/')"
          class="relative flex items-center gap-1 px-2 py-1.5 rounded text-ink-700 group transition-colors select-none"
          [class.bg-ink-50]="!isInto(node) && !isHighlighted(node) && !isSelected(node)"
          [class.hover:bg-ink-100]="!isInto(node) && !isHighlighted(node) && !isSelected(node)"
          [class.bg-forge-100]="isInto(node) || isSelected(node)"
          [class.bg-forge-50]="isHighlighted(node) && !isSelected(node) && !isInto(node)"
          [class.text-forge-700]="isHighlighted(node)"
          [class.font-medium]="isHighlighted(node)"
          [class.ring-2]="isInto(node)"
          [class.ring-forge-400]="isInto(node)"
          [class.ring-inset]="isInto(node)"
          [class.opacity-40]="isDragging(node)"
          [style.padding-left.px]="8 + depth() * 12"
          (pointerdown)="onRowDown($event, node)"
          (click)="onRowClick(node, $event)"
          (dblclick)="startRename(node); $event.stopPropagation()"
          (contextmenu)="onContextMenu(node, $event)"
          title="Click to filter · double-click to rename · drag onto a group to nest, between groups to reorder · ⌘/Ctrl-click to multi-select"
        >
          <!-- Precise reorder insertion line, attached above/below this row when the
               pointer resolves to "reorder around" it. Absolute → never reflows. -->
          @if (showLineBefore(node)) {
            <div
              class="absolute right-2 -top-px h-0.5 bg-forge-500 rounded-full pointer-events-none"
              [style.left.px]="8 + depth() * 12"
            ></div>
          }
          @if (showLineAfter(node)) {
            <div
              class="absolute right-2 -bottom-px h-0.5 bg-forge-500 rounded-full pointer-events-none"
              [style.left.px]="8 + depth() * 12"
            ></div>
          }
          <!-- active-path indicator: shows which level you're focused on -->
          @if (isOnHighlightedPath(node)) {
            <span
              class="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
              [class.bg-forge-500]="isHighlighted(node)"
              [class.bg-forge-200]="!isHighlighted(node)"
            ></span>
          }
          @if (node.children.length) {
            <button
              class="w-4 h-4 flex items-center justify-center text-ink-500 hover:text-ink-800 shrink-0"
              [attr.aria-expanded]="expanded(node)"
              (click)="toggle(node, $event)"
            >
              <svg
                class="w-3 h-3 transition-transform duration-150"
                [class.rotate-90]="expanded(node)"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M4.5 2.5 L8 6 L4.5 9.5"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          } @else {
            <span class="w-4 shrink-0"></span>
          }
          @if (isRenaming(node)) {
            <input
              #renameInput
              class="flex-1 min-w-0 text-sm bg-white border border-forge-500 rounded px-1 py-0 focus:outline-none"
              [ngModel]="renameText()"
              (ngModelChange)="renameText.set($event)"
              (keydown)="onRenameKeydown($event, node)"
              (blur)="commitRename(node)"
              (click)="$event.stopPropagation()"
              (pointerdown)="$event.stopPropagation()"
            />
          } @else {
            <span class="truncate flex-1">{{ node.name }}</span>
            @if (isSelected(node)) {
              <span class="w-1.5 h-1.5 rounded-full bg-forge-500 shrink-0"></span>
            }
            <span class="text-ink-400 text-xs">{{ node.tokenCount }}</span>
            <span
              class="w-3.5 text-ink-300 opacity-0 group-hover:opacity-100 shrink-0 text-center select-none cursor-grab active:cursor-grabbing"
              >⠿</span
            >
          }
        </div>
        @if (node.children.length && expanded(node)) {
          <tf-group-tree [nodes]="node.children" [depth]="depth() + 1" [parentPath]="node.path" />
        }
      }
    </div>
  `,
})
export class GroupTreeComponent {
  private readonly store = inject(ProjectStore);
  readonly dnd = inject(GroupDndService);
  private readonly ctxMenu = inject(ContextMenuService);
  readonly nodes = input.required<GroupNode[]>();
  readonly depth = input(0);
  /** Path of the parent group whose children these nodes are ([] = root). */
  readonly parentPath = input<string[]>([]);

  /** Whether a drag would currently nest INTO this folder (drives the highlight). */
  isInto(node: GroupNode): boolean {
    return this.dnd.intoKey() === node.path.join('/');
  }

  /** Show the insertion line above this row (drop before it). */
  showLineBefore(node: GroupNode): boolean {
    return this.reorderHere(node) && !this.dnd.reorderAfter();
  }
  /** Show the insertion line below this row (drop after it). */
  showLineAfter(node: GroupNode): boolean {
    return this.reorderHere(node) && this.dnd.reorderAfter();
  }
  private reorderHere(node: GroupNode): boolean {
    return !this.dnd.intoActive() && this.dnd.reorderKey() === node.path.join('/');
  }

  /** True while this row is part of the active drag (dimmed). */
  isDragging(node: GroupNode): boolean {
    return this.dnd.isDraggingKey(node.path.join('/'));
  }

  private readonly activePath = computed(() => this.store.groupPrefix()?.join('.') ?? null);

  // ---- Inline rename (double-click) ----
  readonly renamingKey = signal<string | null>(null);
  readonly renameText = signal('');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    effect(() => {
      if (this.renamingKey()) queueMicrotask(() => this.renameInput()?.nativeElement.select());
    });
  }

  expanded(node: GroupNode): boolean {
    return this.store.isGroupExpanded(node.path.join('.'));
  }

  toggle(node: GroupNode, event: Event): void {
    event.stopPropagation();
    this.store.toggleGroupExpanded(node.path.join('.'));
  }

  /** The group used as the table filter (click-to-filter target). */
  isActive(node: GroupNode): boolean {
    return this.activePath() === node.path.join('.');
  }

  /** True when `node` is the direct parent group of a focused/selected variable. */
  hasFocusedVariable(node: GroupNode): boolean {
    return this.store.selectedTokenGroupKeys().has(node.path.join('.'));
  }

  /** Highlighted = the filter target OR a group holding a focused variable.
   * Drives the active row styling + the accent of the left bar. */
  isHighlighted(node: GroupNode): boolean {
    return this.isActive(node) || this.hasFocusedVariable(node);
  }

  /** True if `node` is a highlighted group OR one of its ancestors (shows the
   * left accent bar down the whole path to the active/focused group). */
  isOnHighlightedPath(node: GroupNode): boolean {
    const key = node.path.join('.');
    const active = this.activePath();
    if (active && (active === key || active.startsWith(key + '.'))) return true;
    for (const g of this.store.selectedTokenGroupKeys()) {
      if (g === key || g.startsWith(key + '.')) return true;
    }
    return false;
  }

  isSelected(node: GroupNode): boolean {
    return this.store.selectedGroupKeys().has(node.path.join('.'));
  }

  private dragBadge(node: GroupNode): string {
    const sel = this.store.selectedGroupKeys();
    return sel.has(node.path.join('.')) && sel.size > 1 ? `${sel.size} groups` : node.name;
  }

  // ---- Drag (custom, pointer-based) ----
  /**
   * Arm a drag from a row press. Ignored on the chevron / rename input (they have
   * their own handlers). The drag only starts once the pointer passes the
   * threshold, so a plain click still selects/filters.
   */
  onRowDown(event: PointerEvent, node: GroupNode): void {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input')) return;
    // Modifier clicks build the multi-selection (handled by the click handler) —
    // never arm a drag or clear the selection on them, or the selection being
    // assembled would be wiped on every cmd/ctrl/shift-click.
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;

    const sel = this.store.selectedGroupKeys();
    const grabbedKey = node.path.join('.');
    let paths: string[][];
    if (sel.has(grabbedKey) && sel.size > 1) {
      // Grabbed row is part of the multi-selection → drag the whole block.
      paths = [node.path, ...[...sel].filter((k) => k !== grabbedKey).map((k) => k.split('.'))];
    } else {
      // Plain press on an unselected row → reset selection and drag it alone.
      this.store.clearGroupSelection();
      paths = [node.path];
    }
    this.dnd.beginPotentialDrag(event, paths, this.dragBadge(node));
  }

  /**
   * Plain click filters the table by this group; cmd/ctrl-click toggles a group
   * in the multi-selection; shift-click selects the contiguous range (within this
   * level) from the anchor to the clicked row. Suppressed right after a drag.
   */
  onRowClick(node: GroupNode, event: MouseEvent): void {
    if (this.dnd.consumeClickSuppression()) return;
    if (event.metaKey || event.ctrlKey) {
      event.stopPropagation();
      this.store.toggleGroupSelection(node.path);
      return;
    }
    if (event.shiftKey && this.selectRange(node)) {
      event.stopPropagation();
      return;
    }
    this.store.clearGroupSelection();
    this.store.groupSelectionAnchor = node.path.join('.');
    if (this.isActive(node)) this.store.selectGroup(null);
    else this.store.selectGroup(node.path);
  }

  /** Select every sibling between the anchor and `node` (both in this level). */
  private selectRange(node: GroupNode): boolean {
    const anchor = this.store.groupSelectionAnchor;
    if (!anchor) return false;
    const nodes = this.nodes();
    const from = nodes.findIndex((n) => n.path.join('.') === anchor);
    const to = nodes.findIndex((n) => n === node);
    if (from < 0 || to < 0) return false; // anchor lives in another level
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    this.store.setGroupSelection(nodes.slice(lo, hi + 1).map((n) => n.path.join('.')));
    return true;
  }

  // ---- Inline rename ----
  isRenaming(node: GroupNode): boolean {
    return this.renamingKey() === node.path.join('.');
  }
  startRename(node: GroupNode): void {
    this.renameText.set(node.name);
    this.renamingKey.set(node.path.join('.'));
  }
  onRenameKeydown(event: KeyboardEvent, node: GroupNode): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitRename(node);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.renamingKey.set(null);
    }
  }
  async commitRename(node: GroupNode): Promise<void> {
    if (!this.isRenaming(node)) return;
    const next = this.renameText().trim();
    this.renamingKey.set(null);
    const collection = this.store.currentCollectionName();
    if (collection && next && next !== node.name) {
      await this.store.renameGroup(collection, node.path, next);
    }
  }

  // ---- Context menu ----
  onContextMenu(node: GroupNode, event: MouseEvent): void {
    const collection = this.store.currentCollectionName();
    if (!collection) return;
    this.ctxMenu.open(event, [
      { label: 'Rename', action: () => this.startRename(node) },
      { label: 'Duplicate', action: () => void this.store.duplicateGroup(collection, node.path) },
      {
        label: 'Paste variable here',
        disabled: !this.store.hasCopiedVariables(),
        action: () => void this.store.pasteVariables(node.path),
      },
      {
        label: 'Delete group',
        danger: true,
        action: () => void this.store.deleteGroup(collection, node.path),
      },
    ]);
  }
}
