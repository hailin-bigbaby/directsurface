export interface GridHeaderActionRect {
  x: number
  y: number
  w: number
  h: number
}

export interface GridHeaderActionLayout {
  titleRight: number
  iconSize: number
  sortRect: GridHeaderActionRect | null
  filterRect: GridHeaderActionRect | null
  groupBadgeRect: GridHeaderActionRect | null
}

export interface GridHeaderActionLayoutOptions {
  columnX: number
  columnWidth: number
  headerY: number
  headerHeight: number
  paddingH: number
  fontSize: number
  metrics: GridHeaderActionStyleTokens
  showSort: boolean
  showFilter: boolean
  groupIndex: number
}

export function gridGroupBadgeLabel(groupIndex: number): string {
  return `G${groupIndex + 1}`
}

export function resolveGridHeaderActionLayout(
  options: GridHeaderActionLayoutOptions,
): GridHeaderActionLayout {
  const { slotSize, iconSize, gap, badgeHeight, badgePaddingH } = options.metrics
  const actionY = options.headerY + (options.headerHeight - slotSize) / 2
  let cursor = options.columnX + options.columnWidth - options.paddingH

  let groupBadgeRect: GridHeaderActionRect | null = null
  if (options.groupIndex >= 0) {
    const badgeText = gridGroupBadgeLabel(options.groupIndex)
    const badgeWidth = Math.max(
      slotSize,
      Math.ceil(badgeText.length * options.fontSize * 0.62 + badgePaddingH * 2),
    )
    groupBadgeRect = {
      x: cursor - badgeWidth,
      y: options.headerY + (options.headerHeight - badgeHeight) / 2,
      w: badgeWidth,
      h: badgeHeight,
    }
    cursor -= badgeWidth + gap
  }

  let filterRect: GridHeaderActionRect | null = null
  if (options.showFilter) {
    filterRect = { x: cursor - slotSize, y: actionY, w: slotSize, h: slotSize }
    cursor -= slotSize + gap
  }

  let sortRect: GridHeaderActionRect | null = null
  if (options.showSort) {
    sortRect = { x: cursor - slotSize, y: actionY, w: slotSize, h: slotSize }
    cursor -= slotSize + gap
  }

  return {
    titleRight: Math.max(options.columnX + options.paddingH, cursor),
    iconSize,
    sortRect,
    filterRect,
    groupBadgeRect,
  }
}

export function intersectGridHeaderActionRect(
  rect: GridHeaderActionRect,
  clip: GridHeaderActionRect,
): GridHeaderActionRect | null {
  const x = Math.max(rect.x, clip.x)
  const y = Math.max(rect.y, clip.y)
  const right = Math.min(rect.x + rect.w, clip.x + clip.w)
  const bottom = Math.min(rect.y + rect.h, clip.y + clip.h)
  if (right <= x || bottom <= y) return null
  return { x, y, w: right - x, h: bottom - y }
}

export function gridHeaderActionRectContains(rect: GridHeaderActionRect, position: { x: number; y: number }): boolean {
  return position.x >= rect.x &&
    position.x <= rect.x + rect.w &&
    position.y >= rect.y &&
    position.y <= rect.y + rect.h
}
import type { GridHeaderActionStyleTokens } from '../../theme/component_styles'
