import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectStore } from '../stores/project.store';
import type { MetadataChange, ParsedToken } from '../core/models';
import {
  ALL_SCOPES,
  CODE_SYNTAX_PLATFORMS,
  FIGMA_VENDOR,
  extensionBlock,
  figmaResolvedType,
  isScopeOn,
  scopeAppliesTo,
  scopeOptionsFor,
  servicesFor,
  toggleScope,
  tokenScopes,
  triState,
  unknownVendors,
  type CodeSyntaxPlatform,
  type ExtensionService,
  type FigmaResolvedType,
  type ScopeOption,
  type TriState,
} from '../core/extension-services';

interface ScopeRow {
  option: ScopeOption;
  state: TriState;
  applicable: number;
  disabled: boolean;
}

interface ScopeGroup {
  name: string | null;
  rows: ScopeRow[];
}

interface Section {
  vendor: string;
  label: string;
  icon: 'figma' | null;
  present: number;
  removable: boolean;
}

@Component({
  selector: 'tf-extensions-editor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (section of sections(); track section.vendor) {
      <div class="mb-2 border border-ink-200 rounded overflow-hidden">
        <div
          class="flex items-center gap-2 px-2 py-1.5 bg-ink-50 cursor-pointer hover:bg-ink-100"
          (click)="toggleCollapsed(section.vendor)"
        >
          <svg
            class="w-3.5 h-3.5 shrink-0 text-ink-400 transition-transform"
            [class.rotate-90]="!collapsed()[section.vendor]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          ><path d="m9 18 6-6-6-6" /></svg>
          @if (section.icon === 'figma') {
            <svg class="w-3 h-[18px] shrink-0" viewBox="0 0 38 57" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
              <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
              <path d="M19 0h9.5a9.5 9.5 0 1 1 0 19H19V0z" fill="#FF7262" />
              <path d="M0 9.5A9.5 9.5 0 0 1 9.5 0H19v19H9.5A9.5 9.5 0 0 1 0 9.5z" fill="#F24E1E" />
              <path d="M0 28.5A9.5 9.5 0 0 1 9.5 19H19v19H9.5A9.5 9.5 0 0 1 0 28.5z" fill="#A259FF" />
            </svg>
          } @else {
            <span class="w-3 shrink-0 text-center text-[10px] text-ink-400">{{ '{}' }}</span>
          }
          <span class="flex-1 min-w-0 truncate text-xs font-medium text-ink-700" [title]="section.vendor">
            {{ section.label }}
          </span>
          @if (section.present < tokens().length) {
            <span class="shrink-0 text-[10px] text-ink-400">{{ section.present }}/{{ tokens().length }}</span>
          }
          @if (section.removable) {
            <button
              type="button"
              class="w-5 h-5 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-red-600 hover:bg-red-50"
              [title]="'Remove the ' + section.label + ' extension'"
              (click)="removeService(section, $event)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          }
        </div>

        @if (!collapsed()[section.vendor]) {
          <div class="px-2 py-2">
            @if (section.vendor === FIGMA_VENDOR) {
              <div class="mb-3 rounded bg-ink-50 px-2 py-1.5 space-y-1">
                <div class="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span class="text-ink-400">resolvedType</span>
                  <span class="text-ink-700 truncate">{{ derivedTypeLabel() }}</span>
                </div>
                <div class="text-[10px] text-ink-400">Derived from $type, not editable.</div>
                @if (staleTypeCount() > 0) {
                  <div class="flex items-center justify-between gap-2 text-[11px] text-amber-700">
                    <span class="truncate">
                      {{ staleTypeCount() === 1 ? '1 stored value disagrees' : staleTypeCount() + ' stored values disagree' }}
                    </span>
                    <button type="button" class="underline shrink-0" (click)="fixResolvedType()">Fix</button>
                  </div>
                }
              </div>

              <div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Scopes</div>
              @for (group of scopeGroups(); track group.name) {
                @if (group.name) {
                  <div class="mt-2 mb-1 text-[11px] text-ink-500">{{ group.name }}</div>
                }
                @for (row of group.rows; track row.option.value) {
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 py-1 text-left text-xs rounded px-1 hover:bg-ink-50 disabled:opacity-40 disabled:hover:bg-transparent"
                    [style.padding-left.px]="4 + (row.option.depth ?? 0) * 20"
                    [disabled]="row.disabled"
                    (click)="toggleScopeRow(row)"
                  >
                    <span
                      class="w-4 h-4 shrink-0 rounded border flex items-center justify-center"
                      [class.bg-forge-500]="row.state === 'on'"
                      [class.border-forge-500]="row.state !== 'off'"
                      [class.border-ink-300]="row.state === 'off'"
                    >
                      @if (row.state === 'on') {
                        <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      } @else if (row.state === 'mixed') {
                        <span class="w-2 h-0.5 bg-forge-500 rounded"></span>
                      }
                    </span>
                    <span class="flex-1 min-w-0 truncate text-ink-700">{{ row.option.label }}</span>
                    @if (row.applicable < figmaCount()) {
                      <span class="shrink-0 text-[10px] text-ink-400">{{ row.applicable }}/{{ figmaCount() }}</span>
                    }
                  </button>
                }
              }

              <div class="mt-4 text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Publishing</div>
              <button
                type="button"
                class="w-full flex items-center gap-2 py-1 px-1 text-left text-xs rounded hover:bg-ink-50"
                (click)="toggleHidden()"
              >
                <span
                  class="w-4 h-4 shrink-0 rounded border flex items-center justify-center"
                  [class.bg-forge-500]="hiddenState() === 'on'"
                  [class.border-forge-500]="hiddenState() !== 'off'"
                  [class.border-ink-300]="hiddenState() === 'off'"
                >
                  @if (hiddenState() === 'on') {
                    <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  } @else if (hiddenState() === 'mixed') {
                    <span class="w-2 h-0.5 bg-forge-500 rounded"></span>
                  }
                </span>
                <span class="flex-1 min-w-0 truncate text-ink-700">Hidden from publishing</span>
              </button>

              <div class="mt-4 text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Code syntax</div>
              @for (row of codeSyntaxRows(); track row.platform) {
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="w-16 shrink-0 text-xs text-ink-500">{{ row.platform }}</span>
                  <input
                    class="flex-1 min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forge-500 placeholder:text-ink-300"
                    [placeholder]="row.mixed ? 'Multiple values' : '—'"
                    [ngModel]="codeSyntaxDraft()[row.platform] ?? row.value"
                    (ngModelChange)="setCodeSyntaxDraft(row.platform, $event)"
                    (keyup.enter)="commitCodeSyntax(row.platform)"
                    (blur)="commitCodeSyntax(row.platform)"
                  />
                </div>
              }

              @if (identityRows(); as rows) {
                @if (rows.length) {
                  <div class="mt-4 text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Binding</div>
                  <div class="rounded bg-ink-50 px-2 py-1.5 space-y-0.5">
                    @for (row of rows; track row.key) {
                      <div class="flex items-center justify-between gap-2 text-[11px] font-mono">
                        <span class="text-ink-400">{{ row.key }}</span>
                        <span class="text-ink-700 truncate" [title]="row.value">{{ row.value }}</span>
                      </div>
                    }
                  </div>
                  <div class="mt-1 text-[10px] text-ink-400">Figma binding identity, not editable.</div>
                }
              }
            } @else {
              @for (block of rawBlocks(section.vendor); track block.id) {
                <div class="mb-2 last:mb-0">
                  <div class="text-[11px] font-mono text-ink-400 truncate mb-0.5">{{ block.id }}</div>
                  <pre class="text-[10px] leading-relaxed font-mono text-ink-700 bg-ink-50 rounded px-2 py-1.5 overflow-auto max-h-56 whitespace-pre">{{ block.raw }}</pre>
                </div>
              }
              <div class="mt-1 text-[10px] text-ink-400">No editor for this service yet, read-only.</div>
            }
          </div>
        }
      </div>
    }

    @if (addable().length) {
      @if (sections().length) {
        <div class="mt-3 mb-1.5 text-[11px] uppercase tracking-wide text-ink-400">Add a service</div>
      }
      <div class="flex flex-wrap gap-2">
        @for (item of addable(); track item.vendor) {
          <button
            type="button"
            class="flex items-center gap-2 border border-dashed border-ink-300 rounded px-2.5 py-1.5 hover:border-forge-400 hover:bg-ink-50"
            (click)="addService(item.service)"
          >
            @if (item.service.icon === 'figma') {
              <svg class="w-3 h-[18px] shrink-0" viewBox="0 0 38 57" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
                <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
                <path d="M19 0h9.5a9.5 9.5 0 1 1 0 19H19V0z" fill="#FF7262" />
                <path d="M0 9.5A9.5 9.5 0 0 1 9.5 0H19v19H9.5A9.5 9.5 0 0 1 0 9.5z" fill="#F24E1E" />
                <path d="M0 28.5A9.5 9.5 0 0 1 9.5 19H19v19H9.5A9.5 9.5 0 0 1 0 28.5z" fill="#A259FF" />
              </svg>
            }
            <span class="text-xs text-ink-700">Add {{ item.service.label }}</span>
            @if (item.missing < tokens().length) {
              <span class="text-[10px] text-ink-400">{{ item.missing }}/{{ tokens().length }}</span>
            }
            <span class="text-ink-400 leading-none">+</span>
          </button>
        }
      </div>
    }

    @if (!sections().length && !addable().length) {
      <div class="text-xs text-ink-400">No extension service applies to this selection.</div>
    }
  `,
})
export class ExtensionsEditorComponent {
  private readonly store = inject(ProjectStore);
  readonly tokens = input.required<ParsedToken[]>();
  readonly FIGMA_VENDOR = FIGMA_VENDOR;

  readonly collapsed = signal<Record<string, boolean>>({});
  private readonly drafts = signal<Partial<Record<CodeSyntaxPlatform, string>>>({});

  private readonly availability = computed(() => servicesFor(this.tokens()));

  readonly sections = computed<Section[]>(() => {
    const known = this.availability()
      .filter((a) => a.present > 0)
      .map((a) => ({
        vendor: a.service.vendor,
        label: a.service.label,
        icon: a.service.icon,
        present: a.present,
        removable: true,
      }));
    const raw = unknownVendors(this.tokens()).map((vendor) => ({
      vendor,
      label: vendor,
      icon: null,
      present: this.tokens().filter((t) => extensionBlock(t, vendor) !== null).length,
      removable: false,
    }));
    return [...known, ...raw];
  });

  readonly addable = computed(() =>
    this.availability()
      .filter((a) => a.missing > 0)
      .map((a) => ({ vendor: a.service.vendor, service: a.service, missing: a.missing })),
  );

  private readonly figmaTokens = computed(() =>
    this.tokens().filter((t) => extensionBlock(t, FIGMA_VENDOR) !== null),
  );
  readonly figmaCount = computed(() => this.figmaTokens().length);

  private readonly resolvedTypes = computed<FigmaResolvedType[]>(() => {
    const set = new Set<FigmaResolvedType>();
    for (const t of this.figmaTokens()) {
      const type = figmaResolvedType(t.type);
      if (type) set.add(type);
    }
    return [...set];
  });

  readonly derivedTypeLabel = computed(() => this.resolvedTypes().join(', ') || '—');

  readonly staleTypeCount = computed(
    () =>
      this.figmaTokens().filter((t) => {
        const stored = extensionBlock(t, FIGMA_VENDOR)?.['resolvedType'];
        return stored !== undefined && stored !== figmaResolvedType(t.type);
      }).length,
  );

  readonly scopeGroups = computed<ScopeGroup[]>(() => {
    const tokens = this.figmaTokens();
    const allOn = tokens.length > 0 && tokens.every((t) => tokenScopes(t).includes(ALL_SCOPES));
    const groups: ScopeGroup[] = [];
    for (const option of scopeOptionsFor(this.resolvedTypes())) {
      const applicable = tokens.filter((t) => scopeAppliesTo(option, figmaResolvedType(t.type)));
      const row: ScopeRow = {
        option,
        applicable: applicable.length,
        state: triState(applicable.map((t) => isScopeOn(tokenScopes(t), option.value))),
        disabled: allOn && option.value !== ALL_SCOPES,
      };
      const name = option.group ?? null;
      const last = groups[groups.length - 1];
      if (last && last.name === name) last.rows.push(row);
      else groups.push({ name, rows: [row] });
    }
    return groups;
  });

  readonly hiddenState = computed(() =>
    triState(
      this.figmaTokens().map((t) => extensionBlock(t, FIGMA_VENDOR)?.['hiddenFromPublishing'] === true),
    ),
  );

  readonly codeSyntaxDraft = computed(() => this.drafts());

  readonly codeSyntaxRows = computed(() =>
    CODE_SYNTAX_PLATFORMS.map((platform) => {
      const values = this.figmaTokens().map((t) => this.readCodeSyntax(t)[platform] ?? '');
      const first = values[0] ?? '';
      const mixed = values.some((v) => v !== first);
      return { platform, value: mixed ? '' : first, mixed };
    }),
  );

  readonly identityRows = computed(() => {
    const tokens = this.figmaTokens();
    if (tokens.length !== 1) return [];
    const block = extensionBlock(tokens[0]!, FIGMA_VENDOR);
    if (!block) return [];
    return ['variableId', 'collectionId', 'modeId', 'key']
      .filter((key) => block[key] !== undefined)
      .map((key) => ({ key, value: String(block[key]) }));
  });

  rawBlocks(vendor: string): { id: string; raw: string }[] {
    return this.tokens()
      .filter((t) => extensionBlock(t, vendor) !== null)
      .map((t) => ({ id: t.path.join('.'), raw: JSON.stringify(t.extensions?.[vendor], null, 2) }));
  }

  toggleCollapsed(vendor: string): void {
    this.collapsed.set({ ...this.collapsed(), [vendor]: !this.collapsed()[vendor] });
  }

  async addService(service: ExtensionService): Promise<void> {
    const changes: MetadataChange[] = [];
    for (const token of this.tokens()) {
      if (!service.supports(token) || extensionBlock(token, service.vendor)) continue;
      changes.push({ id: token.id, extensions: { [service.vendor]: service.seed(token) } });
    }
    this.collapsed.set({ ...this.collapsed(), [service.vendor]: false });
    await this.apply(changes, `Added the ${service.label} extension`);
  }

  async removeService(section: Section, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const changes: MetadataChange[] = this.tokens()
      .filter((t) => extensionBlock(t, section.vendor) !== null)
      .map((t) => ({ id: t.id, extensions: { [section.vendor]: null } }));
    await this.apply(changes, `Removed the ${section.label} extension`);
  }

  async toggleScopeRow(row: ScopeRow): Promise<void> {
    const next = row.state !== 'on';
    const value = row.option.value;
    const changes: MetadataChange[] = [];
    for (const token of this.figmaTokens()) {
      if (!scopeAppliesTo(row.option, figmaResolvedType(token.type))) continue;
      const current = tokenScopes(token);
      const scopes = toggleScope(current, value, next);
      if (scopes.length === current.length && scopes.every((s, i) => s === current[i])) continue;
      changes.push({ id: token.id, extensions: { [FIGMA_VENDOR]: { scopes } } });
    }
    await this.apply(changes, `${next ? 'Added' : 'Removed'} ${row.option.label}`);
  }

  async toggleHidden(): Promise<void> {
    const next = this.hiddenState() !== 'on';
    const changes: MetadataChange[] = [];
    for (const token of this.figmaTokens()) {
      const current = extensionBlock(token, FIGMA_VENDOR)?.['hiddenFromPublishing'] === true;
      if (current === next) continue;
      changes.push({
        id: token.id,
        extensions: { [FIGMA_VENDOR]: { hiddenFromPublishing: next } },
      });
    }
    await this.apply(changes, next ? 'Hidden from publishing' : 'Visible when publishing');
  }

  setCodeSyntaxDraft(platform: CodeSyntaxPlatform, value: string): void {
    this.drafts.set({ ...this.drafts(), [platform]: value });
  }

  async commitCodeSyntax(platform: CodeSyntaxPlatform): Promise<void> {
    const draft = this.drafts()[platform];
    if (draft === undefined) return;
    this.drafts.set({ ...this.drafts(), [platform]: undefined });
    const value = draft.trim();
    const changes: MetadataChange[] = [];
    for (const token of this.figmaTokens()) {
      const current = this.readCodeSyntax(token);
      if ((current[platform] ?? '') === value) continue;
      const next: Record<string, string> = { ...current };
      if (value) next[platform] = value;
      else delete next[platform];
      changes.push({
        id: token.id,
        extensions: {
          [FIGMA_VENDOR]: Object.keys(next).length ? { codeSyntax: next } : { codeSyntax: null },
        },
      });
    }
    await this.apply(changes, `Set ${platform} code syntax`);
  }

  async fixResolvedType(): Promise<void> {
    const changes: MetadataChange[] = [];
    for (const token of this.figmaTokens()) {
      const stored = extensionBlock(token, FIGMA_VENDOR)?.['resolvedType'];
      const derived = figmaResolvedType(token.type);
      if (stored === undefined || stored === derived) continue;
      changes.push({ id: token.id, extensions: { [FIGMA_VENDOR]: { resolvedType: derived } } });
    }
    await this.apply(changes, 'Fixed resolvedType');
  }

  private readCodeSyntax(token: ParsedToken): Record<string, string> {
    const raw = extensionBlock(token, FIGMA_VENDOR)?.['codeSyntax'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }

  private async apply(changes: MetadataChange[], verb: string): Promise<void> {
    if (changes.length === 0) return;
    const suffix = changes.length > 1 ? ` on ${changes.length} variables` : '';
    await this.store.updateMetadataBatch(changes, `${verb}${suffix}`);
  }
}
