import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createSyntheticSource,
  deriveDeliveryProfiles,
  writeDeterministicZip,
} from "./pipeline.mjs";

const count = Number.parseInt(process.argv[2] ?? "", 10);
if (![50, 100, 200].includes(count)) {
  throw new Error("Usage: node src/benchmark.mjs 50|100|200");
}

const workspace = await mkdtemp(join(tmpdir(), `pixel-media-worker-${count}-`));
const release = {
  releaseId: "55555555-5555-4555-8555-555555555555",
  profile: "client.fullres.share.v1",
};
let sampledRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  sampledRss = Math.max(sampledRss, process.memoryUsage().rss);
}, 5);
const startedAt = performance.now();

try {
  const files = [];
  let sourceBytes = 0;
  for (let index = 0; index < count; index += 1) {
    const source = await createSyntheticSource({ width: 3000, height: 2000, seed: 101 + index });
    sourceBytes += source.length;
    const derived = await deriveDeliveryProfiles(source);
    const name = `${String(index + 1).padStart(3, "0")}-synthetic-property-photo.jpg`;
    const path = join(workspace, name);
    await writeFile(path, derived.fullRes.bytes, { flag: "wx" });
    files.push({
      name,
      source: () => createReadStream(path),
      bytesLength: derived.fullRes.bytesLength,
      sha256: derived.fullRes.sha256,
    });
  }

  const packagePath = join(workspace, "release.zip");
  const zip = await writeDeterministicZip(files, release, createWriteStream(packagePath, { flags: "wx" }));
  const packageStat = await stat(packagePath);
  if (packageStat.size !== zip.bytesWritten) throw new Error("package file size does not match streamed byte count");

  const elapsedMs = performance.now() - startedAt;
  const osHighWaterRssMiB = process.resourceUsage().maxRSS / 1024;
  console.log(JSON.stringify({
    count,
    uniqueSourceBytes: sourceBytes,
    packageBytes: packageStat.size,
    packageSha256: zip.sha256,
    elapsedMs: Math.round(elapsedMs),
    imagesPerSecond: Number((count / (elapsedMs / 1000)).toFixed(2)),
    sampledRssMiB: Number((sampledRss / 1024 / 1024).toFixed(1)),
    osHighWaterRssMiB: Number(osHighWaterRssMiB.toFixed(1)),
    persistedUniqueDerivatives: files.length,
    packageOutputPersisted: true,
  }));
} finally {
  clearInterval(sampler);
  await rm(workspace, { recursive: true, force: true });
}
