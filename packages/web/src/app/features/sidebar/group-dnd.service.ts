import { Injectable, computed, inject, signal } from '@angular/core';
import { ProjectStore } from '../../stores/project.store';

/** Distance (px) the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Custom, pointer-driven drag-and-drop for the sidebar group tree — a Finder-like
 * "drop a folder onto a folder to nest, or between two folders to reorder" model.
 *
 * We deliberately do NOT use Angular CDK here: its connected-list transfer fights
 * the nest-vs-reorder gesture (sorting reflows rows under the cursor; cross-level
 * transfer is unreliable). Owning the pointer loop end-to-end makes the drop land
 * exactly where the indicator shows, and makes the whole thing testable with
 * synthetic PointerEvents.
 *
 * The view reads `intoKey` / `reorderKey` / `reorderAfter` to paint the highlight
 * and insertion line, and `draggingPaths` / preview coords to show the cursor
 * badge. All mutations go through ProjectStore so multi-selection moves, optimistic
 * reorder, and refresh stay consistent with the rest of the app.
 */
@Injectable({ providedIn: 'root' })
export class GroupDndService {
  private readonly store = inject(ProjectStore);

  /** Path-keys (`a/b/c`) being dragged ([] = idle). First entry is the grabbed row. */
  readonly draggingPaths = signal<string[][]>([]);
  readonly dragBadge = signal('');
  readonly previewX = signal(0);
  readonly previewY = signal(0);

  /** Folder the pointer would nest INTO (middle band), or null. */
  readonly intoKey = signal<string | null>(null);
  /** Sibling row the reorder insertion line attaches to, or null. */
  readonly reorderKey = signal<string | null>(null);
  /** Whether the insertion line sits below (`true`) or above (`false`) `reorderKey`. */
  readonly reorderAfter = signal(false);

  readonly isDragging = computed(() => this.draggingPaths().length > 0);
  readonly intoActive = computed(() => this.intoKey() !== null);

  private startX = 0;
  private startY = 0;
  private pending: { paths: string[][]; badge: string } | null = null;
  private active = false;
  /** Set briefly after a real drag so the trailing `click` doesn't also filter. */
  private clickSuppressed = false;

  /** True if `node`'s row is part of the current drag (drives the dimmed style). */
  isDraggingKey(key: string): boolean {
    return this.draggingPaths().some((p) => p.join('/') === key);
  }

  /**
   * Arm a drag from a row press. The drag only actually begins once the pointer
   * moves past the threshold, so a plain click still selects/filters the group.
   */
  beginPotentialDrag(ev: PointerEvent, paths: string[][], badge: string): void {
    this.startX = ev.clientX;
    this.startY = ev.clientY;
    this.pending = { paths, badge };
    this.active = false;
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
  }

  /** Consume the one-shot "a drag just ended" flag (the row's click handler calls this). */
  consumeClickSuppression(): boolean {
    const was = this.clickSuppressed;
    this.clickSuppressed = false;
    return was;
  }

  private readonly onMove = (ev: PointerEvent): void => {
    if (!this.pending) return;
    if (!this.active) {
      if (Math.hypot(ev.clientX - this.startX, ev.clientY - this.startY) < DRAG_THRESHOLD) return;
      this.active = true;
      this.draggingPaths.set(this.pending.paths);
      this.dragBadge.set(this.pending.badge);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    }
    ev.preventDefault();
    this.previewX.set(ev.clientX);
    this.previewY.set(ev.clientY);
    this.resolve(ev.clientX, ev.clientY);
  };

  private readonly onUp = (): void => {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    const wasActive = this.active;
    const into = this.intoKey();
    const reorderKey = this.reorderKey();
    const after = this.reorderAfter();
    const paths = this.draggingPaths();
    this.reset();
    if (wasActive) {
      this.clickSuppressed = true;
      if (paths.length) this.applyDrop(paths[0]!, into, reorderKey, after);
    }
  };

  /** Resolve the live drop target by hit-testing the real folder-row rectangles. */
  private resolve(x: number, y: number): void {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-tf-folder]'));
    const hovered = rows.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!hovered) {
      this.intoKey.set(null);
      this.reorderKey.set(null);
      return;
    }
    const key = hovered.dataset['tfFolder']!;
    // A dragged group can't target itself or one of its own descendants.
    const dragging = this.draggingPaths().map((p) => p.join('/'));
    if (dragging.some((d) => key === d || key.startsWith(d + '/'))) {
      this.intoKey.set(null);
      this.reorderKey.set(null);
      return;
    }
    const r = hovered.getBoundingClientRect();
    const rel = (y - r.top) / r.height;
    if (rel > 0.25 && rel < 0.75) {
      this.intoKey.set(key);
      this.reorderKey.set(null);
    } else {
      this.intoKey.set(null);
      this.reorderKey.set(key);
      this.reorderAfter.set(rel >= 0.5);
    }
  }

  private applyDrop(
    dragged: string[],
    intoKey: string | null,
    reorderKey: string | null,
    after: boolean,
  ): void {
    const collection = this.store.currentCollectionName();
    if (!collection) return;

    if (intoKey) {
      // Skip a no-op nest into the group's current parent.
      if (dragged.slice(0, -1).join('/') === intoKey) return;
      void this.store.moveGroups(collection, dragged, intoKey.split('/'));
      return;
    }
    if (reorderKey) {
      void this.store.moveGroupToPosition(collection, dragged, reorderKey.split('/'), after);
    }
  }

  private reset(): void {
    this.pending = null;
    this.active = false;
    this.draggingPaths.set([]);
    this.intoKey.set(null);
    this.reorderKey.set(null);
    this.reorderAfter.set(false);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  }
}
