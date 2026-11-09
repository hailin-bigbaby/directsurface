// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FocusManager } from '../core/focus_manager'
import { PipelineOwner } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { ImGuiDarkTheme } from '../theme/default_theme'
import type { CodeEditorHover } from './code_editor'
import { RenderCodeEditorHoverCardContent } from './code_editor_hover_card_content'

function hover(): CodeEditorHover {
  return {
    label: 'users',
    detail: 'table main.users',
    sections: [{
      kind: 'code',
      lines: ['CREATE TABLE preview …'],
      language: 'sql',
      text: 'CREATE TABLE preview …',
      copyText: 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
    }],
    links: [
      { label: 'First docs', href: 'https://example.com/docs', title: 'first' },
      { label: 'Second docs', href: 'https://example.com/docs', title: 'second' },
    ],
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 5 } },
  }
}

function paintContext(): PaintContext {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(text => ({ width: String(text).length * 8 })),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  return new PaintContext(ctx, ImGuiDarkTheme)
}

afterEach(() => {
  FocusManager.disposeInstance()
  vi.restoreAllMocks()
})

describe('RenderCodeEditorHoverCardContent', () => {
  it('builds embedded markdown and exposes only real global paint targets', () => {
    const onLinkClick = vi.fn()
    const content = new RenderCodeEditorHoverCardContent({ hover: hover(), onLinkClick })
    content.offset = { x: 30, y: 40 }
    content.attach(new PipelineOwner({}, ImGuiDarkTheme))
    content.layout({ minWidth: 0, maxWidth: 420, minHeight: 0, maxHeight: 260 }, false, {
      theme: ImGuiDarkTheme,
    })

    expect(content.interactionDebugState()).toEqual({
      truncated: true,
      visibleTextLines: [],
      links: [],
      codeBlocks: [],
    })

    content.paint(paintContext(), content.globalOffset)
    const state = content.interactionDebugState()
    expect(state.truncated).toBe(true)
    expect(state.visibleTextLines).toEqual(expect.arrayContaining(['users', 'table main.users']))
    expect(state.links.length).toBeGreaterThanOrEqual(2)
    expect(state.links.every(link => link.href === 'https://example.com/docs')).toBe(true)
    expect(state.links.every(link => !link.href.startsWith('ds-ui-hover-card-link:'))).toBe(true)
    expect(state.links[0]!.rect.x).toBeGreaterThanOrEqual(30)
    expect(state.links[0]!.rect.y).toBeGreaterThanOrEqual(40)

    const internalTargets = content.debugState().links
    const firstTargetByInternalHref = [...new Map(internalTargets.map(target => [target.href, target])).values()]
    expect(firstTargetByInternalHref).toHaveLength(2)
    for (const target of firstTargetByInternalHref) {
      content.onPointerDown({
        pointerId: 1,
        pointerType: 'mouse',
        type: 'down',
        button: 0,
        position: {
          x: target.rect.x + 30 + target.rect.width / 2,
          y: target.rect.y + 40 + target.rect.height / 2,
        },
      })
    }
    expect(onLinkClick).toHaveBeenNthCalledWith(1, {
      label: 'First docs',
      href: 'https://example.com/docs',
      title: 'first',
    })
    expect(onLinkClick).toHaveBeenNthCalledWith(2, {
      label: 'Second docs',
      href: 'https://example.com/docs',
      title: 'second',
    })
    content.dispose()
  })

  it('reports focus changes and closes from Escape without callbacks after dispose', () => {
    const onFocusChange = vi.fn()
    const onRequestClose = vi.fn()
    const content = new RenderCodeEditorHoverCardContent({
      hover: hover(),
      onFocusChange,
      onRequestClose,
    })

    content.focusIn()
    content.focusOut()
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    expect(content.onKeyDown(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onFocusChange.mock.calls).toEqual([[true], [false]])
    expect(onRequestClose).toHaveBeenCalledTimes(1)

    content.dispose()
    content.focusIn()
    content.focusOut()
    content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onFocusChange.mock.calls).toEqual([[true], [false]])
    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  it('renders link labels as passive accent text when no callback is supplied', () => {
    const content = new RenderCodeEditorHoverCardContent({ hover: hover() })
    content.layout({ minWidth: 0, maxWidth: 420, minHeight: 0, maxHeight: 260 }, false, {
      theme: ImGuiDarkTheme,
    })
    content.paint(paintContext(), { x: 0, y: 0 })

    expect(content.interactionDebugState().links).toEqual([])
    content.dispose()
  })
})
