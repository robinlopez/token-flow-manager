import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { UiService } from '../../core/ui.service';
import { ProjectStore } from '../../stores/project.store';
import { TemplateLogoComponent } from './template-logo.component';
import type { ScaffoldTemplateResult, TokenTemplate } from '../../core/models';

/**
 * "Start from a template": the second face of the welcome screen's "Open a
 * project" card, for people with no token project yet (or who want a fresh
 * source of truth to commit). Most visitors already have a project, so this is
 * one slide away rather than a block of its own.
 *
 * Picking a row opens a dialog that asks only what the server cannot guess: the
 * destination folder. Scaffolding writes the template's DTCG files plus its
 * `manifest.json`, then the project is opened through the normal store path, so
 * it lands in the recents list like any other. Optionally the distribution
 * configurator opens right after, since a brand-new token set has no build yet.
 */
@Component({
  selector: 'tf-template-gallery',
  standalone: true,
  imports: [FormsModule, TemplateLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col min-h-0' },
  template: `
    <!-- Header: back out to "Open a project", then title + description -->
    <div class="px-4 py-2.5 border-b border-ink-100 flex items-center gap-2 shrink-0">
      <button
        class="shrink-0 -ml-1 w-6 h-6 flex items-center justify-center rounded text-ink-400 hover:text-ink-800 hover:bg-ink-100"
        title="Back to opening a project"
        aria-label="Back"
        (click)="back.emit()"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span class="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        Start from a template
      </span>
    </div>

    <p class="px-4 pt-3 pb-2 text-xs text-ink-400 leading-relaxed shrink-0">
      Scaffold a token structure from a design system, then keep it as your source of truth.
    </p>

    <div class="flex-1 min-h-0 overflow-auto scrollbar-thin">
      @if (templates().length === 0) {
        <p class="px-4 py-6 text-sm text-ink-400 text-center">No templates available.</p>
      }
      @for (t of templates(); track t.id) {
        <button
          type="button"
          class="group w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-ink-50 last:border-0 hover:bg-ink-50"
          [class.bg-ink-50]="picked()?.id === t.id"
          [attr.aria-pressed]="picked()?.id === t.id"
          (click)="pick(t)"
        >
          <span class="shrink-0 w-6 h-6">
            <tf-template-logo [logo]="t.logo" />
          </span>

          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-ink-900 truncate">{{ t.name }}</span>
            <span class="block text-[11px] text-ink-400 font-mono truncate">
              <span
                class="uppercase"
                [style.color]="t.origin === 'official' ? t.accent : null"
              >{{ t.origin }}</span>
              · {{ t.collections.length }} collections · {{ t.tokenCount }} variables
            </span>
          </span>

          <!-- Check indicator: a chevron until picked, then a filled brand tick. -->
          <span class="shrink-0 w-4 h-4 flex items-center justify-center">
            @if (picked()?.id === t.id) {
              <span
                class="w-4 h-4 rounded-full flex items-center justify-center"
                [style.background-color]="t.accent"
              >
                <svg class="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              </span>
            } @else {
              <svg class="w-4 h-4 text-ink-300 opacity-0 group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            }
          </span>
        </button>
      }
    </div>

    <!-- Scaffold dialog -->
    @if (picked(); as t) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30 p-6"
        (click)="cancel()"
      >
        <div
          class="w-[560px] max-w-full max-h-[88vh] bg-white rounded-xl shadow-2xl border border-ink-200 flex flex-col overflow-hidden"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="px-5 py-4 border-b border-ink-100 flex items-start gap-3 shrink-0">
            <span class="shrink-0 w-9 h-9">
              <tf-template-logo [logo]="t.logo" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-ink-900">{{ t.name }}</div>
              <div class="text-[11px] text-ink-400 font-mono">
                {{ t.fileCount }} files · {{ kb(t.bytes) }} kB
                @if (t.hasStyles) { · text + effect styles }
              </div>
            </div>
            @if (t.url) {
              <a
                class="shrink-0 text-[11px] text-ink-400 hover:text-ink-700 underline"
                [href]="t.url"
                target="_blank"
                rel="noreferrer"
              >
                reference
              </a>
            }
            <button class="shrink-0 text-ink-400 hover:text-ink-700 text-xl leading-none" (click)="cancel()">×</button>
          </div>

          <div class="flex-1 overflow-auto scrollbar-thin px-5 py-4 space-y-4 text-sm">
            <p class="text-xs text-ink-600 leading-relaxed">{{ t.description }}</p>

            <!-- What lands on disk -->
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5">
                Collections
              </div>
              <div class="flex flex-wrap gap-1.5">
                @for (c of t.collections; track c.name) {
                  <span
                    class="text-[11px] px-2 py-1 rounded-md bg-ink-50 border border-ink-100 text-ink-600"
                    [title]="c.modes.join(', ')"
                  >
                    <span class="text-ink-900 font-medium">{{ c.name }}</span>
                    · {{ c.tokenCount }} vars
                    @if (c.modes.length > 1) { · {{ c.modes.length }} modes }
                  </span>
                }
              </div>
            </div>

            <!-- Destination -->
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5">
                Where to create it
              </div>
              <div class="flex gap-2">
                <input
                  class="flex-1 min-w-0 text-xs font-mono bg-ink-50 border border-ink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-forge-500"
                  placeholder="pick or paste a folder"
                  [ngModel]="parent()"
                  (ngModelChange)="parent.set($event); conflicts.set([])"
                  name="parent"
                />
                <button
                  class="shrink-0 text-xs font-medium px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50 disabled:opacity-40"
                  [disabled]="busy()"
                  (click)="browse()"
                >
                  Browse…
                </button>
              </div>

              <label class="block mt-2">
                <span class="text-[11px] text-ink-400">Sub-folder (leave empty to use the folder above)</span>
                <input
                  class="mt-1 w-full text-xs font-mono bg-ink-50 border border-ink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-forge-500"
                  [placeholder]="t.suggestedFolder"
                  [ngModel]="folder()"
                  (ngModelChange)="folder.set($event); conflicts.set([])"
                  name="folder"
                />
              </label>

              @if (target()) {
                <p class="mt-2 text-[11px] text-ink-400 font-mono truncate" [title]="target()">
                  → {{ target() }}
                </p>
              }
            </div>

            <!-- Distribution follow-up -->
            <label class="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" class="mt-0.5" [checked]="withDistribution()" (change)="toggleDistribution($event)" />
              <span>
                <span class="text-ink-900 font-medium text-xs">Set up distribution right after</span>
                <span class="block text-ink-500 text-[11px] leading-relaxed">
                  Opens the configurator that turns these tokens into the formats you need:
                  CSS variables, SCSS, TypeScript, JSON.
                </span>
              </span>
            </label>

            @if (conflicts().length > 0) {
              <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <div class="font-medium">That folder already has these files:</div>
                <div class="mt-1 font-mono text-[11px] break-all">{{ conflicts().join(', ') }}</div>
                <button
                  class="mt-2 text-[11px] font-medium px-2 py-1 rounded border border-amber-400 hover:bg-amber-100"
                  [disabled]="busy()"
                  (click)="create(true)"
                >
                  Overwrite them
                </button>
              </div>
            }
            @if (error()) {
              <p class="text-xs text-red-600">{{ error() }}</p>
            }
          </div>

          <!-- Actions -->
          <div class="px-5 py-3 border-t border-ink-100 flex items-center justify-end gap-2 shrink-0">
            <button
              class="text-sm font-medium px-3 py-2 rounded-lg text-ink-600 hover:bg-ink-50"
              [disabled]="busy()"
              (click)="cancel()"
            >
              Cancel
            </button>
            <button
              class="text-sm font-medium px-3.5 py-2 rounded-lg bg-ink-950 text-white hover:bg-ink-800 disabled:opacity-40"
              [disabled]="!parent().trim() || busy()"
              (click)="create(false)"
            >
              {{ busy() ? 'Creating…' : 'Create project' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class TemplateGalleryComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(ProjectStore);
  private readonly ui = inject(UiService);

  /** Slide back to the "Open a project" face of the card. */
  readonly back = output<void>();
  /** Whether this server offers any template (an older one has no catalog). */
  readonly availableChange = output<boolean>();

  readonly templates = signal<TokenTemplate[]>([]);
  /** The row the user clicked (also the dialog's open state). */
  readonly picked = signal<TokenTemplate | null>(null);
  readonly parent = signal('');
  readonly folder = signal('');
  readonly withDistribution = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflicts = signal<string[]>([]);

  /** Absolute destination, mirroring the server's `parent[/folder]` rule. */
  readonly target = computed(() => {
    const parent = this.parent().trim().replace(/\/+$/, '');
    if (!parent) return '';
    const folder = this.folder().trim() || this.picked()?.suggestedFolder || '';
    return folder ? `${parent}/${folder}` : parent;
  });

  constructor() {
    this.api.getTemplates().subscribe({
      next: (r) => {
        this.templates.set(r.templates);
        this.availableChange.emit(r.templates.length > 0);
      },
      // Older server with no catalog: the entry point stays hidden.
      error: () => {
        this.templates.set([]);
        this.availableChange.emit(false);
      },
    });
  }

  kb(bytes: number): number {
    return Math.round(bytes / 1024);
  }

  pick(template: TokenTemplate): void {
    this.picked.set(template);
    this.folder.set(template.suggestedFolder);
    this.error.set(null);
    this.conflicts.set([]);
  }

  cancel(): void {
    if (this.busy()) return;
    this.picked.set(null);
    this.error.set(null);
    this.conflicts.set([]);
  }

  toggleDistribution(event: Event): void {
    this.withDistribution.set((event.target as HTMLInputElement).checked);
  }

  /** Native folder picker on the machine running the server (it is local). */
  browse(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.pickFolder('scaffold').subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.path) {
          this.parent.set(r.path.replace(/\/+$/, ''));
          this.conflicts.set([]);
        }
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not open the folder picker, paste a path instead');
      },
    });
  }

  async create(overwrite: boolean): Promise<void> {
    const template = this.picked();
    const parent = this.parent().trim();
    if (!template || !parent || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);
    this.conflicts.set([]);
    const folder = this.folder().trim();
    try {
      const res = await firstValueFrom(
        this.api.scaffoldTemplate({
          templateId: template.id,
          parent,
          ...(folder ? { folder } : {}),
          overwrite,
        }),
      );
      await this.openScaffolded(res.path);
    } catch (err) {
      this.busy.set(false);
      const body = err instanceof HttpErrorResponse ? (err.error as ScaffoldTemplateResult | undefined) : undefined;
      if (body?.conflicts?.length) {
        this.conflicts.set(body.conflicts);
        return;
      }
      this.error.set(scaffoldError(err));
    }
  }

  /** Open the freshly-written folder, then optionally jump to distribution. */
  private async openScaffolded(path: string): Promise<void> {
    const ok = await this.store.openProject(path);
    this.busy.set(false);
    if (!ok) {
      this.error.set(this.store.error() ?? 'Created the files, but could not open the project');
      return;
    }
    this.picked.set(null);
    if (this.withDistribution()) this.ui.distributionOpen.set(true);
  }
}

/** Best-effort message out of a failed scaffold response. */
function scaffoldError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: unknown } | undefined;
    if (typeof body?.error === 'string') return body.error;
    if (err.status === 0) return 'The server is not reachable';
  }
  return err instanceof Error ? err.message : 'Could not create the project';
}
