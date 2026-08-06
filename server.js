const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||3001), ROOT=__dirname, DATA=path.join(ROOT,'data','awards.json');
const KEYS=['地板','地毯','PVC地磚','PVC 地磚','木地板','架高地板','高架地板','導電地板','防靜電地板','塑膠地磚','橡膠地板'];
const sources={tainan:{name:'臺南市政府工程決標公告資料',provider:'臺南市政府研究發展考核委員會',url:'https://soa.tainan.gov.tw/Api/Service/Get/ec6e28c3-e079-4141-b81d-53d87a714109',dataset:'https://data.gov.tw/dataset/178031'}};
const syncState={running:false,lastAttempt:null,lastSuccess:null,lastError:null,checked:0,added:0};
const read=()=>JSON.parse(fs.readFileSync(DATA,'utf8')); const write=d=>fs.writeFileSync(DATA,JSON.stringify(d,null,2));
const text=v=>String(v??'').trim(); const pick=(o,names)=>{for(const n of names)if(o[n]!=null)return text(o[n]);return''};
function normalize(o,source='import'){
 const title=pick(o,['title','案名','標案名稱','標題','Column_2']); const body=pick(o,['內容','content','Column_3']);
 const url=pick(o,['url','公告連結','連結網址','link','網址']); const date=pick(o,['awardDate','決標日期','公告日期','刊登日期','date']).replace(/\//g,'-');
 const amount=Number(String(pick(o,['amount','決標金額','總決標金額','金額'])).replace(/[^\d.-]/g,''))||null;
 const tags=KEYS.filter(k=>(title+' '+body).toLowerCase().includes(k.toLowerCase()));
 return {id:pick(o,['id','標案案號','案號'])||crypto.createHash('sha1').update([title,date,url].join('|')).digest('hex').slice(0,14),agency:pick(o,['agency','機關名稱','發布單位','機關']),title:title||body.slice(0,80),awardDate:date,vendor:pick(o,['vendor','得標廠商','廠商名稱','得標廠商名稱']),amount,url,tags,source,sourceName:source==='tainan'?sources.tainan.name:pick(o,['sourceName','資料來源'])||'使用者匯入',isDemo:false};
}
function csvRows(s){const rows=[];let r=[],v='',q=false;for(let i=0;i<s.length;i++){let c=s[i];if(q&&c==='"'&&s[i+1]==='"'){v+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){r.push(v);v=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&s[i+1]==='\n')i++;r.push(v);if(r.some(x=>x.trim()))rows.push(r);r=[];v=''}else v+=c}if(v||r.length){r.push(v);rows.push(r)}if(!rows.length)return[];let h=rows[0];return rows.slice(1).map(a=>Object.fromEntries(h.map((x,i)=>[x.trim(),a[i]||''])))}
function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'content-type':type,'access-control-allow-origin':'*'});res.end(Buffer.isBuffer(body)||typeof body==='string'?body:JSON.stringify(body))}
async function body(req){let a=[];for await(const x of req)a.push(x);return Buffer.concat(a).toString('utf8')}
async function syncTainan(){
 if(syncState.running)return {...syncState}; syncState.running=true;syncState.lastAttempt=new Date().toISOString();syncState.lastError=null;
 try{let response=await fetch(sources.tainan.url+'?take=50&skip=0',{headers:{accept:'application/json','user-agent':'AwardAtlas/1.0 (open-data client)'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('官方 API 回應 '+response.status);let j=await response.json(),items=j.data||j.Data||j.records||j;if(!Array.isArray(items))items=Object.values(items).find(Array.isArray)||[];let d=read(),seen=new Set(d.map(x=>x.id)),mapped=items.map(x=>normalize(x,'tainan')).filter(x=>x.tags.length&&!seen.has(x.id));write([...mapped,...d]);Object.assign(syncState,{lastSuccess:new Date().toISOString(),checked:items.length,added:mapped.length});return {...syncState,source:sources.tainan}}
 catch(e){syncState.lastError=e.cause?.code||e.message;throw e}finally{syncState.running=false}
}
async function api(req,res,u){
 if(req.method==='GET'&&u.pathname==='/api/awards')return send(res,200,read());
 if(req.method==='GET'&&u.pathname==='/api/status'){let d=read();return send(res,200,{...syncState,officialRecords:d.filter(x=>!x.isDemo).length,demoRecords:d.filter(x=>x.isDemo).length,intervalHours:6,source:sources.tainan})}
 if(req.method==='GET'&&u.pathname==='/api/export'){const d=read(),cols=['機關名稱','案名','決標日期','得標廠商','決標金額','公告連結','關鍵字','資料來源'];let esc=x=>'"'+text(x).replace(/"/g,'""')+'"';return send(res,200,'\ufeff'+[cols,...d.map(x=>[x.agency,x.title,x.awardDate,x.vendor,x.amount,x.url,x.tags.join('、'),x.sourceName])].map(r=>r.map(esc).join(',')).join('\r\n'),'text/csv; charset=utf-8')}
 if(req.method==='POST'&&u.pathname==='/api/import'){let raw=await body(req),ct=req.headers['content-type']||'',items=ct.includes('csv')?csvRows(raw):(JSON.parse(raw).records||JSON.parse(raw));if(!Array.isArray(items))throw Error('資料必須是陣列');let d=read(),mapped=items.map(x=>normalize(x)),seen=new Set(d.map(x=>x.id)),added=mapped.filter(x=>x.title&&x.tags.length&&!seen.has(x.id));write([...added,...d]);return send(res,200,{added:added.length,ignored:items.length-added.length})}
 if(req.method==='POST'&&u.pathname==='/api/sync/tainan')return send(res,200,await syncTainan());
 return send(res,404,{error:'找不到 API'});
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{let u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))return await api(req,res,u);let p=path.join(ROOT,'public',u.pathname==='/'?'index.html':u.pathname);if(!p.startsWith(path.join(ROOT,'public')))return send(res,403,'禁止存取','text/plain');fs.readFile(p,(e,b)=>e?send(res,404,'找不到頁面','text/plain'):send(res,200,b,mime[path.extname(p)]||'application/octet-stream'))}catch(e){send(res,400,{error:e.message})}}).listen(PORT,()=>{console.log(`地材決標雷達：http://localhost:${PORT}`);setTimeout(()=>syncTainan().catch(()=>{}),800);setInterval(()=>syncTainan().catch(()=>{}),6*60*60*1000)});
