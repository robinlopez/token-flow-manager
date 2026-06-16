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
import {
  CdkDrag,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDropList,
  moveItemInArray,
  type CdkDragDrop,
  type CdkDragEnter,
  type CdkDragStart,
} from '@angular/cdk/drag-drop';
import { ProjectStore } from '../../stores/project.store';
import { GroupDropRegistry } from '../sidebar/group-drop-registry';
import { ContextMenuService } from '../../core/context-menu.service';
import { CellPickerService } from '../../core/cell-picker.service';
import { UiService } from '../../core/ui.service';
import { ValueCellComponent } from '../../ui/value-cell.component';
import {
  compositeFieldType,
  cssColor,
  effectiveType,
  formatValue,
  isAliasValue,
  isMetricType,
  typeGlyph,
  typesCompatible,
} from '../../core/format';
import type { DtcgType, GroupNode, ParsedToken } from '../../core/models';

function isGroupNode(data: unknown): data is GroupNode {
  return !!data && typeof data === 'object' && 'children' in data && 'path' in data;
}
function isToken(data: unknown): data is ParsedToken {
  return !!data && typeof data === 'object' && 'rawValuesByMode' in data;
}

interface Section {
  /** Stable key for the parent path. */
  key: string;
  /** Full parent path of the tokens in this section (Figma-style breadcrumb). */
  parentPath: string[];
  tokens: ParsedToken[];
}

interface EditCoord {
  row: number;
  mode: number;
}

interface AliasSuggestion {
  alias: string;
  label: string;
  glyph: string;
  swatch: string | null;
  preview: string;
}

/** DTCG composite types that get a structured sub-property editor. */
const COMPOSITE_TYPES = new Set(['typography', 'shadow', 'border', 'gradient', 'transition']);

@Component({
  selector: 'tf-variables-table',
  standalone: true,
  imports: [
    ValueCellComponent,
    FormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragPreview,
    CdkDragPlaceholder,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative flex flex-col h-full bg-white">
      <!-- Table head — clipped; its horizontal scroll mirrors the body's so the
           columns stay aligned while the body scrolls (resizable columns). -->
      <div #head class="shrink-0 overflow-hidden bg-ink-50 border-b border-ink-200">
        <div class="flex items-stretch min-w-full w-max text-[11px] uppercase tracking-wide text-ink-500 font-medium">
          <div class="relative shrink-0 px-4 py-2" [style.width.px]="nameW()">
            Name
            <div
              class="absolute top-0 right-0 h-full w-1.5 -mr-px cursor-col-resize hover:bg-forge-300/60 z-10"
              title="Drag to resize · double-click to reset"
              (pointerdown)="startColResize($event, 'name')"
              (dblclick)="ui.setNameColWidth(280)"
            ></div>
          </div>
          @for (mode of modes(); track mode.id; let last = $last) {
            <div class="relative shrink-0 px-4 py-2 border-l border-ink-200" [style.width.px]="modeW(mode.id)">
              @if (renamingModeId() === mode.id) {
                <input
                  #modeRenameInput
                  class="w-full bg-white border border-forge-500 rounded px-1 py-0.5 text-[11px] normal-case tracking-normal focus:outline-none"
                  [ngModel]="renameModeText()"
                  (ngModelChange)="renameModeText.set($event)"
                  (keydown)="onRenameModeKeydown($event, mode.id)"
                  (blur)="commitRenameMode(mode.id)"
                />
              } @else {
                <span
                  tabindex="0"
                  class="inline-block cursor-pointer select-none outline-none rounded px-1 -mx-1 ring-forge-400"
                  [class.bg-forge-100]="selectedModeId() === mode.id"
                  [class.text-forge-700]="selectedModeId() === mode.id"
                  [class.ring-1]="selectedModeId() === mode.id"
                  title="Click to select · double-click to rename · Delete to remove · right-click for options"
                  (click)="selectMode(mode.id)"
                  (dblclick)="startRenameMode(mode.id)"
                  (contextmenu)="onModeContextMenu($event, mode.id)"
                  (keydown)="onModeHeaderKeydown($event, mode.id)"
                  >{{ mode.label || mode.id }}</span
                >
              }
              <!-- Resize handle. For the LAST mode it does NOT overhang (no -mr-px)
                   so it never reaches into the pinned action column to its right. -->
              <div
                class="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-forge-300/60 z-10"
                [class.-mr-px]="!last"
                title="Drag to resize · double-click to reset"
                (pointerdown)="startColResize($event, 'mode', mode.id)"
                (dblclick)="ui.setModeColWidth(mode.id, 224)"
              ></div>
            </div>
          }
          <!-- Flexible spacer fills any width left over so the pinned action
               column sits flush at the right edge (no gap) when columns are narrow. -->
          <div class="flex-1 min-w-0"></div>
          <!-- Action column: pinned to the right (always visible) + non-resizable.
               Click to add a new mode (column). -->
          <button
            type="button"
            class="shrink-0 w-10 border-l border-ink-200 sticky right-0 bg-ink-50 z-30 text-ink-400 hover:text-forge-600 hover:bg-ink-100 flex items-center justify-center"
            title="Add a mode"
            (click)="startAddMode()"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Add-mode popover (anchored under the + action column). -->
      @if (addingMode(); as add) {
        <div class="absolute right-2 top-9 z-50 w-64 rounded-md border border-ink-200 bg-white shadow-lg p-3 text-sm" (keydown.escape)="cancelAddMode()">
          <div class="font-medium text-ink-800 mb-2">Add a mode</div>
          <label class="block text-[11px] uppercase tracking-wide text-ink-500 mb-1">Name</label>
          <input
            #addModeInput
            class="w-full border border-ink-300 rounded px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-forge-400"
            placeholder="e.g. dark, brandB, themeFour"
            [ngModel]="add.name"
            (ngModelChange)="setAddModeName($event)"
            (keydown.enter)="confirmAddMode()"
          />
          @if (modes().length) {
            <label class="block text-[11px] uppercase tracking-wide text-ink-500 mb-1">Copy values from</label>
            <select
              class="w-full border border-ink-300 rounded px-2 py-1 mb-3 bg-white focus:outline-none focus:ring-1 focus:ring-forge-400"
              [ngModel]="add.from"
              (ngModelChange)="setAddModeFrom($event)"
            >
              @for (m of modes(); track m.id) {
                <option [value]="m.id">{{ m.label || m.id }}</option>
              }
            </select>
          } @else {
            <p class="text-[11px] text-ink-400 mb-3">This collection has a single mode; adding one converts it to multi-mode (values copied).</p>
          }
          <div class="flex justify-end gap-2">
            <button type="button" class="px-2 py-1 rounded text-ink-500 hover:bg-ink-100" (click)="cancelAddMode()">Cancel</button>
            <button type="button" class="px-2 py-1 rounded bg-forge-600 text-white hover:bg-forge-700 disabled:opacity-40" [disabled]="!add.name.trim()" (click)="confirmAddMode()">Add mode</button>
          </div>
        </div>
      }

      <!-- Body -->
      <div #body class="flex-1 overflow-auto scrollbar-thin" (scroll)="head.scrollLeft = body.scrollLeft">
        @for (g of grouped(); track g.key) {
          <div
            class="group/header sticky top-0 z-[5] flex items-center px-4 py-1.5 bg-ink-50/95 backdrop-blur border-y border-ink-100 text-xs text-ink-500"
            [style.minWidth]="fillMinWidth()"
          >
            @if (renamingSectionKey() === g.key) {
              <input
                #sectionRenameInput
                class="bg-white border border-forge-500 rounded px-1.5 py-0.5 text-xs text-ink-800 focus:outline-none"
                [placeholder]="g.parentPath.length ? '' : 'group name'"
                [ngModel]="renameSectionText()"
                (ngModelChange)="renameSectionText.set($event)"
                (keydown)="onRenameSectionKeydown($event, g)"
                (blur)="commitRenameSection(g)"
              />
            } @else {
              <span
                class="cursor-text select-none"
                [title]="g.parentPath.length ? 'Double-click to rename this group' : 'Double-click to put these variables in a named group'"
                (dblclick)="startRenameSection(g)"
              >
                @if (g.parentPath.length) {
                  @for (seg of g.parentPath; track $index; let last = $last) {
                    @if (!last) {
                      <span>{{ seg }}</span><span class="mx-1 text-ink-300">/</span>
                    } @else {
                      <span class="font-semibold text-ink-800">{{ seg }}</span>
                    }
                  }
                } @else {
                  <span class="italic text-ink-400">Ungrouped</span>
                }
              </span>
            }
            <span class="ml-2 text-ink-400">{{ g.tokens.length }}</span>
            <!-- Add a variable to THIS group (type inferred from its rows). -->
            <button
              type="button"
              class="ml-1.5 w-5 h-5 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100 opacity-0 group-hover/header:opacity-100 focus:opacity-100"
              title="Add a variable to this group"
              (click)="createInGroup(g)"
            >
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <!-- Rename this group (or, for ungrouped, name a new group). -->
            <button
              type="button"
              class="w-5 h-5 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100 opacity-0 group-hover/header:opacity-100 focus:opacity-100"
              [title]="g.parentPath.length ? 'Rename group' : 'Move these variables into a named group'"
              (click)="startRenameSection(g)"
            >
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>

          <div
            cdkDropList
            [id]="'sec-' + g.key"
            [cdkDropListData]="g"
            [cdkDropListConnectedTo]="connectedTo()"
            [cdkDropListEnterPredicate]="acceptsToken"
            class="transition-colors"
            [class.bg-forge-50]="isDropTarget(g)"
            [class.ring-2]="isDropTarget(g)"
            [class.ring-inset]="isDropTarget(g)"
            [class.ring-forge-400]="isDropTarget(g)"
            (cdkDropListEntered)="onEntered($event)"
            (cdkDropListExited)="registry.leave('sec-' + g.key)"
            (cdkDropListDropped)="drop($event)"
          >
            @for (token of g.tokens; track token.id) {
              <div
                cdkDrag
                [cdkDragData]="token"
                [attr.data-token-id]="token.id"
                (cdkDragStarted)="onDragStart(token, $event)"
                (cdkDragMoved)="registry.track($event.pointerPosition, 'token')"
                (cdkDragEnded)="registry.clear()"
                (contextmenu)="onContextMenu(token, $event)"
                class="tf-row relative flex items-stretch border-b border-ink-100 group"
                [style.minWidth]="fillMinWidth()"
                [class.bg-white]="!isSelected(token)"
                [class.hover:bg-ink-50]="!isSelected(token)"
                [class.bg-forge-100]="isSelected(token)"
                [class.ring-1]="isFocused(token)"
                [class.ring-inset]="isFocused(token)"
                [class.ring-forge-400]="isFocused(token)"
              >
                <!-- selection accent bar (clearer than a faint ring) -->
                @if (isSelected(token)) {
                  <span class="absolute left-0 top-0 bottom-0 w-0.5 bg-forge-500"></span>
                }
                <!-- floating preview under the cursor -->
                <div
                  *cdkDragPreview
                  class="px-3 py-1.5 bg-ink-900 text-white text-xs rounded-md shadow-xl font-medium"
                >
                  {{ dragBadge(token) }}
                </div>

                <!-- Figma-style insertion line at the drop position. Its height is
                     measured from the dragged row at drag start so CDK's swap
                     geometry stays accurate when dragging downward (rows vary with
                     the mode count). -->
                <div
                  *cdkDragPlaceholder
                  class="flex items-center gap-1.5 px-3 border-b border-ink-100"
                  [style.height.px]="placeholderHeight()"
                >
                  <span class="w-2 h-2 rounded-full bg-forge-500 shrink-0"></span>
                  <span class="flex-1 h-0.5 bg-forge-500 rounded-full"></span>
                </div>

                <div class="shrink-0 px-2 py-2 flex items-center gap-1.5" [style.width.px]="nameW()">
                  <span
                    class="w-4 text-ink-300 opacity-0 group-hover:opacity-100 shrink-0 text-center select-none cursor-grab active:cursor-grabbing"
                    title="Drag to reorder or move"
                    >⠿</span
                  >
                  @if (isRenaming(token)) {
                    <input
                      #renameInput
                      class="flex-1 min-w-0 text-sm bg-white border border-forge-500 rounded px-1.5 py-0.5 focus:outline-none"
                      [ngModel]="renameText()"
                      (ngModelChange)="renameText.set($event)"
                      (keydown)="onRenameKeydown($event, token)"
                      (blur)="commitRename(token)"
                      (click)="$event.stopPropagation()"
                    />
                  } @else {
                    <div
                      class="flex items-center gap-2 flex-1 min-w-0"
                      (click)="onNameClick(token, $event)"
                      (dblclick)="startRename(token); $event.stopPropagation()"
                      title="Double-click to rename"
                    >
                      <span
                        class="w-4 text-center text-ink-400"
                        [class.text-red-500]="hasError(token)"
                        >{{ glyph(token) }}</span
                      >
                      <span class="text-sm text-ink-900 truncate">{{ leaf(token) }}</span>
                      @if (token.deprecated) {
                        <span
                          class="text-[10px] uppercase text-ink-400 border border-ink-200 rounded px-1"
                          >deprecated</span
                        >
                      }
                      @if (hasError(token)) {
                        <span class="w-1.5 h-1.5 rounded-full bg-red-500" title="Has diagnostics"></span>
                      }
                    </div>
                  }
                </div>

                @for (mode of modes(); track mode.id; let mi = $index) {
                  <div
                    class="relative shrink-0 px-3 py-1.5 border-l border-ink-100 flex items-center gap-1 overflow-visible outline-none"
                    [style.width.px]="modeW(mode.id)"
                    [attr.tabindex]="isEditing(token, mi) ? null : -1"
                    [attr.data-cell]="cellKey(token, mi)"
                    [class.ring-1]="isEditing(token, mi) || isActiveCell(token, mi)"
                    [class.ring-inset]="isEditing(token, mi) || isActiveCell(token, mi)"
                    [class.ring-forge-400]="isEditing(token, mi) || isActiveCell(token, mi)"
                    (focus)="onCellFocus(token, mi)"
                    (keydown)="onCellKeydown($event, token, mi)"
                    (dblclick)="startEditRaw(token, mi); $event.stopPropagation()"
                    title="Arrows move · Enter edits · ⌘C/⌘V copy/paste · double-click edits raw"
                  >
                    @if (isEditing(token, mi)) {
                      <input
                        #cellInput
                        class="w-full font-mono text-xs bg-transparent border-0 p-0 text-ink-700 focus:outline-none focus:ring-0"
                        [class.pr-5]="isStepType(token)"
                        [ngModel]="editText()"
                        (ngModelChange)="onEditInput($event)"
                        (keydown)="onKeydown($event)"
                        (blur)="onBlur()"
                        (click)="$event.stopPropagation()"
                      />
                      <!-- numeric steppers (dimension / number): ↑/↓ also work -->
                      @if (isStepType(token)) {
                        <div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex flex-col z-20 leading-none">
                          <button
                            class="h-3.5 w-4 flex items-center justify-center text-[9px] text-ink-400 hover:text-forge-600"
                            tabindex="-1"
                            title="Increment (↑ · Shift for ±10)"
                            (mousedown)="$event.preventDefault()"
                            (click)="step(1)"
                          >▲</button>
                          <button
                            class="h-3.5 w-4 flex items-center justify-center text-[9px] text-ink-400 hover:text-forge-600"
                            tabindex="-1"
                            title="Decrement (↓ · Shift for ±10)"
                            (mousedown)="$event.preventDefault()"
                            (click)="step(-1)"
                          >▼</button>
                        </div>
                      }
                      <!-- alias autocomplete dropdown with resolved-value preview -->
                      @if (suggestions().length) {
                        <div
                          class="absolute left-2 right-2 top-full mt-1 z-30 max-h-60 overflow-auto bg-white border border-ink-200 rounded-md shadow-xl py-1"
                        >
                          @for (s of suggestions(); track s.alias; let si = $index) {
                            <button
                              class="w-full text-left px-2 py-1 flex items-center gap-2 hover:bg-ink-100"
                              [class.bg-forge-50]="si === highlight()"
                              (mousedown)="pickSuggestion(s.alias); $event.preventDefault()"
                            >
                              @if (s.swatch) {
                                <span class="w-3.5 h-3.5 rounded border border-ink-300 shrink-0 checker">
                                  <span class="block w-full h-full rounded" [style.background]="s.swatch"></span>
                                </span>
                              } @else {
                                <span class="w-3.5 text-center text-ink-400 shrink-0 text-xs">{{ s.glyph }}</span>
                              }
                              <span class="font-mono text-xs text-ink-800 truncate flex-1">{{ s.label }}</span>
                              <span class="font-mono text-[11px] text-ink-400 shrink-0 max-w-[40%] truncate">{{ s.preview }}</span>
                            </button>
                          }
                        </div>
                      }
                    } @else {
                      <div
                        class="flex-1 min-w-0 overflow-hidden"
                        [class.cursor-pointer]="isAliasValue(token.rawValuesByMode[mode.id]) || token.type === 'color' || isCompositeValue(token, mi)"
                        (click)="onCellClick(token, mi, $event); $event.stopPropagation()"
                      >
                        <tf-value-cell
                          [raw]="token.rawValuesByMode[mode.id]"
                          [resolved]="token.resolvedValuesByMode[mode.id]"
                          [type]="token.type"
                        />
                      </div>
                      <!-- composite values get a dedicated "edit fields" button (clearer
                           than the hidden double-click) signalling a structured value. -->
                      @if (isCompositeValue(token, mi)) {
                        <button
                          class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100 opacity-60 group-hover:opacity-100"
                          title="Edit composite value"
                          (click)="openComposite(token, mi); $event.stopPropagation()"
                        >
                          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2" />
                            <line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2" />
                          </svg>
                        </button>
                      } @else if (!isAliasValue(token.rawValuesByMode[mode.id])) {
                        <!-- link-to-variable: convert a literal into an alias -->
                        <button
                          class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-300 hover:text-forge-600 hover:bg-ink-100 opacity-0 group-hover:opacity-100"
                          title="Link a variable (alias)"
                          (click)="openPicker(token, mi, 'libraries', $event); $event.stopPropagation()"
                        >
                          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.07 0l1.93-1.93a5 5 0 0 0-7.07-7.07L11 5" />
                            <path d="M14 11a5 5 0 0 0-7.07 0L5 12.93a5 5 0 0 0 7.07 7.07L13 19" />
                          </svg>
                        </button>
                      }
                      <!-- (i): the alias target is multi-mode → show its per-mode resolved values -->
                      @if (aliasTargetMulti(token.rawValuesByMode[mode.id])) {
                        <span
                          class="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-ink-400 hover:text-forge-600 cursor-help text-[11px] leading-none"
                          [title]="aliasTargetTooltip(token.rawValuesByMode[mode.id])"
                          (click)="$event.stopPropagation()"
                          >ⓘ</span
                        >
                      }
                      <!-- composite expand-in-place editor (Phase 3.5.5) -->
                      @if (isCompositeEditing(token, mi)) {
                        <div class="fixed inset-0 z-30" (click)="closeComposite(); $event.stopPropagation()"></div>
                        <div
                          class="absolute left-2 top-full mt-1 z-40 w-72 bg-white border border-ink-200 rounded-lg shadow-xl p-2.5 flex flex-col gap-2"
                          (click)="$event.stopPropagation()"
                        >
                          <div class="text-[11px] uppercase tracking-wide text-ink-400 font-medium">
                            {{ token.type }}
                          </div>
                          @if (token.type === 'gradient') {
                            <!-- gradient preview bar -->
                            <div class="h-4 rounded border border-ink-200" [style.background]="gradientPreview()"></div>
                            @for (s of gradientStops(); track $index; let si = $index) {
                              <div class="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  class="w-5 h-5 shrink-0 rounded border border-ink-300 checker"
                                  title="Pick a colour or link an alias"
                                  (click)="openStopColorPicker(si, 'custom', $event)"
                                >
                                  <span class="block w-full h-full rounded" [style.background]="stopSwatch(s)"></span>
                                </button>
                                <input
                                  class="flex-1 min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:border-forge-500"
                                  [class.text-forge-700]="isAlias(s.color)"
                                  [ngModel]="s.color"
                                  (ngModelChange)="setStopColor(si, $event)"
                                  (keydown.enter)="commitComposite()"
                                  (keydown.escape)="closeComposite()"
                                />
                                <input
                                  type="number" min="0" max="1" step="0.05"
                                  class="w-16 shrink-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:border-forge-500"
                                  title="Stop position (0–1)"
                                  [ngModel]="s.position"
                                  (ngModelChange)="setStopPosition(si, $event)"
                                  (keydown.enter)="commitComposite()"
                                  (keydown.escape)="closeComposite()"
                                />
                                <button
                                  type="button"
                                  class="w-5 h-5 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-red-600 hover:bg-ink-100 disabled:opacity-30"
                                  title="Remove stop"
                                  [disabled]="gradientStops().length <= 2"
                                  (click)="removeStop(si)"
                                >
                                  <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>
                                </button>
                              </div>
                            }
                            <button
                              type="button"
                              class="self-start text-xs px-2 py-1 rounded text-forge-600 hover:bg-ink-100 flex items-center gap-1"
                              (click)="addStop()"
                            >
                              <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                              Add stop
                            </button>
                          } @else {
                          @for (f of compositeFields(); track f.key; let fi = $index) {
                            <div class="flex items-center gap-2">
                              <span class="w-24 shrink-0 text-xs text-ink-500 truncate" [title]="f.key + ' · ' + f.type">{{ f.key }}</span>
                              <div class="flex-1 min-w-0 flex items-center gap-1">
                                @if (f.type === 'color') {
                                  <button
                                    type="button"
                                    class="w-5 h-5 shrink-0 rounded border border-ink-300 bg-[length:8px_8px]"
                                    [style.background]="subFieldSwatch(f)"
                                    title="Pick a colour or link an alias"
                                    (click)="openSubFieldPicker(fi, 'custom', $event)"
                                  ></button>
                                }
                                <input
                                  class="flex-1 min-w-0 font-mono text-xs border border-ink-200 rounded px-2 py-1 focus:outline-none focus:border-forge-500"
                                  [class.text-forge-700]="isAlias(f.value)"
                                  [ngModel]="f.value"
                                  (ngModelChange)="setCompositeField(fi, $event)"
                                  (keydown.enter)="commitComposite()"
                                  (keydown.escape)="closeComposite()"
                                />
                                @if (f.type === 'color' || isMetric(f.type)) {
                                  <button
                                    type="button"
                                    class="w-5 h-5 shrink-0 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100"
                                    title="Link a variable (alias)"
                                    (click)="openSubFieldPicker(fi, 'libraries', $event)"
                                  >
                                    <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/></svg>
                                  </button>
                                }
                              </div>
                            </div>
                          }
                          }
                          <div class="flex justify-end gap-1.5 pt-0.5">
                            <button class="text-xs px-2 py-1 rounded text-ink-500 hover:bg-ink-100" (click)="closeComposite()">Cancel</button>
                            <button class="text-xs px-2 py-1 rounded bg-ink-900 text-white hover:bg-ink-700" (click)="commitComposite()">Apply</button>
                          </div>
                        </div>
                      }
                    }
                  </div>
                }
                <!-- Spacer: fills leftover width so the pinned action cell is flush right. -->
                <div class="flex-1 min-w-0"></div>
                <div
                  class="w-10 shrink-0 border-l border-ink-100 flex items-center justify-center sticky right-0 z-[5]"
                  [class.bg-white]="!isSelected(token)"
                  [class.group-hover:bg-ink-50]="!isSelected(token)"
                  [class.bg-forge-100]="isSelected(token)"
                >
                  <button
                    class="w-6 h-6 flex items-center justify-center rounded text-ink-400 hover:text-forge-600 hover:bg-ink-100 transition-opacity"
                    [class.opacity-30]="!isInspected(token)"
                    [class.group-hover:opacity-100]="!isInspected(token)"
                    [class.text-forge-600]="isInspected(token)"
                    [class.bg-forge-50]="isInspected(token)"
                    title="Open details"
                    (click)="openDetails(token, $event)"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>
        }
        @if (grouped().length === 0) {
          <div class="p-8 text-center text-ink-400 text-sm">No tokens in this collection.</div>
        }
      </div>
    </div>
  `,
})
export class VariablesTableComponent {
  private readonly store = inject(ProjectStore);
  readonly registry = inject(GroupDropRegistry);
  private readonly ctxMenu = inject(ContextMenuService);
  private readonly picker = inject(CellPickerService);
  readonly ui = inject(UiService);
  readonly modes = this.store.modes;
  readonly aliasOptions = computed(() => this.store.collectionPaths().map((p) => `{${p}}`));

  // ---- Resizable columns (widths persisted in UiService) ----
  readonly nameW = this.ui.nameColWidth;
  modeW(modeId: string): number {
    return this.ui.modeColWidth(modeId);
  }
  /** Total width of all columns — drives section-header / row min-width so their
   * backgrounds and borders span the full horizontally-scrollable area. */
  readonly totalWidth = computed(
    () =>
      this.ui.nameColWidth() +
      this.modes().reduce((sum, m) => sum + this.ui.modeColWidth(m.id), 0) +
      40, // trailing action column (w-10)
  );
  /** Rows/section headers are at least the columns' total, but stretch to fill the
   * viewport when wider — so a flex spacer can push the pinned action column right. */
  readonly fillMinWidth = computed(() => `max(${this.totalWidth()}px, 100%)`);

  /** Drag a header cell's right edge to resize that column. */
  startColResize(event: PointerEvent, kind: 'name' | 'mode', modeId?: string): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = kind === 'name' ? this.ui.nameColWidth() : this.ui.modeColWidth(modeId!);
    const move = (e: PointerEvent) => {
      const w = startW + (e.clientX - startX);
      if (kind === 'name') this.ui.setNameColWidth(w);
      else this.ui.setModeColWidth(modeId!, w);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }
  /** Exposed to the template (literal cells show a "link a variable" button). */
  readonly isAliasValue = isAliasValue;

  /**
   * Group rows by their FULL parent path (Figma-style: "Global / Default / Content"),
   * preserving first-appearance order. Each section = the direct children of one
   * parent group, which is exactly the unit that reorders/moves cleanly.
   */
  readonly grouped = computed<Section[]>(() => {
    const byParent = new Map<string, Section>();
    for (const t of this.store.tokens()) {
      const parentPath = t.path.slice(0, -1);
      const key = JSON.stringify(parentPath);
      let section = byParent.get(key);
      if (!section) {
        section = { key, parentPath, tokens: [] };
        byParent.set(key, section);
      }
      section.tokens.push(t);
    }
    return [...byParent.values()];
  });

  /** Connect every section to all the other drop lists (sections + sidebar). */
  readonly connectedTo = this.registry.idsDeepestFirst;
  private readonly flatTokens = computed(() => this.grouped().flatMap((s) => s.tokens));
  private readonly flatIds = computed(() => this.flatTokens().map((t) => t.id));
  private readonly rowIndexById = computed(
    () => new Map(this.flatTokens().map((t, i) => [t.id, i])),
  );

  // ---- Inline edit ----
  readonly editing = signal<EditCoord | null>(null);
  readonly editText = signal('');
  private navigating = false;
  private readonly cellInput = viewChild<ElementRef<HTMLInputElement>>('cellInput');

  // ---- Alias autocomplete (shown while editing when the text holds a `{`) ----
  readonly highlight = signal(0);
  readonly suggestions = computed<AliasSuggestion[]>(() => {
    const t = this.editText();
    const ed = this.editing();
    if (!ed || !t.includes('{')) return [];
    const editingToken = this.flatTokens()[ed.row];
    const modeId = this.modes()[ed.mode]?.id;
    const editType = editingToken
      ? effectiveType(
          editingToken.type,
          modeId ? editingToken.resolvedValuesByMode[modeId] : undefined,
          modeId ? editingToken.rawValuesByMode[modeId] : undefined,
        )
      : 'unknown';
    const q = t.slice(t.indexOf('{') + 1).replace(/\}.*$/, '').toLowerCase();

    return this.store
      .allTokens()
      .filter((tok) => tok.id !== editingToken?.id)
      .filter((tok) =>
        typesCompatible(
          editType,
          effectiveType(tok.type, modeId ? tok.resolvedValuesByMode[modeId] : undefined),
        ),
      )
      .filter((tok) => tok.path.join('.').toLowerCase().includes(q))
      .slice(0, 10)
      .map((tok) => {
        const resolved = (modeId ? tok.resolvedValuesByMode[modeId] : undefined)
          ?? Object.values(tok.resolvedValuesByMode)[0];
        return {
          alias: `{${tok.path.join('.')}}`,
          label: tok.path.join('/'),
          glyph: typeGlyph(tok.type),
          swatch: tok.type === 'color' ? cssColor(resolved) : null,
          preview: formatValue(resolved, tok.type),
        };
      });
  });

  // ---- Inline rename (double-click the name) ----
  readonly renamingId = signal<string | null>(null);
  readonly renameText = signal('');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  // ---- Inline rename of a group divider (double-click the section header) ----
  readonly renamingSectionKey = signal<string | null>(null);
  readonly renameSectionText = signal('');
  private readonly sectionRenameInput = viewChild<ElementRef<HTMLInputElement>>('sectionRenameInput');

  // ---- Mode add / rename / delete (column headers) ----
  readonly addingMode = signal<{ name: string; from: string } | null>(null);
  readonly renamingModeId = signal<string | null>(null);
  readonly renameModeText = signal('');
  readonly selectedModeId = signal<string | null>(null);
  private readonly modeRenameInput = viewChild<ElementRef<HTMLInputElement>>('modeRenameInput');
  private readonly addModeInput = viewChild<ElementRef<HTMLInputElement>>('addModeInput');

  constructor() {
    effect(() => {
      if (this.editing()) queueMicrotask(() => this.cellInput()?.nativeElement.select());
    });
    effect(() => {
      if (this.renamingId()) queueMicrotask(() => this.renameInput()?.nativeElement.select());
    });
    effect(() => {
      if (this.renamingSectionKey()) queueMicrotask(() => this.sectionRenameInput()?.nativeElement.select());
    });
    effect(() => {
      if (this.renamingModeId()) queueMicrotask(() => this.modeRenameInput()?.nativeElement.select());
    });
    effect(() => {
      if (this.addingMode()) queueMicrotask(() => this.addModeInput()?.nativeElement.focus());
    });
    // Close any open mode editor when the collection changes (modes differ).
    effect(() => {
      this.store.currentCollectionName();
      this.addingMode.set(null);
      this.renamingModeId.set(null);
      this.selectedModeId.set(null);
    });
    // Reset transient cell state when the collection changes — row indices are
    // collection-relative, so a stale activeCell/editor would point at the wrong row.
    effect(() => {
      this.store.currentCollectionName();
      this.activeCell.set(null);
      this.editing.set(null);
      this.compositeEditing.set(null);
      this.renamingSectionKey.set(null);
    });
    // Register each section as a drop list so other lists connect to it.
    effect((onCleanup) => {
      const ids = this.grouped().map((s) => 'sec-' + s.key);
      for (const id of ids) this.registry.register(id);
      onCleanup(() => ids.forEach((id) => this.registry.unregister(id)));
    });
    // Scroll the selected row into view (e.g. after a diagnostics "Go to token").
    effect(() => {
      const id = this.store.selectedTokenId();
      if (!id) return;
      queueMicrotask(() => {
        document
          .querySelector(`.tf-row[data-token-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    });
    // A just-created variable drops straight into inline rename so the user can
    // name it right away (Figma-like).
    effect(() => {
      const id = this.store.pendingRenameTokenId();
      if (!id) return;
      queueMicrotask(() => {
        const token = this.flatTokens().find((t) => t.id === id);
        if (token) this.startRename(token);
        this.store.pendingRenameTokenId.set(null);
      });
    });
  }

  /**
   * Add a variable to this section's group. Its type is inferred from the
   * section's existing rows (a group of colours yields a colour), falling back
   * to `color` for an empty/untyped group. The new row enters inline rename.
   */
  createInGroup(section: Section): void {
    const first = section.tokens[0]?.type;
    const type: DtcgType = first && first !== 'unknown' ? (first as DtcgType) : 'color';
    void this.store.createVariable(type, section.parentPath);
  }

  // ---- Rename a group via its divider ----
  /** Begin renaming a section: a real group seeds with its name; an ungrouped
   * section starts empty (committing names a brand-new group for its rows). */
  startRenameSection(section: Section): void {
    this.renameSectionText.set(section.parentPath[section.parentPath.length - 1] ?? '');
    this.renamingSectionKey.set(section.key);
  }
  onRenameSectionKeydown(event: KeyboardEvent, section: Section): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitRenameSection(section);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.renamingSectionKey.set(null);
    }
  }
  /**
   * Commit a divider rename. A real group is renamed in place (references
   * rewritten); an **ungrouped** section moves its loose root tokens into a new
   * top-level group of that name — so it gains a real, sidebar-visible group.
   */
  async commitRenameSection(section: Section): Promise<void> {
    if (this.renamingSectionKey() !== section.key) return;
    const name = this.renameSectionText().trim();
    const collection = this.store.currentCollectionName();
    this.renamingSectionKey.set(null);
    if (!collection || !name) return;
    if (section.parentPath.length) {
      if (name === section.parentPath[section.parentPath.length - 1]) return; // unchanged
      await this.store.renameGroup(collection, section.parentPath, name);
    } else {
      // Ungrouped root tokens → wrap them in a new named group.
      await this.store.moveTokensToParent(section.tokens.map((t) => t.id), [name]);
      this.store.selectGroup([name]);
    }
  }

  leaf(token: ParsedToken): string {
    return token.path[token.path.length - 1] ?? '';
  }
  glyph(token: ParsedToken): string {
    return typeGlyph(token.type);
  }
  hasError(token: ParsedToken): boolean {
    return token.diagnostics.some((d) => d.severity === 'error');
  }

  // ---- Selection (shared via the store so the sidebar sees it too) ----
  isSelected(token: ParsedToken): boolean {
    return this.store.isSelected(token.id);
  }
  /** The single "focused" token (e.g. revealed from diagnostics) — emphasised. */
  isFocused(token: ParsedToken): boolean {
    return this.store.selectedTokenId() === token.id;
  }
  /** The token whose detail panel is currently open (gear icon stays lit). */
  isInspected(token: ParsedToken): boolean {
    return this.store.inspectedTokenId() === token.id;
  }
  /** Gear click → select the row and open its detail panel (inspector). */
  openDetails(token: ParsedToken, event: MouseEvent): void {
    event.stopPropagation();
    this.store.selectToken(token.id);
  }

  onNameClick(token: ParsedToken, event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey) {
      this.store.toggleSelection(token.id);
    } else if (event.shiftKey) {
      this.store.selectRange(this.flatIds(), token.id);
    } else {
      this.store.selectOnly(token.id);
    }
  }

  dragBadge(token: ParsedToken): string {
    const sel = this.store.selectedIds();
    return sel.has(token.id) && sel.size > 1 ? `${sel.size} variables` : this.leaf(token);
  }

  // ---- Alias-target preview ((i) tooltip) ----
  /** True when the alias points at a token that has more than one mode. */
  aliasTargetMulti(raw: unknown): boolean {
    if (!isAliasValue(raw)) return false;
    const t = this.store.aliasTargetToken(raw);
    return !!t && Object.keys(t.resolvedValuesByMode).length > 1;
  }
  /** Multi-line "mode: value" summary of the alias target's resolved values. */
  aliasTargetTooltip(raw: unknown): string {
    const t = this.store.aliasTargetToken(raw);
    if (!t) return '';
    const lines = Object.entries(t.resolvedValuesByMode).map(
      ([m, v]) => `${m}: ${formatValue(v, t.type)}`,
    );
    return `${t.path.join('/')}\n${lines.join('\n')}`;
  }

  // ---- Inline rename ----
  isRenaming(token: ParsedToken): boolean {
    return this.renamingId() === token.id;
  }
  startRename(token: ParsedToken): void {
    this.editing.set(null);
    this.renameText.set(this.leaf(token));
    this.renamingId.set(token.id);
  }
  onRenameKeydown(event: KeyboardEvent, token: ParsedToken): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitRename(token);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.renamingId.set(null);
    }
  }
  async commitRename(token: ParsedToken): Promise<void> {
    if (this.renamingId() !== token.id) return;
    const next = this.renameText().trim();
    this.renamingId.set(null);
    if (next && next !== this.leaf(token)) {
      await this.store.renameTokenLeaf(token.id, next);
    }
  }

  // ---- Mode add / rename (column headers) ----
  startAddMode(): void {
    this.renamingModeId.set(null);
    this.addingMode.set({ name: '', from: this.modes()[0]?.id ?? '' });
  }
  setAddModeName(name: string): void {
    const a = this.addingMode();
    if (a) this.addingMode.set({ ...a, name });
  }
  setAddModeFrom(from: string): void {
    const a = this.addingMode();
    if (a) this.addingMode.set({ ...a, from });
  }
  cancelAddMode(): void {
    this.addingMode.set(null);
  }
  async confirmAddMode(): Promise<void> {
    const a = this.addingMode();
    const col = this.store.currentCollectionName();
    this.addingMode.set(null);
    if (!a || !col) return;
    const name = a.name.trim();
    if (!name) return;
    await this.store.addMode(col, name, a.from || undefined);
  }

  startRenameMode(modeId: string): void {
    this.addingMode.set(null);
    this.renameModeText.set(modeId);
    this.renamingModeId.set(modeId);
  }
  onRenameModeKeydown(event: KeyboardEvent, modeId: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitRenameMode(modeId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.renamingModeId.set(null);
    }
  }
  async commitRenameMode(modeId: string): Promise<void> {
    if (this.renamingModeId() !== modeId) return;
    const col = this.store.currentCollectionName();
    const to = this.renameModeText().trim();
    this.renamingModeId.set(null);
    if (!col || !to || to === modeId) return;
    await this.store.renameMode(col, modeId, to);
  }

  /** Click a mode header to select its column (toggles off if already selected). */
  selectMode(modeId: string): void {
    this.selectedModeId.set(this.selectedModeId() === modeId ? null : modeId);
  }
  /** Keys on a focused/selected mode header: Delete removes, F2/Enter renames. */
  onModeHeaderKeydown(event: KeyboardEvent, modeId: string): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      void this.deleteMode(modeId);
    } else if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault();
      this.startRenameMode(modeId);
    } else if (event.key === 'Escape') {
      this.selectedModeId.set(null);
    }
  }
  /** Right-click a mode header → Rename / Duplicate / Delete. */
  onModeContextMenu(event: MouseEvent, modeId: string): void {
    event.preventDefault();
    this.selectedModeId.set(modeId);
    const col = this.store.currentCollectionName();
    if (!col) return;
    const isLast = this.modes().length <= 1;
    this.ctxMenu.open(event, [
      { label: 'Rename', action: () => this.startRenameMode(modeId) },
      { label: 'Duplicate', action: () => void this.store.duplicateMode(col, modeId) },
      {
        label: 'Delete',
        action: () => void this.deleteMode(modeId),
        disabled: isLast,
        danger: true,
      },
    ]);
  }
  async deleteMode(modeId: string): Promise<void> {
    const col = this.store.currentCollectionName();
    if (!col) return;
    if (this.modes().length <= 1) {
      this.ui.showToast('A collection needs at least one mode');
      return;
    }
    this.selectedModeId.set(null);
    await this.store.deleteMode(col, modeId);
  }

  // ---- Context menu ----
  onContextMenu(token: ParsedToken, event: MouseEvent): void {
    if (!this.store.isSelected(token.id)) this.store.selectOnly(token.id);
    const sel = this.store.selectedIds();
    const multi = sel.has(token.id) && sel.size > 1;
    const copyIds = multi ? [...sel] : [token.id];
    this.ctxMenu.open(event, [
      { label: 'Edit variable', action: () => this.store.selectToken(token.id), disabled: multi },
      { label: 'Rename', action: () => this.startRename(token), disabled: multi },
      { label: 'Duplicate', action: () => void this.store.duplicateToken(token.id), disabled: multi },
      {
        label: multi ? `Copy ${sel.size} variables` : 'Copy variable',
        action: () => this.store.copyVariables(copyIds),
      },
      {
        label: multi ? `Cut ${sel.size} variables` : 'Cut variable',
        action: () => this.store.cutVariables(copyIds),
      },
      {
        label: 'Paste here',
        disabled: !this.store.hasCopiedVariables(),
        action: () => void this.store.pasteVariables(token.path.slice(0, -1)),
      },
      {
        label: multi ? `Delete ${sel.size} variables` : 'Delete',
        danger: true,
        action: () => void this.deleteSelection(token),
      },
    ]);
  }

  private async deleteSelection(token: ParsedToken): Promise<void> {
    const sel = this.store.selectedIds();
    const ids = sel.has(token.id) && sel.size > 1 ? [...sel] : [token.id];
    for (const id of ids) await this.store.deleteToken(id);
  }

  // ---- Drag & drop ----
  /** A section only receives variable rows — never sidebar groups. */
  readonly acceptsToken = (drag: CdkDrag): boolean => isToken(drag.data);

  isDropTarget(section: Section): boolean {
    return this.registry.activeTarget() === 'sec-' + section.key;
  }
  onEntered(event: CdkDragEnter<Section>): void {
    const id = 'sec-' + event.container.data.key;
    // Entering the origin section is a reorder, not a "drop into" — don't flag.
    if (event.item.dropContainer === event.container) {
      this.registry.leave(id);
      return;
    }
    this.registry.enter(id);
  }

  /** Insertion-line height, matched to the dragged row so downward swaps stay precise. */
  readonly placeholderHeight = signal(41);

  onDragStart(token: ParsedToken, event: CdkDragStart): void {
    // Dragging an unselected row drags it alone.
    if (!this.store.isSelected(token.id)) this.store.clearSelection();
    // Match the placeholder to the real row height (varies with the mode count).
    const h = event.source.element.nativeElement.offsetHeight;
    if (h > 0) this.placeholderHeight.set(h);
  }

  drop(event: CdkDragDrop<Section>): void {
    this.registry.clear();
    const source = event.previousContainer.data;
    const target = event.container.data;
    const collection = this.store.currentCollectionName();
    if (!collection) return;

    // A group dragged from the sidebar onto a table section → re-nest it here.
    const item = event.item.data;
    if (isGroupNode(item)) {
      void this.store.moveGroups(collection, item.path, target.parentPath);
      return;
    }
    if (!isToken(item)) return;
    const dragged = source.tokens[event.previousIndex];
    if (!dragged) return;

    const sel = this.store.selectedIds();
    const multi = sel.has(dragged.id) && sel.size > 1;

    if (event.previousContainer === event.container) {
      // Reorder the direct children of this section's parent. CDK's currentIndex
      // already has moveItemInArray semantics for the GRABBED row, so we move that
      // row first — this is exact in both directions (the old "removedBefore"
      // adjustment double-counted the grabbed row and shifted downward drops up by
      // one). For a multi-selection we then cluster the rest of the selected block
      // around the grabbed row's new slot, preserving their original order.
      const rows = [...source.tokens];
      moveItemInArray(rows, event.previousIndex, event.currentIndex);

      let ordered = rows;
      if (multi) {
        const block = source.tokens.filter((t) => sel.has(t.id)); // original order
        const anchor = rows.findIndex((t) => t.id === dragged.id);
        const insertAt = rows.slice(0, anchor).filter((t) => !sel.has(t.id)).length;
        ordered = rows.filter((t) => !sel.has(t.id));
        ordered.splice(insertAt, 0, ...block);
      }

      const leaves = ordered.map((t) => t.path[t.path.length - 1]!);
      void this.store.reorder(collection, source.parentPath, leaves);
    } else {
      // Move the dragged token(s) under the target section's parent path.
      void this.store.moveSelectedTokensTo(target.parentPath, dragged.id);
    }
  }

  // ---- Cell navigation + copy/paste (Phase 3.5.2) ----
  /** The focused (non-editing) cell for keyboard navigation. */
  readonly activeCell = signal<EditCoord | null>(null);
  /** Internal single-cell clipboard (raw value). */
  private readonly cellClipboard = signal<{ value: unknown } | null>(null);

  cellKey(token: ParsedToken, modeIndex: number): string | null {
    const row = this.rowIndexById().get(token.id);
    return row === undefined ? null : `${row}-${modeIndex}`;
  }
  isActiveCell(token: ParsedToken, modeIndex: number): boolean {
    const a = this.activeCell();
    return a !== null && a.row === this.rowIndexById().get(token.id) && a.mode === modeIndex;
  }
  onCellFocus(token: ParsedToken, modeIndex: number): void {
    const row = this.rowIndexById().get(token.id);
    if (row !== undefined) this.activeCell.set({ row, mode: modeIndex });
  }
  private focusCell(row: number, mode: number): void {
    const el = document.querySelector(`[data-cell="${row}-${mode}"]`);
    (el as HTMLElement | null)?.focus();
  }
  /** Arrow-key navigation + Enter-to-edit + ⌘C/⌘V copy/paste on a focused cell. */
  onCellKeydown(event: KeyboardEvent, token: ParsedToken, modeIndex: number): void {
    const row = this.rowIndexById().get(token.id);
    if (row === undefined) return;
    const key = event.key;
    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'c') {
      event.preventDefault();
      event.stopPropagation(); // a focused cell copies its VALUE, not the row
      this.copyCell(token, modeIndex);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'v') {
      event.preventDefault();
      event.stopPropagation();
      void this.pasteCell(token, modeIndex);
      return;
    }
    if (key === 'Enter' || key === 'F2') {
      event.preventDefault();
      this.startEditRaw(token, modeIndex);
      return;
    }
    let dr = 0;
    let dc = 0;
    if (key === 'ArrowUp') dr = -1;
    else if (key === 'ArrowDown') dr = 1;
    else if (key === 'ArrowLeft') dc = -1;
    else if (key === 'ArrowRight') dc = 1;
    else return;
    event.preventDefault();
    const rows = this.flatTokens().length;
    const cols = this.modes().length;
    const nr = row + dr;
    const nc = modeIndex + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
    this.focusCell(nr, nc);
  }
  /** Copy the focused cell's raw value to the internal clipboard. */
  copyCell(token: ParsedToken, modeIndex: number): void {
    const mode = this.modes()[modeIndex];
    if (!mode) return;
    this.cellClipboard.set({ value: token.rawValuesByMode[mode.id] });
    this.ui.showToast('Copied');
  }
  /**
   * Paste the clipboard value into the focused cell, or — when it is part of a
   * multi-selection — into every selected row at this mode (one batch / one undo).
   */
  async pasteCell(token: ParsedToken, modeIndex: number): Promise<void> {
    const clip = this.cellClipboard();
    const mode = this.modes()[modeIndex];
    if (!clip || !mode) return;
    const sel = this.store.selectedIds();
    const ids = sel.has(token.id) && sel.size > 1 ? [...sel] : [token.id];
    if (ids.length > 1) {
      await this.store.updateValuesBatch(ids.map((id) => ({ id, mode: mode.id, value: clip.value })));
    } else {
      await this.store.updateValue(token.id, mode.id, clip.value);
    }
  }

  // ---- Inline editing ----
  isEditing(token: ParsedToken, modeIndex: number): boolean {
    const ed = this.editing();
    return ed !== null && ed.row === this.rowIndexById().get(token.id) && ed.mode === modeIndex;
  }

  startEdit(token: ParsedToken, modeIndex: number): void {
    const row = this.rowIndexById().get(token.id);
    if (row !== undefined) this.editAt(row, modeIndex);
  }

  /**
   * Open the anchored cell picker (Figma-style). A token's clicked cell is the
   * anchor. `tab`:
   *  - `custom` → colour picker (colour cells only),
   *  - `libraries` → type-filtered token list to choose an alias.
   */
  openPicker(token: ParsedToken, modeIndex: number, tab: 'custom' | 'libraries', event: Event): void {
    const mode = this.modes()[modeIndex];
    if (!mode) return;
    const fromEl = event.currentTarget as HTMLElement;
    const cell = (fromEl.closest('[data-cell]') as HTMLElement | null) ?? fromEl;
    const r = cell.getBoundingClientRect();
    this.picker.open({
      tokenId: token.id,
      mode: mode.id,
      type: token.type,
      raw: token.rawValuesByMode[mode.id],
      resolved: token.resolvedValuesByMode[mode.id],
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
    });
  }

  /**
   * Single click on a value cell:
   *  - composite (object) → open the structured field editor,
   *  - alias → open the token picker (Libraries) to re-link, type-aware,
   *  - colour literal → open the colour picker (Custom tab),
   *  - otherwise nothing (double-click edits the raw value).
   */
  onCellClick(token: ParsedToken, modeIndex: number, event: Event): void {
    const mode = this.modes()[modeIndex];
    if (!mode) return;
    const raw = token.rawValuesByMode[mode.id];
    // Composite object → open the structured field editor (also reachable via the
    // cell's edit icon); alias → re-link picker; colour literal → colour picker.
    if (this.isCompositeValue(token, modeIndex)) this.openComposite(token, modeIndex);
    else if (isAliasValue(raw)) this.openPicker(token, modeIndex, 'libraries', event);
    else if (token.type === 'color' && raw != null) this.openPicker(token, modeIndex, 'custom', event);
  }

  // ---- Numeric quick-edit (dimension / number): steppers + ↑/↓ ----
  private editingToken(): ParsedToken | undefined {
    const ed = this.editing();
    return ed ? this.flatTokens()[ed.row] : undefined;
  }
  /** True for dimension/number tokens (steppers + arrow-key increment). */
  isStepType(token?: ParsedToken): boolean {
    const t = token ?? this.editingToken();
    return t?.type === 'dimension' || t?.type === 'number';
  }
  /** Increment/decrement the numeric part of the edited value, preserving its unit. */
  step(delta: number): void {
    const m = /^(-?\d*\.?\d+)(.*)$/.exec(this.editText().trim());
    if (!m) return;
    const next = Math.round((parseFloat(m[1]!) + delta) * 1000) / 1000;
    this.editText.set(`${next}${m[2] ?? ''}`);
    queueMicrotask(() => this.cellInput()?.nativeElement.select());
  }

  // ---- Composite expand-in-place editor (Phase 3.5.5 + typed sub-fields) ----
  readonly compositeEditing = signal<EditCoord | null>(null);
  readonly compositeFields = signal<
    { key: string; value: string; type: string; resolved: unknown; isNumber: boolean }[]
  >([]);
  /** Gradient stops being edited (one color + position per stop). */
  readonly gradientStops = signal<
    { color: string; position: string; colorResolved: unknown }[]
  >([]);

  /** True when this cell holds an editable composite value (not an alias). A
   * gradient is an ARRAY of stops; every other composite is a plain object. */
  isCompositeValue(token: ParsedToken, modeIndex: number): boolean {
    if (!COMPOSITE_TYPES.has(token.type)) return false;
    const mode = this.modes()[modeIndex];
    if (!mode) return false;
    const v = token.rawValuesByMode[mode.id];
    if (!v || typeof v !== 'object' || isAliasValue(v)) return false;
    return token.type === 'gradient' ? Array.isArray(v) : !Array.isArray(v);
  }
  /** The composite cell currently open is a gradient (array-of-stops editor). */
  editingIsGradient(): boolean {
    const c = this.compositeEditing();
    return c !== null && this.flatTokens()[c.row]?.type === 'gradient';
  }
  isCompositeEditing(token: ParsedToken, modeIndex: number): boolean {
    const c = this.compositeEditing();
    return c !== null && c.row === this.rowIndexById().get(token.id) && c.mode === modeIndex;
  }
  openComposite(token: ParsedToken, modeIndex: number): void {
    const row = this.rowIndexById().get(token.id);
    const mode = this.modes()[modeIndex];
    if (row === undefined || !mode) return;
    this.editing.set(null);
    // Gradient: array of { color, position } stops gets a dedicated stop editor.
    if (token.type === 'gradient') {
      const arr = (token.rawValuesByMode[mode.id] as unknown[]) ?? [];
      const resolvedArr = (token.resolvedValuesByMode[mode.id] as unknown[]) ?? [];
      this.gradientStops.set(
        (Array.isArray(arr) ? arr : []).map((s, i) => {
          const stop = (s ?? {}) as Record<string, unknown>;
          const rStop = (Array.isArray(resolvedArr) ? resolvedArr[i] : undefined) as
            | Record<string, unknown>
            | undefined;
          return {
            color: typeof stop['color'] === 'string' ? (stop['color'] as string) : '',
            position: String(stop['position'] ?? 0),
            colorResolved: rStop?.['color'],
          };
        }),
      );
      this.compositeFields.set([]);
      this.compositeEditing.set({ row, mode: modeIndex });
      return;
    }
    const v = (token.rawValuesByMode[mode.id] ?? {}) as Record<string, unknown>;
    const resolved = (token.resolvedValuesByMode[mode.id] ?? {}) as Record<string, unknown>;
    this.compositeFields.set(
      Object.entries(v).map(([key, val]) => ({
        key,
        value: typeof val === 'string' ? val : JSON.stringify(val),
        type: compositeFieldType(token.type, key),
        resolved: resolved?.[key],
        isNumber: typeof val === 'number',
      })),
    );
    this.compositeEditing.set({ row, mode: modeIndex });
  }

  // ---- Gradient stop editing ----
  setStopColor(index: number, value: string): void {
    const stops = [...this.gradientStops()];
    if (!stops[index]) return;
    stops[index] = { ...stops[index]!, color: value };
    this.gradientStops.set(stops);
  }
  setStopPosition(index: number, value: string): void {
    const stops = [...this.gradientStops()];
    if (!stops[index]) return;
    stops[index] = { ...stops[index]!, position: value };
    this.gradientStops.set(stops);
  }
  addStop(): void {
    const stops = this.gradientStops();
    const last = stops[stops.length - 1];
    const pos = last ? Math.min(1, (Number(last.position) || 0) + 0.1) : 0;
    this.gradientStops.set([
      ...stops,
      { color: '#000000', position: String(Math.round(pos * 1000) / 1000), colorResolved: undefined },
    ]);
  }
  removeStop(index: number): void {
    this.gradientStops.set(this.gradientStops().filter((_, i) => i !== index));
  }
  /** A live `linear-gradient(...)` CSS string previewing the edited stops. */
  gradientPreview(): string {
    const stops = this.gradientStops();
    if (!stops.length) return 'transparent';
    const parts = stops.map((s) => {
      const pos = Number(s.position);
      const pct = (Number.isNaN(pos) ? 0 : Math.max(0, Math.min(1, pos))) * 100;
      return `${this.stopSwatch(s)} ${pct}%`;
    });
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  }
  /** CSS colour for a stop's swatch (its literal, else its resolved colour). */
  stopSwatch(stop: { color: string; colorResolved: unknown }): string {
    const v = (stop.color ?? '').trim();
    if (v && !isAliasValue(v)) {
      const c = cssColor(v);
      if (c) return c;
    }
    return cssColor(stop.colorResolved) || 'transparent';
  }
  /** Open the colour/alias picker for a gradient stop's colour. */
  openStopColorPicker(index: number, tab: 'custom' | 'libraries', event: Event): void {
    const c = this.compositeEditing();
    if (!c) return;
    const token = this.flatTokens()[c.row];
    const mode = this.modes()[c.mode];
    const stop = this.gradientStops()[index];
    if (!token || !mode || !stop) return;
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.picker.open({
      tokenId: token.id,
      mode: mode.id,
      type: 'color',
      raw: stop.color,
      resolved: stop.colorResolved,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
      onPick: (value) => this.setStopColor(index, value),
    });
  }
  setCompositeField(index: number, value: string): void {
    const fields = [...this.compositeFields()];
    const f = fields[index];
    if (!f) return;
    fields[index] = { ...f, value };
    this.compositeFields.set(fields);
  }
  closeComposite(): void {
    this.compositeEditing.set(null);
  }

  // ---- Typed composite sub-fields (colour / metric alias linking) ----
  isMetric(type: string): boolean {
    return isMetricType(type);
  }
  isAlias(value: string): boolean {
    return isAliasValue(value);
  }
  /** CSS colour for a colour sub-field's swatch (its literal, else its resolved value). */
  subFieldSwatch(f: { value: string; resolved: unknown }): string {
    const v = (f.value ?? '').trim();
    if (v && !isAliasValue(v)) {
      const c = cssColor(v);
      if (c) return c;
    }
    return cssColor(f.resolved) || 'transparent';
  }
  /**
   * Open the shared cell picker for a composite sub-property. The chosen colour
   * or `{alias}` is written back into the field (via `onPick`); Apply then
   * persists the reassembled `$value` object.
   */
  openSubFieldPicker(index: number, tab: 'custom' | 'libraries', event: Event): void {
    const f = this.compositeFields()[index];
    const c = this.compositeEditing();
    if (!f || !c) return;
    const token = this.flatTokens()[c.row];
    const mode = this.modes()[c.mode];
    if (!token || !mode) return;
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.picker.open({
      tokenId: token.id,
      mode: mode.id,
      type: f.type,
      raw: f.value,
      resolved: f.resolved,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      tab,
      onPick: (value) => this.setCompositeField(index, value),
    });
  }
  /** Reassemble the composite object from the edited fields and persist it. */
  async commitComposite(): Promise<void> {
    const c = this.compositeEditing();
    if (!c) return;
    const token = this.flatTokens()[c.row];
    const mode = this.modes()[c.mode];
    this.compositeEditing.set(null);
    if (!token || !mode) return;
    // Gradient → rebuild the array of { color, position } stops.
    if (token.type === 'gradient') {
      const value = this.gradientStops().map((s) => {
        const pos = Number(s.position);
        return { color: s.color, position: Number.isNaN(pos) ? 0 : pos };
      });
      await this.store.updateValue(token.id, mode.id, value);
      return;
    }
    const obj: Record<string, unknown> = {};
    for (const f of this.compositeFields()) {
      if (isAliasValue(f.value)) {
        obj[f.key] = f.value; // an alias sub-property stays a string ref
      } else if (f.isNumber) {
        const n = Number(f.value);
        obj[f.key] = Number.isNaN(n) ? f.value : n;
      } else {
        obj[f.key] = f.value;
      }
    }
    await this.store.updateValue(token.id, mode.id, obj);
  }

  /**
   * Double click → edit the RAW value. For an alias, pre-fill with its resolved
   * literal so editing it converts the alias into a concrete value.
   */
  startEditRaw(token: ParsedToken, modeIndex: number): void {
    const row = this.rowIndexById().get(token.id);
    const mode = this.modes()[modeIndex];
    if (row === undefined || !mode) return;
    // Composite values (typography, shadow, …) get a structured sub-property
    // editor instead of raw JSON text (Phase 3.5.5).
    if (this.isCompositeValue(token, modeIndex)) {
      this.openComposite(token, modeIndex);
      return;
    }
    const raw = token.rawValuesByMode[mode.id];
    const seed = isAliasValue(raw)
      ? formatValue(token.resolvedValuesByMode[mode.id], token.type)
      : formatValue(raw, token.type);
    this.highlight.set(0);
    this.editText.set(seed === '—' ? '' : seed);
    this.editing.set({ row, mode: modeIndex });
  }

  private editAt(row: number, modeIndex: number): void {
    const tokens = this.flatTokens();
    const modes = this.modes();
    if (row < 0 || row >= tokens.length || modeIndex < 0 || modeIndex >= modes.length) {
      this.editing.set(null);
      return;
    }
    const token = tokens[row]!;
    const mode = modes[modeIndex]!;
    this.editText.set(formatValue(token.rawValuesByMode[mode.id], token.type));
    this.highlight.set(0);
    this.editing.set({ row, mode: modeIndex });
  }

  onEditInput(value: string): void {
    this.editText.set(value);
    this.highlight.set(0);
  }

  /** Accept an alias suggestion: set the value and commit (no cell move). */
  pickSuggestion(option: string): void {
    this.editText.set(option);
    void this.commitEdit('none');
  }

  onKeydown(event: KeyboardEvent): void {
    const sugg = this.suggestions();
    if (sugg.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.highlight.set(Math.min(this.highlight() + 1, sugg.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.highlight.set(Math.max(this.highlight() - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        this.pickSuggestion(sugg[this.highlight()]!.alias);
        return;
      }
    }
    // Numeric types: ↑/↓ increment/decrement (Shift = ±10).
    if (this.isStepType()) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.step(event.shiftKey ? 10 : 1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.step(event.shiftKey ? -10 : -1);
        return;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.navigating = true;
      void this.commitEdit('down');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.navigating = true;
      void this.commitEdit(event.shiftKey ? 'prev' : 'next');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.editing.set(null);
    }
  }

  onBlur(): void {
    if (this.navigating) {
      this.navigating = false;
      return;
    }
    void this.commitEdit('none');
  }

  async commitEdit(move: 'down' | 'next' | 'prev' | 'none'): Promise<void> {
    const ed = this.editing();
    if (!ed) return;
    const token = this.flatTokens()[ed.row];
    const mode = this.modes()[ed.mode];
    if (!token || !mode) {
      this.editing.set(null);
      return;
    }

    const text = this.editText();
    const current = formatValue(token.rawValuesByMode[mode.id], token.type);
    // An unterminated alias (e.g. just "{" or "{partial" with no closing brace) is
    // reverted, not written — so a half-typed alias never clobbers the value.
    const incompleteAlias = /^\{[^}]*$/.test(text.trim());
    if (text !== current && !incompleteAlias) {
      await this.store.updateValue(token.id, mode.id, coerce(text, token.type === 'number'));
    }

    const modeCount = this.modes().length;
    if (move === 'down') this.editAt(ed.row + 1, ed.mode);
    else if (move === 'next') {
      if (ed.mode + 1 < modeCount) this.editAt(ed.row, ed.mode + 1);
      else this.editAt(ed.row + 1, 0);
    } else if (move === 'prev') {
      if (ed.mode - 1 >= 0) this.editAt(ed.row, ed.mode - 1);
      else this.editAt(ed.row - 1, modeCount - 1);
    } else {
      this.editing.set(null);
    }
  }
}

function coerce(value: string, asNumber: boolean): unknown {
  if (asNumber) {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}
