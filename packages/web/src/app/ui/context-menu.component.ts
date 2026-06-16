import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ContextMenuService, type ContextMenuItem } from '../core/context-menu.service';

/** Renders the app's single floating context menu (driven by ContextMenuService). */
@Component({
  selector: 'tf-context-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'menu.close()',
    '(document:contextmenu)': 'onGlobalContextMenu($event)',
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
        class="fixed z-[101] min-w-[180px] py-1 bg-white border border-ink-200 rounded-lg shadow-xl text-sm"
        [style.left.px]="clampX(s.x)"
        [style.top.px]="clampY(s.y)"
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

  run(item: ContextMenuItem): void {
    this.menu.close();
    if (!item.disabled) item.action();
  }

  /** Close our own menu when a NEW context menu opens elsewhere is handled by the
   * service; here we just keep the menu from overflowing the viewport. */
  onGlobalContextMenu(_event: MouseEvent): void {
    /* the element handlers call menu.open() which replaces the state */
  }

  clampX(x: number): number {
    return Math.min(x, window.innerWidth - 200);
  }
  clampY(y: number): number {
    return Math.min(y, window.innerHeight - 160);
  }
}
