const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function getFunctionBody(source, functionName) {
  const declarationPattern = new RegExp(`const\\s+${functionName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`);
  const declarationMatch = declarationPattern.exec(source);
  if (!declarationMatch) return '';

  let depth = 1;
  let cursor = declarationMatch.index + declarationMatch[0].length;
  while (cursor < source.length && depth > 0) {
    const char = source[cursor];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    cursor += 1;
  }

  return source.slice(declarationMatch.index + declarationMatch[0].length, cursor - 1);
}

function getFunctionSource(source, functionName) {
  const declarationPattern = new RegExp(`const\\s+${functionName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`);
  const declarationMatch = declarationPattern.exec(source);
  if (!declarationMatch) return '';

  let depth = 1;
  let cursor = declarationMatch.index + declarationMatch[0].length;
  while (cursor < source.length && depth > 0) {
    const char = source[cursor];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    cursor += 1;
  }

  return source.slice(declarationMatch.index, cursor);
}

test('publish confirmation UI source contracts are wired end-to-end', () => {
  const missingContracts = [];

  const clinicOrderScriptIndex = indexHtml.indexOf('<script src="clinic-order.js"></script>');
  const publishCoreScriptIndex = indexHtml.indexOf('<script src="publish-core.js"></script>');
  const babelScriptIndex = indexHtml.indexOf('<script src="https://unpkg.com/@babel/standalone@8.0.4/babel.min.js"></script>');

  if (
    publishCoreScriptIndex === -1 ||
    clinicOrderScriptIndex === -1 ||
    babelScriptIndex === -1 ||
    !(clinicOrderScriptIndex < publishCoreScriptIndex && publishCoreScriptIndex < babelScriptIndex)
  ) {
    missingContracts.push('publish-core.js is loaded after clinic-order.js and before Babel');
  }

  if (!/\[\s*isPublishDialogOpen\s*,\s*setIsPublishDialogOpen\s*\]\s*=\s*useState\s*\(\s*false\s*\)/.test(indexHtml)) {
    missingContracts.push('App state isPublishDialogOpen defaults false');
  }

  if (!/\[\s*selectedPublishChannelIds\s*,\s*setSelectedPublishChannelIds\s*\]\s*=\s*useState\s*\(\s*\[\s*\]\s*\)/.test(indexHtml)) {
    missingContracts.push('App state selectedPublishChannelIds defaults []');
  }

  if (!/\[\s*publishStatus\s*,\s*setPublishStatus\s*\]\s*=\s*useState\s*\(\s*["']{2}\s*\)/.test(indexHtml)) {
    missingContracts.push('App state publishStatus defaults ""');
  }

  if (!/\[\s*isPublishing\s*,\s*setIsPublishing\s*\]\s*=\s*useState\s*\(\s*false\s*\)/.test(indexHtml)) {
    missingContracts.push('App state isPublishing defaults false');
  }

  if (!/const\s+publishRequestInFlightRef\s*=\s*useRef\s*\(\s*false\s*\)/.test(indexHtml)) {
    missingContracts.push('publishRequestInFlightRef is created with useRef(false)');
  }

  const handleOpenPublishBody = getFunctionBody(indexHtml, 'handleOpenPublish');
  if (
    !handleOpenPublishBody ||
    !/setSelectedPublishChannelIds\s*\(\s*\[\s*\]\s*\)/.test(handleOpenPublishBody) ||
    !/setPublishStatus\s*\(\s*["']{2}\s*\)/.test(handleOpenPublishBody) ||
    !/setIsPublishDialogOpen\s*\(\s*true\s*\)/.test(handleOpenPublishBody)
  ) {
    missingContracts.push('handleOpenPublish resets channel selection/status and opens dialog');
  }

  if (
    !/<button[\s\S]*onClick=\{handleDownload\}[\s\S]*下載高清 PNG 海報[\s\S]*<\/button>\s*<button[\s\S]*onClick=\{handleOpenPublish\}/.test(indexHtml)
  ) {
    missingContracts.push('publish button is next to/after the existing download button and opens dialog');
  }

  if (
    !/\{isPublishDialogOpen\s*&&\s*\(/.test(indexHtml) ||
    !/role="dialog"/.test(indexHtml) ||
    !/aria-modal="true"/.test(indexHtml) ||
    !/發布確認/.test(indexHtml)
  ) {
    missingContracts.push('conditional small role="dialog" aria-modal="true" titled 發布確認');
  }

  if (!/PublishCore\.PUBLISH_CHANNELS\.map\(\s*\(?channel\)?\s*=>\s*\(/.test(indexHtml) || !/type="checkbox"/.test(indexHtml)) {
    missingContracts.push('channels are rendered from PublishCore.PUBLISH_CHANNELS with checkboxes');
  }

  if (!/主院所排序/.test(indexHtml) || !/primaryClinicId/.test(indexHtml)) {
    missingContracts.push('summary includes 主院所排序 using current primaryClinicId');
  }

  if (!/門診月份／標題/.test(indexHtml) || !/data\.title/.test(indexHtml)) {
    missingContracts.push('summary includes 門診月份／標題 using data.title');
  }

  if (!/圖片來源/.test(indexHtml) || !/目前 Preview 對應的 PNG/.test(indexHtml)) {
    missingContracts.push('summary includes 圖片來源 text 目前 Preview 對應的 PNG');
  }

  if (
    !/publishReadiness\s*=\s*PublishCore\.evaluatePublishSelection\s*\(\s*PublishCore\.PUBLISH_CHANNELS\s*,\s*selectedPublishChannelIds\s*,\s*primaryClinicId\s*\)/.test(indexHtml)
  ) {
    missingContracts.push('readiness is derived with PublishCore.evaluatePublishSelection(PublishCore.PUBLISH_CHANNELS, selectedPublishChannelIds, primaryClinicId)');
  }

  if (
    !/primaryClinicGuard\s*=\s*PublishCore\.evaluatePublishSelection\s*\(\s*PublishCore\.PUBLISH_CHANNELS\s*,\s*PublishCore\.PUBLISH_CHANNELS\.map\(\s*\(?channel\)?\s*=>\s*channel\.id\s*\)\s*,\s*primaryClinicId\s*\)/.test(indexHtml)
  ) {
    missingContracts.push('primaryClinicGuard is derived with all channel ids and current primaryClinicId');
  }

  if (!/primaryClinicGuard\.warning/.test(indexHtml)) {
    missingContracts.push('primaryClinicGuard warning renders');
  }

  if (/publishReadiness\.warning/.test(indexHtml)) {
    missingContracts.push('primary-clinic warning must render only once via primaryClinicGuard');
  }

  if (!/<button[\s\S]*onClick=\{handleConfirmPublish\}[\s\S]*disabled=\{!publishReadiness\.canConfirm\s*\|\|\s*isPublishing\}[\s\S]*確認建立工作包[\s\S]*<\/button>/.test(indexHtml)) {
    missingContracts.push('確認建立工作包 is disabled when !publishReadiness.canConfirm || isPublishing');
  }

  const handleConfirmPublishSource = getFunctionSource(indexHtml, 'handleConfirmPublish');
  const handleConfirmPublishBody = getFunctionBody(indexHtml, 'handleConfirmPublish');
  if (
    !handleConfirmPublishSource ||
    !/const\s+handleConfirmPublish\s*=\s*async\s*\(\s*\)\s*=>\s*\{\s*if\s*\(\s*!publishReadiness\.canConfirm\s*\)\s*return\s*;/.test(handleConfirmPublishSource)
  ) {
    missingContracts.push('handleConfirmPublish is async and starts with if (!publishReadiness.canConfirm) return;');
  }

  if (!handleConfirmPublishBody || !/const\s+pngDataUrl\s*=\s*await\s+generatePublishPngDataUrl\s*\(\s*\)/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish awaits generatePublishPngDataUrl()');
  }


  if (!handleConfirmPublishBody || !/setIsPublishing\s*\(\s*true\s*\)/.test(handleConfirmPublishBody) || !/setIsPublishing\s*\(\s*false\s*\)/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish sets and clears isPublishing');
  }

  if (!/PUBLISH_FAILED：發布失敗，請停止操作，不要重複點擊；請記錄安全代碼與 attemptId 後本機調查。/.test(indexHtml)) {
    missingContracts.push('handleConfirmPublish fallback status is exact fixed PUBLISH_FAILED fail-closed text');
  }

  if (!handleConfirmPublishBody || !/\bcatch\s*\(/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish has a catch path for publish errors');
  }


  if (handleConfirmPublishBody && /晉安官網串接尚未啟用/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish no longer displays the old Step 2 placeholder 晉安官網串接尚未啟用');
  }



  if (handleConfirmPublishBody && /\b(Production CMS|login|editor|upload|CMS_|VITE_|XMLHttpRequest|sendBeacon|axios|password|cookie)\b/i.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish contains no CMS origins, login/editor/upload URLs, CMS env names, alternate transports, or credential fields');
  }

  assert.match(handleConfirmPublishBody, /await PublishCore.createPublishJob/);
  assert.match(handleConfirmPublishBody, /PublishCore.downloadPublishJob\(job\)/);
  assert.match(handleConfirmPublishBody, /humanConfirmed: true/);
  assert.doesNotMatch(handleConfirmPublishBody, /fetch|PUBLISHED|晉安官網發布完成/);
  assert.match(handleConfirmPublishBody, /晉安官網發布工作包已建立，尚未發布。/);
  assert.match(handleConfirmPublishBody, /工作包建立失敗，尚未發布；請重新確認後再試。/);
  assert.deepEqual(missingContracts, []);
});

test('publish confirmation has synchronous duplicate-submission ref guard before side effects', () => {
  const missingContracts = [];
  const handleConfirmPublishBody = getFunctionBody(indexHtml, 'handleConfirmPublish');

  if (!/const\s+publishRequestInFlightRef\s*=\s*useRef\s*\(\s*false\s*\)/.test(indexHtml)) {
    missingContracts.push('publishRequestInFlightRef is created with useRef(false)');
  }

  if (!handleConfirmPublishBody || !/if\s*\(\s*publishRequestInFlightRef\.current\s*\)\s*return\s*;/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish checks publishRequestInFlightRef.current');
  }

  if (!handleConfirmPublishBody || !/publishRequestInFlightRef\.current\s*=\s*true\s*;/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish sets publishRequestInFlightRef.current = true synchronously');
  }

  if (!handleConfirmPublishBody || !/publishRequestInFlightRef\.current\s*=\s*false\s*;/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish clears publishRequestInFlightRef.current in finally');
  }

  const readinessIndex = handleConfirmPublishBody.indexOf('if (!publishReadiness.canConfirm) return;');
  const refCheckIndex = handleConfirmPublishBody.indexOf('if (publishRequestInFlightRef.current) return;');
  const refSetIndex = handleConfirmPublishBody.indexOf('publishRequestInFlightRef.current = true;');
  const isPublishingCheckIndex = handleConfirmPublishBody.indexOf('if (isPublishing)');
  const setPublishingIndex = handleConfirmPublishBody.indexOf('setIsPublishing(true);');
  const pngIndex = handleConfirmPublishBody.indexOf('generatePublishPngDataUrl');
  const fetchIndex = handleConfirmPublishBody.indexOf('PublishCore.createPublishJob');
  const finallyIndex = handleConfirmPublishBody.indexOf('finally');
  const refClearIndex = handleConfirmPublishBody.lastIndexOf('publishRequestInFlightRef.current = false;');

  if (
    !(
      readinessIndex !== -1 &&
      refCheckIndex > readinessIndex &&
      refSetIndex > refCheckIndex &&
      isPublishingCheckIndex > refSetIndex &&
      setPublishingIndex > refSetIndex &&
      pngIndex > setPublishingIndex &&
      fetchIndex > pngIndex
    )
  ) {
    missingContracts.push('ref guard check/set happen before React state, PNG generation, and fetch');
  }

  if (!(finallyIndex !== -1 && refClearIndex > finallyIndex)) {
    missingContracts.push('ref guard is cleared in finally');
  }

  assert.deepEqual(missingContracts, []);
});

test('publish failure status mapping is fixed allowlist and never renders arbitrary server or exception text', () => {
  const missingContracts = [];
  const handleConfirmPublishBody = getFunctionBody(indexHtml, 'handleConfirmPublish');
  const mappingBody = getFunctionBody(indexHtml, 'getPublishFailureStatusText');
  const expectedCodes = [
    'AUTH_FAILED',
    'FORM_CHANGED',
    'UPLOAD_FAILED',
    'SUBMIT_FAILED',
    'VERIFY_FAILED',
    'MANUAL_CHECK_REQUIRED',
    'PUBLISH_IN_PROGRESS',
    'CMS_RESPONSE_CONTRACT_UNVERIFIED',
  ];

  if (!/const\s+PUBLISH_FAILURE_STATUS_TEXT\s*=\s*Object\.freeze\s*\(\s*\{/.test(indexHtml)) {
    missingContracts.push('PUBLISH_FAILURE_STATUS_TEXT is an Object.freeze fixed map');
  }

  for (const code of expectedCodes) {
    const codeTextPattern = new RegExp(`${code}\\s*:\\s*["']${code}：[^"']*停止[^"']*(不要重複|請勿重複|不可重複)`);
    if (!codeTextPattern.test(indexHtml)) {
      missingContracts.push(`${code} maps to fixed Traditional Chinese stop/no-retry text containing exact code`);
    }
  }

  if (!/PUBLISH_FAILED：發布失敗，請停止操作，不要重複點擊；請記錄安全代碼與 attemptId 後本機調查。/.test(indexHtml)) {
    missingContracts.push('PUBLISH_FAILED fixed fail-closed text is present');
  }

  if (!mappingBody || !/Object\.prototype\.hasOwnProperty\.call\s*\(\s*PUBLISH_FAILURE_STATUS_TEXT\s*,\s*code\s*\)/.test(mappingBody)) {
    missingContracts.push('getPublishFailureStatusText uses hasOwnProperty allowlist check');
  }

  if (!mappingBody || !/return\s+PUBLISH_FAILURE_STATUS_TEXT\.PUBLISH_FAILED\s*;/.test(mappingBody)) {
    missingContracts.push('getPublishFailureStatusText defaults to fixed PUBLISH_FAILED');
  }



  if (handleConfirmPublishBody && /\b(result|err|error)\s*\.\s*(message|body|path|stack|adapter|details|url|credential|credentials|password|token|secret)\b/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish does not render arbitrary result.message/err.message/raw sensitive fields');
  }

  if (handleConfirmPublishBody && /setPublishStatus\s*\(\s*`/.test(handleConfirmPublishBody)) {
    missingContracts.push('handleConfirmPublish does not use template literals for publish failure status');
  }

  assert.deepEqual(missingContracts, []);
});

test('publish PNG helper uses current preview capture without download side effects', () => {
  const missingContracts = [];
  const helperBody = getFunctionBody(indexHtml, 'generatePublishPngDataUrl');

  if (!/const\s+generatePublishPngDataUrl\s*=\s*async\s*\(\s*\)\s*=>\s*\{/.test(indexHtml)) {
    missingContracts.push('generatePublishPngDataUrl is a dedicated async helper');
  }

  if (!helperBody || !/captureRef\.current/.test(helperBody)) {
    missingContracts.push('generatePublishPngDataUrl uses current captureRef.current');
  }

  if (!helperBody || !/await\s+document\.fonts\.ready/.test(helperBody)) {
    missingContracts.push('generatePublishPngDataUrl awaits document.fonts.ready');
  }

  if (
    !helperBody ||
    !/html2canvas\s*\(\s*captureRef\.current\s*,\s*\{[\s\S]*scale\s*:\s*2[\s\S]*useCORS\s*:\s*true[\s\S]*backgroundColor\s*:\s*["']#f8fafc["'][\s\S]*width\s*:\s*1080[\s\S]*height\s*:\s*1920[\s\S]*\}\s*\)/.test(helperBody)
  ) {
    missingContracts.push('generatePublishPngDataUrl calls html2canvas with scale:2,useCORS:true,backgroundColor:"#f8fafc",width:1080,height:1920');
  }

  if (!helperBody || !/return\s+canvas\.toDataURL\s*\(\s*["']image\/png["']\s*,\s*1\.0\s*\)/.test(helperBody)) {
    missingContracts.push('generatePublishPngDataUrl returns canvas.toDataURL("image/png", 1.0)');
  }

  if (helperBody && /\.(click|download)\b|createElement\s*\(\s*["']a["']\s*\)|input\.click|fileInput|selectedFile/.test(helperBody)) {
    missingContracts.push('generatePublishPngDataUrl does not click/download/reselect a file');
  }

  assert.deepEqual(missingContracts, []);
});

test('existing Download button contract remains intact', () => {
  const missingContracts = [];

  if (!/const\s+handleDownload\s*=\s*async\s*\(\s*\)\s*=>\s*\{/.test(indexHtml)) {
    missingContracts.push('handleDownload remains an async handler');
  }

  if (!/<button[\s\S]*onClick=\{handleDownload\}[\s\S]*disabled=\{isCapturing\}[\s\S]*下載高清 PNG 海報[\s\S]*<\/button>/.test(indexHtml)) {
    missingContracts.push('Download button remains wired to handleDownload and disabled by isCapturing');
  }

  if (!/html2canvas\s*\(\s*captureRef\.current\s*,\s*\{[\s\S]*scale\s*:\s*2[\s\S]*width\s*:\s*1080[\s\S]*height\s*:\s*1920[\s\S]*\}\s*\)/.test(indexHtml)) {
    missingContracts.push('html2canvas still captures 1080 x 1920 at scale 2');
  }

  if (!/link\.download\s*=\s*`\$\{data\.title\.replace\('\/',\s*'-'\)\}_醫師門診表\.png`/.test(indexHtml)) {
    missingContracts.push('download filename still derives from data.title');
  }

  assert.deepEqual(missingContracts, []);
});

test('publish dialog has visible close control and modal keyboard focus lifecycle', () => {
  const missingContracts = [];

  if (!/const\s+publishButtonRef\s*=\s*useRef\s*\(\s*null\s*\)/.test(indexHtml)) {
    missingContracts.push('publishButtonRef is created with useRef(null)');
  }

  if (!/const\s+publishDialogRef\s*=\s*useRef\s*\(\s*null\s*\)/.test(indexHtml)) {
    missingContracts.push('publishDialogRef is created with useRef(null)');
  }

  if (!/<button\b(?=[\s\S]*?\bonClick=\{handleOpenPublish\})(?=[\s\S]*?\bref=\{publishButtonRef\})[\s\S]*?>/.test(indexHtml)) {
    missingContracts.push('publish button has ref={publishButtonRef}');
  }

  if (
    !/<div\b(?=[\s\S]*?\brole="dialog")(?=[\s\S]*?\bref=\{publishDialogRef\})(?=[\s\S]*?\btabIndex="-1")[\s\S]*?>/.test(indexHtml)
  ) {
    missingContracts.push('dialog has ref={publishDialogRef} and tabIndex="-1"');
  }

  const publishDialogMarkup = /\{isPublishDialogOpen\s*&&\s*\(([\s\S]*?)\n\s*\)\}/.exec(indexHtml)?.[1] || '';
  if (!/<span\s+aria-hidden="true">\s*×\s*<\/span>/.test(publishDialogMarkup)) {
    missingContracts.push('close control contains visible text glyph <span aria-hidden="true">×</span>');
  }

  if (/data-lucide="x"/.test(publishDialogMarkup)) {
    missingContracts.push('modal contains no data-lucide="x"');
  }

  const publishDialogEffectMatch = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*isPublishDialogOpen\s*\]\s*\)/.exec(indexHtml);
  const publishDialogEffectBody = publishDialogEffectMatch?.[1] || '';
  if (!publishDialogEffectMatch) {
    missingContracts.push('useEffect is keyed by [isPublishDialogOpen]');
  }

  if (!/publishDialogRef\.current/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect obtains publishDialogRef.current');
  }

  if (!/\.focus\s*\(\s*\)/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect moves focus into the dialog');
  }

  if (!/Escape/.test(publishDialogEffectBody) || !/setIsPublishDialogOpen\s*\(\s*false\s*\)/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect handles Escape by closing');
  }

  if (!/Shift/.test(publishDialogEffectBody) || !/Tab/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect handles Tab/Shift+Tab');
  }

  if (!/(querySelectorAll|getElementsByTagName)/.test(publishDialogEffectBody) || !/(firstFocusable|lastFocusable|focusable)/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect cycles within dialog focusable controls');
  }

  if (
    !/addEventListener\s*\(\s*["']keydown["']/.test(publishDialogEffectBody) ||
    !/removeEventListener\s*\(\s*["']keydown["']/.test(publishDialogEffectBody)
  ) {
    missingContracts.push('publish dialog focus effect adds/removes a keydown listener');
  }

  if (!/publishButtonRef\.current\?\.focus\s*\(\s*\)/.test(publishDialogEffectBody)) {
    missingContracts.push('publish dialog focus effect restores focus with publishButtonRef.current?.focus() on cleanup');
  }

  if (!/primaryClinicGuard\.warning[\s\S]*?role="alert"/.test(indexHtml)) {
    missingContracts.push('warning has role="alert"');
  }

  if (!/publishStatus[\s\S]*?role="status"[\s\S]*?aria-live="polite"/.test(indexHtml)) {
    missingContracts.push('publishStatus output has role="status" and aria-live="polite"');
  }

  assert.deepEqual(missingContracts, []);
});
