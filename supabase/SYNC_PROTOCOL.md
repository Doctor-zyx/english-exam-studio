# Account and sync implementation

`dist/cloud.js` exposes `window.StudyCloud`. Load `config.js`, the pinned local Supabase SDK, and `cloud.js` before the app integration. Empty configuration deliberately leaves the app in visitor mode.

## Integration contract

```js
await StudyCloud.init({
  getState: () => state,
  blankState,
  validateState,
  applyState(next, { reason, forceRender }) {
    // Return false to defer a non-forced update while the learner is typing.
    // Do not replace state when returning false: existing input callbacks may
    // hold references to nested objects in the old state.
    state = next;
    render();
    return true;
  }
});
StudyCloud.save(state); // synchronous local outbox; debounced remote sync
```

`onStatus(callback)` immediately sends the current status and returns an unsubscribe function. Status includes `user`, `status`, `message`, `configured`, `pending`, `conflicts`, `recovery`, `guestAvailable`, `deferred`, `storageOK`, `lastSyncAt`, and `localOnly`.

Authentication methods are `signIn(email,password)`, `signUp(email,password)`, `resetPassword(email)`, `updatePassword(password)`, and `signOut()`. The official SDK owns sessions, refresh tokens, and recovery events. `signOut` affects the current device, preserving that account's unsent local operations separately from visitor data.

`syncNow()` checks the server. `importGuest()` is an explicit import; login never automatically imports a visitor or another account's progress. Existing overlapping values become conflicts.

`getConflicts()` returns entries with `path`, `field`, `kind`, `message`, and `local`/`remote` cells. A cell is `{stamp,at,deleted,value?}`. Display `value` (or a deletion label), not the whole metadata object. Use `resolveConflict(path,'local'|'remote')` only after the learner chooses a version. Drafts can be long; display a scrollable preview or provide a full-text download.

## Data integrity

- Local cache, authentication, and operation keys include the Supabase project origin and the site's pathname. Account data additionally includes the authenticated user ID. Visitor storage is specific to the site pathname.
- Independent answers and checks merge separately. Word-review and mistake records are atomic to avoid creating incomplete records. Concurrent edits to the same field retain both versions and require a choice.
- Local operations are stored under unique immutable journal keys. Tabs sharing `localStorage` cannot overwrite a single shared outbox blob.
- Each operation records the server field stamp it was based on. Wall-clock timestamps are presentation metadata, not the remote conflict-resolution rule.
- The server RPC locks the caller's row and checks its revision before replacing the document. On a concurrent revision change, the client re-reads and re-merges; it does not overwrite the new document.
- The RPC additionally requires `expected_user_id = auth.uid()` so a delayed request cannot write an old account's document after the browser changes accounts.
- Deletions remain as tombstones. Whole-app and whole-paper resets add scope markers so previously unseen answers from an offline device cannot silently return. The losing concurrent edit remains recoverable through explicit conflict resolution.
- A response acknowledging an older save rebases newer typing on that acknowledgement instead of clearing the newer operation.
- `applyState` can defer a remote update while typing or playing audio. The next `syncNow` retries. New local diffs compare with the last actually displayed state, so deferred remote fields are not accidentally sent back as edits.

## Backend access

Apply `schema.sql` to the real project. The table has owner-only SELECT/INSERT/UPDATE policies using `auth.uid()`, with both `USING` and `WITH CHECK` on UPDATE. Anonymous callers have no grants. There is no DELETE grant; tombstones preserve deletion history. The CAS function uses `security invoker`, a pinned empty search path, and no default PUBLIC execute permission.

Direct writes are limited to the authenticated owner's row by RLS. The application uses the CAS RPC for revision integrity. The browser accepts only a publishable key or legacy anon key; secret/service-role keys are rejected by configuration validation.

The pinned SDK is `@supabase/supabase-js` **2.118.0**. `tools/vendor-supabase.py` downloads that exact package without running npm scripts and verifies the npm SHA-512 integrity. `dist/vendor/supabase-lock.json` also records the bundle SHA-256; its MIT license is included.

## Validation boundary

`node --test tests/cloud.test.cjs` currently passes 24 tests covering merges, same-field conflicts, deletion/reset barriers, account switches during requests, offline reload, tab journals, visitor import, deferred UI updates, storage failure, recovery events, and project namespaces. These are deterministic transport/auth simulations plus structural SQL checks. They are not a live Supabase deployment test.

Before claiming production synchronization, configure the real project and test registration/email delivery, password recovery, anonymous denial, two real accounts' RLS isolation, and two devices' progress with the production URL. The deployment guide describes that remaining verification.

Official references used:

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database function security](https://supabase.com/docs/guides/database/functions)
- [Browser API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Auth state changes](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Password reset](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Automatic token refresh](https://supabase.com/docs/reference/javascript/auth-startautorefresh)
