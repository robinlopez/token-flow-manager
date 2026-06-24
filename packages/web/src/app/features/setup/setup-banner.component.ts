import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProjectStore } from '../../stores/project.store';
import { UiService } from '../../core/ui.service';

/**
 * Onboarding alert shown above the table when the tool doesn't fully understand
 * the project's structure — most importantly when there is no `manifest.json`
 * (the source of truth for collections/modes, kept ISO with the Figma plugin).
 * Offers a one-click "Generate manifest.json" and a link to the structure
 * settings. Dismissable for the session.
 */
@Component({
  selector: 'tf-setup-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="flex items-start gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-sm">
        <svg class="w-4 h-4 mt-0.5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-amber-900">{{ headline() }}</div>
          <ul class="mt-0.5 text-amber-800 space-y-0.5">
            @for (issue of issues(); track issue.message) {
              <li>{{ issue.message }}</li>
            }
          </ul>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          @if (showGenerate()) {
            <button
              class="px-2.5 py-1 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
              [disabled]="busy()"
              (click)="generate()"
            >
              {{ busy() ? 'Generating…' : 'Generate manifest.json' }}
            </button>
          }
          <button
            class="px-2.5 py-1 rounded-md border border-amber-300 text-amber-800 text-xs hover:bg-amber-100"
            (click)="ui.openSettings('collections')"
          >
            Configure
          </button>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-amber-500 hover:text-amber-800 hover:bg-amber-100"
            title="Dismiss"
            (click)="dismissed.set(true)"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </div>
    }
  `,
})
export class SetupBannerComponent {
  private readonly store = inject(ProjectStore);
  readonly ui = inject(UiService);

  readonly issues = this.store.setupIssues;
  readonly dismissed = signal(false);
  readonly busy = signal(false);

  readonly visible = computed(() => !this.dismissed() && this.issues().length > 0);
  readonly showGenerate = computed(() => this.issues().some((i) => i.code === 'no-manifest'));
  readonly headline = computed(() =>
    this.showGenerate()
      ? "Your project isn't configured yet"
      : 'Some collections need configuration',
  );

  async generate(): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.generateManifest();
    } finally {
      this.busy.set(false);
    }
  }
}
