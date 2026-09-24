// InputComposer: 统一输入通道
// 管理全局共享 textarea 的生命周期、IME 状态、位置更新
// TextField / Dropdown / NumberInput 都通过此类操作，消除重复实现

import { DisposableBag } from './disposable'
import { FocusManager } from './focus_manager'

export interface InputSession {
  // 普通输入（非 IME）
  onInput?: (value: string) => void
  // IME 开始组字（可在此切换到单行模式）
  onCompositionStart?: () => void
  // IME 组字预览
  onCompositionUpdate?: (text: string) => void
  // IME 确认
  onCompositionEnd?: (value: string, data?: string) => void
  // 键盘事件（Enter/Escape/Arrow 等）
  onKeyDown?: (e: KeyboardEvent) => void
  // 剪贴板事件
  onCopy?: (e: ClipboardEvent) => void
  onCut?: (e: ClipboardEvent) => void
  onPaste?: (e: ClipboardEvent) => void
  onContextMenu?: (e: MouseEvent) => void
}

export interface InputComposerBeginOptions {
  focus?: boolean
}

export type InputSessionToken = symbol

const TEXTAREA_RESET_VALUE_LENGTH = 1_000_000

export class InputComposer {
  private static _instance: InputComposer | null = null

  static get instance(): InputComposer {
    if (!InputComposer._instance) InputComposer._instance = new InputComposer()
    return InputComposer._instance
  }

  static disposeInstance(): void {
    InputComposer._instance?.dispose()
  }

  private _ta: HTMLTextAreaElement
  private _session: InputSession | null = null
  private _sessionToken: InputSessionToken | null = null
  private _composing = false
  private _disposables = new DisposableBag()

  // 事件处理器引用
  private _onInput: (e: Event) => void
  private _onKeyDown: (e: KeyboardEvent) => void
  private _onCompositionStart: () => void
  private _onCompositionUpdate: (e: CompositionEvent) => void
  private _onCompositionEnd: (e: CompositionEvent) => void
  private _onCopy: (e: ClipboardEvent) => void
  private _onCut: (e: ClipboardEvent) => void
  private _onPaste: (e: ClipboardEvent) => void
  private _onContextMenu: (e: MouseEvent) => void

  private constructor() {
    const ta = this._createTextarea()
    document.body.appendChild(ta)
    this._ta = ta

    this._onInput = () => {
      if (!this._session || this._composing) return
      this._session.onInput?.(this._ta.value)
    }

    this._onKeyDown = (e: KeyboardEvent) => {
      if (!this._session) return
      if (e.key === 'Tab' && FocusManager.instance.handleKeyDownEvent(e)) return
      this._session.onKeyDown?.(e)
    }

    this._onCompositionStart = () => {
      if (this._composing) return
      this._composing = true
      this._session?.onCompositionStart?.()
    }

    this._onCompositionUpdate = (e: CompositionEvent) => {
      this._composing = true
      this._session?.onCompositionUpdate?.(e.data ?? '')
    }

    this._onCompositionEnd = (e: CompositionEvent) => {
      if (!this._composing) return
      this._composing = false
      this._session?.onCompositionEnd?.(this._ta.value, e.data || undefined)
    }

    this._onCopy = (e: ClipboardEvent) => {
      this._session?.onCopy?.(e)
    }

    this._onCut = (e: ClipboardEvent) => {
      this._session?.onCut?.(e)
    }

    this._onPaste = (e: ClipboardEvent) => {
      this._session?.onPaste?.(e)
    }

    this._onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      this._session?.onContextMenu?.(e)
    }

    this._bindTextarea(ta)
    this._disposables.add(() => {
      this._unbindTextarea(this._ta)
      this._ta.remove()
    })
  }

  get composing(): boolean { return this._composing }
  get value(): string { return this._ta.value }
  get selectionStart(): number { return this._ta.selectionStart ?? this._ta.value.length }
  get selectionEnd(): number { return this._ta.selectionEnd ?? this._ta.value.length }
  get hasSession(): boolean { return this._session !== null }

  setSelection(start: number, end: number): void {
    this._ta.setSelectionRange(start, end)
  }

  // 开始一个输入会话
  begin(session: InputSession, initialValue = '', options?: InputComposerBeginOptions): InputSessionToken {
    const token = Symbol('InputSession')
    this._session = session
    this._sessionToken = token
    this._composing = false
    this._resetTextareaIfNeeded(initialValue, { preserveFocus: options?.focus !== false })
    this._ta.readOnly = false
    this._ta.value = initialValue
    this._ta.setSelectionRange(initialValue.length, initialValue.length)
    if (options?.focus !== false) this._focusTextarea()
    return token
  }

  // 结束当前会话（不调 blur，保持 textarea 持有浏览器焦点）
  end(token?: InputSessionToken): void {
    if (token !== undefined && token !== this._sessionToken) return
    this._session = null
    this._sessionToken = null
    this._composing = false
  }

  // 更新 textarea 的屏幕位置（让 IME 候选框跟随光标）
  updatePosition(screenX: number, screenY: number): void {
    this._ta.style.left = `${screenX}px`
    this._ta.style.top = `${screenY}px`
  }

  // 切换到单行模式：只存当前行，供 IME 在小文本上工作
  setLineMode(lineText: string, col: number): void {
    this._resetTextareaIfNeeded(lineText)
    this._ta.value = lineText
    this._ta.setSelectionRange(col, col)
  }

  // 同步外部值到 textarea（如 reset）
  setValue(value: string): void {
    this._resetTextareaIfNeeded(value)
    this._ta.value = value
    this._ta.setSelectionRange(value.length, value.length)
  }

  setReadOnly(readOnly: boolean): void {
    this._ta.readOnly = readOnly
    if (readOnly) this._composing = false
  }

  // 主动 focus（页面失焦后重新点击时调用）
  focus(): void {
    this._focusTextarea()
  }

  dispose(): void {
    this.end()
    this._disposables.dispose()
    InputComposer._instance = null
  }

  private _resetTextareaIfNeeded(nextValue: string, options?: { preserveFocus?: boolean }): void {
    if (this._ta.value.length < TEXTAREA_RESET_VALUE_LENGTH) return
    if (nextValue.length >= this._ta.value.length) return
    this._replaceTextarea(options?.preserveFocus ?? true)
  }

  private _replaceTextarea(preserveFocus: boolean): void {
    const old = this._ta
    const shouldFocus = preserveFocus && document.activeElement === old
    const next = this._createTextarea()
    next.style.left = old.style.left
    next.style.top = old.style.top
    next.readOnly = old.readOnly
    this._unbindTextarea(old)
    old.replaceWith(next)
    this._ta = next
    this._bindTextarea(next)
    if (shouldFocus) this._focusTextarea(next)
  }

  private _createTextarea(): HTMLTextAreaElement {
    const ta = document.createElement('textarea')
    ta.id = '__ds_ui_input__'
    ta.style.cssText = [
      'position:fixed',
      'top:0', 'left:0',
      'width:1px', 'height:1px',
      'opacity:0',
      'pointer-events:none',
      'z-index:9999',
      'resize:none',
      'border:none',
      'outline:none',
      'padding:0',
      'overflow:hidden',
      'white-space:nowrap',
    ].join(';')
    ta.setAttribute('autocomplete', 'off')
    ta.setAttribute('autocorrect', 'off')
    ta.setAttribute('autocapitalize', 'off')
    ta.setAttribute('spellcheck', 'false')
    return ta
  }

  private _focusTextarea(textarea: HTMLTextAreaElement = this._ta): void {
    textarea.focus({ preventScroll: true })
  }

  private _bindTextarea(ta: HTMLTextAreaElement): void {
    ta.addEventListener('input', this._onInput)
    ta.addEventListener('keydown', this._onKeyDown)
    ta.addEventListener('compositionstart', this._onCompositionStart)
    ta.addEventListener('compositionupdate', this._onCompositionUpdate)
    ta.addEventListener('compositionend', this._onCompositionEnd)
    ta.addEventListener('copy', this._onCopy)
    ta.addEventListener('cut', this._onCut)
    ta.addEventListener('paste', this._onPaste)
    ta.addEventListener('contextmenu', this._onContextMenu)
  }

  private _unbindTextarea(ta: HTMLTextAreaElement): void {
    ta.removeEventListener('input', this._onInput)
    ta.removeEventListener('keydown', this._onKeyDown)
    ta.removeEventListener('compositionstart', this._onCompositionStart)
    ta.removeEventListener('compositionupdate', this._onCompositionUpdate)
    ta.removeEventListener('compositionend', this._onCompositionEnd)
    ta.removeEventListener('copy', this._onCopy)
    ta.removeEventListener('cut', this._onCut)
    ta.removeEventListener('paste', this._onPaste)
    ta.removeEventListener('contextmenu', this._onContextMenu)
  }
}
