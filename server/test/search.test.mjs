import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.mjs';
import { normalize, search, snippet } from '../src/search.mjs';
test('Turkish case, accents and dotted/dotless i', () => {
  assert.equal(normalize('Iİıi ŞĞÇÖÜ'), 'iiii sgcou');
});
test('all words, snippets, date order, nested tasks and account/team isolation', () => {
  const db = openDb(':memory:');
  const a = db.users.create({email:'a@test.dev',name:'A',password:'hash'}).id;
  const b = db.users.create({email:'b@test.dev',name:'B',password:'hash'}).id;
  const put = (u,key,value) => db.docs.put(u,key,value,0);
  put(a,'day:2026-11-01',{notes:'ŞİŞLİ çalışma',tasks:[{id:'t',text:'Other',steps:[{id:'s',text:'Şişli çalışma'}]}],columns:[]});
  put(a,'day:2026-11-02',{notes:'çalışma Şişli',tasks:[],columns:[]});
  put(b,'day:2026-11-03',{notes:'Şişli çalışma SECRET',tasks:[],columns:[]});
  const team = db.teams.create(b,{name:'Team',boards:[{id:'b',name:'Board',lists:[{id:'l',name:'List',cards:[{id:'c',title:'Şişli',description:'çalışma',created:'2026-11-04'}]}]}]});
  assert.equal(search(db,a,'sisli calisma').length,3);
  db.teams.add(team,a);
  let hits = search(db,a,'sisli calisma');
  assert.equal(hits.length,4); assert.equal(hits[0].kind,'card');
  assert.equal(hits[0].href,`/team/${team}/b/c`);
  assert.ok(hits.every(r=>!r.snippet.includes('SECRET')));
  assert.equal(search(db,a,'sisli absent').length,0);
  assert.equal(search(db,a,'s').length,0);
  assert.equal(search(db,a,'sisli',1).length,1);
  db.teams.drop(team,a); hits=search(db,a,'sisli'); assert.ok(hits.every(r=>!r.key.startsWith('team:')));
  assert.equal(hits[0].date,'2026-11-02');
});
test('snippet includes distant match without splitting surrogate pairs', () => {
  const s=snippet('😀'.repeat(100)+' İSTANBUL '+ 'x'.repeat(100),['istanbul']);
  assert.ok(s.includes('İSTANBUL')); assert.ok([...s].length<=82); assert.ok(s.startsWith('…'));
});
test('every document surface and calendar period order', () => {
  const docs = [
    {key:'day:2026-01-02',value:{notes:'needle',columns:[{blocks:[{label:'needle',note:'detail'}]}],tasks:[{text:'needle',notes:'detail'}]}},
    {key:'week:2026-W03',value:{items:[{text:'needle'}],notes:'needle'}},
    {key:'month:2026-02',value:{goals:[{text:'needle'}],notes:'needle'}},
    {key:'quarter:2026-Q2',value:{goals:[{text:'needle'}],notes:'needle'}},
    {key:'year:2026',value:{good:'needle',change:'needle'}},
    {key:'inbox',value:{items:[{text:'needle'}],lists:[{id:'l',name:'needle'}]}},
    {key:'settings',value:{countdowns:[{name:'needle',date:'2026-06-01'}],exams:[{name:'needle',date:'2026-06-02'}]}},
    {key:'boards',value:{projects:[{id:'p',boards:[{id:'b',lists:[{cards:[{id:'c',title:'needle',description:'detail',created:'2026-05-01'}]}]}]}]}},
    {key:'team:untrusted',value:{boards:[{id:'b',lists:[{cards:[{title:'needle'}]}]}]}}
  ];
  const db={docs:{all:()=>docs},teams:{of:()=>[]}};
  const hits=search(db,'u','needle');
  assert.deepEqual(Object.fromEntries(docs.filter(d=>d.key!=='team:untrusted').map(d=>[d.key,hits.filter(h=>h.key===d.key).length])), {
    'day:2026-01-02':3,'week:2026-W03':2,'month:2026-02':2,'quarter:2026-Q2':2,'year:2026':2,inbox:2,settings:2,boards:1
  });
  assert.deepEqual(new Set(hits.map(x=>x.kind)),new Set(['day-note','block','task','goal','note','inbox','list','countdown','exam','card']));
  assert.equal(hits[0].kind,'exam');
  assert.ok(hits.findIndex(x=>x.key==='quarter:2026-Q2')<hits.findIndex(x=>x.key==='month:2026-02'));
  assert.ok(hits.some(x=>x.href==='/project/p/b/c'));
  assert.ok(hits.every(x=>x.key!=='team:untrusted'));
});
