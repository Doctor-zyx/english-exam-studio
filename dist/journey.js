/* Compact course navigation; all progress remains in the existing state keys. */
(()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const done=(s,c)=>(c.missions||[]).filter(m=>{
    const key='book:'+c.id+':'+m.id;
    if(!(m.contentVersion===2||m.textComplete))return s.tasks[key]===true;
    const r=s.results[key],items=m.items||[];
    return !m.missingTasks?.length&&items.length>0&&items.every((q,i)=>!q.blocked&&r?.checked?.[String(q.id??`item-${i+1}`)]?.reviewed===true)&&(!(m.itemsPartial===true||c.itemsPartial===true)||r?.groupAssessed===true);
  }).length;
  const learned=(s,l)=>(l.rules||[]).filter((_,i)=>s.tasks['learn:'+l.id+':'+i]===true).length;
  const purpose={sentence:'句子结构与常见语法纠错',paragraph:'写出中心明确的段落',coherence:'保持统一，连接句与句',support:'用事实、引文和数据支撑观点',essay:'从段落组织完整文章',cause:'清楚地解释原因与结果',argument:'提出观点，回应反对意见',paraphrase:'保留原义，改写与概括'};
  function card(l,c,s,i){
    const n=done(s,c),all=c.missions.length,k=learned(s,l),rules=l.rules?.length||0;
    return `<article class="course-node"><span class="node-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div class="node-copy"><h3>${esc(l.title)}</h3><p>${esc(purpose[l.id]||l.subtitle)}</p></div><div class="node-progress"><span>已阅读 ${k}/${rules} <span aria-hidden="true">·</span> 原题 ${n}/${all}</span><progress max="${Math.max(1,all)}" value="${n}" aria-label="${esc(l.title)} 原题进度"></progress></div><button class="course-enter" data-course="${esc(l.id)}" aria-label="进入 ${esc(l.title)}">进入 <span aria-hidden="true">→</span></button></article>`;
  }
  function bind(host,ctx){host.querySelectorAll('[data-course]').forEach(b=>b.onclick=()=>ctx.openCourse(b.dataset.course))}
  function home(host,ctx){
    const s=ctx.state,d=ctx.data,courses=d.courses||[],lessons=d.lessons.filter(l=>courses.some(c=>c.id===l.id));
    const groups=courses.reduce((n,c)=>n+c.missions.length,0),finished=courses.reduce((n,c)=>n+done(s,c),0);
    const hasStarted=c=>Boolean(s.drafts?.['chapter:'+c.id+':position'])||c.missions.some(m=>Object.keys(s.results['book:'+c.id+':'+m.id]?.checked||{}).length>0);
    const started=courses.find(c=>done(s,c)<c.missions.length&&(done(s,c)>0||learned(s,lessons.find(l=>l.id===c.id)||{})>0||hasStarted(c)));
    const next=started||courses.find(c=>done(s,c)<c.missions.length)||courses[0],nextLesson=lessons.find(l=>l.id===next?.id);
    const reviewCount=courses.reduce((n,c)=>n+c.missions.filter(m=>s.results['book:'+c.id+':'+m.id]?.reviewNeed).length,0),otherMistakes=Object.keys(s.mistakes).length;
    host.innerHTML=`<div class="journey-heading"><div><h1>${esc(s.settings.name||'同学')}，今天再闯一关。</h1><p>从一个知识点开始，把书上的题练熟。</p></div></div><section class="hero quest-hero"><div class="continue-copy"><span class="continue-label">继续学习</span><h2>${esc(nextLesson?.title||'Sentence skills')}</h2><p>${esc(purpose[next?.id]||nextLesson?.subtitle||'先理解规则，再完成教材原题。')}</p><button class="primary" data-course="${esc(next?.id||'sentence')}">继续这一章 <span aria-hidden="true">→</span></button></div><div class="home-progress"><span>教材总进度</span><strong>${finished}<small> / ${groups}</small></strong><progress max="${Math.max(1,groups)}" value="${finished}" aria-label="教材总进度"></progress><p>组原题已完成 · 含对照自评</p></div></section><div class="preview-map home-entries"><a class="course-node home-entry" href="#writing" data-go="writing"><span class="entry-symbol" aria-hidden="true">▤</span><h2>教材目录</h2><p>${courses.length} 个章节，按顺序学与练。</p><span class="entry-bottom">查看章节 <span aria-hidden="true">→</span></span></a><a class="course-node home-entry listening-portal" href="#listening"><span class="entry-symbol" aria-hidden="true">◎</span><h2>听力原题</h2><p>${d.units.length} 个单元，原音精听与填空。</p><span class="entry-bottom">开始听力 <span aria-hidden="true">→</span></span></a><a class="course-node home-entry review-portal" href="#mistakes"><span class="entry-symbol" aria-hidden="true">↻</span><h2>错题复习</h2><p>${reviewCount} 组原题待复习 · ${otherMistakes} 条其他错题</p><span class="entry-bottom">回顾与巩固 <span aria-hidden="true">→</span></span></a></div><p class="scope-caption">备考以教材原题为主。<a href="#tools">词汇、写作草稿与自编练习</a>可按需使用。</p>`;
    bind(host,ctx);
  }
  function catalog(host,ctx){
    const d=ctx.data,s=ctx.state,courses=d.courses||[],core=d.lessons.filter(l=>courses.some(c=>c.id===l.id)),extra=d.lessons.filter(l=>!courses.some(c=>c.id===l.id));
    host.innerHTML=`<div class="journey-heading"><div><h1>教材目录</h1><p>${core.length} 个章节。先理解，再完成原书练习。</p></div></div><div class="course-map">${core.map((l,i)=>card(l,courses.find(c=>c.id===l.id),s,i)).join('')}</div><details class="supplementary-chapters"><summary>补充阅读 <span>RA、引用规范与编辑建议</span></summary><div class="supplement-list">${extra.map(l=>`<button class="secondary" data-course="${esc(l.id)}">${esc(l.title)} <span aria-hidden="true">→</span></button>`).join('')}</div><p class="hint">补充内容不计入八章原题关卡。</p></details>`;
    bind(host,ctx);
  }
  function tools(host){
    host.innerHTML=`<div class="journey-heading"><div><h1>辅助工具</h1><p>需要时打开，帮助理解与巩固。</p></div></div><div class="tool-cards"><a href="#vocabulary" class="panel"><span class="tag">辅助复习 · 非独立考项</span><h2>词汇与短语</h2><p>从课程材料整理，随时认识生词、复习表达。</p><span class="quiet">打开词卡 →</span></a><a href="#mocks" class="panel"><span class="tag">自编拓展 · 不是教材原题</span><h2>模拟练习</h2><p>完成教材后，用两套拓展练习检验迁移能力。</p><span class="quiet">查看练习 →</span></a><a href="#freewriting" class="panel"><span class="tag">自由草稿</span><h2>写作草稿</h2><p>保存想写的句子，检查结构、表达与字数。</p><span class="quiet">继续写作 →</span></a></div><div class="button-row"><button class="secondary" data-go="writing">返回教材目录</button></div>`;
  }
  window.StudyJourney={home,catalog,tools};
})();
