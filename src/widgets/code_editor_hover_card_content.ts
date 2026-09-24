import type { Rect } from '../core/render_object'
import type { PointerEvent } from '../gestures/hit_test'
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownInline,
  MarkdownParagraphBlock,
} from './markdown_parser'
import { RenderMarkdownViewer } from './markdown_viewer'
import type {
  CodeEditorHover,
  CodeEditorHoverLink,
  CodeEditorHoverSection,
} from './code_editor'

export interface RenderCodeEditorHoverCardContentOptions {
  hover: CodeEditorHover
  onLinkClick?: (link: CodeEditorHoverLink) => void
  onFocusChange?: (focused: boolean) => void
  onRequestClose?: () => void
  /** @internal Bridges popup-surface pointer entry back to the editor session. */
  onPointerActivity?: () => void
}

export interface CodeEditorHoverCardInteractionDebugState {
  truncated: boolean
  visibleTextLines: string[]
  links: Array<{ href: string; rect: Rect }>
  codeBlocks: Array<{ blockIndex: number; blockRect: Rect; copyButtonRect: Rect | null }>
}

let nextHoverCardContentId = 0

export class RenderCodeEditorHoverCardContent extends RenderMarkdownViewer {
  private _linkCallback?: (link: CodeEditorHoverLink) => void
  private _focusCallback?: (focused: boolean) => void
  private _closeCallback?: () => void
  private _pointerActivityCallback?: () => void
  private readonly _linksByInternalHref: Map<string, CodeEditorHoverLink>
  private readonly _truncated: boolean
  private _disposed = false

  constructor(options: RenderCodeEditorHoverCardContentOptions) {
    const hover = cloneHover(options.hover)
    const contentId = ++nextHoverCardContentId
    const linksByInternalHref = new Map<string, CodeEditorHoverLink>()
    const document = hoverToMarkdownDocument(
      hover,
      contentId,
      linksByInternalHref,
      options.onLinkClick !== undefined,
    )
    super({
      document,
      appearance: 'embedded',
      shrinkWrap: 'both',
    })
    this._linksByInternalHref = linksByInternalHref
    this._linkCallback = options.onLinkClick
    this._focusCallback = options.onFocusChange
    this._closeCallback = options.onRequestClose
    this._pointerActivityCallback = options.onPointerActivity
    if (options.onLinkClick) {
      this.onLinkClick = event => {
        const link = this._linksByInternalHref.get(event.href)
        if (!link || !this._linkCallback || this._disposed) return
        this._linkCallback({ ...link })
      }
    }
    this._truncated = hover.sections?.some(section =>
      section.kind === 'code' &&
      section.copyText !== undefined &&
      visibleCodeText(section) !== section.copyText) ?? false
  }

  interactionDebugState(): CodeEditorHoverCardInteractionDebugState {
    if (this._disposed) return emptyInteractionDebugState()
    const state = this.debugState()
    const offset = this.globalOffset
    return {
      truncated: this._truncated,
      visibleTextLines: [...state.visibleTextLines],
      links: state.links.flatMap(target => {
        const link = this._linksByInternalHref.get(target.href)
        if (!link) return []
        return [{
          href: link.href,
          rect: offsetRect(target.rect, offset.x, offset.y),
        }]
      }),
      codeBlocks: state.codeBlocks
        .filter(block => block.blockRect.width > 0 && block.blockRect.height > 0)
        .map(block => ({
          blockIndex: block.blockIndex,
          blockRect: offsetRect(block.blockRect, offset.x, offset.y),
          copyButtonRect: block.copyButtonRect
            ? offsetRect(block.copyButtonRect, offset.x, offset.y)
            : null,
        })),
    }
  }

  override focusIn(): void {
    super.focusIn()
    if (!this._disposed) this._focusCallback?.(true)
  }

  override focusOut(): void {
    super.focusOut()
    if (!this._disposed) this._focusCallback?.(false)
  }

  override onKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this._closeCallback?.()
      event.preventDefault()
      return true
    }
    return super.onKeyDown(event)
  }

  onPointerEnter(_event: PointerEvent): void {
    if (!this._disposed) this._pointerActivityCallback?.()
  }

  override onPointerMove(event: PointerEvent): void {
    if (!this._disposed) this._pointerActivityCallback?.()
    super.onPointerMove(event)
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._linkCallback = undefined
    this._focusCallback = undefined
    this._closeCallback = undefined
    this._pointerActivityCallback = undefined
    this._linksByInternalHref.clear()
    this.onLinkClick = undefined
    super.dispose()
  }
}

function hoverToMarkdownDocument(
  hover: CodeEditorHover,
  contentId: number,
  linksByInternalHref: Map<string, CodeEditorHoverLink>,
  interactiveLinks: boolean,
): MarkdownDocument {
  const blocks: MarkdownBlock[] = [{
    type: 'heading',
    depth: 4,
    raw: hover.label,
    children: textInlines(hover.label),
  }]
  if (hover.detail) blocks.push(paragraph(hover.detail))
  if (hover.type) {
    blocks.push({
      type: 'paragraph',
      raw: hover.type,
      children: [{ type: 'code', text: hover.type }],
    })
  }
  for (const section of hover.sections ?? []) {
    blocks.push(...hoverSectionBlocks(section))
  }
  if (hover.links?.length) {
    const children: MarkdownInline[] = []
    for (let index = 0; index < hover.links.length; index += 1) {
      const link = hover.links[index]!
      if (index > 0) children.push({ type: 'softBreak' })
      if (!interactiveLinks) {
        children.push({ type: 'text', text: link.label })
        continue
      }
      const internalHref = `ds-ui-hover-card-link:${contentId}:${index}`
      linksByInternalHref.set(internalHref, { ...link })
      children.push({
        type: 'link',
        href: internalHref,
        title: link.title,
        children: textInlines(link.label),
      })
    }
    blocks.push({ type: 'paragraph', raw: '', children })
  }
  return { type: 'document', flavor: 'gfm', references: {}, blocks }
}

function hoverSectionBlocks(section: CodeEditorHoverSection): MarkdownBlock[] {
  if (section.kind === 'code') {
    return [{
      type: 'codeBlock',
      language: section.language,
      text: visibleCodeText(section),
      copyText: section.copyText,
    }]
  }
  if (section.kind === 'list') {
    return [{
      type: 'list',
      ordered: false,
      start: 1,
      loose: false,
      items: section.lines.map(line => ({ children: [paragraph(line)] })),
    }]
  }
  if (section.kind === 'warning') {
    return [{
      type: 'blockquote',
      children: section.lines.map(line => paragraph(line)),
    }]
  }
  return section.lines.map(line => paragraph(line))
}

function visibleCodeText(section: CodeEditorHoverSection): string {
  return section.text ?? section.lines.join('\n')
}

function paragraph(text: string): MarkdownParagraphBlock {
  return { type: 'paragraph', raw: text, children: textInlines(text) }
}

function textInlines(text: string): MarkdownInline[] {
  return [{ type: 'text', text }]
}

function cloneHover(hover: CodeEditorHover): CodeEditorHover {
  return {
    ...hover,
    range: {
      start: { ...hover.range.start },
      end: { ...hover.range.end },
    },
    sections: hover.sections?.map(section => ({
      ...section,
      lines: [...section.lines],
    })),
    links: hover.links?.map(link => ({ ...link })),
  }
}

function offsetRect(rect: Rect, x: number, y: number): Rect {
  return { x: rect.x + x, y: rect.y + y, width: rect.width, height: rect.height }
}

function emptyInteractionDebugState(): CodeEditorHoverCardInteractionDebugState {
  return { truncated: false, visibleTextLines: [], links: [], codeBlocks: [] }
}
