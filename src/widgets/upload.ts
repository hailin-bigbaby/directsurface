import { RenderObject, constrainSize, type BoxConstraints, type LayoutContext, type Offset } from '../core/render_object'
import { RenderBox, type RenderBoxOptions } from '../layout/render_box'
import { type FilePickerBridge, browserFilePicker } from '../runtime/file_picker'
import { DrawList } from '../rendering/draw_list'
import { TextMeasurer } from '../core/text_measurer'
import { ellipsizeText } from '../core/text_overflow'
import type { PaintContext } from '../rendering/paint_context'
import { deriveTextInputStyle } from '../theme/component_styles'
import { RenderButton } from './button'

export type UploadFileStatus = 'ready' | 'uploading' | 'success' | 'error' | 'cancelled'

export interface UploadFileItem<TResult = unknown> {
  readonly id: string
  readonly file: File
  readonly status: UploadFileStatus
  readonly progress: number
  readonly error?: string
  readonly result?: TResult
}

interface MutableUploadFileItem<TResult = unknown> {
  id: string
  file: File
  status: UploadFileStatus
  progress: number
  error?: string
  result?: TResult
}

export interface UploadProgressContext {
  readonly signal: AbortSignal
  reportProgress(progress: number): void
}

export type UploadHandler<TResult = unknown> =
  (file: File, context: UploadProgressContext) => Promise<TResult>

export interface UploadFileRejection {
  readonly file: File
  readonly reason: string
}

export interface RenderUploadOptions<TResult = unknown> extends RenderBoxOptions {
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxFileSize?: number
  autoUpload?: boolean
  disabled?: boolean
  selectLabel?: string
  upload?: UploadHandler<TResult>
  filePicker?: FilePickerBridge
  validateFile?: (file: File) => string | null | undefined
  onChange?: (items: readonly UploadFileItem<TResult>[]) => void
  onReject?: (rejections: readonly UploadFileRejection[]) => void
  onError?: (error: unknown) => void
}

interface UploadRowControls {
  action: RenderButton
  remove: RenderButton
}

let nextUploadItemId = 1

export class RenderUpload<TResult = unknown> extends RenderBox {
  static override debugTypeName = 'RenderUpload'

  accept: string
  multiple: boolean
  maxFiles: number
  maxFileSize?: number
  autoUpload: boolean
  upload?: UploadHandler<TResult>
  validateFile?: RenderUploadOptions<TResult>['validateFile']
  onChange?: RenderUploadOptions<TResult>['onChange']
  onReject?: RenderUploadOptions<TResult>['onReject']
  onError?: RenderUploadOptions<TResult>['onError']

  private readonly _filePicker: FilePickerBridge
  private readonly _selectButton: RenderButton
  private readonly _items: MutableUploadFileItem<TResult>[] = []
  private readonly _rowControls = new Map<string, UploadRowControls>()
  private readonly _abortControllers = new Map<string, AbortController>()
  private readonly _attempts = new Map<string, number>()
  private _disabled: boolean
  private _disposed = false
  private _rowHeight = 34
  private _rowGap = 4
  private _sectionGap = 6

  constructor(options: RenderUploadOptions<TResult> = {}) {
    super(options)
    this.accept = options.accept ?? ''
    this.multiple = options.multiple ?? false
    this.maxFiles = normalizePositiveInteger(options.maxFiles, this.multiple ? Number.POSITIVE_INFINITY : 1)
    this.maxFileSize = normalizeOptionalPositiveNumber(options.maxFileSize)
    this.autoUpload = options.autoUpload ?? true
    this.upload = options.upload
    this.validateFile = options.validateFile
    this.onChange = options.onChange
    this.onReject = options.onReject
    this.onError = options.onError
    this._filePicker = options.filePicker ?? browserFilePicker
    this._disabled = options.disabled ?? false
    this._selectButton = new RenderButton({
      label: options.selectLabel ?? '选择文件',
      disabled: this._disabled,
      onClick: () => { this._selectFilesFromButton() },
    })
    this._selectButton.parent = this
  }

  get items(): readonly UploadFileItem<TResult>[] {
    return this._snapshotItems(this._items)
  }

  get disabled(): boolean {
    return this._disabled
  }

  set disabled(value: boolean) {
    if (this._disabled === value) return
    this._disabled = value
    this._selectButton.disabled = value
    for (const controls of this._rowControls.values()) {
      controls.action.disabled = value
      controls.remove.disabled = value
    }
    this.markNeedsPaint()
  }

  async selectFiles(): Promise<readonly UploadFileItem<TResult>[]> {
    if (this.disabled || this._disposed) return []
    const files = await this._filePicker.pickFiles({
      accept: this.accept || undefined,
      multiple: this.multiple,
    })
    return this.addFiles(files)
  }

  addFiles(files: readonly File[]): readonly UploadFileItem<TResult>[] {
    if (this.disabled || this._disposed || files.length === 0) return []
    const validateFile = this.validateFile
    const preflight: Array<{ file: File; reason: string | null }> = []

    for (const file of files) {
      const reason = this._validateFile(file, validateFile)
      if (this._disposed || this.disabled) return []
      preflight.push({ file, reason })
    }

    if (this._disposed || this.disabled) return []
    for (const entry of preflight) {
      if (entry.reason) continue
      entry.reason = this._validateBuiltInFile(entry.file)
    }

    const maxFiles = normalizePositiveInteger(
      this.maxFiles,
      this.multiple ? Number.POSITIVE_INFINITY : 1,
    )
    const remaining = Math.max(0, maxFiles - this._items.length)
    const acceptedFiles: File[] = []
    const rejected: UploadFileRejection[] = []
    for (const entry of preflight) {
      if (entry.reason) {
        rejected.push({ file: entry.file, reason: entry.reason })
      } else if (acceptedFiles.length < remaining) {
        acceptedFiles.push(entry.file)
      } else {
        rejected.push({
          file: entry.file,
          reason: `最多只能选择 ${maxFiles} 个文件`,
        })
      }
    }

    const accepted: MutableUploadFileItem<TResult>[] = []
    for (const file of acceptedFiles) {
      const item: MutableUploadFileItem<TResult> = {
        id: `upload-${nextUploadItemId++}`,
        file,
        status: 'ready',
        progress: 0,
      }
      this._items.push(item)
      this._createRowControls(item)
      accepted.push(item)
    }

    if (rejected.length > 0) this.onReject?.(rejected)
    if (accepted.length > 0) {
      this._notifyChange(true)
      if (this.autoUpload && this.upload) {
        for (const item of accepted) void this.start(item.id)
      }
    }
    return this._snapshotItems(accepted)
  }

  async start(id?: string): Promise<void> {
    if (this.disabled || this._disposed || !this.upload) return
    const canStart = (item: MutableUploadFileItem<TResult>) =>
      item.status === 'ready' || item.status === 'error' || item.status === 'cancelled'
    const items = id
      ? this._items.filter(item => item.id === id && canStart(item))
      : this._items.filter(canStart)
    await Promise.all(items.map(item => this._uploadItem(item)))
  }

  retry(id: string): Promise<void> {
    const item = this._findItem(id)
    if (!item || (item.status !== 'error' && item.status !== 'cancelled')) return Promise.resolve()
    return this.start(id)
  }

  cancel(id: string): boolean {
    if (this._disposed) return false
    const item = this._findItem(id)
    const controller = this._abortControllers.get(id)
    if (!item || !controller || item.status !== 'uploading') return false
    controller.abort()
    this._abortControllers.delete(id)
    this._attempts.set(id, (this._attempts.get(id) ?? 0) + 1)
    item.status = 'cancelled'
    item.error = undefined
    this._syncRowControls(item)
    this._notifyChange()
    return true
  }

  remove(id: string): boolean {
    if (this._disposed) return false
    const index = this._items.findIndex(item => item.id === id)
    if (index < 0) return false
    this._abortControllers.get(id)?.abort()
    this._abortControllers.delete(id)
    this._attempts.delete(id)
    this._items.splice(index, 1)
    this._disposeRowControls(id)
    this._notifyChange(true)
    return true
  }

  clear(): void {
    if (this._disposed || this._items.length === 0) return
    for (const item of this._items) {
      this._abortControllers.get(item.id)?.abort()
      this._abortControllers.delete(item.id)
      this._attempts.delete(item.id)
      this._disposeRowControls(item.id)
    }
    this._items.length = 0
    this._notifyChange(true)
  }

  debugState(): Array<{
    id: string
    name: string
    status: UploadFileStatus
    progress: number
    error?: string
  }> {
    return this._items.map(item => ({
      id: item.id,
      name: item.file.name,
      status: item.status,
      progress: item.progress,
      error: item.error,
    }))
  }

  visitChildren(visitor: (child: RenderObject) => void): void {
    this.visitManagedChildren(visitor, () => {
      visitor(this._selectButton)
      for (const controls of this._rowControls.values()) {
        visitor(controls.action)
        visitor(controls.remove)
      }
    })
  }

  override visitContentChildren(visitor: (child: RenderObject) => void): void {
    visitor(this._selectButton)
    for (const controls of this._rowControls.values()) {
      visitor(controls.action)
      visitor(controls.remove)
    }
  }

  performLayout(constraints: BoxConstraints, context: LayoutContext): void {
    this._rowHeight = Math.max(30, context.theme.controlHeight)
    this._rowGap = Math.max(3, context.theme.itemSpacing)
    this._sectionGap = Math.max(4, context.theme.itemSpacing)
    const width = constraints.maxWidth === Infinity ? 420 : constraints.maxWidth
    this._selectButton.layout({
      minWidth: 0,
      maxWidth: Math.max(0, width),
      minHeight: 0,
      maxHeight: this._rowHeight,
    }, true, context)
    this._selectButton.positionInSlot({
      x: 0,
      y: 0,
      width: this._selectButton.outerSize.width,
      height: this._selectButton.outerSize.height,
    }, 'start', 'start')

    let y = this._selectButton.outerSize.height + (this._items.length > 0 ? this._sectionGap : 0)
    for (const item of this._items) {
      const controls = this._rowControls.get(item.id)
      if (!controls) continue
      this._syncRowControls(item)
      const removeWidth = 58
      const actionWidth = controls.action.visible ? 58 : 0
      controls.remove.layout({
        minWidth: removeWidth,
        maxWidth: removeWidth,
        minHeight: this._rowHeight - 6,
        maxHeight: this._rowHeight - 6,
      }, true, context)
      controls.remove.positionInSlot({
        x: Math.max(0, width - removeWidth),
        y: y + 3,
        width: removeWidth,
        height: this._rowHeight - 6,
      }, 'stretch', 'stretch')
      if (controls.action.visible) {
        controls.action.layout({
          minWidth: actionWidth,
          maxWidth: actionWidth,
          minHeight: this._rowHeight - 6,
          maxHeight: this._rowHeight - 6,
        }, true, context)
        controls.action.positionInSlot({
          x: Math.max(0, width - removeWidth - this._rowGap - actionWidth),
          y: y + 3,
          width: actionWidth,
          height: this._rowHeight - 6,
        }, 'stretch', 'stretch')
      }
      y += this._rowHeight + this._rowGap
    }
    if (this._items.length > 0) y -= this._rowGap
    this.size = constrainSize(constraints, { width, height: y })
  }

  performPaint(context: PaintContext, offset: Offset): void {
    const dl = new DrawList(context)
    const inputStyle = deriveTextInputStyle(context.theme)
    const fontSize = context.theme.fontSize
    const fontFamily = context.theme.fontFamily
    const buttonHeight = this._selectButton.outerSize.height
    let y = offset.y + buttonHeight + (this._items.length > 0 ? this._sectionGap : 0)

    for (const item of this._items) {
      const controls = this._rowControls.get(item.id)
      if (!controls) continue
      dl.fillRect(offset.x, y, this.size.width, this._rowHeight, context.theme.surfaceControl, inputStyle.borderRadius)
      dl.strokeRect(offset.x, y, this.size.width, this._rowHeight, context.theme.borderControl, 1, inputStyle.borderRadius)
      const rightBoundary = offset.x + Math.max(
        0,
        controls.action.visible ? controls.action.offset.x - this._rowGap : controls.remove.offset.x - this._rowGap,
      )
      const statusText = this._statusText(item)
      const statusWidth = Math.min(
        Math.max(68, TextMeasurer.measureWidth(statusText, fontSize, fontFamily) + 8),
        Math.max(68, this.size.width * 0.3),
      )
      const nameMaxWidth = Math.max(0, rightBoundary - offset.x - statusWidth - 20)
      const name = ellipsizeText(item.file.name, nameMaxWidth, value => TextMeasurer.measureWidth(value, fontSize, fontFamily))
      dl.fillText(name, offset.x + 8, y + this._rowHeight / 2, context.theme.textPrimary, fontSize, fontFamily, 'left', 'middle')
      dl.fillText(
        ellipsizeText(statusText, statusWidth, value => TextMeasurer.measureWidth(value, fontSize, fontFamily)),
        Math.max(offset.x + 8, rightBoundary - statusWidth),
        y + this._rowHeight / 2,
        this._statusColor(item, context),
        Math.max(11, fontSize - 1),
        fontFamily,
        'left',
        'middle',
      )
      if (item.status === 'uploading') {
        const progressWidth = Math.max(0, rightBoundary - offset.x - 16)
        dl.fillRect(offset.x + 8, y + this._rowHeight - 4, progressWidth, 2, context.theme.surfaceControlActive, 1)
        dl.fillRect(offset.x + 8, y + this._rowHeight - 4, progressWidth * item.progress, 2, context.theme.accentPrimary, 1)
      }
      y += this._rowHeight + this._rowGap
    }
    super.performPaint(context, offset)
  }

  override dispose(): void {
    if (this._disposed) return
    this._disposed = true
    for (const controller of this._abortControllers.values()) controller.abort()
    this._abortControllers.clear()
    for (const id of [...this._rowControls.keys()]) this._disposeRowControls(id)
    this._items.length = 0
    this._attempts.clear()
    this.upload = undefined
    this.validateFile = undefined
    this.onChange = undefined
    this.onReject = undefined
    this.onError = undefined
    super.dispose()
  }

  private _validateFile(
    file: File,
    validateFile: RenderUploadOptions<TResult>['validateFile'],
  ): string | null {
    const builtInReason = this._validateBuiltInFile(file)
    if (builtInReason) return builtInReason
    return validateFile?.(file)?.trim() || null
  }

  private _validateBuiltInFile(file: File): string | null {
    if (this.maxFileSize !== undefined && file.size > this.maxFileSize) {
      return `文件大小不能超过 ${formatFileSize(this.maxFileSize)}`
    }
    if (this.accept && !fileMatchesAccept(file, this.accept)) {
      return `不支持 ${file.name} 的文件类型`
    }
    return null
  }

  private async _uploadItem(item: MutableUploadFileItem<TResult>): Promise<void> {
    const upload = this.upload
    if (!upload || item.status === 'uploading' || !this._items.includes(item)) return
    const attempt = (this._attempts.get(item.id) ?? 0) + 1
    this._attempts.set(item.id, attempt)
    const controller = new AbortController()
    this._abortControllers.set(item.id, controller)
    item.status = 'uploading'
    item.progress = 0
    item.error = undefined
    item.result = undefined
    this._syncRowControls(item)
    this._notifyChange()
    if (!this._isCurrentAttempt(item, attempt) || controller.signal.aborted) return

    try {
      const result = await upload(item.file, {
        signal: controller.signal,
        reportProgress: value => {
          if (!this._isCurrentAttempt(item, attempt) || controller.signal.aborted) return
          item.progress = clampProgress(value)
          this._notifyChange()
        },
      })
      if (!this._isCurrentAttempt(item, attempt) || controller.signal.aborted) return
      item.status = 'success'
      item.progress = 1
      item.result = result
    } catch (error) {
      if (!this._isCurrentAttempt(item, attempt)) return
      if (controller.signal.aborted) {
        item.status = 'cancelled'
        item.error = undefined
      } else {
        item.status = 'error'
        item.error = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (this._isCurrentAttempt(item, attempt)) {
        this._abortControllers.delete(item.id)
        this._syncRowControls(item)
        this._notifyChange()
      }
    }
  }

  private _isCurrentAttempt(item: MutableUploadFileItem<TResult>, attempt: number): boolean {
    return !this._disposed && this._items.includes(item) && this._attempts.get(item.id) === attempt
  }

  private _findItem(id: string): MutableUploadFileItem<TResult> | undefined {
    return this._items.find(item => item.id === id)
  }

  private _createRowControls(item: MutableUploadFileItem<TResult>): void {
    const action = new RenderButton({
      label: '上传',
      onClick: () => this._runRowAction(item.id),
      disabled: this.disabled,
    })
    const remove = new RenderButton({
      label: '移除',
      onClick: () => { this.remove(item.id) },
      disabled: this.disabled,
    })
    action.parent = this
    remove.parent = this
    this._rowControls.set(item.id, { action, remove })
    if (this.owner) {
      action.attach(this.owner)
      remove.attach(this.owner)
    }
    this._syncRowControls(item)
  }

  private _disposeRowControls(id: string): void {
    const controls = this._rowControls.get(id)
    if (!controls) return
    this._rowControls.delete(id)
    controls.action.dispose()
    controls.remove.dispose()
  }

  private _runRowAction(id: string): void {
    const item = this._findItem(id)
    if (!item) return
    if (item.status === 'uploading') {
      this.cancel(id)
      return
    }
    void this.start(id)
  }

  private _syncRowControls(item: MutableUploadFileItem<TResult>): void {
    const controls = this._rowControls.get(item.id)
    if (!controls) return
    const nextLabel = item.status === 'uploading'
      ? '取消'
      : item.status === 'error' || item.status === 'cancelled'
        ? '重试'
        : '上传'
    const nextVisible = !!this.upload && item.status !== 'success'
    if (controls.action.label !== nextLabel) {
      controls.action.label = nextLabel
      controls.action.markNeedsLayout()
    }
    controls.action.visible = nextVisible
    controls.action.disabled = this.disabled
    controls.remove.disabled = this.disabled
  }

  private _statusText(item: MutableUploadFileItem<TResult>): string {
    switch (item.status) {
      case 'ready': return `${formatFileSize(item.file.size)} · 等待上传`
      case 'uploading': return `${Math.round(item.progress * 100)}%`
      case 'success': return '已完成'
      case 'cancelled': return '已取消'
      case 'error': return item.error ? `失败：${item.error}` : '上传失败'
    }
  }

  private _statusColor(item: MutableUploadFileItem<TResult>, context: PaintContext) {
    if (item.status === 'success') return context.theme.accentSuccess
    if (item.status === 'error') return context.theme.accentDanger
    if (item.status === 'uploading') return context.theme.accentPrimary
    return context.theme.textSecondary
  }

  private _notifyChange(layout = false): void {
    if (layout) this.markNeedsLayout()
    this.markNeedsPaint()
    this.onChange?.(this.items)
  }

  private _snapshotItems(
    items: readonly MutableUploadFileItem<TResult>[],
  ): readonly UploadFileItem<TResult>[] {
    return items.map(item => ({
      id: item.id,
      file: item.file,
      status: item.status,
      progress: item.progress,
      error: item.error,
      result: item.result,
    }))
  }

  private _selectFilesFromButton(): void {
    void this.selectFiles().catch(error => {
      if (!this._disposed) this.onError?.(error)
    })
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return value > 0 ? Number.POSITIVE_INFINITY : 1
  return Math.max(1, Math.floor(value))
}

function normalizeOptionalPositiveNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** unitIndex
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function fileMatchesAccept(file: File, accept: string): boolean {
  const fileName = file.name.toLowerCase()
  const fileType = file.type.toLowerCase()
  const rules = accept.split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean)
  if (rules.length === 0) return true
  return rules.some(rule => {
    if (rule.startsWith('.')) return fileName.endsWith(rule)
    if (rule.endsWith('/*')) return fileType.startsWith(rule.slice(0, -1))
    return fileType === rule
  })
}
