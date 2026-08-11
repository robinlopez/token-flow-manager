import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** One companion tool advertised in the panel. */
interface Tool {
  kind: 'forge' | 'flow';
  eyebrow: string;
  name: string;
  description: string;
  url: string;
  /** Banner in `public/tools/`. Falls back to a drawn tile when absent. */
  banner: string;
}

const TOOLS: Tool[] = [
  {
    kind: 'forge',
    eyebrow: 'Figma Plugin',
    name: 'Token Forge',
    description:
      'Token Forge turns your Figma variables into production-ready design tokens. Export, ' +
      'import, and sync your tokens with code, GitHub, GitLab, or Google Sheets while ' +
      'preserving aliases, collections, and modes.',
    url: 'https://www.figma.com/community/plugin/1566133735926608173/token-forge-variables-tokens-builder',
    banner: 'tools/plugin-token-forge.webp',
  },
  {
    kind: 'flow',
    eyebrow: 'IDE Plugin',
    name: 'Token Flow',
    description:
      'Token Flow helps you find the right variable and keep your styles flawless without ' +
      'ever leaving your IDE. (compatible VS Code and JetBrains tools)',
    url: 'https://marketplace.visualstudio.com/items?itemName=robin-lopez.token-flow-vscode',
    banner: 'tools/token-flow.webp',
  },
];

/**
 * Floating "Discover tools" button on the welcome screen, promoting the two
 * companion plugins.
 *
 * Deliberately out of the way: it sits over the background, never in the flow of
 * the two cards, and opens a panel only on click. Each card carries the tool's own
 * banner from `public/tools/` (downscaled to roughly twice its display width, so
 * the published package pays ~44 kB rather than the 100 kB of the full exports),
 * and falls back to a drawn tile if the asset ever goes missing.
 */
@Component({
  selector: 'tf-tools-promo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  styles: [
    `
      /* Token Forge: the plugin's dark violet brand gradient. */
      .thumb-forge {
        background:
          radial-gradient(120% 120% at 85% 15%, #a855f7 0%, transparent 55%),
          radial-gradient(90% 90% at 10% 90%, #6d28d9 0%, transparent 60%),
          linear-gradient(135deg, #0b1020 0%, #17123a 100%);
      }
      /* Token Flow: the IDE plugin's warm paper background with a faint grid. */
      .thumb-flow {
        background-color: #f7f1e8;
        background-image:
          linear-gradient(to right, rgba(28, 25, 23, 0.06) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(28, 25, 23, 0.06) 1px, transparent 1px);
        background-size: 18px 18px;
      }
      .panel {
        animation: promo-in 0.16s ease-out;
      }
      @keyframes promo-in {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
    `,
  ],
  template: `
    <div class="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
      @if (open()) {
        <div
          class="panel w-[42rem] max-w-[calc(100vw-2.5rem)] max-h-[calc(100vh-6rem)] overflow-auto scrollbar-thin bg-white border border-ink-200 rounded-xl shadow-2xl"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-ink-100">
            @for (t of tools; track t.kind) {
              <div class="p-4 flex flex-col gap-3">
                <!-- Brand banner from public/tools/. The drawn tile behind it is the
                     fallback, so a missing asset degrades instead of showing a
                     broken image. object-left keeps the logo and wordmark, which
                     sit on the left of both banners, whatever the crop. -->
                <div
                  class="relative aspect-[16/10] rounded-lg overflow-hidden flex items-center justify-center gap-2.5 px-4"
                  [class.thumb-forge]="t.kind === 'forge'"
                  [class.thumb-flow]="t.kind === 'flow'"
                >
                  @if (!missing().has(t.kind)) {
                    <!-- No loading="lazy": the panel is only rendered once opened, so
                         the images are already deferred. Marking them lazy on top of
                         that leaves them at 0x0 forever, since inserting a fixed
                         panel fires no scroll event for the observer to react to. -->
                    <img
                      class="absolute inset-0 w-full h-full object-cover object-left"
                      [src]="t.banner"
                      [alt]="t.name"
                      (error)="markMissing(t.kind)"
                    />
                  } @else if (t.kind === 'forge') {
                    <!-- Rounded-square app icon with the { } braces mark -->
                    <svg class="w-11 h-11 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                      <defs>
                        <linearGradient id="tfp-forge" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stop-color="#C084FC" />
                          <stop offset="100%" stop-color="#7C3AED" />
                        </linearGradient>
                      </defs>
                      <rect width="48" height="48" rx="13" fill="url(#tfp-forge)" />
                      <g
                        stroke="#FFFFFF"
                        stroke-width="2.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        fill="none"
                      >
                        <path d="M19 13c-4 0-4 8-7 11 3 3 3 11 7 11" />
                        <path d="M29 13c4 0 4 8 7 11-3 3-3 11-7 11" />
                        <path d="M20.5 20h7M20.5 24h7M20.5 28h7" />
                      </g>
                    </svg>
                    <span class="text-white text-lg font-semibold tracking-tight">TokenForge</span>
                  } @else {
                    <!-- The dashboard's own mark: same brand as this app -->
                    <img src="logo.svg" alt="" class="w-11 h-11 shrink-0 rounded-lg" />
                    <span class="text-ink-900 text-lg font-semibold tracking-tight">Token Flow</span>
                  }
                </div>

                <div>
                  <div class="text-[11px] uppercase tracking-wide text-ink-400">{{ t.eyebrow }}</div>
                  <div class="text-sm font-semibold text-ink-900">{{ t.name }}</div>
                </div>
                <p class="text-xs text-ink-500 leading-relaxed flex-1">{{ t.description }}</p>

                <!-- The link opens the listing where the plugin is installed and
                     used, so it is not labelled as a download. -->
                <a
                  class="self-end inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-ink-200 text-ink-800 hover:bg-ink-50"
                  [href]="t.url"
                  [title]="'Open ' + t.name + ' in a new tab'"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Use the tool
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <path d="M15 3h6v6M10 14 21 3" />
                  </svg>
                </a>
              </div>
            }
          </div>
        </div>
      }

      <button
        class="shrink-0 inline-flex items-center gap-2 text-sm font-medium pl-4 pr-3.5 py-2.5 rounded-lg bg-ink-950 text-white shadow-lg hover:bg-ink-800"
        [attr.aria-expanded]="open()"
        (click)="open.update((v) => !v)"
      >
        Discover tools
        @if (open()) {
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        } @else {
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        }
      </button>
    </div>
  `,
})
export class ToolsPromoComponent {
  readonly tools = TOOLS;
  readonly open = signal(false);
  /** Banners that failed to load, so their card falls back to a drawn tile. */
  readonly missing = signal<ReadonlySet<Tool['kind']>>(new Set());

  markMissing(kind: Tool['kind']): void {
    this.missing.update((s) => new Set(s).add(kind));
  }

  /** Click anywhere outside the button or the panel closes it. */
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if ((event.target as HTMLElement | null)?.closest('tf-tools-promo')) return;
    this.open.set(false);
  }
}
