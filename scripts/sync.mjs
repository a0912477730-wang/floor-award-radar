import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const SOURCES = [
  ['臺南市政府工程決標公告資料','https://soa.tainan.gov.tw/Api/Service/Get/ec6e28c3-e079-4141-b81d-53d87a714109'],
  ['臺南市政府勞務決標公告資料','https://soa.tainan.gov.tw/Api/Service/Get/c26b7b81-6aaf-4f38-895f-cc61f807fa4d'],
  ['臺南市政府財物決標公告資料','https://soa.tainan.gov.tw/Api/Service/Get/5ca4d40d-f26e-463b-be91-f8245cd8ada2']
];
const KEYS=['地板','地毯','PVC地磚','PVC 地磚','木地板','架高地板','高架地板','導電地板','防靜電地板','塑膠地磚','橡膠地板'];
const OPENFUN='https://pcc-api.openfun.app';
const plain=s=>String(s??'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const pick=(o,ks)=>{for(const k of ks)if(o[k]!=null)return plain(o[k]);return''};
const capture=(s,labels)=>{for(const l of labels){const m=s.match(new RegExp(l+'[：: ]+([^，,。；;]{2,80})'));if(m)return m[1].trim()}return''};
function normalize(o,sourceName){
 const content=pick(o,['內容','content','Column_3']),title=pick(o,['標題','案名','title','Column_2'])||content.slice(0,90),all=title+' '+content;
 const tags=KEYS.filter(k=>all.toLowerCase().includes(k.toLowerCase()));
 const rawAmount=pick(o,['決標金額','總決標金額','amount'])||capture(content,['決標金額','總決標金額']);
 const url=pick(o,['連結網址','公告連結','url','link']);
 return {id:crypto.createHash('sha1').update(title+'|'+url).digest('hex').slice(0,14),agency:pick(o,['發布單位','機關名稱','agency'])||capture(content,['機關名稱','採購機關']),title,awardDate:pick(o,['刊登日期','決標日期','公告日期','date']).replace(/\//g,'-'),vendor:pick(o,['得標廠商','廠商名稱','vendor'])||capture(content,['得標廠商','得標廠商名稱']),amount:Number(String(rawAmount).replace(/[^\d]/g,''))||null,url,tags,source:'tainan-open-data',sourceName,isDemo:false};
}
let old=[];try{old=JSON.parse(await fs.readFile('public/data/awards.json','utf8')).filter(x=>!x.isDemo)}catch{}
let checked=0,fresh=[],errors=[];
// 全國標案 API：先搜尋案名，再讀取決標明細。API 資料源為政府電子採購網。
for(const keyword of [...new Set(KEYS.map(x=>x.replace(' ','')))]){try{
 const res=await fetch(`${OPENFUN}/api/searchbytitle?query=${encodeURIComponent(keyword)}&page=1`,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('HTTP '+res.status);const result=await res.json();const rows=result.records||[];checked+=rows.length;
 for(const row of rows.filter(x=>String(x.brief?.type||'').includes('決標')).slice(0,20))try{
  const detailRes=await fetch(`${OPENFUN}/api/tender?unit_id=${encodeURIComponent(row.unit_id)}&job_number=${encodeURIComponent(row.job_number)}`,{signal:AbortSignal.timeout(15000)});if(!detailRes.ok)throw Error('detail HTTP '+detailRes.status);const tender=await detailRes.json();const stage=(tender.records||[]).find(x=>x.date==row.date&&x.filename==row.filename)||(tender.records||[]).filter(x=>String(x.brief?.type||'').includes('決標')).at(-1)||row;const detail=stage.detail||{};const flat=Object.entries(detail);const field=(pattern)=>plain(flat.find(([k])=>pattern.test(k))?.[1]);const amount=Number(field(/總?決標金額/).replace(/[^\d]/g,''))||null;const vendor=field(/得標廠商.*名稱|廠商名稱/);const title=plain(row.brief?.title);fresh.push({id:crypto.createHash('sha1').update(row.unit_id+'|'+row.job_number+'|'+row.date).digest('hex').slice(0,14),agency:plain(row.unit_name),title,awardDate:String(row.date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),vendor,amount,url:field(/^url$/)||`https://openfunltd.github.io/pcc-viewer/tender.html?unit_id=${encodeURIComponent(row.unit_id)}&job_number=${encodeURIComponent(row.job_number)}&date=${row.date}&filename=${encodeURIComponent(row.filename)}`,tags:KEYS.filter(k=>title.toLowerCase().includes(k.toLowerCase())),source:'openfun-pcc',sourceName:'OpenFun 標案 API（原始資料：政府電子採購網）',isDemo:false})
 }catch(e){errors.push(`全國明細 ${row.job_number}：${e.message}`)}
}catch(e){errors.push(`全國搜尋 ${keyword}：${e.message}`)}}
// 官方地方開放資料作為補充來源。
for(const [name,url] of SOURCES){try{const res=await fetch(url+'?take=50&skip=0',{headers:{accept:'application/json'}});if(!res.ok)throw Error('HTTP '+res.status);const json=await res.json();let rows=json.data||json.Data||json.records||json;if(!Array.isArray(rows))rows=Object.values(rows).find(Array.isArray)||[];checked+=rows.length;fresh.push(...rows.map(x=>normalize(x,name)).filter(x=>x.title&&x.tags.length))}catch(e){errors.push(name+'：'+e.message)}}
const byId=new Map([...fresh,...old].map(x=>[x.id,x]));const records=[...byId.values()].sort((a,b)=>String(b.awardDate).localeCompare(String(a.awardDate)));
await fs.mkdir('public/data',{recursive:true});await fs.writeFile('public/data/awards.json',JSON.stringify(records,null,2));
await fs.writeFile('public/data/status.json',JSON.stringify({lastAttempt:new Date().toISOString(),lastSuccess:fresh.length?new Date().toISOString():null,checked,added:fresh.length,officialRecords:records.length,errors:errors.slice(0,20),source:'政府電子採購網／OpenFun API、臺南市政府公開資料 API',intervalHours:6},null,2));
console.log(`checked=${checked} matched=${fresh.length} total=${records.length}`,errors.join(' | '));
if(!fresh.length)process.exitCode=1;
