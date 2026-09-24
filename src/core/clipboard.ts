export interface CopyableSelection {
  getCopyText(): string | null | undefined
}

export type ClipboardTextWriter = (text: string) => boolean | void | Promise<boolean | void>

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

  setWriter(writer?: ClipboardTextWriter): void {
    this._writer = writer
  }

  resetWriter(): void {
    this._writer = undefined
  }

  async writeText(text: string): Promise<boolean> {
    try {
      if (this._writer) {
        const result = await this._writer(text)
        return result !== false
      }
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (clipboard?.writeText) {
        await clipboard.writeText(text)
        return true
      }
    } catch {
      return false
    }
    return false
  }
}
