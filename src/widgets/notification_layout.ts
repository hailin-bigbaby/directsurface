import type { Rect } from '../core/render_object'
import { TextMeasurer } from '../core/text_measurer'
import type { PopupViewport } from '../core/popup_manager'
import { fitSingleLineText } from '../rendering/text_painter'

export interface NotificationLayoutInput {
  viewport: PopupViewport
  preferredCardWidth: number
  itemHeights: readonly number[]
  spacing: number
  margin: number
  maxVisible: number
}

export interface NotificationPlacement {
  index: number
  rect: Rect
}

export interface NotificationLayoutResult {
  cardWidth: number
  effectiveCapacity: number
  placements: NotificationPlacement[]
}

export interface NotificationToastMeasureInput {
  cardWidth: number
  minCardHeight: number
  maxCardHeight: number
  accentWidth: number
  padding: number
  iconSize: number
  titleHeight: number
  titleMessageGap: number
  message: string
  messageFontSize: number
  messageLineHeight: number
  fontFamily: string
  actionSize?: { width: number; height: number }
  closeSize?: number
}

export interface NotificationToastLayoutModel {
  cardHeight: number
  messageLines: readonly string[]
  iconRect: Rect
  titleRect: Rect
  messageRect: Rect
  actionRect?: Rect
  closeRect?: Rect
}

export function calculateNotificationLayout(input: NotificationLayoutInput): NotificationLayoutResult {
  const viewportX = input.viewport.x ?? 0
  const viewportY = input.viewport.y ?? 0
  const availableWidth = Math.max(0, input.viewport.width - input.margin * 2)
  const cardWidth = Math.min(input.preferredCardWidth, availableWidth)
  const x = viewportX + input.viewport.width - input.margin - cardWidth
  const bottom = viewportY + input.viewport.height - input.margin
  const placements: NotificationPlacement[] = []
  let y = viewportY + input.margin
  const candidateCount = Math.min(input.itemHeights.length, Math.max(0, input.maxVisible))
  for (let index = 0; index < candidateCount; index += 1) {
    const height = Math.max(0, input.itemHeights[index] ?? 0)
    if (cardWidth <= 0 || height <= 0 || y + height > bottom) break
    placements.push({
      index,
      rect: {
        x,
        y,
        width: cardWidth,
        height,
      },
    })
    y += height + input.spacing
  }
  return { cardWidth, effectiveCapacity: placements.length, placements }
}

export function measureNotificationToastLayout(input: NotificationToastMeasureInput): NotificationToastLayoutModel {
  const contentLeft = input.accentWidth + input.padding
  const textLeft = contentLeft + input.iconSize + input.padding
  const contentRight = Math.max(textLeft, input.cardWidth - input.padding)
  const controlGap = Math.max(4, input.padding / 2)
  const closeX = input.closeSize === undefined
    ? undefined
    : Math.max(contentLeft, contentRight - input.closeSize)
  const actionRight = closeX === undefined
    ? contentRight
    : closeX - controlGap
  const actionWidth = input.actionSize === undefined
    ? undefined
    : Math.min(input.actionSize.width, Math.max(0, actionRight - contentLeft))
  const actionX = input.actionSize === undefined
    ? undefined
    : actionRight - (actionWidth ?? 0)
  const titleRight = closeX === undefined ? contentRight : closeX - controlGap
  const messageControlLeft = Math.min(
    actionX ?? contentRight,
    closeX ?? contentRight,
  )
  const messageRight = messageControlLeft < contentRight
    ? messageControlLeft - controlGap
    : contentRight
  const messageWidth = Math.max(0, messageRight - textLeft)
  const messageLines = fitNotificationMessage(
    input.message,
    messageWidth,
    input.messageFontSize,
    input.fontFamily,
  )
  const messageHeight = messageLines.length * input.messageLineHeight
  const lowerHeight = Math.max(messageHeight, input.actionSize?.height ?? 0)
  const hasLowerContent = lowerHeight > 0
  const textBlockHeight = input.titleHeight +
    (hasLowerContent ? input.titleMessageGap + lowerHeight : 0)
  const innerHeight = Math.max(
    textBlockHeight,
    input.iconSize,
    input.closeSize ?? 0,
  )
  const minCardHeight = Math.max(0, input.minCardHeight)
  const maxCardHeight = Math.max(minCardHeight, input.maxCardHeight)
  const naturalHeight = Math.ceil(input.padding * 2 + innerHeight)
  const cardHeight = Math.min(maxCardHeight, Math.max(minCardHeight, naturalHeight))
  const titleY = Math.max(0, (cardHeight - textBlockHeight) / 2)
  const lowerY = titleY + input.titleHeight + (hasLowerContent ? input.titleMessageGap : 0)
  const messageY = lowerY + Math.max(0, (lowerHeight - messageHeight) / 2)
  const actionY = input.actionSize
    ? lowerY + Math.max(0, (lowerHeight - input.actionSize.height) / 2)
    : undefined
  const closeRect = input.closeSize === undefined || closeX === undefined
    ? undefined
    : {
        x: closeX,
        y: Math.max(0, input.padding / 2),
        width: input.closeSize,
        height: input.closeSize,
      }
  const actionRect = input.actionSize === undefined || actionWidth === undefined || actionX === undefined || actionY === undefined
    ? undefined
    : {
        x: actionX,
        y: actionY,
        width: actionWidth,
        height: input.actionSize.height,
      }

  return {
    cardHeight,
    messageLines,
    iconRect: {
      x: contentLeft,
      y: Math.max(0, (cardHeight - input.iconSize) / 2),
      width: input.iconSize,
      height: input.iconSize,
    },
    titleRect: {
      x: textLeft,
      y: titleY,
      width: Math.max(0, titleRight - textLeft),
      height: input.titleHeight,
    },
    messageRect: {
      x: textLeft,
      y: messageY,
      width: messageWidth,
      height: messageHeight,
    },
    actionRect,
    closeRect,
  }
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_.:/-]/
const FORBIDDEN_LINE_START = /[，。！？；：、,.!?;:）】》”’％%]/

export function fitNotificationMessage(
  message: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
): string[] {
  if (maxWidth <= 0 || !message) return []
  let first = ''
  let consumed = 0
  for (const char of message) {
    const next = first + char
    if (TextMeasurer.measureWidth(next, fontSize, fontFamily) > maxWidth) break
    first = next
    consumed += char.length
  }
  if (consumed >= message.length) return [first]
  if (!first) return [fitSingleLineText(message, maxWidth, fontSize, fontFamily).text]

  let remaining = message.slice(consumed)
  if (FORBIDDEN_LINE_START.test(remaining[0] ?? '') && first.length > 1) {
    const carry = [...first].pop()!
    first = first.slice(0, -carry.length)
    remaining = carry + remaining
  }

  const previous = first[first.length - 1] ?? ''
  const next = remaining[0] ?? ''
  if (IDENTIFIER_CHAR.test(previous) && IDENTIFIER_CHAR.test(next)) {
    let tokenStart = first.length
    while (tokenStart > 0 && IDENTIFIER_CHAR.test(first[tokenStart - 1]!)) tokenStart -= 1
    const remainingIdentifier = remaining.match(/^[A-Za-z0-9_.:/-]*/)?.[0] ?? ''
    const identifier = first.slice(tokenStart) + remainingIdentifier
    if (tokenStart > 0 && identifier && TextMeasurer.measureWidth(identifier, fontSize, fontFamily) <= maxWidth) {
      remaining = first.slice(tokenStart) + remaining
      first = first.slice(0, tokenStart)
    }
  }

  const second = fitSingleLineText(remaining.trimStart(), maxWidth, fontSize, fontFamily).text
  return second ? [first.trimEnd(), second] : [first.trimEnd()]
}
