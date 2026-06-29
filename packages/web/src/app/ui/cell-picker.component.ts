import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../stores/project.store';
import { CellPickerService } from '../core/cell-picker.service';
import { cssColor, effectiveType, formatValue, isAliasValue, typeGlyph, typesCompatible } from '../core/format';
import {
  hsvaToRgba,
  parseColor,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsva,
  type Rgba,
} from '../core/color';
import {
  formatOklch,
  formatP3,
  inP3,
  inSrgb,
  oklchToHex,
  oklchToRgba,
  parseOklch,
  rgbaToOklch,
  type Oklcha,
} from '../core/oklch';
import type { ParsedToken } from '../core/models';

const POPOVER_W = 304;
const POPOVER_H = 380;
/** Slider range for OKLCH chroma; beyond this is unreachable in any display gamut. */
const CHROMA_MAX = 0.4;
const OKLCH_LITERAL = /^(oklch|color)\(/i;

interface LibGroup {
  collection: string;
  group: string;
  tokens: ParsedToken[];
}

/**
 * Figma-style cell picker, anchored to the clicked cell. Two tabs:
 *  - **Custom** (colour only): saturation/value square + hue & alpha sliders +
 *    HEX/RGB inputs + eyedropper.
 *  - **Libraries**: the design-system tokens, filtered by type, to pick an alias.
 */
@Component({
  selector: 'tf-cell-picker',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (t(); as tgt) {
      <div class="fixed inset-0 z-[55]" (pointerdown)="commitAndClose()"></div>
      <div
        class="fixed z-[56] w-[304px] bg-white rounded-xl shadow-2xl border border-ink-200 overflow-hidden text-ink-800"
        [style.left.px]="posX()"
        [style.top.px]="posY()"
        (pointerdown)="$event.stopPropagation()"
      >
        <!-- Tabs -->
        <div class="flex items-center gap-1 px-2 py-1.5 border-b border-ink-100">
          @if (allowColor()) {
            <button
              class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
              [class.bg-ink-100]="tab() === 'custom'"
              [class.text-ink-900]="tab() === 'custom'"
              [class.text-ink-400]="tab() !== 'custom'"
              (click)="tab.set('custom')"
            >Custom</button>
          }
          <button
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
            [class.bg-ink-100]="tab() === 'libraries'"
            [class.text-ink-900]="tab() === 'libraries'"
            [class.text-ink-400]="tab() !== 'libraries'"
            (click)="tab.set('libraries')"
          >Libraries</button>
          <span class="flex-1"></span>
          <button
            class="w-6 h-6 flex items-center justify-center rounded text-ink-400 hover:bg-ink-100"
            (click)="commitAndClose()"
            title="Close"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        @if (tab() === 'custom' && allowColor()) {
          <!-- RGB / OKLCH sub-mode toggle -->
          <div class="px-3 pt-2.5 pb-2.5">
            <div class="inline-flex rounded-md bg-ink-100 p-0.5 text-[11px] font-medium">
              <button
                class="px-2.5 py-1 rounded transition-colors"
                [class.bg-white]="colorMode() === 'rgb'"
                [class.shadow-sm]="colorMode() === 'rgb'"
                [class.text-ink-900]="colorMode() === 'rgb'"
                [class.text-ink-400]="colorMode() !== 'rgb'"
                (click)="setMode('rgb')"
              >RGB</button>
              <button
                class="px-2.5 py-1 rounded transition-colors"
                [class.bg-white]="colorMode() === 'oklch'"
                [class.shadow-sm]="colorMode() === 'oklch'"
                [class.text-ink-900]="colorMode() === 'oklch'"
                [class.text-ink-400]="colorMode() !== 'oklch'"
                (click)="setMode('oklch')"
              >OKLCH</button>
            </div>
          </div>

          @if (colorMode() === 'rgb') {
          <!-- Saturation / value square -->
          <div
            #sv
            class="relative h-44 cursor-crosshair touch-none select-none"
            [style.background]="hueCss()"
            (pointerdown)="svDown($event)"
          >
            <div class="absolute inset-0" style="background:linear-gradient(to right, #fff, rgba(255,255,255,0))"></div>
            <div class="absolute inset-0" style="background:linear-gradient(to top, #000, rgba(0,0,0,0))"></div>
            <div
              class="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow ring-1 ring-black/25 pointer-events-none"
              [style.left.%]="s() * 100"
              [style.top.%]="(1 - v()) * 100"
              [style.background]="hexCss()"
            ></div>
          </div>

          <div class="p-3 flex flex-col gap-3">
            <div class="flex items-center gap-2.5">
              @if (hasEyeDropper) {
                <button
                  class="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100"
                  title="Pick a colour from the screen"
                  (click)="eyedrop()"
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>
                </button>
              }
              <div class="flex-1 flex flex-col gap-2.5">
                <!-- Hue slider -->
                <div
                  #hue
                  class="relative h-3 rounded-full touch-none select-none cursor-pointer"
                  style="background:linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)"
                  (pointerdown)="hueDown($event)"
                >
                  <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="(h() / 360) * 100"></div>
                </div>
                <!-- Alpha slider -->
                <div
                  #alpha
                  class="relative h-3 rounded-full touch-none select-none cursor-pointer checker"
                  (pointerdown)="alphaDown($event)"
                >
                  <div class="absolute inset-0 rounded-full" [style.background]="alphaGradient()"></div>
                  <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="a() * 100"></div>
                </div>
              </div>
            </div>

            <!-- Inputs: format + value + alpha -->
            <div class="flex items-stretch gap-1.5">
              <select
                class="text-xs border border-ink-200 rounded-md px-1.5 bg-white focus:outline-none focus:border-forge-500"
                [ngModel]="format()"
                (ngModelChange)="format.set($event)"
              >
                <option value="hex">HEX</option>
                <option value="rgb">RGB</option>
              </select>
              @if (format() === 'hex') {
                <div class="flex-1 flex items-center border border-ink-200 rounded-md px-2 focus-within:border-forge-500">
                  <span class="text-ink-400 text-xs">#</span>
                  <input
                    class="w-full font-mono text-xs px-1 py-1.5 focus:outline-none uppercase"
                    [ngModel]="hexField()"
                    (change)="onHexInput($any($event.target).value)"
                  />
                </div>
              } @else {
                <input class="w-12 text-center font-mono text-xs border border-ink-200 rounded-md py-1.5 focus:outline-none focus:border-forge-500" [ngModel]="rgb().r" (change)="onRgbInput('r', $any($event.target).value)" />
                <input class="w-12 text-center font-mono text-xs border border-ink-200 rounded-md py-1.5 focus:outline-none focus:border-forge-500" [ngModel]="rgb().g" (change)="onRgbInput('g', $any($event.target).value)" />
                <input class="w-12 text-center font-mono text-xs border border-ink-200 rounded-md py-1.5 focus:outline-none focus:border-forge-500" [ngModel]="rgb().b" (change)="onRgbInput('b', $any($event.target).value)" />
              }
              <div class="w-14 flex items-center border border-ink-200 rounded-md px-1.5 focus-within:border-forge-500">
                <input class="w-full font-mono text-xs py-1.5 focus:outline-none text-right" [ngModel]="alphaPct()" (change)="onAlphaInput($any($event.target).value)" />
                <span class="text-ink-400 text-xs">%</span>
              </div>
            </div>
          </div>
          } @else {
          <!-- OKLCH: preview + gamut, then L · C · H sliders -->
          <div class="px-3 pt-3">
            <div class="relative h-20 rounded-lg border border-black/10 checker overflow-hidden">
              <div class="absolute inset-0" [style.background]="previewCss()"></div>
              <div class="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/85 text-[11px] font-medium shadow-sm">
                <span [class.text-emerald-600]="gamutSrgb()" [class.text-ink-300]="!gamutSrgb()">sRGB {{ gamutSrgb() ? '✓' : '✗' }}</span>
                <span class="text-ink-300">·</span>
                <span [class.text-emerald-600]="gamutP3()" [class.text-ink-300]="!gamutP3()">P3 {{ gamutP3() ? '✓' : '✗' }}</span>
              </div>
            </div>
          </div>

          <div class="p-3 flex flex-col gap-3">
            <!-- Lightness -->
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="uppercase tracking-wide text-ink-400">Lightness</span>
                <span class="font-mono text-ink-600">{{ ol().toFixed(3) }}</span>
              </div>
              <div #okl class="relative h-3 rounded-full touch-none select-none cursor-pointer" [style.background]="lGradient()" (pointerdown)="okLDown($event)">
                <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="ol() * 100"></div>
              </div>
            </div>
            <!-- Chroma -->
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="uppercase tracking-wide text-ink-400">Chroma</span>
                <span class="font-mono text-ink-600">{{ oc().toFixed(3) }}</span>
              </div>
              <div #okc class="relative h-3 rounded-full touch-none select-none cursor-pointer" [style.background]="cGradient()" (pointerdown)="okCDown($event)">
                <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="(oc() / chromaMax) * 100"></div>
              </div>
            </div>
            <!-- Hue -->
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="uppercase tracking-wide text-ink-400">Hue</span>
                <span class="font-mono text-ink-600">{{ ohRounded() }}°</span>
              </div>
              <div #okh class="relative h-3 rounded-full touch-none select-none cursor-pointer" [style.background]="hGradient()" (pointerdown)="okHDown($event)">
                <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="(oh() / 360) * 100"></div>
              </div>
            </div>
            <!-- Alpha (shared slider markup; only one branch is in the DOM) -->
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="uppercase tracking-wide text-ink-400">Alpha</span>
                <span class="font-mono text-ink-600">{{ alphaPct() }}%</span>
              </div>
              <div #alpha class="relative h-3 rounded-full touch-none select-none cursor-pointer checker" (pointerdown)="alphaDown($event)">
                <div class="absolute inset-0 rounded-full" [style.background]="alphaGradient()"></div>
                <div class="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-white border border-ink-300 shadow pointer-events-none" [style.left.%]="a() * 100"></div>
              </div>
            </div>

            <!-- Output format + value string -->
            <div class="flex items-stretch gap-1.5">
              <select
                class="text-xs border border-ink-200 rounded-md px-1.5 bg-white focus:outline-none focus:border-forge-500"
                [ngModel]="oklchFormat()"
                (ngModelChange)="oklchFormat.set($event)"
              >
                <option value="oklch">OKLCH</option>
                <option value="p3">Display P3</option>
                <option value="hex">HEX</option>
              </select>
              <input
                class="flex-1 font-mono text-xs border border-ink-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-forge-500"
                [ngModel]="outputCss()"
                (change)="onOklchText($any($event.target).value)"
              />
            </div>
          </div>
          }
        } @else {
          <!-- Libraries: searchable token list, filtered by type -->
          <div class="p-2 border-b border-ink-100">
            <div class="flex items-center gap-2 border border-ink-200 rounded-md px-2 focus-within:border-forge-500">
              <svg class="w-3.5 h-3.5 text-ink-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
              <input
                #search
                class="w-full text-sm py-1.5 focus:outline-none"
                placeholder="Search"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
              />
            </div>
          </div>
          <div #list class="max-h-72 overflow-auto scrollbar-thin py-1">
            @for (g of libraryGroups(); track g.collection + g.group) {
              <div class="px-3 pt-2 text-[11px] uppercase tracking-wide text-ink-400">{{ g.collection }}</div>
              <div class="px-3 pb-0.5 text-xs font-medium text-ink-500">{{ g.group }}</div>
              @for (tok of g.tokens; track tok.id) {
                <button
                  class="w-full px-3 py-1.5 flex items-center gap-2.5 hover:bg-ink-100 text-left"
                  [class.bg-forge-50]="tok.id === selectedAliasId()"
                  [class.text-forge-700]="tok.id === selectedAliasId()"
                  [attr.data-tokid]="tok.id"
                  (click)="pickAlias(tok)"
                >
                  @if (swatchOf(tok); as sw) {
                    <span class="w-4 h-4 rounded-[4px] border border-black/10 shrink-0 checker">
                      <span class="block w-full h-full rounded-[4px]" [style.background]="sw"></span>
                    </span>
                  } @else {
                    <span class="w-4 text-center text-ink-400 shrink-0 text-xs">{{ glyph(tok) }}</span>
                  }
                  <span class="text-sm truncate flex-1">{{ leaf(tok) }}</span>
                  <span class="font-mono text-[11px] text-ink-400 shrink-0 max-w-[40%] truncate">{{ valueOf(tok) }}</span>
                </button>
              }
            }
            @if (libraryGroups().length === 0) {
              <div class="px-4 py-6 text-center text-sm text-ink-400">No matching tokens.</div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class CellPickerComponent {
  private readonly store = inject(ProjectStore);
  private readonly picker = inject(CellPickerService);
  readonly t = this.picker.target;

  readonly tab = signal<'custom' | 'libraries'>('libraries');
  readonly format = signal<'hex' | 'rgb'>('hex');
  readonly query = signal('');

  // ---- Working HSVA colour ----
  readonly h = signal(0);
  readonly s = signal(0);
  readonly v = signal(0);
  readonly a = signal(1);

  // ---- Working OKLCH colour (RGB sub-mode shares the alpha signal `a`) ----
  readonly colorMode = signal<'rgb' | 'oklch'>('rgb');
  readonly oklchFormat = signal<'oklch' | 'p3' | 'hex'>('oklch');
  readonly ol = signal(0); // lightness 0–1
  readonly oc = signal(0); // chroma 0–CHROMA_MAX
  readonly oh = signal(0); // hue 0–360
  readonly chromaMax = CHROMA_MAX;

  readonly hasEyeDropper = typeof (window as { EyeDropper?: unknown }).EyeDropper === 'function';

  private readonly sv = viewChild<ElementRef<HTMLElement>>('sv');
  private readonly hueEl = viewChild<ElementRef<HTMLElement>>('hue');
  private readonly alphaEl = viewChild<ElementRef<HTMLElement>>('alpha');
  private readonly oklEl = viewChild<ElementRef<HTMLElement>>('okl');
  private readonly okcEl = viewChild<ElementRef<HTMLElement>>('okc');
  private readonly okhEl = viewChild<ElementRef<HTMLElement>>('okh');
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  /** Id of the token the cell currently aliases (to highlight + scroll to it). */
  readonly selectedAliasId = computed(() => {
    const t = this.t();
    if (!t || !isAliasValue(t.raw)) return null;
    return this.store.aliasTargetToken(t.raw)?.id ?? null;
  });
  /** Guard so we scroll to the current alias only once per open, not on each keystroke. */
  private scrolledFor: unknown = null;

  /** Effective type of the edited cell — inferred from its value when the
   * declared `$type` is unknown (e.g. the cell currently holds an alias). */
  readonly effType = computed(() => {
    const t = this.t();
    return t ? effectiveType(t.type, t.resolved, t.raw) : 'unknown';
  });
  readonly allowColor = computed(() => this.effType() === 'color');

  constructor() {
    // Seed state each time the picker opens.
    effect(() => {
      const tgt = this.t();
      if (!tgt) return;
      this.scrolledFor = null; // a fresh open should re-scroll to its alias
      const isColor = effectiveType(tgt.type, tgt.resolved, tgt.raw) === 'color';
      this.tab.set(tgt.tab === 'custom' && isColor ? 'custom' : 'libraries');
      this.query.set('');
      const rgba = parseColor(tgt.resolved) ?? parseColor(tgt.raw);
      if (rgba) {
        const hsva = rgbaToHsva(rgba);
        this.h.set(hsva.h);
        this.s.set(hsva.s);
        this.v.set(hsva.v);
        this.a.set(hsva.a);
      }
      // Seed OKLCH from the original string when possible (preserves wide-gamut
      // values the canvas-based parse would clamp), else from the RGBA above.
      const okl = parseOklch(tgt.resolved) ?? parseOklch(tgt.raw) ?? (rgba ? rgbaToOklch(rgba) : null);
      if (okl) {
        this.ol.set(okl.l);
        this.oc.set(okl.c);
        this.oh.set(okl.h);
      }
      // Open in OKLCH when the literal is already authored in oklch()/color().
      const litStr = typeof tgt.raw === 'string' ? tgt.raw.trim() : '';
      this.colorMode.set(OKLCH_LITERAL.test(litStr) ? 'oklch' : 'rgb');
      if (tgt.tab === 'libraries') queueMicrotask(() => this.searchEl()?.nativeElement.focus());
    });

    // On open, scroll the Libraries list to the currently-linked token (once),
    // so re-linking starts at the current alias instead of the top of the list.
    effect(() => {
      const t = this.t();
      const groups = this.libraryGroups(); // track render
      const sel = this.selectedAliasId();
      if (!t || this.tab() !== 'libraries' || !sel || groups.length === 0) return;
      if (this.scrolledFor === t) return;
      this.scrolledFor = t;
      queueMicrotask(() => {
        const host = this.listEl()?.nativeElement;
        const el = host?.querySelector<HTMLElement>(`[data-tokid="${sel}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
      });
    });
  }

  // ---- Positioning (clamped to the viewport) ----
  posX(): number {
    const t = this.t();
    if (!t) return 0;
    return Math.max(8, Math.min(t.anchor.x, window.innerWidth - POPOVER_W - 8));
  }
  posY(): number {
    const t = this.t();
    if (!t) return 0;
    const below = t.anchor.y + t.anchor.height + 4;
    if (below + POPOVER_H <= window.innerHeight) return below;
    return Math.max(8, t.anchor.y - POPOVER_H - 4); // flip above if no room below
  }

  // ---- Derived colour values ----
  rgba(): Rgba {
    return hsvaToRgba({ h: this.h(), s: this.s(), v: this.v(), a: this.a() });
  }
  rgb(): { r: number; g: number; b: number } {
    const c = this.rgba();
    return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
  }
  hexCss(): string {
    return rgbaToHex({ ...this.rgba(), a: 1 });
  }
  hueCss(): string {
    return `hsl(${this.h()}, 100%, 50%)`;
  }
  alphaGradient(): string {
    const c = this.rgb();
    return `linear-gradient(to right, rgba(${c.r},${c.g},${c.b},0), rgb(${c.r},${c.g},${c.b}))`;
  }
  hexField(): string {
    return rgbaToHex({ ...this.rgba(), a: 1 }).slice(1).toUpperCase();
  }
  alphaPct(): number {
    return Math.round(this.a() * 100);
  }

  // ---- Pointer drags ----
  private drag(el: HTMLElement | undefined, onMove: (x: number, y: number, rect: DOMRect) => void, e: PointerEvent): void {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const apply = (ev: PointerEvent) => onMove(ev.clientX, ev.clientY, rect);
    apply(e);
    this.preview();
    const move = (ev: PointerEvent) => {
      apply(ev);
      this.preview();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.commit();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
  svDown(e: PointerEvent): void {
    this.drag(this.sv()?.nativeElement, (x, y, r) => {
      this.s.set(clamp01((x - r.left) / r.width));
      this.v.set(clamp01(1 - (y - r.top) / r.height));
    }, e);
  }
  hueDown(e: PointerEvent): void {
    this.drag(this.hueEl()?.nativeElement, (x, _y, r) => {
      this.h.set(clamp01((x - r.left) / r.width) * 360);
    }, e);
  }
  alphaDown(e: PointerEvent): void {
    this.drag(this.alphaEl()?.nativeElement, (x, _y, r) => {
      this.a.set(clamp01((x - r.left) / r.width));
    }, e);
  }

  // ---- Inputs ----
  onHexInput(value: string): void {
    const rgba = parseColor(value.startsWith('#') ? value : '#' + value);
    if (!rgba) return;
    const hsva = rgbaToHsva({ ...rgba, a: this.a() });
    this.h.set(hsva.h);
    this.s.set(hsva.s);
    this.v.set(hsva.v);
    this.commit();
  }
  onRgbInput(channel: 'r' | 'g' | 'b', value: string): void {
    const n = Math.max(0, Math.min(255, Number(value) || 0));
    const c = this.rgb();
    const hsva = rgbaToHsva({ ...c, [channel]: n, a: this.a() } as Rgba);
    this.h.set(hsva.h);
    this.s.set(hsva.s);
    this.v.set(hsva.v);
    this.commit();
  }
  onAlphaInput(value: string): void {
    this.a.set(clamp01((Number(value) || 0) / 100));
    this.commit();
  }

  async eyedrop(): Promise<void> {
    const EyeDropper = (window as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) return;
    try {
      const res = await new EyeDropper().open();
      this.onHexInput(res.sRGBHex);
    } catch {
      /* user cancelled */
    }
  }

  // ---- OKLCH sub-mode ----
  oklcha(): Oklcha {
    return { l: this.ol(), c: this.oc(), h: this.oh(), a: this.a() };
  }
  /** The string written to the token, per the active mode + output format. */
  outputCss(): string {
    if (this.colorMode() !== 'oklch') return rgbaToCss(this.rgba());
    const o = this.oklcha();
    switch (this.oklchFormat()) {
      case 'p3':
        return formatP3(o);
      case 'hex':
        return oklchToHex(o);
      default:
        return formatOklch(o);
    }
  }
  /** Switch sub-mode, converting the current colour so it stays put. */
  setMode(mode: 'rgb' | 'oklch'): void {
    if (mode === this.colorMode()) return;
    if (mode === 'oklch') {
      const o = rgbaToOklch(this.rgba());
      this.ol.set(o.l);
      this.oc.set(o.c);
      this.oh.set(o.h);
    } else {
      const hsva = rgbaToHsva(oklchToRgba(this.oklcha()));
      this.h.set(hsva.h);
      this.s.set(hsva.s);
      this.v.set(hsva.v);
    }
    this.colorMode.set(mode);
  }

  ohRounded(): number {
    return Math.round(this.oh());
  }
  gamutSrgb(): boolean {
    return inSrgb(this.oklcha());
  }
  gamutP3(): boolean {
    return inP3(this.oklcha());
  }
  /** Swatch shows the true (possibly wide-gamut) colour on capable displays. */
  previewCss(): string {
    return formatOklch(this.oklcha());
  }
  lGradient(): string {
    const c = this.oc();
    const h = this.oh();
    return `linear-gradient(to right, oklch(0 ${c} ${h}), oklch(0.5 ${c} ${h}), oklch(1 ${c} ${h}))`;
  }
  cGradient(): string {
    const l = this.ol();
    const h = this.oh();
    return `linear-gradient(to right, oklch(${l} 0 ${h}), oklch(${l} ${CHROMA_MAX} ${h}))`;
  }
  hGradient(): string {
    const l = this.ol() || 0.7;
    const c = this.oc() || 0.15; // keep the rail colourful even at chroma 0
    const stops: string[] = [];
    for (let i = 0; i <= 6; i++) stops.push(`oklch(${l} ${c} ${i * 60}) ${Math.round((i / 6) * 100)}%`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }
  okLDown(e: PointerEvent): void {
    this.drag(this.oklEl()?.nativeElement, (x, _y, r) => this.ol.set(clamp01((x - r.left) / r.width)), e);
  }
  okCDown(e: PointerEvent): void {
    this.drag(this.okcEl()?.nativeElement, (x, _y, r) => this.oc.set(clamp01((x - r.left) / r.width) * CHROMA_MAX), e);
  }
  okHDown(e: PointerEvent): void {
    this.drag(this.okhEl()?.nativeElement, (x, _y, r) => this.oh.set(clamp01((x - r.left) / r.width) * 360), e);
  }
  onOklchText(value: string): void {
    const o = parseOklch(value);
    if (!o) return;
    this.ol.set(o.l);
    this.oc.set(o.c);
    this.oh.set(o.h);
    this.a.set(o.a);
    this.commit();
  }

  /** Optimistic preview (no flush) while dragging. Skipped in sub-field mode. */
  private preview(): void {
    const t = this.t();
    if (t && !t.onPick) this.store.previewValue(t.tokenId, t.mode, this.outputCss());
  }
  /** Persist the current colour (or hand it to `onPick` in sub-field mode). */
  private commit(): void {
    const t = this.t();
    if (!t) return;
    const css = this.outputCss();
    if (t.onPick) t.onPick(css);
    else void this.store.updateValue(t.tokenId, t.mode, css);
  }
  commitAndClose(): void {
    this.picker.close();
  }

  // ---- Libraries (token alias) ----
  readonly libraryGroups = computed<LibGroup[]>(() => {
    const t = this.t();
    if (!t) return [];
    const q = this.query().trim().toLowerCase();
    const want = this.effType();
    const groups = new Map<string, LibGroup>();
    for (const tok of this.store.globalTokens()) {
      if (tok.id === t.tokenId) continue;
      const candResolved = tok.resolvedValuesByMode[t.mode] ?? Object.values(tok.resolvedValuesByMode)[0];
      if (!typesCompatible(want, effectiveType(tok.type, candResolved, tok.rawValuesByMode[t.mode]))) continue;
      if (q && !tok.path.join('.').toLowerCase().includes(q)) continue;
      const group = tok.path.slice(0, -1).join(' / ') || '(root)';
      const key = tok.collection + '›' + group;
      let g = groups.get(key);
      if (!g) {
        g = { collection: tok.collection, group, tokens: [] };
        groups.set(key, g);
      }
      g.tokens.push(tok);
    }
    return [...groups.values()].slice(0, 40);
  });

  leaf(tok: ParsedToken): string {
    return tok.path[tok.path.length - 1] ?? '';
  }
  glyph(tok: ParsedToken): string {
    return typeGlyph(tok.type);
  }
  swatchOf(tok: ParsedToken): string | null {
    const t = this.t();
    const resolved = (t ? tok.resolvedValuesByMode[t.mode] : undefined) ?? Object.values(tok.resolvedValuesByMode)[0];
    // Effective type — the token may itself be an alias (declared type unknown),
    // so infer "color" from its resolved value to show the swatch.
    return effectiveType(tok.type, resolved) === 'color' ? cssColor(resolved) : null;
  }
  valueOf(tok: ParsedToken): string {
    const t = this.t();
    const resolved = (t ? tok.resolvedValuesByMode[t.mode] : undefined) ?? Object.values(tok.resolvedValuesByMode)[0];
    return formatValue(resolved, tok.type);
  }
  pickAlias(tok: ParsedToken): void {
    const t = this.t();
    if (!t) return;
    this.picker.close();
    const alias = `{${tok.path.join('.')}}`;
    if (t.onPick) t.onPick(alias);
    else void this.store.updateValue(t.tokenId, t.mode, alias);
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
