/* StudyCloud v1 — account-isolated durable outbox + field-level three-way merge.
 * Supabase auth tokens are managed only by the vendored official SDK.
 * Copyright 2026. MIT. */
(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else root.StudyCloud = exported.createCloud({
    config: root.STUDY_CLOUD_CONFIG,
    sdk: root.supabase,
    root
  });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFIX = 'english-study-cloud-v1:';
  const AUTH_KEY = PREFIX + 'auth';
  const MAX_BYTES = 1900000, MAX_CELLS = 12000;
  const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
  const MAPS = ['tasks', 'results', 'words', 'mistakes', 'read', 'activity'];
  const ROOT_KEYS = new Set(['version', 'plan', 'day', ...MAPS, 'settings', 'drafts', 'mock', 'essays']);
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (plain(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const equal = (a, b) => canonical(a) === canonical(b);
  function safeJSON(v, depth = 0) {
    if (depth > 14) return false;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (Array.isArray(v)) return v.length <= MAX_CELLS && v.every(x => safeJSON(x, depth + 1));
    if (!plain(v)) return false;
    return Object.keys(v).length <= MAX_CELLS && Object.keys(v).every(k => !FORBIDDEN.has(k) && k.length < 400 && safeJSON(v[k], depth + 1));
  }
  const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
  function pathParts(path) {
    let p; try { p = JSON.parse(path); } catch { return null; }
    if (!Array.isArray(p) || p.length < 1 || p.length > 4 || p.some(k => typeof k !== 'string' || !k || k.length > 180 || FORBIDDEN.has(k))) return null;
    if (p[0] === '$reset') return p.length === 1 || (p.length === 3 && p[1] === 'mock') ? p : null;
    if (['plan', 'day'].includes(p[0])) return p.length === 1 ? p : null;
    if (MAPS.includes(p[0])) return p.length === 2 ? p : null;
    if (p[0] === 'settings') return p.length === 2 && ['name', 'examDate'].includes(p[1]) ? p : null;
    if (p[0] === 'essays') return (p.length === 2 && ['prompt', 'draft'].includes(p[1])) || (p.length === 3 && p[1] === 'checks') ? p : null;
    if (p[0] === 'drafts') return p.length === (p[1]?.startsWith('unit-') ? 3 : 2) ? p : null;
    if (p[0] === 'mock') return (p.length === 4 && p[2] === 'answers') || (p.length === 3 && ['started', 'submitted', 'finished'].includes(p[2])) ? p : null;
    return null;
  }
  function flattenState(state) {
    if (!safeJSON(state) || bytes(state) > MAX_BYTES || Object.keys(state).some(k => !ROOT_KEYS.has(k))) throw new Error('进度格式不安全或内容过大，请先导出备份。');
    const out = {};
    const put = (p, value) => { const k = JSON.stringify(p); if (!pathParts(k)) throw new Error('不支持的进度字段。'); out[k] = clone(value); };
    put(['plan'], state.plan); put(['day'], state.day);
    for (const top of MAPS) for (const [k, v] of Object.entries(state[top] || {})) put([top, k], v);
    for (const [k, v] of Object.entries(state.settings || {})) put(['settings', k], v);
    for (const [k, v] of Object.entries(state.essays || {})) {
      if (k === 'checks') for (const [check, value] of Object.entries(v)) put(['essays', 'checks', check], value);
      else put(['essays', k], v);
    }
    for (const [k, v] of Object.entries(state.drafts || {})) {
      if (k.startsWith('unit-')) for (const [q, a] of Object.entries(v)) put(['drafts', k, q], a);
      else put(['drafts', k], v);
    }
    for (const [id, m] of Object.entries(state.mock || {})) {
      for (const [q, a] of Object.entries(m.answers || {})) put(['mock', id, 'answers', q], a);
      for (const key of ['started', 'submitted', 'finished']) if (own(m, key)) put(['mock', id, key], m[key]);
    }
    return out;
  }
  const emptyDocument = () => ({ schema: 1, cells: {} });
  function validCell(cell) {
    return plain(cell) && typeof cell.stamp === 'string' && cell.stamp.length > 0 && cell.stamp.length <= 120 && typeof cell.deleted === 'boolean' && Number.isFinite(cell.at) &&
      (cell.deleted ? !own(cell, 'value') : own(cell, 'value') && safeJSON(cell.value));
  }
  function validateDocument(doc) {
    return plain(doc) && doc.schema === 1 && plain(doc.cells) && safeJSON(doc) && Object.keys(doc.cells).length <= MAX_CELLS && bytes(doc) <= MAX_BYTES &&
      Object.entries(doc.cells).every(([p, c]) => pathParts(p) && validCell(c));
  }
  function materialize(doc, blankState) {
    if (!validateDocument(doc)) throw new Error('云端进度格式无效，已保留本机数据。');
    const state = blankState();
    for (const [path, cell] of Object.entries(doc.cells)) {
      if (cell.deleted) continue;
      const p = pathParts(path); if (p[0] === '$reset') continue; let target = state;
      for (let i = 0; i < p.length - 1; i++) { if (!plain(target[p[i]])) target[p[i]] = {}; target = target[p[i]]; }
      target[p[p.length - 1]] = clone(cell.value);
    }
    for (const m of Object.values(state.mock)) if (!plain(m.answers)) m.answers = {};
    // plan/day are separate fields: concurrent plan changes must still yield a valid UI.
    if (![7, 14].includes(state.plan)) throw new Error('云端计划天数无效。');
    state.day = Math.min(state.plan, Math.max(1, Number.isInteger(state.day) ? state.day : 1));
    return state;
  }
  const cellFor = op => op.deleted ? { stamp: op.id, at: op.at, deleted: true } : { stamp: op.id, at: op.at, deleted: false, value: clone(op.value) };
  const sameValue = (cell, op) => cell ? cell.deleted === op.deleted && (cell.deleted || equal(cell.value, op.value)) : op.deleted;
  const globalResetPath = JSON.stringify(['$reset']);
  const isReset = op => pathParts(op.path)?.[0] === '$reset';
  function inResetScope(path, barrier) {
    const p = pathParts(path), b = pathParts(barrier);
    return p[0] !== '$reset' && (b.length === 1 || (p[0] === 'mock' && p[1] === b[2]));
  }
  function applyReset(doc, op) {
    for (const path of Object.keys(doc.cells)) if (inResetScope(path, op.path)) doc.cells[path] = { stamp: op.id, at: op.at, deleted: true };
    doc.cells[op.path] = cellFor(op);
  }
  function barrierContext(doc, path) {
    const p = pathParts(path);
    return { global: doc.cells[globalResetPath]?.stamp || null, entity: p[0] === 'mock' ? doc.cells[JSON.stringify(['$reset', 'mock', p[1]])]?.stamp || null : null };
  }
  function mergePending(remote, operations) {
    if (!validateDocument(remote)) throw new Error('云端进度格式无效。');
    const document = clone(remote), applied = [], accepted = [], rejected = [], conflicts = [];
    for (const op of operations.filter(isReset)) {
      if (remote.cells[op.path]?.stamp === op.id) { accepted.push(op); continue; }
      applyReset(document, op); applied.push(op);
    }
    for (const op of operations.filter(op => !isReset(op))) {
      const current = document.cells[op.path];
      const context = barrierContext(document, op.path);
      const expectedContext = op.context || { global: null, entity: null };
      if (!equal(context, expectedContext)) {
        rejected.push(op);
        conflicts.push({ path: op.path, kind: 'remote-deletion', local: cellFor(op), remote: clone(current || { stamp: context.entity || context.global || 'absent', at: 0, deleted: true }), opId: op.id });
        continue;
      }
      if (sameValue(current, op)) { accepted.push(op); continue; }
      const resetByThisBatch = operations.some(reset => isReset(reset) && inResetScope(op.path, reset.path) && current?.stamp === reset.id);
      if ((current?.stamp || null) === op.baseStamp || resetByThisBatch) { document.cells[op.path] = cellFor(op); applied.push(op); continue; }
      if (op.deleted) {
        // Concurrent deletion wins. Keep the overwritten remote value for explicit recovery.
        document.cells[op.path] = cellFor(op); applied.push(op);
        conflicts.push({ path: op.path, kind: 'local-deletion', local: cellFor(op), remote: clone(current || { stamp: 'absent', at: 0, deleted: true }), opId: op.id });
      } else if (current?.deleted) {
        rejected.push(op);
        conflicts.push({ path: op.path, kind: 'remote-deletion', local: cellFor(op), remote: clone(current), opId: op.id });
      } else {
        conflicts.push({ path: op.path, kind: 'concurrent-edit', local: cellFor(op), remote: clone(current || { stamp: 'absent', at: 0, deleted: true }), opId: op.id });
      }
    }
    return { document, applied, accepted, rejected, conflicts };
  }
  function validConfiguration(config) {
    if (!config?.supabaseUrl || !config?.publishableKey) return { configured: false, message: '云同步尚未配置；现在使用游客模式，进度仅保存在此浏览器。' };
    let url; try { url = new URL(config.supabaseUrl); } catch { return { configured: false, message: 'Supabase 项目网址格式无效。' }; }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') return { configured: false, message: '请配置有效的 HTTPS Supabase 项目根网址。' };
    const key = config.publishableKey.trim();
    if (key.startsWith('sb_secret_')) return { configured: false, message: '配置错误：浏览器禁止使用 Supabase secret/service_role 密钥。' };
    if (key.startsWith('sb_publishable_') && key.length >= 30) return { configured: true, url: url.origin, key };
    try {
      const part = key.split('.')[1];
      const raw = typeof atob === 'function' ? atob(part.replace(/-/g, '+').replace(/_/g, '/')) : Buffer.from(part, 'base64url').toString();
      if (JSON.parse(raw).role === 'anon') return { configured: true, url: url.origin, key };
    } catch { /* Invalid/secret key is never sent to a service. */ }
    return { configured: false, message: '请使用 Supabase publishable key（或 legacy anon key），不能使用服务器密钥。' };
  }
  function createSupabaseAdapter(client) {
    return {
      async read(uid) {
        const { data, error } = await client.from('study_progress').select('revision,document').eq('user_id', uid).maybeSingle();
        if (error) throw error;
        return data || { revision: 0, document: emptyDocument() };
      },
      async cas(uid, revision, document) {
        const { data, error } = await client.rpc('study_sync_cas', { expected_user_id: uid, expected_revision: revision, next_document: document });
        if (error) throw error;
        return data;
      }
    };
  }
  function createCloud(options = {}) {
    const env = options.root || (typeof window !== 'undefined' ? window : {});
    const config = options.config || {};
    let appPath = '/';
    try { appPath = new URL(env.location?.href || 'http://localhost/').pathname.replace(/\/[^/]+\.[^/]+$/, '/'); } catch { /* Default local namespace. */ }
    if (!appPath.endsWith('/')) appPath += '/';
    const appPrefix = PREFIX + 'app:' + encodeURIComponent(appPath) + ':';
    let backend = 'unconfigured';
    try { if (config.supabaseUrl) backend = new URL(config.supabaseUrl).origin; } catch { /* Invalid config remains local. */ }
    const prefix = appPrefix + 'backend:' + encodeURIComponent(backend) + ':';
    const authKey = prefix + 'auth';
    const now = options.now || Date.now;
    const randomId = options.randomId || (() => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + '-' + now()));
    const actor = randomId(); let sequence = 0;
    const timer = options.setTimeout || setTimeout, untimer = options.clearTimeout || clearTimeout;
    const memory = new Map();
    let storage;
    try { storage = options.storage || env.localStorage; } catch { storage = null; }
    let storageError = !storage;
    const readText = key => { if (memory.has(key)) return memory.get(key); try { return storage?.getItem(key) ?? null; } catch { storageError = true; return null; } };
    const writeText = (key, value) => { try { if (!storage) throw Error(); storage.setItem(key, value); memory.delete(key); storageError = false; return true; } catch { memory.set(key, value); storageError = true; return false; } };
    const removeText = key => { memory.delete(key); try { storage?.removeItem(key); } catch { storageError = true; } };
    const keys = () => { const out = new Set(memory.keys()); try { for (let i = 0; i < (storage?.length || 0); i++) out.add(storage.key(i)); } catch { storageError = true; } return [...out].filter(Boolean); };
    const readJSON = key => { try { const text = readText(key); return text ? JSON.parse(text) : null; } catch { return null; } };
    const writeJSON = (key, value) => writeText(key, JSON.stringify(value));
    const listeners = new Set();
    let configuration = validConfiguration(config), client = options.client || null, adapter = options.adapter || null;
    let callbacks, initialized = false, user = null, epoch = 0, document = emptyDocument(), revision = 0, visible;
    let activeSync = null, syncTimer = null, pollTimer = null, recovery = false, deferred = false, localOnly = true;
    let unlisten, destroyed = false, signedOutLatch = false, lastSyncAt = null, liveConflicts = [];
    let authProbe = null, authProbeController = null;
    const authProvider = config.authProvider === 'github' ? 'github' : 'email';
    const status = { user: null, status: 'initializing', message: '正在准备学习进度…', configured: configuration.configured, authProvider, oauthReady: null, oauthChecking: false, oauthMessage: '', pending: 0, conflicts: 0, recovery: false, guestAvailable: false, deferred: false, storageOK: !storageError, lastSyncAt: null };
    const userId = () => user?.id || null;
    const cacheKey = uid => prefix + 'cache:' + uid;
    const opPrefix = uid => prefix + 'op:' + uid + ':';
    const backupPrefix = uid => prefix + 'conflict:' + uid + ':';
    // A later configured backend may explicitly import this app's old visitor progress.
    const guestKey = appPrefix + 'guest';
    function validState(s) { try { return safeJSON(s) && bytes(s) <= MAX_BYTES && callbacks.validateState(s); } catch { return false; } }
    function guestState() {
      const saved = readJSON(guestKey);
      return saved && validState(saved) ? saved : callbacks.blankState();
    }
    function guestAvailable() { try { return !equal(guestState(), callbacks.blankState()); } catch { return false; } }
    function allOps(uid = userId()) {
      if (!uid) return [];
      const out = [];
      for (const key of keys().filter(k => k.startsWith(opPrefix(uid)))) {
        const op = readJSON(key);
        if (op && op.uid === uid && typeof op.id === 'string' && pathParts(op.path) && typeof op.deleted === 'boolean' && Number.isFinite(op.at) && (op.baseStamp === null || typeof op.baseStamp === 'string') && (op.deleted || safeJSON(op.value))) out.push(op);
      }
      return out;
    }
    function selectedOps(uid = userId()) {
      const byPath = new Map();
      for (const op of allOps(uid)) {
        const previous = byPath.get(op.path);
        if (!previous || op.at > previous.at || (op.at === previous.at && op.id > previous.id)) byPath.set(op.path, op);
      }
      return [...byPath.values()];
    }
    function archivedConflicts(uid = userId()) {
      if (!uid) return [];
      return keys().filter(k => k.startsWith(backupPrefix(uid))).map(readJSON).filter(v => v && pathParts(v.path) && validCell(v.local) && validCell(v.remote));
    }
    function getConflicts() {
      const combined = new Map();
      for (const c of [...archivedConflicts(), ...liveConflicts]) combined.set(c.path, c);
      return [...combined.values()].map(c => ({ ...clone(c), field: JSON.parse(c.path).join(' / '), message: c.kind === 'concurrent-edit' ? '同一项在不同设备上分别修改，请选择保留哪一版。' : '并发删除已优先保留；另一版仍可明确恢复。' }));
    }
    function emit(kind, message) {
      status.user = user ? { id: user.id, email: user.email || '' } : null;
      status.status = kind || status.status; status.message = message || status.message;
      status.configured = configuration.configured; status.pending = allOps().length;
      status.conflicts = getConflicts().length; status.recovery = recovery;
      status.guestAvailable = initialized && guestAvailable(); status.deferred = deferred;
      status.storageOK = !storageError; status.lastSyncAt = lastSyncAt; status.localOnly = localOnly;
      // Provider availability is separate from session/sync health: a current session remains usable.
      if (authProvider === 'github' && configuration.configured && !user && status.status !== 'oauth-redirect') {
        if (status.oauthChecking) { status.status = 'oauth-checking'; status.message = '正在确认 GitHub 登录服务；游客学习可继续。'; }
        else if (status.oauthReady === false) { status.status = 'oauth-unavailable'; status.message = 'GitHub 登录待配置；现在可继续游客学习。'; }
        else if (status.oauthReady !== true) { status.status = 'oauth-unknown'; status.message = '未能确认 GitHub 登录服务；可重试，或继续游客学习。'; }
        else if (status.status.startsWith('oauth-')) { status.status = 'guest'; status.message = 'GitHub 登录已启用；游客进度保存在此浏览器。'; }
      }
      if (storageError) { status.status = 'storage-error'; status.message = '浏览器存储不可用或已满；尚未上传的修改可能丢失，请立即导出备份。'; }
      for (const fn of listeners) { try { fn(clone(status)); } catch { /* UI subscribers cannot stop persistence. */ } }
      return clone(status);
    }
    function saveCache() { if (userId()) writeJSON(cacheKey(userId()), { schema: 1, revision, document }); }
    function currentState() {
      if (!userId()) return guestState();
      const projected = clone(document);
      const ops = selectedOps();
      for (const op of ops.filter(isReset)) applyReset(projected, op);
      for (const op of ops.filter(op => !isReset(op))) projected.cells[op.path] = cellFor(op);
      return materialize(projected, callbacks.blankState);
    }
    function publish(reason, forceRender = false) {
      const state = currentState();
      if (!validState(state)) throw new Error('合并后的进度无效，未覆盖当前作答。');
      if (!forceRender && visible && equal(state, visible)) { deferred = false; return; }
      const accepted = callbacks.applyState(clone(state), { reason, forceRender });
      if (accepted === false && !forceRender) { deferred = true; return; }
      visible = clone(state); deferred = false;
    }
    function schedule(delay = 900) {
      if (syncTimer) untimer(syncTimer);
      if (userId() && configuration.configured) syncTimer = timer(() => { syncTimer = null; syncNow().catch(() => {}); }, delay);
    }
    function putOp(path, value, deleted, previous) {
      const id = actor + ':' + (++sequence) + ':' + randomId();
      const projected = clone(document);
      for (const reset of selectedOps().filter(isReset)) projected.cells[reset.path] = cellFor(reset);
      const op = { uid: userId(), id, origin: previous?.origin || id, path, baseStamp: previous ? previous.baseStamp : document.cells[path]?.stamp || null, context: barrierContext(projected, path), at: now(), deleted };
      if (!deleted) op.value = clone(value);
      // Each operation has its own immutable storage key. Two tabs cannot erase each other's outboxes.
      if (!writeJSON(opPrefix(userId()) + id, op)) return false;
      if (previous) removeText(opPrefix(userId()) + previous.id);
      return true;
    }
    function save(state) {
      if (!initialized || !validState(state)) throw new Error('学习进度格式无效，未覆盖已有记录。');
      const next = clone(state);
      if (!userId()) {
        writeJSON(guestKey, next); visible = next;
        emit(configuration.configured ? 'guest' : 'unconfigured', configuration.configured ? '游客进度保存在此浏览器。登录后可主动选择导入。' : configuration.message);
        return !storageError;
      }
      const before = flattenState(visible || callbacks.blankState()), after = flattenState(next);
      const resets = [];
      if (visible && equal(next, callbacks.blankState()) && !equal(visible, next)) resets.push(globalResetPath);
      else for (const [id, oldMock] of Object.entries(visible?.mock || {})) {
        const newMock = next.mock[id];
        if (newMock && (oldMock.started != null || Object.keys(oldMock.answers || {}).length) && newMock.started == null && !newMock.submitted && !Object.keys(newMock.answers || {}).length) resets.push(JSON.stringify(['$reset', 'mock', id]));
      }
      for (const reset of resets) {
        for (const op of allOps()) if (inResetScope(op.path, reset)) removeText(opPrefix(userId()) + op.id);
        putOp(reset, true, false, selectedOps().find(op => op.path === reset));
      }
      const pending = new Map(selectedOps().map(op => [op.path, op]));
      for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const existsBefore = own(before, path), existsAfter = own(after, path);
        if (existsBefore === existsAfter && (!existsAfter || equal(before[path], after[path]))) continue;
        const previous = pending.get(path);
        putOp(path, after[path], !existsAfter, previous);
      }
      visible = next;
      emit('pending', '修改已保存到本机，等待同步。'); schedule();
      return !storageError;
    }
    function checkRow(row) {
      if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 || !validateDocument(row.document)) throw new Error('云端返回了无法识别的进度，已保留本机作答。');
      if (!validState(materialize(row.document, callbacks.blankState))) throw new Error('云端进度内容不符合工作台格式。');
      return row;
    }
    function cleanUpOperations(ops, committed, uid) {
      for (const op of ops) {
        removeText(opPrefix(uid) + op.id);
        // An input event may have produced a newer local operation while this request was in flight.
        for (const newer of allOps(uid)) if (newer.path === op.path && newer.origin === op.origin && newer.id !== op.id) {
          newer.baseStamp = committed.cells[op.path]?.stamp || null; newer.origin = newer.id;
          writeJSON(opPrefix(uid) + newer.id, newer);
        }
      }
    }
    async function syncNow() {
      if (!initialized || destroyed) return clone(status);
      if (!userId() || !configuration.configured || !adapter) { emit(configuration.configured ? 'guest' : 'unconfigured', configuration.message || '游客进度仅保存在此浏览器。'); return clone(status); }
      if (activeSync) return activeSync;
      const uid = userId(), generation = epoch;
      const stillCurrent = () => !destroyed && generation === epoch && userId() === uid;
      const task = (async () => {
        emit('syncing', '正在与云端核对学习进度…');
        try {
          let row = checkRow(await adapter.read(uid));
          if (!stillCurrent()) return clone(status);
          let result;
          for (let attempt = 0; attempt < 4; attempt++) {
            const ops = selectedOps(uid);
            result = mergePending(row.document, ops);
            if (!result.applied.length) break;
            if (!validateDocument(result.document) || !validState(materialize(result.document, callbacks.blankState))) throw new Error('待同步进度过大或无效，请导出备份后检查。');
            const reply = checkRow(await adapter.cas(uid, row.revision, result.document));
            if (!stillCurrent()) return clone(status);
            if (reply.ok === true) { row = reply; break; }
            if (reply.ok !== false) throw new Error('云同步接口版本不匹配。');
            row = reply;
            if (attempt === 3) throw new Error('其他设备正在连续更新；本机修改已保留，将稍后重试。');
          }
          if (!stillCurrent()) return clone(status);
          document = clone(row.document); revision = row.revision;
          cleanUpOperations([...result.applied, ...result.accepted], document, uid);
          // A remote tombstone never gets silently recreated by an older offline edit.
          for (const op of result.rejected) removeText(opPrefix(uid) + op.id);
          for (const c of result.conflicts) if (c.kind !== 'concurrent-edit') writeJSON(backupPrefix(uid) + c.opId, c);
          liveConflicts = result.conflicts.filter(c => c.kind === 'concurrent-edit');
          saveCache(); lastSyncAt = new Date(now()).toISOString(); localOnly = false;
          publish('sync');
          const count = getConflicts().length;
          emit(count ? 'conflict' : allOps(uid).length ? 'pending' : 'synced', count ? `有 ${count} 项修改需要选择保留版本；其他项目已同步。` : deferred ? '云端有更新，离开输入框后将应用。' : allOps(uid).length ? '本机仍有待同步修改。' : '学习进度已同步。');
          if (allOps(uid).length && !liveConflicts.length) schedule(1500);
          return clone(status);
        } catch (error) {
          if (!stillCurrent()) return clone(status);
          localOnly = true;
          const message = friendlyError(error);
          emit('offline', '暂未同步：' + message + ' 本机修改已保留，恢复连接后重试。');
          return clone(status);
        }
      })();
      activeSync = task;
      try { return await task; } finally { if (activeSync === task) activeSync = null; }
    }
    function friendlyError(error) {
      const code = error?.code || '', message = String(error?.message || '网络不可用');
      if (/PGRST202|PGRST205|42P01|42883/.test(code) || /Could not find.*(?:function|table)/i.test(message)) return '云端数据表或同步函数尚未配置。';
      if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确。';
      if (/email not confirmed/i.test(message)) return '请先完成邮箱验证。';
      if (/rate limit|too many requests/i.test(message)) return '请求较频繁，请稍后重试。';
      if (/fetch|network|timeout/i.test(message)) return '网络连接暂时不可用。';
      if (/JWT|session.*missing|refresh token/i.test(message)) return '登录已过期，请重新登录。';
      return message.slice(0, 240);
    }
    async function adoptSession(session, reason = 'account') {
      if (signedOutLatch && session) return;
      const nextUser = session?.user || null;
      if ((nextUser?.id || null) === userId() && visible) { user = nextUser; if (!user) emit(configuration.configured ? 'guest' : 'unconfigured', configuration.configured ? '游客进度保存在此浏览器。' : configuration.message); else emit(); return; }
      epoch++; user = nextUser; activeSync = null; liveConflicts = []; document = emptyDocument(); revision = 0;
      if (syncTimer) untimer(syncTimer); syncTimer = null;
      if (userId()) {
        const cached = readJSON(cacheKey(userId()));
        if (cached?.schema === 1 && Number.isSafeInteger(cached.revision) && validateDocument(cached.document)) {
          document = cached.document; revision = cached.revision;
        }
        localOnly = true; publish(reason, true); emit('loading', '已登录，正在读取此账号的进度…');
        await syncNow();
      } else {
        recovery = false; localOnly = true; publish(reason, true);
        emit(configuration.configured ? 'guest' : 'unconfigured', configuration.configured ? '已进入游客模式；账号进度与游客进度分别保存。' : configuration.message);
      }
    }
    function redirectURL(recoveryLink = false) {
      const url = new URL(env.location?.href || 'http://localhost/');
      url.hash = ''; url.search = '';
      if (recoveryLink) url.searchParams.set('auth', 'recovery');
      return url.href;
    }
    function requireClient() { if (!configuration.configured || !client) throw new Error(configuration.message || '云同步尚未配置。'); }
    function refreshAuthSettings() {
      if (authProvider !== 'github' || !configuration.configured || destroyed) return Promise.resolve(clone(status));
      if (authProbe) return authProbe;
      if (status.status === 'oauth-redirect') status.status = 'guest';
      status.oauthChecking = true; status.oauthReady = null; status.oauthMessage = '正在确认 GitHub 登录服务…'; emit();
      const fetcher = options.fetch || env.fetch?.bind(env);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      authProbeController = controller;
      let timeout;
      const request = Promise.resolve().then(async () => {
        if (!fetcher) throw new Error('Settings fetch is unavailable');
        const response = await fetcher(configuration.url + '/auth/v1/settings', { method: 'GET', headers: { apikey: configuration.key }, cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) throw new Error('Settings request failed');
        const settings = await response.json();
        if (typeof settings?.external?.github !== 'boolean') throw new Error('Provider status is missing');
        return settings.external.github;
      });
      const deadline = new Promise((_, reject) => { timeout = timer(() => { controller?.abort(); reject(new Error('Settings request timed out')); }, 8000); });
      authProbe = Promise.race([request, deadline]).then(ready => {
        status.oauthReady = ready;
        status.oauthMessage = ready ? 'GitHub 登录已启用。' : 'GitHub 登录待配置。站点管理员启用后即可登录，游客学习不受影响。';
      }, () => {
        status.oauthReady = null;
        status.oauthMessage = '未能确认 GitHub 登录服务，请检查网络后重试；游客学习仍可继续。';
      }).then(() => {
        untimer(timeout); status.oauthChecking = false; authProbe = null; authProbeController = null;
        return destroyed ? clone(status) : emit();
      });
      return authProbe;
    }
    function credentials(email, password) {
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('请输入有效邮箱。');
      if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 256)) throw new Error('密码长度应为 8–256 个字符。');
    }
    async function authCall(method, payload, extra) {
      requireClient();
      const { data, error } = await client.auth[method](payload, extra);
      if (error) throw new Error(friendlyError(error));
      return data;
    }
    async function signIn(email, password) {
      credentials(email, password); signedOutLatch = false;
      const data = await authCall('signInWithPassword', { email: email.trim(), password });
      if (!data?.session) throw new Error('未收到有效登录会话，请重试。');
      await adoptSession(data.session); client.auth.startAutoRefresh?.(); return clone(status);
    }
    async function signInWithGitHub() {
      requireClient();
      if (authProvider !== 'github') throw new Error('当前站点未启用 GitHub 登录方式。');
      await refreshAuthSettings();
      if (status.oauthReady !== true) throw new Error(status.oauthMessage);
      signedOutLatch = false;
      try {
        await authCall('signInWithOAuth', { provider: 'github', options: { redirectTo: redirectURL() } });
      } catch (error) {
        status.oauthReady = null; status.oauthMessage = 'GitHub 登录未能发起，请重新检测登录服务后再试。';
        emit(); throw error;
      }
      return emit('oauth-redirect', '正在前往 GitHub 完成登录；请在返回本站后继续学习。');
    }
    async function signUp(email, password) {
      credentials(email, password); signedOutLatch = false;
      const data = await authCall('signUp', { email: email.trim(), password, options: { emailRedirectTo: redirectURL() } });
      if (data?.session) await adoptSession(data.session);
      else emit('confirm-email', '注册请求已提交。若邮箱可用于注册，请打开验证邮件后再登录；也请检查垃圾邮件。');
      return clone(status);
    }
    async function resetPassword(email) {
      credentials(email);
      await authCall('resetPasswordForEmail', email.trim(), { redirectTo: redirectURL(true) });
      emit('reset-email', '重置请求已提交。如果该邮箱已注册，请查收重置邮件。'); return clone(status);
    }
    async function updatePassword(password) {
      if (!userId()) throw new Error('请先打开邮箱中的密码重置链接，或登录账号。');
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('密码长度应为 8–256 个字符。');
      await authCall('updateUser', { password }); recovery = false;
      emit('password-updated', '密码已更新。'); return clone(status);
    }
    async function signOut() {
      requireClient();
      signedOutLatch = true; epoch++; activeSync = null;
      if (syncTimer) untimer(syncTimer); syncTimer = null;
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* Local credential removal below is mandatory even offline. */ }
      client.auth.stopAutoRefresh?.(); removeText(authKey); removeText(authKey + '-code-verifier');
      await adoptSession(null); emit('guest', '已在此设备退出；未上传修改仍隔离保存在原账号的本机队列。');
      return clone(status);
    }
    async function importGuest() {
      if (!userId()) throw new Error('请先登录要导入的账号。');
      // Explicit user action: import non-default guest fields. Existing account fields are not silently replaced.
      const guest = flattenState(guestState()), defaults = flattenState(callbacks.blankState());
      const current = flattenState(currentState()); let count = 0;
      for (const [path, value] of Object.entries(guest)) {
        if (own(defaults, path) && equal(defaults[path], value)) continue;
        if (own(current, path) && equal(current[path], value)) continue;
        const previous = selectedOps().find(op => op.path === path);
        if (own(current, path) && !(own(defaults, path) && equal(current[path], defaults[path]))) {
          const id = actor + ':guest:' + randomId();
          const op = { uid: userId(), id, origin: id, path, baseStamp: 'explicit-guest-import-conflict', context: barrierContext(document, path), at: now(), deleted: false, value };
          writeJSON(opPrefix(userId()) + id, op);
        } else putOp(path, value, false, previous);
        count++;
      }
      publish('guest-import', true); emit('pending', `已导入 ${count} 项游客进度；重叠修改会保留两版供选择。`);
      await syncNow(); return clone(status);
    }
    async function resolveConflict(path, choice) {
      if (!userId() || !['local', 'remote'].includes(choice)) throw new Error('请选择有效的冲突处理方式。');
      const conflict = getConflicts().find(c => c.path === path);
      if (!conflict) throw new Error('该冲突已处理，请刷新列表。');
      const desired = conflict[choice];
      for (const op of allOps()) if (op.path === path) removeText(opPrefix(userId()) + op.id);
      for (const key of keys().filter(k => k.startsWith(backupPrefix(userId())))) if (readJSON(key)?.path === path) removeText(key);
      liveConflicts = liveConflicts.filter(c => c.path !== path);
      if (!sameValue(document.cells[path], desired)) putOp(path, desired.value, desired.deleted, null);
      publish('conflict', true); await syncNow(); return clone(status);
    }
    async function init(input) {
      if (initialized) return clone(status);
      if (!input || ['getState', 'applyState', 'blankState', 'validateState'].some(k => typeof input[k] !== 'function')) throw new Error('StudyCloud.init 缺少必要的工作台接口。');
      callbacks = input; initialized = true;
      if (!readText(guestKey)) {
        const legacy = readJSON('english-studio-v1');
        writeJSON(guestKey, legacy && validState(legacy) ? legacy : callbacks.blankState());
      }
      publish('initial', true);
      if (configuration.configured && !client && options.sdk?.createClient) {
        client = options.sdk.createClient(configuration.url, configuration.key, { auth: {
          storageKey: authKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
          flowType: 'implicit', storage: { getItem: readText, setItem: writeText, removeItem: removeText }
        } });
      }
      if (configuration.configured && !client) configuration = { configured: false, message: '登录组件未能加载；请刷新或联系站点维护者。游客进度仍可保存。' };
      if (!configuration.configured) { emit('unconfigured', configuration.message); return clone(status); }
      if (authProvider === 'github') refreshAuthSettings();
      if (!adapter) adapter = createSupabaseAdapter(client);
      const subscription = client.auth.onAuthStateChange((event, session) => {
        // The SDK's auth lock must not be re-entered from its synchronous callback.
        timer(() => {
          if (destroyed) return;
          if (event === 'PASSWORD_RECOVERY') recovery = true;
          adoptSession(session).then(() => { if (event === 'PASSWORD_RECOVERY') emit('recovery', '请设置新密码。'); }).catch(e => emit('error', friendlyError(e)));
        }, 0);
      });
      unlisten = () => subscription?.data?.subscription?.unsubscribe();
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await adoptSession(data?.session || null, 'initial');
      } catch (error) { emit('error', friendlyError(error)); }
      const wake = () => { if (!destroyed) syncNow().catch(() => {}); };
      const visibility = () => { if (!env.document || env.document.visibilityState === 'visible') wake(); };
      const storageChanged = event => { if (userId() && (event.key?.startsWith(opPrefix(userId())) || event.key === cacheKey(userId()))) { emit(); schedule(500); } };
      env.addEventListener?.('online', wake); env.addEventListener?.('focus', wake); env.addEventListener?.('storage', storageChanged);
      env.document?.addEventListener?.('visibilitychange', visibility);
      const interval = Math.min(120000, Math.max(5000, Number(config.pollIntervalMs) || 20000));
      function poll() { if (destroyed) return; visibility(); pollTimer = timer(poll, interval); }
      pollTimer = timer(poll, interval);
      api._cleanup = () => {
        env.removeEventListener?.('online', wake); env.removeEventListener?.('focus', wake); env.removeEventListener?.('storage', storageChanged);
        env.document?.removeEventListener?.('visibilitychange', visibility);
      };
      return clone(status);
    }
    const api = {
      storageNamespace: prefix, guestStorageKey: guestKey,
      init, save, syncNow, signIn, signInWithGitHub, refreshAuthSettings, signUp, resetPassword, updatePassword, signOut, importGuest, getConflicts, resolveConflict,
      onStatus(fn) { listeners.add(fn); fn(clone(status)); return () => listeners.delete(fn); },
      getStatus() { return clone(status); },
      destroy() { destroyed = true; epoch++; authProbeController?.abort(); if (syncTimer) untimer(syncTimer); if (pollTimer) untimer(pollTimer); unlisten?.(); api._cleanup?.(); listeners.clear(); },
    };
    return api;
  }
  return { createCloud, flattenState, materialize, validateDocument, mergePending, validConfiguration, emptyDocument, PREFIX, AUTH_KEY };
});
