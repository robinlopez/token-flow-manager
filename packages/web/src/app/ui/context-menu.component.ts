import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ContextMenuService, type ContextMenuItem } from '../core/context-menu.service';

/** Renders the app's single floating context menu (driven by ContextMenuService). */
@Component({
  selector: 'tf-context-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'menu.close()',
  },
  template: `
    @if (menu.state(); as s) {
      <!-- backdrop: any click/scroll dismisses -->
      <div
        class="fixed inset-0 z-[100]"
        (click)="menu.close()"
        (wheel)="menu.close()"
        (contextmenu)="menu.close(); $event.preventDefault()"
      ></div>
      <div
        #menuEl
        class="fixed z-[101] min-w-[180px] py-1 bg-white border border-ink-200 rounded-lg shadow-xl text-sm"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
      >
        @for (item of s.items; track item.label) {
          <button
            class="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
            [class.text-red-600]="item.danger"
            [class.hover:bg-red-50]="item.danger"
            [disabled]="item.disabled"
            (click)="run(item)"
          >
            {{ item.label }}
          </button>
        }
      </div>
    }
  `,
})
export class ContextMenuComponent {
  readonly menu = inject(ContextMenuService);
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menuEl');

  /** Where the menu is actually painted, kept inside the viewport. */
  readonly pos = signal<{ left: number; top: number }>({ left: 0, top: 0 });

  private static readonly MARGIN = 8;
  /** Fallback item height (px) used to seed the position before measuring. */
  private static readonly EST_ITEM_H = 33;

  constructor() {
    // On open, seed a viewport-safe position (estimated), then refine it against
    // the menu's real measured size once it is in the DOM.
    effect(() => {
      const s = this.menu.state();
      if (!s) return;
      const estH = s.items.length * ContextMenuComponent.EST_ITEM_H + 8;
      this.pos.set(this.fit(s.x, s.y, 200, estH));
      queueMicrotask(() => {
        const el = this.menuEl()?.nativeElement;
        if (el) this.pos.set(this.fit(s.x, s.y, el.offsetWidth, el.offsetHeight));
      });
    });
  }

  /**
   * Clamp/flip a menu of size `w`×`h` so it stays fully on screen: prefer opening
   * to the right/below the cursor, flip to the left/above when it would overflow,
   * and clamp as a last resort so no edge is ever clipped.
   */
  private fit(x: number, y: number, w: number, h: number): { left: number; top: number } {
    const m = ContextMenuComponent.MARGIN;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    if (left + w + m > vw) left = x - w; // flip to the left of the cursor
    left = Math.max(m, Math.min(left, vw - w - m));

    let top = y;
    if (top + h + m > vh) top = y - h >= m ? y - h : vh - h - m; // flip above, else clamp
    top = Math.max(m, Math.min(top, vh - h - m));

    return { left, top };
  }

  run(item: ContextMenuItem): void {
    this.menu.close();
    if (!item.disabled) item.action();
  }
}
