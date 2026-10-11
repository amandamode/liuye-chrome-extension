import {duplicates,readingPack,markdown,validUrl} from './core.js';
const $=s=>document.querySelector(s),demo=!globalThis.chrome?.runtime?.id;
const selection=new Set();let visible=[];
let view='open',state={tabs:[],saved:[],closed:[],auto:false},selected=null,busy=false,timer;
const titles={open:['先收好，再慢慢看。','正在打开'],duplicates:['同一页，留一份就够。','重复页面'],later:['不必一直开着。','稍后阅读'],favorites:['值得留下的，收在这里。','我的收藏'],read:['看过的内容，有迹可循。','已经读过']};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function toast(s){clearTimeout(timer);$('#toast').textContent=s;$('#toast').hidden=false;timer=setTimeout(()=>$('#toast').hidden=true,7500)}
async function api(m){if(demo)return demoApi(m);const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw Error(r?.error||'插件未响应，请刷新页面');return r.data}
function button(text,fn,cls){const b=el('button',text,cls);b.onclick=()=>run(fn,b);return b}
async function run(fn,b){if(busy)return;busy=true;if(b)b.disabled=true;try{await fn()}catch(e){toast(e.message)}finally{busy=false;if(b)b.disabled=false}}
async function load(){
 let status=$('#syncStatus');
 if(!status){status=el('p');status.id='syncStatus';status.setAttribute('role','status');$('main').prepend(status)}
 try{state=await api({type:'state'});render();status.textContent=demo?'界面预览：这里是示例数据，请从 Chrome 扩展菜单打开留页。':`已同步 ${state.tabs.length} 个网页标签 · ${new Date().toLocaleTimeString()}（不含空白新标签页、浏览器设置页和无痕窗口）`;}
 catch(e){status.textContent='读取失败：'+e.message+'。请在 chrome://extensions 中重新加载留页，再重新打开。';throw e}
}
function render(){
 const groups=duplicates(state.tabs),dups=new Set(groups.flat().map(t=>t.id));
 for(const [id,count]of Object.entries({openCount:state.tabs.length,dupCount:groups.reduce((n,g)=>n+g.length-1,0),laterCount:state.saved.filter(x=>!x.read).length,favCount:state.saved.filter(x=>x.favorite).length,readCount:state.saved.filter(x=>x.read).length}))$('#'+id).textContent=count;
 $('#auto').checked=state.auto;
 const windowIds=[...new Set(state.tabs.map(t=>t.windowId))];
 const oldWindow=$('#window').value;$('#window').replaceChildren(new Option('所有窗口',''));for(const id of windowIds)$('#window').add(new Option('窗口 '+id,String(id)));$('#window').value=oldWindow;
 $('#window').hidden=!['open','duplicates'].includes(view);
 $('#heading').textContent=view==='open'?`${state.tabs.length} 个标签，${windowIds.length} 个窗口。`:titles[view][0];$('#listLabel').textContent=titles[view][1];
 const old=$('#topic').value;$('#topic').replaceChildren(new Option('所有主题',''));for(const topic of [...new Set(state.saved.map(x=>x.topic).filter(Boolean))].sort())$('#topic').add(new Option(topic,topic));$('#topic').value=old;
 const q=$('#search').value.toLowerCase(),topic=$('#topic').value;
 let items=['open','duplicates'].includes(view)?state.tabs.filter(t=>view!=='duplicates'||dups.has(t.id)):state.saved.filter(x=>view==='read'?x.read:view==='favorites'?x.favorite:!x.read);
 items=items.filter(x=>(!['open','duplicates'].includes(view)||!$('#window').value||String(x.windowId)===$('#window').value));
 items=items.filter(x=>{const saved=state.saved.find(s=>s.url===x.url)||x;return (!topic||saved.topic===topic)&&[x.title,x.url,saved.topic,saved.note].join(' ').toLowerCase().includes(q)});
 $('#resultCount').textContent=items.length+' 个页面';$('#empty').hidden=!!items.length;$('#list').replaceChildren();
 visible=items;const existing=new Set(state.tabs.map(t=>t.id));for(const id of selection)if(!existing.has(id))selection.delete(id);
 $('#selectAll').checked=items.length>0&&items.every(x=>selection.has(x.id));$('#selectAll').disabled=!['open','duplicates'].includes(view)||!items.length;
 $('#selectedCount').textContent=`已选 ${selection.size} 项`;$('#saveSelected').disabled=!selection.size;
 $('#list').className=['open','duplicates'].includes(view)?'window-grid':'saved-grid';

 for(const x of items){
  const isTab=typeof x.id==='number',saved=state.saved.find(s=>s.url===x.url),row=el('article',undefined,'row'),domain=new URL(x.url).hostname;
  if(isTab){const check=el('input');check.type='checkbox';check.checked=selection.has(x.id);check.setAttribute('aria-label','选择 '+x.title);check.onchange=()=>{check.checked?selection.add(x.id):selection.delete(x.id);render()};row.append(check)}
  row.append(el('span',domain.replace('www.','')[0].toUpperCase(),'letter'));const body=el('div');row.append(body);
  const h=el('h3');h.append(button(x.title||domain,async()=>api(isTab?{type:'focus',id:x.id,url:x.url}:{type:'open',url:x.url}),'title-link'));body.append(h);
  const meta=el('div',undefined,'meta');meta.append(el('span',domain));
  if(isTab&&dups.has(x.id))meta.append(el('span','相同网址','badge'));if(x.active||x.pinned||x.audible)meta.append(el('span','保留中','badge'));if(saved)meta.append(el('span',saved.read?'已读':saved.summary?'已有笔记 · 待读':'已收好 · 待读','badge'));body.append(meta);
  const a=el('div',undefined,'actions');
  if(isTab){a.append(button('稍后读',async()=>{await api({type:'save',id:x.id,url:x.url});await load();toast('已保存，标签页仍保留')}));a.append(button('保存并收起',async()=>{await permit(x.url);const r=await api({type:'saveClose',id:x.id,url:x.url});await load();toast(r.closed?'已保存并关闭，可从稍后阅读重新打开':'已保存。'+r.reason)}));a.append(button('帮我读 ↗',async()=>extract(x)));}
  a.append(button(isTab?'备注 / 收藏':'整理 / 阅读笔记',async()=>{const item=saved||await api({type:'save',id:x.id,url:x.url});await load();show(item)}));body.append(a);
  if(isTab)meta.append(el('span','窗口 '+x.windowId));
  $('#list').append(row);
 }
}
async function permit(url){if(demo)return;const origin=new URL(url).origin+'/*';if(!await chrome.permissions.request({origins:[origin]}))throw Error('未授予网站权限，页面没有关闭或提取')}
async function extract(tab){await permit(tab.url);toast('正在提取所选页面的文字…');const item=await api({type:'extract',id:tab.id,url:tab.url});await load();show(item);toast('正文已准备好。点“复制给 AI”，再粘到你的聊天里。')}
function show(item){
 selected=item.id;const r=$('#reader');r.hidden=false;r.replaceChildren();const top=el('div',undefined,'reader-top');top.append(el('span',item.read?'你已标记读完':'待你阅读 · AI 整理不代表读完'),button('关闭',()=>{r.hidden=true}));r.append(top,el('h2',item.title));
 const a=el('a','查看原文 ↗','source');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';r.append(a);
 for(const [key,label]of [['topic','主题'],['note','为什么留下它？'],['summary','粘贴 AI 总结，或写下你的阅读笔记']]){
  const l=el('label',label),input=el(key==='topic'?'input':'textarea');input.value=item[key]||'';input.id='field-'+key;if(key==='summary')input.className='summary';l.append(input);r.append(l);
 }
 const actions=el('div',undefined,'actions');actions.append(button('保存笔记',async()=>{const patch={topic:$('#field-topic').value,note:$('#field-note').value,summary:$('#field-summary').value};const updated=await api({type:'edit',id:item.id,patch});Object.assign(item,updated);await load();toast('笔记已保存到本机')} ,'primary'));
 actions.append(button(item.favorite?'取消收藏':'加入收藏',async()=>{const updated=await api({type:'edit',id:item.id,patch:{favorite:!item.favorite}});await load();show(updated)}));
 actions.append(button(item.read?'改为未读':'我已读完',async()=>{const updated=await api({type:'edit',id:item.id,patch:{read:!item.read}});await load();show(updated)}));r.append(actions);
 r.append(el('h3','帮我初读'));r.append(el('p','不接 API。只在你复制并发送后，AI 才会收到这篇正文。总结后粘贴到上面的笔记框并保存。'));
 const reading=el('div',undefined,'actions');
 if(item.text){reading.append(button('复制给 AI',async()=>{await navigator.clipboard.writeText(readingPack(item));toast('已复制阅读材料。切回当前 AI 聊天，粘贴并发送。')},'primary'));reading.append(button('下载阅读材料',()=>download(readingPack(item),'阅读材料.txt','text/plain')))}
 else reading.append(button('提取正文',async()=>{const t=state.tabs.find(t=>t.url===item.url);if(!t){await api({type:'open',url:item.url});toast('原文已打开。加载完成后回到这里刷新，再提取正文。');return}await extract(t)}));
 reading.append(button('导出到 Obsidian',()=>{const current={...item,topic:$('#field-topic').value,note:$('#field-note').value,summary:$('#field-summary').value};download(markdown(current),safeName(item.title)+'.md','text/markdown');toast('已导出 Markdown。把下载文件放进你的 Obsidian 库即可。')}));r.append(reading);
 if(item.text){r.append(el('p',`${item.text.length.toLocaleString()} 字符 · ${item.truncated?'正文已截断':'页面文字提取，不保证完整'} · ${new Date(item.extractedAt).toLocaleString()}`));const details=el('details'),sum=el('summary','查看提取的正文');details.append(sum,el('pre',item.text));r.append(details)}
}
function safeName(s){return s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)||'网页笔记'}
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
$('#nav').onclick=e=>{const b=e.target.closest('button[data-view]');if(!b)return;view=b.dataset.view;for(const n of $('#nav').children)n.classList.toggle('active',n===b);render()};
$('#window').onchange=render;
$('#selectAll').onchange=e=>{for(const x of visible)if(typeof x.id==='number')e.target.checked?selection.add(x.id):selection.delete(x.id);render()};
$('#saveSelected').onclick=()=>run(async()=>{let n=0;const errors=[];for(const id of [...selection]){const t=state.tabs.find(t=>t.id===id);if(!t)continue;try{await api({type:'save',id,url:t.url});selection.delete(id);n++}catch(e){errors.push(e.message)}}await load();toast(`已保存 ${n} 个标签，原页面仍保留。`+(errors.length?` ${errors.length} 个未保存，请刷新重试。`:''))});
if(!demo){let refreshTimer;const changed=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>load().catch(e=>toast(e.message)),350)};for(const name of ['onCreated','onRemoved','onUpdated','onMoved','onAttached','onDetached','onActivated'])chrome.tabs[name].addListener(changed);chrome.storage.onChanged.addListener(changed)}
$('#search').oninput=render;$('#topic').onchange=render;$('#refresh').onclick=()=>run(load);
$('#clean').onclick=()=>run(async()=>{if(!demo&&!await chrome.permissions.request({origins:['http://*/*','https://*/*']}))throw Error('未授予检查权限，没有关闭页面');const r=await api({type:'clean'});await load();toast(`已收起 ${r.count} 个重复页。${r.skipped.length} 个因状态不明或编辑保护而保留。`)});
$('#auto').onchange=e=>run(async()=>{const value=e.target.checked;try{if(value&&!demo&&!await chrome.permissions.request({origins:['http://*/*','https://*/*']}))throw Error('没有开启自动整理');await api({type:'auto',value});await load();toast(value?'自动整理已开启；有编辑区或无法判断的页面会保留。':'自动整理已关闭')}catch(e){$('#auto').checked=state.auto;throw e}});
$('#undo').onclick=()=>run(async()=>{const x=await api({type:'undo'});await load();toast('已重新打开：'+x.title+'。自动整理已暂停，填写内容不保证恢复。')});
$('#backup').onclick=()=>download(JSON.stringify({version:1,saved:state.saved},null,2),'留页收藏备份.json','application/json');
$('#restore').onclick=()=>$('#importFile').click();
$('#importFile').onchange=()=>run(async()=>{const file=$('#importFile').files[0];if(!file)return;if(file.size>20000000)throw Error('文件超过 20 MB');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.saved))throw Error('不是留页备份文件');const r=await api({type:'import',items:data.saved});await load();toast(`已导入 ${r} 个新页面，现有记录保持不变`);$('#importFile').value=''});
const examples=[{"id": 1, "windowId": 1, "title": "AI 工具导航与今日推荐 · 示例", "url": "https://waytoagi.com/demo-page-1", "active": true, "status": "complete"}, {"id": 2, "windowId": 1, "title": "大模型 API 文档 · 示例", "url": "https://platform.example.com/demo-page-2", "active": false, "status": "complete"}, {"id": 3, "windowId": 1, "title": "Agent 的记忆设计与实践 · 示例", "url": "https://engineering.example.com/demo-page-3", "active": false, "status": "complete"}, {"id": 4, "windowId": 1, "title": "Chrome 扩展开发指南 · 示例", "url": "https://developer.chrome.com/demo-page-4", "active": false, "status": "complete"}, {"id": 5, "windowId": 1, "title": "AI 新闻与产品发布 · 示例", "url": "https://news.example.com/demo-page-5", "active": false, "status": "complete"}, {"id": 6, "windowId": 1, "title": "Prompt 提示词收藏 · 示例", "url": "https://prompts.example.com/demo-page-6", "active": false, "status": "complete"}, {"id": 7, "windowId": 1, "title": "多模态模型体验笔记 · 示例", "url": "https://ai.example.com/demo-page-7", "active": false, "status": "complete"}, {"id": 8, "windowId": 1, "title": "本地模型与知识库 · 示例", "url": "https://models.example.com/demo-page-8", "active": false, "status": "complete"}, {"id": 9, "windowId": 1, "title": "我的项目工作台 · 示例", "url": "https://work.example.com/demo-page-9", "active": false, "status": "complete"}, {"id": 10, "windowId": 1, "title": "浏览器标签管理灵感 · 示例", "url": "https://design.example.com/demo-page-10", "active": false, "status": "complete"}, {"id": 11, "windowId": 2, "title": "Obsidian 双向链接入门 · 示例", "url": "https://help.obsidian.md/demo-page-11", "active": true, "status": "complete"}, {"id": 12, "windowId": 2, "title": "知识管理：如何整理待读 · 示例", "url": "https://notes.example.com/demo-page-12", "active": false, "status": "complete"}, {"id": 13, "windowId": 2, "title": "本周还没看完的长文章 · 示例", "url": "https://read.example.com/demo-page-13", "active": false, "status": "complete"}, {"id": 14, "windowId": 2, "title": "英文播客：AI 与创造力 · 示例", "url": "https://podcast.example.com/demo-page-14", "active": false, "status": "complete"}, {"id": 15, "windowId": 2, "title": "用 Markdown 做读书笔记 · 示例", "url": "https://writing.example.com/demo-page-15", "active": false, "status": "complete"}, {"id": 16, "windowId": 2, "title": "个人知识库的目录结构 · 示例", "url": "https://wiki.example.com/demo-page-16", "active": false, "status": "complete"}, {"id": 17, "windowId": 2, "title": "阅读与注意力的关系 · 示例", "url": "https://reading.example.com/demo-page-17", "active": false, "status": "complete"}, {"id": 18, "windowId": 2, "title": "收藏不是学习，怎样开始 · 示例", "url": "https://learning.example.com/demo-page-18", "active": false, "status": "complete"}, {"id": 19, "windowId": 2, "title": "我的课程学习进度 · 示例", "url": "https://course.example.com/demo-page-19", "active": false, "status": "complete"}, {"id": 20, "windowId": 2, "title": "网页内容保存的方法 · 示例", "url": "https://guide.example.com/demo-page-20", "active": false, "status": "complete"}, {"id": 21, "windowId": 3, "title": "短视频脚本的开头怎么写 · 示例", "url": "https://video.example.com/demo-page-21", "active": true, "status": "complete"}, {"id": 22, "windowId": 3, "title": "小红书封面版式参考 · 示例", "url": "https://cover.example.com/demo-page-22", "active": false, "status": "complete"}, {"id": 23, "windowId": 3, "title": "Figma 组件与视觉设计 · 示例", "url": "https://figma.com/demo-page-23", "active": false, "status": "complete"}, {"id": 24, "windowId": 3, "title": "音乐创作与歌词灵感 · 示例", "url": "https://music.example.com/demo-page-24", "active": false, "status": "complete"}, {"id": 25, "windowId": 3, "title": "我的作品集与发布计划 · 示例", "url": "https://portfolio.example.com/demo-page-25", "active": false, "status": "complete"}, {"id": 26, "windowId": 3, "title": "四个平台的视频分发流程 · 示例", "url": "https://publish.example.com/demo-page-26", "active": false, "status": "complete"}, {"id": 27, "windowId": 3, "title": "字体选择与排版参考 · 示例", "url": "https://type.example.com/demo-page-27", "active": false, "status": "complete"}, {"id": 28, "windowId": 3, "title": "剪辑课程：节奏与叙事 · 示例", "url": "https://edit.example.com/demo-page-28", "active": false, "status": "complete"}, {"id": 29, "windowId": 3, "title": "工作周报与生活复盘 · 示例", "url": "https://daily.example.com/demo-page-29", "active": false, "status": "complete"}, {"id": 30, "windowId": 3, "title": "明天要继续的项目 · 示例", "url": "https://project.example.com/demo-page-30", "active": false, "status": "complete"}, {"id": 31, "windowId": 1, "title": "AI 工具导航与今日推荐 · 示例", "url": "https://waytoagi.com/demo-page-1", "active": false, "status": "complete"}, {"id": 32, "windowId": 2, "title": "Obsidian 双向链接入门 · 示例", "url": "https://help.obsidian.md/demo-page-11", "active": false, "status": "complete"}, {"id": 33, "windowId": 3, "title": "短视频脚本的开头怎么写 · 示例", "url": "https://video.example.com/demo-page-21", "active": false, "status": "complete"}, {"id": 34, "windowId": 1, "title": "Chrome 扩展开发指南 · 示例", "url": "https://developer.chrome.com/demo-page-4", "active": false, "status": "complete"}, {"id": 35, "windowId": 2, "title": "本周还没看完的长文章 · 示例", "url": "https://read.example.com/demo-page-13", "active": false, "status": "complete"}, {"id": 36, "windowId": 3, "title": "我的作品集与发布计划 · 示例", "url": "https://portfolio.example.com/demo-page-25", "active": false, "status": "complete"}];
let mock={tabs:examples,saved:[],closed:[],auto:false};
async function demoApi(m){
 if(m.type==='state')return structuredClone(mock);
 if(['save','saveClose','extract'].includes(m.type)){const t=mock.tabs.find(t=>t.id===m.id);let s=mock.saved.find(s=>s.url===t.url);if(!s){s={...t,id:crypto.randomUUID(),read:false,createdAt:new Date().toISOString()};mock.saved.push(s)}if(m.type==='extract')Object.assign(s,{text:'这是界面预览中的示例正文，不是真实网页内容。实际安装后将从你选择的页面提取文字，并提供复制给 AI 的阅读材料。'.repeat(5),extractedAt:new Date().toISOString()});if(m.type==='saveClose'){if(t.active)return {closed:false,reason:'已保留正在使用的页面'};mock.tabs=mock.tabs.filter(x=>x.id!==t.id);mock.closed.push(t);return {closed:true}}return structuredClone(s)}
 if(m.type==='edit'){const s=mock.saved.find(x=>x.id===m.id);Object.assign(s,m.patch);return structuredClone(s)}
 if(m.type==='auto'){mock.auto=m.value;return {count:0,skipped:[]}}
 if(m.type==='clean'){let count=0;for(const g of duplicates(mock.tabs))for(const t of g.slice(1)){mock.tabs=mock.tabs.filter(x=>x.id!==t.id);mock.closed.push(t);count++}return {count,skipped:[]}}
 if(m.type==='undo'){const t=mock.closed.pop();if(!t)throw Error('没有可恢复的页面');mock.tabs.push(t);return t}
 if(m.type==='import'){let n=0;for(const s of m.items)if(validUrl(s.url)&&!mock.saved.some(x=>x.url===s.url)){mock.saved.push({...s,id:crypto.randomUUID()});n++}return n}
 toast('预览模式：安装插件后才能切换或打开真实网页。');return true;
}
if(demo)$('#demo').hidden=false;
if(!demo){window.addEventListener('focus',()=>load().catch(()=>{}));document.addEventListener('visibilitychange',()=>{if(!document.hidden)load().catch(()=>{})})}
await load().catch(e=>toast(e.message));

function setSidebar(collapsed){
 document.body.classList.toggle('sidebar-collapsed',collapsed);
 $('#sidebar').hidden=collapsed;
 $('#sidebarToggle').textContent=collapsed?'☰ 展开菜单':'☰ 收起菜单';
 $('#sidebarToggle').setAttribute('aria-expanded',String(!collapsed));
}
let collapsed=false;try{collapsed=localStorage.getItem('sidebarCollapsed')==='true'}catch{}
setSidebar(collapsed);
$('#sidebarToggle').onclick=()=>{collapsed=!collapsed;setSidebar(collapsed);try{localStorage.setItem('sidebarCollapsed',String(collapsed))}catch{}};
