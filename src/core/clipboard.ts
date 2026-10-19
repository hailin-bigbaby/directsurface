export interface CopyableSelection {
  getCopyText(): string | null | undefined
}

export type ClipboardTextWriter = (text: string) => boolean | void | Promise<boolean | void>

export interface ClipboardTextPort {
  writeText: ClipboardTextWriter
  readText(): string | null | Promise<string | null>
}

export function isCopyableSelection(value: unknown): value is CopyableSelection {
  return !!value && typeof (value as CopyableSelection).getCopyText === 'function'
}

export function isCopyShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'c'
}

export class ClipboardController {
  private static _instance: ClipboardController | null = null

  static get instance(): ClipboardController {
    if (!ClipboardController._instance) ClipboardController._instance = new ClipboardController()
    return ClipboardController._instance
  }

  private _writer?: ClipboardTextWriter
  private _disposed = false

  constructor(private readonly port?: ClipboardTextPort) {}

  setWriter(writer?: ClipboardTextWriter): void {
    this._writer = writer
  }

  resetWriter(): void {
    this._writer = undefined
  }

  async writeText(text: string): Promise<boolean> {
    if (this._disposed) return false
    try {
      if (this._writer || this.port) {
        const result = await (this._writer ? this._writer(text) : this.port!.writeText(text))
        return !this._disposed && result !== false
      }
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (clipboard?.writeText) {
        await clipboard.writeText(text)
        return !this._disposed
      }
    } catch {
      return false
    }
    return false
  }

  async readText(): Promise<string | null> {
    if (this._disposed) return null
    try {
      const clipboard = this.port ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined)
      if (!clipboard?.readText) return null
      const text = await clipboard.readText()
      return !this._disposed && typeof text === 'string' ? text : null
    } catch {
      return null
    }
  }

  dispose(): void {
    this._disposed = true
    this._writer = undefined
  }
}
