const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { orderClinicsByPriority } = require('../clinic-order.js');

function makeClinics() {
  return [
    {
      id: 'clinic-1',
      name: '晉安復健科診所 醫師門診表',
    },
    {
      id: 'clinic-2',
      name: '毅安診所 醫師門診表',
    },
  ];
}

test('clinic-1 priority renders clinic-1 then clinic-2', () => {
  const clinics = makeClinics();

  const ordered = orderClinicsByPriority(clinics, 'clinic-1');

  assert.deepEqual(ordered.map((clinic) => clinic.id), ['clinic-1', 'clinic-2']);
});

test('clinic-2 priority renders clinic-2 then clinic-1', () => {
  const clinics = makeClinics();

  const ordered = orderClinicsByPriority(clinics, 'clinic-2');

  assert.deepEqual(ordered.map((clinic) => clinic.id), ['clinic-2', 'clinic-1']);
});

test('ordering returns a new array and does not mutate the input array or clinic objects', () => {
  const clinics = makeClinics();
  const originalClinic1 = structuredClone(clinics[0]);
  const originalClinic2 = structuredClone(clinics[1]);

  const ordered = orderClinicsByPriority(clinics, 'clinic-2');

  assert.notEqual(ordered, clinics);
  assert.equal(ordered[0], clinics[1]);
  assert.equal(ordered[1], clinics[0]);
  assert.deepEqual(clinics.map((clinic) => clinic.id), ['clinic-1', 'clinic-2']);
  assert.deepEqual(clinics[0], originalClinic1);
  assert.deepEqual(clinics[1], originalClinic2);
});

test('unknown priority preserves original order', () => {
  const clinics = makeClinics();

  const ordered = orderClinicsByPriority(clinics, 'clinic-3');

  assert.deepEqual(ordered.map((clinic) => clinic.id), ['clinic-1', 'clinic-2']);
});

test('UI wires primary clinic ordering only into poster rendering', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const missingContracts = [];

  const clinicOrderScriptIndex = indexHtml.indexOf('<script src="clinic-order.js"></script>');
  const babelScriptIndex = indexHtml.indexOf('<script src="https://unpkg.com/@babel/standalone@8.0.4/babel.min.js"></script>');

  if (clinicOrderScriptIndex === -1 || clinicOrderScriptIndex > babelScriptIndex) {
    missingContracts.push('clinic-order.js is loaded before Babel');
  }

  if (!/\[\s*primaryClinicId\s*,\s*setPrimaryClinicId\s*\]\s*=\s*useState\s*\(\s*\(\s*\)\s*=>\s*INITIAL_DATA\.clinics\[0\]\.id\s*\)/.test(indexHtml)) {
    missingContracts.push('primary clinic state defaults from INITIAL_DATA.clinics[0].id');
  }

  if (!/const\s+renderData\s*=\s*\{\s*\.\.\.data\s*,\s*clinics\s*:\s*ClinicOrder\.orderClinicsByPriority\s*\(\s*data\.clinics\s*,\s*primaryClinicId\s*\)\s*\}/.test(indexHtml)) {
    missingContracts.push('renderData is derived with ClinicOrder.orderClinicsByPriority(data.clinics, primaryClinicId)');
  }

  if (!/主院所/.test(indexHtml)) {
    missingContracts.push('compact label 主院所 is visible');
  }

  if (!/<select[\s\S]*value=\{primaryClinicId\}[\s\S]*onChange=\{\(e\)\s*=>\s*setPrimaryClinicId\(e\.target\.value\)\}[\s\S]*<\/select>/.test(indexHtml)) {
    missingContracts.push('primary clinic select is wired to primaryClinicId');
  }

  if (!/<option\s+value="clinic-1">\s*晉安優先\s*<\/option>/.test(indexHtml)) {
    missingContracts.push('clinic-1 option is labeled 晉安優先');
  }

  if (!/<option\s+value="clinic-2">\s*毅安優先\s*<\/option>/.test(indexHtml)) {
    missingContracts.push('clinic-2 option is labeled 毅安優先');
  }

  if (!/<PosterContent\s+ref=\{captureRef\}\s+data=\{renderData\}\s+isForCapture=\{true\}\s*\/>/.test(indexHtml)) {
    missingContracts.push('hidden PNG capture PosterContent receives renderData');
  }

  if (!/<PosterContent\s+data=\{renderData\}\s+isForCapture=\{false\}\s*\/>/.test(indexHtml)) {
    missingContracts.push('visible Preview PosterContent receives renderData');
  }

  if (!/\{data\.clinics\.map\(\(clinic,\s*cIdx\)\s*=>\s*\(/.test(indexHtml)) {
    missingContracts.push('editor still iterates data.clinics');
  }

  assert.deepEqual(missingContracts, []);
});
