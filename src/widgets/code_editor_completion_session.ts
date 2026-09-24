import type {
  CodeEditorCompletionActivation,
  CodeEditorCompletionInvocationReason,
  CodeEditorCompletionItem,
  CodeEditorCompletionList,
  CodeEditorCompletionResult,
  CodeEditorCompletionTriggerKind,
} from './code_editor'
import { normalizeRange, type TextPosition, type TextRange } from './plain_text_document'

export type CodeEditorCompletionSessionState = 'idle' | 'loading' | 'open' | 'closed'
export type CodeEditorCompletionUpdate = 'filtered' | 'requery' | 'closed'
export type CompletionSelectionPolicy = 'preselect-first' | 'defer-selection'

export interface CodeEditorCompletionRequestHandle {
  requestSeq: number
  documentVersion: number
  languageContextVersion: number
  activation: CodeEditorCompletionActivation
  triggerKind: CodeEditorCompletionTriggerKind
  triggerCharacter?: string
  invocationReason?: CodeEditorCompletionInvocationReason
  selectionPolicy: CompletionSelectionPolicy
  signal: AbortSignal
}

export interface CodeEditorCompletionOpenOptions {
  fallbackRange: TextRange
  currentPrefix: string
  defaultValidFor: RegExp
  selectionPolicy?: CompletionSelectionPolicy
}

export interface CodeEditorCompletionSessionDebugState {
  state: CodeEditorCompletionSessionState
  requestSeq: number
  itemCount: number
  filteredItemCount: number
  selectedIndex: number
  selectionTouched: boolean
  visibleStart: number
  basePrefix: string
  currentPrefix: string
  isIncomplete: boolean
  activation: CodeEditorCompletionActivation
  invocationReason?: CodeEditorCompletionInvocationReason
  selectionPolicy: CompletionSelectionPolicy
}

interface IndexedCompletionItem {
  item: CodeEditorCompletionItem
  providerIndex: number
}

const DEFAULT_VISIBLE_COUNT = 8
const DEFAULT_EMERGENCY_ITEM_LIMIT = 1000

export class CodeEditorCompletionSession {
  state: CodeEditorCompletionSessionState = 'idle'
  requestSeq = 0
  documentVersion = 0
  languageContextVersion = 0
  activation: CodeEditorCompletionActivation = 'manual'
  triggerKind: CodeEditorCompletionTriggerKind = 'invoked'
  triggerCharacter?: string
  invocationReason?: CodeEditorCompletionInvocationReason
  selectionPolicy: CompletionSelectionPolicy = 'preselect-first'
  range?: TextRange
  validFor?: RegExp
  isIncomplete = false
  basePrefix = ''
  currentPrefix = ''
  selectedIndex = -1
  selectionTouched = false
  visibleStart = 0

  private abortController?: AbortController
  private providerItems: CodeEditorCompletionItem[] = []
  private filteredItems: CodeEditorCompletionItem[] = []

  constructor(
    public visibleCount = DEFAULT_VISIBLE_COUNT,
    readonly emergencyItemLimit = DEFAULT_EMERGENCY_ITEM_LIMIT,
  ) {
    this.visibleCount = Math.max(1, Math.floor(visibleCount))
  }

  beginRequest(options: {
    documentVersion: number
    languageContextVersion: number
    activation: CodeEditorCompletionActivation
    triggerKind: CodeEditorCompletionTriggerKind
    triggerCharacter?: string
    invocationReason?: CodeEditorCompletionInvocationReason
    selectionPolicy?: CompletionSelectionPolicy
  }): CodeEditorCompletionRequestHandle {
    this.abortController?.abort()
    this.abortController = new AbortController()
    this.requestSeq += 1
    this.documentVersion = options.documentVersion
    this.languageContextVersion = options.languageContextVersion
    this.activation = options.activation
    this.triggerKind = options.triggerKind
    this.triggerCharacter = options.triggerCharacter
    this.invocationReason = options.invocationReason
    const selectionPolicy = options.selectionPolicy ?? 'preselect-first'
    this.selectionPolicy = selectionPolicy
    this.state = 'loading'
    return {
      requestSeq: this.requestSeq,
      documentVersion: options.documentVersion,
      languageContextVersion: options.languageContextVersion,
      activation: options.activation,
      triggerKind: options.triggerKind,
      triggerCharacter: options.triggerCharacter,
      invocationReason: options.invocationReason,
      selectionPolicy,
      signal: this.abortController.signal,
    }
  }

  isCurrent(
    handle: CodeEditorCompletionRequestHandle,
    documentVersion: number,
    languageContextVersion: number,
  ): boolean {
    return !handle.signal.aborted &&
      handle.requestSeq === this.requestSeq &&
      handle.documentVersion === documentVersion &&
      handle.languageContextVersion === languageContextVersion
  }

  applyResult(
    handle: CodeEditorCompletionRequestHandle,
    result: CodeEditorCompletionResult,
    options: CodeEditorCompletionOpenOptions,
  ): boolean {
    if (!this.isCurrent(handle, this.documentVersion, this.languageContextVersion)) return false
    if (this.abortController?.signal === handle.signal) this.abortController = undefined
    const list = normalizeCompletionResult(result, options.fallbackRange, options.defaultValidFor)
    const truncated = list.items.length > this.emergencyItemLimit
    this.providerItems = list.items.slice(0, this.emergencyItemLimit)
    this.range = list.range
    this.validFor = list.validFor
    this.isIncomplete = Boolean(list.isIncomplete || truncated)
    this.basePrefix = options.currentPrefix
    this.currentPrefix = options.currentPrefix
    const selectionPolicy = options.selectionPolicy ?? handle.selectionPolicy
    this.selectionPolicy = selectionPolicy
    this.selectionTouched = false
    this.visibleStart = 0
    // Providers already receive the current source and caret and may apply language-specific
    // filtering. Preserve their initial answer for backward compatibility; continued typing is
    // filtered locally for complete sessions.
    this.filteredItems = [...this.providerItems]
    this.selectedIndex = this.filteredItems.length > 0 && selectionPolicy === 'preselect-first' ? 0 : -1
    this.state = this.filteredItems.length > 0 ? 'open' : 'closed'
    return true
  }

  updatePrefix(prefix: string, rangeEnd?: TextPosition): CodeEditorCompletionUpdate {
    if (this.state !== 'open') return 'closed'
    if (!matchesPattern(this.validFor, prefix)) {
      this.close()
      return 'closed'
    }
    if (prefix.length < this.basePrefix.length || !startsWithFolded(prefix, this.basePrefix)) {
      this.currentPrefix = prefix
      return 'requery'
    }
    if (
      rangeEnd &&
      prefix.length >= this.currentPrefix.length &&
      startsWithFolded(prefix, this.currentPrefix)
    ) {
      this.advanceTrackedRangeEnd(rangeEnd)
    }
    if (this.isIncomplete) {
      this.currentPrefix = prefix
      return 'requery'
    }
    this.currentPrefix = prefix
    this.filteredItems = filterCompletionItems(this.providerItems, prefix)
    this.selectedIndex = this.filteredItems.length > 0
      ? Math.min(Math.max(0, this.selectedIndex), this.filteredItems.length - 1)
      : -1
    this.ensureSelectionVisible()
    if (this.filteredItems.length === 0) {
      this.state = 'closed'
      return 'closed'
    }
    return 'filtered'
  }

  close(): void {
    this.abortController?.abort()
    this.abortController = undefined
    this.state = 'closed'
    this.providerItems = []
    this.filteredItems = []
    this.range = undefined
    this.validFor = undefined
    this.isIncomplete = false
    this.basePrefix = ''
    this.currentPrefix = ''
    this.invocationReason = undefined
    this.selectionPolicy = 'preselect-first'
    this.selectedIndex = -1
    this.selectionTouched = false
    this.visibleStart = 0
  }

  get items(): readonly CodeEditorCompletionItem[] {
    return this.filteredItems
  }

  get currentItem(): CodeEditorCompletionItem | undefined {
    return this.selectedIndex >= 0 ? this.filteredItems[this.selectedIndex] : undefined
  }

  visibleItems(): readonly CodeEditorCompletionItem[] {
    return this.filteredItems.slice(this.visibleStart, this.visibleStart + this.visibleCount)
  }

  moveSelection(delta: number): boolean {
    if (this.filteredItems.length === 0) return false
    const count = this.filteredItems.length
    if (this.selectedIndex < 0) this.selectedIndex = delta < 0 ? count - 1 : 0
    else this.selectedIndex = (this.selectedIndex + delta + count) % count
    this.selectionTouched = true
    this.ensureSelectionVisible()
    return true
  }

  moveSelectionPage(deltaPages: number): boolean {
    if (this.filteredItems.length === 0) return false
    return this.setSelectedIndex(this.selectedIndex + deltaPages * this.visibleCount, true)
  }

  moveSelectionBoundary(boundary: 'start' | 'end'): boolean {
    if (this.filteredItems.length === 0) return false
    return this.setSelectedIndex(boundary === 'start' ? 0 : this.filteredItems.length - 1, true)
  }

  setSelectedIndex(index: number, touched = true): boolean {
    if (this.filteredItems.length === 0) return false
    this.selectedIndex = Math.max(0, Math.min(this.filteredItems.length - 1, Math.floor(index)))
    if (touched) this.selectionTouched = true
    this.ensureSelectionVisible()
    return true
  }

  setVisibleCount(count: number): boolean {
    const next = Math.max(1, Math.floor(count))
    if (next === this.visibleCount) return false
    this.visibleCount = next
    this.ensureSelectionVisible()
    return true
  }

  scrollVisibleRows(deltaRows: number): boolean {
    if (this.filteredItems.length <= this.visibleCount) return false
    const maxStart = Math.max(0, this.filteredItems.length - this.visibleCount)
    const next = Math.max(0, Math.min(maxStart, this.visibleStart + Math.trunc(deltaRows)))
    if (next === this.visibleStart) return false
    this.visibleStart = next
    return true
  }

  itemIndexAtVisibleRow(row: number): number {
    const normalized = Math.floor(row)
    if (normalized < 0 || normalized >= this.visibleItems().length) return -1
    return this.visibleStart + normalized
  }

  debugState(): CodeEditorCompletionSessionDebugState {
    return {
      state: this.state,
      requestSeq: this.requestSeq,
      itemCount: this.providerItems.length,
      filteredItemCount: this.filteredItems.length,
      selectedIndex: this.selectedIndex,
      selectionTouched: this.selectionTouched,
      visibleStart: this.visibleStart,
      basePrefix: this.basePrefix,
      currentPrefix: this.currentPrefix,
      isIncomplete: this.isIncomplete,
      activation: this.activation,
      invocationReason: this.invocationReason,
      selectionPolicy: this.selectionPolicy,
    }
  }

  private ensureSelectionVisible(): void {
    if (this.selectedIndex < 0) {
      this.visibleStart = 0
      return
    }
    if (this.selectedIndex < this.visibleStart) this.visibleStart = this.selectedIndex
    else if (this.selectedIndex >= this.visibleStart + this.visibleCount) {
      this.visibleStart = this.selectedIndex - this.visibleCount + 1
    }
    const maxStart = Math.max(0, this.filteredItems.length - this.visibleCount)
    this.visibleStart = Math.max(0, Math.min(maxStart, this.visibleStart))
  }

  private advanceTrackedRangeEnd(nextEnd: TextPosition): void {
    const range = this.range
    if (!range || nextEnd.line !== range.end.line || nextEnd.column < range.end.column) return
    const previousEnd = range.end
    this.range = {
      start: { ...range.start },
      end: { ...nextEnd },
    }
    for (const item of this.providerItems) {
      if (!item.range || !positionsEqual(item.range.end, previousEnd)) continue
      item.range = {
        start: { ...item.range.start },
        end: { ...nextEnd },
      }
    }
  }
}

function normalizeCompletionResult(
  result: CodeEditorCompletionResult,
  fallbackRange: TextRange,
  defaultValidFor: RegExp,
): Required<Pick<CodeEditorCompletionList, 'items' | 'isIncomplete' | 'validFor' | 'range'>> {
  const list: CodeEditorCompletionList = Array.isArray(result)
    ? { items: result }
    : result
  const sharedRange = list.range ? cloneRange(list.range) : cloneRange(fallbackRange)
  return {
    items: list.items.map(item => ({
      ...item,
      commitCharacters: item.commitCharacters ? [...item.commitCharacters] : undefined,
      range: item.range ? cloneRange(item.range) : cloneRange(sharedRange),
    })),
    isIncomplete: list.isIncomplete ?? false,
    validFor: normalizePattern(list.validFor ?? defaultValidFor),
    range: sharedRange,
  }
}

function filterCompletionItems(
  items: readonly CodeEditorCompletionItem[],
  prefix: string,
): CodeEditorCompletionItem[] {
  const needle = prefix.toLowerCase()
  const matches: Array<IndexedCompletionItem & { score: number; sortKey: string }> = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const candidate = (item.filterText ?? item.label).toLowerCase()
    const position = needle.length === 0 ? 0 : candidate.indexOf(needle)
    if (position < 0) continue
    matches.push({
      item,
      providerIndex: index,
      score: position === 0 ? 0 : 1,
      sortKey: item.sortText ?? '',
    })
  }
  return matches
    .sort((left, right) => left.score - right.score || compareSortKeys(left, right) || left.providerIndex - right.providerIndex)
    .map(match => match.item)
}

function compareSortKeys(
  left: IndexedCompletionItem & { sortKey: string },
  right: IndexedCompletionItem & { sortKey: string },
): number {
  if (!left.sortKey && !right.sortKey) return 0
  if (!left.sortKey) return 1
  if (!right.sortKey) return -1
  return left.sortKey.localeCompare(right.sortKey)
}

function matchesPattern(pattern: RegExp | undefined, value: string): boolean {
  if (!pattern) return true
  pattern.lastIndex = 0
  return pattern.test(value)
}

function startsWithFolded(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase())
}

function positionsEqual(left: TextPosition, right: TextPosition): boolean {
  return left.line === right.line && left.column === right.column
}

function normalizePattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
}

function cloneRange(range: TextRange): TextRange {
  const normalized = normalizeRange(range.start, range.end)
  return {
    start: { ...normalized.start },
    end: { ...normalized.end },
  }
}
