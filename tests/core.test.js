import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicates,canClose,readingPack,validUrl} from '../core.js';
test('exact URL only: preserve query and fragment semantics',()=>{
 const tabs=[{id:1,url:'https://a.test/?id=1'},{id:2,url:'https://a.test/?id=2'},{id:3,url:'https://a.test/?id=1#section'},{id:4,url:'https://a.test/?id=1',active:true},{id:5,url:'chrome://settings'},{id:6,url:'chrome://settings'}];
 const g=duplicates(tabs);assert.equal(g.length,1);assert.deepEqual(g[0].map(x=>x.id),[4,1]);
});
test('uncertain state and protected tabs must never close',()=>{
 const t={url:'https://a.test',status:'complete'};const good=[{result:{ready:true,safe:true}}];
 assert.equal(canClose(t,good),true);
 for(const flag of ['active','pinned','audible','discarded','frozen','incognito'])assert.equal(canClose({...t,[flag]:true},good),false);
 for(const frames of [[],[{}],[{result:{safe:true}}],[...good,{result:{ready:true,safe:false}}]])assert.equal(canClose(t,frames),false);
 assert.equal(canClose({...t,pendingUrl:'https://other.test'},good),false);
});
test('incognito and non-web links are excluded',()=>{assert.equal(duplicates([{url:'https://a.test',incognito:true},{url:'https://a.test'}]).length,0);assert.equal(validUrl('javascript:alert(1)'),false)});
test('reading handoff discloses truncation and does not mark read',()=>{const x={title:'A',url:'https://a.test',text:'hello',truncated:true,read:false};assert.match(readingPack(x),/正文已截断/);assert.equal(x.read,false)});
