import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(new URL('../lib/integrations/iguide/bounded-media.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(id => id === 'server-only' ? {} : require(id), mod, mod.exports);
const check = bytes => mod.exports.boundedMediaResponse(new Response(bytes, { headers: { 'content-type': 'image/png' } }), { maxBytes: 20*1024*1024, signal: AbortSignal.timeout(5000), allowedTypes: ['image/png'] });
for (const [width, height] of [[20000, 1], [7000, 7000]]) test(`reject decoded image budget ${width}x${height}`, async () => {
  const bytes = await sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(check(bytes), /pixel|dimension|limit/i);
});
test('reject signature-only and truncated raster; preserve valid bytes', async () => {
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(check(bytes.subarray(0, 40)));
  assert.deepEqual(Buffer.from(await (await check(bytes)).arrayBuffer()), bytes);
});

for (const format of ['jpeg', 'png', 'webp', 'avif']) test(`full decode preserves valid ${format} bytes`, async () => {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
  const mime = `image/${format}`;
  const result = await mod.exports.boundedMediaResponse(new Response(bytes, { headers: { 'content-type': mime } }), { maxBytes: 100000, signal: AbortSignal.timeout(5000), allowedTypes: [mime] });
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
});
test('valid raster header does not excuse truncated compressed pixels', async () => {
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: 'white' } }).png().toBuffer();
  const broken = bytes.subarray(0, bytes.length - 40);
  assert.equal((await sharp(broken).metadata()).width, 256);
  await assert.rejects(check(broken));
});
