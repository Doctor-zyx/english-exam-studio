'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Browser UMD is intentionally .js; load it in a CJS wrapper even though the repo is ESM.
const cloudModule = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '../dist/cloud.js'), 'utf8'))(cloudModule);
const { createCloud, flattenState, materialize, mergePending, validateDocument, validConfiguration, emptyDocument, PREFIX } = cloudModule.exports;

const blank = () => ({ version: 1, plan: 14, day: 1, tasks: {}, drafts: {}, results: {}, words: {}, mistakes: {}, read: {}, activity: {}, settings: { name: '', examDate: '' }, mock: {}, essays: {} });
const clone = x => JSON.parse(JSON.stringify(x));
const valid = s => s?.version === 1 && [7, 14].includes(s.plan) && Number.isInteger(s.day) && s.day >= 1 && s.day <= s.plan && ['tasks','drafts','results','words','mistakes','read','activity','settings','mock','essays'].every(k => s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) && Object.values(s.words).every(w => typeof w.known === 'boolean') && Object.values(s.mock).every(m => m.answers && typeof m.answers === 'object');
const P = (...parts) => JSON.stringify(parts);
const config = { supabaseUrl: 'https://testing.supabase.co', publishableKey: 'sb_publishable_only_a_dummy_test_key_12345', pollIntervalMs: 20000 };
const cell = (stamp, value, deleted = false) => deleted ? { stamp, at: 1, deleted } : { stamp, at: 1, deleted, value };
const op = (id, path, value, baseStamp = null, deleted = false) => ({ id, origin: id, path, value, baseStamp, deleted, at: 2 });

class Storage {
  constructor() { this.data = new Map(); this.fail = false; }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { if (this.fail) throw Error('quota'); this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}
class Server {
  constructor() { this.rows = new Map(); this.reads = 0; this.writes = 0; this.beforeRead = null; this.beforeCAS = null; this.network = true; }
  row(uid) { return clone(this.rows.get(uid) || { revision: 0, document: emptyDocument() }); }
  adapter(auth) {
    return {
      read: async uid => {
        this.reads++;
        if (!this.network) throw Error('network offline');
        if (this.beforeRead) await this.beforeRead(uid);
        if (auth.session?.user.id !== uid) return { revision: 0, document: emptyDocument() };
        return this.row(uid);
      },
      cas: async (uid, revision, document) => {
        if (this.beforeCAS) await this.beforeCAS(uid);
        if (!this.network) throw Error('network offline');
        if (auth.session?.user.id !== uid) throw Error('Authenticated user does not match expected_user_id');
        const row = this.row(uid);
        if (row.revision !== revision) return { ok: false, ...row };
        const next = { revision: revision + 1, document: clone(document) };
        this.rows.set(uid, next); this.writes++;
        return { ok: true, ...clone(next) };
      }
    };
  }
}
function fakeAuth(uid) {
  const auth = { session: uid ? { user: { id: uid, email: uid + '@test.invalid' } } : null, callback: null, calls: [] };
  auth.getSession = async () => ({ data: { session: auth.session }, error: null });
  auth.onAuthStateChange = fn => { auth.callback = fn; return { data: { subscription: { unsubscribe() {} } } }; };
  auth.signInWithPassword = async ({ email }) => { auth.session = { user: { id: email.split('@')[0], email } }; return { data: { session: auth.session }, error: null }; };
  auth.signUp = async args => { auth.calls.push(['signUp', args]); return { data: { user: { id: 'new' }, session: null }, error: null }; };
  auth.signInWithOAuth = async args => { auth.calls.push(['oauth', args]); return { data: { provider: 'github', url: 'https://testing.supabase.co/auth/v1/authorize' }, error: null }; };
  auth.signOut = async args => { auth.calls.push(['signOut', args]); auth.session = null; return { error: null }; };
  auth.resetPasswordForEmail = async (email, options) => { auth.calls.push(['reset', email, options]); return { data: {}, error: null }; };
  auth.verifyOtp = async args => { auth.calls.push(['verifyOtp', args]); auth.session = { user: { id: args.email.split('@')[0], email: args.email, email_confirmed_at: '2026-10-25T00:00:00Z' } }; return { data: { user: auth.session.user, session: auth.session }, error: null }; };
  auth.resend = async args => { auth.calls.push(['resend', args]); return { data: {}, error: null }; };
  auth.updateUser = async args => { auth.calls.push(['update', args]); return { data: { user: auth.session?.user }, error: null }; };
  auth.startAutoRefresh = () => {};
  auth.stopAutoRefresh = () => {};
  return auth;
}
async function device(server, options = {}) {
  let state = blank(), lastMeta = null, tick = options.clock || 1000, seq = 0;
  const storage = options.storage || new Storage(), auth = fakeAuth(options.uid === undefined ? 'a' : options.uid);
  const timers = new Map(); let timerId = 0;
  const cloud = createCloud({ config: options.config === undefined ? config : options.config, client: { auth }, adapter: server.adapter(auth), storage, fetch: options.fetch,
    now: () => ++tick, randomId: () => (options.name || 'device') + '-' + (++seq),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    root: { location: { href: options.url || 'https://example.github.io/english-workbench/?old=1#settings' } }
  });
  await cloud.init({ getState: () => state, applyState(next, meta) { lastMeta = meta; if (options.defer && !meta.forceRender) return false; state = next; return true; }, blankState: blank, validateState: valid });
  return { cloud, auth, storage, timers, get state() { return state; }, get meta() { return lastMeta; }, edit(fn) { fn(state); cloud.save(state); }, async immediate() { for (const [id, t] of [...timers]) if (t.delay === 0) { timers.delete(id); t.fn(); } await new Promise(resolve => setImmediate(resolve)); } };
}

test('configuration accepts only browser keys and HTTPS (or local development)', () => {
  assert.equal(validConfiguration(config).configured, true);
  assert.equal(validConfiguration({}).configured, false);
  assert.equal(validConfiguration({ ...config, publishableKey: 'sb_secret_never_a_real_secret_key' }).configured, false);
  const jwt = 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
  assert.equal(validConfiguration({ ...config, publishableKey: jwt }).configured, false);
  assert.equal(validConfiguration({ ...config, supabaseUrl: 'http://example.com' }).configured, false);
});

test('round-trip includes essay checks, per-answer mock fields and atomic word records', () => {
  const s = blank(); s.essays = { prompt: 'P', draft: 'D', checks: { 0: true, 1: false } }; s.words.w001 = { known: true, next: '2026-10-25' }; s.mock.A = { answers: { 'A-L1': 'x' }, started: 500, submitted: false }; s.drafts['unit-1'] = { q1: 'a', q2: 'b' };
  const doc = emptyDocument(); for (const [p, v] of Object.entries(flattenState(s))) doc.cells[p] = cell(p, v);
  assert.deepEqual(materialize(doc, blank), s);
});

test('prototype pollution and malformed documents are rejected before applying', () => {
  const bad = { schema: 1, cells: { [P('settings','__proto__')]: cell('x', { polluted: true }) } };
  assert.equal(validateDocument(bad), false);
  assert.equal({}.polluted, undefined);
  assert.equal(validateDocument({ schema: 1, cells: { bad: cell('x', 1) } }), false);
});

test('independent fields merge, same-field edits require a choice', () => {
  const remote = emptyDocument(); remote.cells[P('tasks', 'a')] = cell('remote', true);
  const merged = mergePending(remote, [op('mine', P('tasks','b'), true), op('collision', P('tasks','a'), false)]);
  assert.equal(merged.document.cells[P('tasks','b')].value, true);
  assert.equal(merged.document.cells[P('tasks','a')].value, true);
  assert.equal(merged.conflicts.length, 1);
});

test('deletion tombstone blocks stale edits but explicit post-deletion restoration works', () => {
  const remote = emptyDocument(); remote.cells[P('mistakes','x')] = cell('deleted', null, true);
  const old = op('offline-edit', P('mistakes','x'), { id: 'x', prompt: 'x', answer: 'y' }, 'before-delete');
  const merged = mergePending(remote, [old]);
  assert.equal(merged.rejected.length, 1); assert.equal(merged.document.cells[old.path].deleted, true);
  const restored = mergePending(remote, [{ ...old, baseStamp: 'deleted' }]);
  assert.equal(restored.applied.length, 1);
});

test('unconfigured build truthfully stays local and does not call a backend', async () => {
  const server = new Server(); const d = await device(server, { config: {}, uid: null });
  d.edit(s => { s.tasks.a = true; });
  assert.equal(d.cloud.getStatus().status, 'unconfigured'); assert.equal(server.reads, 0); assert.equal(server.writes, 0);
  assert.equal(JSON.parse(d.storage.getItem(d.cloud.guestStorageKey)).tasks.a, true);
  await assert.rejects(d.cloud.signIn('a@test.invalid','password1'), /尚未配置/);
  d.cloud.destroy();
});

test('two stale devices preserve unrelated edits through CAS', async () => {
  const server = new Server(), a = await device(server, { name: 'A' }), b = await device(server, { name: 'B' });
  a.edit(s => { s.tasks.a = true; }); b.edit(s => { s.tasks.b = true; });
  await Promise.all([a.cloud.syncNow(), b.cloud.syncNow()]);
  await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.deepEqual(a.state.tasks, { a: true, b: true }); assert.deepEqual(b.state.tasks, { a: true, b: true });
  assert.equal(a.cloud.getStatus().pending, 0); assert.equal(b.cloud.getStatus().pending, 0);
  a.cloud.destroy(); b.cloud.destroy();
});

test('concurrent essay edits preserve both versions and resolution is explicit', async () => {
  const server = new Server(), a = await device(server, { name: 'A' }), b = await device(server, { name: 'B' });
  a.edit(s => { s.essays.draft = 'version A'; }); b.edit(s => { s.essays.draft = 'version B'; });
  await a.cloud.syncNow(); await b.cloud.syncNow();
  const [conflict] = b.cloud.getConflicts();
  assert.equal(conflict.local.value, 'version B'); assert.equal(conflict.remote.value, 'version A');
  assert.equal(b.cloud.getStatus().status, 'conflict');
  await b.cloud.resolveConflict(conflict.path, 'local'); await a.cloud.syncNow();
  assert.equal(a.state.essays.draft, 'version B'); assert.equal(b.cloud.getConflicts().length, 0);
  a.cloud.destroy(); b.cloud.destroy();
});

test('choosing cloud version clears a conflicting local operation', async () => {
  const server = new Server(), a = await device(server, { name: 'A' }), b = await device(server, { name: 'B' });
  a.edit(s => { s.settings.name = 'A'; }); b.edit(s => { s.settings.name = 'B'; });
  await a.cloud.syncNow(); await b.cloud.syncNow();
  await b.cloud.resolveConflict(P('settings','name'), 'remote');
  assert.equal(b.state.settings.name, 'A'); assert.equal(b.cloud.getStatus().pending, 0);
  a.cloud.destroy(); b.cloud.destroy();
});

test('offline queue survives reload and does not silently become another account', async () => {
  const server = new Server(), storage = new Storage(), a = await device(server, { storage });
  server.network = false; a.edit(s => { s.essays.draft = 'offline draft'; }); await a.cloud.syncNow(); a.cloud.destroy();
  const reopened = await device(server, { storage, name: 'reopened' });
  assert.equal(reopened.state.essays.draft, 'offline draft');
  await reopened.cloud.signIn('b@test.invalid', 'password1'); assert.equal(reopened.state.essays.draft, undefined);
  server.network = true; await reopened.cloud.syncNow(); assert.equal(server.row('b').revision, 0);
  await reopened.cloud.signIn('a@test.invalid', 'password1'); assert.equal(server.row('a').document.cells[P('essays','draft')].value, 'offline draft');
  reopened.cloud.destroy();
});

test('guest state is not automatically merged on sign-in or copied on sign-out', async () => {
  const server = new Server(), d = await device(server, { uid: null });
  d.edit(s => { s.essays.draft = 'guest draft'; });
  await d.cloud.signIn('a@test.invalid','password1');
  assert.equal(d.state.essays.draft, undefined); assert.equal(server.row('a').revision, 0);
  d.edit(s => { s.essays.draft = 'private account draft'; }); await d.cloud.syncNow();
  await d.cloud.signOut(); assert.equal(d.state.essays.draft, 'guest draft');
  assert.equal(d.cloud.getStatus().user, null); d.cloud.destroy();
});

test('explicit guest import uploads missing fields and preserves overlapping drafts as conflicts', async () => {
  const server = new Server(), d = await device(server, { uid: null });
  d.edit(s => { s.tasks.guest = true; s.essays.draft = 'guest'; });
  await d.cloud.signIn('a@test.invalid','password1'); d.edit(s => { s.essays.draft = 'account'; }); await d.cloud.syncNow();
  await d.cloud.importGuest();
  assert.equal(server.row('a').document.cells[P('tasks','guest')].value, true);
  assert.equal(server.row('a').document.cells[P('essays','draft')].value, 'account');
  assert.equal(d.cloud.getConflicts()[0].local.value, 'guest'); d.cloud.destroy();
});

test('in-flight acknowledgement does not discard newer typing on the same field', async () => {
  const server = new Server(), d = await device(server);
  let release, entered; const waiting = new Promise(r => { entered = r; });
  server.beforeCAS = async () => { entered(); await new Promise(r => { release = r; }); };
  d.edit(s => { s.essays.draft = 'first'; }); const syncing = d.cloud.syncNow(); await waiting;
  d.edit(s => { s.essays.draft = 'second'; }); release(); await syncing;
  server.beforeCAS = null; await d.cloud.syncNow();
  assert.equal(server.row('a').document.cells[P('essays','draft')].value, 'second');
  assert.equal(d.cloud.getConflicts().length, 0); d.cloud.destroy();
});

test('late read from previous account cannot replace the new account UI', async () => {
  const server = new Server(), d = await device(server);
  let release, entered; const waiting = new Promise(r => { entered = r; });
  server.beforeRead = async uid => { if (uid === 'a') { entered(); await new Promise(r => { release = r; }); } };
  const oldSync = d.cloud.syncNow(); await waiting;
  await d.cloud.signIn('b@test.invalid','password1'); release(); await oldSync;
  assert.equal(d.cloud.getStatus().user.id, 'b'); assert.equal(d.state.essays.draft, undefined); d.cloud.destroy();
});

test('account switch during an in-flight CAS cannot write old progress under the new token', async () => {
  const server = new Server(), d = await device(server);
  let release, entered; const waiting = new Promise(r => { entered = r; });
  server.beforeCAS = async uid => { if (uid === 'a') { entered(); await new Promise(r => { release = r; }); } };
  d.edit(s => { s.essays.draft = 'A-only'; }); const oldSync = d.cloud.syncNow(); await waiting;
  await d.cloud.signIn('b@test.invalid','password1'); release(); await oldSync;
  assert.equal(server.row('b').revision, 0); assert.equal(d.cloud.getStatus().user.id, 'b');
  server.beforeCAS = null; await d.cloud.signIn('a@test.invalid','password1');
  assert.equal(server.row('a').document.cells[P('essays','draft')].value, 'A-only'); d.cloud.destroy();
});

test('deferred remote UI updates do not turn stale visible fields into outgoing writes', async () => {
  const server = new Server(), a = await device(server, { name: 'A' }), options = { name: 'B', defer: true }, b = await device(server, options);
  a.edit(s => { s.tasks.remote = true; }); await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.equal(b.state.tasks.remote, undefined); assert.equal(b.cloud.getStatus().deferred, true);
  b.edit(s => { s.essays.draft = 'typing safely'; }); await b.cloud.syncNow();
  options.defer = false; await b.cloud.syncNow();
  assert.equal(b.state.tasks.remote, true); assert.equal(b.state.essays.draft, 'typing safely'); assert.equal(b.cloud.getConflicts().length, 0);
  a.cloud.destroy(); b.cloud.destroy();
});

test('deleted mistake stays deleted when an offline device submits an edit', async () => {
  const server = new Server(), a = await device(server, { name: 'A' });
  a.edit(s => { s.mistakes.x = { id: 'x', prompt: 'Q', answer: 'A' }; }); await a.cloud.syncNow();
  const b = await device(server, { name: 'B' });
  a.edit(s => { delete s.mistakes.x; }); b.edit(s => { s.mistakes.x.yourAnswer = 'offline change'; });
  await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.equal(b.state.mistakes.x, undefined); assert.equal(b.cloud.getConflicts()[0].kind, 'remote-deletion');
  await b.cloud.resolveConflict(P('mistakes','x'), 'local'); await a.cloud.syncNow();
  assert.equal(a.state.mistakes.x.yourAnswer, 'offline change');
  a.cloud.destroy(); b.cloud.destroy();
});

test('global reset blocks even an unknown field added by a previously offline device', async () => {
  const server = new Server(), a = await device(server, { name: 'A' });
  a.edit(s => { s.tasks.old = true; }); await a.cloud.syncNow(); const b = await device(server, { name: 'B' });
  b.edit(s => { s.drafts['brand-new'] = 'offline answer'; });
  a.cloud.save(blank()); await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.equal(b.state.drafts['brand-new'], undefined);
  assert.equal(b.state.tasks.old, undefined); assert.equal(b.cloud.getConflicts().length, 1);
  a.cloud.destroy(); b.cloud.destroy();
});

test('whole-paper reset does not resurrect a different offline question', async () => {
  const server = new Server(), a = await device(server, { name: 'A' });
  a.edit(s => { s.mock.A = { started: 100, submitted: false, answers: { q1: 'one' } }; }); await a.cloud.syncNow();
  const b = await device(server, { name: 'B' });
  b.edit(s => { s.mock.A.answers.q2 = 'two'; });
  a.edit(s => { s.mock.A = { started: null, submitted: false, answers: {} }; });
  await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.deepEqual(b.state.mock.A.answers, {}); assert.equal(b.state.mock.A.started, null);
  a.cloud.destroy(); b.cloud.destroy();
});

test('separate operation journal keys preserve both tabs writing offline to shared storage', async () => {
  const server = new Server(), storage = new Storage(), a = await device(server, { storage, name: 'A' }), b = await device(server, { storage, name: 'B' });
  server.network = false;
  a.edit(s => { s.tasks.fromA = true; }); b.edit(s => { s.tasks.fromB = true; });
  const ops = [...storage.data.keys()].filter(k => k.startsWith(a.cloud.storageNamespace + 'op:a:'));
  assert.equal(ops.length, 2);
  server.network = true; await a.cloud.syncNow(); await b.cloud.syncNow();
  assert.deepEqual(b.state.tasks, { fromA: true, fromB: true }); a.cloud.destroy(); b.cloud.destroy();
});

test('quota failure is visible and never falsely says locally saved', async () => {
  const server = new Server(), storage = new Storage(), d = await device(server, { storage });
  storage.fail = true; d.edit(s => { s.essays.draft = 'not durable yet'; });
  assert.equal(d.cloud.getStatus().status, 'storage-error'); assert.equal(d.cloud.getStatus().storageOK, false);
  assert.equal(d.cloud.getStatus().pending, 1); d.cloud.destroy();
});

test('email confirmation and recovery use SDK without inventing a successful login', async () => {
  const server = new Server(), d = await device(server, { uid: null });
  await d.cloud.signUp('new@test.invalid', 'password1'); assert.equal(d.cloud.getStatus().status, 'confirm-email'); assert.equal(d.cloud.getStatus().user, null);
  await d.cloud.resetPassword('new@test.invalid');
  assert.equal(d.auth.calls.find(c => c[0] === 'reset')[2].redirectTo, 'https://example.github.io/english-workbench/?auth=recovery');
  d.auth.session = { user: { id: 'new', email: 'new@test.invalid' } }; d.auth.callback('PASSWORD_RECOVERY', d.auth.session); await d.immediate();
  assert.equal(d.cloud.getStatus().recovery, true);
  await d.cloud.updatePassword('newpassword1'); assert.equal(d.cloud.getStatus().recovery, false); d.cloud.destroy();
});

test('SQL has explicit user match, invoker RLS, restricted grants, row lock and strict shape check', () => {
  const sql = fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8');
  for (const part of ['security invoker', "set search_path = ''", 'expected_user_id is distinct from caller', 'for update', 'force row level security', 'with check', ') is true)', 'from public, anon', 'grant execute']) assert.ok(sql.includes(part), part);
  assert.ok(!/grant\s+[^;]*delete\s/i.test(sql));
});

test('different Supabase projects and GitHub repo paths have isolated auth/cache namespaces', async () => {
  const server = new Server(), storage = new Storage();
  const a = await device(server, { storage, name: 'A' }); server.network = false;
  a.edit(s => { s.essays.draft = 'project A only'; });
  const b = await device(server, { storage, name: 'B', config: { ...config, supabaseUrl: 'https://another.supabase.co' } });
  const c = await device(server, { storage, name: 'C', url: 'https://example.github.io/other-repo/' });
  assert.notEqual(a.cloud.storageNamespace, b.cloud.storageNamespace);
  assert.notEqual(a.cloud.storageNamespace, c.cloud.storageNamespace);
  assert.equal(b.state.essays.draft, undefined); assert.equal(c.state.essays.draft, undefined);
  assert.equal(b.cloud.getStatus().pending, 0); assert.equal(c.cloud.getStatus().pending, 0);
  a.cloud.destroy(); b.cloud.destroy(); c.cloud.destroy();
});

test('GitHub OAuth verifies public provider settings and uses the official SDK with a clean return URL', async () => {
  const requests=[];
  const d=await device(new Server(),{uid:null,config:{...config,authProvider:'github'},fetch:async(url,options)=>{
    requests.push({url,options});return{ok:true,json:async()=>({external:{github:true}})};
  }});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().oauthReady,true);
    const status=await d.cloud.signInWithGitHub();
    assert.equal(status.user,null);assert.equal(status.status,'oauth-redirect');
    assert.deepEqual(d.auth.calls.find(x=>x[0]==='oauth')[1],{provider:'github',options:{redirectTo:'https://example.github.io/english-workbench/'}});
    for(const r of requests){assert.equal(r.url,'https://testing.supabase.co/auth/v1/settings');assert.equal(r.options.headers.apikey,config.publishableKey);assert.equal(r.options.method,'GET');assert.equal(r.options.cache,'no-store');assert.equal(r.options.headers.Authorization,undefined)}
  }finally{d.cloud.destroy()}
});

test('disabled GitHub provider blocks OAuth but guest learning persists and can retry later', async () => {
  let enabled=false;
  const d=await device(new Server(),{uid:null,config:{...config,authProvider:'github'},fetch:async()=>({ok:true,json:async()=>({external:{github:enabled,email:true}})})});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().oauthReady,false);assert.equal(d.cloud.getStatus().status,'oauth-unavailable');
    await assert.rejects(d.cloud.signInWithGitHub(),/待配置/);assert.equal(d.auth.calls.filter(x=>x[0]==='oauth').length,0);
    d.edit(s=>{s.tasks['learn:test:0']=true});assert.equal(d.state.tasks['learn:test:0'],true);assert.match(d.cloud.getStatus().message,/待配置/);
    enabled=true;await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().oauthReady,true);assert.equal(d.cloud.getStatus().status,'guest');
  }finally{d.cloud.destroy()}
});

test('settings failures and malformed statuses stay unknown; existing sessions continue syncing', async () => {
  const server=new Server();let response='network';
  const d=await device(server,{config:{...config,authProvider:'github'},fetch:async()=>{
    if(response==='network')throw Error('Network down');return{ok:response!=='http',json:async()=>({external:{github:'true'}})};
  }});
  try{
    for(const failure of ['network','http','missing']){
      response=failure;await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().oauthReady,null);assert.equal(d.cloud.getStatus().oauthChecking,false);assert.match(d.cloud.getStatus().oauthMessage,/未能确认/);
      assert.equal(d.cloud.getStatus().user.id,'a');assert.notEqual(d.cloud.getStatus().status,'oauth-unknown');
    }
    d.edit(s=>{s.tasks['book:test:mission']=true});await d.cloud.syncNow();assert.equal(d.cloud.getStatus().status,'synced');assert.equal(server.row('a').document.cells[P('tasks','book:test:mission')].value,true);
  }finally{d.cloud.destroy()}
});

test('unconfirmed GitHub provider is retryable and does not call SDK; email defaults skip probing', async () => {
  let calls=0;
  const d=await device(new Server(),{uid:null,config:{...config,authProvider:'github'},fetch:async()=>{calls++;throw Error('offline')}});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().status,'oauth-unknown');
    await assert.rejects(d.cloud.signInWithGitHub(),/未能确认/);assert.ok(calls>=2);assert.equal(d.auth.calls.length,0);
  }finally{d.cloud.destroy()}
  const email=await device(new Server(),{uid:null,fetch:async()=>{throw Error('must not probe')}});
  try{assert.equal(email.cloud.getStatus().authProvider,'email');await email.cloud.refreshAuthSettings();await email.cloud.signUp('new@test.invalid','password1');assert.equal(email.cloud.getStatus().status,'confirm-email')}finally{email.cloud.destroy()}
});

test('OAuth SDK errors remain visible without claiming a redirect or a valid session', async () => {
  const d=await device(new Server(),{uid:null,config:{...config,authProvider:'github'},fetch:async()=>({ok:true,json:async()=>({external:{github:true}})})});
  try{
    d.auth.signInWithOAuth=async()=>({data:null,error:{message:'Provider is not enabled'}});
    await assert.rejects(d.cloud.signInWithGitHub(),/Provider is not enabled/);
    assert.equal(d.cloud.getStatus().user,null);assert.equal(d.cloud.getStatus().oauthReady,null);assert.equal(d.cloud.getStatus().status,'oauth-unknown');
  }finally{d.cloud.destroy()}
});

test('a stalled settings probe times out, deduplicates retries and never blocks guest progress', async () => {
  let requests=0;
  const d=await device(new Server(),{uid:null,config:{...config,authProvider:'github'},fetch:()=>{requests++;return new Promise(()=>{})}});
  try{
    const pending=d.cloud.refreshAuthSettings();assert.equal(d.cloud.refreshAuthSettings(),pending);assert.equal(d.cloud.getStatus().oauthChecking,true);
    d.edit(s=>{s.essays.draft='Still learning offline'});assert.equal(d.state.essays.draft,'Still learning offline');
    const deadline=[...d.timers.values()].find(t=>t.delay===8000);assert.ok(deadline);deadline.fn();await pending;
    assert.equal(requests,1);assert.equal(d.cloud.getStatus().oauthChecking,false);assert.equal(d.cloud.getStatus().oauthReady,null);assert.equal(d.cloud.getStatus().status,'oauth-unknown');
  }finally{d.cloud.destroy()}
});

const instantConfig={...config,authProvider:'email',emailSignupMode:'instant',passwordRecoveryEnabled:false};
const emailSettings=()=>({external:{email:true},disable_signup:false,mailer_autoconfirm:true});

test('instant email signup rechecks real settings and adopts only a returned session',async()=>{
  let probes=0;
  const d=await device(new Server(),{uid:null,config:instantConfig,fetch:async()=>{probes++;return{ok:true,json:async()=>emailSettings()}}});
  try{
    await d.cloud.refreshAuthSettings();const before=probes;
    d.auth.signUp=async args=>{d.auth.calls.push(['signUp',args]);d.auth.session={user:{id:'new',email:args.email}};return{data:{user:d.auth.session.user,session:d.auth.session},error:null}};
    const result=await d.cloud.signUp(' new@test.invalid ','password1');assert.ok(probes>before);assert.equal(result.user.id,'new');assert.equal(result.status,'synced');assert.equal(result.emailSignupReady,true);assert.equal(result.passwordRecoveryEnabled,false);assert.equal(d.auth.calls.find(x=>x[0]==='signUp')[1].email,'new@test.invalid');
  }finally{d.cloud.destroy()}
});

test('instant signup rejects server confirmation, disabled signup or disabled email before calling SDK',async()=>{
  let settings=emailSettings();
  const d=await device(new Server(),{uid:null,config:instantConfig,fetch:async()=>({ok:true,json:async()=>settings})});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().emailSignupReady,true);
    for(const blocked of [{...emailSettings(),mailer_autoconfirm:false},{...emailSettings(),disable_signup:true},{...emailSettings(),external:{email:false}}]){
      settings=blocked;await assert.rejects(d.cloud.signUp('new@test.invalid','password1'),/注册即将开放/);assert.equal(d.cloud.getStatus().emailSignupReady,false);assert.equal(d.cloud.getStatus().status,'signup-unavailable');
    }
    assert.equal(d.auth.calls.filter(x=>x[0]==='signUp').length,0);
    await d.cloud.signIn('a@test.invalid','password1');assert.equal(d.cloud.getStatus().user.id,'a');assert.equal(d.cloud.getStatus().status,'synced');
  }finally{d.cloud.destroy()}
});

test('unknown instant signup settings block new registration without blocking signed-in sync',async()=>{
  let settings={external:{email:true},disable_signup:false};
  const server=new Server(),d=await device(server,{config:instantConfig,fetch:async()=>{if(!settings)throw Error('offline');return{ok:true,json:async()=>settings}}});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().emailSignupReady,null);assert.match(d.cloud.getStatus().emailSignupMessage,/未能确认/);
    settings=null;await assert.rejects(d.cloud.signUp('new@test.invalid','password1'),/未能确认/);assert.equal(d.auth.calls.filter(x=>x[0]==='signUp').length,0);
    d.edit(s=>{s.essays.draft='My current session still works.'});await d.cloud.syncNow();assert.equal(d.cloud.getStatus().status,'synced');assert.equal(server.row('a').document.cells[P('essays','draft')].value,'My current session still works.');
  }finally{d.cloud.destroy()}
});

test('instant registration without session never claims a confirmation email was sent',async()=>{
  const d=await device(new Server(),{uid:null,config:instantConfig,fetch:async()=>({ok:true,json:async()=>emailSettings()})});
  try{
    await assert.rejects(d.cloud.signUp('new@test.invalid','password1'),/未完成直接注册/);assert.equal(d.cloud.getStatus().user,null);assert.equal(d.cloud.getStatus().status,'signup-incomplete');assert.doesNotMatch(d.cloud.getStatus().message,/已发送|验证邮件|确认邮件|查收/);
  }finally{d.cloud.destroy()}
});

test('disabled password recovery makes no SDK request but an authenticated recovery session can update password',async()=>{
  const d=await device(new Server(),{config:{...config,passwordRecoveryEnabled:false}});
  try{
    await assert.rejects(d.cloud.resetPassword('a@test.invalid'),/暂不支持邮件找回/);assert.equal(d.auth.calls.filter(x=>x[0]==='reset').length,0);
    d.auth.callback('PASSWORD_RECOVERY',d.auth.session);await d.immediate();assert.equal(d.cloud.getStatus().recovery,true);await d.cloud.updatePassword('newpassword1');assert.equal(d.cloud.getStatus().recovery,false);assert.equal(d.auth.calls.filter(x=>x[0]==='update').length,1);
  }finally{d.cloud.destroy()}
});

const otpConfig={...config,authProvider:'email',emailSignupMode:'otp',passwordRecoveryEnabled:true,emailDeliveryReady:true};
const otpSettings=()=>({external:{email:true},disable_signup:false,mailer_autoconfirm:false});
const otpFetch=async()=>({ok:true,json:async()=>otpSettings()});

test('OTP email delivery unavailable prevents registration and recovery mail but keeps existing login working',async()=>{
  const d=await device(new Server(),{uid:null,config:{...otpConfig,emailDeliveryReady:false},fetch:otpFetch});
  try{
    await d.cloud.refreshAuthSettings();assert.equal(d.cloud.getStatus().emailSignupReady,false);assert.match(d.cloud.getStatus().message,/邮件服务待配置/);
    await assert.rejects(d.cloud.signUp('new@test.invalid','password1'),/邮件服务待配置/);await assert.rejects(d.cloud.resetPassword('new@test.invalid'),/邮件服务待配置/);await assert.rejects(d.cloud.resendSignup('new@test.invalid'),/邮件服务待配置/);assert.equal(d.auth.calls.length,0);
    await d.cloud.signIn('a@test.invalid','password1');assert.equal(d.cloud.getStatus().user.id,'a');assert.equal(d.cloud.getStatus().status,'synced');
  }finally{d.cloud.destroy()}
});

test('OTP signup remains a guest until SDK verification returns a session; secrets never enter progress storage',async()=>{
  const d=await device(new Server(),{uid:null,config:otpConfig,fetch:otpFetch});
  try{
    const sent=await d.cloud.signUp('new@test.invalid','private-password1');assert.equal(sent.user,null);assert.equal(sent.status,'signup-code-sent');assert.equal(sent.emailSignupReady,true);
    await assert.rejects(d.cloud.verifySignup('new@test.invalid','12345'),/6–8/);assert.equal(d.auth.calls.filter(x=>x[0]==='verifyOtp').length,0);
    const verified=await d.cloud.verifySignup('new@test.invalid','12345678');assert.equal(verified.user.id,'new');assert.equal(verified.recovery,false);assert.deepEqual(d.auth.calls.find(x=>x[0]==='verifyOtp')[1],{email:'new@test.invalid',token:'12345678',type:'signup'});
    assert.doesNotMatch(JSON.stringify([...d.storage.data]),/private-password1|12345678/);
  }finally{d.cloud.destroy()}
});

test('OTP recovery verifies the recovery token then updates the password and ends recovery state',async()=>{
  const d=await device(new Server(),{uid:null,config:otpConfig,fetch:otpFetch});
  try{
    await d.cloud.resetPassword('learner@test.invalid');assert.equal(d.cloud.getStatus().user,null);assert.equal(d.cloud.getStatus().status,'recovery-code-sent');
    const result=await d.cloud.verifyRecovery('learner@test.invalid','123456');assert.equal(result.recovery,true);assert.equal(result.user.id,'learner');assert.equal(result.status,'recovery');assert.deepEqual(d.auth.calls.find(x=>x[0]==='verifyOtp')[1],{email:'learner@test.invalid',token:'123456',type:'recovery'});
    await d.cloud.updatePassword('private-new-password1');assert.equal(d.cloud.getStatus().recovery,false);assert.equal(d.cloud.getStatus().status,'password-updated');assert.doesNotMatch(JSON.stringify([...d.storage.data]),/private-new-password1|123456/);
  }finally{d.cloud.destroy()}
});

test('OTP signup refuses autoconfirm configuration and resends only via official confirmation API',async()=>{
  let autoconfirm=true;
  const d=await device(new Server(),{uid:null,config:otpConfig,fetch:async()=>({ok:true,json:async()=>({...otpSettings(),mailer_autoconfirm:autoconfirm})})});
  try{
    await assert.rejects(d.cloud.signUp('new@test.invalid','password1'),/注册即将开放/);assert.equal(d.auth.calls.length,0);
    autoconfirm=false;await d.cloud.signUp('new@test.invalid','password1');await d.cloud.resendSignup('new@test.invalid');assert.deepEqual(d.auth.calls.find(x=>x[0]==='resend')[1],{type:'signup',email:'new@test.invalid',options:{emailRedirectTo:'https://example.github.io/english-workbench/'}});assert.equal(d.cloud.getStatus().user,null);
  }finally{d.cloud.destroy()}
});

test('unexpected auto-confirmed signup session is isolated before SIGNED_IN and cleared from the SDK',async()=>{
  const server=new Server(),d=await device(server,{uid:null,config:otpConfig,fetch:otpFetch});let unexpected;
  try{
    d.auth.signUp=async()=>{unexpected={user:{id:'unverified',email:'unverified@test.invalid'}};d.auth.session=unexpected;d.storage.setItem(d.cloud.storageNamespace+'auth',JSON.stringify(unexpected));d.auth.callback('SIGNED_IN',unexpected);await d.immediate();assert.equal(d.cloud.getStatus().user,null);return{data:{session:unexpected,user:unexpected.user},error:null}};
    await assert.rejects(d.cloud.signUp('unverified@test.invalid','password1'),/停止登录/);assert.equal(d.auth.session,null);assert.equal(d.storage.getItem(d.cloud.storageNamespace+'auth'),null);assert.equal(d.cloud.getStatus().user,null);assert.equal(server.reads,0);assert.equal(server.writes,0);
    d.auth.callback('SIGNED_IN',unexpected);await d.immediate();assert.equal(d.cloud.getStatus().user,null);assert.ok(d.auth.calls.some(x=>x[0]==='signOut'&&x[1].scope==='local'));
  }finally{d.cloud.destroy()}
});

test('OTP verification with an invalid or missing session cannot claim login or password recovery',async()=>{
  const d=await device(new Server(),{uid:null,config:otpConfig,fetch:otpFetch});
  try{
    d.auth.verifyOtp=async()=>({data:{user:null,session:null},error:null});await assert.rejects(d.cloud.verifySignup('new@test.invalid','123456'),/未收到有效登录会话/);await assert.rejects(d.cloud.verifyRecovery('new@test.invalid','123456'),/未收到有效会话/);assert.equal(d.cloud.getStatus().user,null);assert.equal(d.cloud.getStatus().recovery,false);
    d.auth.verifyOtp=async()=>({data:null,error:{message:'Token has expired or is invalid'}});await assert.rejects(d.cloud.verifySignup('new@test.invalid','123456'),/验证码无效或已过期/);assert.equal(d.cloud.getStatus().user,null);
  }finally{d.cloud.destroy()}
});

test('password recovery follows its account and never leaks to a different tab account',async()=>{
  const d=await device(new Server(),{uid:null,config:otpConfig,fetch:otpFetch});
  try{
    await d.cloud.verifyRecovery('a@test.invalid','123456');assert.equal(d.cloud.getStatus().user.id,'a');assert.equal(d.cloud.getStatus().recovery,true);
    const b={user:{id:'b',email:'b@test.invalid'}};d.auth.session=b;d.auth.callback('SIGNED_IN',b);await d.immediate();assert.equal(d.cloud.getStatus().user.id,'b');assert.equal(d.cloud.getStatus().recovery,false);
    d.auth.callback('PASSWORD_RECOVERY',b);await d.immediate();assert.equal(d.cloud.getStatus().recovery,true);assert.equal(d.cloud.getStatus().status,'recovery');
    d.auth.callback('TOKEN_REFRESHED',b);await d.immediate();assert.equal(d.cloud.getStatus().recovery,true);
    const c={user:{id:'c',email:'c@test.invalid'}};d.auth.session=c;d.auth.callback('PASSWORD_RECOVERY',c);await d.immediate();assert.equal(d.cloud.getStatus().user.id,'c');assert.equal(d.cloud.getStatus().recovery,true);
    await d.cloud.signOut();assert.equal(d.cloud.getStatus().recovery,false);
  }finally{d.cloud.destroy()}
});
