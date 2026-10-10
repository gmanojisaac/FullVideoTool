import sharp from 'sharp';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixtureRoot } from '../server/app.js';

await mkdir(fixtureRoot, { recursive: true });
// Optional argument copies a user sample byte-for-byte; fixture generation never changes that file.
if (process.argv[2]) await copyFile(path.resolve(process.argv[2]), path.join(fixtureRoot, 'sample-comic.png'));
const source = path.join(fixtureRoot, 'sample-comic.png');
const { width, height } = await sharp(source).metadata();
if (!width || !height) throw new Error('Sample fixture has no dimensions.');
// Source-specific ground truth, independently measured from the supplied comic.
// The fixture coordinates are not derived from the detector under test.
if (width !== 848 || height !== 1264) throw new Error(`Expected the supplied 848 × 1264 sample, received ${width} × ${height}. Update fixture ground truth for a different sample.`);
const xs = [[11, 419], [430, 837]], ys = [[7, 417], [428, 838], [849, 1257]];
const panels = ys.flatMap(([top, bottom]) => xs.map(([left, right]) => ({ left, top, width: right - left, height: bottom - top })));
// Recompose the sample exclusively into a TEST fixture to exercise a 3-column, 2-row input.
const tileWidth = 408, tileHeight = 410, gutter = 12, margin = 12;
const landscapeWidth = margin * 2 + tileWidth * 3 + gutter * 2;
const landscapeHeight = margin * 2 + tileHeight * 2 + gutter;
const buffers = await Promise.all(panels.map(panel => sharp(source).extract(panel).resize(tileWidth, tileHeight).png().toBuffer()));
await sharp({ create: { width: landscapeWidth, height: landscapeHeight, channels: 3, background: '#ffffff' } })
  .composite(buffers.map((input, i) => ({ input, left: margin + (i % 3) * (tileWidth + gutter), top: margin + Math.floor(i / 3) * (tileHeight + gutter) })))
  .jpeg({ quality: 95 }).toFile(path.join(fixtureRoot, 'landscape-comic.jpg'));
await sharp(source).webp({ quality: 95 }).toFile(path.join(fixtureRoot, 'portrait-comic.webp'));
await sharp(source).rotate(90).jpeg({ quality: 95 }).withMetadata({ orientation: 8 }).toFile(path.join(fixtureRoot, 'exif-portrait.jpg'));
await writeFile(path.join(fixtureRoot, 'ground-truth.json'), JSON.stringify({
  source: 'User supplied image-1.png, copied unchanged to sample-comic.png',
  portrait: { width, height, layout: '2x3', panels: panels.map((p, i) => ({ id: i + 1, x: p.left, y: p.top, width: p.width, height: p.height })) },
  landscape: { width: landscapeWidth, height: landscapeHeight, layout: '3x2', panels: buffers.map((_, i) => ({ id: i + 1, x: margin + (i % 3) * (tileWidth + gutter), y: margin + Math.floor(i / 3) * (tileHeight + gutter), width: tileWidth, height: tileHeight })) },
}, null, 2) + '\n');
console.log('Fixtures ready: original sample PNG, recomposed landscape JPG, portrait WEBP, and EXIF JPG.');
