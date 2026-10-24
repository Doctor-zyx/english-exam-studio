const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const vm=require('node:vm');
const dist=path.resolve(__dirname,'../dist');
const pause=()=>new Promise(r=>setTimeout(r,15));

async function app(){
  const failures=[];
  const vc=new VirtualConsole();vc.on('jsdomError',e=>failures.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(dist,'index.html'),'utf8'),{url:'http://localhost/english-exam-studio/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.scrollTo=()=>{};w.confirm=()=>true;
  w.speechSynthesis={cancel(){},speaking:false,getVoices(){return []}};
  w.HTMLMediaElement.prototype.pause=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.StudyFX={enabled:true,setEnabled(v){this.enabled=v},isEnabled(){return this.enabled},celebrate(){}};
  w.fetch=async url=>{const f=path.resolve(dist,String(url).replace(/^\.\//,''));assert.ok(f.startsWith(dist+path.sep));const buffer=fs.readFileSync(f);return{ok:true,json:async()=>JSON.parse(buffer.toString('utf8')),text:async()=>buffer.toString('utf8')}};
  for(const file of ['config.js','cloud.js','auth-ui.js','app.js'])vm.runInContext(fs.readFileSync(path.join(dist,file),'utf8'),dom.getInternalVMContext(),{filename:file});
  for(let i=0;i<30&&!w.document.querySelector('.hero');i++)await pause();
  assert.ok(w.document.querySelector('.hero'),'dashboard booted');
  const q=s=>w.document.querySelector(s);
  const route=async name=>{w.location.hash=name;await pause()};
  const input=(selector,value)=>{const el=q(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el};
  return{dom,w,q,route,input,failures,close:()=>{w.StudyCloud.destroy();w.close()}};
}

test('public app boots under a repository path, truthfully reports unconfigured auth, and persists guest tasks',async()=>{
  const a=await app();try{
    assert.match(a.q('h1').textContent,/欢迎回到轨道/);
    assert.match(a.q('#save-state').textContent,/未配置|未启用|游客|本机/);
    const task=a.q('[data-task]');task.checked=true;task.dispatchEvent(new a.w.Event('change'));
    assert.match(a.q('#sidebar-level').textContent,/LV\. 01/);
    assert.equal(a.q('.orbit-value').textContent,'30');
    await a.route('account');assert.ok(a.q('#auth-submit').disabled);
    assert.match(a.q('#main').textContent,/账号服务尚未启用/);
    assert.equal(a.w.StudyCloud.getStatus().user,null);
    assert.ok(a.w.localStorage.length>0);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('listening retains per-blank scoring, decimal accuracy, edited-answer notice and mistake collection',async()=>{
  const a=await app();try{
    await a.route('listening');assert.equal(a.w.document.querySelectorAll('[data-blank]').length,15);
    a.input('#blank-u1-q1','THE MOST POWERFUL ATLANTIC HURRICANES.');a.q('#submit-listening').click();
    assert.match(a.q('#listen-score').textContent,/1 \/ 15/);
    a.input('#blank-u1-q1','wrong');assert.match(a.q('#listen-score').textContent,/重新提交/);
    await a.route('mistakes');assert.equal(a.w.document.querySelectorAll('[data-resolved]').length,14);
    assert.equal(a.w.eval("normalize('10.6 million')===normalize('106 million')"),false);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('writing, vocabulary, effects and library remain usable in redesigned UI',async()=>{
  const a=await app();try{
    await a.route('writing');assert.equal(a.w.document.querySelectorAll('[data-lesson]').length,11);
    a.input('#essay-draft','This is my original paragraph.');assert.equal(a.q('#essay-count').textContent,'5 words');
    a.q('[data-lesson]').click();a.input('#exercise-0','Because the library was closed, we studied at home.');a.q('[data-checkexercise]').click();assert.match(a.q('#exercise-feedback-0').textContent,/一致/);
    a.q('#full-lesson').click();await pause();assert.match(a.q('#reader-body').textContent,/Sentence skills精华/);a.q('#reader-close').click();
    await a.route('vocabulary');a.q('#flash').click();a.q('#word-known').click();assert.match(a.q('.status-row').textContent,/2 \/ 20/);
    a.input('#vocab-search','academic');assert.match(a.q('#word-results').textContent,/找到 1 个词条/);
    await a.route('settings');const fx=a.q('#particles-enabled');fx.checked=false;fx.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.StudyFX.enabled,false);
    await a.route('library');assert.ok(a.w.document.querySelectorAll('[data-read]').length>=20);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('mock exam keeps ten answer fields, timer, partial scores and immutable submitted answers',async()=>{
  const a=await app();try{
    await a.route('mocks');a.q('[data-mock]').click();assert.equal(a.w.document.querySelectorAll('.mock-listening-passage input').length,10);
    a.q('#start-mock').click();a.input('#mockq-A-L1-1','twelve percent');a.q('#submit-mock').click();
    assert.match(a.q('.feedback').textContent,/1 \/ 5/);assert.equal(a.q('#mockq-A-L1-1').readOnly,true);
    a.q('#mock-back').click();await pause();assert.ok(a.q('[data-mock]'));
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('auth recovery form, conflict cells and account headers show user content without internal metadata',async()=>{
  const a=await app();try{
    await a.route('account');
    a.w.AccountUI.onStatus({configured:true,user:{id:'test',email:'student@example.com'},status:'recovery',recovery:true,message:'设置密码'});
    assert.ok(a.q('#auth-password'));assert.equal(a.q('#auth-email'),null);assert.match(a.q('#auth-submit').textContent,/更新密码/);
    a.w.StudyCloud.getConflicts=()=>[{path:'["essays","draft"]',local:{stamp:'INTERNAL-STAMP-1',value:'My local essay.',deleted:false},remote:{stamp:'INTERNAL-STAMP-2',value:'My cloud essay.',deleted:false}}];
    a.w.AccountUI.onStatus({configured:true,user:{id:'test',email:'student@example.com'},status:'conflict',recovery:false,message:'有冲突',lastSyncAt:'2026-10-24T12:00:00Z'});
    assert.match(a.q('.conflict-card').textContent,/My local essay/);assert.doesNotMatch(a.q('.conflict-card').textContent,/INTERNAL-STAMP/);assert.match(a.q('.conflict-card h3').textContent,/作文/);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('auth sign-out immediately replaces the account profile with the guest form',async()=>{
  const a=await app();try{
    await a.route('account');
    a.w.AccountUI.onStatus({configured:true,user:{id:'a',email:'a@example.com'},status:'synced',message:'已同步'});
    a.w.StudyCloud.signOut=async()=>{const s={configured:true,user:null,status:'guest',recovery:false};a.w.AccountUI.onStatus(s);return s};
    a.q('#sign-out').click();await pause();
    assert.ok(a.q('#auth-form'));assert.equal(a.q('#sign-out'),null);assert.equal(a.q('.account-avatar'),null);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('password recovery success remains visible after the profile and sync-status rerender',async()=>{
  const a=await app();try{
    await a.route('account');const user={id:'a',email:'a@example.com'};
    a.w.AccountUI.onStatus({configured:true,user,status:'recovery',recovery:true});
    a.w.StudyCloud.updatePassword=async()=>{const s={configured:true,user,status:'password-updated',recovery:false};a.w.AccountUI.onStatus(s);return s};
    a.input('#auth-password','newpassword1');a.input('#auth-confirm','newpassword1');
    a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.ok(a.q('#sign-out'));assert.equal(a.q('#auth-message').hidden,false);assert.match(a.q('#auth-message').textContent,/密码已更新/);
    a.w.AccountUI.onStatus({configured:true,user,status:'synced',recovery:false,message:'已同步'});
    assert.match(a.q('#auth-message').textContent,/密码已更新/);assert.doesNotMatch(a.q('#auth-message').textContent,/请使用新密码登录/);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('signup confirmation persists and in-flight auth cannot switch tabs or submit twice',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({configured:true,user:null,status:'guest'});
    a.q('[data-auth-mode="signup"]').click();a.input('#auth-email','new@example.com');a.input('#auth-password','password1');a.input('#auth-confirm','password1');
    let finish,calls=0;a.w.StudyCloud.signUp=()=>{calls++;return new Promise(resolve=>{finish=resolve})};
    const form=a.q('#auth-form');form.dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(a.q('[data-auth-mode="signin"]').disabled,true);form.dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls,1);
    a.w.AccountUI.onStatus({configured:true,user:null,status:'confirm-email'});finish({user:null});await pause();
    assert.equal(a.q('#auth-message').hidden,false);assert.match(a.q('#auth-message').textContent,/确认链接/);assert.equal(a.q('#auth-submit').disabled,false);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('signup with an immediate session enters the app instead of falsely asking for confirmation',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({configured:true,user:null,status:'guest'});
    a.q('[data-auth-mode="signup"]').click();a.input('#auth-email','new@example.com');a.input('#auth-password','password1');a.input('#auth-confirm','password1');
    a.w.StudyCloud.signUp=async()=>{const s={configured:true,user:{id:'new',email:'new@example.com'},status:'synced'};a.w.AccountUI.onStatus(s);return s};
    a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.equal(a.w.location.hash,'#home');assert.match(a.q('#toast').textContent,/账号已创建并登录/);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});
