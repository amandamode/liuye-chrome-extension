import {duplicates,validUrl,protectedTab,canClose} from './core.js';
let queue=Promise.resolve();
function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result}
const db=async()=>({saved:[],closed:[],auto:false,...await chrome.storage.local.get(['saved','closed','auto'])});
async function getTab(id,url){const t=await chrome.tabs.get(id);if(url&&t.url!==url)throw Error('页面已跳转，请刷新列表后重试');return t}
async function saveTab(t,extra={}) {
 if(!validUrl(t.url)||t.incognito)throw Error('只保存普通窗口中的 HTTP / HTTPS 网页');
 const d=await db();let item=d.saved.find(x=>x.url===t.url);
 if(!item){item={id:crypto.randomUUID(),title:t.title||t.url,url:t.url,createdAt:new Date().toISOString(),topic:'',note:'',read:false};d.saved.unshift(item)}
 Object.assign(item,extra);await chrome.storage.local.set({saved:d.saved});return item;
}
// Conservative: any form/editor/embedded frame blocks closure. Detection cannot prove arbitrary web app state.
export function inspectPage(){
 const editable=document.querySelector('input:not([type="hidden"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],iframe,frame');
 const media=[...document.querySelectorAll('audio,video')].some(m=>!m.paused);
 return {safe:!editable&&!media,ready:document.readyState==='complete'};
}
async function closeSafe(id,url,reason){
 let t=await getTab(id,url);
 if(protectedTab(t))throw Error('已保留：正在使用、固定、播放、休眠或尚未加载完成的页面');
 let frames;
 try{frames=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:inspectPage})}catch{throw Error('已保留：无法检查页面状态，请先授予此网站访问权限')}
 t=await getTab(id,url);
 if(!canClose(t,frames))throw Error('已保留：页面有输入框、编辑区、嵌入内容或正在播放，不能确认可安全关闭');
 if(reason==='duplicate'){
  const others=(await chrome.tabs.query({})).filter(x=>x.id!==id&&x.url===url&&!x.incognito);
  if(!others.length)throw Error('已保留：其他副本已经关闭');
 }
 const d=await db();const entry={id:crypto.randomUUID(),title:t.title,url:t.url,closedAt:new Date().toISOString(),status:'planned'};
 d.closed.unshift(entry);await chrome.storage.local.set({closed:d.closed});
 try {await chrome.tabs.remove(id);entry.status='closed'}catch(e){entry.status='failed';await chrome.storage.local.set({closed:d.closed});throw e}
 await chrome.storage.local.set({closed:d.closed});return entry;
}
function extractPage(){
 const source=document.querySelector('article')||document.querySelector('main')||document.body;
 const copy=source.cloneNode(true);
 copy.querySelectorAll('script,style,noscript,nav,header,footer,form,input,textarea,select,button,[contenteditable],iframe,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
 const text=(copy.textContent||'').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();
 return {text:text.slice(0,60000),truncated:text.length>60000,url:location.href,title:document.title,extractedAt:new Date().toISOString()};
}
async function clean(){
 const groups=duplicates(await chrome.tabs.query({}));let count=0;const skipped=[];
 for(const g of groups)for(const t of g.slice(1)){try{await closeSafe(t.id,t.url,'duplicate');count++}catch(e){skipped.push({title:t.title,message:e.message})}}
 return {count,skipped};
}
async function handle(m){
 if(m.type==='state'){const d=await db();return {...d,tabs:(await chrome.tabs.query({})).filter(t=>!t.incognito&&validUrl(t.url))}}
 if(m.type==='save')return saveTab(await getTab(m.id,m.url));
 if(m.type==='saveClose'){const t=await getTab(m.id,m.url);await saveTab(t);try{await closeSafe(t.id,t.url,'save');return {closed:true}}catch(e){return {closed:false,reason:e.message}}}
 if(m.type==='clean')return clean();
 if(m.type==='extract'){
  const t=await getTab(m.id,m.url);if(!validUrl(t.url)||t.incognito)throw Error('不支持此页面');
  const [r]=await chrome.scripting.executeScript({target:{tabId:t.id},func:extractPage});
  if(!r?.result?.text||r.result.text.length<80)throw Error('正文太少或无法读取。PDF、视频、付费墙可能需要另行提供文字。');
  if(r.result.url!==t.url)throw Error('提取时页面发生跳转，请重试');
  return saveTab(t,r.result);
 }
 if(m.type==='import'){
  if(!Array.isArray(m.items)||m.items.length>10000)throw Error('备份条目不合法或超过 10000 条');
  const d=await db();let count=0;
  for(const source of m.items){
   if(!source||!validUrl(source.url)||d.saved.some(x=>x.url===source.url))continue;
   const item={id:crypto.randomUUID(),url:source.url,createdAt:new Date().toISOString(),read:source.read===true,favorite:source.favorite===true};
   for(const k of ['title','topic','note','summary','text','extractedAt'])if(typeof source[k]==='string')item[k]=source[k].slice(0,k==='text'?60000:20000);
   item.title=item.title||item.url;item.truncated=source.truncated===true;d.saved.push(item);count++;
  }
  await chrome.storage.local.set({saved:d.saved});return count;
 }
 if(m.type==='edit'){
  const d=await db(),item=d.saved.find(x=>x.id===m.id);if(!item)throw Error('记录不存在');
  for(const k of ['topic','note','summary','read','favorite'])if(k in m.patch)item[k]=m.patch[k];
  await chrome.storage.local.set({saved:d.saved});return item;
 }
 if(m.type==='undo'){
  const d=await db(),entry=d.closed.find(x=>x.status==='closed');if(!entry)throw Error('没有可恢复的记录');
  await chrome.storage.local.set({auto:false});await chrome.tabs.create({url:entry.url,active:false});entry.status='restored';await chrome.storage.local.set({closed:d.closed});return entry;
 }
 if(m.type==='auto'){
  if(m.value&&!await chrome.permissions.contains({origins:['http://*/*','https://*/*']}))throw Error('自动去重需要网站访问权限');
  await chrome.storage.local.set({auto:!!m.value});if(m.value)return clean();return {count:0,skipped:[]};
 }
 if(m.type==='focus'){const t=await getTab(m.id,m.url);await chrome.windows.update(t.windowId,{focused:true});await chrome.tabs.update(t.id,{active:true});return true}
 if(m.type==='open'){if(!validUrl(m.url))throw Error('网址不支持');await chrome.tabs.create({url:m.url});return true}
 throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 // The manager itself runs in a tab. Authenticate its URL, not tab presence.
 if(s.id!==chrome.runtime.id||s.url!==chrome.runtime.getURL('app.html'))return false;
 serial(()=>handle(m)).then(data=>reply({ok:true,data}),e=>reply({ok:false,error:e.message}));return true;
});
async function auto(){return serial(async()=>{if((await db()).auto)await clean()})}
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')auto().catch(()=>{})});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='dedupe')auto().catch(()=>{})});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('dedupe',{periodInMinutes:1}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create('dedupe',{periodInMinutes:1}));
chrome.action.onClicked.addListener(async()=>{
 const url=chrome.runtime.getURL('app.html'),tabs=await chrome.tabs.query({url});
 if(tabs.length){await chrome.windows.update(tabs[0].windowId,{focused:true});await chrome.tabs.update(tabs[0].id,{active:true})}else await chrome.tabs.create({url});
});
