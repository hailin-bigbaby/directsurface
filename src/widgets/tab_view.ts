import { RenderBox, resolveChildLayout } from '../layout/render_box'
import type { PaintContext } from '../rendering/paint_context'
import { constrainSize, type BoxConstraints, type LayoutContext, type Offset, type RenderObject } from '../core/render_object'
import { RenderTabs } from './tabs'

export interface RenderTabItemOptions {
  key: string
  title: string
  closable?: boolean
  content?: RenderBox
}

export class RenderTabItem extends RenderBox {
  static override debugTypeName = 'RenderTabItem'
  readonly key: string
  title: string
  closable: boolean

  private _content?: RenderBox

  constructor(options: RenderTabItemOptions) {
    super()
    this.key = options.key
    this.title = options.title
    this.closable = options.closable ?? false
    this._content = options.content
    if (this._content) this._content.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get content(): RenderBox | undefined {
    return this._content
  }

  setContent(content?: RenderBox): void {
    if (this._content === content) return

    const previous = this._content
    if (previous) {
      previous.parent = undefined
      if (previous.owner) previous.detach()
    }

    this._content = content
    if (content) {
      content.parent = this
      if (this.owner && content.owner !== this.owner) content.attach(this.owner)
    }

    this.markNeedsLayout()
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      if (this._content) visitor(this._content)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    if (this._content) visitor(this._content)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    if (!this._content) {
      this.size = constrainSize(constraints, { width: 0, height: 0 })
      return
    }

    const contentLayout = resolveChildLayout(this._content, constraints, 'stretch', 'stretch')
    this._content.layout(contentLayout.constraints, true, context)
    this.size = constrainSize(constraints, this._content.outerSize)
    this._content.positionInSlot(
      { x: 0, y: 0, width: this.size.width, height: this.size.height },
      contentLayout.horizontalAlignment,
      contentLayout.verticalAlignment,
    )
  }
}

export interface RenderTabControlOptions {
  activeKey: string
  onTabChange?: (key: string) => void
  onTabClose?: (key: string) => void
}

export class RenderTabControl extends RenderBox {
  static override debugTypeName = 'RenderTabControl'
  readonly tabs: RenderTabs

  private readonly _pages: RenderTabItem[] = []
  private _activeKey: string
  private _activePage?: RenderTabItem
  private readonly _onTabChange?: (key: string) => void
  private readonly _onTabClose?: (key: string) => void

  constructor(options: RenderTabControlOptions) {
    super()
    this._activeKey = options.activeKey
    this._onTabChange = options.onTabChange
    this._onTabClose = options.onTabClose

    this.tabs = new RenderTabs({
      tabs: [],
      activeKey: options.activeKey,
      onTabChange: (key) => {
        this.activeKey = key
        this._onTabChange?.(key)
      },
      onTabClose: (key) => this.closePage(key),
    })
    this.tabs.parent = this
  }

  protected override get supportsAdorners(): boolean {
    return true
  }

  get pages(): readonly RenderTabItem[] {
    return this._pages
  }

  addChild(page: RenderTabItem): void {
    if (this._pages.some(existing => existing.key === page.key)) {
      throw new Error(`Duplicate tab page key "${page.key}".`)
    }

    page.parent = this
    this._pages.push(page)
    this._syncTabs()
    this._syncActivePage()
    this.markNeedsLayout()
  }

  addPage(page: RenderTabItem): void {
    this.addChild(page)
  }

  hasPage(key: string): boolean {
    return this._pages.some(page => page.key === key)
  }

  getPage(key: string): RenderTabItem | undefined {
    return this._pages.find(page => page.key === key)
  }

  removeChild(page: RenderTabItem): void {
    const index = this._pages.indexOf(page)
    if (index < 0) return

    const wasActive = this._activePage === page
    const nextActiveKey = wasActive ? this._fallbackActiveKey(index) : this._activeKey
    if (page.owner) page.detach()
    page.parent = undefined

    this._pages.splice(index, 1)
    if (wasActive) {
      this._activePage = undefined
      this._activeKey = nextActiveKey
      this.tabs.activeKey = nextActiveKey
    }

    this._syncTabs()
    this._syncActivePage()
    this.markNeedsLayout()
  }

  removePage(page: RenderTabItem): void {
    this.removeChild(page)
  }

  closePage(key: string): boolean {
    const page = this.getPage(key)
    if (!page) return false

    const wasActive = this._activeKey === key
    const previousActiveKey = this._activeKey
    this.removeChild(page)
    if (wasActive && this._activeKey && this._activeKey !== previousActiveKey) {
      this._onTabChange?.(this._activeKey)
    }
    this._onTabClose?.(key)
    return true
  }

  clearChildren(): void {
    for (const page of this._pages) {
      if (page.owner) page.detach()
      page.parent = undefined
    }

    this._pages.length = 0
    this._activePage = undefined
    this._activeKey = ''
    this.tabs.activeKey = ''
    this._syncTabs()
    this.markNeedsLayout()
  }

  get activeKey(): string {
    return this._activeKey
  }

  set activeKey(value: string) {
    if (this._activeKey === value) return
    this._activeKey = value
    this.tabs.activeKey = value
    this._syncActivePage()
  }

  get activePage(): RenderTabItem | undefined {
    return this._activePage
  }

  get activeContent(): RenderBox | undefined {
    return this._activePage?.content
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this.tabs)
      if (this._activePage) visitor(this._activePage)
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this.tabs)
    if (this._activePage) visitor(this._activePage)
  }

  override isFocusChildActive(child: RenderObject): boolean {
    if (child === this.tabs) return child.visible
    if (this._pages.includes(child as RenderTabItem)) return child === this._activePage && child.visible
    return super.isFocusChildActive(child)
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    const width = constraints.maxWidth === Infinity ? 400 : constraints.maxWidth
    const tabsLayout = resolveChildLayout(
      this.tabs,
      { minWidth: width, maxWidth: width, minHeight: 0, maxHeight: constraints.maxHeight },
      'stretch',
      'start',
    )
    this.tabs.layout(tabsLayout.constraints, true, context)
    const tabsHeight = this.tabs.outerSize.height
    this.tabs.positionInSlot(
      { x: 0, y: 0, width, height: tabsHeight },
      tabsLayout.horizontalAlignment,
      tabsLayout.verticalAlignment,
    )

    let height = tabsHeight
    if (this._activePage) {
      const remainingHeight = constraints.maxHeight === Infinity
        ? Infinity
        : Math.max(0, constraints.maxHeight - tabsHeight)
      const pageLayout = resolveChildLayout(
        this._activePage,
        {
          minWidth: width,
          maxWidth: width,
          minHeight: constraints.maxHeight === Infinity ? 0 : remainingHeight,
          maxHeight: remainingHeight,
        },
        'stretch',
        'stretch',
      )
      this._activePage.layout(pageLayout.constraints, true, context)
      this._activePage.positionInSlot(
        { x: 0, y: tabsHeight, width, height: remainingHeight },
        pageLayout.horizontalAlignment,
        pageLayout.verticalAlignment,
      )
      height = constraints.maxHeight === Infinity
        ? tabsHeight + this._activePage.outerSize.height
        : constraints.maxHeight
    } else if (constraints.maxHeight !== Infinity) {
      height = constraints.maxHeight
    }

    this.size = { width, height }
  }

  performPaint(context: PaintContext, offset: Offset): void {
    super.performPaint(context, offset)
  }

  dispose(): void {
    for (const page of this._pages) {
      if (page !== this._activePage) page.dispose()
    }
    this._pages.length = 0
    super.dispose()
    this._activePage = undefined
  }

  private _syncTabs(): void {
    this.tabs.tabs = this._pages.map(page => ({
      key: page.key,
      label: page.title,
      closable: page.closable,
    }))
  }

  private _syncActivePage(): void {
    const nextPage = this._pages.find(page => page.key === this._activeKey)
    if (this._activePage === nextPage) return

    const previous = this._activePage
    this._activePage = nextPage

    if (previous?.owner) previous.detach()
    if (nextPage) {
      if (this.owner && nextPage.owner !== this.owner) nextPage.attach(this.owner)
    }

    this.markNeedsLayout()
  }

  private _fallbackActiveKey(removedIndex: number): string {
    const nextPage = this._pages[removedIndex + 1] ?? this._pages[removedIndex - 1]
    return nextPage?.key ?? ''
  }
}
