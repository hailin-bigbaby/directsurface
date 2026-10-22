/// <reference lib="webworker" />
import { ProcurementError } from '../../domain/model'
import type { WriteCommand } from '../../domain/model'
import type { InitOptions, RpcRequest, RpcResponse } from '../protocol'
import { openRepository } from './runtime'
import type { SqliteProcurementRepository } from './repository'
let repository: SqliteProcurementRepository | undefined
let queue=Promise.resolve()
self.addEventListener('message',(event:MessageEvent<RpcRequest>)=>{
  const request=event.data
  queue=queue.then(async()=>{
    const response:RpcResponse={version:1,id:request.id}
    try {
      if(request.version!==1 || !Number.isSafeInteger(request.id) || !Array.isArray(request.args)) throw new ProcurementError('PROTOCOL','Worker请求格式无效')
      if(request.method==='initialize') {
        if(repository) throw new ProcurementError('PROTOCOL','数据库已经初始化')
        repository=await openRepository(request.args[0] as InitOptions)
        response.result=await repository.ready()
      }else{
        if(!repository) throw new ProcurementError('NOT_READY','数据库尚未准备完成')
        const [a,b]=request.args
        switch(request.method){
          case 'ready':response.result=await repository.ready();break
          case 'listOrders':response.result=await repository.listOrders();break
          case 'getOrder':response.result=await repository.getOrder(a as string);break
          case 'availability':response.result=await repository.availability();break
          case 'saveDraft':response.result=await repository.saveDraft(a as WriteCommand);break
          case 'submitOrder':response.result=await repository.submitOrder(a as WriteCommand);break
          case 'getOperationResult':response.result=await repository.getOperationResult(a as string,b as string);break
          case 'exportData':response.result=await repository.exportData();break
          case 'resetDemo':response.result=await repository.resetDemo(a as string);break
          default:throw new ProcurementError('PROTOCOL','不支持的操作')
        }
      }
    }catch(error){
      response.error=error instanceof ProcurementError?{code:error.code,message:error.message,issues:error.issues}:{code:'STORAGE_ERROR',message:'本地数据库操作失败，原数据已保留。'+(error instanceof Error?error.message:''),issues:[]}
    }
    self.postMessage(response)
  }).catch(error=>{console.error('Worker message handling failed',error)})
})
