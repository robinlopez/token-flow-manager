import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ProjectStore } from '../../stores/project.store';
import { UiService } from '../../core/ui.service';
import { typeGlyph } from '../../core/format';
import type { SearchHit } from '../../core/models';

@Component({
  selector: 'tf-command-palette',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.paletteOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-ink-950/30"
        (click)="close()"
      >
        <div
          class="w-[560px] max-w-[92vw] bg-white rounded-xl shadow-2xl border border-ink-200 overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <input
            #input
            class="w-full px-4 py-3 text-sm border-b border-ink-200 focus:outline-none"
            placeholder="Search tokens, run a command…"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keydown)="onKeydown($event)"
          />
          <div class="max-h-80 overflow-auto scrollbar-thin py-1">
            @for (hit of hits(); track hit.id; let i = $index) {
              <button
                class="w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm"
                [class.bg-forge-50]="i === active()"
                (mouseenter)="active.set(i)"
                (click)="choose(hit)"
              >
                <span class="text-ink-400 w-4 text-center">{{ glyph(hit) }}</span>
                <span class="text-ink-900">{{ hit.path.join('.') }}</span>
                <span class="ml-auto text-[11px] text-ink-400">{{ hit.collection }}</span>
              </button>
            }
            @if (hits().length === 0 && query()) {
              <div class="px-4 py-6 text-center text-sm text-ink-400">No matches.</div>
            }
          </div>
          <div class="px-4 py-1.5 border-t border-ink-200 text-[11px] text-ink-400 flex gap-3">
            <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
          </div>
        </div>
      </div>
    }
  `,
})
export class CommandPaletteComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  readonly ui = inject(UiService);

  readonly query = signal('');
  readonly hits = signal<SearchHit[]>([]);
  readonly active = signal(0);
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  constructor() {
    // Focus + reset whenever the palette opens.
    effect(() => {
      if (this.ui.paletteOpen()) {
        this.query.set('');
        this.hits.set([]);
        this.active.set(0);
        queueMicrotask(() => this.inputRef()?.nativeElement.focus());
      }
    });
  }

  glyph(hit: SearchHit): string {
    return typeGlyph(hit.type);
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.active.set(0);
    this.api.search(value, {}).subscribe({
      next: (res) => this.hits.set(res.hits.slice(0, 50)),
      error: () => this.hits.set([]),
    });
  }

  onKeydown(event: KeyboardEvent): void {
    const list = this.hits();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.active.set(Math.min(this.active() + 1, list.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(Math.max(this.active() - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = list[this.active()];
      if (hit) this.choose(hit);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  choose(hit: SearchHit): void {
    void this.store.revealToken(hit.id, hit.collection);
    this.close();
  }

  close(): void {
    this.ui.paletteOpen.set(false);
  }
}
