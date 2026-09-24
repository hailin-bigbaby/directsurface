export interface FilePickerOptions {
  accept?: string
  multiple?: boolean
  capture?: string
}

export interface FilePickerBridge {
  pickFiles(options?: FilePickerOptions): Promise<File[]>
}

export class BrowserFilePickerBridge implements FilePickerBridge {
  constructor(private readonly documentRef?: Document | null) {}

  pickFiles(options: FilePickerOptions = {}): Promise<File[]> {
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
      const finish = (files: File[]) => {
        if (settled) return
        settled = true
        input.remove()
        resolve(files)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        input.remove()
        reject(error)
      }
      input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true })
      input.addEventListener('cancel', () => finish([]), { once: true })
      try {
        documentRef.body.appendChild(input)
        input.click()
      } catch (error) {
        fail(error)
      }
    })
  }
}

export const browserFilePicker = new BrowserFilePickerBridge()
