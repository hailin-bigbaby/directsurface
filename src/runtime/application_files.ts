import { browserFilePicker, type FilePickerBridge, type FilePickerOptions } from './file_picker'
export interface SaveFileOptions { name: string; type?: string; signal?: AbortSignal }
export type SaveFileResult = { status: 'cancelled' } | { status: 'saved' | 'download-started'; name: string; size: number; sha256?: string }
export interface ApplicationFilePort extends FilePickerBridge {
  readonly pickerAvailable: boolean
  saveBytes(bytes: Uint8Array, options: SaveFileOptions): Promise<SaveFileResult>
  readDataUrl(file: File): Promise<string>
}
export class BrowserApplicationFiles implements ApplicationFilePort {
  get pickerAvailable(): boolean { return typeof document!=='undefined'&&!!document.body }
  pickFiles(options?: FilePickerOptions): Promise<File[]> { return browserFilePicker.pickFiles(options) }
  async saveBytes(bytes: Uint8Array, options: SaveFileOptions): Promise<SaveFileResult> {
    if(options.signal?.aborted)throw options.signal.reason
    if(typeof document==='undefined'||!document.body)throw new Error('File download requires a browser document')
    const blob=new Blob([bytes.slice().buffer],{type:options.type??'application/octet-stream'})
    const url=URL.createObjectURL(blob),anchor=document.createElement('a')
    anchor.href=url;anchor.download=options.name;anchor.style.display='none'
    try{document.body.appendChild(anchor);anchor.click()}
    finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),0)}
    return {status:'download-started',name:options.name,size:bytes.byteLength}
  }
  readDataUrl(file: File): Promise<string> {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader()
      reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Image source could not be read as a base64 data URI.'))
      reader.onerror=()=>reject(new Error('Image source could not be read as a base64 data URI.'))
      reader.readAsDataURL(file)
    })
  }
}
