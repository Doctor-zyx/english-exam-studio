const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const courses=['sentence','core'].flatMap(n=>read(`dist/data/textbook-${n}.json`).courses);
const lessons=read('dist/data/writing.json').lessons;
const automatic=q=>q.autoGrade!==false&&(q.options?.length||q.autoGrade===true||q.answerMode==='exact');

test('reviewed transcription keeps every original mission, unique IDs, source numbers and feedback',()=>{
 const meta=['sentence','core'].flatMap(n=>read(`tools/content/${n}-meta.json`).courses);
 assert.equal(courses.length,8);
 const auditedCounts={sentence:182,paragraph:67,coherence:59,support:66,essay:80,cause:74,argument:86,paraphrase:32};
 for(const c of courses){
  assert.deepEqual(c.missions.map(m=>m.id),meta.find(x=>x.id===c.id).missions.map(m=>m.id));
  assert.equal(c.contentVersion,2,c.id+' must use reviewed text content');
  const ids=c.missions.flatMap(m=>m.items.map(q=>q.id));assert.equal(ids.length,new Set(ids).size,c.id);
  assert.equal(ids.length,auditedCounts[c.id],c.id+' audited source coverage');
  for(const m of c.missions){
   assert.equal(m.itemsPartial,false,m.id);assert.ok(m.items.length,m.id);
   if(m.textComplete===false)assert.ok(m.missingTasks?.length||m.items.some(q=>q.blocked),m.id+' missing reason');
   for(const q of m.items){assert.ok(q.prompt&&q.sourceNumber&&q.sourceLabel,q.id);if(q.blocked){assert.ok(q.missingReason,q.id);continue}assert.ok(q.explanation,q.id);assert.ok(q.answer!==undefined,q.id);if(!automatic(q))assert.ok(q.rubric?.length,q.id+' self review criteria')}
  }
 }
});
test('Sentence restores filled first examples, all 16 groups and all original task types',()=>{
 const c=courses.find(x=>x.id==='sentence');assert.equal(c.missions.length,16);assert.equal(c.missions.reduce((n,m)=>n+m.items.length,0),182);
 const p1=c.missions[0];assert.equal(p1.items.length,15);assert.deepEqual(p1.items.map(q=>q.sourceNumber),Array.from({length:15},(_,i)=>String(i+1)));
 assert.ok(p1.items.every(q=>q.id.endsWith('-sentence')),'new compound tasks must not reuse old classification completion');
 assert.match(p1.items[0].prompt,/Globalization means/);assert.match(p1.items[1].prompt,/As business executives/);
 assert.ok(c.missions.every(m=>m.textComplete&&!m.itemsPartial));
 assert.ok(c.missions.find(m=>m.id==='ch10-p7').items[0].passage.includes('Robots'));
 for(const id of ['ch10-p10','ch11-editing'])assert.ok(c.missions.find(m=>m.id===id).items.every(q=>q.passage&&q.autoGrade===false));
});
test('each enhanced concept has a usable three-step lesson and a separate formative check',()=>{
 for(const l of lessons.filter(l=>courses.some(c=>c.id===l.id&&c.contentVersion===2))){
  for(const r of l.rules){assert.ok(r.steps?.length&&r.breakdown?.length&&r.pitfall,r.title);assert.ok(r.check?.prompt&&r.check.explanation,r.title);assert.ok(r.check.options.some(o=>o.value===r.check.answer),r.title);assert.ok(r.sourceLabel,r.title)}
 }
});
test('all transcribed task starts render as text with no source-image or reference-answer exposure',()=>{
 const dom=new JSDOM('<main></main>',{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window,host=w.document.querySelector('main');w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 vm.runInContext(fs.readFileSync(path.join(root,'dist/chapter.js'),'utf8'),dom.getInternalVMContext());
 try{for(const c of courses.filter(c=>c.contentVersion===2)){const state={tasks:{},results:{},drafts:{},read:{}},api=w.StudyChapters.render(host,{lesson:lessons.find(l=>l.id===c.id),course:c,state});
  for(let i=0;i<c.missions.length;i++){api.showMission(i);assert.ok(host.querySelector('.ch-item-card'),c.missions[i].id);assert.equal(host.querySelector('.ch-reference-answer'),null,c.missions[i].id);assert.equal(host.querySelector('img'),null,c.missions[i].id);assert.equal(host.querySelector('#ch-open-answer'),null,c.missions[i].id)}api.destroy();
 }}finally{w.close()}
});
