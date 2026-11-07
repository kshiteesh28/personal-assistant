// Deterministic ICNS packaging for environments where iconutil's image service is unavailable.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [iconset, destination] = process.argv.slice(2);
if (!iconset || !destination) throw new Error('Usage: make-icon.mjs <iconset> <destination>');
const entries = [
  ['icp4', 'icon_16x16.png'], ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'], ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'], ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
];
const chunks = entries.map(([type, name]) => {
  const png = readFileSync(join(iconset, name));
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG input');
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, 8), 4);
writeFileSync(destination, Buffer.concat([header, ...chunks]));
