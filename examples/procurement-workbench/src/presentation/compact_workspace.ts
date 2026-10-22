import type { DockWorkbenchManager } from 'directsurface'

export type WorkspacePreference = 'auto' | 'focus' | 'expanded'

/** This demo's viewport policy. Layout and overlays remain owned by DockWorkbench. */
export class CompactWorkspace {
  preference: WorkspacePreference = 'auto'
  compact = false
  private width = Infinity
  private applying = false
  private ownedGroups = new Map<string, 'left' | 'right' | 'bottom'>()

  constructor(private readonly manager: DockWorkbenchManager, private readonly commitEditing: () => boolean, private readonly focusTool: (id: string) => void) {}

  setWidth(width: number): void { this.width = width; this.reconcile() }
  setPreference(preference: WorkspacePreference): boolean {
    const previous = this.preference
    this.preference = preference
    if (!this.reconcile()) { this.preference = previous; return false }
    return true
  }
  reconcile(): boolean {
    if (this.applying) return true
    // Hysteresis prevents repeatedly moving panels around the breakpoint.
    const next = this.preference === 'focus' || (this.preference === 'auto' && this.width < (this.compact ? 1320 : 1240))
    if (next === this.compact) return true
    if (this.manager.isDragging) return false
    this.applying = true
    try {
      if (!this.commitEditing()) return false
      if (next) {
        for (const region of ['left', 'right', 'bottom'] as const) {
          const node = this.manager.regions[region]
          // Preserve user-created split/floating layouts rather than flattening them on resize.
          if (node?.type === 'tabs' && node.kind === 'tool' && this.manager.autoHideGroup(node)) this.ownedGroups.set(node.id, region)
        }
      } else {
        for (const [id, region] of this.ownedGroups) {
          const group = this.manager.getAutoHideGroup(id)
          if (group?.region === region) this.manager.dockAutoHideGroup(id)
        }
        this.ownedGroups.clear()
      }
      this.compact = next
      return true
    } finally { this.applying = false }
  }
  openTool(id: string): void {
    if (!this.commitEditing()) return
    if (this.manager.autoHideItems.some(item => item.itemId === id)) this.manager.showAutoHideItem(id)
    else this.manager.activateItem(id)
    this.focusTool(id)
  }
  dismissTool(id: string): void { this.manager.hideAutoHideItem(id) }
}
