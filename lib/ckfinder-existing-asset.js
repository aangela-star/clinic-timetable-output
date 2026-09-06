'use strict';

// Local contract adapter only: no default network transport, environment secrets,
// route registration, page editor, upload, delete, or automatic restore.
const { createHash } = require('node:crypto');
const { parsePngDataUrl, MAX_PNG_BYTES } = require('./publish-contract');
const ORIGIN = 'https://www.tainanrehab.com';
const CONNECTOR = `${ORIGIN}/scripts/ckfinder/core/connector/php/connector.php`;
const NAME = 'photo_2026-09-02 23_08_57(1).jpeg';
const TARGET_URL = `${ORIGIN}/upload/${encodeURIComponent(NAME)}`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function stagingFolder(value) {
  // Restrict the first implementation to one existing, non-root staging folder.
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_-]+\/$/.test(value)) throw new Error('INVALID_STAGING_FOLDER');
  return value;
}

function buildCopyRequest(folder, destination = '/') {
  const source = stagingFolder(folder);
  if (destination !== '/') throw new Error('INVALID_DESTINATION');
  const url = new URL(CONNECTOR);
  url.searchParams.set('command', 'CopyFiles');
  url.searchParams.set('type', 'Images');
  url.searchParams.set('currentFolder', destination);
  const body = new URLSearchParams({
    'files[0][name]': NAME,
    'files[0][type]': 'Images',
    'files[0][folder]': source,
    'files[0][options]': 'overwrite',
  });
  return Object.freeze({ method: 'POST', url: url.href,
    headers: Object.freeze({ 'content-type': 'application/x-www-form-urlencoded' }), body: body.toString() });
}

function publicReadRequest(url) {
  return Object.freeze({ method: 'GET', url, credentials: 'omit', redirect: 'error',
    headers: Object.freeze({ 'cache-control': 'no-cache, no-store', pragma: 'no-cache' }) });
}

function checkedBytes(response, url, mime) {
  if (!response || response.status !== 200 || response.url !== url || response.location != null
      || response.contentType !== mime || !Buffer.isBuffer(response.bytes)
      || !response.bytes.length || response.bytes.length > MAX_PNG_BYTES) throw new Error('INVALID_PUBLIC_ASSET');
  return Buffer.from(response.bytes);
}

// Deliberately narrow mock XML fixture contract. Real CKFinder 2.0.1 response
// must be captured/read and reviewed before a production transport is added.
function copySucceeded(response, url) {
  return Boolean(response && response.status === 200 && response.url === url
    && response.location == null && response.contentType === 'text/xml'
    && typeof response.body === 'string'
    && /^\s*<Connector resourceType="Images"><CopyFiles copied="1"\s*\/><Error number="0"\s*\/><\/Connector>\s*$/.test(response.body));
}

async function simulateOverwrite({ mode, pngDataUrl, folder, anonymousRead, copy, preserveBackup } = {}) {
  if (mode !== 'mock' || typeof anonymousRead !== 'function' || typeof copy !== 'function'
      || typeof preserveBackup !== 'function') return { status: 'CONTRACT_ONLY' };
  let dispatched = false;
  try {
    const sourceFolder = stagingFolder(folder);
    const png = parsePngDataUrl(pngDataUrl).png;
    const expected = hash(png);
    const sourceUrl = `${ORIGIN}/upload${sourceFolder}${encodeURIComponent(NAME)}`;
    const request = buildCopyRequest(sourceFolder);
    // Existing staged asset must use the exact destination basename and bytes.
    // No QuickUpload, renaming, encoding conversion, or root-folder upload.
    const staged = checkedBytes(await anonymousRead(publicReadRequest(sourceUrl)), sourceUrl, 'image/png');
    if (hash(staged) !== expected) throw new Error('STAGING_MISMATCH');
    // Preserve original content, including an earlier successful PNG overwrite.
    const beforeResponse = await anonymousRead(publicReadRequest(TARGET_URL));
    if (!['image/jpeg', 'image/png'].includes(beforeResponse?.contentType)) throw new Error('INVALID_BACKUP');
    const before = checkedBytes(beforeResponse, TARGET_URL, beforeResponse.contentType);
    const originalHash = hash(before);
    const receipt = await preserveBackup({ url: TARGET_URL, bytes: Buffer.from(before),
      sha256: originalHash, contentType: beforeResponse.contentType });
    if (receipt?.sha256 !== originalHash || receipt?.verified !== true) throw new Error('BACKUP_UNVERIFIED');
    // Optimistic drift checks are not a server-side lock or atomic replacement.
    const fresh = checkedBytes(await anonymousRead(publicReadRequest(TARGET_URL)), TARGET_URL, beforeResponse.contentType);
    if (hash(fresh) !== originalHash) throw new Error('TARGET_CHANGED');
    const freshSource = checkedBytes(await anonymousRead(publicReadRequest(sourceUrl)), sourceUrl, 'image/png');
    if (hash(freshSource) !== expected) throw new Error('STAGING_CHANGED');
    dispatched = true;
    const result = await copy(request);
    if (!copySucceeded(result, request.url)) return { status: 'MANUAL_CHECK_REQUIRED', targetUrl: TARGET_URL };
    const published = checkedBytes(await anonymousRead(publicReadRequest(TARGET_URL)), TARGET_URL, 'image/png');
    if (hash(published) !== expected) return { status: 'MANUAL_CHECK_REQUIRED', targetUrl: TARGET_URL };
    return { status: 'VERIFIED_MOCK', targetUrl: TARGET_URL };
  } catch (_) {
    // Once CopyFiles was dispatched, outcome is ambiguous: never retry writes.
    return { status: dispatched ? 'MANUAL_CHECK_REQUIRED' : 'PRECONDITION_FAILED', targetUrl: TARGET_URL };
  }
}

module.exports = { TARGET_URL, NAME, buildCopyRequest, simulateOverwrite };
