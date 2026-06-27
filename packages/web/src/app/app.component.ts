import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ProjectStore } from './stores/project.store';
import { RealtimeService } from './core/realtime.service';
import { UiService } from './core/ui.service';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { ToolbarComponent } from './features/toolbar/toolbar.component';
import { VariablesTableComponent } from './features/variables-table/variables-table.component';
import { InspectorComponent } from './features/inspector/inspector.component';
import { CommandPaletteComponent } from './features/command-palette/command-palette.component';
import { DiagnosticsComponent } from './features/diagnostics/diagnostics.component';
import { SettingsComponent } from './features/settings/settings.component';
import { DistributionComponent } from './features/distribution/distribution.component';
import { ShortcutsHelpComponent } from './features/help/shortcuts-help.component';
import { WelcomeComponent } from './features/welcome/welcome.component';
import { ProjectSwitcherComponent } from './features/project-switcher/project-switcher.component';
import { ContextMenuComponent } from './ui/context-menu.component';
import { CellPickerComponent } from './ui/cell-picker.component';
import { SetupBannerComponent } from './features/setup/setup-banner.component';
import { APP_VERSION } from './core/version';

@Component({
  selector: 'tf-root',
  standalone: true,
  imports: [
    SidebarComponent,
    SetupBannerComponent,
    ToolbarComponent,
    VariablesTableComponent,
    InspectorComponent,
    CommandPaletteComponent,
    DiagnosticsComponent,
    SettingsComponent,
    DistributionComponent,
    ShortcutsHelpComponent,
    WelcomeComponent,
    ProjectSwitcherComponent,
    ContextMenuComponent,
    CellPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:click)': 'onDocumentClick($event)',
  },
  styles: [
    `
      .tf-spin {
        animation: tf-rot 0.8s linear infinite;
      }
      @keyframes tf-rot {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
  template: `
    @if (isOpen()) {
    <div class="flex flex-col h-screen text-ink-950">
      <!-- Header -->
      <header class="h-12 shrink-0 flex items-center gap-3 px-4 bg-ink-50 border-b border-ink-200">
        <img src="logo.svg" alt="" class="w-6 h-6 rounded-md" />
        <span class="font-semibold tracking-tight text-sm">Token Flow Manager</span>
        <span class="w-px h-4 bg-ink-200 mx-1"></span>
        <tf-project-switcher />
        <span class="flex-1"></span>

        <!-- Refresh (rich explanation shown on hover) -->
        <div
          class="relative flex items-center"
          (mouseenter)="infoOpen.set(true)"
          (mouseleave)="infoOpen.set(false)"
        >
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-ink-500 hover:bg-ink-100 disabled:opacity-50"
            [attr.aria-label]="'Refresh — re-scan token files (⌘R)'"
            [disabled]="refreshing()"
            (click)="refresh()"
          >
            <svg
              class="w-4 h-4"
              [class.tf-spin]="refreshing()"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          @if (infoOpen()) {
            <div
              class="absolute right-0 top-9 z-50 w-72 bg-white border border-ink-200 rounded-lg shadow-xl p-3 text-xs text-ink-600 leading-relaxed"
            >
              <div class="font-semibold text-ink-900 mb-1">Refresh (⌘R)</div>
              Re-scans the token files on disk and re-detects collections. File
              <em>edits</em> already update live — use Refresh when you
              <strong>add, remove, rename or move</strong> a token file, or change the
              manifest / <code>tokenflow.config.json</code>.
            </div>
          }
        </div>

        <!-- Undo / redo (Phase 3.6) -->
        <div class="flex items-center">
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-ink-500 hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
            [disabled]="!canUndo()"
            [title]="undoLabel() ? 'Undo: ' + undoLabel() + '  (⌘Z)' : 'Nothing to undo'"
            (click)="undo()"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9" />
            </svg>
          </button>
          <button
            class="w-7 h-7 flex items-center justify-center rounded text-ink-500 hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
            [disabled]="!canRedo()"
            [title]="redoLabel() ? 'Redo: ' + redoLabel() + '  (⌘⇧Z)' : 'Nothing to redo'"
            (click)="redo()"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 14 5-5-5-5" />
              <path d="M20 9H9a5 5 0 0 0-5 5v0a5 5 0 0 0 5 5h6" />
            </svg>
          </button>
        </div>

        <button
          class="w-9 h-9 flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          title="Search tokens (⌘S)"
          (click)="ui.togglePalette()"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
        <button
          class="w-9 h-9 flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          title="Keyboard shortcuts (⌘/ or ?)"
          (click)="ui.toggleHelp()"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </button>
        <button
          class="w-9 h-9 flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          title="Distribution — export config (Style Dictionary)"
          (click)="ui.toggleDistribution()"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="m3.3 7 8.7 5 8.7-5" />
            <path d="M12 22V12" />
          </svg>
        </button>
        <button
          class="w-9 h-9 flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
          title="Settings"
          (click)="ui.toggleSettings()"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <span
          class="text-xs flex items-center gap-1.5"
          [class.text-green-600]="connected()"
          [class.text-ink-400]="!connected()"
        >
          <span
            class="w-2 h-2 rounded-full"
            [class.bg-green-500]="connected()"
            [class.bg-ink-300]="!connected()"
          ></span>
          {{ connected() ? 'live' : 'offline' }}
        </span>
      </header>

      <!-- Main -->
      <div class="flex flex-1 overflow-hidden">
        <tf-sidebar />
        <main class="flex-1 flex flex-col overflow-hidden">
          <tf-setup-banner />
          <tf-toolbar />
          <div class="flex-1 overflow-hidden">
            <tf-variables-table />
          </div>
        </main>
        <tf-inspector />
      </div>

      <!-- Footer -->
      <footer
        class="h-7 shrink-0 flex items-center gap-4 px-4 bg-ink-50 border-t border-ink-200 text-[11px] text-ink-500 font-mono"
      >
        <button class="text-red-500 hover:underline" (click)="ui.toggleDiagnostics()">
          ● {{ errorCount() }} errors
        </button>
        <button class="text-amber-500 hover:underline" (click)="ui.toggleDiagnostics()">
          ▲ {{ warningCount() }} warnings
        </button>
        <span>{{ tokenCount() }} tokens</span>
        @if (error()) {
          <span class="text-red-500 truncate">{{ error() }}</span>
        }
        <span class="flex-1"></span>
        <button
          class="hover:text-ink-700"
          title="Keyboard shortcuts (⌘/)"
          (click)="ui.toggleHelp()"
        >
          v{{ version }}
        </button>
      </footer>
    </div>
    } @else {
      <tf-welcome />
    }

    <tf-command-palette />
    <tf-diagnostics />
    <tf-settings />
    <tf-distribution />
    <tf-shortcuts-help />
    <tf-context-menu />
    <tf-cell-picker />

    @if (toast()) {
      <div
        class="fixed bottom-12 left-1/2 -translate-x-1/2 z-[60] px-3.5 py-2 rounded-lg bg-ink-950 text-white text-xs font-medium shadow-xl"
      >
        {{ toast() }}
      </div>
    }
  `,
})
export class AppComponent {
  private readonly store = inject(ProjectStore);
  private readonly realtime = inject(RealtimeService);
  readonly ui = inject(UiService);

  readonly tokenCount = computed(() => this.store.state()?.tokenCount ?? 0);
  readonly errorCount = this.store.errorCount;
  readonly warningCount = this.store.warningCount;
  readonly error = this.store.error;
  readonly connected = this.realtime.connected;
  readonly refreshing = this.store.loading;
  readonly infoOpen = signal(false);
  readonly canUndo = this.store.canUndo;
  readonly canRedo = this.store.canRedo;
  readonly undoLabel = this.store.undoLabel;
  readonly redoLabel = this.store.redoLabel;
  readonly toast = this.ui.toast;
  readonly version = APP_VERSION;
  readonly isOpen = this.store.isOpen;

  constructor() {
    void this.store.init();
  }

  refresh(): void {
    void this.store.reload();
  }

  undo(): void {
    void this.store.undo();
  }
  redo(): void {
    void this.store.redo();
  }

  /**
   * Click anywhere in the window clears the variable selection — the classic
   * "click away to deselect" behaviour. We bail out when the click lands on a
   * table row or inside selection-aware UI (sidebar, inspector, toolbar, the
   * open overlays), since those own / act on the selection themselves; clearing
   * it there would fight their own click handlers.
   */
  onDocumentClick(event: MouseEvent): void {
    if (!this.store.isOpen()) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        '.tf-row, tf-sidebar, tf-inspector, tf-toolbar, tf-context-menu, ' +
          'tf-cell-picker, tf-command-palette, tf-settings, tf-distribution, ' +
          'tf-diagnostics, tf-shortcuts-help',
      )
    ) {
      return;
    }
    this.store.deselectAll();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.store.isOpen()) return; // welcome screen: no app shortcuts

    // No-modifier shortcuts (skipped while typing in a field).
    if (event.key === 'Escape') {
      if (!isEditableTarget(event.target)) this.store.cancelCut();
      return;
    }
    if (event.key === '?' && !isEditableTarget(event.target)) {
      event.preventDefault();
      this.ui.toggleHelp();
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();

    // App-level shortcuts (work even while editing): search, refresh, help.
    if (key === 's') {
      event.preventDefault();
      this.ui.togglePalette();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      this.refresh();
      return;
    }
    if (key === '/') {
      event.preventDefault();
      this.ui.toggleHelp();
      return;
    }

    // The rest are ignored while typing in a field / cell editor (native edit
    // undo and the cell's own copy/paste take over there).
    if (isEditableTarget(event.target)) return;

    if (key === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    // Whole-variable copy/paste. A focused value cell handles ⌘C/⌘V itself
    // (copies the value) and stops propagation, so we only see the row case here.
    if (key === 'c') {
      if (this.store.selectionIds().length) {
        event.preventDefault();
        this.store.copyVariables();
      }
      return;
    }
    if (key === 'x') {
      if (this.store.selectionIds().length) {
        event.preventDefault();
        this.store.cutVariables();
      }
      return;
    }
    if (key === 'v') {
      if (this.store.hasCopiedVariables()) {
        event.preventDefault();
        void this.store.pasteVariables();
      }
    }
  }
}

/** True when the keystroke target is a text input/editor that owns its own undo. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
