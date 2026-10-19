export interface FilePickerOptions {
  accept?: string
  multiple?: boolean
  capture?: string
  signal?: AbortSignal
}

export interface FilePickerBridge {
  pickFiles(options?: FilePickerOptions): Promise<File[]>
}

export class BrowserFilePickerBridge implements FilePickerBridge {
  constructor(private readonly documentRef?: Document | null) {}

  pickFiles(options: FilePickerOptions = {}): Promise<File[]> {
    if(options.signal?.aborted)return Promise.reject(options.signal.reason)
    const documentRef = this.documentRef === undefined
      ? typeof document === 'undefined' ? null : document
      : this.documentRef
    if (!documentRef?.body) {
      return Promise.reject(new Error('File selection requires a browser document.'))
    }

    return new Promise<File[]>((resolve, reject) => {
      const input = documentRef.createElement('input')
      input.type = 'file'
      input.style.display = 'none'
      input.multiple = options.multiple ?? false
      if (options.accept) input.accept = options.accept
      if (options.capture) input.setAttribute('capture', options.capture)

      let settled = false
      const abort = () => fail(options.signal?.reason ?? new DOMException('File selection cancelled', 'AbortError'))
      const finish = (files: File[]) => {
        if (settled) return
        settled = true
        input.remove()
        options.signal?.removeEventListener('abort',abort)
        resolve(files)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        input.remove()
        options.signal?.removeEventListener('abort',abort)
        reject(error)
      }
      input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
      input.addEventListener('cancel', () => finish([]), { once: true })
      options.signal?.addEventListener('abort',abort,{once:true})
      if(options.signal?.aborted){abort();return}
      try {
        documentRef.body.appendChild(input)
        if(settled)return
        input.click()
      } catch (error) {
        fail(error)
      }
    })
  }
}

export const browserFilePicker = new BrowserFilePickerBridge()
