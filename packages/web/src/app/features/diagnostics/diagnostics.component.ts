import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ProjectStore } from '../../stores/project.store';
import { UiService } from '../../core/ui.service';
import type { Diagnostic } from '../../core/models';

@Component({
  selector: 'tf-diagnostics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.diagnosticsOpen()) {
      <div class="fixed inset-0 z-40" (click)="close()">
        <div
          class="absolute right-0 top-0 h-full w-[440px] max-w-[92vw] bg-white border-l border-ink-200 shadow-2xl flex flex-col"
          (click)="$event.stopPropagation()"
        >
          <div class="px-4 py-3 border-b border-ink-200 flex items-center justify-between">
            <div class="font-semibold text-sm">Diagnostics</div>
            <button class="text-ink-400 hover:text-ink-700 text-lg leading-none" (click)="close()">
              ×
            </button>
          </div>
          <div class="flex-1 overflow-auto scrollbar-thin p-3 space-y-2 text-sm">
            @for (d of diagnostics(); track $index) {
              <div class="rounded-md border border-ink-200 p-2.5">
                <div class="flex items-start gap-2">
                  <span
                    class="mt-0.5 w-2 h-2 rounded-full shrink-0"
                    [class.bg-red-500]="d.severity === 'error'"
                    [class.bg-amber-500]="d.severity === 'warning'"
                    [class.bg-blue-500]="d.severity === 'info'"
                  ></span>
                  <div class="flex-1">
                    <div class="text-ink-800">{{ d.message }}</div>
                    <div class="text-[11px] text-ink-400 mt-0.5 font-mono">
                      {{ d.code }}@if (d.file) { · {{ d.file }}@if (d.line != null) {:{{ d.line + 1 }}} }
                    </div>
                    <div class="flex gap-2 mt-1.5">
                      @if (d.tokenId) {
                        <button class="text-[11px] text-forge-600 hover:underline" (click)="reveal(d)">
                          Go to token
                        </button>
                      }
                      @for (fix of d.quickFixes ?? []; track fix.action) {
                        <button
                          class="text-[11px] px-2 py-0.5 rounded bg-ink-900 text-white hover:bg-ink-700"
                          (click)="apply(d, fix.action, fix.data)"
                        >
                          {{ fix.label }}
                        </button>
                      }
                    </div>
                  </div>
                </div>
              </div>
            }
            @if (diagnostics().length === 0) {
              <div class="px-4 py-10 text-center text-ink-400">No diagnostics. 🎉</div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class DiagnosticsComponent {
  private readonly store = inject(ProjectStore);
  readonly ui = inject(UiService);
  readonly diagnostics = computed(() => this.store.state()?.diagnostics ?? []);

  close(): void {
    this.ui.diagnosticsOpen.set(false);
  }

  async reveal(d: Diagnostic): Promise<void> {
    if (!d.tokenId) return;
    // Resolve the token's collection server-side, switch to it, clear filters,
    // select + scroll-to it (works even when it lives in another collection).
    const ok = await this.store.revealTokenById(d.tokenId);
    if (ok) this.ui.diagnosticsOpen.set(false);
  }

  async apply(d: Diagnostic, action: string, data?: Record<string, unknown>): Promise<void> {
    if (!d.tokenId) return;
    await this.store.applyQuickFix(d.tokenId, action, d.mode, data);
  }
}
