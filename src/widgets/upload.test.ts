import { describe, expect, it, vi } from 'vitest'
import { RenderUpload } from './upload'
function file(name: string, size: number, type: string): File { return new File([new Uint8Array(size)], name, { type }) }

describe('Upload failure recovery', () => {
  it('recovers from an uploading notification failure and allows retry', async () => {
    const error = new Error('uploading callback failed')
    const handler = vi.fn(async () => 'remote/report.pdf')
    const upload = new RenderUpload({ autoUpload: false, upload: handler })
    const [item] = upload.addFiles([file('report.pdf', 4, 'application/pdf')])
    upload.onChange = items => { if (items[0]?.status === 'uploading') throw error }
    await upload.start(item!.id)
    expect(handler).not.toHaveBeenCalled()
    expect(upload.items[0]).toMatchObject({ status: 'error', error: error.message })
    expect((upload as any)._abortControllers.size).toBe(0)
    upload.onChange = vi.fn()
    await upload.retry(item!.id)
    expect(handler).toHaveBeenCalledOnce()
    expect(upload.items[0]).toMatchObject({ status: 'success', result: 'remote/report.pdf' })
    upload.dispose()
  })

  it('cleans the failed attempt even when the error-state notification also throws', async () => {
    const error = new Error('notification failed')
    const handler = vi.fn(async () => 'uploaded')
    const upload = new RenderUpload({ autoUpload: false, upload: handler })
    const [item] = upload.addFiles([file('report.pdf', 4, 'application/pdf')])
    upload.onChange = () => { throw error }
    await expect(upload.start(item!.id)).rejects.toBe(error)
    expect(handler).not.toHaveBeenCalled()
    expect(upload.items[0]).toMatchObject({ status: 'error', error: error.message })
    expect((upload as any)._abortControllers.size).toBe(0)
    upload.onChange = undefined
    await upload.retry(item!.id)
    expect(upload.items[0]!.status).toBe('success')
    upload.dispose()
  })

  it('does not invoke the upload handler after an uploading callback removes the item', async () => {
    const selected = file('report.pdf', 4, 'application/pdf')
    const handler = vi.fn(async () => 'remote/report.pdf')
    let upload!: RenderUpload<string>
    upload = new RenderUpload<string>({
      autoUpload: false,
      upload: handler,
      onChange: items => {
        const item = items[0]
        if (item?.status === 'uploading') upload.remove(item.id)
      },
    })
    const [item] = upload.addFiles([selected])

    await upload.start(item!.id)

    expect(handler).not.toHaveBeenCalled()
    expect(upload.items).toEqual([])
  })
})
