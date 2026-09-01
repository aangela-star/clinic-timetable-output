const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publishCorePath = path.join(__dirname, '..', 'publish-core.js');

test('publish channel model exposes the Jinan website channel', () => {
  assert.equal(
    fs.existsSync(publishCorePath),
    true,
    'expected publish-core.js to exist and export PUBLISH_CHANNELS'
  );

  const { PUBLISH_CHANNELS } = require(publishCorePath);

  assert.deepEqual(PUBLISH_CHANNELS, [
    {
      id: 'jinan-website',
      label: '晉安官網',
      requiredPrimaryClinicId: 'clinic-1',
    },
  ]);
});

test('no selected channel cannot be confirmed', () => {
  const { PUBLISH_CHANNELS, evaluatePublishSelection } = require(publishCorePath);

  assert.equal(typeof evaluatePublishSelection, 'function');

  assert.deepEqual(evaluatePublishSelection(PUBLISH_CHANNELS, [], 'clinic-1'), {
    canConfirm: false,
    warning: '',
  });
});

test('Jinan website can be confirmed with Jinan-first output', () => {
  const { PUBLISH_CHANNELS, evaluatePublishSelection } = require(publishCorePath);

  assert.deepEqual(
    evaluatePublishSelection(PUBLISH_CHANNELS, ['jinan-website'], 'clinic-1'),
    {
      canConfirm: true,
      warning: '',
    }
  );
});

test('Jinan website blocks Yian-first output with a clear warning', () => {
  const { PUBLISH_CHANNELS, evaluatePublishSelection } = require(publishCorePath);

  assert.deepEqual(
    evaluatePublishSelection(PUBLISH_CHANNELS, ['jinan-website'], 'clinic-2'),
    {
      canConfirm: false,
      warning: '晉安官網建議使用晉安優先版本',
    }
  );
});
