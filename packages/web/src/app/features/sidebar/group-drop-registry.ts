import { Injectable, computed, signal } from '@angular/core';

/** Nesting depth encoded in a drop-list id, for innermost-first ordering. */
function depthOf(id: string): number {
  if (id === 'gt-root') return 0;
  if (id.startsWith('gt-')) return id.slice('gt-'.length).split('/').filter(Boolean).length;
  return 0; // table sections (sec-*) are flat
}

/** Pointer position in viewport coordinates (CdkDragMove.pointerPosition shape). */
interface Point {
  x: number;
  y: number;
}

/**
 * Shared registry of every CDK drop-list id used by the variables TABLE — its
 * sections AND the sidebar group levels (which act as receive-only drop targets
 * for table rows). Connecting every list to all the others lets a table variable
 * be dropped onto another section OR onto a sidebar group folder to move it there.
 *
 * Group reordering/nesting in the sidebar is NOT handled here — it has its own
 * pointer-driven {@link GroupDndService}. This registry only serves the table's
 * CDK drag and the "drop a variable onto a folder" resolution.
 */
@Injectable({ providedIn: 'root' })
export class GroupDropRegistry {
  readonly ids = signal<string[]>([]);

  /** Drop target (table section or sidebar level) currently hovered, or null. */
  readonly activeTarget = signal<string | null>(null);

  /** Path-key (`a/b/c`) of the sidebar folder a dragged variable would drop into. */
  readonly intoKey = signal<string | null>(null);

  /**
   * Connection order, DEEPEST list first. CDK picks the first connected sibling
   * whose rect contains the pointer; since a parent level list geometrically
   * contains its nested child lists, listing children first makes the innermost
   * list win.
   */
  readonly idsDeepestFirst = computed(() =>
    [...this.ids()].sort((a, b) => depthOf(b) - depthOf(a)),
  );

  register(id: string): void {
    this.ids.update((list) => (list.includes(id) ? list : [...list, id]));
  }

  unregister(id: string): void {
    this.ids.update((list) => list.filter((x) => x !== id));
    if (this.activeTarget() === id) this.activeTarget.set(null);
  }

  /** Mark `id` as the active drop target (on cdkDropListEntered). */
  enter(id: string): void {
    this.activeTarget.set(id);
  }

  /** Clear the active target if it is still `id` (on cdkDropListExited). */
  leave(id: string): void {
    if (this.activeTarget() === id) this.activeTarget.set(null);
  }

  /**
   * Resolve which sidebar folder a dragged variable is hovering — the whole row
   * counts as "drop into this group". Called from the table's `cdkDragMoved`. The
   * `kind` argument is kept for call-site compatibility (only tokens use this).
   * Hit-tests the live `[data-tf-folder]` rects rather than `elementFromPoint`,
   * which would land on the floating preview painted over the row.
   */
  track(pos: Point, _kind: 'group' | 'token'): void {
    const row = Array.from(document.querySelectorAll<HTMLElement>('[data-tf-folder]')).find(
      (el) => {
        const r = el.getBoundingClientRect();
        return pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom;
      },
    );
    this.intoKey.set(row?.dataset['tfFolder'] ?? null);
  }

  /** Clear all transient drag state (on drop / drag end). */
  clear(): void {
    this.activeTarget.set(null);
    this.intoKey.set(null);
  }
}
