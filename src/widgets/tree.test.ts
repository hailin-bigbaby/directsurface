import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelineOwner } from '../core/render_object'
import { PaintContext } from '../rendering/paint_context'
import { KeyboardBindingController } from '../core/keyboard_binding_controller'
import { FocusManager } from '../core/focus_manager'
import { TextMeasurer } from '../core/text_measurer'
import { ImGuiDarkTheme, ImGuiLightTheme } from '../theme/default_theme'
import { blendColor, deriveScrollbarStyle, deriveTreeStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { createTheme, colorToCSS } from '../theme/theme'
import { RenderTreeView, type TreeNode } from './tree'

function makeRoots(count: number): TreeNode[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `node-${i}`,
    label: `Node ${i}`,
  }))
}

function layout(tree: RenderTreeView, width = 100, height = 50, theme = ImGuiDarkTheme): void {
  tree.layout({ minWidth: 0, maxWidth: width, minHeight: 0, maxHeight: height }, false, { theme })
}

function paintTree(
  tree: RenderTreeView,
  theme = ImGuiDarkTheme,
): { fillStyles: string[]; strokeStyles: string[]; textStyles: string[]; lineSegments: Array<[number, number, number, number]> } {
  const fillStyles: string[] = []
  const strokeStyles: string[] = []
  const textStyles: string[] = []
  const lineSegments: Array<[number, number, number, number]> = []
  let fillStyle: unknown = ''
  let strokeStyle: unknown = ''
  let pathStart: { x: number; y: number } | undefined
  let pathSegments: Array<[number, number, number, number]> = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(() => {
      pathStart = undefined
      pathSegments = []
    }),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    stroke: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
      lineSegments.push(...pathSegments)
    }),
    fillRect: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) fillStyles.push(fillStyle)
    }),
    strokeRect: vi.fn(() => {
      if (typeof strokeStyle === 'string' && strokeStyle) strokeStyles.push(strokeStyle)
    }),
    fillText: vi.fn(() => {
      if (typeof fillStyle === 'string' && fillStyle) textStyles.push(fillStyle)
    }),
    measureText: vi.fn(() => ({ width: 10 })),
    moveTo: vi.fn((x: number, y: number) => {
      pathStart = { x, y }
    }),
    lineTo: vi.fn((x: number, y: number) => {
      if (pathStart) pathSegments.push([pathStart.x, pathStart.y, x, y])
      pathStart = { x, y }
    }),
    closePath: vi.fn(),
    set fillStyle(value: unknown) { fillStyle = value },
    get fillStyle() { return fillStyle as string },
    set strokeStyle(value: unknown) { strokeStyle = value },
    get strokeStyle() { return strokeStyle as string },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  tree.paint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return { fillStyles, strokeStyles, textStyles, lineSegments }
}

function paintTreeTextValues(tree: RenderTreeView, theme = ImGuiDarkTheme): string[] {
  const textValues: string[] = []
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string) => textValues.push(String(text))),
    measureText: vi.fn(text => ({ width: Array.from(String(text)).length * 8 }) as TextMetrics),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    set fillStyle(_value: unknown) {},
    get fillStyle() { return '' },
    set strokeStyle(_value: unknown) {},
    get strokeStyle() { return '' },
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  tree.paint(new PaintContext(ctx, theme), { x: 0, y: 0 })
  return textValues
}

afterEach(() => {
  KeyboardBindingController.disposeInstance()
  FocusManager.disposeInstance()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RenderTreeView virtualization and scrolling', () => {
  it('defaults to a flush surface and supports an explicit framed panel without changing layout', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'root', label: 'Root' }] })
    layout(tree, 180, 80, ImGuiLightTheme)
    const beforeSize = { ...tree.size }
    const style = deriveTreeStyle(ImGuiLightTheme)

    const flush = paintTree(tree, ImGuiLightTheme)
    expect(tree.appearance).toBe('flush')
    expect(flush.strokeStyles).not.toContain(colorToCSS(style.panelBorder))

    tree.appearance = 'framed'
    const framed = paintTree(tree, ImGuiLightTheme)
    expect(framed.strokeStyles.at(-1)).toBe(colorToCSS(style.panelBorder))
    expect(tree.size).toEqual(beforeSize)
    tree.dispose()
  })

  it('paints built-in icon names as glyphs and preserves text icon fallback', () => {
    class MockPath2D {
      constructor(readonly data: string) {}
    }
    vi.stubGlobal('Path2D', MockPath2D)
    const tree = new RenderTreeView({
      roots: [
        { key: 'built-in', label: 'Built in', icon: 'folder' },
        { key: 'text', label: 'Text', icon: '📁' },
      ],
    })
    layout(tree, 180, 80)

    const textValues = paintTreeTextValues(tree)

    expect(textValues).not.toContain('folder')
    expect(textValues).toContain('📁')
    expect(textValues).toEqual(expect.arrayContaining(['Built in', 'Text']))
  })

  it('applies height constraints on the tree itself', () => {
    const tree = new RenderTreeView({
      roots: makeRoots(3),
      height: 180,
      minHeight: 120,
      maxHeight: 260,
    })

    tree.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })

    expect(tree.height).toBe(180)
    expect(tree.size.height).toBe(180)

    tree.height = undefined
    tree.maxHeight = undefined
    tree.minHeight = 360
    tree.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(tree.size.height).toBe(360)

    tree.minHeight = undefined
    tree.maxHeight = 160
    tree.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: Infinity }, false, { theme: ImGuiDarkTheme })
    expect(tree.size.height).toBe(160)

    tree.layout({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 140 }, false, { theme: ImGuiDarkTheme })
    expect(tree.size.height).toBe(140)
  })

  it('resolves visible nodes and row rectangles from global positions', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: 'Root',
        selectable: false,
        children: [{ key: 'patient.name', label: 'name' }],
      }],
      defaultExpandedKeys: ['root'],
    })
    layout(tree, 180, 80)
    tree.offset = { x: 12, y: 20 }
    const rowHeight = tree.debugState().rowHeight

    expect(tree.nodeAtPosition({ x: 20, y: 20 + rowHeight / 2 })?.key).toBe('root')
    expect(tree.nodeAtPosition({ x: 20, y: 20 + rowHeight * 1.5 })?.key).toBe('patient.name')
    expect(tree.isExpandToggleAtPosition({ x: tree.globalOffset.x + tree.indentWidth, y: 20 + rowHeight / 2 })).toBe(true)
    expect(tree.isExpandToggleAtPosition({ x: tree.globalOffset.x + tree.indentWidth * 2, y: 20 + rowHeight * 1.5 })).toBe(false)
    expect(tree.nodeRect('patient.name')).toEqual({
      x: 12,
      y: 20 + rowHeight,
      width: 180,
      height: rowHeight,
    })
  })

  it('does not resolve nodes outside the visible tree viewport', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree, 180, 50)
    tree.offset = { x: 10, y: 20 }
    const rowHeight = tree.debugState().rowHeight
    const outsideViewport = { x: 20, y: tree.globalOffset.y + rowHeight * 4.5 }

    expect(outsideViewport.y).toBeGreaterThan(tree.globalOffset.y + tree.size.height)
    expect(tree.nodeAtPosition(outsideViewport)).toBeNull()
    expect(tree.nodeRect('node-5')).toBeUndefined()
  })

  it('clamps wheel scrolling through the fixed virtual range helpers', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree)

    for (let i = 0; i < 20; i++) {
      tree.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    }

    const maxScrollY = Math.max(0, tree.debugState().totalContentH - 50)
    expect(tree.debugState().scrollY).toBe(maxScrollY)

    for (let i = 0; i < 20; i++) {
      tree.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: -1 })
    }

    expect(tree.debugState().scrollY).toBe(0)
  })

  it('does not consume wheel when the tree does not overflow', () => {
    const tree = new RenderTreeView({ roots: makeRoots(2) })
    layout(tree)

    const consumed = tree.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(consumed).toBe(false)
    expect(tree.debugState().scrollY).toBe(0)
  })

  it('contains wheel events at scroll boundaries when the tree overflows', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree)

    const upAtTop = tree.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: -1,
    })
    for (let i = 0; i < 20; i++) {
      tree.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    }
    const downAtBottom = tree.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 0,
      deltaY: 1,
    })

    expect(upAtTop).toBe(true)
    expect(downAtBottom).toBe(true)
  })

  it('does not consume horizontal wheel input in a vertical tree', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree)

    expect(tree.onWheel({
      pointerId: 0,
      position: { x: 10, y: 10 },
      type: 'wheel',
      deltaX: 1,
      deltaY: 0,
    })).toBe(false)
    expect(tree.debugState().scrollY).toBe(0)
  })

  it('rebuilds visible rows when setRoots receives the same mutated array', () => {
    const roots: TreeNode[] = [{
      key: 'root',
      label: 'Root',
      children: [{ key: 'pending', label: '(pending)', selectable: false }],
    }]
    const tree = new RenderTreeView({
      roots,
      defaultExpandedKeys: ['root'],
    })
    layout(tree, 160, 120)

    expect(paintTreeTextValues(tree)).toContain('(pending)')

    roots[0]!.children = [{ key: 'child', label: 'Child' }]
    tree.setRoots(roots)

    const textValues = paintTreeTextValues(tree)
    expect(textValues).toContain('Child')
    expect(textValues).not.toContain('(pending)')
  })

  it('paints label tokens with semantic colors', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: 'name: value',
        labelTokens: [
          { text: 'name', kind: 'name' },
          { text: ': ', kind: 'punctuation' },
          { text: "'value'", kind: 'string' },
        ],
      }],
    })
    layout(tree, 180, 80)
    const painted = paintTree(tree)
    const s = deriveTreeStyle(ImGuiDarkTheme)

    expect(painted.textStyles).toContain(colorToCSS(s.labelTokenText.name))
    expect(painted.textStyles).toContain(colorToCSS(s.labelTokenText.punctuation))
    expect(painted.textStyles).toContain(colorToCSS(s.labelTokenText.string))
  })

  it('drags the shared vertical scrollbar state', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree)
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const stopPropagation = vi.fn()

    tree.onPointerDown({
      pointerId: 0,
      position: { x: 95, y: 10 },
      type: 'down',
      setPointerCapture,
      releasePointerCapture,
      stopPropagation,
    })
    tree.onPointerMove({
      pointerId: 0,
      position: { x: 95, y: 40 },
      type: 'move',
      stopPropagation,
    })

    expect(tree.debugState().scrollY).toBeGreaterThan(0)

    tree.onPointerUp({
      pointerId: 0,
      position: { x: 95, y: 40 },
      type: 'up',
      releasePointerCapture,
      stopPropagation,
    })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalled()
    expect(tree.needsPaint).toBe(true)
  })

  it('scrolls focused rows into view with shared scrollToIndex logic', () => {
    const tree = new RenderTreeView({ roots: makeRoots(20) })
    layout(tree)

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    }

    expect(tree.debugState().focusedIndex).toBe(10)
    expect(tree.debugState().scrollY).toBeGreaterThan(0)

    tree.dispose()
  })

  it('clears focus and blocks interactions when disabled dynamically', () => {
    const onSelect = vi.fn()
    const onExpand = vi.fn()
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: 'Root',
        children: [{ key: 'child', label: 'Child' }],
      }],
      onSelect,
      onExpand,
    })
    layout(tree, 160, 80)
    FocusManager.instance.setFocus(tree)
    tree.onPointerMove({ pointerId: 0, position: { x: 40, y: 5 }, type: 'move' })

    tree.disabled = true

    expect(tree.isFocused).toBe(false)
    expect(FocusManager.instance.current).toBeNull()
    expect(tree.debugState().hoveredKey).toBe('')
    expect(tree.debugState().focusedIndex).toBe(-1)
    expect(tree.getCopyText()).toBeNull()
    expect(tree.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(false)
    expect(tree.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })).toBe(false)
    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    expect(tree.selectedKey).toBe('')
    expect(tree.expandedKeys).toEqual([])
    expect(onSelect).not.toHaveBeenCalled()
    expect(onExpand).not.toHaveBeenCalled()

    tree.disabled = false
    FocusManager.instance.setFocus(tree)
    expect(tree.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent)).toBe(true)
    expect(tree.expandedKeys).toEqual(['root'])

    tree.dispose()
  })

  it('keeps pointer clicks aligned after the selected row scrolls out while blurred', () => {
    const onSelect = vi.fn()
    const tree = new RenderTreeView({ roots: makeRoots(30), onSelect })
    layout(tree, 160, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    expect(tree.selectedKey).toBe('node-0')
    FocusManager.instance.clearFocus()

    const rowHeight = tree.debugState().rowHeight
    ;(tree as any)._scroll.setOffset(rowHeight * 5, {
      viewportSize: tree.size.height,
      contentSize: tree.debugState().totalContentH,
    })
    tree.onPointerMove({ pointerId: 0, position: { x: 40, y: rowHeight / 2 }, type: 'move' })
    expect(tree.debugState().hoveredKey).toBe('node-5')

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: rowHeight / 2 }, type: 'down' })

    expect(tree.selectedKey).toBe('node-5')
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'node-5' }))
    expect(tree.debugState().scrollY).toBe(rowHeight * 5)

    tree.dispose()
  })
})

describe('RenderTreeView context menus and painted targets', () => {
  it('preserves a selected collapsed descendant across roots replacement', () => {
    const roots: TreeNode[] = [{
      key: 'root',
      label: 'Root',
      children: [{ key: 'child', label: 'Child' }],
    }]
    const tree = new RenderTreeView({ roots, defaultExpandedKeys: ['root'] })
    tree.selectedKey = 'child'
    tree.expandedKeys = []

    expect(tree.selectedKey).toBe('child')
    tree.setRoots([{ key: 'root', label: 'Next root', children: [{ key: 'child', label: 'Next child' }] }])
    expect(tree.selectedKey).toBe('child')
    expect(tree.nodeRect('child')).toBeUndefined()

    tree.setRoots([{ key: 'root', label: 'Root without child' }])
    expect(tree.selectedKey).toBe('')
    tree.dispose()
  })

  it('clears selection when a replacement node becomes non-selectable', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'item', label: 'Item' }] })
    tree.selectedKey = 'item'

    tree.setRoots([{ key: 'item', label: 'Item', selectable: false }])

    expect(tree.selectedKey).toBe('')
    tree.dispose()
  })

  it('does not mutate state when no context-menu callback is configured', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'item', label: 'Item' }] })
    layout(tree, 160, 80)

    expect(tree.onContextMenu({ x: 40, y: 10 })).toBe(false)
    expect(tree.selectedKey).toBe('')
    expect(tree.isFocused).toBe(false)

    tree.dispose()
  })

  it('focuses and selects a pointer target without toggling its arrow', () => {
    const requests: unknown[] = []
    const onSelect = vi.fn()
    const tree = new RenderTreeView({
      roots: [{ key: 'root', label: 'Root', children: [{ key: 'child', label: 'Child' }] }],
      onSelect,
      onContextMenuRequest: request => {
        requests.push(request)
        return true
      },
    })
    layout(tree, 160, 80)

    expect(tree.onContextMenu({ x: 8, y: 10 })).toBe(true)
    expect(tree.selectedKey).toBe('root')
    expect(tree.isFocused).toBe(true)
    expect(tree.expandedKeys).toEqual([])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([expect.objectContaining({
      node: expect.objectContaining({ key: 'root' }),
      source: 'pointer',
      position: { x: 8, y: 10 },
    })])

    tree.dispose()
  })

  it('requests a keyboard context menu at the focused row bottom', () => {
    const onSelect = vi.fn()
    const onContextMenuRequest = vi.fn(() => true)
    const preventDefault = vi.fn()
    const tree = new RenderTreeView({
      roots: [{ key: 'item', label: 'Item' }],
      onSelect,
      onContextMenuRequest,
    })
    layout(tree, 160, 80)
    FocusManager.instance.setFocus(tree)

    const handled = tree.onKeyDown({
      key: 'F10',
      shiftKey: true,
      preventDefault,
    } as unknown as KeyboardEvent)

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(tree.selectedKey).toBe('item')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onContextMenuRequest).toHaveBeenCalledWith(expect.objectContaining({
      node: expect.objectContaining({ key: 'item' }),
      source: 'keyboard',
      position: { x: 0, y: tree.debugState().rowHeight },
    }))

    tree.dispose()
  })

  it('does not consume a rejected keyboard context-menu request', () => {
    const preventDefault = vi.fn()
    const tree = new RenderTreeView({
      roots: [{ key: 'item', label: 'Item' }],
      onContextMenuRequest: () => false,
    })
    layout(tree, 160, 80)
    FocusManager.instance.setFocus(tree)

    expect(tree.onKeyDown({ key: 'ContextMenu', preventDefault } as unknown as KeyboardEvent)).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(tree.selectedKey).toBe('item')

    tree.dispose()
  })

  it('exposes only clipped real-paint node targets and invalidates them', () => {
    const tree = new RenderTreeView({ roots: makeRoots(8) })
    layout(tree, 100, 50)

    expect(tree.debugState().visibleNodes).toEqual([])
    paintTree(tree)
    const targets = tree.debugState().visibleNodes
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.rect.y).toBeGreaterThanOrEqual(0)
      expect(target.rect.y + target.rect.height).toBeLessThanOrEqual(50)
      expect(tree.nodeAtPosition({
        x: target.rect.x + target.rect.width / 2,
        y: target.rect.y + target.rect.height / 2,
      })?.key).toBe(target.key)
    }
    expect(targets.some(target => target.key === `node-${targets.length}`)).toBe(false)

    tree.disabled = true
    expect(tree.debugState().visibleNodes).toEqual([])
    tree.disabled = false
    expect(tree.debugState().visibleNodes).toEqual([])
    paintTree(tree)
    expect(tree.debugState().visibleNodes.length).toBeGreaterThan(0)

    tree.offset = { x: 10, y: 10 }
    expect(tree.debugState().visibleNodes).toEqual([])
    tree.dispose()
  })
})

describe('RenderTreeView theme contexts', () => {
  it('re-derives layout metrics from the pipeline theme context', () => {
    const owner = new PipelineOwner({}, ImGuiDarkTheme)
    const tree = new RenderTreeView({ roots: makeRoots(5) })

    tree.attach(owner)
    layout(tree, 160, 80)

    const nextTheme = { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2 }
    owner.setTheme(nextTheme)
    tree.markNeedsLayout()
    owner.flushLayout()

    expect(tree.debugState().rowHeight).toBe(nextTheme.fontSize + nextTheme.framePadding * 1.5)
    expect(tree.debugState().indentWidth).toBe(nextTheme.fontSize + 4)

    tree.dispose()
  })

  it('recomputes row height and indent width when relaid out with a new theme context', () => {
    const tree = new RenderTreeView({ roots: makeRoots(5) })
    layout(tree, 160, 80, ImGuiDarkTheme)
    const before = tree.debugState()

    layout(tree, 160, 80, { ...ImGuiLightTheme, fontSize: ImGuiLightTheme.fontSize + 2 })
    const after = tree.debugState()

    expect(after.rowHeight).toBeGreaterThan(before.rowHeight)
    expect(after.indentWidth).toBeGreaterThan(before.indentWidth)
    expect(after.totalContentH).toBeGreaterThan(before.totalContentH)
    tree.dispose()
  })

  it('uses token-derived row, border, and arrow colors while painting', () => {
    const tree = new RenderTreeView({
      roots: [{ key: 'root', label: 'Root', children: [{ key: 'leaf', label: 'Leaf' }] }],
      defaultExpandedKeys: ['root'],
    })
    const style = deriveTreeStyle(ImGuiLightTheme)
    layout(tree, 140, 80, ImGuiLightTheme)
    tree.selectedKey = 'leaf'
    ;(tree as any)._hoveredKey = 'root'
    ;(tree as any)._focused = true
    ;(tree as any)._focusedIndex = 0

    const painted = paintTree(tree, ImGuiLightTheme)

    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.rowBg, 'hovered')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveBgColor(style.rowBg, 'selected')))
    expect(painted.strokeStyles).toContain(colorToCSS(resolveBgColor(style.rowBorder, 'focused')))
    expect(painted.fillStyles).toContain(colorToCSS(resolveTextColor(style.arrowText, 'normal')))
    expect(painted.textStyles).toContain(colorToCSS(resolveTextColor(style.labelText, 'selected')))

    tree.dispose()
  })

  it('reserves both scrollbars and paints complete overflowing labels', () => {
    const tree = new RenderTreeView({
      roots: [
        { key: 'long', label: 'LongLabelThatWouldReachTheScrollbar' },
        ...makeRoots(12),
      ],
    })
    layout(tree, 100, 45, ImGuiDarkTheme)

    const textValues = paintTreeTextValues(tree, ImGuiDarkTheme)

    expect(textValues).not.toContain('LongL...')
    expect(textValues).toContain('LongLabelThatWouldReachTheScrollbar')
    expect(tree.debugState().showHBar).toBe(true)
    expect(tree.debugState().showVBar).toBe(true)

    tree.dispose()
  })

  it('exposes overflowing labels as tooltip while hovered', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const tree = new RenderTreeView({
      roots: [
        { key: 'long', label: 'LongLabelThatWouldReachTheScrollbar' },
        ...makeRoots(12),
      ],
    })
    layout(tree, 100, 45, ImGuiDarkTheme)

    tree.onPointerMove({ pointerId: 0, position: { x: 40, y: 8 }, type: 'move' })
    expect(tree.tooltip).toBe('LongLabelThatWouldReachTheScrollbar')

    tree.onPointerMove({ pointerId: 0, position: { x: 94, y: 8 }, type: 'move' })
    expect(tree.tooltip).toBeUndefined()

    tree.onPointerLeave({ pointerId: 0, position: { x: 120, y: 8 }, type: 'move' })
    expect(tree.tooltip).toBeUndefined()

    tree.dispose()
  })

  it('uses explicit node tooltip for overflowing summarized labels', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => Array.from(String(text)).length * 8)
    const tree = new RenderTreeView({
      roots: [
        {
          key: 'long',
          label: 'VeryLong...',
          tooltip: 'VeryLongLabelThatWasSummarizedByTheCaller',
        },
      ],
    })
    layout(tree, 70, 24, ImGuiDarkTheme)

    tree.onPointerMove({ pointerId: 0, position: { x: 40, y: 8 }, type: 'move' })

    expect(tree.tooltip).toBe('VeryLongLabelThatWasSummarizedByTheCaller')

    tree.dispose()
  })

  it('paints hierarchy connector lines for nested visible nodes', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: 'Root',
        children: [
          { key: 'child-a', label: 'Child A' },
          {
            key: 'child-b',
            label: 'Child B',
            children: [{ key: 'leaf', label: 'Leaf' }],
          },
        ],
      }],
      defaultExpandedKeys: ['root', 'child-b'],
    })
    const style = deriveTreeStyle(ImGuiLightTheme)
    layout(tree, 180, 120, ImGuiLightTheme)

    const painted = paintTree(tree, ImGuiLightTheme)
    const flatNodes = (tree as any)._flatNodes
    const rootLayout = (tree as any)._rowLayout(flatNodes[0], 0, 0, ImGuiLightTheme)
    const childBLayout = (tree as any)._rowLayout(flatNodes[2], 0, tree.debugState().rowHeight * 2, ImGuiLightTheme)
    const rootAxisX = ImGuiLightTheme.framePadding + tree.debugState().indentWidth / 2
    const childBArrowLeft = childBLayout.arrowX - style.fontSize * 0.5
    const childBCenterY = tree.debugState().rowHeight * 2 + tree.debugState().rowHeight / 2
    const childBHorizontalLine = painted.lineSegments.find(([x1, y1, x2, y2]) =>
      x2 > x1 &&
      Math.abs(y1 - y2) < 0.01 &&
      Math.abs(y1 - (childBCenterY + 0.5)) < 1,
    )
    const rootContinuationLine = painted.lineSegments.find(([x1, y1, x2, y2]) =>
      x1 === x2 &&
      Math.abs(x1 - (rootAxisX + 0.5)) < 0.01 &&
      y1 > tree.debugState().rowHeight / 2 &&
      Math.abs(y2 - tree.debugState().rowHeight) < 1,
    )

    expect(painted.strokeStyles).toContain(colorToCSS(style.levelLine))
    expect(painted.lineSegments.length).toBeGreaterThanOrEqual(6)
    expect(rootLayout.arrowX).toBe(rootAxisX)
    expect(painted.lineSegments.some(([x1, , x2]) => x1 === x2 && Math.abs(x1 - (rootAxisX + 0.5)) < 0.01)).toBe(true)
    expect(childBHorizontalLine?.[2]).toBeLessThan(childBArrowLeft)
    expect(rootContinuationLine).toBeDefined()

    tree.dispose()
  })

  it('keeps a vertical guide for every ancestor level in deep expanded trees', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'level-1',
        label: 'Level 1',
        children: [{
          key: 'level-2',
          label: 'Level 2',
          children: [{
            key: 'level-3',
            label: 'Level 3',
            children: [{
              key: 'level-4',
              label: 'Level 4',
              children: [{
                key: 'level-5',
                label: 'Level 5',
                children: [{ key: 'level-6', label: 'Level 6' }],
              }],
            }],
          }],
        }],
      }],
      defaultExpandedKeys: ['level-1', 'level-2', 'level-3', 'level-4', 'level-5'],
    })
    layout(tree, 220, 160, ImGuiLightTheme)

    const painted = paintTree(tree, ImGuiLightTheme)
    const rowHeight = tree.debugState().rowHeight
    const indentWidth = tree.debugState().indentWidth
    const deepestCenterY = rowHeight * 5 + rowHeight / 2
    const axisXs = Array.from({ length: 5 }, (_, level) =>
      ImGuiLightTheme.framePadding + level * indentWidth + indentWidth / 2 + 0.5
    )

    for (const axisX of axisXs) {
      expect(painted.lineSegments.some(([x1, y1, x2, y2]) =>
        x1 === x2 &&
        Math.abs(x1 - axisX) < 0.01 &&
        Math.min(y1, y2) <= deepestCenterY &&
        Math.max(y1, y2) >= deepestCenterY,
      )).toBe(true)
    }

    tree.dispose()
  })

  it('continues the parent guide through a last expanded child row', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'src',
        label: 'src',
        children: [
          { key: 'core', label: 'core' },
          {
            key: 'theme',
            label: 'theme',
            children: [{ key: 'theme-ts', label: 'theme.ts' }],
          },
        ],
      }],
      defaultExpandedKeys: ['src', 'theme'],
    })
    layout(tree, 180, 100, ImGuiLightTheme)

    const painted = paintTree(tree, ImGuiLightTheme)
    const rowHeight = tree.debugState().rowHeight
    const rootAxisX = ImGuiLightTheme.framePadding + tree.debugState().indentWidth / 2 + 0.5
    const themeLowerHalfY = rowHeight * 2 + rowHeight * 0.75

    expect(painted.lineSegments.some(([x1, y1, x2, y2]) =>
      x1 === x2 &&
      Math.abs(x1 - rootAxisX) < 0.01 &&
      Math.min(y1, y2) <= themeLowerHalfY &&
      Math.max(y1, y2) >= themeLowerHalfY,
    )).toBe(true)

    tree.dispose()
  })

  it('weakens non-selectable category hover visuals', () => {
    const tree = new RenderTreeView({
      roots: [{
        key: 'root',
        label: '分类目录',
        selectable: false,
        children: [{ key: 'leaf', label: '叶子节点' }],
      }],
    })
    const style = deriveTreeStyle(ImGuiLightTheme)
    layout(tree, 140, 80, ImGuiLightTheme)
    ;(tree as any)._hoveredKey = 'root'

    const painted = paintTree(tree, ImGuiLightTheme)
    const expectedHoveredBg = colorToCSS(blendColor(style.panelBg, resolveBgColor(style.rowBg, 'hovered'), 0.28))
    const defaultHoveredBg = colorToCSS(resolveBgColor(style.rowBg, 'hovered'))
    const expectedTextColor = colorToCSS(blendColor(
      resolveTextColor(style.labelText, 'hovered'),
      ImGuiLightTheme.textDisabled,
      0.45,
    ))

    expect(painted.fillStyles).toContain(expectedHoveredBg)
    expect(painted.fillStyles).not.toContain(defaultHoveredBg)
    expect(painted.textStyles).toContain(expectedTextColor)

    tree.dispose()
  })
})

describe('RenderTreeView keyboard semantics', () => {
  it('activates a selectable node on double click', () => {
    const onActivate = vi.fn()
    const tree = new RenderTreeView({
      roots: makeRoots(3),
      onActivate,
    })
    layout(tree, 160, 80)

    tree.onDoubleClick({ x: 40, y: 25 })

    expect(tree.selectedKey).toBe('node-1')
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 'node-1' }))

    tree.dispose()
  })

  it('exposes selected node text for generic copy handling', () => {
    const tree = new RenderTreeView({
      roots: makeRoots(3),
      copyText: node => `${node.key}:${node.label}`,
    })
    tree.selectedKey = 'node-1'

    expect(tree.getCopyText()).toBe('node-1:Node 1')

    tree.dispose()
  })

  it('uses Space to select and Enter to activate the focused node', () => {
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    const tree = new RenderTreeView({
      roots: makeRoots(3),
      onSelect,
      onActivate,
    })
    layout(tree, 160, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 'node-1' }))
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect.mock.calls[1]![0]).toMatchObject({ key: 'node-1' })
    expect(tree.selectedKey).toBe('node-1')

    tree.dispose()
  })

  it('starts keyboard navigation from the currently selected node after focus enters', () => {
    const tree = new RenderTreeView({
      roots: makeRoots(5),
    })
    layout(tree, 160, 80)
    tree.selectedKey = 'node-3'

    FocusManager.instance.setFocus(tree)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))

    expect(tree.debugState().focusedIndex).toBe(4)

    tree.dispose()
  })

  it('reveals the currently selected node when first laid out in a constrained viewport', () => {
    const tree = new RenderTreeView({
      roots: makeRoots(20),
    })
    tree.selectedKey = 'node-12'

    layout(tree, 160, 50)

    expect(tree.debugState().scrollY).toBeGreaterThan(0)

    tree.dispose()
  })

  it('moves into the first child when ArrowRight is pressed on an expanded branch', () => {
    const tree = new RenderTreeView({
      roots: [{ key: 'root', label: 'Root', children: [{ key: 'leaf', label: 'Leaf' }] }],
      defaultExpandedKeys: ['root'],
    })
    layout(tree, 160, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))

    expect(tree.debugState().focusedIndex).toBe(1)

    tree.dispose()
  })

  it('treats non-selectable category nodes as expandable but not selectable', () => {
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    const tree = new RenderTreeView({
      roots: [{
        key: 'group',
        label: '分类节点',
        selectable: false,
        children: [{ key: 'leaf', label: '叶子节点' }],
      }],
      onSelect,
      onActivate,
    })
    layout(tree, 160, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 40, y: 5 }, type: 'down' })
    expect(tree.selectedKey).toBe('')
    expect(onSelect).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(tree.debugState().focusedIndex).toBe(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(tree.debugState().focusedIndex).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    expect(tree.selectedKey).toBe('leaf')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'leaf' }))

    tree.dispose()
  })

  it('clears hover on pointer leave without using cancel semantics', () => {
    const tree = new RenderTreeView({ roots: makeRoots(3) })
    layout(tree, 160, 80)

    tree.onPointerMove({ pointerId: 0, position: { x: 40, y: 5 }, type: 'move' })
    expect(tree.debugState().hoveredKey).toBe('node-0')

    tree.onPointerLeave({ pointerId: 0, position: { x: 220, y: 5 }, type: 'move' })

    expect(tree.debugState().hoveredKey).toBe('')
    tree.dispose()
  })
})

describe('RenderTreeView check mode', () => {
  it('cascades parent checks and emits leaf-only checkedKeys', () => {
    const onCheck = vi.fn()
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [
          { key: 'leaf-a', label: '叶子 A' },
          { key: 'leaf-b', label: '叶子 B' },
        ],
      }],
      onCheck,
    })
    layout(tree, 180, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 30, y: 5 }, type: 'down' })

    expect(tree.checkedKeys).toEqual(['leaf-a', 'leaf-b'])
    expect(tree.halfCheckedKeys).toEqual([])
    expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({
      checkedKeys: ['leaf-a', 'leaf-b'],
      halfCheckedKeys: [],
      toggledNode: expect.objectContaining({ key: 'group' }),
    }))

    tree.dispose()
  })

  it('derives half-checked parent state from externally assigned leaf keys', () => {
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [
          { key: 'leaf-a', label: '叶子 A' },
          { key: 'leaf-b', label: '叶子 B' },
        ],
      }],
      defaultCheckedKeys: ['leaf-a'],
    })
    layout(tree, 180, 80)

    expect(tree.checkedKeys).toEqual(['leaf-a'])
    expect(tree.halfCheckedKeys).toEqual(['group'])

    tree.checkedKeys = ['leaf-a', 'leaf-b']

    expect(tree.checkedKeys).toEqual(['leaf-a', 'leaf-b'])
    expect(tree.halfCheckedKeys).toEqual([])

    tree.dispose()
  })

  it('keeps checkable=false categories out of checkedKeys while allowing child checks', () => {
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'category',
        label: '分类',
        checkable: false,
        children: [
          { key: 'leaf-a', label: '叶子 A' },
          { key: 'leaf-b', label: '叶子 B' },
        ],
      }],
      defaultExpandedKeys: ['category'],
    })
    layout(tree, 180, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 80, y: 25 }, type: 'down' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

    expect(tree.checkedKeys).toEqual(['leaf-a'])
    expect(tree.halfCheckedKeys).toEqual(['category'])

    tree.dispose()
  })

  it('toggles the focused node check state with Space and keeps Enter for activate', () => {
    const onActivate = vi.fn()
    const onCheck = vi.fn()
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [{ key: 'leaf-a', label: '叶子 A' }],
      }],
      defaultExpandedKeys: ['group'],
      onActivate,
      onCheck,
    })
    layout(tree, 180, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 80, y: 25 }, type: 'down' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))

    expect(tree.checkedKeys).toEqual(['leaf-a'])
    expect(onCheck).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ key: 'leaf-a' }))

    tree.dispose()
  })

  it('anchors check-mode keyboard focus to the first visible checked node', () => {
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [
          { key: 'leaf-a', label: '叶子 A' },
          { key: 'leaf-b', label: '叶子 B' },
        ],
      }],
      defaultExpandedKeys: ['group'],
      defaultCheckedKeys: ['leaf-b'],
    })
    layout(tree, 180, 80)

    FocusManager.instance.setFocus(tree)

    expect(tree.debugState().focusedIndex).toBe(2)

    tree.dispose()
  })

  it('does not let measure layout clamp the real scroll state', () => {
    const tree = new RenderTreeView({
      roots: makeRoots(30),
    })
    layout(tree, 180, 80)
    tree.onWheel({ pointerId: 0, position: { x: 10, y: 10 }, type: 'wheel', deltaX: 0, deltaY: 1 })
    const before = tree.debugState().scrollY

    tree.measure({ minWidth: 0, maxWidth: 180, minHeight: 0, maxHeight: 1200 }, { theme: ImGuiDarkTheme })

    expect(before).toBeGreaterThan(0)
    expect(tree.debugState().scrollY).toBe(before)
    tree.dispose()
  })

  it('does not toggle checks when clicking the label lane in check mode', () => {
    const onSelect = vi.fn()
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [{ key: 'leaf-a', label: '叶子 A' }],
      }],
      onSelect,
    })
    layout(tree, 180, 80)

    tree.onPointerDown({ pointerId: 0, position: { x: 80, y: 5 }, type: 'down' })

    expect(tree.checkedKeys).toEqual([])
    expect(tree.selectedKey).toBe('')
    expect(onSelect).not.toHaveBeenCalled()

    tree.dispose()
  })

  it('cleans invalid checked keys when roots change', () => {
    const tree = new RenderTreeView({
      selectionMode: 'check',
      roots: [{
        key: 'group',
        label: '分组',
        children: [{ key: 'leaf-a', label: '叶子 A' }],
      }],
      defaultCheckedKeys: ['leaf-a'],
    })
    layout(tree, 180, 80)

    tree.setRoots([{
      key: 'next',
      label: '新分组',
      children: [{ key: 'leaf-b', label: '叶子 B' }],
    }])

    expect(tree.checkedKeys).toEqual([])
    expect(tree.halfCheckedKeys).toEqual([])

    tree.dispose()
  })
})


describe('TreeView automatic horizontal content scrolling', () => {
  const wheel = (tree: RenderTreeView, dx: number, dy = 0, shiftKey = false) => tree.onWheel({
    pointerId: 0, type: 'wheel', position: { x: tree.globalOffset.x + 10, y: tree.globalOffset.y + 10 }, deltaX: dx, deltaY: dy, shiftKey,
  })
  const deepRoots = (depth: number): TreeNode[] => {
    let node: TreeNode = { key: String(depth), label: 'Leaf' }
    for (let index = depth - 1; index >= 0; index--) node = { key: String(index), label: `N${index}`, children: [node] }
    return [node]
  }

  it('automatically grows on progressive expansion, includes offscreen rows and shrinks on collapse', () => {
    const tree = new RenderTreeView({ roots: deepRoots(20) })
    layout(tree, 140, 90)
    expect(tree.debugState().showHBar).toBe(false)
    for (let depth = 0; depth < 20; depth++) tree.expandedKeys = Array.from({ length: depth + 1 }, (_, i) => String(i))
    const expanded = tree.debugState()
    expect(expanded.showHBar).toBe(true)
    expect(expanded.totalContentW).toBeGreaterThan(20 * expanded.indentWidth)
    for (let i = 0; i < 20; i++) wheel(tree, 1, 1)
    expect(tree.debugState().scrollX).toBeCloseTo(expanded.totalContentW - expanded.viewportWidth)
    tree.collapseAll()
    expect(tree.debugState()).toMatchObject({ scrollX: 0, scrollY: 0, showHBar: false, showVBar: false })
    tree.dispose()
  })

  it('keeps deferred reveal through zero-size and measure passes until a usable layout', () => {
    const tree = new RenderTreeView({ roots: deepRoots(30) })
    tree.expandAll()
    tree.selectedKey = '30'
    tree.revealSelectedKey({ deferUntilLayout: true })
    layout(tree, 0, 0)
    tree.measure({ minWidth: 0, maxWidth: 800, minHeight: 0, maxHeight: 800 })
    layout(tree, 160, 130)
    expect(tree.debugState().scrollX).toBeGreaterThan(0)
    expect(tree.nodeRect('30')).toBeDefined()
    tree.selectedKey = '0'
    tree.revealSelectedKey({ deferUntilLayout: true })
    layout(tree, 160, 130)
    expect(tree.debugState().scrollX).toBe(0)
    tree.dispose()
  })

  it('preserves a reveal requested while hidden and uses the most recent selection', () => {
    const tree = new RenderTreeView({ roots: deepRoots(30) })
    tree.expandAll(); layout(tree, 160, 130)
    tree.visible = false
    tree.selectedKey = '25'; tree.revealSelectedKey({ deferUntilLayout: true })
    tree.selectedKey = '30'; tree.revealSelectedKey({ deferUntilLayout: true })
    layout(tree, 160, 130)
    tree.visible = true; layout(tree, 160, 130)
    expect(tree.debugState().scrollX).toBeGreaterThan(0)
    expect(tree.nodeRect('30')).toBeDefined()
    tree.dispose()
  })

  it('resolves scrollbar interdependence in both directions', () => {
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Wide label' }, { key: 'b', label: 'Wide label' }] })
    layout(tree, 400, 300)
    const { totalContentW: width, totalContentH: height } = tree.debugState()
    layout(tree, width + 4, height - 1)
    expect(tree.debugState()).toMatchObject({ showHBar: true, showVBar: true })
    layout(tree, width - 1, height + 4)
    expect(tree.debugState()).toMatchObject({ showHBar: true, showVBar: true })
    layout(tree, 400, 300)
    expect(tree.debugState()).toMatchObject({ showHBar: false, showVBar: false })
    tree.dispose()
  })

  it('measures rendered tokens, icons, checkbox mode and mutable roots using cached extents', () => {
    const measure = vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * 8)
    const roots: TreeNode[] = [{ key: 'a', label: 'A', labelTokens: [{ text: 'Rendered token is much longer', kind: 'string' }], icon: 'folder' }]
    const tree = new RenderTreeView({ roots })
    layout(tree, 120, 80)
    const first = tree.debugState().totalContentW
    expect(first).toBeGreaterThan(200)
    measure.mockClear()
    wheel(tree, 1)
    wheel(tree, -1)
    tree.debugState()
    expect(measure).not.toHaveBeenCalled()
    tree.selectionMode = 'check'
    expect(tree.debugState().totalContentW).toBeGreaterThan(first)
    roots[0]!.labelTokens = [{ text: 'A', kind: 'string' }]
    tree.setRoots(roots)
    expect(tree.debugState().showHBar).toBe(false)
    tree.dispose()
  })

  it('recomputes extents on font metric invalidation and theme changes', () => {
    let factor = 4
    vi.spyOn(TextMeasurer, 'measureWidth').mockImplementation(text => text.length * factor)
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'abcdefghij' }] })
    layout(tree, 120, 80)
    expect(tree.debugState().showHBar).toBe(false)
    factor = 20
    TextMeasurer.clearCache()
    expect(tree.debugState().showHBar).toBe(true)
    const before = tree.debugState().totalContentW
    layout(tree, 120, 80, createTheme(ImGuiDarkTheme, { fontSize: 28 }))
    expect(tree.debugState().totalContentW).toBeGreaterThan(before)
    tree.dispose()
  })

  it('supports deltaX, Shift-wheel and independent axes while preserving boundary containment', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Long label '.repeat(30) }, ...makeRoots(20)] })
    layout(tree, 160, 100)
    expect(wheel(tree, 1)).toBe(true)
    expect(tree.debugState()).toMatchObject({ scrollX: 60, scrollY: 0 })
    expect(wheel(tree, 0, 1, true)).toBe(true)
    expect(tree.debugState()).toMatchObject({ scrollX: 120, scrollY: 0 })
    expect(wheel(tree, 0, 1)).toBe(true)
    expect(tree.debugState()).toMatchObject({ scrollX: 120, scrollY: 60 })
    for (let i = 0; i < 100; i++) wheel(tree, 1)
    expect(wheel(tree, 1)).toBe(true)
    tree.disabled = true
    expect(wheel(tree, -1)).toBe(false)
    tree.dispose()
  })

  it('drags the horizontal thumb with pointer ownership and never selects scrollbar/corner rows', () => {
    const select = vi.fn()
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Wide '.repeat(30) }, ...makeRoots(20)], onSelect: select })
    layout(tree, 180, 100)
    const gutter = deriveScrollbarStyle(ImGuiDarkTheme).gutterSize
    const y = 100 - gutter / 2
    const capture = vi.fn()
    const release = vi.fn()
    tree.onPointerDown({ pointerId: 5, type: 'down', position: { x: 5, y }, setPointerCapture: capture })
    expect(capture).toHaveBeenCalledOnce()
    tree.onPointerMove({ pointerId: 6, type: 'move', position: { x: 100, y } })
    expect(tree.debugState().scrollX).toBe(0)
    tree.onPointerMove({ pointerId: 5, type: 'move', position: { x: 100, y } })
    expect(tree.debugState().scrollX).toBeGreaterThan(0)
    tree.onPointerCancel({ pointerId: 6, type: 'cancel', position: { x: 100, y }, releasePointerCapture: release })
    expect(release).not.toHaveBeenCalled()
    tree.onPointerUp({ pointerId: 5, type: 'up', position: { x: 100, y }, releasePointerCapture: release })
    expect(release).toHaveBeenCalledOnce()
    tree.onPointerDown({ pointerId: 5, type: 'down', position: { x: 179, y: 99 } })
    expect(tree.nodeAtPosition({ x: 10, y })).toBeNull()
    expect(tree.nodeAtPosition({ x: 179, y: 99 })).toBeNull()
    expect(select).not.toHaveBeenCalled()
    tree.dispose()
  })

  it('keeps deep arrows and checkboxes aligned after reveal and horizontal scrolling', () => {
    const check = vi.fn()
    const tree = new RenderTreeView({ roots: deepRoots(10), selectionMode: 'check', onCheck: check })
    tree.expandAll()
    layout(tree, 160, 130)
    tree.selectedKey = '8'
    tree.revealSelectedKey()
    const state = tree.debugState()
    expect(state.scrollX).toBeGreaterThan(0)
    const style = deriveTreeStyle(ImGuiDarkTheme)
    const x = 8 * state.indentWidth + style.paddingH + state.indentWidth / 2 - state.scrollX
    const y = 8 * state.rowHeight - state.scrollY + state.rowHeight / 2
    expect(tree.isExpandToggleAtPosition({ x, y })).toBe(true)
    tree.onPointerDown({ pointerId: 1, type: 'down', position: { x, y } })
    expect(tree.expandedKeys).not.toContain('8')
    expect(check).not.toHaveBeenCalled()
    tree.onPointerDown({ pointerId: 1, type: 'down', position: { x: x + state.indentWidth, y } })
    expect(check).toHaveBeenCalledOnce()
    tree.dispose()
  })

  it('does not relayout or snap horizontally when selecting a manually scrolled row', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Wide '.repeat(20) }] })
    layout(tree, 140, 90)
    wheel(tree, 1)
    paintTree(tree)
    const before = tree.debugState().scrollX
    tree.onPointerDown({ pointerId: 1, type: 'down', position: { x: 30, y: 10 } })
    expect(tree.selectedKey).toBe('a')
    expect(tree.needsLayout).toBe(false)
    expect(tree.debugState().scrollX).toBe(before)
    layout(tree, 140, 90)
    expect(tree.debugState().scrollX).toBe(before)
    tree.dispose()
  })

  it('invalidates painted debug targets on horizontal scrolling and clips them above the horizontal bar', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Wide '.repeat(20) }, ...makeRoots(20)] })
    layout(tree, 140, 90)
    paintTree(tree)
    expect(tree.debugState().visibleNodes.length).toBeGreaterThan(0)
    wheel(tree, 1)
    expect(tree.debugState().visibleNodes).toEqual([])
    paintTree(tree)
    const state = tree.debugState()
    for (const target of state.visibleNodes) {
      expect(target.rect.x + target.rect.width).toBeLessThanOrEqual(state.viewportWidth)
      expect(target.rect.y + target.rect.height).toBeLessThanOrEqual(state.viewportHeight)
    }
    tree.dispose()
  })

  it('preserves both offsets and painted targets during speculative measurement', () => {
    const tree = new RenderTreeView({ roots: [{ key: 'a', label: 'Wide '.repeat(20) }, ...makeRoots(20)] })
    layout(tree, 140, 90)
    wheel(tree, 1, 1)
    paintTree(tree)
    const before = tree.debugState()
    tree.measure({ minWidth: 0, maxWidth: 500, minHeight: 0, maxHeight: 800 }, { theme: ImGuiLightTheme })
    expect(tree.debugState()).toEqual(before)
    tree.dispose()
  })
})
