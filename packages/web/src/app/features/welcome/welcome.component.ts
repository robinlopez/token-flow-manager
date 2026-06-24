import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ProjectStore } from '../../stores/project.store';
import { APP_VERSION } from '../../core/version';
import type { RecentProject } from '../../core/models';

/**
 * Landing screen shown when no project is open: pick a recent project, or open the
 * OS-native folder picker (the server is local, so the dialog shows on this machine).
 * A manual path field is kept as a fallback for headless/remote setups.
 */
@Component({
  selector: 'tf-welcome',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .welcome-bg {
        position: relative;
        background-color: #fafaf9;
        background-image: radial-gradient(rgba(120, 113, 108, 0.13) 1px, transparent 1.4px);
        background-size: 22px 22px;
      }
      /* Darker dots, aligned to the same grid, revealed only around the cursor
         via a soft radial mask — the dots near the pointer "light up" darker. */
      .dot-spotlight {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image: radial-gradient(rgba(28, 25, 23, 0.5) 1px, transparent 1.4px);
        background-size: 22px 22px;
        opacity: 0;
        transition: opacity 0.4s ease;
        -webkit-mask-image: radial-gradient(
          200px circle at var(--mx, -1000px) var(--my, -1000px),
          #000 0%,
          rgba(0, 0, 0, 0.35) 45%,
          transparent 72%
        );
        mask-image: radial-gradient(
          200px circle at var(--mx, -1000px) var(--my, -1000px),
          #000 0%,
          rgba(0, 0, 0, 0.35) 45%,
          transparent 72%
        );
      }
      .welcome-bg.is-hovering .dot-spotlight {
        opacity: 1;
      }
    `,
  ],
  template: `
    <div
      class="welcome-bg h-screen flex flex-col items-center justify-center text-ink-950 p-6"
      [class.is-hovering]="hovering()"
      [style.--mx.px]="mx()"
      [style.--my.px]="my()"
      (mousemove)="onMove($event)"
      (mouseleave)="hovering.set(false)"
    >
      <div class="dot-spotlight"></div>
      <div class="relative z-10 w-full max-w-3xl">
        <!-- Brand -->
        <div class="flex items-center gap-3 mb-5">
          <img src="logo.svg" alt="" class="w-10 h-10 rounded-lg" />
          <div>
            <h1 class="text-lg font-semibold tracking-tight">Token Flow Manager</h1>
            <p class="text-xs text-ink-400">Open a project to manage its design tokens · v{{ version }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Recent projects -->
          <div class="bg-white border border-ink-200 rounded-xl overflow-hidden flex flex-col">
            <div class="px-4 py-2.5 border-b border-ink-100 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              Recent projects
            </div>
            <div class="flex-1 overflow-auto max-h-80">
              @if (recents().length === 0) {
                <p class="px-4 py-6 text-sm text-ink-400 text-center">No recent projects yet.</p>
              }
              @for (r of recents(); track r.path) {
                <div
                  class="group flex items-center border-b border-ink-50 last:border-0 hover:bg-ink-50"
                  [class.opacity-50]="!r.exists"
                >
                  <button
                    class="flex-1 text-left px-4 py-2.5 min-w-0 disabled:cursor-default"
                    [disabled]="!r.exists || busy()"
                    [title]="r.exists ? r.path : r.path + ' (missing)'"
                    (click)="open(r.path)"
                  >
                    <div class="text-sm font-medium text-ink-900 truncate">{{ r.name }}</div>
                    <div class="text-[11px] text-ink-400 font-mono truncate">{{ r.path }}</div>
                  </button>
                  <button
                    class="shrink-0 w-8 h-8 mr-1.5 flex items-center justify-center rounded text-ink-300 hover:text-ink-700 hover:bg-ink-100 opacity-0 group-hover:opacity-100"
                    title="Remove from recents"
                    (click)="remove(r.path, $event)"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              }
            </div>
          </div>

          <!-- Open a project -->
          <div class="bg-white border border-ink-200 rounded-xl p-5 flex flex-col gap-4">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                Open a project
              </div>
              <p class="mt-1 text-xs text-ink-400 leading-relaxed">
                Pick the folder that holds your design-token JSON files (DTCG).
              </p>
            </div>

            <button
              class="w-full flex items-center justify-center gap-2 text-sm font-medium px-3 py-2.5 rounded-lg bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40"
              [disabled]="busy()"
              (click)="browse()"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
              Browse your computer…
            </button>

            <div class="flex items-center gap-2 text-[11px] text-ink-300">
              <span class="flex-1 h-px bg-ink-100"></span>or paste a path<span class="flex-1 h-px bg-ink-100"></span>
            </div>

            <form class="flex gap-2" (submit)="openTyped(); $event.preventDefault()">
              <input
                class="flex-1 min-w-0 text-sm font-mono bg-ink-50 border border-ink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-forge-500"
                placeholder="/path/to/project"
                [ngModel]="typedPath()"
                (ngModelChange)="typedPath.set($event)"
                name="path"
              />
              <button
                class="shrink-0 text-sm font-medium px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40"
                [disabled]="!typedPath().trim() || busy()"
              >
                Open
              </button>
            </form>
          </div>
        </div>

        @if (error()) {
          <p class="mt-4 text-sm text-red-600">{{ error() }}</p>
        }
      </div>
    </div>
  `,
})
export class WelcomeComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  readonly version = APP_VERSION;

  readonly recents = signal<RecentProject[]>([]);
  readonly typedPath = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // Cursor position (px, viewport-relative) driving the dot spotlight.
  readonly mx = signal(-1000);
  readonly my = signal(-1000);
  readonly hovering = signal(false);

  constructor() {
    this.loadRecents();
  }

  onMove(event: MouseEvent): void {
    this.mx.set(event.clientX);
    this.my.set(event.clientY);
    if (!this.hovering()) this.hovering.set(true);
  }

  private loadRecents(): void {
    this.api.getRecents().subscribe({
      next: (r) => this.recents.set(r.recents),
      error: () => this.recents.set([]),
    });
  }

  /** Open the OS-native folder picker, then open the chosen project. */
  browse(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.pickFolder().subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.path) void this.open(r.path);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not open the folder picker — paste a path instead');
      },
    });
  }

  openTyped(): void {
    const p = this.typedPath().trim();
    if (p) void this.open(p);
  }

  async open(path: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const ok = await this.store.openProject(path);
    this.busy.set(false);
    if (!ok) this.error.set(this.store.error() ?? 'Could not open this project');
  }

  remove(path: string, event: Event): void {
    event.stopPropagation();
    this.api.removeRecent(path).subscribe({
      next: (r) => this.recents.set(r.recents),
      error: () => this.loadRecents(),
    });
  }
}
