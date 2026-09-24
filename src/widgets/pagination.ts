import type { BoxConstraints, LayoutContext, Offset } from '../core/render_object'
import { RenderObject, constrainSize } from '../core/render_object'
import type { PointerEvent, InteractiveRenderObject } from '../gestures/recognizers'
import { isPrimaryPointerButton } from '../gestures/hit_test'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { TextMeasurer } from '../core/text_measurer'
import { derivePaginationStyle, resolveBgColor, resolveTextColor, type PaginationStyleTokens } from '../theme/component_styles'
import { FocusableControl, paintFocusRing, type ControlInteractionSnapshot } from './focusable_control'

type PaginationSegment =
  | { kind: 'prev'; label: string; disabled: boolean }
  | { kind: 'next'; label: string; disabled: boolean }
  | { kind: 'page'; label: string; page: number; selected: boolean; disabled: boolean }
  | { kind: 'ellipsis'; label: string }
  | { kind: 'summary'; label: string }

type InteractiveSegment = Extract<PaginationSegment, { kind: 'prev' | 'next' | 'page' }>

export class RenderPagination extends FocusableControl implements InteractiveRenderObject {
  static override debugTypeName = 'RenderPagination'
  onChange?: (page: number) => void

  private _currentPage: number
  private _totalPages: number
  private _maxVisiblePages: number
  private _showSummary: boolean
  private _hoveredIndex = -1
  private _pressedIndex = -1

  constructor(options: {
    currentPage: number
    totalPages: number
    maxVisiblePages?: number
    showSummary?: boolean
    disabled?: boolean
    onChange?: (page: number) => void
  }) {
    super({ disabled: options.disabled ?? false })
    this._currentPage = 1
    this._totalPages = 1
    this._maxVisiblePages = Math.max(3, options.maxVisiblePages ?? 5)
    this._showSummary = options.showSummary ?? true
    this.onChange = options.onChange
    this.totalPages = options.totalPages
    this.currentPage = options.currentPage
  }

  get disabled(): boolean { return this.isDisabled }
  set disabled(value: boolean) {
    this.setDisabledState(value)
  }

  get currentPage(): number { return this._currentPage }
  set currentPage(value: number) {
    const next = this._normalizePage(value)
    if (next === this._currentPage) return
    this._currentPage = next
    this.markNeedsLayout()
  }

  get totalPages(): number { return this._totalPages }
  set totalPages(value: number) {
    const next = Math.max(1, Math.floor(value) || 1)
    if (next === this._totalPages) return
    this._totalPages = next
    this._currentPage = this._normalizePage(this._currentPage)
    this.markNeedsLayout()
  }

  visitChildren(_visitor: (child: RenderObject) => void): void {}

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const style = derivePaginationStyle(context.theme)
    const width = this._segments(context.theme).reduce((sum, segment, index, segments) => {
      const segmentWidth = this._segmentWidth(style, context.theme.fontFamily, segment)
      return sum + segmentWidth + (index < segments.length - 1 ? style.itemGap : 0)
    }, 0)
    this.size = constrainSize(constraints, {
      width,
      height: style.height,
    })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const style = derivePaginationStyle(context.theme)
    const dl = new DrawList(context)
    const segments = this._segments(context.theme)
    const rects = this._segmentRects(style, context.theme.fontFamily)
    const { x, y } = offset

    dl.fillRect(x, y, this.size.width, this.size.height, style.backgroundColor, style.borderRadius)
    dl.strokeRect(x, y, this.size.width, this.size.height, style.borderColor, 1, style.borderRadius)

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!
      const rect = rects[index]!
      const segX = x + rect.x
      const isInteractive = segment.kind === 'prev' || segment.kind === 'next' || segment.kind === 'page'
      if (isInteractive) {
        const interactive = segment as InteractiveSegment
        const state = {
          disabled: this.isDisabled || interactive.disabled,
          selected: segment.kind === 'page' && segment.selected,
          hovered: this._hoveredIndex === index,
          pressed: this._pressedIndex === index && this._hoveredIndex === index,
          focused: this.isFocused && this._hoveredIndex === index,
        }
        dl.fillRect(segX, y + 2, rect.width, this.size.height - 4, resolveBgColor(style.itemBg, state), style.borderRadius)
        if (this.isFocused && this._hoveredIndex === index && !this.isDisabled && !interactive.disabled) {
          paintFocusRing(dl, context.theme.focusBorder, segX, y + 2, rect.width, this.size.height - 4, style.borderRadius)
        }
        dl.fillText(
          segment.label,
          segX + rect.width / 2,
          y + this.size.height / 2,
          resolveTextColor(style.itemText, state),
          style.fontSize,
          style.fontFamily,
          'center',
          'middle',
        )
      } else if (segment.kind === 'summary') {
        dl.fillText(
          segment.label,
          segX,
          y + this.size.height / 2,
          style.summaryText,
          style.fontSize,
          style.fontFamily,
          'left',
          'middle',
        )
      } else {
        dl.fillText(
          segment.label,
          segX + rect.width / 2,
          y + this.size.height / 2,
          style.summaryText,
          style.fontSize,
          style.fontFamily,
          'center',
          'middle',
        )
      }
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!isPrimaryPointerButton(event)) return
    if (this.isDisabled) return
    if (!this.hitTest(event.position)) {
      return
    }
    this.requestFocus()
    const index = this._segmentIndexAt(event.position.x)
    if (index < 0) return
    const segment = this._segments(this.currentTheme)[index]
    if (!segment || segment.kind === 'ellipsis' || segment.kind === 'summary' || segment.disabled) return
    this._hoveredIndex = index
    this._pressedIndex = index
    this.markNeedsPaint()
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDisabled) return
    if (!this.hitTest(event.position)) {
      if (this._hoveredIndex >= 0) {
        this._hoveredIndex = -1
        this.markNeedsPaint()
      }
      return
    }
    const index = this._segmentIndexAt(event.position.x)
    if (index !== this._hoveredIndex) {
      this._hoveredIndex = index
      this.markNeedsPaint()
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this._pressedIndex < 0) return
    const pressedIndex = this._pressedIndex
    this._pressedIndex = -1
    const releasedIndex = this.hitTest(event.position)
      ? this._segmentIndexAt(event.position.x)
      : -1
    if (releasedIndex === pressedIndex) this._activateSegment(pressedIndex)
    this.markNeedsPaint()
  }

  onPointerCancel(_event: PointerEvent): void {
    if (this._hoveredIndex >= 0 || this._pressedIndex >= 0) {
      this._hoveredIndex = -1
      this._pressedIndex = -1
      this.markNeedsPaint()
    }
  }

  onPointerLeave(_event: PointerEvent): void {
    if (this._hoveredIndex >= 0) {
      this._hoveredIndex = -1
      this.markNeedsPaint()
    }
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isDisabled) return false
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        this._goToPage(this._currentPage - 1)
        return true
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        this._goToPage(this._currentPage + 1)
        return true
      case 'Home':
        event.preventDefault()
        this._goToPage(1)
        return true
      case 'End':
        event.preventDefault()
        this._goToPage(this._totalPages)
        return true
      default:
        return false
    }
  }

  override dispose(): void {
    super.dispose()
    this.onChange = undefined
  }

  protected override onDisabledStateChanged(disabled: boolean, _previous: ControlInteractionSnapshot): void {
    if (!disabled) return
    this._hoveredIndex = -1
    this._pressedIndex = -1
  }

  private _goToPage(page: number): void {
    const next = this._normalizePage(page)
    if (next === this._currentPage) return
    this._currentPage = next
    this.onChange?.(next)
    this.markNeedsLayout()
  }

  private _activateSegment(index: number): void {
    if (this.isDisabled) return
    const segment = this._segments(this.currentTheme)[index]
    if (!segment) return
    if (segment.kind === 'prev') {
      if (!segment.disabled) this._goToPage(this._currentPage - 1)
      return
    }
    if (segment.kind === 'next') {
      if (!segment.disabled) this._goToPage(this._currentPage + 1)
      return
    }
    if (segment.kind === 'page') {
      this._goToPage(segment.page)
    }
  }

  private _segmentIndexAt(globalX: number): number {
    if (this.isDisabled) return -1
    const style = derivePaginationStyle(this.currentTheme)
    const rects = this._segmentRects(style, this.currentTheme.fontFamily)
    const localX = globalX - this.globalOffset.x
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index]!
      const segment = this._segments(this.currentTheme)[index]!
      if (segment.kind === 'ellipsis' || segment.kind === 'summary') continue
      if (localX >= rect.x && localX <= rect.x + rect.width) return index
    }
    return -1
  }

  private _segmentRects(style: PaginationStyleTokens, fontFamily: string): Array<{ x: number; width: number }> {
    const segments = this._segments(this.currentTheme)
    const rects: Array<{ x: number; width: number }> = []
    let x = 0
    for (let index = 0; index < segments.length; index += 1) {
      const width = this._segmentWidth(style, fontFamily, segments[index]!)
      rects.push({ x, width })
      x += width + (index < segments.length - 1 ? style.itemGap : 0)
    }
    return rects
  }

  private _segmentWidth(style: PaginationStyleTokens, fontFamily: string, segment: PaginationSegment): number {
    const textWidth = TextMeasurer.measureWidth(segment.label, style.fontSize, fontFamily)
    if (segment.kind === 'summary') return textWidth
    if (segment.kind === 'ellipsis') return Math.max(style.minItemWidth * 0.5, textWidth + style.itemPaddingH)
    return Math.max(style.minItemWidth, textWidth + style.itemPaddingH * 2)
  }

  private _segments(theme = this.currentTheme): PaginationSegment[] {
    const pages = this._visiblePages()
    const segments: PaginationSegment[] = [
      { kind: 'prev', label: '上一页', disabled: this._currentPage <= 1 },
      ...pages,
      { kind: 'next', label: '下一页', disabled: this._currentPage >= this._totalPages },
    ]
    if (this._showSummary) {
      segments.push({ kind: 'summary', label: `第 ${this._currentPage} / ${this._totalPages} 页` })
    }
    return segments
  }

  private _visiblePages(): PaginationSegment[] {
    if (this._totalPages <= 0) return []
    if (this._totalPages <= this._maxVisiblePages + 2) {
      return Array.from({ length: this._totalPages }, (_, index) => this._pageSegment(index + 1))
    }

    const half = Math.floor(this._maxVisiblePages / 2)
    let start = Math.max(2, this._currentPage - half)
    let end = Math.min(this._totalPages - 1, start + this._maxVisiblePages - 1)
    if (end - start + 1 < this._maxVisiblePages) {
      start = Math.max(2, end - this._maxVisiblePages + 1)
    }

    const segments: PaginationSegment[] = [this._pageSegment(1)]
    if (start > 2) segments.push({ kind: 'ellipsis', label: '…' })
    for (let page = start; page <= end; page += 1) segments.push(this._pageSegment(page))
    if (end < this._totalPages - 1) segments.push({ kind: 'ellipsis', label: '…' })
    segments.push(this._pageSegment(this._totalPages))
    return segments
  }

  private _pageSegment(page: number): PaginationSegment {
    return {
      kind: 'page',
      label: String(page),
      page,
      selected: page === this._currentPage,
      disabled: this.isDisabled,
    }
  }

  private _normalizePage(page: number): number {
    const next = Math.floor(page) || 1
    return Math.max(1, Math.min(this._totalPages, next))
  }
}
