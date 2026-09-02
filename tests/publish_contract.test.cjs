const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  MAX_PNG_BYTES,
  parsePngDataUrl,
} = require('../lib/publish-contract.js');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0), options = {}) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(options.length ?? data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(options.crc ?? crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function ihdr(overrides = {}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(overrides.width ?? CAPTURE_WIDTH, 0);
  data.writeUInt32BE(overrides.height ?? CAPTURE_HEIGHT, 4);
  data[8] = overrides.bitDepth ?? 8;
  data[9] = overrides.colorType ?? 6;
  data[10] = overrides.compression ?? 0;
  data[11] = overrides.filter ?? 0;
  data[12] = overrides.interlace ?? 0;
  return data;
}

function pngBuffer(chunks) {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

let validIdatPayload;
function getValidIdatPayload() {
  if (!validIdatPayload) {
    const rowLength = CAPTURE_WIDTH * 4 + 1;
    validIdatPayload = zlib.deflateSync(Buffer.alloc(rowLength * CAPTURE_HEIGHT));
  }
  return validIdatPayload;
}

function validPngBuffer(extraChunks = []) {
  return pngBuffer([
    chunk('IHDR', ihdr()),
    ...extraChunks,
    chunk('IDAT', getValidIdatPayload()),
    chunk('IEND'),
  ]);
}

function assertInvalid(bufferOrUrl, name) {
  assert.throws(
    () => parsePngDataUrl(typeof bufferOrUrl === 'string' ? bufferOrUrl : dataUrl(bufferOrUrl)),
    (error) => error && error.code === 'INVALID_PNG',
    name,
  );
}

test('accepts exact 2160x3840 RGBA PNG data URL and returns PNG metadata', () => {
  const buffer = validPngBuffer([chunk('tEXt', Buffer.from('source=synthetic'))]);
  const result = parsePngDataUrl(dataUrl(buffer));

  assert.deepEqual(result, {
    png: buffer,
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
  });
  assert.notEqual(result.png, buffer);
});

test('rejects wrong data URL type, wrong dimensions, oversize data, and non-canonical base64', () => {
  assertInvalid('data:image/jpeg;base64,not-png', 'wrong data URL type');
  assertInvalid(pngBuffer([chunk('IHDR', ihdr({ width: CAPTURE_WIDTH - 1 })), chunk('IDAT', getValidIdatPayload()), chunk('IEND')]), 'wrong width');
  assertInvalid(pngBuffer([chunk('IHDR', ihdr({ height: CAPTURE_HEIGHT - 1 })), chunk('IDAT', getValidIdatPayload()), chunk('IEND')]), 'wrong height');
  assertInvalid(`data:image/png;base64,${Buffer.alloc(MAX_PNG_BYTES + 1).toString('base64')}`, 'oversize data');
  assertInvalid('data:image/png;base64,QUJDRA', 'missing base64 padding');
  assertInvalid('data:image/png;base64,/x==', 'non-canonical base64');
});

test('rejects structurally invalid PNG chunks that previously reached IHDR-only acceptance', () => {
  const validIhdr = chunk('IHDR', ihdr());
  const validIdat = chunk('IDAT', getValidIdatPayload());
  const invalidIdat = chunk('IDAT', Buffer.from([0x78]));
  const badCrcIdat = Buffer.from(validIdat);
  badCrcIdat[badCrcIdat.length - 1] ^= 0xff;

  const cases = [
    ['signature plus IHDR only', pngBuffer([validIhdr])],
    ['IHDR and IEND without IDAT', pngBuffer([validIhdr, chunk('IEND')])],
    ['CRC-valid invalid IDAT stream', pngBuffer([validIhdr, invalidIdat, chunk('IEND')])],
    ['bad CRC', pngBuffer([validIhdr, badCrcIdat, chunk('IEND')])],
    ['chunk-length overrun', pngBuffer([validIhdr, chunk('IDAT', Buffer.from([1]), { length: 2 })])],
    ['duplicate IHDR', pngBuffer([validIhdr, chunk('IHDR', ihdr()), validIdat, chunk('IEND')])],
    ['nonzero IEND', pngBuffer([validIhdr, validIdat, chunk('IEND', Buffer.from([1]))])],
    ['trailing bytes after IEND', Buffer.concat([pngBuffer([validIhdr, validIdat, chunk('IEND')]), Buffer.from([0])])],
    ['wrong IHDR compression', pngBuffer([chunk('IHDR', ihdr({ compression: 1 })), validIdat, chunk('IEND')])],
    ['wrong IHDR filter', pngBuffer([chunk('IHDR', ihdr({ filter: 1 })), validIdat, chunk('IEND')])],
    ['wrong IHDR interlace', pngBuffer([chunk('IHDR', ihdr({ interlace: 2 })), validIdat, chunk('IEND')])],
    ['unknown critical chunk', pngBuffer([validIhdr, chunk('ABCD', Buffer.from([1])), validIdat, chunk('IEND')])],
  ];

  for (const [name, buffer] of cases) assertInvalid(buffer, name);
});

test('rejects PNG chunk types with lowercase reserved third byte even when CRC is valid', () => {
  assertInvalid(
    validPngBuffer([chunk('abcD', Buffer.from('reserved bit set'))]),
    'lowercase reserved chunk type byte',
  );
});

test('rejects PLTE chunks with more than 256 palette entries', () => {
  const validIhdr = chunk('IHDR', ihdr());
  const validIdat = chunk('IDAT', getValidIdatPayload());

  const cases = [
    ['empty PLTE', Buffer.alloc(0)],
    ['non-multiple-of-3 PLTE', Buffer.alloc(4)],
    ['769-byte PLTE', Buffer.alloc(769)],
    ['771-byte PLTE', Buffer.alloc(771)],
  ];

  for (const [name, data] of cases) {
    assertInvalid(pngBuffer([validIhdr, chunk('PLTE', data), validIdat, chunk('IEND')]), name);
  }
});

test('rejects invalid PNG pixel streams and nonconsecutive IDAT chunks', () => {
  const validIhdr = chunk('IHDR', ihdr());
  const expectedBytes = (CAPTURE_WIDTH * 4 + 1) * CAPTURE_HEIGHT;
  const tooLong = zlib.deflateSync(Buffer.alloc(expectedBytes + 1));
  const tooShort = zlib.deflateSync(Buffer.alloc(expectedBytes - 1));
  const invalidFilterRaw = Buffer.alloc(expectedBytes);
  invalidFilterRaw[CAPTURE_WIDTH * 4 + 1] = 5;
  const trailingJunk = Buffer.concat([getValidIdatPayload(), Buffer.from([1, 2, 3])]);
  const first = getValidIdatPayload().subarray(0, Math.floor(getValidIdatPayload().length / 2));
  const second = getValidIdatPayload().subarray(first.length);

  const cases = [
    ['decompression output too long', pngBuffer([validIhdr, chunk('IDAT', tooLong), chunk('IEND')])],
    ['decompression output too short', pngBuffer([validIhdr, chunk('IDAT', tooShort), chunk('IEND')])],
    ['invalid row filter byte', pngBuffer([validIhdr, chunk('IDAT', zlib.deflateSync(invalidFilterRaw)), chunk('IEND')])],
    ['trailing junk after valid compressed IDAT stream', pngBuffer([validIhdr, chunk('IDAT', trailingJunk), chunk('IEND')])],
    ['nonconsecutive IDAT chunks', pngBuffer([validIhdr, chunk('IDAT', first), chunk('tEXt', Buffer.from('gap')), chunk('IDAT', second), chunk('IEND')])],
  ];

  for (const [name, buffer] of cases) assertInvalid(buffer, name);
});
