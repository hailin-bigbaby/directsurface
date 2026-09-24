import type { BoxConstraints, LayoutContext, Offset, Rect, RenderObject } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import {
  hitTestScrollbarGeometry,
  paintHBar,
  paintVBar,
  resolveScrollbarGeometryForState,
  type ScrollbarGeometry,
} from '../rendering/scrollbar'
import { ClipboardController, type CopyableSelection } from '../core/clipboard'
import { FocusManager, type Focusable } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { deriveScrollbarStyle, deriveTextStyle } from '../theme/component_styles'
import { lerpColor, resolveThemeEditor, type Color, type ResolvedTheme } from '../theme/theme'
import type { InteractiveRenderObject, PointerEvent, WheelPointerEvent } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { pointerKey, type PointerKey } from '../gestures/pointer_identity'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownInline,
  MarkdownImageInline,
  MarkdownListBlock,
  MarkdownTableBlock,
  MarkdownTableAlignment,
} from './markdown_parser'
import { markdownDocumentToPlainText, markdownInlinesToPlainText, parseMarkdown, type MarkdownParseOptions } from './markdown_parser'
import { tokenizerForLanguage, type TextToken } from './plain_text_tokenizer'

export interface MarkdownLinkClickEvent {
  href: string
  title?: string
}

export interface MarkdownDocumentHeadingItem {
  id: string
  title: string
  depth: number
}

export interface MarkdownHeadingOutlineItem extends MarkdownDocumentHeadingItem {
  y: number
  height: number
}

export interface MarkdownSearchResult {
  id: string
  blockIndex: number
  lineIndex: number
  startColumn: number
  endColumn: number
  text: string
  lineText: string
  snippet: string
  y: number
  height: number
}

export interface MarkdownViewerViewportState {
  scrollY: number
  activeHeading: MarkdownHeadingOutlineItem | null
}

export type MarkdownViewerAppearance = 'framed' | 'embedded'
export type MarkdownViewerShrinkWrap = 'none' | 'height' | 'both'

export interface RenderMarkdownViewerOptions extends RenderBoxOptions {
  markdown?: string
  document?: MarkdownDocument
  parseOptions?: MarkdownParseOptions
  padding?: number
  appearance?: MarkdownViewerAppearance
  shrinkWrap?: MarkdownViewerShrinkWrap
  resolveImageSrc?: (src: string) => string
  onLinkClick?: (event: MarkdownLinkClickEvent) => void
  onViewportChange?: (state: MarkdownViewerViewportState) => void
}

export interface MarkdownViewerDebugState {
  blockCount: number
  layoutBlockCount: number
  paintedBlockCount: number
  contentHeight: number
  documentContentHeight: number
  scrollY: number
  linkCount: number
  searchResultCount: number
  activeSearchResultId: string
  imageCount: number
  visibleTextLines: string[]
  links: MarkdownViewerLinkDebugTarget[]
  codeBlocks: MarkdownViewerCodeBlockDebugState[]
  tables: MarkdownViewerTableDebugState[]
}

export interface MarkdownViewerCodeBlockDebugState {
  blockIndex: number
  language?: string
  scrollX: number
  contentWidth: number
  viewportWidth: number
  blockRect: Rect
  copyButtonRect: Rect | null
}

export interface MarkdownViewerLinkDebugTarget {
  href: string
  title?: string
  rect: Rect
}

export interface MarkdownViewerTableDebugState {
  scrollX: number
  contentWidth: number
  viewportWidth: number
  columns: number[]
}

interface MarkdownSelectionPosition {
  blockIndex: number
  lineIndex: number
  column: number
}

interface MarkdownSelection {
  anchor: MarkdownSelectionPosition
  focus: MarkdownSelectionPosition
  dragging: boolean
}

interface MarkdownSelectableLine {
  blockIndex: number
  lineIndex: number
  text: string
  y: number
  height: number
}

interface MarkdownTableSelectableLine {
  lineIndex: number
  line: MarkdownTextLine
  text: string
  rowIndex: number
  cellIndex: number
  cellLineIndex: number
  cellX: number
  cellWidth: number
}

interface MarkdownTextStyle {
  fontSize: number
  fontFamily: string
  lineHeight: number
  color: Color
  weight?: string | number
  code?: boolean
  delete?: boolean
  href?: string
  title?: string
}

interface MarkdownTextRun {
  text: string
  x: number
  width: number
  height: number
  style: MarkdownTextStyle
  image?: MarkdownImageRun
}

interface MarkdownTextLine {
  x: number
  y: number
  height: number
  runs: MarkdownTextRun[]
}

interface MarkdownImageRun {
  src: string
  resolvedSrc: string
  alt: string
  title?: string
  state: MarkdownImageLoadState
  image: HTMLImageElement | null
}

interface MarkdownLayoutBlock {
  type: MarkdownBlock['type'] | 'listMarker'
  x: number
  y: number
  width: number
  height: number
  lines?: MarkdownTextLine[]
  text?: string
  copyText?: string
  marker?: string
  checked?: boolean
  language?: string
  heading?: MarkdownHeadingOutlineItem
  code?: MarkdownCodeLayout
  table?: MarkdownTableLayout
}

interface MarkdownCodeLayout {
  key: string
  lines: string[]
  contentWidth: number
  viewportWidth: number
  scrollX: number
  lineHeight: number
  scrollbarController: ScrollbarAxisController
  hbarRect?: Rect
  copyButtonRect?: Rect
}

interface MarkdownTableLayout {
  key: string
  alignments: MarkdownTableAlignment[]
  columns: number[]
  rows: MarkdownTableRowLayout[]
  headerRows: number
  contentWidth: number
  viewportWidth: number
  scrollX: number
  scrollbarController: ScrollbarAxisController
  hbarRect?: Rect
}

interface MarkdownNestedScrollbarDragSession {
  kind: 'code' | 'table'
  key: string
  pointerKey: PointerKey
  controller: ScrollbarAxisController
  releasePointerCapture?: () => void
}

interface MarkdownTableRowLayout {
  y: number
  height: number
  cells: MarkdownTextLine[][]
}

interface MarkdownLinkRect {
  rect: Rect
  href: string
  title?: string
}

type MarkdownImageLoadState = 'loading' | 'loaded' | 'error'

interface MarkdownImageCacheEntry {
  src: string
  image: HTMLImageElement | null
  state: MarkdownImageLoadState
  naturalWidth: number
  naturalHeight: number
  generation: number
}

type InlineToken = InlineTextToken | InlineImageToken

interface InlineTextToken {
  type: 'text'
  text: string
  style: MarkdownTextStyle
}

interface InlineImageToken {
  type: 'image'
  text: string
  width: number
  height: number
  style: MarkdownTextStyle
  image: MarkdownImageRun
}

interface MarkdownLayoutContext {
  headingSlugs: Map<string, number>
  headingOutline: MarkdownHeadingOutlineItem[]
  nextCodeBlockIndex: number
  nextTableIndex: number
}

const defaultViewerWidth = 520
const defaultViewerHeight = 360
const defaultPadding = 14
const blockGap = 10
const listMarkerWidth = 24
const codePaddingX = 10
const codePaddingY = 9
const codeHBarHeight = 10
const codeCopyButtonWidth = 46
const codeCopyButtonHeight = 22
const tableCellPaddingX = 7
const tableCellPaddingY = 7
const tableHBarHeight = 10
const tableHBarGap = 4
const markdownImageDefaultWidth = 220
const markdownImageDefaultHeight = 124

export class RenderMarkdownViewer extends RenderBox implements InteractiveRenderObject, Focusable, CopyableSelection {
  static override debugTypeName = 'RenderMarkdownViewer'
  onLinkClick?: (event: MarkdownLinkClickEvent) => void
  onViewportChange?: (state: MarkdownViewerViewportState) => void
  resolveImageSrc?: (src: string) => string

  private _markdown = ''
  private _document: MarkdownDocument
  private _parseOptions: MarkdownParseOptions
  private _padding: number
  private _appearance: MarkdownViewerAppearance
  private _shrinkWrap: MarkdownViewerShrinkWrap
  private readonly _scrollbarController = new ScrollbarAxisController('vertical')
  private readonly _scrollbar = this._scrollbarController.state
  private _scrollY = 0
  private _contentHeight = 0
  private _documentContentHeight = 0
  private _scrollbarWidthValue = 10
  private _layoutBlocks: MarkdownLayoutBlock[] = []
  private _linkRects: MarkdownLinkRect[] = []
  private _paintedLinkDebugTargets: MarkdownViewerLinkDebugTarget[] = []
  private _paintedCodeDebugStates: MarkdownViewerCodeBlockDebugState[] = []
  private _paintedVisibleTextLines: string[] = []
  private _headingOutline: MarkdownHeadingOutlineItem[] = []
  private _searchQuery = ''
  private _activeSearchResultId = ''
  private _paintedBlockCount = 0
  private _codeScrollState = new Map<string, number>()
  private _tableScrollState = new Map<string, number>()
  private _codeScrollbarControllers = new Map<string, ScrollbarAxisController>()
  private _tableScrollbarControllers = new Map<string, ScrollbarAxisController>()
  private _hoveredCodeKey = ''
  private _hoveredCopyCodeKey = ''
  private _hoveredTableHBarKey = ''
  private _nestedScrollbarDrag: MarkdownNestedScrollbarDragSession | null = null
  private _selection: MarkdownSelection | null = null
  private _pendingAnchor = ''
  private _focused = false
  private _focusRegistered = false
  private _imageCache = new Map<string, MarkdownImageCacheEntry>()
  private _imageLoadToken = 0
  private _cursor = 'default'

  constructor(options: RenderMarkdownViewerOptions = {}) {
    super(options)
    this._parseOptions = options.parseOptions ?? {}
    this._appearance = options.appearance ?? 'framed'
    this._shrinkWrap = options.shrinkWrap ?? 'none'
    this._padding = options.padding ?? (this._appearance === 'embedded' ? 0 : defaultPadding)
    this.onLinkClick = options.onLinkClick
    this.onViewportChange = options.onViewportChange
    this.resolveImageSrc = options.resolveImageSrc
    if (options.document) {
      this._document = options.document
      this._markdown = options.markdown ?? ''
    } else {
      this._markdown = options.markdown ?? ''
      this._document = parseMarkdown(this._markdown, this._parseOptions)
    }
    this._syncFocusRegistration()
  }

  get markdown(): string {
    return this._markdown
  }

  set markdown(value: string) {
    if (this._markdown === value) return
    this._markdown = value
    this._replaceDocument(parseMarkdown(value, this._parseOptions))
  }

  get document(): MarkdownDocument {
    return this._document
  }

  set document(value: MarkdownDocument) {
    if (this._document === value) return
    this._markdown = ''
    this._replaceDocument(value)
  }

  private _replaceDocument(value: MarkdownDocument): void {
    this._document = value
    this._layoutBlocks = []
    this._headingOutline = []
    this._selection = null
    this._resetCodeInteraction()
    this._resetTableInteraction()
    this._pendingAnchor = ''
    this._codeScrollState.clear()
    this._tableScrollState.clear()
    this._resetNestedScrollbarControllers(this._codeScrollbarControllers)
    this._resetNestedScrollbarControllers(this._tableScrollbarControllers)
    this._clearImageCache()
    this._activeSearchResultId = ''
    this._linkRects = []
    this._clearPaintedInteractionDebug()
    this.markNeedsLayout()
  }

  get scrollY(): number {
    return this._scrollY
  }

  get isFocused(): boolean {
    return this._focused
  }

  get searchQuery(): string {
    return this._searchQuery
  }

  set searchQuery(value: string) {
    if (this._searchQuery === value) return
    this._searchQuery = value
    this._activeSearchResultId = ''
    this.markNeedsPaint()
  }

  get activeSearchResultId(): string {
    return this._activeSearchResultId
  }

  set activeSearchResultId(value: string) {
    if (this._activeSearchResultId === value) return
    this._activeSearchResultId = value
    this.markNeedsPaint()
  }

  getHeadingOutline(): MarkdownHeadingOutlineItem[] {
    return this._headingOutline.map(item => ({ ...item }))
  }

  getActiveHeading(): MarkdownHeadingOutlineItem | null {
    const heading = this._activeHeadingAt(this._scrollY)
    return heading ? { ...heading } : null
  }

  getViewportState(): MarkdownViewerViewportState {
    return {
      scrollY: this._scrollY,
      activeHeading: this.getActiveHeading(),
    }
  }

  scrollToHeading(id: string): boolean {
    const normalizedId = normalizeAnchorId(id)
    if (!normalizedId) return false
    const scrolled = this._scrollToHeadingNow(normalizedId)
    if (!scrolled) this._pendingAnchor = normalizedId
    return scrolled
  }

  scrollToAnchor(anchor: string): boolean {
    return this.scrollToHeading(anchor)
  }

  getSearchResults(query = this._searchQuery): MarkdownSearchResult[] {
    const normalizedQuery = normalizeSearchQuery(query)
    if (!normalizedQuery) return []
    const results: MarkdownSearchResult[] = []
    for (const line of this._searchableLines()) {
      const matches = findSearchMatches(line.text, normalizedQuery)
      for (const match of matches) {
        results.push({
          id: searchResultId(line.blockIndex, line.lineIndex, match.start),
          blockIndex: line.blockIndex,
          lineIndex: line.lineIndex,
          startColumn: match.start,
          endColumn: match.end,
          text: line.text.slice(match.start, match.end),
          lineText: line.text,
          snippet: createSearchSnippet(line.text, match.start, match.end),
          y: line.y,
          height: line.height,
        })
      }
    }
    return results
  }

  getPlainText(): string {
    return markdownDocumentToPlainText(this._document)
  }

  getCopyText(): string {
    return this._selectedText() ?? this.getPlainText()
  }

  scrollToTop(): void {
    if (this._scrollY === 0) return
    this._scrollY = 0
    this._clearPaintedInteractionDebug()
    this.markNeedsPaint()
    this._notifyViewportChange()
  }

  scrollToSearchResult(target: number | string): boolean {
    const results = this.getSearchResults()
    if (results.length === 0) return false
    const result = typeof target === 'number'
      ? results[target]
      : results.find(item => item.id === target)
    if (!result) return false
    this.activeSearchResultId = result.id
    const before = this._scrollY
    this._scrollY = this._scrollOffsetForVisibleSearchResult(result)
    this._clearPaintedInteractionDebug()
    this.markNeedsPaint()
    if (this._scrollY !== before) this._notifyViewportChange()
    return true
  }

  debugState(): MarkdownViewerDebugState {
    return {
      blockCount: this._document.blocks.length,
      layoutBlockCount: this._layoutBlocks.length,
      paintedBlockCount: this._paintedBlockCount,
      contentHeight: this._contentHeight,
      documentContentHeight: this._documentContentHeight,
      scrollY: this._scrollY,
      linkCount: this._linkRects.length,
      searchResultCount: this.getSearchResults().length,
      activeSearchResultId: this._activeSearchResultId,
      imageCount: this._imageCache.size,
      visibleTextLines: [...this._paintedVisibleTextLines],
      links: this._paintedLinkDebugTargets.map(target => ({
        ...target,
        rect: { ...target.rect },
      })),
      codeBlocks: this._layoutBlocks
        .map((block, blockIndex) => ({ block, blockIndex }))
        .filter((entry): entry is { block: MarkdownLayoutBlock & { code: MarkdownCodeLayout }; blockIndex: number } =>
          entry.block.type === 'codeBlock' && entry.block.code !== undefined)
        .map(({ block, blockIndex }) => {
          const painted = this._paintedCodeDebugStates.find(state => state.blockIndex === blockIndex)
          return {
          blockIndex,
          language: block.language,
          scrollX: block.code!.scrollX,
          contentWidth: block.code!.contentWidth,
          viewportWidth: block.code!.viewportWidth,
          blockRect: painted ? { ...painted.blockRect } : { x: 0, y: 0, width: 0, height: 0 },
          copyButtonRect: painted?.copyButtonRect ? { ...painted.copyButtonRect } : null,
        }
        }),
      tables: this._layoutBlocks
        .filter(block => block.type === 'table' && block.table)
        .map(block => ({
          scrollX: block.table!.scrollX,
          contentWidth: block.table!.contentWidth,
          viewportWidth: block.table!.viewportWidth,
          columns: [...block.table!.columns],
        })),
    }
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  focusIn(): void {
    if (!this.visible) return
    this._focused = true
  }

  focusOut(): void {
    this._focused = false
  }

  onKeyDown(_event: KeyboardEvent): boolean {
    return false
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._clearPaintedInteractionDebug()
    this._linkRects = []
    this._scrollbarWidthValue = this._scrollbarWidth(context.theme)
    const maxWidth = constraints.maxWidth === Infinity ? defaultViewerWidth : constraints.maxWidth
    const maxHeight = constraints.maxHeight === Infinity
      ? Math.max(this.minHeight ?? 0, defaultViewerHeight)
      : constraints.maxHeight
    const intrinsicWidth = this._naturalDocumentWidth(context.theme, maxWidth) +
      this._padding * 2 + this._scrollbarWidthValue
    const width = this._shrinkWrap === 'both'
      ? clamp(intrinsicWidth, constraints.minWidth, maxWidth)
      : Math.max(constraints.minWidth, maxWidth)
    this.size = { width, height: Math.max(constraints.minHeight, maxHeight) }
    this._layoutDocument(context.theme)
    const height = this._shrinkWrap === 'none'
      ? Math.max(constraints.minHeight, maxHeight)
      : clamp(this._documentContentHeight, constraints.minHeight, maxHeight)
    this.size = { width, height }
    this._contentHeight = Math.max(this.size.height, this._documentContentHeight)
    if (context.pass === 'measure') return
    this._clampScroll()
    if (this._pendingAnchor && this._scrollToHeadingNow(this._pendingAnchor, { notify: false })) {
      this._pendingAnchor = ''
    }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const theme = context.theme
    const scrollbar = deriveScrollbarStyle(theme)
    const scrollbarWidth = this._scrollbarWidth(theme)
    const viewportWidth = this._viewportWidth(theme)
    const viewportHeight = this.size.height

    this._paintedBlockCount = 0
    this._linkRects = []
    this._clearPaintedInteractionDebug()

    if (this._appearance === 'framed') {
      dl.fillRect(offset.x, offset.y, this.size.width, this.size.height, theme.surfaceContent, theme.frameRounding)
      dl.strokeRect(offset.x, offset.y, this.size.width, this.size.height, theme.borderPanel, 1, theme.frameRounding)
    }
    dl.pushClip(offset.x, offset.y, viewportWidth, viewportHeight)

    const visibleTop = this._scrollY
    const visibleBottom = this._scrollY + viewportHeight
    for (const block of this._layoutBlocks) {
      if (block.y + block.height < visibleTop - 24) continue
      if (block.y > visibleBottom + 24) break
      this._paintBlock(dl, theme, block, {
        x: offset.x,
        y: offset.y - this._scrollY,
      })
      this._paintedBlockCount += 1
    }
    dl.popClip()

    this._capturePaintedInteractionDebug(theme)

    paintVBar({
      dl,
      style: scrollbar,
      trackX: offset.x + this.size.width - scrollbarWidth,
      trackY: offset.y,
      trackW: scrollbarWidth,
      trackH: this.size.height,
      viewSize: viewportHeight,
      contentSize: this._contentHeight,
      scrollOffset: this._scrollY,
      state: this._scrollbar,
    })
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (!this.hitTest(event.position)) return
    FocusManager.instance.setFocus(this)
    const localPoint = this._localPoint(event.position)
    const key = pointerKey(event)
    const scrollbarResult = this._scrollbarController.beginPointer(
      localPoint,
      this._scrollbarGeometry(),
      key,
    )
    if (scrollbarResult.handled) {
      event.stopPropagation?.()
      event.preventActivation?.()
      if (scrollbarResult.capturePointer) event.setPointerCapture?.()
      if (scrollbarResult.scrollOffset !== undefined) {
        const before = this._scrollY
        this._scrollY = scrollbarResult.scrollOffset
        this._clearPaintedInteractionDebug()
        if (this._scrollY !== before) this._notifyViewportChange()
      }
      this.markNeedsPaint()
      return
    }
    const docPoint = this._documentPoint(localPoint)
    const copyBlock = this._findCodeBlockByCopyButton(docPoint)
    if (copyBlock?.code) {
      event.stopPropagation?.()
      void ClipboardController.instance.writeText(copyBlock.copyText ?? copyBlock.text ?? '')
      return
    }
    const hbarBlock = this._findCodeBlockByHBar(docPoint)
    if (hbarBlock?.code) {
      const result = hbarBlock.code.scrollbarController.beginPointer(
        docPoint,
        this._codeScrollbarGeometry(hbarBlock.code),
        key,
      )
      if (!result.handled) return
      event.stopPropagation?.()
      event.preventActivation?.()
      if (result.capturePointer) {
        event.setPointerCapture?.()
        this._nestedScrollbarDrag = {
          kind: 'code',
          key: hbarBlock.code.key,
          pointerKey: key,
          controller: hbarBlock.code.scrollbarController,
          releasePointerCapture: event.releasePointerCapture,
        }
      }
      if (result.scrollOffset !== undefined) {
        hbarBlock.code.scrollX = result.scrollOffset
        this._codeScrollState.set(hbarBlock.code.key, hbarBlock.code.scrollX)
        this._clearPaintedInteractionDebug()
      }
      this.markNeedsPaint()
      return
    }
    const tableHBarBlock = this._findTableBlockByHBar(docPoint)
    if (tableHBarBlock?.table) {
      const result = tableHBarBlock.table.scrollbarController.beginPointer(
        docPoint,
        this._tableScrollbarGeometry(tableHBarBlock.table),
        key,
      )
      if (!result.handled) return
      event.stopPropagation?.()
      event.preventActivation?.()
      if (result.capturePointer) {
        event.setPointerCapture?.()
        this._nestedScrollbarDrag = {
          kind: 'table',
          key: tableHBarBlock.table.key,
          pointerKey: key,
          controller: tableHBarBlock.table.scrollbarController,
          releasePointerCapture: event.releasePointerCapture,
        }
      }
      if (result.scrollOffset !== undefined) this._setTableScrollX(tableHBarBlock.table, result.scrollOffset)
      this.markNeedsPaint()
      return
    }
    const link = this._linkRects.find(item => pointInRect(docPoint, item.rect))
    if (link) {
      event.stopPropagation?.()
      if (isLocalAnchorHref(link.href) && this.scrollToAnchor(link.href)) return
      this.onLinkClick?.({ href: link.href, title: link.title })
      return
    }
    const selectionPosition = this._selectionPositionFromPoint(docPoint)
    if (selectionPosition) {
      event.stopPropagation?.()
      const clickCount = event.clickCount ?? 1
      if (clickCount >= 2) {
        this._selection = this._selectionFromClick(selectionPosition, clickCount)
        this.markNeedsPaint()
        return
      }
      event.setPointerCapture?.()
      this._selection = {
        anchor: selectionPosition,
        focus: selectionPosition,
        dragging: true,
      }
      this.markNeedsPaint()
      return
    }
    if (this._selection) {
      this._selection = null
      this.markNeedsPaint()
    }
  }

  onPointerMove(event: PointerEvent): void {
    const localPoint = this._localPoint(event.position)
    if (this._selection?.dragging) {
      event.stopPropagation?.()
      const docPoint = this._documentPoint(localPoint)
      const position = this._selectionPositionFromPoint(docPoint, {
        clamp: true,
      })
      if (position) {
        this._selection.focus = position
        this.markNeedsPaint()
      }
      return
    }
    if (this._nestedScrollbarDrag?.kind === 'code') {
      const session = this._nestedScrollbarDrag
      const code = this._codeLayoutByKey(session.key)
      if (!code) {
        this._cancelNestedScrollbarDrag()
        this.markNeedsPaint()
        return
      }
      const result = code.scrollbarController.updatePointer(
        this._documentPoint(localPoint),
        this._codeScrollbarGeometry(code),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      code.scrollX = result.scrollOffset ?? code.scrollX
      this._codeScrollState.set(code.key, code.scrollX)
      this._clearPaintedInteractionDebug()
      this.markNeedsPaint()
      return
    }
    if (this._nestedScrollbarDrag?.kind === 'table') {
      const session = this._nestedScrollbarDrag
      const table = this._tableLayoutByKey(session.key)
      if (!table) {
        this._cancelNestedScrollbarDrag()
        this.markNeedsPaint()
        return
      }
      const result = table.scrollbarController.updatePointer(
        this._documentPoint(localPoint),
        this._tableScrollbarGeometry(table),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      const changed = this._setTableScrollX(table, result.scrollOffset ?? table.scrollX)
      if (changed) this.markNeedsPaint()
      return
    }
    if (this._scrollbar.dragging) {
      const result = this._scrollbarController.updatePointer(
        localPoint,
        this._scrollbarGeometry(),
        pointerKey(event),
      )
      if (!result.handled) return
      event.stopPropagation?.()
      const before = this._scrollY
      this._scrollY = result.scrollOffset ?? this._scrollY
      this._clearPaintedInteractionDebug()
      this.markNeedsPaint()
      if (this._scrollY !== before) this._notifyViewportChange()
      return
    }
    const docPoint = this._documentPoint(localPoint)
    const hoveredCode = this._findCodeBlockAt(docPoint)?.code?.key ?? ''
    const hoveredCopy = this._findCodeBlockByCopyButton(docPoint)?.code?.key ?? ''
    const hoveredLink = this._linkRects.find(item => pointInRect(docPoint, item.rect))
    const hbarChanged = this._updateCodeHBarHover(docPoint)
    const tableHBarChanged = this._updateTableHBarHover(docPoint)
    const scrollbarHoverChanged = this._scrollbarController.updateHover(localPoint, this._scrollbarGeometry())
    if (scrollbarHoverChanged ||
      hoveredCode !== this._hoveredCodeKey ||
      hoveredCopy !== this._hoveredCopyCodeKey ||
      hbarChanged.changed ||
      tableHBarChanged.changed) {
      this._hoveredCodeKey = hoveredCode
      this._hoveredCopyCodeKey = hoveredCopy
      this._hoveredTableHBarKey = tableHBarChanged.key
      this.markNeedsPaint()
    }
    this._setCursor(hoveredCopy || (hoveredLink && (isLocalAnchorHref(hoveredLink.href) || this.onLinkClick))
      ? 'pointer'
      : 'default')
  }

  onPointerUp(event: PointerEvent): void {
    if (this._selection?.dragging) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
      this._selection.dragging = false
      this.markNeedsPaint()
      return
    }
    if (this._nestedScrollbarDrag?.kind === 'code') {
      const session = this._nestedScrollbarDrag
      const key = pointerKey(event)
      if (session.pointerKey !== key) return
      event.stopPropagation?.()
      const code = this._codeLayoutByKey(session.key)
      if (code) {
        session.controller.endPointer(
          this._documentPoint(this._localPoint(event.position)),
          this._codeScrollbarGeometry(code),
          key,
        )
      } else {
        session.controller.cancelPointer(key)
      }
      this._releaseNestedScrollbarDrag(event.releasePointerCapture)
      this.markNeedsPaint()
      return
    }
    if (this._nestedScrollbarDrag?.kind === 'table') {
      const session = this._nestedScrollbarDrag
      const key = pointerKey(event)
      if (session.pointerKey !== key) return
      event.stopPropagation?.()
      const table = this._tableLayoutByKey(session.key)
      if (table) {
        session.controller.endPointer(
          this._documentPoint(this._localPoint(event.position)),
          this._tableScrollbarGeometry(table),
          key,
        )
      } else {
        session.controller.cancelPointer(key)
      }
      this._releaseNestedScrollbarDrag(event.releasePointerCapture)
      this.markNeedsPaint()
      return
    }
    if (this._scrollbar.dragging) {
      const key = pointerKey(event)
      if (!this._scrollbarController.ownsPointer(key)) return
      event.stopPropagation?.()
      event.releasePointerCapture?.()
      this._scrollbarController.endPointer(this._localPoint(event.position), this._scrollbarGeometry(), key)
      this.markNeedsPaint()
    }
  }

  onPointerCancel(event: PointerEvent): void {
    if (this._selection?.dragging) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
      this._selection.dragging = false
    }
    if (this._nestedScrollbarDrag) {
      if (this._nestedScrollbarDrag.pointerKey !== pointerKey(event)) return
      event.stopPropagation?.()
      this._cancelNestedScrollbarDrag(event.releasePointerCapture)
    }
    if (this._scrollbar.dragging) {
      event.stopPropagation?.()
      event.releasePointerCapture?.()
    }
    this._scrollbarController.cancelPointer(pointerKey(event))
    this._hoveredCodeKey = ''
    this._hoveredCopyCodeKey = ''
    this._hoveredTableHBarKey = ''
    this._updateCodeHBarHover()
    this._updateTableHBarHover()
    this.markNeedsPaint()
  }

  onPointerLeave(_event: PointerEvent): void {
    const codeHBarChanged = this._updateCodeHBarHover()
    const tableHBarChanged = this._updateTableHBarHover()
    const scrollbarHoverChanged = this._scrollbarController.clearHover()
    this._setCursor('default')
    if (!scrollbarHoverChanged && !this._hoveredCodeKey && !this._hoveredCopyCodeKey && !this._hoveredTableHBarKey && !codeHBarChanged.changed && !tableHBarChanged.changed) return
    this._hoveredCodeKey = ''
    this._hoveredCopyCodeKey = ''
    this._hoveredTableHBarKey = ''
    this.markNeedsPaint()
  }

  onWheel(event: WheelPointerEvent): boolean {
    if (!this.hitTest(event.position)) return false
    const docPoint = this._documentPoint(this._localPoint(event.position))
    const codeBlock = this._findCodeBlockAt(docPoint)
    const code = codeBlock?.code
    if (code && code.contentWidth > code.viewportWidth) {
      const horizontalDelta = event.deltaX || (event.shiftKey ? event.deltaY : 0)
      if (horizontalDelta) {
        const beforeX = code.scrollX
        code.scrollX = clamp(code.scrollX + horizontalDelta, 0, Math.max(0, code.contentWidth - code.viewportWidth))
        this._codeScrollState.set(code.key, code.scrollX)
        if (code.scrollX !== beforeX) {
          this._clearPaintedInteractionDebug()
          this.markNeedsPaint()
          return true
        }
      }
    }
    const tableBlock = this._findTableBlockAt(docPoint)
    const table = tableBlock?.table
    if (table && table.contentWidth > table.viewportWidth) {
      const horizontalDelta = event.deltaX || (event.shiftKey ? event.deltaY : 0)
      if (horizontalDelta) {
        if (this._setTableScrollX(table, table.scrollX + horizontalDelta)) {
          this.markNeedsPaint()
          return true
        }
      }
    }
    const before = this._scrollY
    this._scrollY = clamp(this._scrollY + event.deltaY, 0, this._maxScrollY())
    if (this._scrollY === before) return this._contentHeight > this.size.height
    this._clearPaintedInteractionDebug()
    this.markNeedsPaint()
    this._notifyViewportChange()
    return true
  }

  override dispose(): void {
    if (this._focusRegistered && typeof window !== 'undefined') {
      FocusManager.instance.unregister(this)
      this._focusRegistered = false
    }
    this._resetCodeInteraction()
    this._resetTableInteraction()
    this._scrollbarController.reset()
    this._resetNestedScrollbarControllers(this._codeScrollbarControllers)
    this._resetNestedScrollbarControllers(this._tableScrollbarControllers)
    this._clearImageCache()
    this._setCursor('default')
    this._clearPaintedInteractionDebug()
    this.onLinkClick = undefined
    this.onViewportChange = undefined
    this.resolveImageSrc = undefined
    super.dispose()
  }

  protected override onVisibilityChanged(_visible: boolean): void {
    this._clearPaintedInteractionDebug()
    if (!this.visible) this._clearInteractionState()
    this._syncFocusRegistration()
  }

  private _layoutDocument(theme: ResolvedTheme): void {
    const blocks: MarkdownLayoutBlock[] = []
    const layoutContext: MarkdownLayoutContext = {
      headingSlugs: new Map(),
      headingOutline: [],
      nextCodeBlockIndex: 0,
      nextTableIndex: 0,
    }
    let y = this._padding
    for (const block of this._document.blocks) {
      const nextY = this._layoutBlock(block, blocks, y, this._padding, theme, layoutContext)
      y = nextY + blockGap
    }
    this._layoutBlocks = blocks
    this._validateNestedScrollbarDrag()
    this._pruneNestedScrollbarControllers(blocks)
    this._headingOutline = layoutContext.headingOutline
    this._documentContentHeight = y + this._padding
  }

  private _layoutBlock(
    block: MarkdownBlock,
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    layoutContext: MarkdownLayoutContext,
  ): number {
    switch (block.type) {
      case 'heading':
        return this._layoutHeadingBlock(block, blocks, y, indent, theme, layoutContext)
      case 'paragraph':
        return this._layoutTextBlock(block.type, block.children, blocks, y, indent, theme, normalStyle(theme))
      case 'blockquote':
        return this._layoutNestedBlocks(block.children, blocks, y, indent + 14, theme, 'blockquote', layoutContext)
      case 'list':
        return this._layoutList(block, blocks, y, indent, theme, layoutContext)
      case 'codeBlock':
        return this._layoutCodeBlock(
          block.text,
          block.copyText,
          block.language,
          blocks,
          y,
          indent,
          theme,
          layoutContext,
        )
      case 'thematicBreak':
        blocks.push({
          type: 'thematicBreak',
          x: indent,
          y,
          width: this._availableWidth(indent, theme),
          height: 14,
        })
        return y + 14
      case 'table':
        return this._layoutTable(block, blocks, y, indent, theme, layoutContext)
      case 'html':
        return this._layoutTextBlock(block.type, [{ type: 'text', text: block.text }], blocks, y, indent, theme, codeStyle(theme))
      default:
        return y
    }
  }

  private _layoutNestedBlocks(
    children: MarkdownBlock[],
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    type: MarkdownBlock['type'],
    layoutContext: MarkdownLayoutContext,
  ): number {
    const startY = y
    const marker: MarkdownLayoutBlock = {
      type,
      x: indent - 10,
      y: startY,
      width: 4,
      height: 0,
    }
    blocks.push(marker)
    let nextY = y
    for (const child of children) nextY = this._layoutBlock(child, blocks, nextY, indent, theme, layoutContext) + blockGap / 2
    marker.height = Math.max(0, nextY - startY)
    return nextY
  }

  private _layoutList(
    block: MarkdownListBlock,
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    layoutContext: MarkdownLayoutContext,
  ): number {
    let nextY = y
    for (let index = 0; index < block.items.length; index++) {
      const item = block.items[index]!
      const marker = block.ordered ? `${block.start + index}.` : '•'
      const markerY = nextY
      const itemIndent = indent + listMarkerWidth
      if (item.children.length === 0) {
        blocks.push({
          type: 'listMarker',
          marker,
          checked: item.checked,
          x: indent,
          y: markerY,
          width: listMarkerWidth,
          height: normalStyle(theme).lineHeight,
        })
        nextY += normalStyle(theme).lineHeight
        continue
      }
      for (let childIndex = 0; childIndex < item.children.length; childIndex++) {
        nextY = this._layoutBlock(item.children[childIndex]!, blocks, nextY, itemIndent, theme, layoutContext)
        if (childIndex === 0) {
          blocks.push({
            type: 'listMarker',
            marker,
            checked: item.checked,
            x: indent,
            y: markerY,
            width: listMarkerWidth,
            height: normalStyle(theme).lineHeight,
          })
        }
        nextY += block.loose ? blockGap : blockGap / 2
      }
    }
    return nextY
  }

  private _layoutHeadingBlock(
    block: Extract<MarkdownBlock, { type: 'heading' }>,
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    layoutContext: MarkdownLayoutContext,
  ): number {
    const maxWidth = this._availableWidth(indent, theme)
    const style = headingStyle(block.depth, theme)
    const lines = this._layoutInlines(block.children, maxWidth, style, theme.textAccent)
    const height = Math.max(style.lineHeight, positionTextLines(lines, y, indent))
    const heading = nextMarkdownHeading(block.raw, block.depth, y, height, layoutContext.headingSlugs)
    layoutContext.headingOutline.push(heading)
    blocks.push({
      type: 'heading',
      x: indent,
      y,
      width: maxWidth,
      height,
      lines,
      heading,
    })
    return y + height
  }

  private _layoutTextBlock(
    type: MarkdownLayoutBlock['type'],
    inlines: MarkdownInline[],
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    style: MarkdownTextStyle,
  ): number {
    const maxWidth = this._availableWidth(indent, theme)
    const lines = this._layoutInlines(inlines, maxWidth, style, theme.textAccent)
    const height = Math.max(style.lineHeight, positionTextLines(lines, y, indent))
    blocks.push({
      type,
      x: indent,
      y,
      width: maxWidth,
      height,
      lines,
    })
    return y + height
  }

  private _layoutCodeBlock(
    text: string,
    copyText: string | undefined,
    language: string | undefined,
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    layoutContext: MarkdownLayoutContext,
  ): number {
    const style = codeStyle(theme)
    const lines = text ? text.split('\n') : ['']
    const viewportWidth = Math.max(1, this._availableWidth(indent, theme) - codePaddingX * 2)
    const contentWidth = Math.max(viewportWidth, ...lines.map(line => TextMeasurer.measureWidth(line, style.fontSize, style.fontFamily)))
    const key = `code:${layoutContext.nextCodeBlockIndex++}`
    const overflow = contentWidth > viewportWidth
    const scrollX = clamp(this._codeScrollState.get(key) ?? 0, 0, Math.max(0, contentWidth - viewportWidth))
    const height = lines.length * style.lineHeight + codePaddingY * 2 + (overflow ? codeHBarHeight + 4 : 0)
    blocks.push({
      type: 'codeBlock',
      x: indent,
      y,
      width: this._availableWidth(indent, theme),
      height,
      text,
      copyText,
      language,
      code: {
        key,
        lines,
        contentWidth,
        viewportWidth,
        scrollX,
        lineHeight: style.lineHeight,
        scrollbarController: this._nestedScrollbarController(this._codeScrollbarControllers, key),
        hbarRect: overflow
          ? {
              x: indent + codePaddingX,
              y: y + height - codeHBarHeight - 4,
              width: viewportWidth,
              height: codeHBarHeight,
            }
          : undefined,
      },
    })
    return y + height
  }

  private _layoutTable(
    block: MarkdownTableBlock,
    blocks: MarkdownLayoutBlock[],
    y: number,
    indent: number,
    theme: ResolvedTheme,
    layoutContext: MarkdownLayoutContext,
  ): number {
    const style = normalStyle(theme)
    const viewportWidth = Math.max(80, this._availableWidth(indent, theme))
    const columns = resolveMarkdownTableColumns(block, viewportWidth, style)
    const contentWidth = columns.reduce((sum, column) => sum + column, 0)
    const overflow = contentWidth > viewportWidth
    const key = `table:${layoutContext.nextTableIndex++}`
    const scrollX = clamp(this._tableScrollState.get(key) ?? 0, 0, Math.max(0, contentWidth - viewportWidth))
    const rows: MarkdownTableRowLayout[] = []
    const sourceRows = [block.header, ...block.rows]
    let rowY = y
    for (const sourceRow of sourceRows) {
      const cells = sourceRow.map((cell, index) =>
        this._layoutInlines(cell, Math.max(16, columns[index]! - tableCellPaddingX * 2), index === 0 && rows.length === 0
          ? { ...style, weight: 600 }
          : style, theme.textAccent))
      const contentHeights = cells.map(cell => lineStackHeight(cell))
      const height = Math.max(style.lineHeight, ...contentHeights) + tableCellPaddingY * 2
      for (const cell of cells) {
        positionTextLines(cell, rowY + tableCellPaddingY, 0)
      }
      rows.push({ y: rowY, height, cells })
      rowY += height
    }
    const bodyHeight = Math.max(1, rowY - y)
    const height = bodyHeight + (overflow ? tableHBarHeight + tableHBarGap : 0)
    blocks.push({
      type: 'table',
      x: indent,
      y,
      width: viewportWidth,
      height,
      table: {
        key,
        alignments: block.alignments,
        columns,
        rows,
        headerRows: 1,
        contentWidth,
        viewportWidth,
        scrollX,
        scrollbarController: this._nestedScrollbarController(this._tableScrollbarControllers, key),
        hbarRect: overflow
          ? {
              x: indent,
              y: y + height - tableHBarHeight,
              width: viewportWidth,
              height: tableHBarHeight,
            }
          : undefined,
      },
    })
    return y + height
  }

  private _layoutInlines(inlines: MarkdownInline[], maxWidth: number, baseStyle: MarkdownTextStyle, linkTextColor: Color): MarkdownTextLine[] {
    return layoutInlines(inlines, maxWidth, baseStyle, linkTextColor, (inline, style) => this._imageToken(inline, maxWidth, style))
  }

  private _imageToken(inline: MarkdownImageInline, maxWidth: number, style: MarkdownTextStyle): InlineImageToken {
    const resolvedSrc = this._resolvedImageSrc(inline.src)
    const entry = this._getImageEntry(resolvedSrc)
    const size = markdownImageSize(entry, maxWidth)
    return {
      type: 'image',
      text: inline.alt || inline.title || inline.src,
      width: size.width,
      height: size.height,
      style,
      image: {
        src: inline.src,
        resolvedSrc,
        alt: inline.alt,
        title: inline.title,
        state: entry.state,
        image: entry.image,
      },
    }
  }

  private _resolvedImageSrc(src: string): string {
    return this.resolveImageSrc?.(src) ?? src
  }

  private _getImageEntry(src: string): MarkdownImageCacheEntry {
    const cached = this._imageCache.get(src)
    if (cached) return cached
    const entry: MarkdownImageCacheEntry = {
      src,
      image: null,
      state: 'loading',
      naturalWidth: 0,
      naturalHeight: 0,
      generation: this._imageLoadToken,
    }
    this._imageCache.set(src, entry)
    if (typeof Image === 'undefined') {
      entry.state = 'error'
      return entry
    }
    const generation = this._imageLoadToken
    const image = new Image()
    entry.image = image
    image.onload = () => {
      if (generation !== this._imageLoadToken || this._imageCache.get(src) !== entry) return
      entry.image = image
      entry.state = 'loaded'
      entry.naturalWidth = image.naturalWidth || image.width || markdownImageDefaultWidth
      entry.naturalHeight = image.naturalHeight || image.height || markdownImageDefaultHeight
      this.markNeedsLayout()
    }
    image.onerror = () => {
      if (generation !== this._imageLoadToken || this._imageCache.get(src) !== entry) return
      entry.image = null
      entry.state = 'error'
      this.markNeedsPaint()
    }
    image.src = src
    return entry
  }

  private _clearImageCache(): void {
    this._imageLoadToken += 1
    for (const entry of this._imageCache.values()) {
      if (!entry.image) continue
      entry.image.onload = null
      entry.image.onerror = null
    }
    this._imageCache.clear()
  }

  private _paintBlock(dl: DrawList, theme: ResolvedTheme, block: MarkdownLayoutBlock, origin: Offset): void {
    const x = origin.x + block.x
    const y = origin.y + block.y
    if (block.type === 'thematicBreak') {
      dl.line(x, y + block.height / 2, x + block.width, y + block.height / 2, theme.borderSubtle, 1)
      return
    }
    if (block.type === 'blockquote') {
      dl.fillRect(x, y, block.width, block.height, theme.borderDataStrong, 2)
      return
    }
    if (block.type === 'listMarker') {
      this._paintListMarker(dl, theme, block, x, y)
      return
    }
    if (block.type === 'codeBlock') {
      this._paintCodeBlock(dl, theme, block, x, y)
      return
    }
    if (block.type === 'table' && block.table) {
      this._paintTable(dl, theme, block, x, y)
      return
    }
    if (!block.lines) return
    for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
      this._paintLine(dl, theme, lineIndex, block.lines[lineIndex]!, block, origin)
    }
  }

  private _paintLine(
    dl: DrawList,
    theme: ResolvedTheme,
    lineIndex: number,
    line: MarkdownTextLine,
    block: MarkdownLayoutBlock,
    origin: Offset,
  ): void {
    for (const run of line.runs) {
      const x = origin.x + line.x + run.x
      const y = origin.y + line.y + (line.height - run.height) / 2
      if (run.style.code) {
        dl.fillRect(x - 3, y + 2, run.width + 6, run.height - 4, lerpColor(theme.surfaceControlActive, theme.surfacePanel, 0.35), 4)
      }
    }
    this._paintTextSelectionHighlight(dl, theme, lineIndex, line, block, origin)
    this._paintLineSearchHighlights(dl, theme, lineIndex, line, block, origin)
    for (const run of line.runs) {
      const x = origin.x + line.x + run.x
      const y = origin.y + line.y + (line.height - run.height) / 2
      if (run.image) {
        this._paintImageRun(dl, run, x, y)
        if (run.style.href) {
          this._linkRects.push({
            href: run.style.href,
            title: run.style.title,
            rect: { x: line.x + run.x, y: line.y, width: run.width, height: line.height },
          })
        }
        continue
      }
      dl.fillText(run.text, x, y + run.height / 2, run.style.color, run.style.fontSize, run.style.fontFamily, 'left', 'middle', run.style.weight)
      if (run.style.delete) {
        dl.line(x, y + run.height / 2, x + run.width, y + run.height / 2, run.style.color, 1)
      }
      if (run.style.href) {
        dl.line(x, y + run.height - 3, x + run.width, y + run.height - 3, run.style.color, 1)
        this._linkRects.push({
          href: run.style.href,
          title: run.style.title,
          rect: { x: line.x + run.x, y: line.y, width: run.width, height: line.height },
        })
      }
    }
  }

  private _paintImageRun(dl: DrawList, run: MarkdownTextRun, x: number, y: number): void {
    const image = run.image
    if (!image) return
    const theme = this.currentTheme
    const radius = 5
    dl.fillRect(x, y, run.width, run.height, lerpColor(theme.surfaceControl, theme.surfaceContent, 0.3), radius)
    dl.strokeRect(x, y, run.width, run.height, theme.borderSubtle, 1, radius)
    if (image.state === 'loaded' && image.image) {
      try {
        dl.drawImage(image.image, x, y, run.width, run.height, radius)
      } catch {
        this._paintImageFallback(dl, run, x, y, '图片绘制失败')
      }
      return
    }
    this._paintImageFallback(dl, run, x, y, image.state === 'error' ? '图片加载失败' : '图片加载中')
  }

  private _paintImageFallback(dl: DrawList, run: MarkdownTextRun, x: number, y: number, stateText: string): void {
    const theme = this.currentTheme
    const label = run.image?.alt || run.image?.title || run.image?.src || stateText
    dl.fillText(stateText, x + run.width / 2, y + run.height / 2 - 9, theme.textSecondary, 12, normalStyle(theme).fontFamily, 'center', 'middle', 600)
    dl.fillText(ellipsis(label, Math.max(8, Math.floor(run.width / 8))), x + run.width / 2, y + run.height / 2 + 10, theme.textDisabled, 11, normalStyle(theme).fontFamily, 'center', 'middle')
  }

  private _paintListMarker(dl: DrawList, theme: ResolvedTheme, block: MarkdownLayoutBlock, x: number, y: number): void {
    const style = normalStyle(theme)
    if (block.checked !== undefined) {
      const boxSize = 12
      dl.strokeRect(x + 2, y + 4, boxSize, boxSize, theme.borderControl, 1, 2)
      if (block.checked) dl.drawCheckmark(x + 4, y + 6, boxSize - 4, theme.textAccent, 2)
      return
    }
    dl.fillText(block.marker ?? '', x + block.width - 6, y + style.lineHeight / 2, theme.textSecondary, style.fontSize, style.fontFamily, 'right', 'middle')
  }

  private _paintCodeBlock(dl: DrawList, theme: ResolvedTheme, block: MarkdownLayoutBlock, x: number, y: number): void {
    const style = codeStyle(theme)
    const code = block.code
    if (!code) return
    dl.fillRect(x, y, block.width, block.height, lerpColor(theme.surfaceControl, theme.surfaceContent, 0.35), 5)
    dl.strokeRect(x, y, block.width, block.height, theme.borderSubtle, 1, 5)

    const codeX = x + codePaddingX
    const codeY = y + codePaddingY
    const codeHeight = block.height - codePaddingY * 2 - (code.contentWidth > code.viewportWidth ? codeHBarHeight + 4 : 0)
    dl.pushClip(codeX, codeY, code.viewportWidth, codeHeight)
    for (let index = 0; index < code.lines.length; index++) {
      this._paintCodeLine(
        dl,
        theme,
        code.lines[index] ?? '',
        block.language,
        this._layoutBlocks.indexOf(block),
        index,
        codeX - code.scrollX,
        codeY + index * style.lineHeight + style.lineHeight / 2,
        style,
      )
    }
    dl.popClip()

    if (block.language) {
      const label = normalizeCodeLanguageLabel(block.language)
      const width = TextMeasurer.measureWidth(label, 11, style.fontFamily) + 12
      dl.fillRect(x + block.width - width - 8, y + 6, width, 18, lerpColor(theme.surfaceControlActive, theme.surfacePanel, 0.28), 4)
      dl.fillText(label, x + block.width - 14, y + 15, theme.textSecondary, 11, style.fontFamily, 'right', 'middle', 600)
    }

    const showCopy = this._hoveredCodeKey === code.key || this._hoveredCopyCodeKey === code.key
    code.copyButtonRect = {
      x: block.x + block.width - codeCopyButtonWidth - 8,
      y: block.y + 6,
      width: codeCopyButtonWidth,
      height: codeCopyButtonHeight,
    }
    if (showCopy) {
      const pressed = this._hoveredCopyCodeKey === code.key
      dl.fillRect(x + block.width - codeCopyButtonWidth - 8, y + 6, codeCopyButtonWidth, codeCopyButtonHeight, pressed ? theme.surfaceControlHover : theme.surfaceControl, 4)
      dl.strokeRect(x + block.width - codeCopyButtonWidth - 8, y + 6, codeCopyButtonWidth, codeCopyButtonHeight, theme.borderControl, 1, 4)
      dl.fillText('复制', x + block.width - codeCopyButtonWidth / 2 - 8, y + 17, theme.textPrimary, 12, style.fontFamily, 'center', 'middle', 600)
    }

    if (code.contentWidth > code.viewportWidth) {
      const scrollbar = deriveScrollbarStyle(theme)
      code.hbarRect = {
        x: block.x + codePaddingX,
        y: block.y + block.height - codeHBarHeight - 4,
        width: code.viewportWidth,
        height: codeHBarHeight,
      }
      paintHBar({
        dl,
        style: scrollbar,
        trackX: x + codePaddingX,
        trackY: y + block.height - codeHBarHeight - 4,
        trackW: code.viewportWidth,
        trackH: codeHBarHeight,
        viewSize: code.viewportWidth,
        contentSize: code.contentWidth,
        scrollOffset: code.scrollX,
        state: code.scrollbarController.state,
      })
    } else {
      code.hbarRect = undefined
    }
  }

  private _paintCodeLine(
    dl: DrawList,
    theme: ResolvedTheme,
    line: string,
    language: string | undefined,
    blockIndex: number,
    lineIndex: number,
    x: number,
    y: number,
    style: MarkdownTextStyle,
  ): void {
    this._paintCodeSelectionHighlight(dl, theme, line, blockIndex, lineIndex, x, y, style)
    this._paintCodeSearchHighlights(dl, line, blockIndex, lineIndex, x, y, style, theme)
    if (!language || line.length > 2000) {
      dl.fillText(line, x, y, style.color, style.fontSize, style.fontFamily, 'left', 'middle')
      return
    }
    const tokens = tokenizerForLanguage(language).tokenizeLine({ line, lineNumber: 0 }).tokens
    if (tokens.length === 0) {
      dl.fillText(line, x, y, style.color, style.fontSize, style.fontFamily, 'left', 'middle')
      return
    }
    let cursor = 0
    for (const token of tokens) {
      if (token.startColumn > cursor) {
        this._paintCodeSegment(dl, line, cursor, token.startColumn, x, y, style, style.color)
      }
      this._paintCodeSegment(dl, line, token.startColumn, token.endColumn, x, y, style, codeTokenColor(token, theme))
      cursor = token.endColumn
    }
    if (cursor < line.length) {
      this._paintCodeSegment(dl, line, cursor, line.length, x, y, style, style.color)
    }
  }

  private _paintCodeSegment(
    dl: DrawList,
    line: string,
    start: number,
    end: number,
    x: number,
    y: number,
    style: MarkdownTextStyle,
    color: Color,
  ): void {
    if (end <= start) return
    const prefix = line.slice(0, start)
    const segment = line.slice(start, end)
    const segmentX = x + TextMeasurer.measureWidth(prefix, style.fontSize, style.fontFamily)
    dl.fillText(segment, segmentX, y, color, style.fontSize, style.fontFamily, 'left', 'middle')
  }

  private _paintTable(dl: DrawList, theme: ResolvedTheme, block: MarkdownLayoutBlock, x: number, y: number): void {
    const table = block.table!
    const origin = { x: x - block.x, y: y - block.y }
    let lineIndex = 0
    dl.pushClip(x, y, table.viewportWidth, block.height)
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const row = table.rows[rowIndex]!
      const rowY = origin.y + row.y
      const header = rowIndex < table.headerRows
      dl.fillRect(x, rowY, table.viewportWidth, row.height, header ? theme.surfaceDataHeader : theme.surfaceDataBody, 0)
      let cellX = block.x
      for (let cellIndex = 0; cellIndex < table.columns.length; cellIndex++) {
        const width = table.columns[cellIndex]!
        const paintedCellX = origin.x + cellX - table.scrollX
        if (paintedCellX + width >= x && paintedCellX <= x + table.viewportWidth) {
          dl.strokeRect(paintedCellX, rowY, width, row.height, theme.borderData, 0.5, 0)
        }
        const lines = row.cells[cellIndex] ?? []
        for (const line of lines) {
          const lineWidth = line.runs.reduce((sum, run) => sum + run.width, 0)
          const align = table.alignments[cellIndex]
          const cellPadding = align === 'right'
            ? width - lineWidth - tableCellPaddingX
            : align === 'center'
              ? Math.max(tableCellPaddingX, (width - lineWidth) / 2)
              : tableCellPaddingX
          const adjustedLine: MarkdownTextLine = {
            ...line,
            x: cellX + cellPadding - table.scrollX,
          }
          this._paintLine(dl, theme, lineIndex, adjustedLine, block, origin)
          lineIndex += 1
        }
        cellX += width
      }
    }
    dl.popClip()

    if (table.contentWidth > table.viewportWidth) {
      const scrollbar = deriveScrollbarStyle(theme)
      table.hbarRect = {
        x: block.x,
        y: block.y + block.height - tableHBarHeight,
        width: table.viewportWidth,
        height: tableHBarHeight,
      }
      paintHBar({
        dl,
        style: scrollbar,
        trackX: x,
        trackY: y + block.height - tableHBarHeight,
        trackW: table.viewportWidth,
        trackH: tableHBarHeight,
        viewSize: table.viewportWidth,
        contentSize: table.contentWidth,
        scrollOffset: table.scrollX,
        state: table.scrollbarController.state,
      })
    } else {
      table.hbarRect = undefined
    }
  }

  private _findCodeBlockAt(point: Offset): MarkdownLayoutBlock | null {
    return this._layoutBlocks.find(block =>
      block.type === 'codeBlock' &&
      point.x >= block.x &&
      point.x <= block.x + block.width &&
      point.y >= block.y &&
      point.y <= block.y + block.height,
    ) ?? null
  }

  private _findCodeBlockByCopyButton(point: Offset): MarkdownLayoutBlock | null {
    return this._layoutBlocks.find(block => block.type === 'codeBlock' && block.code?.copyButtonRect && pointInRect(point, block.code.copyButtonRect)) ?? null
  }

  private _findCodeBlockByHBar(point: Offset): MarkdownLayoutBlock | null {
    return this._layoutBlocks.find(block => block.type === 'codeBlock' &&
      block.code?.hbarRect &&
      hitTestScrollbarGeometry(point, this._codeScrollbarGeometry(block.code))) ?? null
  }

  private _findTableBlockAt(point: Offset): MarkdownLayoutBlock | null {
    return this._layoutBlocks.find(block =>
      block.type === 'table' &&
      block.table &&
      point.x >= block.x &&
      point.x <= block.x + block.table.viewportWidth &&
      point.y >= block.y &&
      point.y <= block.y + block.height,
    ) ?? null
  }

  private _findTableBlockByHBar(point: Offset): MarkdownLayoutBlock | null {
    return this._layoutBlocks.find(block => block.type === 'table' &&
      block.table?.hbarRect &&
      hitTestScrollbarGeometry(point, this._tableScrollbarGeometry(block.table))) ?? null
  }

  private _selectionPositionFromPoint(
    point: Offset,
    options: { blockIndex?: number; clamp?: boolean } = {},
  ): MarkdownSelectionPosition | null {
    const blockIndex = options.blockIndex ?? this._layoutBlocks.findIndex(block =>
      point.x >= block.x &&
      point.x <= block.x + block.width &&
      point.y >= block.y &&
      point.y <= block.y + block.height &&
      (Boolean(block.lines?.length) || Boolean(block.code) || Boolean(block.table)),
    )
    if (blockIndex < 0) return null
    const block = this._layoutBlocks[blockIndex]
    if (!block) return null
    if (block.code) return this._codeSelectionPositionFromPoint(blockIndex, block, point, options.clamp === true)
    if (block.lines) return this._textSelectionPositionFromPoint(blockIndex, block.lines, point, options.clamp === true)
    if (block.table) return this._tableSelectionPositionFromPoint(blockIndex, block, point, options.clamp === true)
    return null
  }

  private _codeSelectionPositionFromPoint(
    blockIndex: number,
    block: MarkdownLayoutBlock,
    point: Offset,
    clampToBlock: boolean,
  ): MarkdownSelectionPosition | null {
    const code = block.code
    if (!code) return null
    const textTop = block.y + codePaddingY
    const textBottom = block.y + block.height - codePaddingY - (code.contentWidth > code.viewportWidth ? codeHBarHeight + 4 : 0)
    const textLeft = block.x + codePaddingX
    const textRight = textLeft + code.viewportWidth
    if (!clampToBlock &&
      (point.x < textLeft || point.x > textRight || point.y < textTop || point.y > textBottom)) {
      return null
    }
    const lineIndex = clamp(Math.floor((point.y - textTop) / code.lineHeight), 0, Math.max(0, code.lines.length - 1))
    const line = code.lines[lineIndex] ?? ''
    const contentX = clamp(point.x - textLeft + code.scrollX, 0, Math.max(code.contentWidth, 0))
    return {
      blockIndex,
      lineIndex,
      column: codeColumnAtX(line, contentX, codeStyle(this.currentTheme)),
    }
  }

  private _textSelectionPositionFromPoint(
    blockIndex: number,
    lines: MarkdownTextLine[],
    point: Offset,
    clampToBlock: boolean,
  ): MarkdownSelectionPosition | null {
    if (lines.length === 0) return null
    const firstLine = lines[0]!
    const lastLine = lines[lines.length - 1]!
    const top = firstLine.y
    const bottom = lastLine.y + lastLine.height
    if (!clampToBlock && (point.y < top || point.y > bottom)) return null
    const lineIndex = lineIndexAtY(lines, point.y)
    const line = lines[lineIndex]!
    const lineText = textLineContent(line)
    return {
      blockIndex,
      lineIndex,
      column: textColumnAtX(line, point.x - line.x, lineText),
    }
  }

  private _tableSelectionPositionFromPoint(
    blockIndex: number,
    block: MarkdownLayoutBlock,
    point: Offset,
    clampToBlock: boolean,
  ): MarkdownSelectionPosition | null {
    const table = block.table
    if (!table) return null
    const lineLayouts = this._tableSelectableLineLayouts(block)
    if (lineLayouts.length === 0) return null
    const tableLeft = block.x
    const tableRight = block.x + table.viewportWidth
    const tableTop = table.rows[0]?.y ?? block.y
    const tableBottom = table.rows[table.rows.length - 1]
      ? table.rows[table.rows.length - 1]!.y + table.rows[table.rows.length - 1]!.height
      : block.y + block.height
    if (!clampToBlock && (point.x < tableLeft || point.x > tableRight || point.y < tableTop || point.y > tableBottom)) return null
    const rowIndex = tableRowIndexAtY(table, point.y)
    const contentX = point.x + table.scrollX
    const cellIndex = tableCellIndexAtX(block, table, contentX)
    const cellEntries = lineLayouts.filter(item => item.rowIndex === rowIndex && item.cellIndex === cellIndex)
    const entry = cellEntries.find(item => point.y >= item.line.y && point.y <= item.line.y + item.line.height) ??
      nearestTableLineByY(cellEntries, point.y) ??
      lineLayouts[0]!
    return {
      blockIndex,
      lineIndex: entry.lineIndex,
      column: textColumnAtX(entry.line, contentX - entry.line.x, entry.text),
    }
  }

  private _normalizedSelection(): { start: MarkdownSelectionPosition; end: MarkdownSelectionPosition } | null {
    const selection = this._selection
    if (!selection) return null
    const [start, end] = compareSelectionPositions(selection.anchor, selection.focus) <= 0
      ? [selection.anchor, selection.focus]
      : [selection.focus, selection.anchor]
    if (compareSelectionPositions(start, end) === 0) return null
    return { start, end }
  }

  private _selectionFromClick(position: MarkdownSelectionPosition, clickCount: number): MarkdownSelection | null {
    if (clickCount >= 3) return this._lineSelectionAt(position)
    if (clickCount >= 2) return this._wordSelectionAt(position)
    return null
  }

  private _wordSelectionAt(position: MarkdownSelectionPosition): MarkdownSelection | null {
    const text = this._selectableLineText(position)
    if (text === null) return null
    const range = wordRangeAtColumn(text, position.column)
    if (!range) return null
    return {
      anchor: { ...position, column: range.start },
      focus: { ...position, column: range.end },
      dragging: false,
    }
  }

  private _lineSelectionAt(position: MarkdownSelectionPosition): MarkdownSelection | null {
    const block = this._layoutBlocks[position.blockIndex]
    if (!block) return null
    if (block.lines && block.type !== 'listMarker') {
      const first = block.lines[0]
      const last = block.lines[block.lines.length - 1]
      if (!first || !last) return null
      return {
        anchor: { blockIndex: position.blockIndex, lineIndex: 0, column: 0 },
        focus: { blockIndex: position.blockIndex, lineIndex: block.lines.length - 1, column: textLineContent(last).length },
        dragging: false,
      }
    }
    const text = this._selectableLineText(position)
    if (text === null) return null
    return {
      anchor: { ...position, column: 0 },
      focus: { ...position, column: text.length },
      dragging: false,
    }
  }

  private _selectableLineText(position: MarkdownSelectionPosition): string | null {
    const block = this._layoutBlocks[position.blockIndex]
    if (!block) return null
    if (block.lines) {
      const line = block.lines[position.lineIndex]
      return line ? textLineContent(line) : null
    }
    if (block.code) return block.code.lines[position.lineIndex] ?? null
    if (block.table) {
      const line = this._tableSelectableLineLayouts(block).find(item => item.lineIndex === position.lineIndex)
      return line?.text ?? null
    }
    return null
  }

  private _selectedText(): string | null {
    const selection = this._normalizedSelection()
    if (!selection) return null
    if (selection.start.blockIndex === selection.end.blockIndex) {
      const block = this._layoutBlocks[selection.start.blockIndex]
      if (block?.table) {
        const tableText = this._selectedTableText(block, selection.start, selection.end)
        if (tableText !== null) return tableText
      }
    }
    const lines: string[] = []
    for (const line of this._selectableLines()) {
      if (compareLineToSelection(line, selection.start, selection.end) < 0) continue
      if (compareLineToSelection(line, selection.start, selection.end) > 0) break
      if (line.blockIndex === selection.start.blockIndex && line.lineIndex === selection.start.lineIndex &&
        line.blockIndex === selection.end.blockIndex && line.lineIndex === selection.end.lineIndex) {
        lines.push(line.text.slice(selection.start.column, selection.end.column))
      } else if (line.blockIndex === selection.start.blockIndex && line.lineIndex === selection.start.lineIndex) {
        lines.push(line.text.slice(selection.start.column))
      } else if (line.blockIndex === selection.end.blockIndex && line.lineIndex === selection.end.lineIndex) {
        lines.push(line.text.slice(0, selection.end.column))
      } else {
        lines.push(line.text)
      }
    }
    return lines.join('\n')
  }

  private _selectedTableText(
    block: MarkdownLayoutBlock,
    start: MarkdownSelectionPosition,
    end: MarkdownSelectionPosition,
  ): string | null {
    const table = block.table
    if (!table) return null
    const entries = this._tableSelectableLineLayouts(block)
    const startEntry = entries.find(item => item.lineIndex === start.lineIndex)
    const endEntry = entries.find(item => item.lineIndex === end.lineIndex)
    if (!startEntry || !endEntry) return null
    const rows: string[] = []
    for (let rowIndex = startEntry.rowIndex; rowIndex <= endEntry.rowIndex; rowIndex++) {
      const rowStartCell = rowIndex === startEntry.rowIndex ? startEntry.cellIndex : 0
      const rowEndCell = rowIndex === endEntry.rowIndex ? endEntry.cellIndex : table.columns.length - 1
      const cells: string[] = []
      for (let cellIndex = rowStartCell; cellIndex <= rowEndCell; cellIndex++) {
        const cellEntries = entries.filter(item => item.rowIndex === rowIndex && item.cellIndex === cellIndex)
        cells.push(selectedTableCellText(cellEntries, startEntry, endEntry, start, end))
      }
      rows.push(cells.join('\t'))
    }
    return rows.join('\n')
  }

  private _selectionRange(blockIndex: number, lineIndex: number, text: string): { start: number; end: number } | null {
    const selection = this._normalizedSelection()
    if (!selection) return null
    if (isSelectionLineBefore(blockIndex, lineIndex, selection.start)) return null
    if (isSelectionLineAfter(blockIndex, lineIndex, selection.end)) return null
    if (blockIndex === selection.start.blockIndex && lineIndex === selection.start.lineIndex &&
      blockIndex === selection.end.blockIndex && lineIndex === selection.end.lineIndex) {
      return selection.end.column > selection.start.column
        ? { start: selection.start.column, end: selection.end.column }
        : null
    }
    if (blockIndex === selection.start.blockIndex && lineIndex === selection.start.lineIndex) return { start: selection.start.column, end: text.length }
    if (blockIndex === selection.end.blockIndex && lineIndex === selection.end.lineIndex) return { start: 0, end: selection.end.column }
    if (compareSelectionPositions({ blockIndex, lineIndex, column: 0 }, selection.start) > 0 &&
      compareSelectionPositions({ blockIndex, lineIndex, column: 0 }, selection.end) < 0) {
      return { start: 0, end: text.length }
    }
    return null
  }

  private _selectableLines(): MarkdownSelectableLine[] {
    const lines: MarkdownSelectableLine[] = []
    for (let blockIndex = 0; blockIndex < this._layoutBlocks.length; blockIndex++) {
      const block = this._layoutBlocks[blockIndex]!
      if (block.lines) {
        for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
          const line = block.lines[lineIndex]!
          lines.push({ blockIndex, lineIndex, text: textLineContent(line), y: line.y, height: line.height })
        }
      } else if (block.code) {
        for (let lineIndex = 0; lineIndex < block.code.lines.length; lineIndex++) {
          lines.push({
            blockIndex,
            lineIndex,
            text: block.code.lines[lineIndex] ?? '',
            y: block.y + codePaddingY + lineIndex * block.code.lineHeight,
            height: block.code.lineHeight,
          })
        }
      } else if (block.table) {
        for (const line of this._tableSelectableLineLayouts(block)) {
          lines.push({ blockIndex, lineIndex: line.lineIndex, text: line.text, y: line.line.y, height: line.line.height })
        }
      }
    }
    return lines
  }

  private _tableSelectableLineLayouts(block: MarkdownLayoutBlock): MarkdownTableSelectableLine[] {
    const table = block.table
    if (!table) return []
    const lines: MarkdownTableSelectableLine[] = []
    let lineIndex = 0
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const row = table.rows[rowIndex]!
      let cellX = block.x
      for (let cellIndex = 0; cellIndex < table.columns.length; cellIndex++) {
        const width = table.columns[cellIndex]!
        const cellLines = row.cells[cellIndex] ?? []
        for (let cellLineIndex = 0; cellLineIndex < cellLines.length; cellLineIndex++) {
          const line = cellLines[cellLineIndex]!
          const lineWidth = line.runs.reduce((sum, run) => sum + run.width, 0)
          const align = table.alignments[cellIndex]
          const cellPadding = align === 'right'
            ? width - lineWidth - 7
            : align === 'center'
              ? Math.max(7, (width - lineWidth) / 2)
              : 7
          const adjustedLine: MarkdownTextLine = { ...line, x: cellX + cellPadding }
          lines.push({
            lineIndex,
            line: adjustedLine,
            text: textLineContent(adjustedLine),
            rowIndex,
            cellIndex,
            cellLineIndex,
            cellX,
            cellWidth: width,
          })
          lineIndex += 1
        }
        cellX += width
      }
    }
    return lines
  }

  private _updateCodeHBarHover(point?: Offset): { key: string; changed: boolean } {
    let changed = false
    let key = ''
    for (const block of this._layoutBlocks) {
      if (block.type !== 'codeBlock' || !block.code) continue
      const controller = block.code.scrollbarController
      const blockChanged = point && block.code.hbarRect
        ? controller.updateHover(point, this._codeScrollbarGeometry(block.code))
        : controller.clearHover()
      if (controller.state.hovered) key = block.code.key
      changed = blockChanged || changed
    }
    return { key, changed }
  }

  private _updateTableHBarHover(point?: Offset): { key: string; changed: boolean } {
    let changed = false
    let key = ''
    for (const block of this._layoutBlocks) {
      if (block.type !== 'table' || !block.table) continue
      const controller = block.table.scrollbarController
      const blockChanged = point && block.table.hbarRect
        ? controller.updateHover(point, this._tableScrollbarGeometry(block.table))
        : controller.clearHover()
      if (controller.state.hovered) key = block.table.key
      changed = blockChanged || changed
    }
    return { key, changed }
  }

  private _setTableScrollX(table: MarkdownTableLayout, scrollX: number): boolean {
    const nextScrollX = clamp(scrollX, 0, Math.max(0, table.contentWidth - table.viewportWidth))
    if (nextScrollX === table.scrollX) return false
    table.scrollX = nextScrollX
    this._tableScrollState.set(table.key, table.scrollX)
    this._linkRects = []
    this._clearPaintedInteractionDebug()
    return true
  }

  private _resetCodeInteraction(): void {
    this._hoveredCodeKey = ''
    this._hoveredCopyCodeKey = ''
    if (this._nestedScrollbarDrag?.kind === 'code') this._cancelNestedScrollbarDrag()
  }

  private _resetTableInteraction(): void {
    this._hoveredTableHBarKey = ''
    if (this._nestedScrollbarDrag?.kind === 'table') this._cancelNestedScrollbarDrag()
  }

  private _syncFocusRegistration(): void {
    if (typeof window === 'undefined') return
    if (!this.visible) {
      if (this._focusRegistered) {
        FocusManager.instance.unregister(this)
        this._focusRegistered = false
      }
      return
    }
    if (!this._focusRegistered) {
      FocusManager.instance.register(this)
      this._focusRegistered = true
    }
  }

  private _clearInteractionState(): void {
    if (typeof window !== 'undefined' && FocusManager.instance.current === this) {
      FocusManager.instance.clearFocusOf(this)
    } else if (this._focused) {
      this.focusOut()
    }
    if (this._selection?.dragging) this._selection.dragging = false
    this._scrollbarController.reset()
    this._hoveredCodeKey = ''
    this._hoveredCopyCodeKey = ''
    this._hoveredTableHBarKey = ''
    this._resetCodeInteraction()
    this._resetTableInteraction()
    this._setCursor('default')
    this._clearPaintedInteractionDebug()
  }

  private _setCursor(cursor: string): void {
    if (this._cursor === cursor) return
    this._cursor = cursor
    this.owner?.setCursor(cursor)
  }

  private _clearPaintedInteractionDebug(): void {
    this._paintedLinkDebugTargets = []
    this._paintedCodeDebugStates = []
    this._paintedVisibleTextLines = []
  }

  private _capturePaintedInteractionDebug(theme: ResolvedTheme): void {
    const viewport = {
      x: 0,
      y: 0,
      width: this._viewportWidth(theme),
      height: this.size.height,
    }
    this._paintedLinkDebugTargets = this._linkRects.flatMap(link => {
      const rect = intersectMarkdownRects(viewport, {
        x: link.rect.x,
        y: link.rect.y - this._scrollY,
        width: link.rect.width,
        height: link.rect.height,
      })
      return rect.width > 0 && rect.height > 0
        ? [{ href: link.href, title: link.title, rect }]
        : []
    })
    this._paintedCodeDebugStates = this._layoutBlocks.flatMap((block, blockIndex) => {
      const code = block.code
      if (!code) return []
      const blockRect = intersectMarkdownRects(viewport, {
        x: block.x,
        y: block.y - this._scrollY,
        width: block.width,
        height: block.height,
      })
      if (blockRect.width <= 0 || blockRect.height <= 0) return []
      const showCopy = this._hoveredCodeKey === code.key || this._hoveredCopyCodeKey === code.key
      const copyButtonRect = showCopy && code.copyButtonRect
        ? intersectMarkdownRects(viewport, {
            x: code.copyButtonRect.x,
            y: code.copyButtonRect.y - this._scrollY,
            width: code.copyButtonRect.width,
            height: code.copyButtonRect.height,
          })
        : null
      return [{
        blockIndex,
        language: block.language,
        scrollX: code.scrollX,
        contentWidth: code.contentWidth,
        viewportWidth: code.viewportWidth,
        blockRect,
        copyButtonRect: copyButtonRect && copyButtonRect.width > 0 && copyButtonRect.height > 0
          ? copyButtonRect
          : null,
      }]
    })
    const visibleTop = this._scrollY
    const visibleBottom = visibleTop + this.size.height
    this._paintedVisibleTextLines = this._selectableLines()
      .filter(line => line.y + line.height > visibleTop && line.y < visibleBottom)
      .map(line => line.text)
  }

  private _naturalDocumentWidth(theme: ResolvedTheme, maxImageWidth: number): number {
    return Math.max(
      0,
      ...this._document.blocks.map(block => this._naturalBlockWidth(block, theme, maxImageWidth)),
    )
  }

  private _naturalBlockWidth(block: MarkdownBlock, theme: ResolvedTheme, maxImageWidth: number): number {
    switch (block.type) {
      case 'heading':
        return this._naturalInlineWidth(block.children, headingStyle(block.depth, theme), theme, maxImageWidth)
      case 'paragraph':
        return this._naturalInlineWidth(block.children, normalStyle(theme), theme, maxImageWidth)
      case 'blockquote':
        return 14 + Math.max(0, ...block.children.map(child =>
          this._naturalBlockWidth(child, theme, Math.max(0, maxImageWidth - 14))))
      case 'list':
        return listMarkerWidth + Math.max(0, ...block.items.flatMap(item =>
          item.children.map(child => this._naturalBlockWidth(
            child,
            theme,
            Math.max(0, maxImageWidth - listMarkerWidth),
          ))))
      case 'codeBlock': {
        const style = codeStyle(theme)
        return Math.max(0, ...block.text.split('\n').map(line =>
          TextMeasurer.measureWidth(line, style.fontSize, style.fontFamily))) + codePaddingX * 2
      }
      case 'thematicBreak':
        return 0
      case 'table':
        return resolveMarkdownTableColumns(block, 0, normalStyle(theme))
          .reduce((sum, width) => sum + width, 0)
      case 'html': {
        const style = codeStyle(theme)
        return TextMeasurer.measureWidth(
          visibleHtmlFallback(block.text),
          style.fontSize,
          style.fontFamily,
        )
      }
    }
  }

  private _naturalInlineWidth(
    inlines: MarkdownInline[],
    style: MarkdownTextStyle,
    theme: ResolvedTheme,
    maxImageWidth: number,
  ): number {
    const lines = layoutInlines(
      inlines,
      Number.MAX_SAFE_INTEGER,
      style,
      theme.textAccent,
      (inline, imageStyle) => this._imageToken(inline, maxImageWidth, imageStyle),
    )
    return Math.max(0, ...lines.map(line =>
      line.runs.reduce((sum, run) => sum + run.width, 0)))
  }

  private _availableWidth(indent: number, theme: ResolvedTheme): number {
    return Math.max(24, this._viewportWidth(theme) - indent - this._padding)
  }

  private _viewportWidth(theme: ResolvedTheme): number {
    return Math.max(0, this.size.width - this._scrollbarWidth(theme))
  }

  private _scrollbarWidth(theme: ResolvedTheme): number {
    return deriveScrollbarStyle(theme).gutterSize
  }

  private _inScrollbar(position: Offset): boolean {
    return hitTestScrollbarGeometry(position, this._scrollbarGeometry())
  }

  private _scrollbarGeometry(): ScrollbarGeometry {
    const style = deriveScrollbarStyle(this.currentTheme)
    const width = this._scrollbarWidthValue
    return resolveScrollbarGeometryForState({
      axis: 'vertical',
      trackRect: { x: this.size.width - width, y: 0, width, height: this.size.height },
      viewportSize: this.size.height,
      contentSize: this._contentHeight,
      scrollOffset: this._scrollY,
      style,
      state: this._scrollbar,
    })
  }

  private _codeScrollbarGeometry(code: MarkdownCodeLayout): ScrollbarGeometry {
    const rect = code.hbarRect ?? { x: 0, y: 0, width: code.viewportWidth, height: codeHBarHeight }
    return resolveScrollbarGeometryForState({
      axis: 'horizontal',
      trackRect: rect,
      viewportSize: code.viewportWidth,
      contentSize: code.contentWidth,
      scrollOffset: code.scrollX,
      style: deriveScrollbarStyle(this.currentTheme),
      state: code.scrollbarController.state,
    })
  }

  private _tableScrollbarGeometry(table: MarkdownTableLayout): ScrollbarGeometry {
    const rect = table.hbarRect ?? { x: 0, y: 0, width: table.viewportWidth, height: tableHBarHeight }
    return resolveScrollbarGeometryForState({
      axis: 'horizontal',
      trackRect: rect,
      viewportSize: table.viewportWidth,
      contentSize: table.contentWidth,
      scrollOffset: table.scrollX,
      style: deriveScrollbarStyle(this.currentTheme),
      state: table.scrollbarController.state,
    })
  }

  private _nestedScrollbarController(
    controllers: Map<string, ScrollbarAxisController>,
    key: string,
  ): ScrollbarAxisController {
    const existing = controllers.get(key)
    if (existing) return existing
    const controller = new ScrollbarAxisController('horizontal')
    controllers.set(key, controller)
    return controller
  }

  private _codeLayoutByKey(key: string): MarkdownCodeLayout | null {
    return this._layoutBlocks.find(block => block.code?.key === key)?.code ?? null
  }

  private _tableLayoutByKey(key: string): MarkdownTableLayout | null {
    return this._layoutBlocks.find(block => block.table?.key === key)?.table ?? null
  }

  private _validateNestedScrollbarDrag(): void {
    const session = this._nestedScrollbarDrag
    if (!session) return
    const layout = session.kind === 'code'
      ? this._codeLayoutByKey(session.key)
      : this._tableLayoutByKey(session.key)
    if (
      layout &&
      layout.contentWidth > layout.viewportWidth &&
      layout.scrollbarController === session.controller &&
      session.controller.ownsPointer(session.pointerKey)
    ) return
    this._cancelNestedScrollbarDrag()
  }

  private _cancelNestedScrollbarDrag(fallbackReleasePointerCapture?: () => void): boolean {
    const session = this._nestedScrollbarDrag
    if (!session) return false
    this._nestedScrollbarDrag = null
    session.controller.cancelPointer(session.pointerKey)
    const releasePointerCapture = session.releasePointerCapture ?? fallbackReleasePointerCapture
    releasePointerCapture?.()
    return true
  }

  private _releaseNestedScrollbarDrag(fallbackReleasePointerCapture?: () => void): boolean {
    const session = this._nestedScrollbarDrag
    if (!session) return false
    this._nestedScrollbarDrag = null
    const releasePointerCapture = session.releasePointerCapture ?? fallbackReleasePointerCapture
    releasePointerCapture?.()
    return true
  }

  private _pruneNestedScrollbarControllers(blocks: readonly MarkdownLayoutBlock[]): void {
    const codeKeys = new Set(blocks.flatMap(block => block.code ? [block.code.key] : []))
    const tableKeys = new Set(blocks.flatMap(block => block.table ? [block.table.key] : []))
    for (const [key, controller] of this._codeScrollbarControllers) {
      if (codeKeys.has(key)) continue
      controller.reset()
      this._codeScrollbarControllers.delete(key)
    }
    for (const [key, controller] of this._tableScrollbarControllers) {
      if (tableKeys.has(key)) continue
      controller.reset()
      this._tableScrollbarControllers.delete(key)
    }
  }

  private _resetNestedScrollbarControllers(controllers: Map<string, ScrollbarAxisController>): void {
    for (const controller of controllers.values()) controller.reset()
    controllers.clear()
  }

  private _localPoint(point: Offset): Offset {
    const g = this.globalOffset
    return {
      x: point.x - g.x,
      y: point.y - g.y,
    }
  }

  private _documentPoint(localPoint: Offset): Offset {
    return {
      x: localPoint.x,
      y: localPoint.y + this._scrollY,
    }
  }

  private _maxScrollY(): number {
    return Math.max(0, this._contentHeight - this.size.height)
  }

  private _clampScroll(): void {
    const next = clamp(this._scrollY, 0, this._maxScrollY())
    if (next === this._scrollY) return
    this._scrollY = next
    this._clearPaintedInteractionDebug()
  }

  private _scrollToHeadingNow(id: string, options: { notify?: boolean } = {}): boolean {
    const normalizedId = normalizeAnchorId(id)
    const heading = this._headingOutline.find(item => item.id === normalizedId)
    if (!heading) return false
    const before = this._scrollY
    this._scrollY = clamp(Math.max(0, heading.y - this._padding), 0, this._maxScrollY())
    if (this._scrollY !== before) this._clearPaintedInteractionDebug()
    this.markNeedsPaint()
    if (options.notify !== false && this._scrollY !== before) this._notifyViewportChange()
    return true
  }

  private _activeHeadingAt(scrollY: number): MarkdownHeadingOutlineItem | null {
    if (this._headingOutline.length === 0) return null
    const probeY = scrollY + this._padding + 1
    let active = this._headingOutline[0]!
    for (const heading of this._headingOutline) {
      if (heading.y <= probeY) active = heading
      else break
    }
    return active
  }

  private _notifyViewportChange(): void {
    this.onViewportChange?.(this.getViewportState())
  }

  private _searchableLines(): Array<{ blockIndex: number; lineIndex: number; text: string; y: number; height: number }> {
    const lines: Array<{ blockIndex: number; lineIndex: number; text: string; y: number; height: number }> = []
    for (let blockIndex = 0; blockIndex < this._layoutBlocks.length; blockIndex++) {
      const block = this._layoutBlocks[blockIndex]!
      if (block.lines) {
        for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
          const line = block.lines[lineIndex]!
          lines.push({
            blockIndex,
            lineIndex,
            text: textLineContent(line),
            y: line.y,
            height: line.height,
          })
        }
      }
      if (block.code) {
        for (let lineIndex = 0; lineIndex < block.code.lines.length; lineIndex++) {
          lines.push({
            blockIndex,
            lineIndex,
            text: block.code.lines[lineIndex] ?? '',
            y: block.y + codePaddingY + lineIndex * block.code.lineHeight,
            height: block.code.lineHeight,
          })
        }
      }
      if (block.table) {
        let lineIndex = 0
        for (const row of block.table.rows) {
          for (const cell of row.cells) {
            for (const line of cell) {
              lines.push({
                blockIndex,
                lineIndex,
                text: textLineContent(line),
                y: line.y,
                height: line.height,
              })
              lineIndex += 1
            }
          }
        }
      }
    }
    return lines
  }

  private _scrollOffsetForVisibleSearchResult(result: MarkdownSearchResult): number {
    const margin = Math.min(this._padding, Math.max(0, this.size.height / 4))
    const visibleTop = this._scrollY
    const visibleBottom = this._scrollY + this.size.height
    const resultTop = result.y
    const resultBottom = result.y + result.height
    if (resultTop >= visibleTop && resultBottom <= visibleBottom) return this._scrollY
    if (resultTop < visibleTop) return clamp(Math.max(0, resultTop - margin), 0, this._maxScrollY())
    return clamp(resultBottom - this.size.height + margin, 0, this._maxScrollY())
  }

  private _paintLineSearchHighlights(
    dl: DrawList,
    theme: ResolvedTheme,
    lineIndex: number,
    line: MarkdownTextLine,
    block: MarkdownLayoutBlock,
    origin: Offset,
  ): void {
    const query = normalizeSearchQuery(this._searchQuery)
    if (!query) return
    const text = textLineContent(line)
    const matches = findSearchMatches(text, query)
    if (matches.length === 0) return
    const blockIndex = this._layoutBlocks.indexOf(block)
    const editor = resolveThemeEditor(theme)
    for (const match of matches) {
      const active = this._activeSearchResultId === searchResultId(blockIndex, lineIndex, match.start)
      const color = active ? editor.searchActiveMatchBg : editor.searchMatchBg
      const startX = textLineColumnX(line, match.start)
      const endX = textLineColumnX(line, match.end)
      if (endX <= startX) continue
      dl.fillRect(origin.x + line.x + startX - 2, origin.y + line.y + 1, endX - startX + 4, line.height - 2, color, 2)
    }
  }

  private _paintCodeSearchHighlights(
    dl: DrawList,
    line: string,
    blockIndex: number,
    lineIndex: number,
    x: number,
    y: number,
    style: MarkdownTextStyle,
    theme: ResolvedTheme,
  ): void {
    const query = normalizeSearchQuery(this._searchQuery)
    if (!query) return
    const matches = findSearchMatches(line, query)
    if (matches.length === 0) return
    const editor = resolveThemeEditor(theme)
    for (const match of matches) {
      const active = this._activeSearchResultId === searchResultId(blockIndex, lineIndex, match.start)
      const color = active ? editor.searchActiveMatchBg : editor.searchMatchBg
      const startX = x + TextMeasurer.measureWidth(line.slice(0, match.start), style.fontSize, style.fontFamily)
      const endX = x + TextMeasurer.measureWidth(line.slice(0, match.end), style.fontSize, style.fontFamily)
      if (endX <= startX) continue
      dl.fillRect(startX - 2, y - style.lineHeight / 2 + 1, endX - startX + 4, style.lineHeight - 2, color, 2)
    }
  }

  private _paintCodeSelectionHighlight(
    dl: DrawList,
    theme: ResolvedTheme,
    line: string,
    blockIndex: number,
    lineIndex: number,
    x: number,
    y: number,
    style: MarkdownTextStyle,
  ): void {
    const range = this._selectionRange(blockIndex, lineIndex, line)
    if (!range) return
    const startX = x + TextMeasurer.measureWidth(line.slice(0, range.start), style.fontSize, style.fontFamily)
    const endX = x + TextMeasurer.measureWidth(line.slice(0, range.end), style.fontSize, style.fontFamily)
    const width = Math.max(endX - startX, 2)
    dl.fillRect(startX, y - style.lineHeight / 2 + 1, width, style.lineHeight - 2, resolveThemeEditor(theme).selectionBg, 1)
  }

  private _paintTextSelectionHighlight(
    dl: DrawList,
    theme: ResolvedTheme,
    lineIndex: number,
    line: MarkdownTextLine,
    block: MarkdownLayoutBlock,
    origin: Offset,
  ): void {
    const text = textLineContent(line)
    const range = this._selectionRange(this._layoutBlocks.indexOf(block), lineIndex, text)
    if (!range) return
    const startX = textLineColumnX(line, range.start)
    const endX = textLineColumnX(line, range.end)
    const width = Math.max(endX - startX, 2)
    dl.fillRect(origin.x + line.x + startX, origin.y + line.y + 1, width, line.height - 2, resolveThemeEditor(theme).selectionBg, 1)
  }
}

export function collectMarkdownDocumentHeadings(document: MarkdownDocument): MarkdownDocumentHeadingItem[] {
  const slugs = new Map<string, number>()
  const headings: MarkdownDocumentHeadingItem[] = []
  const visit = (blocks: readonly MarkdownBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'heading') {
        const heading = nextMarkdownHeading(block.raw, block.depth, 0, 0, slugs)
        headings.push({ id: heading.id, title: heading.title, depth: heading.depth })
      } else if (block.type === 'blockquote') {
        visit(block.children)
      } else if (block.type === 'list') {
        for (const item of block.items) visit(item.children)
      }
    }
  }
  visit(document.blocks)
  return headings
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

function findSearchMatches(text: string, normalizedQuery: string): Array<{ start: number; end: number }> {
  if (!normalizedQuery) return []
  const lowerText = text.toLocaleLowerCase()
  const matches: Array<{ start: number; end: number }> = []
  let index = lowerText.indexOf(normalizedQuery)
  while (index >= 0) {
    matches.push({ start: index, end: index + normalizedQuery.length })
    index = lowerText.indexOf(normalizedQuery, index + Math.max(1, normalizedQuery.length))
  }
  return matches
}

function createSearchSnippet(text: string, start: number, end: number): string {
  const head = Math.max(0, start - 18)
  const tail = Math.min(text.length, end + 18)
  const prefix = head > 0 ? '...' : ''
  const suffix = tail < text.length ? '...' : ''
  return `${prefix}${text.slice(head, tail)}${suffix}`.trim()
}

function textLineContent(line: MarkdownTextLine): string {
  return line.runs.map(run => run.text).join('')
}

function textLineColumnX(line: MarkdownTextLine, column: number): number {
  let cursor = 0
  for (const run of line.runs) {
    const next = cursor + run.text.length
    if (column <= next) {
      if (run.image) return column <= cursor ? run.x : run.x + run.width
      const localColumn = Math.max(0, column - cursor)
      return run.x + TextMeasurer.measureWidth(run.text.slice(0, localColumn), run.style.fontSize, run.style.fontFamily)
    }
    cursor = next
  }
  const last = line.runs[line.runs.length - 1]
  return last ? last.x + last.width : 0
}

function compareSelectionPositions(a: MarkdownSelectionPosition, b: MarkdownSelectionPosition): number {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex
  if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex
  return a.column - b.column
}

function compareLineToSelection(
  line: MarkdownSelectableLine,
  start: MarkdownSelectionPosition,
  end: MarkdownSelectionPosition,
): number {
  if (line.blockIndex < start.blockIndex || (line.blockIndex === start.blockIndex && line.lineIndex < start.lineIndex)) return -1
  if (line.blockIndex > end.blockIndex || (line.blockIndex === end.blockIndex && line.lineIndex > end.lineIndex)) return 1
  return 0
}

function isSelectionLineBefore(blockIndex: number, lineIndex: number, position: MarkdownSelectionPosition): boolean {
  return blockIndex < position.blockIndex || (blockIndex === position.blockIndex && lineIndex < position.lineIndex)
}

function isSelectionLineAfter(blockIndex: number, lineIndex: number, position: MarkdownSelectionPosition): boolean {
  return blockIndex > position.blockIndex || (blockIndex === position.blockIndex && lineIndex > position.lineIndex)
}

function wordRangeAtColumn(text: string, column: number): { start: number; end: number } | null {
  if (!text) return null
  const chars = Array.from(text)
  const positions: number[] = []
  let offset = 0
  for (const char of chars) {
    positions.push(offset)
    offset += char.length
  }
  positions.push(offset)
  let charIndex = chars.findIndex((_, index) => column >= positions[index]! && column < positions[index + 1]!)
  if (charIndex < 0) charIndex = Math.max(0, chars.length - 1)
  if (column === text.length) charIndex = chars.length - 1
  const kind = wordCharKind(chars[charIndex]!)
  if (kind === 'space') return null
  let startIndex = charIndex
  while (startIndex > 0 && wordCharKind(chars[startIndex - 1]!) === kind) startIndex--
  let endIndex = charIndex + 1
  while (endIndex < chars.length && wordCharKind(chars[endIndex]!) === kind) endIndex++
  return { start: positions[startIndex]!, end: positions[endIndex]! }
}

function wordCharKind(char: string): 'word' | 'punctuation' | 'space' {
  if (/\s/u.test(char)) return 'space'
  if (/[\p{L}\p{N}_]/u.test(char)) return 'word'
  return 'punctuation'
}

function tableRowIndexAtY(table: MarkdownTableLayout, y: number): number {
  if (table.rows.length === 0) return 0
  for (let index = 0; index < table.rows.length; index++) {
    const row = table.rows[index]!
    if (y >= row.y && y <= row.y + row.height) return index
    if (y < row.y) return Math.max(0, index - 1)
  }
  return table.rows.length - 1
}

function tableCellIndexAtX(block: MarkdownLayoutBlock, table: MarkdownTableLayout, x: number): number {
  if (table.columns.length === 0) return 0
  let cellX = block.x
  for (let index = 0; index < table.columns.length; index++) {
    const width = table.columns[index]!
    if (x >= cellX && x <= cellX + width) return index
    if (x < cellX) return Math.max(0, index - 1)
    cellX += width
  }
  return table.columns.length - 1
}

function nearestTableLineByY(entries: readonly MarkdownTableSelectableLine[], y: number): MarkdownTableSelectableLine | null {
  if (entries.length === 0) return null
  for (const entry of entries) {
    if (y <= entry.line.y + entry.line.height) return entry
  }
  return entries[entries.length - 1]!
}

function selectedTableCellText(
  entries: readonly MarkdownTableSelectableLine[],
  startEntry: MarkdownTableSelectableLine,
  endEntry: MarkdownTableSelectableLine,
  start: MarkdownSelectionPosition,
  end: MarkdownSelectionPosition,
): string {
  if (entries.length === 0) return ''
  const fromLineIndex = sameTableCell(entries[0]!, startEntry) ? startEntry.cellLineIndex : 0
  const toLineIndex = sameTableCell(entries[0]!, endEntry) ? endEntry.cellLineIndex : entries[entries.length - 1]!.cellLineIndex
  if (fromLineIndex > toLineIndex) return ''
  const parts: string[] = []
  for (const entry of entries) {
    if (entry.cellLineIndex < fromLineIndex || entry.cellLineIndex > toLineIndex) continue
    const startColumn = sameTableCell(entry, startEntry) && entry.cellLineIndex === startEntry.cellLineIndex
      ? start.column
      : 0
    const endColumn = sameTableCell(entry, endEntry) && entry.cellLineIndex === endEntry.cellLineIndex
      ? end.column
      : entry.text.length
    parts.push(entry.text.slice(startColumn, endColumn))
  }
  return parts.join('\n')
}

function sameTableCell(a: MarkdownTableSelectableLine, b: MarkdownTableSelectableLine): boolean {
  return a.rowIndex === b.rowIndex && a.cellIndex === b.cellIndex
}

function codeColumnAtX(line: string, x: number, style: MarkdownTextStyle): number {
  if (x <= 0 || line.length === 0) return 0
  let column = 0
  let cursorX = 0
  for (const char of Array.from(line)) {
    const width = TextMeasurer.measureWidth(char, style.fontSize, style.fontFamily)
    if (x <= cursorX + width / 2) return column
    cursorX += width
    column += char.length
  }
  return line.length
}

function textColumnAtX(line: MarkdownTextLine, x: number, text: string): number {
  if (x <= 0 || text.length === 0) return 0
  let column = 0
  for (const run of line.runs) {
    if (run.image) {
      const length = run.text.length
      if (x <= run.x + run.width / 2) return column
      if (x <= run.x + run.width) return column + length
      column += length
      continue
    }
    let runX = run.x
    for (const char of Array.from(run.text)) {
      const width = TextMeasurer.measureWidth(char, run.style.fontSize, run.style.fontFamily)
      if (x <= runX + width / 2) return column
      runX += width
      column += char.length
    }
  }
  return text.length
}

function lineIndexAtY(lines: readonly MarkdownTextLine[], y: number): number {
  if (lines.length === 0) return -1
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (y >= line.y && y <= line.y + line.height) return index
    if (y < line.y) return Math.max(0, index - 1)
  }
  return lines.length - 1
}

function searchResultId(blockIndex: number, lineIndex: number, startColumn: number): string {
  return `search:${blockIndex}:${lineIndex}:${startColumn}`
}

function resolveMarkdownTableColumns(block: MarkdownTableBlock, viewportWidth: number, style: MarkdownTextStyle): number[] {
  const columnCount = Math.max(1, block.alignments.length)
  const cellsByColumn = Array.from({ length: columnCount }, (_, columnIndex) =>
    [block.header[columnIndex], ...block.rows.map(row => row[columnIndex])]
      .filter((cell): cell is MarkdownInline[] => Array.isArray(cell)))
  const preferred = cellsByColumn.map(cells => {
    const texts = cells.map(cell => markdownInlinesToPlainText(cell))
    const longestWordWidth = Math.max(0, ...texts.flatMap(text =>
      text.split(/\s+/).filter(Boolean).map(word => TextMeasurer.measureWidth(word, style.fontSize, style.fontFamily))))
    const fullTextWidth = Math.max(0, ...texts.map(text => TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily)))
    const minWidth = clamp(longestWordWidth + tableCellPaddingX * 2, 56, 180)
    return clamp(Math.max(fullTextWidth + tableCellPaddingX * 2, minWidth), minWidth, 320)
  })
  const preferredTotal = preferred.reduce((sum, width) => sum + width, 0)
  if (preferredTotal >= viewportWidth) return preferred
  const extra = (viewportWidth - preferredTotal) / columnCount
  return preferred.map(width => width + extra)
}

function layoutInlines(
  inlines: MarkdownInline[],
  maxWidth: number,
  baseStyle: MarkdownTextStyle,
  linkTextColor: Color,
  imageToken?: (inline: MarkdownImageInline, style: MarkdownTextStyle) => InlineImageToken,
): MarkdownTextLine[] {
  const tokens = flattenInlines(inlines, baseStyle, maxWidth, linkTextColor, imageToken)
  const lines: MarkdownTextLine[] = []
  let line: MarkdownTextLine = { x: 0, y: 0, height: baseStyle.lineHeight, runs: [] }
  let x = 0

  const commitLine = () => {
    lines.push(line)
    line = { x: 0, y: 0, height: baseStyle.lineHeight, runs: [] }
    x = 0
  }

  for (const token of tokens) {
    if (token.type === 'image') {
      if (x > 0 && x + token.width > maxWidth) commitLine()
      appendRun(line, {
        text: token.text,
        x,
        width: token.width,
        height: token.height,
        style: token.style,
        image: token.image,
      })
      line.height = Math.max(line.height, token.height)
      x += token.width
      continue
    }
    if (token.text === '\n') {
      commitLine()
      continue
    }
    for (const char of Array.from(token.text)) {
      const width = TextMeasurer.measureWidth(char, token.style.fontSize, token.style.fontFamily)
      if (x > 0 && x + width > maxWidth) commitLine()
      appendRun(line, {
        text: char,
        x,
        width,
        height: token.style.lineHeight,
        style: token.style,
      })
      x += width
    }
  }
  if (line.runs.length > 0 || lines.length === 0) commitLine()
  return lines
}

function flattenInlines(
  inlines: MarkdownInline[],
  style: MarkdownTextStyle,
  maxWidth: number,
  linkTextColor: Color,
  imageToken?: (inline: MarkdownImageInline, style: MarkdownTextStyle) => InlineImageToken,
): InlineToken[] {
  const tokens: InlineToken[] = []
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text':
      case 'html':
        tokens.push({ type: 'text', text: inline.text, style })
        break
      case 'softBreak':
        tokens.push({ type: 'text', text: ' ', style })
        break
      case 'hardBreak':
        tokens.push({ type: 'text', text: '\n', style })
        break
      case 'code':
        tokens.push({
          type: 'text',
          text: inline.text,
          style: {
            ...style,
            code: true,
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            fontSize: Math.max(11, style.fontSize - 1),
          },
        })
        break
      case 'strong':
        tokens.push(...flattenInlines(inline.children, { ...style, weight: 700 }, maxWidth, linkTextColor, imageToken))
        break
      case 'emphasis':
        tokens.push(...flattenInlines(inline.children, { ...style, weight: style.weight ?? 500 }, maxWidth, linkTextColor, imageToken))
        break
      case 'delete':
        tokens.push(...flattenInlines(inline.children, { ...style, delete: true }, maxWidth, linkTextColor, imageToken))
        break
      case 'link':
        tokens.push(...flattenInlines(inline.children, {
          ...style,
          href: inline.href,
          title: inline.title,
          color: linkTextColor,
        }, maxWidth, linkTextColor, imageToken))
        break
      case 'image':
        tokens.push(imageToken
          ? imageToken(inline, style)
          : fallbackImageToken(inline, maxWidth, style))
        break
    }
  }
  return tokens
}

function fallbackImageToken(inline: MarkdownImageInline, maxWidth: number, style: MarkdownTextStyle): InlineImageToken {
  const width = Math.min(Math.max(40, maxWidth), markdownImageDefaultWidth)
  const height = Math.round(width * markdownImageDefaultHeight / markdownImageDefaultWidth)
  return {
    type: 'image',
    text: inline.alt || inline.title || inline.src,
    width,
    height,
    style,
    image: {
      src: inline.src,
      resolvedSrc: inline.src,
      alt: inline.alt,
      title: inline.title,
      state: 'error',
      image: null,
    },
  }
}

function markdownImageSize(entry: MarkdownImageCacheEntry, maxWidth: number): { width: number; height: number } {
  const safeMaxWidth = Math.max(40, maxWidth)
  if (entry.state === 'loaded' && entry.naturalWidth > 0 && entry.naturalHeight > 0) {
    const width = Math.min(entry.naturalWidth, safeMaxWidth)
    return {
      width,
      height: Math.max(24, Math.round(entry.naturalHeight * width / entry.naturalWidth)),
    }
  }
  const width = Math.min(safeMaxWidth, markdownImageDefaultWidth)
  return {
    width,
    height: Math.round(width * markdownImageDefaultHeight / markdownImageDefaultWidth),
  }
}

function positionTextLines(lines: MarkdownTextLine[], y: number, x: number): number {
  let cursorY = y
  for (const line of lines) {
    line.x = x
    line.y = cursorY
    cursorY += line.height
  }
  return cursorY - y
}

function lineStackHeight(lines: MarkdownTextLine[]): number {
  return lines.reduce((sum, line) => sum + line.height, 0)
}

function appendRun(line: MarkdownTextLine, run: MarkdownTextRun): void {
  const previous = line.runs[line.runs.length - 1]
  if (!run.image && previous && !previous.image && sameRunStyle(previous.style, run.style) && previous.x + previous.width === run.x) {
    previous.text += run.text
    previous.width += run.width
    return
  }
  line.runs.push(run)
}

function sameRunStyle(a: MarkdownTextStyle, b: MarkdownTextStyle): boolean {
  return a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.weight === b.weight &&
    a.code === b.code &&
    a.delete === b.delete &&
    a.href === b.href &&
    a.title === b.title &&
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b &&
    a.color.a === b.color.a
}

function normalStyle(theme: ResolvedTheme): MarkdownTextStyle {
  const text = deriveTextStyle(theme)
  return {
    fontSize: text.fontSize,
    fontFamily: text.fontFamily,
    lineHeight: text.lineHeight,
    color: text.text,
  }
}

function headingStyle(depth: number, theme: ResolvedTheme): MarkdownTextStyle {
  const text = deriveTextStyle(theme)
  const scale = [1.85, 1.55, 1.32, 1.18, 1.08, 1][Math.max(0, Math.min(5, depth - 1))]!
  const fontSize = Math.round(text.fontSize * scale)
  return {
    fontSize,
    fontFamily: text.fontFamily,
    lineHeight: Math.round(fontSize * 1.45),
    color: theme.textAccent,
    weight: depth <= 3 ? 700 : 600,
  }
}

function codeStyle(theme: ResolvedTheme): MarkdownTextStyle {
  const text = deriveTextStyle(theme)
  return {
    fontSize: Math.max(11, text.fontSize - 1),
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    lineHeight: Math.max(17, text.fontSize * 1.45),
    color: theme.textPrimary,
  }
}

function nextMarkdownHeading(
  title: string,
  depth: number,
  y: number,
  height: number,
  slugs: Map<string, number>,
): MarkdownHeadingOutlineItem {
  const base = createMarkdownHeadingSlug(title)
  const count = slugs.get(base) ?? 0
  slugs.set(base, count + 1)
  return {
    id: count === 0 ? base : `${base}-${count + 1}`,
    title,
    depth,
    y,
    height,
  }
}

export function createMarkdownHeadingSlug(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'heading'
}

function normalizeAnchorId(anchor: string): string {
  const trimmed = anchor.trim().replace(/^#/, '')
  if (!trimmed) return ''
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

function isLocalAnchorHref(href: string): boolean {
  return href.trim().startsWith('#')
}

function codeTokenColor(token: TextToken, theme: ResolvedTheme): Color {
  if (token.type === 'property') return theme.textAccent
  if (token.type === 'string') return theme.accentSuccess
  if (token.type === 'number') return theme.accentWarning
  if (token.type === 'keyword') return theme.accentDanger
  if (token.type === 'comment') return theme.textDisabled
  if (token.type === 'variable') return theme.textAccent
  if (token.type === 'operator' || token.type === 'punctuation') return theme.textSecondary
  return theme.textPrimary
}

function normalizeCodeLanguageLabel(language: string): string {
  const label = language.trim()
  return label.length > 0 ? label.toUpperCase() : ''
}

function ellipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function pointInRect(point: Offset, rect: Rect): boolean {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
}

function intersectMarkdownRects(first: Rect, second: Rect): Rect {
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

function visibleHtmlFallback(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}
