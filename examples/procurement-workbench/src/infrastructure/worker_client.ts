import type { ProcurementRepository } from '../application/ports'
import { ProcurementError, type OrderRecord, type ReadyData, type RequestAvailability, type WriteCommand, type WriteResult } from '../domain/model'
import type { InitOptions, Method, RpcRequest, RpcResponse } from './protocol'

export class WorkerProcurementRepository implements ProcurementRepository {
  private worker:Worker|null=null
  private boot:Promise<ReadyData>|null=null
  private sequence=0
  private disposed=false
  private readonly pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  constructor(private readonly options:InitOptions, private readonly timeoutMs=20_000){}
  private connect():Promise<ReadyData>{
    if(this.disposed)return Promise.reject(new ProcurementError('DISPOSED','工作台已关闭'))
    if(this.boot)return this.boot
    this.worker=new Worker(new URL('./sqlite/worker.ts',import.meta.url),{type:'module'})
    this.worker.onmessage=(event:MessageEvent<RpcResponse>)=>{
      const response=event.data;const item=this.pending.get(response.id)
      if(!item)return
      clearTimeout(item.timer);this.pending.delete(response.id)
      if(response.version!==1)item.reject(new ProcurementError('PROTOCOL','Worker响应版本不兼容'))
      else if(response.error)item.reject(new ProcurementError(response.error.code,response.error.message,response.error.issues))
      else item.resolve(response.result)
    }
    this.worker.onerror=()=>this.fail(new ProcurementError('WORKER_GONE','本地数据连接中断，请确认操作结果后重试'))
    this.boot=this.send<ReadyData>('initialize',[this.options]).catch(error=>{this.fail(error);throw error})
    return this.boot
  }
  private send<T>(method:Method|'initialize',args:unknown[]):Promise<T>{
    const id=++this.sequence
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new ProcurementError('REQUEST_TIMEOUT','本地操作结果尚未确认，请重试查询结果'))},this.timeoutMs)
      this.pending.set(id,{resolve:v=>resolve(v as T),reject,timer})
      try { this.worker!.postMessage({version:1,id,method,args} satisfies RpcRequest) }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new ProcurementError('WORKER_GONE','本地连接不可用，请确认操作结果')) }
    })
  }
  private async call<T>(method:Method,args:unknown[]=[]):Promise<T>{await this.connect();return this.send<T>(method,args)}
  private fail(error:Error):void{
    this.worker?.terminate();this.worker=null;this.boot=null
    for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error)}this.pending.clear()
  }
  ready():Promise<ReadyData>{return this.call('ready')}
  listOrders():Promise<OrderRecord[]>{return this.call('listOrders')}
  getOrder(id:string):Promise<OrderRecord|null>{return this.call('getOrder',[id])}
  availability():Promise<RequestAvailability[]>{return this.call('availability')}
  saveDraft(command:WriteCommand):Promise<WriteResult>{return this.call('saveDraft',[command])}
  submitOrder(command:WriteCommand):Promise<WriteResult>{return this.call('submitOrder',[command])}
  getOperationResult(generation:string,id:string):Promise<WriteResult|null>{return this.call('getOperationResult',[generation,id])}
  exportData():Promise<string>{return this.call('exportData')}
  resetDemo(generation:string):Promise<ReadyData>{return this.call('resetDemo',[generation])}
  dispose():void{this.disposed=true;this.fail(new ProcurementError('DISPOSED','工作台已关闭'))}
}
