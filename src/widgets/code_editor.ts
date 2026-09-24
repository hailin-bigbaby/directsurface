import {
  RenderPlainTextEditor,
  type PlainTextEditorDecoration,
  type PlainTextEditorLineTokenProviderInput,
  type RenderPlainTextEditorOptions,
} from './plain_text_editor'
import type { TextEditSessionApi } from '../core/text_edit_session'
import type { BoxConstraints, LayoutContext, Offset, Rect, RenderObject } from '../core/render_object'
import { FocusManager } from '../core/focus_manager'
import { isPrimaryPointerButton, type PointerEvent, type WheelPointerEvent } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { fitSingleLineText, paintSingleLineText } from '../rendering/text_painter'
import type { PlainTextEditorChange } from './plain_text_editor_controller'
import {
  normalizeRange,
  type TextDocumentModel,
  type TextPosition,
  type TextRange,
} from './plain_text_document'
import type { TextToken } from './plain_text_tokenizer'
import {
  CodeEditorCompletionSession,
  type CodeEditorCompletionRequestHandle,
  type CompletionSelectionPolicy,
} from './code_editor_completion_session'
import {
  CodeEditorSignatureHelpSession,
  type CodeEditorSignatureHelpRequestHandle,
} from './code_editor_signature_help_session'
import { RenderCodeEditorHoverCardContent } from './code_editor_hover_card_content'
import { RenderCodeEditorSignatureTooltipContent } from './code_editor_signature_tooltip_content'
import { TooltipManager } from './tooltip'
import { HoverCardPopup } from './hover_card_popup'
import {
  GET_POPUP_ANCHOR_RECT,
  type PopupAnchorTarget,
} from '../core/popup_anchor'

export type MaybePromise<T> = T | Promise<T>

export type CodeEditorDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface CodeEditorDiagnostic {
  range: TextRange
  message: string
  severity?: CodeEditorDiagnosticSeverity
  source?: string
  code?: string
}

export interface CodeEditorSemanticToken {
  range: TextRange
  type: string
  modifiers?: string[]
}

export interface CodeEditorTextEdit {
  range: TextRange
  newText: string
}

export interface CodeEditorLocation {
  name: string
  kind?: string
  range: TextRange
  selectionRange?: TextRange
}

export interface CodeEditorReference {
  name: string
  kind?: string
  role?: 'declaration' | 'reference'
  range: TextRange
}

export type CodeEditorCodeActionKind = 'quickfix' | 'source.format' | string

export interface CodeEditorCodeAction {
  title: string
  kind: CodeEditorCodeActionKind
  edits: CodeEditorTextEdit[]
  diagnostics?: CodeEditorDiagnostic[]
}

export interface CodeEditorSelectionRange {
  kind?: string
  range: TextRange
  text?: string
}

export interface CodeEditorContextMenuRequest {
  position: Offset
  textPosition: TextPosition
  diagnostic?: CodeEditorDiagnostic
  codeActions: CodeEditorCodeAction[]
}

export type CodeEditorCompletionKind =
  | 'keyword'
  | 'variable'
  | 'field'
  | 'type'
  | 'operator'
  | 'action'
  | 'dataset'
  | 'rule'
  | 'snippet'
  | 'text'

export interface CodeEditorCompletionItem {
  label: string
  filterText?: string
  kind?: CodeEditorCompletionKind
  insertText?: string
  detail?: string
  documentation?: string
  range?: TextRange
  sortText?: string
  commitCharacters?: string[]
}

export type CodeEditorCompletionActivation = 'manual' | 'auto'

export type CodeEditorCompletionTriggerKind =
  | 'invoked'
  | 'trigger-character'
  | 'incomplete'

export type CodeEditorCompletionInvocationReason =
  | 'typing'
  | 'context-boundary'

export type CodeEditorAcceptSuggestionOnEnter =
  | 'on'
  | 'off'
  | 'smart'
  | 'always'
  | 'never'
  | 'explicit'

export interface CodeEditorCompletionContext {
  activation: CodeEditorCompletionActivation
  triggerKind: CodeEditorCompletionTriggerKind
  triggerCharacter?: string
  invocationReason?: CodeEditorCompletionInvocationReason
  signal: AbortSignal
}

export interface CodeEditorCompletionList {
  items: CodeEditorCompletionItem[]
  isIncomplete?: boolean
  validFor?: RegExp
  range?: TextRange
}

export type CodeEditorCompletionResult = CodeEditorCompletionItem[] | CodeEditorCompletionList

export type CodeEditorHoverSectionKind = 'text' | 'code' | 'list' | 'warning' | 'reference'

export type CodeEditorHoverSectionPriority = 'required' | 'normal' | 'optional'

export interface CodeEditorHoverSection {
  kind: CodeEditorHoverSectionKind
  lines: readonly string[]
  priority?: CodeEditorHoverSectionPriority
  language?: string
  text?: string
  copyText?: string
}

export interface CodeEditorHoverLink {
  label: string
  href: string
  title?: string
}

export interface CodeEditorHover {
  range: TextRange
  label: string
  detail?: string
  type?: string
  documentation?: string
  sections?: readonly CodeEditorHoverSection[]
  links?: readonly CodeEditorHoverLink[]
}

export interface CodeEditorSignatureParameter {
  label: string
  documentation?: string
}

export interface CodeEditorSignature {
  label: string
  documentation?: string
  parameters: readonly CodeEditorSignatureParameter[]
}

export interface CodeEditorSignatureHelp {
  signatures: readonly CodeEditorSignature[]
  activeSignature: number
  activeParameter: number
  range?: TextRange
}

export type CodeEditorSignatureHelpTriggerKind =
  | 'invoked'
  | 'trigger-character'
  | 'content-change'
  | 'cursor-move'
  | 'retrigger-character'

export interface CodeEditorSignatureHelpContext {
  triggerKind: CodeEditorSignatureHelpTriggerKind
  triggerCharacter?: string
  isRetrigger: boolean
  signal: AbortSignal
}

export interface CodeEditorLanguageAdapter<
  TContext = unknown,
  TCompletionResult extends CodeEditorCompletionResult = CodeEditorCompletionItem[],
> {
  completionTriggerCharacters?: readonly string[]
  completionQuickSuggestionCharacters?: readonly string[]
  completionWordPattern?: RegExp
  signatureTriggerCharacters?: readonly string[]
  signatureRetriggerCharacters?: readonly string[]
  getDiagnostics?(source: string, context: TContext | undefined): MaybePromise<CodeEditorDiagnostic[]>
  getSemanticTokens?(source: string, context: TContext | undefined): MaybePromise<CodeEditorSemanticToken[]>
  getCompletions?(
    source: string,
    position: TextPosition,
    context: TContext | undefined,
    completionContext?: CodeEditorCompletionContext,
  ): MaybePromise<TCompletionResult>
  getHover?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorHover | null>
  getSignatureHelp?(
    source: string,
    position: TextPosition,
    context: TContext | undefined,
    signatureContext: CodeEditorSignatureHelpContext,
  ): MaybePromise<CodeEditorSignatureHelp | null>
  formatDocument?(source: string, context: TContext | undefined): MaybePromise<string | CodeEditorTextEdit[]>
  getCodeActions?(source: string, diagnostic: CodeEditorDiagnostic | undefined, context: TContext | undefined): MaybePromise<CodeEditorCodeAction[]>
  getDefinition?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorLocation | null>
  getReferences?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorReference[]>
  getRenameEdits?(source: string, position: TextPosition, newName: string, context: TContext | undefined): MaybePromise<CodeEditorTextEdit[]>
  getSelectionRanges?(source: string, position: TextPosition, context: TContext | undefined): MaybePromise<CodeEditorSelectionRange[]>
}

export interface RenderCodeEditorOptions<TContext = unknown> extends RenderPlainTextEditorOptions {
  languageAdapter?: CodeEditorLanguageAdapter<TContext, CodeEditorCompletionResult>
  languageContext?: TContext
  diagnosticsDebounceMs?: number
  completionTriggerCharacters?: string[]
  completionQuickSuggestionCharacters?: string[]
  completionWordPattern?: RegExp
  signatureTriggerCharacters?: string[]
  signatureRetriggerCharacters?: string[]
  signatureHelpDelayMs?: number
  quickSuggestions?: boolean
  quickSuggestionsDelayMs?: number
  acceptSuggestionOnEnter?: CodeEditorAcceptSuggestionOnEnter
  hoverDelayMs?: number
  hoverCardCloseDelayMs?: number
  onDiagnosticsChange?: (diagnostics: CodeEditorDiagnostic[]) => void
  onSemanticTokensChange?: (tokens: CodeEditorSemanticToken[]) => void
  onCompletionsChange?: (items: CodeEditorCompletionItem[]) => void
  onHoverChange?: (hover: CodeEditorHover | null) => void
  onHoverLinkClick?: (link: CodeEditorHoverLink) => void
  onSignatureHelpChange?: (help: CodeEditorSignatureHelp | null) => void
  onContextMenuRequest?: (request: CodeEditorContextMenuRequest) => void
}

export interface CodeEditorDebugState extends ReturnType<RenderPlainTextEditor['debugState']> {
  languageFeatureVersion: number
  diagnosticsCount: number
  semanticTokenCount: number
  completionCount: number
  completionVisible: boolean
  selectedCompletionLabel: string | null
  quickSuggestions: boolean
  quickSuggestionsDelayMs: number
  acceptSuggestionOnEnter: CodeEditorAcceptSuggestionOnEnter
  hoverVisible: boolean
  hoverLabel: string | null
  hoverLines: readonly string[]
  hoverRect: Rect | null
  hoverTruncated: boolean
  hoverCardInteractive: boolean
  hoverCardPointerInside: boolean
  hoverCardFocusInside: boolean
  hoverCardClosePending: boolean
  hoverLinkCount: number
  hoverCodeBlockCount: number
  hoverLinkTargets: readonly { href: string; rect: Rect }[]
  hoverCodeBlocks: readonly { blockIndex: number; blockRect: Rect; copyButtonRect: Rect | null }[]
  signatureHelpActive: boolean
  signatureHelpVisible: boolean
  signatureHelpLabel: string | null
  signatureHelpActiveParameter: number | null
  signatureHelpLines: readonly string[]
  signatureHelpRect: Rect | null
  diagnosticsDebounceMs: number
  hoverDelayMs: number
  hasLanguageAdapter: boolean
}

const COMPLETION_TRIGGER_CHARACTERS = ['.', ' ', '\n']
const COMPLETION_WORD_PATTERN = /[\p{L}\p{N}_$]/u
const COMPLETION_ROW_HEIGHT = 40
const COMPLETION_MAX_VISIBLE_ITEMS = 8
const COMPLETION_POPUP_WIDTH = 460
const COMPLETION_POPUP_PADDING = 6
type CodeEditorInfoPopupAnchor =
  | { kind: 'hover'; range: TextRange; fallbackPosition: TextPosition }
  | { kind: 'signature'; position: TextPosition }
  | { kind: 'viewport' }

export class RenderCodeEditor<TContext = unknown>
  extends RenderPlainTextEditor
  implements PopupAnchorTarget<CodeEditorInfoPopupAnchor> {
  static override debugTypeName = 'RenderCodeEditor'
  private _languageAdapter?: CodeEditorLanguageAdapter<TContext, CodeEditorCompletionResult>
  private _languageContext?: TContext
  private _diagnostics: CodeEditorDiagnostic[] = []
  private _semanticTokens: CodeEditorSemanticToken[] = []
  private _languageFeatureVersion = 0
  private _diagnosticsDebounceMs: number
  private _diagnosticsTimer: ReturnType<typeof setTimeout> | null = null
  private _diagnosticsRequestSeq = 0
  private _semanticTokensRequestSeq = 0
  private readonly _completionSession = new CodeEditorCompletionSession(COMPLETION_MAX_VISIBLE_ITEMS)
  private readonly _signatureHelpSession = new CodeEditorSignatureHelpSession()
  private _completionContextVersion = 0
  private _signatureCursorGeneration = 0
  private _navigationCursorGeneration = 0
  private _completionCursorPosition?: TextPosition
  private _quickSuggestionsTimer: ReturnType<typeof setTimeout> | null = null
  private _signatureHelpTimer: ReturnType<typeof setTimeout> | null = null
  private _codeActionsRequestSeq = 0
  private _definitionRequestSeq = 0
  private _referencesRequestSeq = 0
  private _renameRequestSeq = 0
  private _selectionRangesRequestSeq = 0
  private _disposed = false
  private readonly _completionTriggerCharactersOverride?: string[]
  private readonly _completionQuickSuggestionCharactersOverride?: string[]
  private readonly _completionWordPatternOverride?: RegExp
  private readonly _signatureTriggerCharactersOverride?: string[]
  private readonly _signatureRetriggerCharactersOverride?: string[]
  private _completionTriggerCharacters: string[]
  private _completionQuickSuggestionCharacters: string[]
  private _completionWordPattern: RegExp
  private _signatureTriggerCharacters: string[]
  private _signatureRetriggerCharacters: string[]
  private readonly _signatureHelpDelayMs: number
  private readonly _quickSuggestions: boolean
  private readonly _quickSuggestionsDelayMs: number
  private readonly _acceptSuggestionOnEnter: CodeEditorAcceptSuggestionOnEnter
  private _suppressNextCompletionTrigger = false
  private _hoverInfo: CodeEditorHover | null = null
  private _hoverAnchor: { range: TextRange; fallbackPosition: TextPosition } | null = null
  private readonly _hoverDelayMs: number
  private readonly _hoverCardCloseDelayMs: number
  private _hoverTimer: ReturnType<typeof setTimeout> | null = null
  private _hoverRequestSeq = 0
  private _hoverRequestPosition: TextPosition | null = null
  private readonly _signatureTooltip = new TooltipManager()
  private readonly _hoverCard = new HoverCardPopup()
  private _closingSignatureTooltip = false
  private _closingHoverCard = false
  private _signatureTooltipPresentationSeq = 0
  private _signatureTooltipContentPresentationSeq = 0
  private _signatureTooltipContent: RenderCodeEditorSignatureTooltipContent | null = null
  private _hoverCardPresentationSeq = 0
  private _hoverCardContentPresentationSeq = 0
  private _hoverCardContent: RenderCodeEditorHoverCardContent | null = null
  private _hoverFocusCheckSeq = 0
  private _formatRequestSeq = 0
  private _contextMenuRequestSeq = 0
  private _observedLanguageDocumentVersion = -1
  private _unsubscribeDocumentChange: () => void = () => {}
  private readonly _onDiagnosticsChange?: (diagnostics: CodeEditorDiagnostic[]) => void
  private readonly _onSemanticTokensChange?: (tokens: CodeEditorSemanticToken[]) => void
  private readonly _onCompletionsChange?: (items: CodeEditorCompletionItem[]) => void
  private readonly _onHoverChange?: (hover: CodeEditorHover | null) => void
  private readonly _onHoverLinkClick?: (link: CodeEditorHoverLink) => void
  private readonly _onSignatureHelpChange?: (help: CodeEditorSignatureHelp | null) => void
  private readonly _onContextMenuRequest?: (request: CodeEditorContextMenuRequest) => void
  private readonly _controllerChangeSubscription: () => void

  constructor(options: RenderCodeEditorOptions<TContext> = {}) {
    super(options)
    this._languageAdapter = options.languageAdapter
    this._languageContext = options.languageContext
    this._diagnosticsDebounceMs = Math.max(0, Math.floor(options.diagnosticsDebounceMs ?? 300))
    this._completionTriggerCharactersOverride = options.completionTriggerCharacters
      ? [...options.completionTriggerCharacters]
      : undefined
    this._completionQuickSuggestionCharactersOverride = options.completionQuickSuggestionCharacters
      ? [...options.completionQuickSuggestionCharacters]
      : undefined
    this._completionWordPatternOverride = options.completionWordPattern
      ? normalizeCompletionPattern(options.completionWordPattern)
      : undefined
    this._signatureTriggerCharactersOverride = options.signatureTriggerCharacters
      ? [...options.signatureTriggerCharacters]
      : undefined
    this._signatureRetriggerCharactersOverride = options.signatureRetriggerCharacters
      ? [...options.signatureRetriggerCharacters]
      : undefined
    this._completionTriggerCharacters = []
    this._completionQuickSuggestionCharacters = []
    this._completionWordPattern = normalizeCompletionPattern(COMPLETION_WORD_PATTERN)
    this._signatureTriggerCharacters = []
    this._signatureRetriggerCharacters = []
    this._syncCompletionCapabilities()
    this._syncSignatureCapabilities()
    this._signatureHelpDelayMs = Math.max(0, Math.floor(options.signatureHelpDelayMs ?? 0))
    this._quickSuggestions = options.quickSuggestions ?? false
    this._quickSuggestionsDelayMs = Math.max(0, Math.floor(options.quickSuggestionsDelayMs ?? 100))
    this._acceptSuggestionOnEnter = options.acceptSuggestionOnEnter ?? 'on'
    this._hoverDelayMs = Math.max(0, Math.floor(options.hoverDelayMs ?? 300))
    this._hoverCardCloseDelayMs = Math.max(0, Math.floor(options.hoverCardCloseDelayMs ?? 150))
    this._onDiagnosticsChange = options.onDiagnosticsChange
    this._onSemanticTokensChange = options.onSemanticTokensChange
    this._onCompletionsChange = options.onCompletionsChange
    this._onHoverChange = options.onHoverChange
    this._onHoverLinkClick = options.onHoverLinkClick
    this._onSignatureHelpChange = options.onSignatureHelpChange
    this._onContextMenuRequest = options.onContextMenuRequest
    this.setLineTokenProvider(input => this._semanticLineTokens(input))
    this._observedLanguageDocumentVersion = this.controller.document.version
    this._unsubscribeDocumentChange = this.controller.subscribeChange(change => {
      if (change.document.version === this._observedLanguageDocumentVersion) return
      this._observedLanguageDocumentVersion = change.document.version
      this._handleDocumentChange(change)
    })
    this._controllerChangeSubscription = this.controller.subscribeChange(change => {
      if (!change.result) {
        this._signatureCursorGeneration++
        this._navigationCursorGeneration++
        this.closeHover()
        this._handleCompletionCursorChange()
        this._handleSignatureCursorChange()
      }
    })
    this._refreshLanguageFeatures({ debounceDiagnostics: false })
  }

  get languageAdapter(): CodeEditorLanguageAdapter<TContext, CodeEditorCompletionResult> | undefined {
    return this._languageAdapter
  }

  set languageAdapter(adapter: CodeEditorLanguageAdapter<TContext, CodeEditorCompletionResult> | undefined) {
    this.setLanguageAdapter(adapter)
  }

  get languageContext(): TContext | undefined {
    return this._languageContext
  }

  set languageContext(context: TContext | undefined) {
    this.setLanguageContext(context)
  }

  get diagnostics(): CodeEditorDiagnostic[] {
    return cloneDiagnostics(this._diagnostics)
  }

  get semanticTokens(): CodeEditorSemanticToken[] {
    return cloneSemanticTokens(this._semanticTokens)
  }

  get completionItems(): CodeEditorCompletionItem[] {
    return cloneCompletionItems([...this._completionSession.items])
  }

  get completionVisible(): boolean {
    return this._completionSession.state === 'open'
  }

  get hoverInfo(): CodeEditorHover | null {
    return this._hoverInfo ? cloneHover(this._hoverInfo) : null
  }

  get signatureHelpInfo(): CodeEditorSignatureHelp | null {
    return this._signatureHelpSession.help
  }

  get signatureHelpActive(): boolean {
    return this._signatureHelpSession.active
  }

  get signatureHelpVisible(): boolean {
    return this._signatureHelpSession.visible
  }

  [GET_POPUP_ANCHOR_RECT](data?: CodeEditorInfoPopupAnchor): Rect {
    if (!data || data.kind === 'viewport') return this.paintBounds
    if (data.kind === 'hover') return this._visibleHoverAnchorRect(data.range, data.fallbackPosition)
    return this.positionToGlobalRect(data.position) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  }

  setLanguageAdapter(adapter: CodeEditorLanguageAdapter<TContext, CodeEditorCompletionResult> | undefined): void {
    if (this._languageAdapter === adapter) return
    this.closeSignatureHelp()
    this.closeCompletion()
    this.closeHover()
    this._invalidateLanguageOperationRequests()
    this._languageAdapter = adapter
    this._completionContextVersion++
    this._syncCompletionCapabilities()
    this._syncSignatureCapabilities()
    this._refreshLanguageFeatures({ debounceDiagnostics: false })
  }

  setLanguageContext(context: TContext | undefined): void {
    if (this._languageContext === context) return
    this.closeSignatureHelp()
    this.closeCompletion()
    this.closeHover()
    this._invalidateLanguageOperationRequests()
    this._languageContext = context
    this._completionContextVersion++
    this._refreshLanguageFeatures({ debounceDiagnostics: false })
  }

  setDiagnostics(diagnostics: CodeEditorDiagnostic[]): void {
    this._diagnostics = normalizeDiagnostics(diagnostics)
    this.setDecorations(this._diagnostics.map(diagnosticToDecoration))
    this._onDiagnosticsChange?.(this.diagnostics)
  }

  setSemanticTokens(tokens: CodeEditorSemanticToken[]): void {
    this._semanticTokens = normalizeSemanticTokens(tokens)
    this.markNeedsPaint()
    this._onSemanticTokensChange?.(this.semanticTokens)
  }

  async validateNow(): Promise<CodeEditorDiagnostic[]> {
    if (this._diagnosticsTimer) {
      clearTimeout(this._diagnosticsTimer)
      this._diagnosticsTimer = null
    }
    return this._requestDiagnostics(this._languageFeatureVersion)
  }

  async refreshSemanticTokens(): Promise<CodeEditorSemanticToken[]> {
    return this._requestSemanticTokens(this._languageFeatureVersion)
  }

  async triggerCompletion(
    position: TextPosition = this.controller.cursor,
    options: {
      activation?: CodeEditorCompletionActivation
      triggerKind?: CodeEditorCompletionTriggerKind
      triggerCharacter?: string
    } = {},
  ): Promise<CodeEditorCompletionItem[]> {
    return this._requestCompletion(position, {
      activation: options.activation ?? 'manual',
      triggerKind: options.triggerKind ?? 'invoked',
      triggerCharacter: options.triggerCharacter,
    })
  }

  private async _requestCompletion(
    position: TextPosition,
    options: {
      activation: CodeEditorCompletionActivation
      triggerKind: CodeEditorCompletionTriggerKind
      triggerCharacter?: string
      invocationReason?: CodeEditorCompletionInvocationReason
      selectionPolicy?: CompletionSelectionPolicy
    },
  ): Promise<CodeEditorCompletionItem[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getCompletions) {
      this.closeCompletion()
      return []
    }
    this._clearQuickSuggestionsTimer()
    this.closeHover()
    const activation = options.activation
    const triggerKind = options.triggerKind
    const selectionPolicy = options.selectionPolicy ?? 'preselect-first'
    const documentVersion = this.controller.document.version
    const contextVersion = this._completionContextVersion
    const handle = this._completionSession.beginRequest({
      documentVersion,
      languageContextVersion: contextVersion,
      activation,
      triggerKind,
      triggerCharacter: options.triggerCharacter,
      invocationReason: options.invocationReason,
      selectionPolicy,
    })
    let result: CodeEditorCompletionItem[] | CodeEditorCompletionList
    try {
      result = await adapter.getCompletions(this.value, position, this._languageContext, {
        activation,
        triggerKind,
        triggerCharacter: options.triggerCharacter,
        invocationReason: options.invocationReason,
        signal: handle.signal,
      })
    } catch {
      result = []
    }
    if (
      !this._completionSession.isCurrent(
        handle,
        this.controller.document.version,
        this._completionContextVersion,
      ) ||
      this._disposed
    ) {
      return this.completionItems
    }
    this._applyCompletionResult(handle, result, position)
    return this.completionItems
  }

  async triggerHover(position: TextPosition = this.controller.cursor): Promise<CodeEditorHover | null> {
    this.closeSignatureHelp()
    const adapter = this._languageAdapter
    if (!adapter?.getHover || this.textInput.composing) {
      this.closeHover()
      return null
    }
    const version = this._languageFeatureVersion
    const requestSeq = ++this._hoverRequestSeq
    this._hoverRequestPosition = { ...position }
    let hover: CodeEditorHover | null
    try {
      hover = await adapter.getHover(this.value, position, this._languageContext)
    } catch {
      hover = null
    }
    if (requestSeq !== this._hoverRequestSeq || version !== this._languageFeatureVersion || this._disposed) {
      return this.hoverInfo
    }
    this._hoverRequestPosition = null
    if (
      this._hoverInfo &&
      (this._hoverCard.debugState().pointerInside || this._hoverCard.debugState().focusInside)
    ) return this.hoverInfo
    this._setHoverInfo(hover, position)
    return this.hoverInfo
  }

  async triggerSignatureHelp(
    position: TextPosition = this.controller.cursor,
    options: {
      triggerKind?: CodeEditorSignatureHelpTriggerKind
      triggerCharacter?: string
      isRetrigger?: boolean
    } = {},
  ): Promise<CodeEditorSignatureHelp | null> {
    if (this.completionVisible) {
      this._signatureHelpSession.suppressNextCompletionCloseRetrigger()
      this.closeCompletion()
    }
    this.closeHover()
    const handle = this._beginSignatureHelpRequest(position, {
      triggerKind: options.triggerKind ?? 'invoked',
      triggerCharacter: options.triggerCharacter,
      isRetrigger: options.isRetrigger ?? false,
    })
    if (!handle) return null
    return this._performSignatureHelpRequest(handle)
  }

  closeCompletion(): void {
    this._clearQuickSuggestionsTimer()
    const hadItems = this._completionSession.items.length > 0
    const wasVisible = this.completionVisible
    const wasLoading = this._completionSession.state === 'loading'
    this._completionSession.close()
    this._completionCursorPosition = undefined
    if (hadItems || wasVisible || wasLoading) {
      this._onCompletionsChange?.([])
      this.markNeedsPaint()
    }
    if (wasVisible) this._handleCompletionClosed()
  }

  closeHover(): void {
    this._hardCloseHover()
  }

  private _hardCloseHover(): void {
    this._hoverFocusCheckSeq++
    this._hoverRequestSeq++
    this._hoverRequestPosition = null
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer)
      this._hoverTimer = null
    }
    const hadHover = Boolean(this._hoverInfo || this._hoverAnchor)
    this._hoverInfo = null
    this._hoverAnchor = null
    this._hideHoverCardPreservingSession()
    if (!hadHover) return
    this._onHoverChange?.(null)
    this.markNeedsPaint()
  }

  closeSignatureHelp(): void {
    this._clearSignatureHelpTimer()
    if (!this._signatureHelpSession.close()) return
    this._publishSignatureHelp()
  }

  moveSignatureSelection(delta: number): boolean {
    if (!this._signatureHelpSession.moveActiveSignature(delta)) return false
    this._publishSignatureHelp()
    return true
  }

  moveCompletionSelection(delta: number): boolean {
    this._completionSession.setVisibleCount(this._completionRowCapacity())
    if (!this.completionVisible || !this._completionSession.moveSelection(delta)) return false
    this.markNeedsPaint()
    return true
  }

  acceptSelectedCompletion(options: { commitCharacter?: string } = {}): boolean {
    if (!this.completionVisible || this.readonly) return false
    const item = this._completionSession.currentItem
    if (!item) return false
    const cursor = this.controller.cursor
    const range = item.range ?? { start: cursor, end: cursor }
    const insertedText = (item.insertText ?? item.label) + (options.commitCharacter ?? '')
    const shouldTriggerAfterAccept = insertedText.length > 0 &&
      this._completionTriggerCharacters.includes(insertedText[insertedText.length - 1]!)
    this._suppressNextCompletionTrigger = true
    this.applyTextEdits([{
      range,
      newText: insertedText,
    }])
    this.closeCompletion()
    if (shouldTriggerAfterAccept) {
      const triggerCharacter = insertedText[insertedText.length - 1]!
      void this._requestCompletion(this.controller.cursor, {
        activation: 'auto',
        triggerKind: 'trigger-character',
        triggerCharacter,
      })
    }
    return true
  }

  async formatDocument(): Promise<boolean> {
    const adapter = this._languageAdapter
    if (!adapter?.formatDocument || this.readonly) return false
    const version = this._languageFeatureVersion
    const requestSeq = ++this._formatRequestSeq
    let result: string | CodeEditorTextEdit[]
    try {
      result = await adapter.formatDocument(this.value, this._languageContext)
    } catch {
      return false
    }
    if (requestSeq !== this._formatRequestSeq || version !== this._languageFeatureVersion || this._disposed) return false
    if (typeof result === 'string') {
      const changed = this.controller.replaceAllText(result, 'format')
      if (!changed) return false
      this.lineWidthCache.clear()
      this.markNeedsPaint()
      return true
    }
    if (result.length === 0) return false
    this.applyTextEdits(result)
    return true
  }

  async triggerCodeActions(diagnostic?: CodeEditorDiagnostic): Promise<CodeEditorCodeAction[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getCodeActions) return []
    const version = this._languageFeatureVersion
    const requestSeq = ++this._codeActionsRequestSeq
    let actions: CodeEditorCodeAction[]
    try {
      actions = await adapter.getCodeActions(this.value, diagnostic, this._languageContext)
    } catch {
      actions = []
    }
    if (requestSeq !== this._codeActionsRequestSeq || version !== this._languageFeatureVersion || this._disposed) return []
    return normalizeCodeActions(actions)
  }

  applyCodeAction(action: CodeEditorCodeAction): boolean {
    if (this.readonly || action.edits.length === 0) return false
    this.applyTextEdits(action.edits)
    return true
  }

  async goToDefinition(position: TextPosition = this.controller.cursor): Promise<CodeEditorLocation | null> {
    const adapter = this._languageAdapter
    if (!adapter?.getDefinition) return null
    const documentVersion = this.controller.document.version
    const contextVersion = this._completionContextVersion
    const navigationCursorGeneration = this._navigationCursorGeneration
    const requestSeq = ++this._definitionRequestSeq
    let location: CodeEditorLocation | null
    try {
      location = await adapter.getDefinition(this.value, position, this._languageContext)
    } catch {
      location = null
    }
    if (
      requestSeq !== this._definitionRequestSeq ||
      documentVersion !== this.controller.document.version ||
      contextVersion !== this._completionContextVersion ||
      navigationCursorGeneration !== this._navigationCursorGeneration ||
      this._disposed ||
      !location
    ) return null
    const normalized = normalizeLocation(location)
    const selection = normalized.selectionRange ?? normalized.range
    this.revealPosition(selection.start, { selectionEnd: selection.end })
    return normalized
  }

  async findReferences(position: TextPosition = this.controller.cursor): Promise<CodeEditorReference[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getReferences) return []
    const documentVersion = this.controller.document.version
    const contextVersion = this._completionContextVersion
    const navigationCursorGeneration = this._navigationCursorGeneration
    const requestSeq = ++this._referencesRequestSeq
    let references: CodeEditorReference[]
    try {
      references = await adapter.getReferences(this.value, position, this._languageContext)
    } catch {
      references = []
    }
    if (
      requestSeq !== this._referencesRequestSeq ||
      documentVersion !== this.controller.document.version ||
      contextVersion !== this._completionContextVersion ||
      navigationCursorGeneration !== this._navigationCursorGeneration ||
      this._disposed
    ) return []
    return normalizeReferences(references)
  }

  async renameSymbol(newName: string, position: TextPosition = this.controller.cursor): Promise<CodeEditorTextEdit[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getRenameEdits || this.readonly) return []
    const version = this._languageFeatureVersion
    const requestSeq = ++this._renameRequestSeq
    let edits: CodeEditorTextEdit[]
    try {
      edits = await adapter.getRenameEdits(this.value, position, newName, this._languageContext)
    } catch {
      edits = []
    }
    if (requestSeq !== this._renameRequestSeq || version !== this._languageFeatureVersion || this._disposed || edits.length === 0) return []
    const normalized = normalizeTextEdits(edits)
    this.applyTextEdits(normalized)
    return normalized
  }

  async expandSelection(position: TextPosition = this.controller.cursor): Promise<CodeEditorSelectionRange | null> {
    const adapter = this._languageAdapter
    if (!adapter?.getSelectionRanges) return null
    const version = this._languageFeatureVersion
    const requestSeq = ++this._selectionRangesRequestSeq
    let ranges: CodeEditorSelectionRange[]
    try {
      ranges = await adapter.getSelectionRanges(this.value, position, this._languageContext)
    } catch {
      ranges = []
    }
    if (requestSeq !== this._selectionRangesRequestSeq || version !== this._languageFeatureVersion || this._disposed) return null
    const current = this.controller.selection
    const normalized = normalizeSelectionRanges(ranges)
    const next = normalized.find(item => isRangeExpansion(current, item.range))
      ?? normalized.find(item => rangeContainsPosition(item.range, position))
      ?? null
    if (!next) return null
    this.revealPosition(next.range.start, { selectionEnd: next.range.end })
    return next
  }

  async selectSelectionRangeAt(position: TextPosition = this.controller.cursor): Promise<CodeEditorSelectionRange | null> {
    const adapter = this._languageAdapter
    if (!adapter?.getSelectionRanges) return null
    const version = this._languageFeatureVersion
    const requestSeq = ++this._selectionRangesRequestSeq
    let ranges: CodeEditorSelectionRange[]
    try {
      ranges = await adapter.getSelectionRanges(this.value, position, this._languageContext)
    } catch {
      ranges = []
    }
    if (requestSeq !== this._selectionRangesRequestSeq || version !== this._languageFeatureVersion || this._disposed) return null
    const next = normalizeSelectionRanges(ranges).find(item => rangeContainsPosition(item.range, position)) ?? null
    if (!next) return null
    this.revealPosition(next.range.start, { selectionEnd: next.range.end })
    return next
  }

  applyTextEdits(edits: CodeEditorTextEdit[]): void {
    if (this.readonly || edits.length === 0) return
    const sorted = normalizeTextEdits(edits)
      .sort((left, right) => comparePositionDesc(left.range.start, right.range.start))
    this.controller.runEditTransaction('apply-edits', () => {
      for (const edit of sorted) this.controller.replaceRange(edit.range, edit.newText)
    })
    this.lineWidthCache.clear()
    this.markNeedsPaint()
  }

  override get scrollX(): number {
    return super.scrollX
  }

  override set scrollX(value: number) {
    const before = super.scrollX
    super.scrollX = value
    if (super.scrollX !== before) {
      this.closeHover()
      this.closeSignatureHelp()
    }
  }

  override get scrollY(): number {
    return super.scrollY
  }

  override set scrollY(value: number) {
    const before = super.scrollY
    super.scrollY = value
    if (super.scrollY !== before) {
      this.closeHover()
      this.closeSignatureHelp()
    }
  }

  override revealPosition(position: TextPosition, options?: { selectionEnd?: TextPosition }): void {
    this.closeHover()
    this.closeSignatureHelp()
    super.revealPosition(position, options)
  }

  override focusOut(): void {
    this.closeSignatureHelp()
    super.focusOut()
    const sequence = ++this._hoverFocusCheckSeq
    queueMicrotask(() => {
      if (this._disposed || sequence !== this._hoverFocusCheckSeq) return
      if (this._hoverCard.ownsRenderObject(FocusManager.instance.current)) return
      this.closeHover()
    })
  }

  override focusIn(): void {
    this._hoverFocusCheckSeq++
    super.focusIn()
  }

  override performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const previousSize = { ...this.size }
    super.performLayout(constraints, context)
    if (this.size.width !== previousSize.width || this.size.height !== previousSize.height) {
      this._signatureTooltip.invalidateAnchoredLayout()
      if (this._hoverInfo) this._presentHoverCard(this._hoverInfo)
    }
  }

  override debugState(): CodeEditorDebugState {
    const selectedCompletion = this._completionSession.currentItem ?? null
    const hoverCard = this._currentHoverCardDebugState()
    const signatureHelp = this.signatureHelpInfo
    const signatureTooltip = this._currentSignatureTooltipDebugState()
    return {
      ...super.debugState(),
      languageFeatureVersion: this._languageFeatureVersion,
      diagnosticsCount: this._diagnostics.length,
      semanticTokenCount: this._semanticTokens.length,
      completionCount: this._completionSession.items.length,
      completionVisible: this.completionVisible,
      selectedCompletionLabel: selectedCompletion?.label ?? null,
      quickSuggestions: this._quickSuggestions,
      quickSuggestionsDelayMs: this._quickSuggestionsDelayMs,
      acceptSuggestionOnEnter: this._acceptSuggestionOnEnter,
      hoverVisible: this._hoverInfo !== null,
      hoverLabel: this._hoverInfo?.label ?? null,
      hoverLines: hoverCard?.lines ?? [],
      hoverRect: hoverCard?.rect ?? null,
      hoverTruncated: hoverCard?.truncated ?? false,
      hoverCardInteractive: this._hoverInfo !== null && this._hoverCard.debugState().open,
      hoverCardPointerInside: this._hoverCard.debugState().pointerInside,
      hoverCardFocusInside: this._hoverCard.debugState().focusInside,
      hoverCardClosePending: this._hoverCard.debugState().closePending,
      hoverLinkCount: this._hoverInfo?.links?.length ?? 0,
      hoverCodeBlockCount: this._hoverInfo?.sections?.filter(section => section.kind === 'code').length ?? 0,
      hoverLinkTargets: hoverCard?.links.map(link => ({ href: link.href, rect: { ...link.rect } })) ?? [],
      hoverCodeBlocks: hoverCard?.codeBlocks.map(block => ({
        blockIndex: block.blockIndex,
        blockRect: { ...block.blockRect },
        copyButtonRect: block.copyButtonRect ? { ...block.copyButtonRect } : null,
      })) ?? [],
      signatureHelpActive: this.signatureHelpActive,
      signatureHelpVisible: this.signatureHelpVisible,
      signatureHelpLabel: signatureHelp?.signatures[signatureHelp.activeSignature]?.label ?? null,
      signatureHelpActiveParameter: signatureHelp?.activeParameter ?? null,
      signatureHelpLines: signatureTooltip?.lines ?? [],
      signatureHelpRect: signatureTooltip?.rect ?? null,
      diagnosticsDebounceMs: this._diagnosticsDebounceMs,
      hoverDelayMs: this._hoverDelayMs,
      hasLanguageAdapter: Boolean(this._languageAdapter),
    }
  }

  override performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
    this._paintCompletionPopup(context, offset)
  }

  override onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    this._contextMenuRequestSeq++
    this._definitionRequestSeq++
    this._selectionRangesRequestSeq++
    this.closeHover()
    if (this.completionVisible) {
      const index = this._completionIndexAt(event.position)
      if (index >= 0) {
        this._completionSession.setSelectedIndex(index)
        this.acceptSelectedCompletion()
        return
      }
      this.closeCompletion()
    }
    if (event.ctrlKey || event.metaKey) {
      void this.goToDefinition(this.globalPointToPosition(event.position))
      return
    }
    super.onPointerDown(event)
  }

  override onPointerMove(event: PointerEvent): void {
    super.onPointerMove(event)
    if (this.hasActivePointerEdit) {
      this._hardCloseHover()
      return
    }
    if (!this.hitTest(event.position) || this.completionVisible) {
      this._hardCloseHover()
      return
    }
    const position = this.globalPointToPosition(event.position)
    if (this._hoverInfo && this._isPointerInsideHoverRange(position)) {
      this._hoverCard.notifyAnchorEnter()
      if (this._hoverTimer) {
        clearTimeout(this._hoverTimer)
        this._hoverTimer = null
      }
      return
    }
    if (this._hoverInfo) this._hoverCard.notifyAnchorLeave()
    this._scheduleHover(position)
  }

  override onPointerLeave(event: PointerEvent): void {
    super.onPointerLeave(event)
    if (this._hoverInfo) this._hoverCard.notifyAnchorLeave()
    else this._hardCloseHover()
  }

  override detach(): void {
    this._invalidateLanguageOperationRequests()
    this.closeCompletion()
    this.closeHover()
    this.closeSignatureHelp()
    super.detach()
  }

  protected override onVisibilityChanged(visible: boolean): void {
    if (!visible) {
      this._invalidateLanguageOperationRequests()
      this.closeCompletion()
      this.closeHover()
      this.closeSignatureHelp()
    }
    super.onVisibilityChanged(visible)
  }

  override onWheel(event: WheelPointerEvent): boolean {
    if (this.hitTest(event.position)) {
      this.closeHover()
      this.closeSignatureHelp()
    }
    const rect = this._completionPopupRect()
    if (rect && pointInRect(event.position, rect)) {
      if (event.deltaY === 0) return true
      const rows = Math.sign(event.deltaY) * Math.max(1, Math.round(Math.abs(event.deltaY) / COMPLETION_ROW_HEIGHT))
      if (this._completionSession.scrollVisibleRows(rows)) this.markNeedsPaint()
      return true
    }
    return super.onWheel(event)
  }

  onContextMenu(position: Offset): boolean {
    if (!this.hitTest(position)) return false
    if (!this._onContextMenuRequest) return false
    const textPosition = this.globalPointToPosition(position)
    const diagnostic = this._diagnosticAtPosition(textPosition)
    this.closeHover()
    this.closeCompletion()
    if (!this._selectionContainsPosition(textPosition)) {
      this.revealPosition(textPosition)
    }
    const contextMenuRequestSeq = ++this._contextMenuRequestSeq
    const version = this._languageFeatureVersion
    void this.triggerCodeActions(diagnostic).then(codeActions => {
      if (
        this._disposed ||
        contextMenuRequestSeq !== this._contextMenuRequestSeq ||
        version !== this._languageFeatureVersion
      ) return
      this._onContextMenuRequest?.({
        position: { ...position },
        textPosition,
        diagnostic,
        codeActions,
      })
    })
    return true
  }

  override onDoubleClick(position: Offset): void {
    const hit = this.hitDoubleClickTextPosition(position)
    super.onDoubleClick(position)
    if (!hit) return
    void this.selectSelectionRangeAt(hit)
  }

  override dispose(): void {
    if (this._disposed) return
    this.closeSignatureHelp()
    this._disposed = true
    this._hoverInfo = null
    this._hoverAnchor = null
    this._hoverRequestPosition = null
    this._hoverFocusCheckSeq++
    this._hoverCardPresentationSeq++
    this._signatureTooltipPresentationSeq++
    this._hoverCardContent = null
    this._signatureTooltipContent = null
    this._hoverCard.disposePopup({ restoreFocus: false })
    this._signatureTooltip.dispose()
    this._clearQuickSuggestionsTimer()
    this._completionSession.close()
    this._signatureHelpSession.close()
    this._controllerChangeSubscription()
    this._unsubscribeDocumentChange()
    this._unsubscribeDocumentChange = () => {}
    this._hoverRequestSeq++
    this._diagnosticsRequestSeq++
    this._semanticTokensRequestSeq++
    this._invalidateLanguageOperationRequests()
    if (this._diagnosticsTimer) {
      clearTimeout(this._diagnosticsTimer)
      this._diagnosticsTimer = null
    }
    if (this._hoverTimer) {
      clearTimeout(this._hoverTimer)
      this._hoverTimer = null
    }
    super.dispose()
  }

  private _handleDocumentChange(_change: PlainTextEditorChange): void {
    this._contextMenuRequestSeq++
    this._refreshLanguageFeatures({ debounceDiagnostics: true })
    this.closeHover()
    this._handleSignatureDocumentChange()
    if (this._suppressNextCompletionTrigger) {
      this._suppressNextCompletionTrigger = false
      this.closeCompletion()
      return
    }
    if (this.textInput.composing || this.readonly || !this._languageAdapter?.getCompletions) {
      this.closeCompletion()
      return
    }
    const cursor = this.controller.cursor
    const character = this._characterBeforeCursor()
    if (!character) {
      this.closeCompletion()
      return
    }
    if (this._isCompletionTriggerCharacter(character)) {
      this._clearQuickSuggestionsTimer()
      void this._requestCompletion(cursor, {
        activation: 'auto',
        triggerKind: 'trigger-character',
        triggerCharacter: character,
      })
      return
    }
    if (this._quickSuggestions && this._isCompletionQuickSuggestionCharacter(character)) {
      this.closeCompletion()
      this._scheduleQuickSuggestions(cursor, 'context-boundary')
      return
    }
    if (this.completionVisible) {
      if (!this._isCompletionWordCharacter(character)) {
        this.closeCompletion()
        return
      }
      const prefix = this._completionPrefixAt(cursor)
      const update = this._completionSession.updatePrefix(prefix, cursor)
      this._completionCursorPosition = { ...cursor }
      if (update === 'filtered') this._publishCompletionSession()
      else if (update === 'requery') {
        const invocationReason = this._completionSession.invocationReason
        void this._requestCompletion(cursor, {
          activation: this._completionSession.activation,
          triggerKind: 'incomplete',
          invocationReason,
          selectionPolicy: invocationReason === 'context-boundary' && prefix.length === 0
            ? 'defer-selection'
            : 'preselect-first',
        })
      } else this.closeCompletion()
      return
    }
    if (this._quickSuggestions && this._isCompletionWordCharacter(character)) {
      this._scheduleQuickSuggestions(cursor, 'typing')
      return
    }
    this.closeCompletion()
  }

  private _handleCompletionCursorChange(): void {
    if (!this.completionVisible || !this._completionCursorPosition) return
    if (positionsEqual(this.controller.cursor, this._completionCursorPosition)) return
    this.closeCompletion()
  }

  private _handleSignatureDocumentChange(): void {
    if (this.textInput.composing || this.readonly || !this._languageAdapter?.getSignatureHelp) {
      this.closeSignatureHelp()
      return
    }
    if (this._signatureHelpSession.state === 'suppressed') {
      this._signatureHelpSession.markSuppressedChange()
      return
    }
    const cursor = this.controller.cursor
    const character = this._characterBeforeCursor()
    const isTrigger = character !== undefined && this._signatureTriggerCharacters.includes(character)
    const isRetrigger = character !== undefined && this._signatureRetriggerCharacters.includes(character)
    if (isRetrigger && this._signatureHelpSession.active) {
      this._scheduleSignatureHelpRequest(cursor, {
        triggerKind: 'retrigger-character',
        triggerCharacter: character,
        isRetrigger: true,
      })
      return
    }
    if (isTrigger) {
      this._scheduleSignatureHelpRequest(cursor, {
        triggerKind: 'trigger-character',
        triggerCharacter: character,
        isRetrigger: this._signatureHelpSession.active,
      })
      return
    }
    if (this._signatureHelpSession.state === 'pending' || this._signatureHelpSession.state === 'active') {
      this._scheduleSignatureHelpRequest(cursor, {
        triggerKind: 'content-change',
        isRetrigger: true,
      })
    }
  }

  private _handleSignatureCursorChange(): void {
    if (this._signatureHelpSession.state === 'suppressed') {
      this._signatureHelpSession.markSuppressedChange()
      return
    }
    if (this._signatureHelpSession.state !== 'pending' && this._signatureHelpSession.state !== 'active') return
    this._scheduleSignatureHelpRequest(this.controller.cursor, {
      triggerKind: 'cursor-move',
      isRetrigger: true,
    })
  }

  private _refreshLanguageFeatures(options: { debounceDiagnostics: boolean }): void {
    this._languageFeatureVersion++
    void this._requestSemanticTokens(this._languageFeatureVersion)
    if (options.debounceDiagnostics) this._scheduleDiagnostics(this._languageFeatureVersion)
    else void this._requestDiagnostics(this._languageFeatureVersion)
  }

  private _scheduleDiagnostics(version: number): void {
    if (this.textInput.composing) return
    if (this._diagnosticsTimer) clearTimeout(this._diagnosticsTimer)
    this._diagnosticsTimer = setTimeout(() => {
      this._diagnosticsTimer = null
      void this._requestDiagnostics(version)
    }, this._diagnosticsDebounceMs)
  }

  private async _requestDiagnostics(version: number): Promise<CodeEditorDiagnostic[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getDiagnostics) {
      this.setDiagnostics([])
      return []
    }
    const requestSeq = ++this._diagnosticsRequestSeq
    let diagnostics: CodeEditorDiagnostic[]
    try {
      diagnostics = await adapter.getDiagnostics(this.value, this._languageContext)
    } catch (error) {
      diagnostics = [{
        range: startOfDocumentRange(),
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        source: 'language-adapter',
      }]
    }
    if (requestSeq !== this._diagnosticsRequestSeq || version !== this._languageFeatureVersion || this._disposed) {
      return this.diagnostics
    }
    this.setDiagnostics(diagnostics)
    return this.diagnostics
  }

  private async _requestSemanticTokens(version: number): Promise<CodeEditorSemanticToken[]> {
    const adapter = this._languageAdapter
    if (!adapter?.getSemanticTokens) {
      this.setSemanticTokens([])
      return []
    }
    const requestSeq = ++this._semanticTokensRequestSeq
    let tokens: CodeEditorSemanticToken[]
    try {
      tokens = await adapter.getSemanticTokens(this.value, this._languageContext)
    } catch {
      tokens = []
    }
    if (requestSeq !== this._semanticTokensRequestSeq || version !== this._languageFeatureVersion || this._disposed) {
      return this.semanticTokens
    }
    this.setSemanticTokens(tokens)
    return this.semanticTokens
  }

  private _semanticLineTokens(input: PlainTextEditorLineTokenProviderInput): TextToken[] | null {
    if (this._semanticTokens.length === 0) return null
    const tokens = this._semanticTokens
      .filter(token => token.range.start.line <= input.line && token.range.end.line >= input.line)
      .map(token => semanticTokenToTextToken(token, input.line, input.lineText.length))
      .filter((token): token is TextToken => token !== null && token.endColumn > token.startColumn)
      .sort((left, right) => left.startColumn - right.startColumn || left.endColumn - right.endColumn)
    return tokens.length > 0 ? tokens : null
  }

  protected override onEditorKeyDown(event: KeyboardEvent, _session: TextEditSessionApi): boolean {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key === ' ') {
      event.preventDefault()
      void this.triggerSignatureHelp()
      return true
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key === ' ') {
      event.preventDefault()
      void this.triggerCompletion()
      return true
    }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      void this.formatDocument()
      return true
    }
    if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
      event.preventDefault()
      void this.expandSelection()
      return true
    }
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault()
      void this.triggerCodeActions()
      return true
    }
    if (this.completionVisible) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeCompletion()
        return true
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.moveCompletionSelection(1)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveCompletionSelection(-1)
        return true
      }
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault()
        this._completionSession.setVisibleCount(this._completionRowCapacity())
        if (this._completionSession.moveSelectionPage(event.key === 'PageDown' ? 1 : -1)) this.markNeedsPaint()
        return true
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        if (this._completionSession.moveSelectionBoundary(event.key === 'Home' ? 'start' : 'end')) this.markNeedsPaint()
        return true
      }
      if (event.key === 'Enter') {
        if (!this._completionSession.currentItem) {
          this._suppressNextCompletionTrigger = true
          this.closeCompletion()
          return false
        }
        if (!this._shouldAcceptCompletionOnEnter()) {
          this._suppressNextCompletionTrigger = true
          this.closeCompletion()
          return false
        }
        event.preventDefault()
        return this.acceptSelectedCompletion()
      }
      if (event.key === 'Tab') {
        if (!this._completionSession.currentItem) {
          this.closeCompletion()
          return false
        }
        event.preventDefault()
        return this.acceptSelectedCompletion()
      }
      if (event.key.length === 1 && event.key.trim() === '') {
        this._suppressNextCompletionTrigger = !this._isCompletionQuickSuggestionCharacter(event.key)
        this.closeCompletion()
        return false
      }
      const selected = this._completionSession.currentItem ?? null
      if (selected && event.key.length === 1 && event.key.trim() !== '' && selected.commitCharacters?.includes(event.key)) {
        event.preventDefault()
        return this.acceptSelectedCompletion({ commitCharacter: event.key })
      }
    }
    if (event.key === 'Escape' && this._signatureHelpSession.active) {
      event.preventDefault()
      this.closeSignatureHelp()
      return true
    }
    if (this.signatureHelpVisible && this.signatureHelpInfo!.signatures.length > 1) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveSignatureSelection(event.key === 'ArrowDown' ? 1 : -1)
        return true
      }
    }
    return false
  }

  protected override onEditorCompositionStart(): void {
    this.closeHover()
    this.closeSignatureHelp()
  }

  private _setHoverInfo(hover: CodeEditorHover | null, fallbackPosition?: TextPosition): void {
    this._hoverInfo = hover ? normalizeHover(hover) : null
    this._hoverAnchor = this._hoverInfo ? {
      range: cloneRange(this._hoverInfo.range),
      fallbackPosition: { ...(fallbackPosition ?? this._hoverInfo.range.end) },
    } : null
    if (this._hoverInfo) this._presentHoverCard(this._hoverInfo)
    else this._hideHoverCardPreservingSession()
    this._onHoverChange?.(this.hoverInfo)
    this.markNeedsPaint()
  }

  private _scheduleHover(position: TextPosition): void {
    if (!this._languageAdapter?.getHover || this.textInput.composing) return
    if (this._signatureHelpSession.state === 'pending' || this._signatureHelpSession.state === 'active') return
    if (this._hoverInfo && rangeContainsPosition(this._hoverInfo.range, position)) {
      this._hoverCard.notifyAnchorEnter()
      return
    }
    if (this._hoverRequestPosition && positionsEqual(this._hoverRequestPosition, position)) return
    if (this._hoverRequestPosition && !positionsEqual(this._hoverRequestPosition, position)) {
      this._hoverRequestSeq++
      this._hoverRequestPosition = null
    }
    if (this._hoverTimer) clearTimeout(this._hoverTimer)
    this._hoverTimer = setTimeout(() => {
      this._hoverTimer = null
      void this.triggerHover(position)
    }, this._hoverDelayMs)
  }

  private _isPointerInsideHoverRange(position: TextPosition): boolean {
    return this._hoverInfo ? rangeContainsPosition(this._hoverInfo.range, position) : false
  }

  private _diagnosticAtPosition(position: TextPosition): CodeEditorDiagnostic | undefined {
    return this._diagnostics.find(diagnostic => rangeContainsPosition(diagnostic.range, position))
  }

  private _selectionContainsPosition(position: TextPosition): boolean {
    return this.controller.hasSelection && rangeContainsPosition(this.controller.selection, position)
  }

  private _applyCompletionResult(
    handle: CodeEditorCompletionRequestHandle,
    result: CodeEditorCompletionResult,
    position: TextPosition,
  ): void {
    const fallbackRange = this._completionFallbackRange(result, position)
    const currentPrefix = textBetweenPositions(this.controller.document, fallbackRange.start, position)
    const opened = this._completionSession.applyResult(handle, result, {
      fallbackRange,
      currentPrefix,
      defaultValidFor: completionValidFor(this._completionWordPattern),
      selectionPolicy: handle.invocationReason === 'context-boundary' && currentPrefix.length === 0
        ? 'defer-selection'
        : 'preselect-first',
    })
    this._completionCursorPosition = { ...position }
    if (opened && this.completionVisible) this._handleCompletionOpened()
    this._publishCompletionSession()
  }

  private _handleCompletionOpened(): void {
    if (!this._signatureHelpSession.suppressForCompletion()) return
    this._clearSignatureHelpTimer()
    this._publishSignatureHelp()
  }

  private _handleCompletionClosed(): void {
    if (!this._signatureHelpSession.consumeCompletionCloseRetrigger()) return
    this._scheduleSignatureHelpRequest(this.controller.cursor, {
      triggerKind: 'content-change',
      isRetrigger: true,
    })
  }

  private _beginSignatureHelpRequest(
    position: TextPosition,
    options: {
      triggerKind: CodeEditorSignatureHelpTriggerKind
      triggerCharacter?: string
      isRetrigger: boolean
    },
  ): CodeEditorSignatureHelpRequestHandle | null {
    this.closeHover()
    if (!this._languageAdapter?.getSignatureHelp || this.textInput.composing || this._disposed) {
      this.closeSignatureHelp()
      return null
    }
    this._clearSignatureHelpTimer()
    const handle = this._signatureHelpSession.beginRequest({
      documentVersion: this.controller.document.version,
      languageContextVersion: this._completionContextVersion,
      cursorGeneration: this._signatureCursorGeneration,
      position,
      triggerKind: options.triggerKind,
      triggerCharacter: options.triggerCharacter,
      isRetrigger: options.isRetrigger,
    })
    this._publishSignatureHelp()
    return handle
  }

  private _scheduleSignatureHelpRequest(
    position: TextPosition,
    options: {
      triggerKind: CodeEditorSignatureHelpTriggerKind
      triggerCharacter?: string
      isRetrigger: boolean
    },
  ): void {
    const handle = this._beginSignatureHelpRequest(position, options)
    if (!handle) return
    if (this._signatureHelpDelayMs === 0) {
      void this._performSignatureHelpRequest(handle)
      return
    }
    this._signatureHelpTimer = setTimeout(() => {
      this._signatureHelpTimer = null
      void this._performSignatureHelpRequest(handle)
    }, this._signatureHelpDelayMs)
  }

  private async _performSignatureHelpRequest(
    handle: CodeEditorSignatureHelpRequestHandle,
  ): Promise<CodeEditorSignatureHelp | null> {
    const adapter = this._languageAdapter
    if (!adapter?.getSignatureHelp || !this._signatureHelpSession.isCurrent(
      handle,
      this.controller.document.version,
      this._completionContextVersion,
      this._signatureCursorGeneration,
    )) return this.signatureHelpInfo
    let result: CodeEditorSignatureHelp | null
    try {
      result = await adapter.getSignatureHelp(
        this.value,
        handle.position,
        this._languageContext,
        {
          triggerKind: handle.triggerKind,
          triggerCharacter: handle.triggerCharacter,
          isRetrigger: handle.isRetrigger,
          signal: handle.signal,
        },
      )
    } catch {
      result = null
    }
    const applied = this._signatureHelpSession.applyResult(handle, result, {
      documentVersion: this.controller.document.version,
      languageContextVersion: this._completionContextVersion,
      cursorGeneration: this._signatureCursorGeneration,
    })
    if (!applied || this._disposed) return this.signatureHelpInfo
    this._publishSignatureHelp()
    return this.signatureHelpInfo
  }

  private _publishSignatureHelp(): void {
    const help = this.signatureHelpInfo
    if (help && this.signatureHelpVisible && !this.completionVisible) {
      this._presentSignatureTooltip(help)
    } else {
      this._hideSignatureTooltipPreservingSession()
    }
    this._onSignatureHelpChange?.(help)
    this.markNeedsPaint()
  }

  private _clearSignatureHelpTimer(): void {
    if (!this._signatureHelpTimer) return
    clearTimeout(this._signatureHelpTimer)
    this._signatureHelpTimer = null
  }

  private _completionFallbackRange(
    result: CodeEditorCompletionResult,
    position: TextPosition,
  ): TextRange {
    if (!Array.isArray(result) && result.range) return normalizeRange(result.range.start, result.range.end)
    const items = Array.isArray(result) ? result : result.items
    const itemRange = items.find(item => item.range)?.range
    if (itemRange) return normalizeRange(itemRange.start, itemRange.end)
    return this._wordRangeAt(position)
  }

  private _wordRangeAt(position: TextPosition): TextRange {
    const line = this.controller.document.getLine(position.line)
    let startColumn = Math.max(0, Math.min(line.length, position.column))
    while (startColumn > 0 && this._isCompletionWordCharacter(line[startColumn - 1]!)) startColumn--
    return {
      start: { line: position.line, column: startColumn },
      end: { ...position },
    }
  }

  private _completionPrefixAt(position: TextPosition): string {
    const start = this._completionSession.range?.start ?? position
    return textBetweenPositions(this.controller.document, start, position)
  }

  private _publishCompletionSession(): void {
    this._onCompletionsChange?.(this.completionItems)
    this.markNeedsPaint()
  }

  private _scheduleQuickSuggestions(
    position: TextPosition,
    invocationReason: CodeEditorCompletionInvocationReason,
  ): void {
    this._clearQuickSuggestionsTimer()
    const expectedVersion = this.controller.document.version
    this._quickSuggestionsTimer = setTimeout(() => {
      this._quickSuggestionsTimer = null
      if (
        this._disposed ||
        this.textInput.composing ||
        expectedVersion !== this.controller.document.version ||
        !positionsEqual(position, this.controller.cursor)
      ) return
      void this._requestCompletion(position, {
        activation: 'auto',
        triggerKind: 'invoked',
        invocationReason,
        selectionPolicy: invocationReason === 'context-boundary' ? 'defer-selection' : 'preselect-first',
      })
    }, this._quickSuggestionsDelayMs)
  }

  private _clearQuickSuggestionsTimer(): void {
    if (!this._quickSuggestionsTimer) return
    clearTimeout(this._quickSuggestionsTimer)
    this._quickSuggestionsTimer = null
  }

  private _characterBeforeCursor(): string | undefined {
    const cursor = this.controller.cursor
    if (cursor.column === 0) return cursor.line > 0 ? '\n' : undefined
    const line = this.controller.document.getLine(cursor.line)
    return line[cursor.column - 1]
  }

  private _isCompletionTriggerCharacter(character: string): boolean {
    return this._completionTriggerCharacters.includes(character)
  }

  private _isCompletionQuickSuggestionCharacter(character: string): boolean {
    return this._completionQuickSuggestionCharacters.includes(character)
  }

  private _isCompletionWordCharacter(character: string): boolean {
    this._completionWordPattern.lastIndex = 0
    return this._completionWordPattern.test(character)
  }

  private _syncCompletionCapabilities(): void {
    this._completionTriggerCharacters = [...(
      this._completionTriggerCharactersOverride
      ?? this._languageAdapter?.completionTriggerCharacters
      ?? COMPLETION_TRIGGER_CHARACTERS
    )]
    this._completionQuickSuggestionCharacters = [...(
      this._completionQuickSuggestionCharactersOverride
      ?? this._languageAdapter?.completionQuickSuggestionCharacters
      ?? []
    )]
    this._completionWordPattern = normalizeCompletionPattern(
      this._completionWordPatternOverride
      ?? this._languageAdapter?.completionWordPattern
      ?? COMPLETION_WORD_PATTERN,
    )
  }

  private _syncSignatureCapabilities(): void {
    this._signatureTriggerCharacters = [...(
      this._signatureTriggerCharactersOverride
      ?? this._languageAdapter?.signatureTriggerCharacters
      ?? []
    )]
    this._signatureRetriggerCharacters = [...(
      this._signatureRetriggerCharactersOverride
      ?? this._languageAdapter?.signatureRetriggerCharacters
      ?? []
    )]
  }

  private _shouldAcceptCompletionOnEnter(): boolean {
    if (this._acceptSuggestionOnEnter === 'on' || this._acceptSuggestionOnEnter === 'always') return true
    if (this._acceptSuggestionOnEnter === 'off' || this._acceptSuggestionOnEnter === 'never') return false
    return this._completionSession.activation === 'manual' || this._completionSession.selectionTouched
  }

  private _completionRowCapacity(): number {
    const availableHeight = Math.max(0, this.size.height - 8 - COMPLETION_POPUP_PADDING * 2)
    if (availableHeight <= 0) return 1
    return Math.max(1, Math.min(COMPLETION_MAX_VISIBLE_ITEMS, Math.floor(availableHeight / COMPLETION_ROW_HEIGHT)))
  }

  private get _completionVisibleStartIndex(): number {
    return this._completionSession.visibleStart
  }

  private _completionPopupRect(): { x: number; y: number; width: number; height: number; rowCount: number; rowHeight: number } | null {
    if (!this.completionVisible || this._completionSession.items.length === 0) return null
    const anchor = this.positionToGlobalRect(this.controller.cursor)
    if (!anchor) return null
    const availableWidth = Math.max(0, this.size.width - 8)
    const availableHeight = Math.max(0, this.size.height - 8)
    if (availableWidth <= 0 || availableHeight <= 0) return null
    const rowCount = Math.min(this._completionRowCapacity(), this._completionSession.items.length)
    const contentHeight = Math.max(1, availableHeight - COMPLETION_POPUP_PADDING * 2)
    const rowHeight = Math.max(1, Math.min(COMPLETION_ROW_HEIGHT, Math.floor(contentHeight / rowCount)))
    const width = Math.min(COMPLETION_POPUP_WIDTH, availableWidth)
    const height = Math.min(availableHeight, COMPLETION_POPUP_PADDING * 2 + rowCount * rowHeight)
    const minX = this.globalOffset.x + 4
    const minY = this.globalOffset.y + 4
    const maxX = minX + availableWidth - width
    const maxY = minY + availableHeight - height
    const belowY = anchor.y + anchor.height + 2
    const aboveY = anchor.y - height - 2
    const spaceBelow = maxY + height - belowY
    const spaceAbove = anchor.y - 2 - minY
    const preferredY = spaceBelow >= height || spaceBelow >= spaceAbove ? belowY : aboveY
    this._completionSession.setVisibleCount(rowCount)
    return {
      x: Math.max(minX, Math.min(anchor.x, maxX)),
      y: Math.max(minY, Math.min(preferredY, maxY)),
      width,
      height,
      rowCount,
      rowHeight,
    }
  }

  private _presentHoverCard(hover: CodeEditorHover): void {
    const anchorRoot = this._resolveSemanticPopupAnchorRoot()
    const hoverAnchor = this._hoverAnchor ?? {
      range: cloneRange(hover.range),
      fallbackPosition: { ...hover.range.end },
    }
    if (!anchorRoot) {
      this._hideHoverCardPreservingSession()
      return
    }
    const presentationSeq = ++this._hoverCardPresentationSeq
    const content = new RenderCodeEditorHoverCardContent({
      hover: cloneHover(hover),
      onLinkClick: this._onHoverLinkClick
        ? link => this._onHoverLinkClick?.({ ...link })
        : undefined,
      onFocusChange: focused => {
        if (presentationSeq !== this._hoverCardPresentationSeq || this._disposed) return
        if (focused) this._hoverCard.cancelScheduledDismiss()
        else this._hoverCard.scheduleDismiss()
      },
      onRequestClose: () => {
        if (presentationSeq === this._hoverCardPresentationSeq) this.closeHover()
      },
      onPointerActivity: () => {
        if (presentationSeq !== this._hoverCardPresentationSeq || this._disposed) return
        if (this._hoverTimer) {
          clearTimeout(this._hoverTimer)
          this._hoverTimer = null
        }
        if (this._hoverRequestPosition) {
          this._hoverRequestSeq++
          this._hoverRequestPosition = null
        }
      },
    })
    this._hoverCardContent = content
    this._hoverCardContentPresentationSeq = presentationSeq
    this._hoverCard.show({
      owner: this,
      anchorRoot,
      anchorMode: 'stable',
      content,
      anchor: {
        target: this,
        data: {
          kind: 'hover',
          range: cloneRange(hoverAnchor.range),
          fallbackPosition: { ...hoverAnchor.fallbackPosition },
        },
      },
      placement: 'right-start',
      fallbackPlacements: ['left-start', 'bottom-start', 'top-start'],
      overflowPreference: 'largest-space',
      minWidth: 220,
      maxWidth: 560,
      maxHeight: 360,
      closeDelayMs: this._hoverCardCloseDelayMs,
      onDismiss: () => {
        if (presentationSeq === this._hoverCardPresentationSeq) this._handleHoverCardDismissed()
      },
    })
  }

  private _presentSignatureTooltip(help: CodeEditorSignatureHelp): void {
    const anchorRoot = this._resolveSemanticPopupAnchorRoot()
    const anchorPosition = this._signatureHelpSession.lastTriggerPosition ?? this.controller.cursor
    if (!anchorRoot) {
      this._hideSignatureTooltipPreservingSession()
      return
    }
    const presentationSeq = ++this._signatureTooltipPresentationSeq
    const snapshot = cloneSignatureHelpSnapshot(help)
    this._signatureTooltipContent = null
    this._signatureTooltipContentPresentationSeq = 0
    this._signatureTooltip.showAnchored(() => {
      const content = new RenderCodeEditorSignatureTooltipContent(snapshot)
      if (presentationSeq === this._signatureTooltipPresentationSeq) {
        this._signatureTooltipContent = content
        this._signatureTooltipContentPresentationSeq = presentationSeq
      }
      return content
    }, {
      owner: this,
      anchorRoot,
      anchorMode: 'stable',
      anchor: {
        target: this,
        data: { kind: 'signature', position: { ...anchorPosition } },
      },
      boundary: { target: this, data: { kind: 'viewport' } },
      placement: 'top-start',
      overflowPreference: 'largest-space',
      maxWidth: 460,
      delay: 0,
      onDismiss: () => {
        if (presentationSeq === this._signatureTooltipPresentationSeq) {
          this._handleSignatureTooltipDismissed()
        }
      },
    })
  }

  private _hideHoverCardPreservingSession(): void {
    if (this._closingHoverCard) return
    this._closingHoverCard = true
    this._hoverCardPresentationSeq++
    this._hoverCardContent = null
    this._hoverCardContentPresentationSeq = 0
    try {
      this._hoverCard.close()
    } finally {
      this._closingHoverCard = false
    }
  }

  private _hideSignatureTooltipPreservingSession(): void {
    if (this._closingSignatureTooltip) return
    this._closingSignatureTooltip = true
    this._signatureTooltipPresentationSeq++
    this._signatureTooltipContent = null
    this._signatureTooltipContentPresentationSeq = 0
    try {
      this._signatureTooltip.hide()
    } finally {
      this._closingSignatureTooltip = false
    }
  }

  private _handleHoverCardDismissed(): void {
    if (this._closingHoverCard || this._disposed) return
    this.closeHover()
  }

  private _handleSignatureTooltipDismissed(): void {
    if (this._closingSignatureTooltip || this._disposed) return
    this.closeSignatureHelp()
  }

  private _resolveSemanticPopupAnchorRoot(): RenderObject | null {
    if (!this.owner || !this.visible) return null
    let root: RenderObject = this
    while (root.parent) root = root.parent
    return root
  }

  private _visibleHoverAnchorRect(range: TextRange, fallbackPosition: TextPosition): Rect {
    const bounds = this.paintBounds
    if (rangeContainsPosition(range, fallbackPosition)) {
      const line = fallbackPosition.line
      const segmentStart = {
        line,
        column: line === range.start.line ? range.start.column : 0,
      }
      const segmentEnd = {
        line,
        column: line === range.end.line
          ? range.end.column
          : this.controller.document.getLineLength(line),
      }
      const start = this.positionToGlobalRect(segmentStart)
      const end = this.positionToGlobalRect(segmentEnd)
      if (start && end) {
        const left = Math.min(start.x, end.x)
        const right = Math.max(start.x + start.width, end.x + end.width)
        const visibleSegment = {
          x: left,
          y: Math.min(start.y, end.y),
          width: Math.max(1, right - left),
          height: Math.max(start.height, end.height),
        }
        if (rectsStrictlyIntersect(visibleSegment, bounds)) {
          return intersectRects(visibleSegment, bounds)
        }
      }
    }

    const end = this.positionToGlobalRect(range.end)
    if (end && rectsStrictlyIntersect(end, bounds)) {
      return visibleCaretAnchor(end, bounds)
    }
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  private _currentHoverCardDebugState(): {
    lines: readonly string[]
    rect: Rect
    truncated: boolean
    links: Array<{ href: string; rect: Rect }>
    codeBlocks: Array<{ blockIndex: number; blockRect: Rect; copyButtonRect: Rect | null }>
  } | null {
    const card = this._hoverCard.debugState()
    const content = this._hoverCardContent
    if (
      !card.open ||
      !card.rect ||
      !content ||
      this._hoverCardContentPresentationSeq !== this._hoverCardPresentationSeq
    ) return null
    const contentDebug = content.interactionDebugState()
    return {
      lines: [...contentDebug.visibleTextLines],
      rect: { ...card.rect },
      truncated: contentDebug.truncated,
      links: contentDebug.links.map(link => ({ href: link.href, rect: { ...link.rect } })),
      codeBlocks: contentDebug.codeBlocks.map(block => ({
        blockIndex: block.blockIndex,
        blockRect: { ...block.blockRect },
        copyButtonRect: block.copyButtonRect ? { ...block.copyButtonRect } : null,
      })),
    }
  }

  private _currentSignatureTooltipDebugState(): {
    lines: readonly string[]
    rect: Rect
  } | null {
    const tooltip = this._signatureTooltip.debugState()
    const content = this._signatureTooltipContent
    if (
      tooltip.mode !== 'anchored' ||
      !tooltip.rect ||
      !content ||
      this._signatureTooltipContentPresentationSeq !== this._signatureTooltipPresentationSeq
    ) return null
    return {
      lines: [...content.debugState().lines],
      rect: { ...tooltip.rect },
    }
  }

  private _completionIndexAt(position: Offset): number {
    const rect = this._completionPopupRect()
    if (!rect) return -1
    if (
      position.x < rect.x ||
      position.x > rect.x + rect.width ||
      position.y < rect.y ||
      position.y > rect.y + rect.height
    ) return -1
    const row = Math.floor((position.y - rect.y - COMPLETION_POPUP_PADDING) / rect.rowHeight)
    if (row < 0 || row >= rect.rowCount) return -1
    return this._completionSession.itemIndexAtVisibleRow(row)
  }

  private _paintCompletionPopup(context: PaintContext, offset: Offset): void {
    const globalRect = this._completionPopupRect()
    if (!globalRect) return
    const dl = new DrawList(context)
    const rect = {
      x: offset.x + (globalRect.x - this.globalOffset.x),
      y: offset.y + (globalRect.y - this.globalOffset.y),
      width: globalRect.width,
      height: globalRect.height,
    }
    const theme = context.theme
    dl.fillRect(rect.x, rect.y, rect.width, rect.height, theme.surfacePanel, 4)
    dl.strokeRect(rect.x, rect.y, rect.width, rect.height, theme.borderSubtle, 1, 4)
    const visibleItems = this._completionSession.visibleItems()
    for (let index = 0; index < visibleItems.length; index += 1) {
      const item = visibleItems[index]!
      const rowY = rect.y + COMPLETION_POPUP_PADDING + index * globalRect.rowHeight
      const selected = this._completionVisibleStartIndex + index === this._completionSession.selectedIndex
      if (selected) {
        dl.fillRect(rect.x + 4, rowY, rect.width - 8, globalRect.rowHeight, theme.accentPrimary, 3)
      }
      const textColor = selected ? theme.textOnAccent : theme.textPrimary
      const metaColor = selected ? theme.textOnAccent : theme.textSecondary
      const textX = rect.x + 10
      const kindText = item.kind ?? ''
      const kindWidth = kindText
        ? Math.min(92, fitSingleLineText(kindText, 92, 11, theme.fontFamily).width)
        : 0
      const kindX = rect.x + rect.width - 12 - kindWidth
      const labelMaxWidth = Math.max(24, kindText ? kindX - textX - 10 : rect.width - 22)
      const compactRow = globalRect.rowHeight < 32
      paintSingleLineText(dl, {
        text: item.label,
        x: textX,
        y: compactRow ? rowY + globalRect.rowHeight / 2 : rowY + 13,
        maxWidth: labelMaxWidth,
        color: textColor,
        fontSize: 12,
        fontFamily: theme.fontFamily,
        fontWeight: selected ? '600' : undefined,
      })
      if (item.kind) {
        paintSingleLineText(dl, {
          text: item.kind,
          x: rect.x + rect.width - 12,
          y: compactRow ? rowY + globalRect.rowHeight / 2 : rowY + 13,
          maxWidth: 92,
          color: metaColor,
          fontSize: 11,
          fontFamily: theme.fontFamily,
          align: 'right',
        })
      }
      if (item.detail && !compactRow) {
        paintSingleLineText(dl, {
          text: item.detail,
          x: textX,
          y: rowY + 29,
          maxWidth: rect.width - 22,
          color: metaColor,
          fontSize: 11,
          fontFamily: theme.fontFamily,
        })
      }
    }
  }

  private _invalidateLanguageOperationRequests(): void {
    this._formatRequestSeq++
    this._contextMenuRequestSeq++
    this._codeActionsRequestSeq++
    this._definitionRequestSeq++
    this._referencesRequestSeq++
    this._renameRequestSeq++
    this._selectionRangesRequestSeq++
  }
}

function semanticTokenToTextToken(token: CodeEditorSemanticToken, line: number, lineLength: number): TextToken | null {
  const range = token.range
  const startColumn = line === range.start.line ? range.start.column : 0
  const endColumn = line === range.end.line ? range.end.column : lineLength
  const start = Math.max(0, Math.min(lineLength, startColumn))
  const end = Math.max(start, Math.min(lineLength, endColumn))
  if (end <= start) return null
  return { startColumn: start, endColumn: end, type: token.type }
}

function diagnosticToDecoration(diagnostic: CodeEditorDiagnostic): PlainTextEditorDecoration {
  return {
    range: diagnostic.range,
    kind: diagnostic.severity === 'warning'
      ? 'warning'
      : diagnostic.severity === 'info'
        ? 'info'
        : 'error',
    message: diagnostic.message,
  }
}

function normalizeDiagnostics(diagnostics: CodeEditorDiagnostic[]): CodeEditorDiagnostic[] {
  return diagnostics.map(diagnostic => ({
    ...diagnostic,
    severity: diagnostic.severity ?? 'error',
    range: normalizeRange(diagnostic.range.start, diagnostic.range.end),
  }))
}

function normalizeSemanticTokens(tokens: CodeEditorSemanticToken[]): CodeEditorSemanticToken[] {
  return tokens.map(token => ({
    ...token,
    modifiers: token.modifiers ? [...token.modifiers] : undefined,
    range: normalizeRange(token.range.start, token.range.end),
  }))
}

function normalizeCompletionPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
}

function completionValidFor(wordPattern: RegExp): RegExp {
  return new RegExp(`^(?:${wordPattern.source})*$`, wordPattern.flags.replace(/[gy]/g, ''))
}

function textBetweenPositions(
  document: TextDocumentModel,
  start: TextPosition,
  end: TextPosition,
): string {
  if (start.line !== end.line || end.column < start.column) return ''
  return document.getLine(start.line).slice(start.column, end.column)
}

function positionsEqual(left: TextPosition, right: TextPosition): boolean {
  return left.line === right.line && left.column === right.column
}

function pointInRect(
  point: Offset,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}

function normalizeTextEdits(edits: CodeEditorTextEdit[]): CodeEditorTextEdit[] {
  return edits.map(edit => ({
    ...edit,
    range: normalizeRange(edit.range.start, edit.range.end),
  }))
}

function normalizeLocation(location: CodeEditorLocation): CodeEditorLocation {
  return {
    ...location,
    range: normalizeRange(location.range.start, location.range.end),
    selectionRange: location.selectionRange ? normalizeRange(location.selectionRange.start, location.selectionRange.end) : undefined,
  }
}

function normalizeReferences(references: CodeEditorReference[]): CodeEditorReference[] {
  return references.map(reference => ({
    ...reference,
    range: normalizeRange(reference.range.start, reference.range.end),
  }))
}

function normalizeCodeActions(actions: CodeEditorCodeAction[]): CodeEditorCodeAction[] {
  return actions.map(action => ({
    ...action,
    edits: normalizeTextEdits(action.edits),
    diagnostics: action.diagnostics ? normalizeDiagnostics(action.diagnostics) : undefined,
  }))
}

function normalizeSelectionRanges(ranges: CodeEditorSelectionRange[]): CodeEditorSelectionRange[] {
  return ranges
    .map(range => ({
      ...range,
      range: normalizeRange(range.range.start, range.range.end),
    }))
    .sort((left, right) => rangeLength(left.range) - rangeLength(right.range))
}

function normalizeHover(hover: CodeEditorHover): CodeEditorHover {
  const sections = [
    ...(hover.sections ?? []).flatMap(normalizeHoverSection),
    ...(hover.documentation
      ? normalizeHoverSection({ kind: 'text', lines: [hover.documentation], priority: 'normal' })
      : []),
  ]
  return {
    ...hover,
    range: normalizeRange(hover.range.start, hover.range.end),
    sections,
    links: hover.links?.map(link => ({ ...link })),
  }
}

function normalizeHoverSection(section: CodeEditorHoverSection): CodeEditorHoverSection[] {
  if (section.kind === 'code') {
    const fallbackLines = section.lines.flatMap(line => line.replace(/\r\n?/g, '\n').split('\n'))
      .map(line => line.replace(/\s+$/u, ''))
    const text = section.text ?? fallbackLines.join('\n')
    if (text.length === 0 && (section.copyText ?? '').length === 0) return []
    return [{
      kind: 'code',
      priority: section.priority ?? 'normal',
      lines: text.split('\n'),
      language: section.language,
      text,
      copyText: section.copyText ?? text,
    }]
  }
  const lines = section.lines.flatMap(line => line.replace(/\r\n?/g, '\n').split('\n'))
  const normalized = lines.map(line => line.trim()).filter(Boolean)
  if (normalized.length === 0 || normalized.every(line => line.length === 0)) return []
  return [{
    kind: section.kind,
    priority: section.priority ?? 'normal',
    lines: [...normalized],
  }]
}

function cloneDiagnostics(diagnostics: CodeEditorDiagnostic[]): CodeEditorDiagnostic[] {
  return diagnostics.map(diagnostic => ({
    ...diagnostic,
    range: {
      start: { ...diagnostic.range.start },
      end: { ...diagnostic.range.end },
    },
  }))
}

function cloneSemanticTokens(tokens: CodeEditorSemanticToken[]): CodeEditorSemanticToken[] {
  return tokens.map(token => ({
    ...token,
    modifiers: token.modifiers ? [...token.modifiers] : undefined,
    range: {
      start: { ...token.range.start },
      end: { ...token.range.end },
    },
  }))
}

function cloneCompletionItems(items: CodeEditorCompletionItem[]): CodeEditorCompletionItem[] {
  return items.map(item => ({
    ...item,
    commitCharacters: item.commitCharacters ? [...item.commitCharacters] : undefined,
    range: item.range
      ? {
          start: { ...item.range.start },
          end: { ...item.range.end },
        }
      : undefined,
  }))
}

function cloneHover(hover: CodeEditorHover): CodeEditorHover {
  return {
    ...hover,
    sections: hover.sections?.map(section => ({
      ...section,
      lines: [...section.lines],
    })),
    links: hover.links?.map(link => ({ ...link })),
    range: {
      start: { ...hover.range.start },
      end: { ...hover.range.end },
    },
  }
}

function cloneRange(range: TextRange): TextRange {
  return {
    start: { ...range.start },
    end: { ...range.end },
  }
}

function rectsStrictlyIntersect(first: Rect, second: Rect): boolean {
  return first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
}

function intersectRects(first: Rect, second: Rect): Rect {
  const x = Math.max(first.x, second.x)
  const y = Math.max(first.y, second.y)
  const right = Math.min(first.x + first.width, second.x + second.width)
  const bottom = Math.min(first.y + first.height, second.y + second.height)
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

function visibleCaretAnchor(caret: Rect, bounds: Rect): Rect {
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - 1)
  const top = Math.max(caret.y, bounds.y)
  const bottom = Math.min(caret.y + caret.height, bounds.y + bounds.height)
  return {
    x: Math.min(maxX, Math.max(bounds.x, caret.x)),
    y: top,
    width: 1,
    height: Math.max(0, bottom - top),
  }
}

function cloneSignatureHelpSnapshot(help: CodeEditorSignatureHelp): CodeEditorSignatureHelp {
  return {
    signatures: help.signatures.map(signature => ({
      label: signature.label,
      documentation: signature.documentation,
      parameters: signature.parameters.map(parameter => ({
        label: parameter.label,
        documentation: parameter.documentation,
      })),
    })),
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
    range: help.range
      ? { start: { ...help.range.start }, end: { ...help.range.end } }
      : undefined,
  }
}

function comparePositionDesc(left: TextPosition, right: TextPosition): number {
  if (left.line !== right.line) return right.line - left.line
  return right.column - left.column
}

function rangeContainsPosition(range: TextRange, position: TextPosition): boolean {
  return comparePositionAsc(range.start, position) <= 0 && comparePositionAsc(position, range.end) < 0
}

function isRangeExpansion(current: TextRange, candidate: TextRange): boolean {
  if (rangesEqual(current, candidate)) return false
  return comparePositionAsc(candidate.start, current.start) <= 0 && comparePositionAsc(current.end, candidate.end) <= 0
}

function rangesEqual(left: TextRange, right: TextRange): boolean {
  return comparePositionAsc(left.start, right.start) === 0 && comparePositionAsc(left.end, right.end) === 0
}

function comparePositionAsc(left: TextPosition, right: TextPosition): number {
  if (left.line !== right.line) return left.line - right.line
  return left.column - right.column
}

function rangeLength(range: TextRange): number {
  if (range.start.line === range.end.line) return range.end.column - range.start.column
  return (range.end.line - range.start.line) * 100000 + range.end.column - range.start.column
}

function startOfDocumentRange(): TextRange {
  return {
    start: { line: 0, column: 0 },
    end: { line: 0, column: 1 },
  }
}
