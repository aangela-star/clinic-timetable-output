const zlib = require('node:zlib');

const MAX_PNG_BYTES = 15 * 1024 * 1024;
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CAPTURE_WIDTH = 2160;
const CAPTURE_HEIGHT = 3840;
const MAX_CHUNKS = 100000;
const EXPECTED_SCANLINE_BYTES = CAPTURE_WIDTH * 4 + 1;
const EXPECTED_PIXEL_BYTES = EXPECTED_SCANLINE_BYTES * CAPTURE_HEIGHT;
const KNOWN_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const MAX_PLTE_BYTES = 256 * 3;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function invalidPng() {
  const error = new Error('Invalid PNG data URL.');
  error.code = 'INVALID_PNG';
  return error;
}

function isCanonicalBase64(value) {
  if (!value || value.length % 4 !== 0) return false;

  let paddingStart = value.length;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isBase64Char =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (isBase64Char) {
      if (paddingStart !== value.length) return false;
      continue;
    }
    if (code !== 0x3d) return false;
    if (paddingStart === value.length) paddingStart = i;
  }

  const padding = value.length - paddingStart;
  return padding <= 2 && (padding === 0 || paddingStart >= value.length - 2);
}

function crc32(buffer, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isChunkType(value) {
  return /^[A-Za-z]{4}$/.test(value);
}

function validatePngStructure(png) {
  if (png.length < 8 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw invalidPng();
  }

  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIdat = false;
  let closedIdat = false;
  let sawIend = false;
  const idatParts = [];
  let width;
  let height;

  while (offset < png.length) {
    chunkCount += 1;
    if (chunkCount > MAX_CHUNKS || offset + 12 > png.length) throw invalidPng();

    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd > png.length - 4 || crcEnd > png.length) throw invalidPng();

    const type = png.subarray(typeStart, dataStart).toString('ascii');
    if (!isChunkType(type)) throw invalidPng();
    if ((png[typeStart + 2] & 0x20) !== 0) throw invalidPng();

    const expectedCrc = crc32(png, typeStart, dataEnd);
    const actualCrc = png.readUInt32BE(dataEnd);
    if (expectedCrc !== actualCrc) throw invalidPng();

    const isCritical = (png[typeStart] & 0x20) === 0;
    if (isCritical && !KNOWN_CRITICAL_CHUNKS.has(type)) throw invalidPng();

    if (!sawIhdr && type !== 'IHDR') throw invalidPng();
    if (sawIend) throw invalidPng();

    if (type === 'IHDR') {
      if (sawIhdr || length !== 13) throw invalidPng();
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      if (
        width !== CAPTURE_WIDTH ||
        height !== CAPTURE_HEIGHT ||
        png[dataStart + 8] !== 8 ||
        png[dataStart + 9] !== 6 ||
        png[dataStart + 10] !== 0 ||
        png[dataStart + 11] !== 0 ||
        png[dataStart + 12] !== 0
      ) {
        throw invalidPng();
      }
      sawIhdr = true;
    } else if (type === 'PLTE') {
      if (sawPlte || sawIdat || length === 0 || length % 3 !== 0 || length > MAX_PLTE_BYTES) throw invalidPng();
      sawPlte = true;
    } else if (type === 'IDAT') {
      if (!sawIhdr || closedIdat || length === 0) throw invalidPng();
      sawIdat = true;
      idatParts.push(png.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (!sawIdat || length !== 0) throw invalidPng();
      if (crcEnd !== png.length) throw invalidPng();
      sawIend = true;
    } else if (sawIdat) {
      closedIdat = true;
    }

    offset = crcEnd;
  }

  if (!sawIhdr || !sawIdat || !sawIend || offset !== png.length) throw invalidPng();
  validatePngPixelStream(Buffer.concat(idatParts));

  return { width, height };
}

function validatePngPixelStream(compressed) {
  let raw;
  try {
    const result = zlib.inflateSync(compressed, {
      maxOutputLength: EXPECTED_PIXEL_BYTES + 1,
      info: true,
    });
    if (result.engine.bytesWritten !== compressed.length) throw invalidPng();
    raw = result.buffer;
  } catch (_) {
    throw invalidPng();
  }
  if (raw.length !== EXPECTED_PIXEL_BYTES) throw invalidPng();
  for (let offset = 0; offset < raw.length; offset += EXPECTED_SCANLINE_BYTES) {
    if (raw[offset] > 4) throw invalidPng();
  }
}

function parsePngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)) throw invalidPng();

  const base64 = value.slice(PNG_PREFIX.length);
  if (!isCanonicalBase64(base64) || base64.length > Math.ceil(MAX_PNG_BYTES / 3) * 4) throw invalidPng();

  const png = Buffer.from(base64, 'base64');
  if (png.length === 0 || png.length > MAX_PNG_BYTES || png.toString('base64') !== base64) {
    throw invalidPng();
  }

  const { width, height } = validatePngStructure(png);

  return { png: Buffer.from(png), width, height };
}

module.exports = {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  MAX_PNG_BYTES,
  parsePngDataUrl,
};
