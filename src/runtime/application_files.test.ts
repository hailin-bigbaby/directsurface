// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {BrowserApplicationFiles} from './application_files'
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML=''})
it('starts a browser download without claiming an OS save',async()=>{
  vi.useFakeTimers()
  const create=vi.fn((_blob:Blob)=> 'blob:test'),revoke=vi.fn()
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create})
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke})
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  const files=new BrowserApplicationFiles(),bytes=new Uint8Array([1,2,3])
  const result=await files.saveBytes(bytes,{name:'original.bin',type:'application/octet-stream'})
  expect(result).toEqual({status:'download-started',name:'original.bin',size:3})
  expect(create.mock.calls[0]![0]).toMatchObject({size:3,type:'application/octet-stream'})
  expect(document.querySelector('a')).toBeNull()
  vi.runAllTimers();expect(revoke).toHaveBeenCalledWith('blob:test')
})
it('reads actual image File bytes into a data URI and rejects aborted saves',async()=>{
  const files=new BrowserApplicationFiles(),file=new File([new Uint8Array([1,2,3])],'sample.png',{type:'image/png'})
  expect(files.pickerAvailable).toBe(true)
  expect(await files.readDataUrl(file)).toBe('data:image/png;base64,AQID')
  const cancellation=new AbortController();cancellation.abort()
  await expect(files.saveBytes(new Uint8Array(),{name:'sample',signal:cancellation.signal})).rejects.toMatchObject({name:'AbortError'})
})
