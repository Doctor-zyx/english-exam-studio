const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../dist/chapter.js'),'utf8');

const makeLesson=()=>({id:'sentences',title:'句子结构',subtitle:'先理解，再运用。',rules:[
  {title:'完整句',explanation:'句子表达完整意思。',example:'The child laughed.'},
  {title:'并列结构',explanation:'并列部分结构一致。',before:'I like reading and to swim.',after:'I like reading and swimming.'}
]});
const makeCourse=()=>({id:'sentence-book',sourceTitle:'Sentence book',sourcePdf:'source.pdf',answerTitle:'Teacher key',answerPdf:'answer.pdf',coverageNote:'扫描页可能包含原有批注。',missions:[
  {id:'objective',title:'识别句子',sourcePages:[{src:'one.webp',page:1,label:'原书第 1 页'},{src:'two.webp',page:2,label:'原书第 2 页'}],answerPages:[{src:'key.webp',page:1,label:'答案第 1 页'}],items:[
    {id:'q1',prompt:'Choose the complete sentence.',options:[{value:'a',label:'She smiled.'},{value:'b',label:'Because she smiled.'}],answer:'a',explanation:'The first sentence is complete.'},
    {id:'q2',prompt:'Choose the fragment.',options:[{value:'a',label:'They left.'},{value:'b',label:'After they left.'}],answer:'b'}
  ]},
  {id:'open',title:'改写句子',sourcePages:[{src:'open.webp',page:3,label:'原书第 3 页'}],answerPages:[{src:'open-key.webp',page:2,label:'答案第 2 页'}],answerNote:'合理的不同表达也可成立。'}
]});
function setup(overrides={}){
  const dom=new JSDOM('<main id="host"></main>',{url:'http://localhost/course/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,host=w.document.getElementById('host');
  w.confirm=()=>true;
  w.HTMLElement.prototype.scrollIntoView=function(){this.dataset.scrolled='true'};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  vm.runInContext(script,dom.getInternalVMContext());
  const state=overrides.state||{tasks:{},drafts:{},results:{},read:{}};
  let awards=0,saves=0,activities=0;
  const opts={lesson:makeLesson(),course:makeCourse(),state,save(activity){saves++;if(activity)activities++},reward(){awards++},...overrides};
  let api=w.StudyChapters.render(host,opts);
  const q=s=>host.querySelector(s);
  const click=(action,more='')=>{const el=q(`[data-ch-action="${action}"]${more}`);assert.ok(el,action+more);el.click();return el};
  const input=(selector,value)=>{const el=q(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el};
  const option=value=>{const el=q(`[data-ch-input="option"][value="${value}"]`);assert.ok(el);el.checked=true;el.dispatchEvent(new w.Event('change',{bubbles:true}));return el};
  return {dom,w,host,q,click,input,option,state,opts,get awards(){return awards},get saves(){return saves},get activities(){return activities},rerender(){api=w.StudyChapters.render(host,opts)},close(){api.destroy();w.close()}};
}

test('new learning steps do not inherit old completion; step rewards are issued once',()=>{
  const state={tasks:{},drafts:{},results:{},read:{sentences:true}},a=setup({state});
  try{
    assert.equal(state.read.sentences,false);assert.ok(a.q('.ch-launch'));assert.equal(a.q('img[src]'),null);
    assert.match(a.q('.ch-source-note').textContent,/原有批注/);
    a.click('learn-tab');assert.match(a.q('.ch-learn-card h2').textContent,/完整句/);
    a.click('learn-next');assert.equal(a.awards,1);assert.equal(state.read.sentences,false);
    a.rerender();assert.ok(a.q('.ch-launch'));a.click('learn-tab');assert.match(a.q('.ch-learn-card h2').textContent,/并列结构/);
    a.click('learn-next');assert.equal(a.awards,2);assert.equal(state.read.sentences,true);assert.ok(a.q('.ch-practice-layout'));
    a.click('learn-tab');a.click('learn-next');assert.equal(a.awards,2);
    assert.ok(Object.values(state.drafts).every(v=>typeof v==='string'));
    assert.deepEqual(Object.keys(state).sort(),['drafts','read','results','tasks']);
  }finally{a.close()}
});

test('objective mission grades each item, locks PDF until submission and does not repeat XP',()=>{
  const a=setup();try{
    a.click('practice-tab');assert.equal(a.q('a[href="answer.pdf"]'),null);assert.equal(a.q('.ch-reference-answer'),null);
    assert.equal(a.q('[data-ch-action="check-item"]').disabled,true);
    a.option('a');a.click('check-item');assert.match(a.q('.ch-item-feedback').textContent,/回答正确/);assert.equal(a.q('a[href="answer.pdf"]'),null);
    a.click('next-item');a.option('a');a.click('check-item');
    const r=a.state.results['book:sentence-book:objective'];assert.equal(r.score,1);assert.equal(r.total,2);assert.equal(r.selfAssessed,false);assert.equal(r.reviewNeed,true);assert.equal(r.status,'complete');
    assert.equal(a.state.tasks['book:sentence-book:objective'],true);assert.equal(a.awards,1);assert.ok(a.q('a[href="answer.pdf"]'));
    a.click('retry');assert.equal(a.q('a[href="answer.pdf"]'),null);assert.equal(a.state.tasks['book:sentence-book:objective'],true);
    a.option('a');a.click('check-item');a.click('next-item');a.option('b');a.click('check-item');assert.equal(a.awards,1);assert.equal(a.state.results['book:sentence-book:objective'].attempt,2);
  }finally{a.close()}
});

test('open response requires writing and explicit self assessment',()=>{
  const a=setup();try{
    a.click('mission','[data-index="1"]');assert.match(a.q('.ch-answer-note').textContent,/不同表达/);
    a.click('submit-open');assert.equal(a.state.results['book:sentence-book:open'],undefined);
    a.input('#ch-open-answer','1. My rewritten sentence.');a.click('submit-open');
    assert.ok(a.q('a[href="answer.pdf"]'));assert.equal(a.state.tasks['book:sentence-book:open'],undefined);assert.match(a.q('.ch-open-response').textContent,/没有自动批改/);
    a.click('self-mission','[data-choice="review"]');
    const r=a.state.results['book:sentence-book:open'];assert.equal(r.selfAssessed,true);assert.equal(r.reviewNeed,true);assert.equal(r.score,0);assert.equal(r.total,1);assert.equal(a.awards,1);
    a.click('review-toggle');assert.equal(r.reviewNeed,false);assert.equal(a.awards,1);
  }finally{a.close()}
});

test('partial items cannot finish the group without remaining response and self review',()=>{
  const course=makeCourse();course.missions[0].itemsPartial=true;
  const a=setup({course});try{
    a.click('practice-tab');assert.ok(a.q('.ch-open-response'));assert.match(a.q('.ch-source-note').textContent,/只覆盖/);
    a.input('#ch-open-answer','Remaining original items: 3. ...');assert.equal(a.q('[data-ch-action="submit-open"]').disabled,true);
    a.option('a');a.click('check-item');a.click('next-item');a.option('b');a.click('check-item');
    let r=a.state.results['book:sentence-book:objective'];assert.equal(r.itemsSubmitted,true);assert.equal(r.submitted,false);assert.equal(r.status,'in-progress');assert.equal(a.awards,0);assert.equal(a.q('a[href="answer.pdf"]'),null);
    assert.match(a.q('[data-ch-action="next-item"]').textContent,/整组/);a.click('next-item');assert.equal(a.q('.ch-open-response').dataset.scrolled,'true');
    a.click('submit-open');assert.ok(a.q('a[href="answer.pdf"]'));assert.equal(a.awards,0);
    a.click('self-mission','[data-choice="mastered"]');r=a.state.results['book:sentence-book:objective'];assert.equal(r.score,3);assert.equal(r.total,3);assert.equal(r.automaticScore,2);assert.equal(r.selfScore,1);assert.equal(r.selfAssessed,true);assert.equal(r.status,'complete');assert.equal(a.awards,1);
  }finally{a.close()}
});

test('page preview loads only current source image; zoom pages can navigate',()=>{
  const a=setup();try{
    a.click('practice-tab');assert.equal(a.host.querySelectorAll('.ch-page-viewer img').length,1);assert.equal(a.q('.ch-page-image img').getAttribute('src'),'one.webp');assert.equal(a.q('.ch-page-image img').getAttribute('loading'),'lazy');
    a.click('page-next','[data-kind="source"]');assert.equal(a.q('.ch-page-image img').getAttribute('src'),'two.webp');assert.equal(a.host.querySelectorAll('.ch-page-viewer img').length,1);
    a.click('zoom','[data-kind="source"]');assert.equal(a.q('#ch-zoom').open,true);assert.equal(a.q('#ch-zoom-image').getAttribute('src'),'two.webp');
    a.click('zoom-prev');assert.equal(a.q('#ch-zoom-image').getAttribute('src'),'one.webp');a.click('zoom-close');assert.equal(a.q('#ch-zoom').open,false);
  }finally{a.close()}
});

test('supplementary topics have no original practice and source text is escaped',()=>{
  const lesson=makeLesson();lesson.title='<script>alert(1)</script>';const a=setup({course:null,lesson});try{
    assert.equal(a.q('[data-ch-action="practice-tab"]'),null);assert.match(a.q('.ch-launch').textContent,/没有已核对的原书/);assert.equal(a.q('script'),null);
    a.click('learn-tab');a.click('learn-next');a.click('learn-next');assert.equal(a.state.read.sentences,true);assert.ok(a.q('.ch-launch'));assert.equal(a.awards,2);
  }finally{a.close()}
});

test('selected answers and current source page resume after remounting',()=>{
  const a=setup();try{
    a.click('practice-tab');a.option('b');a.click('page-next','[data-kind="source"]');a.rerender();a.click('practice-tab');
    assert.equal(a.q('[data-ch-input="option"][value="b"]').checked,true);assert.equal(a.q('.ch-page-image img').getAttribute('src'),'two.webp');
    assert.ok(a.saves>0);assert.equal(a.activities,0);
  }finally{a.close()}
});

test('course-level partial mode still needs nonempty full response, preserves mistakes and never repeats rewards',()=>{
  const course=makeCourse();course.itemsPartial=true;
  const a=setup({course});try{
    const key='book:sentence-book:objective';
    a.click('practice-tab');a.option('a');a.click('check-item');a.click('next-item');a.option('a');a.click('check-item');
    assert.equal(a.q('[data-ch-action="submit-open"]').disabled,true);assert.equal(a.q('[data-ch-action="self-mission"]'),null);assert.equal(a.state.tasks[key],undefined);
    a.input('#ch-open-answer','   ');assert.equal(a.q('[data-ch-action="submit-open"]').disabled,true);
    a.input('#ch-open-answer','3. Remaining original answer.');a.click('submit-open');a.rerender();a.click('practice-tab');
    assert.equal(a.state.results[key].status,'submitted');assert.equal(a.q('#ch-open-answer').readOnly,true);assert.equal(a.state.tasks[key],undefined);
    a.click('self-mission','[data-choice="mastered"]');
    assert.equal(a.state.results[key].automaticScore,1);assert.equal(a.state.results[key].selfScore,1);assert.equal(a.state.results[key].reviewNeed,true);assert.equal(a.awards,1);
    a.click('retry');assert.equal(a.q('#ch-open-answer').value,'');assert.equal(a.q('a[href="answer.pdf"]'),null);assert.equal(a.state.tasks[key],true);
    a.option('a');a.click('check-item');a.click('next-item');a.option('b');a.click('check-item');a.input('#ch-open-answer','3. Another attempt.');a.click('submit-open');a.click('self-mission','[data-choice="mastered"]');
    assert.equal(a.state.results[key].reviewNeed,false);assert.equal(a.state.results[key].score,3);assert.equal(a.awards,1);
  }finally{a.close()}
});

test('editing a completed partial item relocks full answers and requires fresh group assessment',()=>{
  const course=makeCourse();course.missions[0].itemsPartial=true;
  const a=setup({course});try{
    const key='book:sentence-book:objective';
    a.click('practice-tab');a.option('a');a.click('check-item');a.click('next-item');a.option('b');a.click('check-item');a.input('#ch-open-answer','3. Full group answer.');a.click('submit-open');a.click('self-mission','[data-choice="mastered"]');
    assert.equal(a.awards,1);a.click('edit-item');assert.equal(a.state.results[key].status,'in-progress');assert.equal(a.q('a[href="answer.pdf"]'),null);
    a.option('b');a.click('check-item');assert.equal(a.state.results[key].status,'in-progress');assert.equal(a.q('a[href="answer.pdf"]'),null);
    a.click('submit-open');assert.equal(a.state.results[key].status,'submitted');assert.equal(a.state.results[key].groupAssessed,false);
    a.click('self-mission','[data-choice="review"]');assert.equal(a.state.results[key].reviewNeed,true);assert.equal(a.state.results[key].score,2);assert.equal(a.awards,1);
  }finally{a.close()}
});
