import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ProjectStore } from '../../stores/project.store';
import type { RecentProject } from '../../core/models';

/**
 * Header control showing the open project's name with a chevron. The dropdown
 * lets you switch to a recent project in place or go back to the welcome screen
 * to open another — so a path is never needed on the command line.
 */
@Component({
  selector: 'tf-project-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <button
        class="flex items-center gap-1.5 max-w-[280px] px-2 py-1 rounded text-sm text-ink-700 hover:bg-ink-100"
        [title]="root()"
        (click)="toggle()"
      >
        <span class="truncate font-medium">{{ name() }}</span>
        <svg class="w-3.5 h-3.5 shrink-0 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      @if (open()) {
        <!-- click-away backdrop -->
        <div class="fixed inset-0 z-40" (click)="open.set(false)"></div>
        <div
          class="absolute left-0 top-9 z-50 w-72 bg-white border border-ink-200 rounded-lg shadow-xl py-1 text-sm"
        >
          <div class="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Current
          </div>
          <div class="px-3 pb-2">
            <div class="text-ink-900 font-medium truncate">{{ name() }}</div>
            <div class="text-[11px] text-ink-400 font-mono truncate">{{ root() }}</div>
          </div>

          @if (otherRecents().length) {
            <div class="border-t border-ink-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              Switch to
            </div>
            <div class="max-h-56 overflow-auto">
              @for (r of otherRecents(); track r.path) {
                <button
                  class="w-full text-left px-3 py-1.5 hover:bg-ink-50 disabled:opacity-40"
                  [disabled]="!r.exists"
                  [title]="r.path"
                  (click)="switchTo(r.path)"
                >
                  <div class="text-ink-800 truncate">{{ r.name }}</div>
                  <div class="text-[11px] text-ink-400 font-mono truncate">{{ r.path }}</div>
                </button>
              }
            </div>
          }

          <div class="border-t border-ink-100 mt-1 pt-1">
            <button
              class="w-full text-left px-3 py-2 hover:bg-ink-50 flex items-center gap-2 text-ink-700"
              (click)="goHome()"
            >
              <svg class="w-4 h-4 shrink-0 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M9 22V12h6v10" />
              </svg>
              Open another project…
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProjectSwitcherComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);

  readonly open = signal(false);
  readonly recents = signal<RecentProject[]>([]);

  readonly root = computed(() => this.store.state()?.root ?? '');
  readonly name = computed(() => {
    const r = this.root();
    return r ? (r.split('/').filter(Boolean).pop() ?? r) : 'No project';
  });
  /** Recents other than the one currently open. */
  readonly otherRecents = computed(() => {
    const current = this.root();
    return this.recents().filter((r) => r.path !== current);
  });

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.api.getRecents().subscribe({
        next: (r) => this.recents.set(r.recents),
        error: () => this.recents.set([]),
      });
    }
  }

  async switchTo(path: string): Promise<void> {
    this.open.set(false);
    await this.store.openProject(path);
  }

  async goHome(): Promise<void> {
    this.open.set(false);
    await this.store.closeProject();
  }
}
