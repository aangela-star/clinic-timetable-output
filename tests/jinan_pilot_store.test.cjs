const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createPilotStore } = require('../lib/jinan-pilot-store');
const { pilotHarness } = require('./helpers/pilot-state-harness.cjs');
const sha = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const backend = pilotHarness();
  const store = createPilotStore({ request: backend.request, secret: 'mock-secret' });
  const bytes = Buffer.from('original image');
  const input = { backup: { note: '<p>original</p>', publicHtml: 'page'.repeat(30000), bytes,
    imageUrl: 'https://www.tainanrehab.com/upload/old.jpeg', imageSha256: sha(bytes), contentType: 'image/jpeg' },
    originalImageHtml: '<img src="/upload/old.jpeg" style="width:1280px;height:720px">',
    originalSrc: '/upload/old.jpeg', originalStyle: 'width:1280px;height:720px', pngSha256: sha('new PNG') };
  return { backend, store, input };
}
test('durable backup is chunked and recoverable from a new instance with exact bytes and attributes', async () => {
  const { backend, store, input } = fixture();
  await store.prepare(input);
  assert.ok(backend.rows.length > 2);
  const restarted = createPilotStore({ request: backend.request, secret: 'mock-secret' });
  const state = await restarted.read();
  assert.equal(state.phase, 'PREPARED');
  const backup = await restarted.recover(state.attemptId);
  assert.deepEqual(Buffer.from(backup.imageBase64, 'base64'), input.backup.bytes);
  assert.equal(backup.publicHtml, input.backup.publicHtml);
  assert.equal(backup.originalImageHtml, input.originalImageHtml);
  assert.equal(backup.originalStyle, input.originalStyle);
  assert.equal(backend.control.locked, false);
});
test('only one instance can reserve the target; repeated prepare and dispatch cannot succeed', async () => {
  const { backend, store, input } = fixture();
  const other = createPilotStore({ request: backend.request, secret: 'mock-secret' });
  const results = await Promise.allSettled([store.prepare(input), other.prepare(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await store.advance('PREPARED', 'UPLOAD_DISPATCHED');
  await assert.rejects(store.advance('PREPARED', 'UPLOAD_DISPATCHED'));
  await assert.rejects(other.advance('UPLOAD_DISPATCHED', 'UPLOADED', '/upload/new.png'));
  assert.equal((await other.read()).phase, 'UPLOAD_DISPATCHED');
});
test('interrupted preparation remains reserved; no restart clears ambiguous state', async () => {
  const { backend, store, input } = fixture(); backend.control.failWrite = true;
  await assert.rejects(store.prepare(input));
  assert.equal((await store.read()).phase, 'PREPARING');
  backend.control.failWrite = false;
  await assert.rejects(createPilotStore({ request: backend.request, secret: 'mock-secret' }).prepare(input));
  assert.equal(backend.control.locked, false);
});
test('lost dispatch acknowledgement leaves durable pre-dispatch state and prevents retry', async () => {
  const { backend, store, input } = fixture(); await store.prepare(input);
  const state = await store.read();
  const lost = createPilotStore({ secret: 'mock-secret', attemptId: state.attemptId, request: async body => {
    await backend.request(body); throw new Error('lost acknowledgement');
  } });
  await assert.rejects(lost.advance('PREPARED', 'UPLOAD_DISPATCHED'));
  assert.equal((await store.read()).phase, 'UPLOAD_DISPATCHED');
  await assert.rejects(store.advance('PREPARED', 'UPLOAD_DISPATCHED'));
});
test('backup tampering fails hash verification', async () => {
  const { backend, store, input } = fixture(); await store.prepare(input);
  const state = await store.read(); backend.rows[1][2] = 'YQ==';
  await assert.rejects(store.recover(state.attemptId));
});
test('authentication, disabled feature, lock failure and unsupported operations fail closed', async () => {
  const { backend, store } = fixture();
  await assert.rejects(createPilotStore({ request: backend.request, secret: 'wrong' }).read());
  backend.props.JINAN_PILOT_STATE_ENABLED = 'false'; await assert.rejects(store.read());
  backend.props.JINAN_PILOT_STATE_ENABLED = 'true'; backend.control.locked = true; await assert.rejects(store.read());
  backend.control.locked = false;
  for (const op of ['delete', 'reset', 'release']) assert.equal((await backend.request({ action: 'jinanPilotState', secret: 'mock-secret', op })).ok, false);
  assert.equal(backend.control.locked, false);
});
test('full transition chain survives restarts and has no expiry or implicit next attempt', async () => {
  const { store, input } = fixture(); await store.prepare(input);
  await store.advance('PREPARED', 'UPLOAD_DISPATCHED');
  await store.advance('UPLOAD_DISPATCHED', 'UPLOADED', '/upload/new.png');
  await store.advance('UPLOADED', 'SUBMIT_DISPATCHED');
  await store.advance('SUBMIT_DISPATCHED', 'VERIFIED');
  assert.equal((await store.read()).phase, 'VERIFIED');
  await assert.rejects(store.prepare(input));
});

test('corrupt backup blocks mutation dispatch under the same lock', async () => {
  const { backend, store, input } = fixture(); await store.prepare(input);
  backend.rows[1][2] = 'YQ==';
  await assert.rejects(store.advance('PREPARED', 'UPLOAD_DISPATCHED'));
  assert.equal((await store.read()).phase, 'PREPARED');
  assert.equal(backend.control.locked, false);
});
test('oversized backup fails before reservation or any sheet write', async () => {
  const { backend, store, input } = fixture(); input.backup.publicHtml = 'a'.repeat(2000001);
  await assert.rejects(store.prepare(input));
  assert.equal(await store.read(), null);
  assert.equal(backend.rows.length, 0);
});

test('malformed successful state responses cannot be treated as an empty store', async () => {
  for (const result of [{ ok: true }, { ok: true, state: false }, { ok: true, state: { phase: 'unknown' } }]) {
    const store = createPilotStore({ secret: 'mock-secret', request: async () => result });
    await assert.rejects(store.read());
  }
});
