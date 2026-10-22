import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const items = [
 ['paper','A4复印纸','80g / 500张 / 5包一箱','箱','包','5','120','supply'],
 ['pens','中性笔','0.5mm 黑色 / 12支一盒','盒','支','12','24','supply'],
 ['folders','文件夹','A4 双夹 / 蓝色','个','个','1','12.5','supply'],
 ['monitor','办公显示器','27英寸 / 2K / 可升降支架','台','台','1','1130','equipment'],
 ['printer','网络打印机','A4 双面 / 网络打印','台','台','1','3390','equipment'],
 ...Array.from({length:45},(_,i)=>[`item-${i+6}`,['订书机','收纳盒','档案袋','标签纸','笔记本'][i%5]+` ${i+1}`,`标准办公规格 ${i+1}`,'件','件','1',String(10+i*2),'supply']),
].map(([id,name,specification,purchaseUnit,baseUnit,basePerPurchase,price,kind],i)=>({id,code:`BG-${String(i+1).padStart(3,'0')}`,name,specification,purchaseUnit,baseUnit,basePerPurchase,quantityScale:0,kind,_price:price}))
const suppliers=Array.from({length:6},(_,i)=>({id:`s${i+1}`,name:['文汇办公用品（演示）','启明设备供应（演示）','合远办公科技（演示）','诚办公物资（演示）','达新文具（演示）','停用供应商（演示）'][i],code:`GYS00${i+1}`,enabled:i!==5}))
const itemIds=['paper','paper','pens','folders','monitor','printer','item-6','item-7','item-8','item-9','item-10','item-11']
const requests=itemIds.map((itemId,i)=>({id:`r${i+1}`,number:`SG-202610-${String(i+1).padStart(3,'0')}`,department:['行政部','市场部','研发部','财务部'][i%4],purpose:i===4?'新员工办公设备配置':'部门日常办公使用',itemId,receiptSiteId:'hq',initialBaseQuantity:['50','20','120','20','2','1'][i]??'20',initialGrossCents:i===4?'240000':null,neededOn:'2026-10-30',stockReview:i===0?'库存已分配，仍需采购50包':i===4?'已核查闲置设备，无可调剂显示器':'库存核查完成，以下为批准采购缺口',approvedBy:'部门负责人（样本已批准）'}))
const quotes=items.flatMap(item=>[1,2,3].map(n=>({id:`q-${item.id}-s${n}`,supplierId:`s${n}`,itemId:item.id,conditionProfileId:item.kind==='equipment'?'equipment':'office',unitPrice:n===1?item._price:(Number(item._price)+(n-1)*3).toFixed(2),taxBps:1300,validFrom:'2026-10-01',validTo:'2026-12-31',enabled:true,specification:item.specification,warranty:item.kind==='equipment'?'原厂保修3年（示例）':'按协议处理质量问题',reference:`BJ-2026-${item.code}-0${n} · 含税含运费`})))
quotes.push({...quotes[0],id:'q-paper-expired',supplierId:'s4',validTo:'2026-09-30',validFrom:'2026-09-01',reference:'已过期报价示例'})
const seed={schemaVersion:1,seedVersion:'office-demo-2026.10.21-v1',businessDate:'2026-10-21',company:'示例科技有限公司',suppliers,items:items.map(({_price,...i})=>i),requests,quotes,conditions:[{id:'office',name:'办公耗材协议条件',paymentTerms:'全部验收合格且有效发票核对完成后30个自然日付款；含运费。'},{id:'equipment',name:'设备采购确认条件',paymentTerms:'验收与发票核对后30个自然日付款；含运费及标准保修。'}],receiptSites:[{id:'hq',name:'总部行政收货点',address:'示例办公园区A座（虚构地点）',contact:'行政收货岗（演示）'}],initialOrders:Array.from({length:8},(_,i)=>{const r=requests[6+i%6];return{status:i<2?'submitted':'draft',draft:{id:`sample-order-${i+1}`,supplierId:'s1',conditionProfileId:'office',receiptSiteId:'hq',remark:'预置演示订单',lines:[{id:`sample-line-${i+1}`,requestId:r.id,quoteId:`q-${r.itemId}-s1`,quantity:'1',deliveryDate:'2026-10-28',remark:''}]}}})}
seed.initialOrders[7].draft.lines = requests.slice(0,3).map((r,i)=>({id:`sample-office-${i}`,requestId:r.id,quoteId:`q-${r.itemId}-s1`,quantity:['2','1','2'][i],deliveryDate:'2026-10-28',remark:''}))
const json=JSON.stringify(seed,null,2)+'\n'
const dir=new URL('../public/data/',import.meta.url)
await writeFile(new URL('seed.json',dir),json)
await writeFile(new URL('manifest.json',dir),JSON.stringify({schemaVersion:1,seedVersion:seed.seedVersion,file:'seed.json',sha256:createHash('sha256').update(json).digest('hex')},null,2)+'\n')
console.log('Generated fixed fictional seed and SHA-256 manifest')
