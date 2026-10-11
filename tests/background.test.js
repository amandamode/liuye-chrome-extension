import test from 'node:test';
import assert from 'node:assert/strict';
let listener,store,tabs,frames,failWrite,removed;
const event={addListener(){}};
globalThis.chrome={runtime:{id:'test',getURL:x=>'chrome-extension://test/'+x,onMessage:{addListener(fn){listener=fn}},onInstalled:event,onStartup:event},storage:{local:{async get(){return structuredClone(store)},async set(x){if(failWrite)throw Error('storage failed');Object.assign(store,structuredClone(x))}}},tabs:{async query(){return structuredClone(tabs)},async get(id){const t=tabs.find(x=>x.id===id);if(!t)throw Error('missing');return structuredClone(t)},async remove(id){removed.push(id);tabs=tabs.filter(x=>x.id!==id)},async create(x){tabs.push({id:tabs.length+100,url:x.url,status:'complete',active:x.active});return tabs.at(-1)},onUpdated:event},scripting:{async executeScript({target}){if(frames[target.tabId] instanceof Error)throw frames[target.tabId];return frames[target.tabId]||[{result:{ready:true,safe:true}}]}},alarms:{create(){},onAlarm:event},action:{onClicked:event},permissions:{async contains(){return true}},windows:{async update(){}}};
await import('../background.js');
function reset(){store={saved:[],closed:[],auto:false};tabs=[{id:1,url:'https://a.test',title:'A',active:true,status:'complete'},{id:2,url:'https://a.test',title:'A',active:false,status:'complete'}];frames={};failWrite=false;removed=[]}
function call(m){return new Promise(resolve=>listener(m,{id:'test',url:chrome.runtime.getURL('app.html'),tab:{id:99}},resolve))}
test('dedupe closes only unprotected duplicate and can undo',async()=>{reset();let r=await call({type:'clean'});assert.equal(r.data.count,1);assert.deepEqual(removed,[2]);assert.equal(store.closed[0].status,'closed');r=await call({type:'undo'});assert.equal(r.ok,true);assert.equal(store.closed[0].status,'restored');assert.equal(tabs.length,2)});
test('storage failure prevents close',async()=>{reset();failWrite=true;const r=await call({type:'saveClose',id:2,url:'https://a.test'});assert.equal(r.ok,false);assert.equal(removed.length,0)});
test('unknown or form state protects duplicates',async()=>{reset();frames[2]=[{result:{ready:true,safe:false}}];const r=await call({type:'clean'});assert.equal(r.data.count,0);assert.equal(r.data.skipped.length,1);assert.equal(removed.length,0)});
test('save-close keeps active tab and persists bookmark',async()=>{reset();const r=await call({type:'saveClose',id:1,url:'https://a.test'});assert.equal(r.data.closed,false);assert.equal(store.saved.length,1);assert.equal(removed.length,0)});
test('navigation race prevents save-close for changed page',async()=>{reset();const r=await call({type:'saveClose',id:2,url:'https://wrong.test'});assert.equal(r.ok,false);assert.equal(removed.length,0)});
test('backup import validates URLs and merges without overwrite',async()=>{reset();const r=await call({type:'import',items:[{url:'javascript:alert(1)'},{url:'https://a.test',title:'first'},{url:'https://a.test',title:'second'}]});assert.equal(r.data,1);assert.equal(store.saved[0].title,'first')});

test('manager tab receives state; web pages and other extensions are rejected',async()=>{
 reset();
 const response=await new Promise((resolve,reject)=>{
  const accepted=listener({type:'state'},{id:'test',url:chrome.runtime.getURL('app.html'),tab:{id:99}},resolve);
  if(!accepted)reject(Error('manager tab was rejected'));
 });
 assert.equal(response.ok,true);assert.equal(response.data.tabs.length,2);
 for(const sender of [{id:'test',url:'https://a.test',tab:{id:1}},{id:'other',url:chrome.runtime.getURL('app.html')},{id:'test'}]){
  assert.equal(listener({type:'state'},sender,()=>assert.fail('untrusted sender replied')),false);
 }
});
