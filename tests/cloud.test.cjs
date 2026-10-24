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
  auth.signOut = async args => { auth.calls.push(['signOut', args]); auth.session = null; return { error: null }; };
  auth.resetPasswordForEmail = async (email, options) => { auth.calls.push(['reset', email, options]); return { data: {}, error: null }; };
  auth.updateUser = async args => { auth.calls.push(['update', args]); return { data: { user: auth.session?.user }, error: null }; };
  auth.startAutoRefresh = () => {};
  auth.stopAutoRefresh = () => {};
  return auth;
}
async function device(server, options = {}) {
  let state = blank(), lastMeta = null, tick = options.clock || 1000, seq = 0;
  const storage = options.storage || new Storage(), auth = fakeAuth(options.uid === undefined ? 'a' : options.uid);
  const timers = new Map(); let timerId = 0;
  const cloud = createCloud({ config: options.config === undefined ? config : options.config, client: { auth }, adapter: server.adapter(auth), storage,
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
