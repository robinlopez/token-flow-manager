import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiService } from '../../core/ui.service';
import { APP_VERSION } from '../../core/version';

interface Shortcut {
  keys: string[];
  label: string;
}
interface Section {
  title: string;
  items: Shortcut[];
}

/** Modal listing every keyboard shortcut and drag gesture. Opened via ⌘/ or ?. */
@Component({
  selector: 'tf-shortcuts-help',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'ui.helpOpen.set(false)' },
  template: `
    @if (ui.helpOpen()) {
      <div
        class="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/40 p-4"
        (click)="ui.helpOpen.set(false)"
      >
        <div
          class="w-full max-w-2xl max-h-[80vh] overflow-auto bg-white rounded-xl shadow-2xl border border-ink-200"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-ink-100 sticky top-0 bg-white">
            <h2 class="text-sm font-semibold text-ink-900">Keyboard shortcuts & gestures</h2>
            <button
              class="w-7 h-7 flex items-center justify-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              title="Close (Esc)"
              (click)="ui.helpOpen.set(false)"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            @for (section of sections; track section.title) {
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-2">
                  {{ section.title }}
                </div>
                <ul class="space-y-1.5">
                  @for (item of section.items; track item.label) {
                    <li class="flex items-center justify-between gap-3 text-sm">
                      <span class="text-ink-700">{{ item.label }}</span>
                      <span class="flex items-center gap-1 shrink-0">
                        @for (k of item.keys; track $index) {
                          <kbd
                            class="px-1.5 py-0.5 text-[11px] font-mono rounded border border-ink-200 bg-ink-50 text-ink-600"
                            >{{ k }}</kbd
                          >
                        }
                      </span>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>

          <div class="px-5 py-2.5 border-t border-ink-100 text-[11px] text-ink-400 font-mono">
            Token Flow Manager v{{ version }}
          </div>
        </div>
      </div>
    }
  `,
})
export class ShortcutsHelpComponent {
  readonly ui = inject(UiService);
  readonly version = APP_VERSION;

  // ⌘ shown for all platforms (it maps to Ctrl on Windows/Linux via the handlers).
  readonly sections: Section[] = [
    {
      title: 'General',
      items: [
        { keys: ['⌘', 'S'], label: 'Search tokens' },
        { keys: ['⌘', 'R'], label: 'Refresh (re-scan files)' },
        { keys: ['⌘', '/'], label: 'This shortcuts help' },
        { keys: ['Esc'], label: 'Close overlay / cancel cut' },
      ],
    },
    {
      title: 'Edit',
      items: [
        { keys: ['⌘', 'Z'], label: 'Undo' },
        { keys: ['⌘', '⇧', 'Z'], label: 'Redo' },
        { keys: ['Enter'], label: 'Edit focused cell' },
        { keys: ['Esc'], label: 'Cancel edit' },
      ],
    },
    {
      title: 'Variables',
      items: [
        { keys: ['⌘', 'C'], label: 'Copy variable(s)' },
        { keys: ['⌘', 'X'], label: 'Cut variable(s)' },
        { keys: ['⌘', 'V'], label: 'Paste into group' },
      ],
    },
    {
      title: 'Selection & groups',
      items: [
        { keys: ['⌘', 'Click'], label: 'Add to multi-selection' },
        { keys: ['⇧', 'Click'], label: 'Select a range' },
        { keys: ['Drag'], label: 'Drop on a group to nest' },
        { keys: ['Drag'], label: 'Drop between groups to reorder' },
        { keys: ['Double-click'], label: 'Rename group / variable' },
      ],
    },
  ];
}
