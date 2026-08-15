// scripts/fix_icons.js
// Generates valid standard PNG launcher icons for Android AAPT compilation

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createSolidPng(width, height, r = 22, g = 163, b = 74) {
  // Construct a minimal uncompressed valid PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw image data: for each row, 1 filter byte (0) + width * 3 RGB bytes
  const rowBytes = 1 + width * 3;
  const rawData = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 3;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(body);

  const chunk = Buffer.alloc(4 + body.length + 4);
  chunk.writeUInt32BE(len, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crcVal, 4 + body.length);
  return chunk;
}

const resDir = path.join(__dirname, '..', 'haulbox_app', 'android', 'app', 'src', 'main', 'res');

const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

for (const [folder, size] of Object.entries(sizes)) {
  const targetDir = path.join(resDir, folder);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const png = createSolidPng(size, size, 22, 163, 74); // Emerald brand color #16A34A
  fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), png);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), png);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_foreground.png'), png);
  console.log(`Generated valid PNGs for ${folder} (${size}x${size})`);
}

console.log('Done generating Android launcher icons.');
