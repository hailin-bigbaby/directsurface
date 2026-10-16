import { describe, expect, it } from 'vitest'
import { isScrollbarThumbHovered, resolveScrollbarGeometry } from '../rendering/scrollbar'
import { pointerKey } from './pointer_identity'
import { ScrollbarAxisController } from './scrollbar_interaction_controller'

function verticalGeometry(scrollOffset = 40) {
  return resolveScrollbarGeometry({
    axis: 'vertical',
    trackRect: { x: 88, y: 0, width: 12, height: 100 },
    viewportSize: 100,
    contentSize: 300,
    scrollOffset,
    visualThickness: 6,
    minThumbLength: 28,
    endInset: 2,
  })
}

describe('ScrollbarAxisController', () => {
  it.each(['vertical', 'horizontal'] as const)('distinguishes track and thumb hover on the %s axis', axis => {
    const controller = new ScrollbarAxisController(axis)
    const geometry = resolveScrollbarGeometry({
      axis,
      trackRect: axis === 'vertical'
        ? { x: 88, y: 0, width: 12, height: 100 }
        : { x: 0, y: 88, width: 100, height: 12 },
      viewportSize: 100, contentSize: 300, scrollOffset: 40,
      visualThickness: 6, minThumbLength: 28, endInset: 2,
    })
    const point = (along: number, across = 89) => axis === 'vertical'
      ? { x: across, y: along } : { x: along, y: across }

    expect(controller.updateHover(point(90), geometry)).toBe(true)
    expect(controller.state.hovered).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(false)
    expect(controller.updateHover(point(80), geometry)).toBe(false)

    // The gutter beside the visible thumb remains part of its drag target.
    expect(controller.updateHover(point(20), geometry)).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(true)
    expect(controller.updateHover(point(20, 99), geometry)).toBe(false)
    expect(controller.updateHover(point(90), geometry)).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(false)
    expect(controller.updateHover(point(20), geometry)).toBe(true)
    expect(controller.clearHover()).toBe(true)
    expect(controller.state.hoverPosition).toBeUndefined()
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(false)
    expect(controller.clearHover()).toBe(false)
  })

  it('resolves hover from current geometry when scrolling beneath a stationary pointer', () => {
    const controller = new ScrollbarAxisController('vertical')
    const point = { x: 89, y: 20 }
    controller.updateHover(point, verticalGeometry(0))
    point.y = 90
    expect(isScrollbarThumbHovered(controller.state, verticalGeometry(0))).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, verticalGeometry(200))).toBe(false)
    const fitting = { ...verticalGeometry(), maxScroll: 0 }
    expect(isScrollbarThumbHovered(controller.state, fitting)).toBe(false)
    expect(controller.updateHover(point, fitting)).toBe(true)
    expect(controller.state.hoverPosition).toBeUndefined()
  })

  it('restores thumb or track hover on release and clears it on cancellation', () => {
    const controller = new ScrollbarAxisController('vertical')
    const geometry = verticalGeometry()
    controller.beginPointer({ x: 89, y: 20 }, geometry, pointerKey(1))
    expect(controller.endPointer({ x: 89, y: 90 }, geometry, pointerKey(2)).handled).toBe(false)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(true)
    expect(controller.endPointer({ x: 89, y: 90 }, geometry, pointerKey(1))).toMatchObject({
      dragEnded: true, releasePointer: true, stateChanged: true,
    })
    expect(controller.state.hovered).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(false)
    expect(controller.endPointer({ x: 89, y: 20 }, geometry).stateChanged).toBe(true)
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(true)
    expect(controller.cancelPointer()).toBe(true)
    expect(controller.state.hoverPosition).toBeUndefined()
    expect(isScrollbarThumbHovered(controller.state, geometry)).toBe(false)
  })
})
