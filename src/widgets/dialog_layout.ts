import type { Offset } from '../core/render_object'
import type { PopupContext } from '../core/popup_manager'
import { PopupManager } from '../core/popup_manager'
import { TextMeasurer } from '../core/text_measurer'
import { wrapMeasuredTextLines } from '../rendering/text_block_layout'
import { paintSingleLineText } from '../rendering/text_painter'
import { DrawList } from '../rendering/draw_list'
import type { PaintContext } from '../rendering/paint_context'
import { deriveModalStyle, deriveScrollbarStyle, resolveBgColor, resolveTextColor } from '../theme/component_styles'
import { paintVBar, resolveScrollbarGeometryForState } from '../rendering/scrollbar'
import { ScrollbarAxisController } from '../gestures/scrollbar_interaction_controller'
import { pointerKey } from '../gestures/pointer_identity'
import type { PointerEvent, WheelPointerEvent } from '../gestures/hit_test'
import { paintIconGlyph, type IconName } from './icon'
import type { ModalButton, DialogIntent } from './modal'

export interface DialogRect { x: number; y: number; w: number; h: number }
export const inDialogRect = (p: Offset, r: DialogRect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

function wrapDialogLines(text: string, width: number, measure: (text: string) => number): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
    const lines = wrapMeasuredTextLines(paragraph, width, measure)
    // Avoid leaving a closing punctuation mark alone at the start of a wrapped line.
    for (let i = 1; i < lines.length; i++) {
      if (!/^[，。！？；：、）】》」』]/u.test(lines[i]!)) continue
      const previous = Array.from(lines[i - 1]!)
      const last = previous.pop()
      if (last && previous.length && measure(last + lines[i]) <= width) {
        lines[i - 1] = previous.join('')
        lines[i] = last + lines[i]
      }
    }
    return lines
  })
}

export function resolveDialogLayout(context: PopupContext, width: number, minHeight: number, content: string, buttons: ModalButton[], inputHeight = 0, scroll = 0, offset: Offset = { x: context.viewport.x ?? 0, y: context.viewport.y ?? 0 }) {
  const style = deriveModalStyle(context.theme)
  const margin = Math.min(style.padding, context.viewport.width / 8, context.viewport.height / 8)
  const panelW = Math.max(1, Math.min(width, context.viewport.width - margin * 2))
  const padding = Math.min(style.padding, panelW / 8)
  const innerW = Math.max(1, panelW - padding * 2)
  // The scrollbar occupies the outer padding, preserving text and control alignment.
  const textW = innerW
  const lineHeight = style.bodyLineHeight
  const contentLines = content ? wrapDialogLines(content, textW, text => TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily)) : []
  const textHeight = contentLines.length * lineHeight
  const widths = buttons.map(b => Math.max(style.buttonMinWidth, TextMeasurer.measureWidth(b.label, style.fontSize, style.fontFamily) + padding * 2))
  const stacked = widths.reduce((a, b) => a + b, 0) + Math.max(0, buttons.length - 1) * style.buttonSpacing > innerW
  const measuredButtons = buttons.map((b, i) => {
    const w = stacked ? innerW : widths[i]!
    const lines = wrapDialogLines(b.label, Math.max(1, w - padding * 2), text => TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily))
    return { ...b, w, h: style.buttonHeight + Math.max(0, lines.length - 1) * lineHeight, lines }
  })
  const buttonAreaHeight = stacked ? measuredButtons.reduce((n, b) => n + b.h, 0) + Math.max(0, buttons.length - 1) * style.buttonSpacing : Math.max(0, ...measuredButtons.map(b => b.h))
  const bodyGap = inputHeight ? style.contentSpacing : style.sectionSpacing
  const inputArea = inputHeight ? inputHeight + style.sectionSpacing : 0
  const footerHeight = inputArea + buttonAreaHeight
  const maxH = Math.max(1, context.viewport.height - margin * 2)
  const titleHeight = Math.min(style.titleHeight, maxH / 3)
  const desiredH = titleHeight + padding * 2 + bodyGap + textHeight + footerHeight
  const panelH = Math.min(Math.max(minHeight, desiredH), maxH)
  const panelX = offset.x + (context.viewport.width - panelW) / 2, panelY = offset.y + (context.viewport.height - panelH) / 2
  const contentY = panelY + titleHeight + padding
  // In very short viewports all controls join the scrollable body, so none become unreachable.
  const scrollAll = panelH - titleHeight - padding * 2 - bodyGap - footerHeight < Math.min(textHeight, lineHeight * 2)
  const bodyH = Math.max(1, panelH - titleHeight - padding * 2 - (scrollAll ? 0 : bodyGap + footerHeight))
  const contentSize = textHeight + (scrollAll ? bodyGap + footerHeight : 0)
  const maxScroll = Math.max(0, contentSize - bodyH)
  const scrollOffset = Math.max(0, Math.min(scroll, maxScroll))
  const footerY = scrollAll ? contentY + textHeight + bodyGap - scrollOffset : panelY + panelH - padding - footerHeight
  const controlW = innerW
  const inputRect = { x: panelX + padding, y: footerY, w: controlW, h: inputHeight }
  const buttonY = footerY + inputArea
  let bx = panelX + padding + (stacked ? 0 : Math.max(0, controlW - widths.reduce((a, b) => a + b, 0) - Math.max(0, buttons.length - 1) * style.buttonSpacing)), by = buttonY
  const entries = measuredButtons.map(b => {
    const w = scrollAll && stacked ? controlW : b.w
    const lines = w === b.w ? b.lines : wrapDialogLines(b.label, Math.max(1, w - padding * 2), text => TextMeasurer.measureWidth(text, style.fontSize, style.fontFamily))
    const entry = { ...b, lines, x: bx, y: by, w }
    if (stacked) by += b.h + style.buttonSpacing
    else bx += b.w + style.buttonSpacing
    return entry
  })
  return { panelX, panelY, panelW, panelH, titleHeight, padding, contentY, lineHeight, contentLines, textW, body: { x: panelX + padding, y: contentY, w: innerW, h: bodyH }, inputRect, buttonY, buttons: entries, maxScroll, scrollOffset, contentSize, scrollAll, stacked }
}
export type DialogLayout = ReturnType<typeof resolveDialogLayout>

export class DialogScroller {
  offset = 0
  private readonly bar = new ScrollbarAxisController('vertical')
  reset(): void { this.offset = 0; this.bar.reset() }
  private geometry(layout: DialogLayout, context: PopupContext) {
    const style = deriveScrollbarStyle(context.theme)
    return resolveScrollbarGeometryForState({ axis: 'vertical', trackRect: { x: layout.panelX + layout.panelW - style.gutterSize - 2, y: layout.body.y, width: style.gutterSize, height: layout.body.h }, viewportSize: layout.body.h, contentSize: layout.contentSize, scrollOffset: layout.scrollOffset, style, state: this.bar.state })
  }
  set(value: number, layout: DialogLayout): void {
    this.offset = Math.max(0, Math.min(value, layout.maxScroll)); PopupManager.instance.requestPaint()
  }
  wheel(event: WheelPointerEvent, layout: DialogLayout): void {
    if (inDialogRect(event.position, layout.body)) this.set(layout.scrollOffset + event.deltaY, layout)
  }
  key(event: KeyboardEvent, layout: DialogLayout): boolean {
    if (!['PageDown', 'PageUp'].includes(event.key)) return false
    event.preventDefault(); this.set(layout.scrollOffset + layout.body.h * (event.key === 'PageDown' ? 1 : -1), layout); return true
  }
  pointer(phase: 'down' | 'move' | 'up', event: PointerEvent, layout: DialogLayout, context: PopupContext): boolean {
    const g = this.geometry(layout, context), key = pointerKey(event)
    const result = phase === 'down' ? this.bar.beginPointer(event.position, g, key) : phase === 'up' ? this.bar.endPointer(event.position, g, key) : this.bar.updatePointer(event.position, g, key)
    if (phase === 'move' && this.bar.updateHover(event.position, g)) PopupManager.instance.requestPaint()
    if (result.scrollOffset !== undefined) this.set(result.scrollOffset, layout)
    if (result.stateChanged) PopupManager.instance.requestPaint()
    return result.handled
  }
  cancel(): void { this.bar.reset(); PopupManager.instance.requestPaint() }
  paint(dl: DrawList, layout: DialogLayout, context: PopupContext): void {
    if (!layout.maxScroll) return
    const style = deriveScrollbarStyle(context.theme)
    paintVBar({ dl, style, trackX: layout.panelX + layout.panelW - style.gutterSize - 2, trackY: layout.body.y, trackW: style.gutterSize, trackH: layout.body.h, viewSize: layout.body.h, contentSize: layout.contentSize, scrollOffset: layout.scrollOffset, state: this.bar.state })
  }
  ensure(rect: DialogRect, layout: DialogLayout): void {
    if (!layout.scrollAll) return
    if (rect.y < layout.body.y) this.set(layout.scrollOffset + rect.y - layout.body.y, layout)
    else if (rect.y + rect.h > layout.body.y + layout.body.h) this.set(layout.scrollOffset + rect.y + rect.h - layout.body.y - layout.body.h, layout)
  }
}

export function paintDialog(context: PaintContext, popup: PopupContext, layout: DialogLayout, title: string, alpha: number, scroller: DialogScroller, hovered: string, pressed: string, focused: string, intent: DialogIntent | null = 'info', paintInput?: () => void): void {
  const s = deriveModalStyle(context.theme), dl = new DrawList(context), {panelX:x,panelY:y,panelW:w,panelH:h}=layout
  // Apply opacity once to the entire dialog, including the Prompt field.
  context.ctx.save()
  try {
    context.ctx.globalAlpha *= alpha
    dl.fillRect(popup.viewport.x ?? 0, popup.viewport.y ?? 0, popup.viewport.width, popup.viewport.height, s.overlayBg)
    dl.outerShadow(x,y,w,h,s.shadowBlur,s.shadowColor,s.borderRadius,s.shadowOffsetX,s.shadowOffsetY)
    dl.fillRect(x,y,w,h,s.panelBg,s.borderRadius)
    dl.strokeRect(x,y,w,h,s.panelBorder,1,s.borderRadius)
    dl.pushRoundedClip(x,y,w,h,s.borderRadius)
    dl.fillRect(x,y,w,layout.titleHeight,s.titleBg)
    const icons: Record<DialogIntent, IconName> = { info: 'info-filled', warning: 'warning-filled', success: 'check-circle-filled', error: 'error-circle-filled' }
    const iconWidth = intent ? s.titleIconSize + Math.min(s.titleIconGap, layout.padding) : 0
    if (intent) {
      paintIconGlyph(context, { name: icons[intent], x: x + layout.padding, y: y + (layout.titleHeight - s.titleIconSize) / 2, size: s.titleIconSize, color: s.titleIconColors[intent] })
    }
    paintSingleLineText(dl,{text:title,x:x+layout.padding+iconWidth,y:y+layout.titleHeight/2,maxWidth:Math.max(0,w-layout.padding*2-iconWidth),color:s.titleText,fontSize:s.titleFontSize,fontFamily:s.fontFamily,fontWeight:s.titleFontWeight})
    dl.popClip()
    dl.pushClip(layout.body.x,layout.body.y,layout.body.w,layout.body.h)
    const first = Math.max(0,Math.floor(layout.scrollOffset/layout.lineHeight))
    const last = Math.min(layout.contentLines.length, Math.ceil((layout.scrollOffset+layout.body.h)/layout.lineHeight))
    for(let i=first;i<last;i++) dl.fillText(layout.contentLines[i]!,layout.body.x,layout.contentY+i*layout.lineHeight+layout.lineHeight/2-layout.scrollOffset,s.text,s.fontSize,s.fontFamily)
    dl.popClip()
    if(layout.scrollAll) dl.pushClip(layout.body.x,layout.body.y,layout.body.w,layout.body.h)
    paintInput?.()
    for(const b of layout.buttons){
      const state=b.key===pressed?'pressed':b.key===hovered?'hovered':'normal'
      const bg=b.danger?s.dangerButtonBg:b.primary?s.primaryButtonBg:s.secondaryButtonBg
      const fg=b.danger?s.dangerButtonText:b.primary?s.primaryButtonText:s.secondaryButtonText
      dl.fillRect(b.x,b.y,b.w,b.h,resolveBgColor(bg,state),s.buttonRadius)
      if(!b.primary&&!b.danger)dl.strokeRect(b.x,b.y,b.w,b.h,resolveBgColor(s.secondaryButtonBorder,state),1,s.buttonRadius)
      if (b.key === focused) {
        const focusColor = b.primary || b.danger ? resolveTextColor(fg, state) : context.theme.focusBorder
        dl.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, focusColor, 2, s.buttonRadius)
      }
      b.lines.forEach((line,i)=>dl.fillText(line,b.x+b.w/2,b.y+(b.h-b.lines.length*layout.lineHeight)/2+(i+.5)*layout.lineHeight,resolveTextColor(fg,state),s.fontSize,s.fontFamily,'center','middle'))
    }
    if(layout.scrollAll)dl.popClip()
    scroller.paint(dl,layout,popup)
  } finally { context.ctx.restore() }
}

export function dialogButtonAt(point: Offset, layout: DialogLayout): string {
  if(layout.scrollAll&&!inDialogRect(point,layout.body))return ''
  return layout.buttons.find(button=>inDialogRect(point,button))?.key??''
}
