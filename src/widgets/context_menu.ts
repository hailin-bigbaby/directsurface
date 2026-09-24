// ContextMenu: 右键菜单
// 绘制到 overlay 层，支持嵌套 submenu，并复用 PopupManager 的 popup hierarchy

import type { PaintContext } from '../rendering/paint_context'
import type { Offset } from '../core/render_object'
import { deriveContextMenuStyle } from '../theme/component_styles'
import { PopupManager, popupViewportRect, type PopupContext } from '../core/popup_manager'
import {
  type ContextMenuEntry,
  type ContextMenuItemDebugTarget,
  type ContextMenuItem,
  type ContextMenuSeparator,
  MenuPopup,
} from './menu_popup'

export type { ContextMenuEntry, ContextMenuItem, ContextMenuSeparator }
export type { ContextMenuItemDebugTarget }

export interface ContextMenuManagerDebugState {
  pos: Offset
  totalHeight: number
  menuWidth: number
  itemHeight: number
  separatorHeight: number
  hoveredKey: string
  childParentKey: string
  visible: boolean
  visibleItems: readonly ContextMenuItemDebugTarget[]
}

export class ContextMenuManager {
  private _rootPopup: MenuPopup | null = null

  get itemHeight(): number {
    return deriveContextMenuStyle(PopupManager.instance.context.theme).itemHeight
  }

  get separatorHeight(): number {
    return deriveContextMenuStyle(PopupManager.instance.context.theme).separatorHeight
  }

  get menuWidth(): number {
    return deriveContextMenuStyle(PopupManager.instance.context.theme).menuWidth
  }

  get visible(): boolean {
    return this._rootPopup?.visible ?? false
  }

  debugState(popupContext: PopupContext = PopupManager.instance.context): ContextMenuManagerDebugState {
    const state = this._rootPopup?.debugState(popupContext) ?? {
      pos: { x: 0, y: 0 },
      totalHeight: 0,
      menuWidth: this.menuWidth,
      itemHeight: this.itemHeight,
      separatorHeight: this.separatorHeight,
      hoveredKey: '',
      childParentKey: '',
    }
    return {
      ...state,
      visible: this.visible,
      visibleItems: this._rootPopup?.debugPaintedItems(popupContext) ?? [],
    }
  }

  show(items: ContextMenuEntry[], pos: Offset, onSelect?: (key: string) => void): void {
    this.hide()
    const root = new MenuPopup({
      items,
      onSelect: key => {
        onSelect?.(key)
        this.hide()
      },
      position: () => ({ ...pos }),
      bounds: popupContext => popupViewportRect(popupContext),
      onClose: () => {
        if (this._rootPopup === root) this._rootPopup = null
      },
    })
    this._rootPopup = root
    root.open()
  }

  hide(): void {
    this._rootPopup?.dismiss()
  }

  close(): void {
    this.hide()
  }

  paint(context: PaintContext, _offset?: Offset): void {
    this._rootPopup?.paint(context)
  }

  dispose(): void {
    this.hide()
  }
}
