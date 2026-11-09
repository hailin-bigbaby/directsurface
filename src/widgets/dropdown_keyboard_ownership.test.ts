import { it, expect, vi, afterEach } from 'vitest'
import { DropdownPopup } from './dropdown'
import { PopupManager } from '../core/popup_manager'
import { GET_POPUP_ANCHOR_RECT } from '../core/popup_anchor'
import { ImGuiDarkTheme } from '../theme/default_theme'
function setPopupTestContext() { PopupManager.instance.setContextProvider(() => ({theme:ImGuiDarkTheme,viewport:{width:320,height:240,dpr:1}})) }
function staticAnchor(x:number,y:number,width:number,height:number) {return {[GET_POPUP_ANCHOR_RECT]:()=>({x,y,width,height})}}
afterEach(()=>{PopupManager.disposeInstance();vi.restoreAllMocks()})

for (const [key, expected] of [['ArrowDown', 'b'], ['Home', 'a'], ['End', 'c'], ['b', 'b']]) {
  it(`keyboard ${key} takes over an existing mouse hover`, () => {
    setPopupTestContext()
    const popup = new DropdownPopup()
    const onSelect = vi.fn()
    popup.open({ options: ['a', 'b', 'c'].map(value => ({ value, label: value })), selectedValue: 'a', anchor: staticAnchor(0, 0, 160, 24), searchable: false, maxVisibleItems: 8, onSelect, onClose: vi.fn() })
    ;(popup as any)._hoveredValue = 'c'
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onSelect).toHaveBeenCalledWith(expected, expect.objectContaining({ value: expected }))
    expect(popup.visible).toBe(false)
    popup.dispose()
  })
}
