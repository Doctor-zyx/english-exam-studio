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
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.speechSynthesis={cancel(){},speaking:false,getVoices(){return []}};
  w.HTMLMediaElement.prototype.pause=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.StudyFX={enabled:true,setEnabled(v){this.enabled=v},isEnabled(){return this.enabled},celebrate(){}};
  w.fetch=async url=>{const f=path.resolve(dist,String(url).replace(/^\.\//,''));assert.ok(f.startsWith(dist+path.sep));const buffer=fs.readFileSync(f);return{ok:true,json:async()=>JSON.parse(buffer.toString('utf8')),text:async()=>buffer.toString('utf8')}};
  // Deterministic compatibility fixture: production settings and keys are not test inputs.
  w.STUDY_CLOUD_CONFIG={};
  for(const file of ['cloud.js','auth-ui.js','journey.js','listening-flow.js','chapter.js','app.js'])vm.runInContext(fs.readFileSync(path.join(dist,file),'utf8'),dom.getInternalVMContext(),{filename:file});
  for(let i=0;i<30&&!w.document.querySelector('.hero');i++)await pause();
  assert.ok(w.document.querySelector('.hero'),'dashboard booted');
  const q=s=>w.document.querySelector(s);
  const route=async name=>{w.location.hash=name;await pause()};
  const input=(selector,value)=>{const el=q(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el};
  return{dom,w,q,route,input,failures,close:()=>{w.StudyCloud.destroy();w.close()}};
}

test('public app prioritizes textbook practice, reports unconfigured auth, and persists guest work',async()=>{
  const a=await app();try{
    assert.match(a.q('h1').textContent,/今天再闯一关/);
    assert.match(a.q('#save-state').textContent,/未配置|未启用|游客|本机/);
    assert.equal(a.w.document.querySelectorAll('.preview-map .course-node').length,3);
    assert.equal(a.q('#nav a[href="#vocabulary"]'),null);
    assert.equal(a.q('#nav a[href="#mocks"]'),null);
    await a.route('freewriting');a.input('#essay-draft','Guest progress is saved.');
    assert.match(a.q('#sidebar-level').textContent,/LV\. 01/);
    await a.route('account');assert.ok(a.q('#auth-submit').disabled);
    assert.match(a.q('#main').textContent,/账号服务尚未启用/);
    assert.equal(a.w.StudyCloud.getStatus().user,null);
    assert.ok(a.w.localStorage.length>0);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('listening separates the learning guide and checks only the current report',async()=>{
  const a=await app();try{
    await a.route('listening');assert.equal(a.w.document.querySelectorAll('[data-blank]').length,0);
    a.q('#enter-listening').click();assert.equal(a.w.document.querySelectorAll('.listening-passage:not([hidden])').length,1);
    assert.equal(a.w.document.querySelectorAll('.listening-passage:not([hidden]) [data-blank]').length,3);
    a.q('#submit-listening').click();assert.doesNotMatch(a.q('#listen-score').textContent,/参考答案/);
    a.input('#blank-u1-q1','THE MOST POWERFUL ATLANTIC HURRICANES.');a.q('#submit-listening').click();
    assert.match(a.q('#listen-score').textContent,/1 \/ 3/);
    a.input('#blank-u1-q1','wrong');assert.match(a.q('#listen-score').textContent,/重新提交/);
    a.q('#listen-next').click();assert.equal(a.w.document.querySelectorAll('.listening-passage:not([hidden]) [data-blank]').length,2);
    a.q('#listen-previous').click();assert.equal(a.q('#blank-u1-q1').value,'wrong');
    await a.route('mistakes');assert.equal(a.w.document.querySelectorAll('[data-resolved]').length,2);
    assert.equal(a.w.eval("normalize('10.6 million')===normalize('106 million')"),false);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('chapter map separates eight core books from optional tools and preserves drafts',async()=>{
  const a=await app();try{
    await a.route('writing');assert.equal(a.w.document.querySelectorAll('.course-node').length,8);
    assert.equal(a.w.document.querySelectorAll('.supplement-list [data-course]').length,3);
    a.q('[data-course="sentence"]').click();assert.match(a.q('#main').textContent,/Sentence skills/);
    assert.equal(a.q('[data-exercise]'),null);
    await a.route('freewriting');
    a.input('#essay-draft','This is my original paragraph.');assert.equal(a.q('#essay-count').textContent,'5 words');
    await a.route('tools');assert.match(a.q('#main').textContent,/非独立考项/);assert.match(a.q('#main').textContent,/不是教材原题/);
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

test('chapter map links return to the catalog after visiting an individual chapter',async()=>{
  const a=await app();try{
    a.q('[data-course="sentence"]').click();await pause();assert.ok(a.q('.ch-console'));
    await a.route('home');a.q('[data-go="writing"]').click();await pause();
    assert.equal(a.q('.ch-console'),null);assert.equal(a.w.document.querySelectorAll('.course-map .course-node').length,8);
    a.q('[data-course="paragraph"]').click();await pause();assert.ok(a.q('.ch-console'));
    a.q('#nav a[href="#writing"]').click();await pause();
    assert.equal(a.q('.ch-console'),null);assert.equal(a.w.document.querySelectorAll('.course-map .course-node').length,8);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('textbook self-review is listed centrally and opens the exact original mission',async()=>{
  const a=await app();try{
    await a.route('writing');a.q('[data-course="paragraph"]').click();
    a.q('[data-ch-action="mission"][data-index="1"]').click();
    a.input('#ch-open-answer','1. My attempt at the original textbook exercise.');
    a.q('[data-ch-action="submit-open"]').click();
    a.q('[data-ch-action="self-mission"][data-choice="review"]').click();
    await a.route('home');assert.match(a.q('.review-portal').textContent,/1 组原题待复习/);
    await a.route('mistakes');const button=a.q('[data-review-course="paragraph"]');assert.ok(button);
    const expected=button.dataset.reviewMission;button.click();await pause();
    assert.ok(a.q('#ch-open-answer'));assert.match(a.q('#ch-open-answer').value,/My attempt/);
    assert.equal(a.w.eval("JSON.parse(S.drafts['chapter:paragraph:position']).missionIndex"),1);
    assert.equal(expected,a.w.eval('D.courses.find(c=>c.id==="paragraph").missions[1].id'));
    a.q('[data-ch-action="review-toggle"]').click();await a.route('mistakes');
    assert.equal(a.q('[data-review-course]'),null);assert.match(a.q('#main').textContent,/暂时没有待复习/);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('GitHub account mode hides email signup and unavailable provider offers retry plus guest study',async()=>{
  const a=await app();try{
    await a.route('account');const disabled={configured:true,authProvider:'github',oauthReady:false,oauthChecking:false,oauthMessage:'GitHub 登录待配置。',user:null,status:'oauth-unavailable'};
    a.w.AccountUI.onStatus(disabled);
    assert.equal(a.q('#auth-email'),null);assert.equal(a.q('#auth-form'),null);assert.equal(a.q('[data-auth-mode="signup"]'),null);
    assert.equal(a.q('#auth-github').disabled,true);assert.match(a.q('.account-panel').textContent,/登录待配置/);assert.ok(a.q('[data-go="home"]'));
    let retries=0;a.w.StudyCloud.refreshAuthSettings=async()=>{retries++;const s={...disabled,oauthReady:null,oauthMessage:'未能确认 GitHub 登录服务。',status:'oauth-unknown'};a.w.AccountUI.onStatus(s);return s};
    a.q('#auth-retry').click();await pause();assert.equal(retries,1);assert.match(a.q('.account-panel').textContent,/未能确认/);assert.equal(a.q('#auth-github').disabled,true);assert.equal(a.q('#auth-retry').disabled,false);
    a.w.AccountUI.onStatus({...disabled,oauthReady:true,oauthMessage:'GitHub 登录已启用。',status:'guest'});assert.equal(a.q('#auth-github').disabled,false);assert.equal(a.q('#auth-email'),null);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('GitHub sign-in calls OAuth once while checking and pending redirect never pretends to be signed in',async()=>{
  const a=await app();try{
    await a.route('account');const ready={configured:true,authProvider:'github',oauthReady:true,oauthChecking:false,oauthMessage:'GitHub 登录已启用。',user:null,status:'guest'};
    a.w.AccountUI.onStatus(ready);let finish,calls=0;
    a.w.StudyCloud.signInWithGitHub=()=>{calls++;return new Promise(resolve=>{finish=resolve})};
    a.q('#auth-github').click();assert.equal(a.q('#auth-github').disabled,true);assert.equal(a.q('#auth-retry').disabled,true);a.q('#auth-github').click();assert.equal(calls,1);
    a.w.AccountUI.onStatus({...ready,oauthChecking:true,oauthReady:null});a.w.AccountUI.onStatus({...ready,status:'oauth-redirect'});finish({user:null});await pause();
    assert.match(a.q('#auth-message').textContent,/GitHub/);assert.equal(a.q('#sign-out'),null);assert.equal(a.q('#auth-github').disabled,true);assert.equal(a.w.location.hash,'#account');
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('GitHub provider probe errors leave signed-in account sync controls intact',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({configured:true,authProvider:'github',oauthReady:null,oauthChecking:false,oauthMessage:'未能确认登录服务',user:{id:'github-user',email:'learner@example.com'},status:'synced',message:'已同步'});
    assert.ok(a.q('#sync-now'));assert.ok(a.q('#sign-out'));assert.equal(a.q('#auth-github'),null);assert.match(a.q('.account-panel').textContent,/已同步/);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

const instantStatus={configured:true,authProvider:'email',emailSignupMode:'instant',passwordRecoveryEnabled:false,emailSignupReady:false,emailSignupChecking:false,emailSignupMessage:'注册即将开放，管理员完成一次设置后即可使用。',user:null,status:'signup-unavailable'};

test('instant email UI keeps login enabled, blocks pending signup, hides password recovery and rechecks settings',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus(instantStatus);
    assert.ok(a.q('#auth-email'));assert.equal(a.q('#auth-github'),null);assert.equal(a.q('[data-auth-mode="reset"]'),null);assert.equal(a.q('#auth-submit').disabled,false);assert.match(a.q('.account-panel').textContent,/暂不支持邮件找回密码/);
    a.q('[data-auth-mode="signup"]').click();assert.equal(a.q('#auth-submit').disabled,true);assert.match(a.q('#email-signup-state').textContent,/管理员完成一次设置/);
    a.input('#auth-email','learner@example.com');a.input('#auth-password','password1');a.input('#auth-confirm','password1');
    let retries=0;a.w.StudyCloud.refreshAuthSettings=async()=>{retries++;const s={...instantStatus,emailSignupReady:null,emailSignupMessage:'未能确认注册设置',status:'signup-unknown'};a.w.AccountUI.onStatus(s);return s};
    a.q('#auth-retry').click();await pause();assert.equal(retries,1);assert.equal(a.q('#auth-submit').disabled,true);assert.match(a.q('#email-signup-state').textContent,/未能确认/);assert.equal(a.q('#auth-email').value,'learner@example.com');assert.equal(a.q('#auth-password').value,'password1');
    a.w.AccountUI.onStatus({...instantStatus,emailSignupReady:true,emailSignupMessage:'可以直接注册，无需验证邮件。',status:'guest'});assert.equal(a.q('#auth-submit').disabled,false);assert.equal(a.q('#auth-email').value,'learner@example.com');assert.equal(a.q('#auth-confirm').value,'password1');assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('instant email signup requires an actual session and never presents false email delivery',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({...instantStatus,emailSignupReady:true,emailSignupMessage:'直接注册已开放',status:'guest'});a.q('[data-auth-mode="signup"]').click();
    a.input('#auth-email','new@example.com');a.input('#auth-password','password1');a.input('#auth-confirm','password1');
    a.w.StudyCloud.signUp=async()=>({user:null});a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.match(a.q('#auth-message').textContent,/未完成直接注册/);assert.doesNotMatch(a.q('#auth-message').textContent,/确认链接|查收|已发/);assert.equal(a.w.location.hash,'#account');
    a.w.StudyCloud.signUp=async()=>{const s={...instantStatus,emailSignupReady:true,user:{id:'new',email:'new@example.com'},status:'synced'};a.w.AccountUI.onStatus(s);return s};a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.equal(a.w.location.hash,'#home');assert.match(a.q('#toast').textContent,/账号已创建并登录/);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('turning off email recovery closes an old reset form but preserves genuine recovery sessions',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({configured:true,user:null,status:'guest'});a.q('[data-auth-mode="reset"]').click();assert.match(a.q('#auth-submit').textContent,/发送重置邮件/);
    a.w.AccountUI.onStatus(instantStatus);assert.equal(a.q('[data-auth-mode="reset"]'),null);assert.ok(a.q('#auth-password'));assert.match(a.q('#auth-submit').textContent,/登录我的空间/);
    a.w.AccountUI.onStatus({...instantStatus,user:{id:'a',email:'a@example.com'},recovery:true,status:'recovery'});assert.equal(a.q('#auth-email'),null);assert.ok(a.q('#auth-confirm'));assert.match(a.q('#auth-submit').textContent,/更新密码/);assert.equal(a.q('#auth-submit').disabled,false);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

const otpStatus={configured:true,authProvider:'email',emailSignupMode:'otp',passwordRecoveryEnabled:true,emailDeliveryReady:true,emailSignupReady:true,emailSignupChecking:false,emailSignupMessage:'注册后请填写邮件验证码。',user:null,status:'guest'};

test('OTP UI truthfully gates unconfigured mail while allowing existing password login',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({...otpStatus,emailDeliveryReady:false,emailSignupReady:false});assert.equal(a.q('#auth-submit').disabled,false);assert.equal(a.q('#auth-github'),null);assert.match(a.q('.account-panel').textContent,/验证码邮件服务待配置/);
    a.q('[data-auth-mode="signup"]').click();assert.equal(a.q('#auth-submit').disabled,true);assert.match(a.q('#auth-submit').textContent,/发送验证码/);
    a.q('[data-auth-mode="reset"]').click();assert.equal(a.q('#auth-submit').disabled,true);assert.match(a.q('#auth-submit').textContent,/找回验证码/);assert.equal(a.q('#auth-password'),null);
    assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('OTP signup clears passwords, validates one code and blocks duplicate verification',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus(otpStatus);a.q('[data-auth-mode="signup"]').click();a.input('#auth-email','new@example.com');a.input('#auth-password','private-password1');a.input('#auth-confirm','private-password1');
    a.w.StudyCloud.signUp=async()=>({...otpStatus,status:'signup-code-sent'});a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.ok(a.q('#otp-form'));assert.equal(a.q('#auth-password'),null);assert.equal(a.q('#sign-out'),null);assert.equal(a.w.location.hash,'#account');assert.equal(a.q('#otp-resend').disabled,true);assert.match(a.q('#otp-resend').textContent,/秒后/);assert.doesNotMatch(a.q('#main').innerHTML,/private-password1/);
    a.w.StudyCloud.verifySignup=async()=>{throw new Error('Token has expired or is invalid')};a.input('#auth-otp','123456');a.q('#otp-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();assert.ok(a.q('#otp-form'));assert.match(a.q('#auth-message').textContent,/验证码无效或已过期/);assert.equal(a.q('#otp-submit').disabled,false);
    let finish,calls=0;a.w.StudyCloud.verifySignup=(email,token)=>{calls++;assert.equal(email,'new@example.com');assert.equal(token,'12345678');return new Promise(resolve=>{finish=resolve})};
    a.input('#auth-otp','123');a.q('#otp-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls,0);
    a.input('#auth-otp','12345678');const form=a.q('#otp-form');form.dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(calls,1);assert.equal(a.q('#auth-otp').value,'');assert.equal(a.q('#otp-back').disabled,true);
    const success={...otpStatus,user:{id:'new',email:'new@example.com'},status:'synced'};a.w.AccountUI.onStatus(success);finish(success);await pause();assert.equal(a.w.location.hash,'#home');assert.match(a.q('#toast').textContent,/邮箱验证成功/);assert.doesNotMatch(JSON.stringify(a.w.localStorage),/private-password1|12345678/);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('OTP recovery supports resend countdown, verification and setting a new password',async()=>{
  const a=await app();try{
    let now=100000;a.w.Date.now=()=>now;await a.route('account');a.w.AccountUI.onStatus(otpStatus);a.q('[data-auth-mode="reset"]').click();a.input('#auth-email','learner@example.com');
    let sends=0;a.w.StudyCloud.resetPassword=async()=>{sends++;return{...otpStatus,status:'recovery-code-sent'}};a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();assert.equal(sends,1);assert.ok(a.q('#otp-form'));assert.equal(a.q('#otp-resend').disabled,true);
    a.q('#otp-resend').click();assert.equal(sends,1);now+=61000;a.w.eval('account()');assert.equal(a.q('#otp-resend').disabled,false);a.q('#otp-resend').click();await pause();assert.equal(sends,2);assert.equal(a.q('#otp-resend').disabled,true);
    a.w.StudyCloud.verifyRecovery=async(email,token)=>{assert.equal(email,'learner@example.com');assert.equal(token,'123456');const s={...otpStatus,user:{id:'learner',email},recovery:true,status:'recovery'};a.w.AccountUI.onStatus(s);return s};a.input('#auth-otp','123456');a.q('#otp-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.equal(a.q('#otp-form'),null);assert.ok(a.q('#auth-password'));assert.equal(a.q('#auth-email'),null);assert.match(a.q('#auth-submit').textContent,/更新密码/);
    a.w.StudyCloud.updatePassword=async password=>{assert.equal(password,'new-password1');const s={...otpStatus,user:{id:'learner',email:'learner@example.com'},recovery:false,status:'password-updated'};a.w.AccountUI.onStatus(s);return s};a.input('#auth-password','new-password1');a.input('#auth-confirm','new-password1');a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.ok(a.q('#sign-out'));assert.equal(a.q('#auth-password'),null);assert.match(a.q('#auth-message').textContent,/密码已更新/);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('OTP change-email returns to an empty-password registration form and discards the code',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus(otpStatus);a.q('[data-auth-mode="signup"]').click();a.input('#auth-email','old@example.com');a.input('#auth-password','password1');a.input('#auth-confirm','password1');a.w.StudyCloud.signUp=async()=>({...otpStatus,status:'signup-code-sent'});a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    a.input('#auth-otp','654321');a.q('#otp-back').click();assert.equal(a.q('#otp-form'),null);assert.equal(a.q('#auth-email').value,'old@example.com');assert.equal(a.q('#auth-password').value,'');assert.equal(a.q('#auth-confirm').value,'');assert.doesNotMatch(a.q('#main').innerHTML,/654321/);assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('pending signup or recovery cannot overwrite the home page when the send request completes',async()=>{
  for(const kind of ['signup','reset']){
    const a=await app();try{
      await a.route('account');a.w.AccountUI.onStatus(otpStatus);a.q(`[data-auth-mode="${kind}"]`).click();a.input('#auth-email','waiting@example.com');
      if(kind==='signup'){a.input('#auth-password','password1');a.input('#auth-confirm','password1')}
      let finish;a.w.StudyCloud[kind==='signup'?'signUp':'resetPassword']=()=>new Promise(resolve=>{finish=resolve});
      a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));a.q('.account-panel [data-go="home"]').click();await pause();assert.equal(a.w.location.hash,'#home');assert.ok(a.q('.hero'));
      finish({...otpStatus,status:kind==='signup'?'signup-code-sent':'recovery-code-sent'});await pause();assert.equal(a.w.location.hash,'#home');assert.ok(a.q('.hero'));assert.equal(a.q('#otp-form'),null);
      await a.route('account');assert.ok(a.q('#otp-form'));assert.match(a.q('.account-panel').textContent,/waiting@example.com/);assert.equal(a.q('#auth-password'),null);assert.deepEqual(a.failures,[]);
    }finally{a.close()}
  }
});

test('existing registration code resumes verification without password, signup or resend',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus({...otpStatus,emailDeliveryReady:false,emailSignupReady:false});
    a.q('#auth-have-code').click();assert.equal(a.q('#otp-form'),null);assert.match(a.q('#auth-message').textContent,/填写注册时使用的邮箱/);
    a.input('#auth-email','existing@example.com');a.w.StudyCloud.signUp=()=>{throw Error('must not register again')};a.w.StudyCloud.resendSignup=()=>{throw Error('must not resend')};a.q('#auth-have-code').click();
    assert.ok(a.q('#otp-form'));assert.equal(a.q('#auth-password'),null);assert.equal(a.q('#otp-resend').disabled,true);
    a.w.StudyCloud.verifySignup=async(email,token)=>{assert.equal(email,'existing@example.com');assert.equal(token,'123456');const s={...otpStatus,user:{id:'existing',email},status:'synced'};a.w.AccountUI.onStatus(s);return s};a.input('#auth-otp','123456');a.q('#otp-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();assert.equal(a.w.location.hash,'#home');assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});

test('unconfirmed email login points to the registration code instead of a nonexistent mail link',async()=>{
  const a=await app();try{
    await a.route('account');a.w.AccountUI.onStatus(otpStatus);a.input('#auth-email','pending@example.com');a.input('#auth-password','password1');a.w.StudyCloud.signIn=async()=>{throw Error('Email not confirmed')};a.q('#auth-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));await pause();
    assert.match(a.q('#auth-message').textContent,/输入注册验证码/);assert.doesNotMatch(a.q('#auth-message').textContent,/验证链接/);assert.ok(a.q('#auth-have-code'));assert.deepEqual(a.failures,[]);
  }finally{a.close()}
});
