# Canonical Media Worker Spike

**Status:** Local Release 0 evidence only; not production code or a deployment.

## Safety boundary

This spike used **synthetic files only**. No production data, provider credit, or remote object was used. It did not read client media, call Autoenhance/iGUIDE/Fotello, change Supabase, create a Cloudflare bucket, deploy a worker, or alter current delivery behavior.

The spike lives in an isolated nested Node package so its dependencies and scripts do not enter the Next.js application bundle. Node `>=20.9` is required.

## Proven locally

- Deterministic synthetic JPEG generation
- Explicit source-byte, dimension and decoded-pixel limits
- SHA-256 checksums for source, derivative and package bytes
- Deterministic full-resolution JPEG profile: `client.fullres.share.v1`
- Deterministic provisional Ontario profile: `ontario.proptx.provisional.2026-08-11.v1`
- Long-edge resize to 2048 pixels without enlargement or forced crop
- Tenant-qualified immutable quarantine/master/derivative/package object keys
- Unsafe identifier, traversal and checksum rejection
- Strict own-data-property capture rejects accessors, proxies, symbols and hidden extras; buffered ZIP and R2 upload bytes are copied before hashing and asynchronous use
- ZIP entry-count, entry-byte, aggregate-byte and manifest-size limits, with numeric preflight before any buffered media copy
- Portable-ASCII export filenames only, with C0/DEL/C1 control rejection and case-insensitive duplicate rejection for common extraction filesystems
- `release-manifest.json` is reserved and cannot be supplied as a media entry
- Package manifests are derived from the exact sorted archive entries, byte counts and checksums rather than accepted as independent file claims
- Stream-backed entries are counted and hashed while packaging; mismatches fail the package
- Byte-for-byte deterministic local ZIP output with fixed ordering and timestamps
- Destination/source failure cleanup and optional abort propagation
- S3-compatible R2 command boundary bound to one organization prefix
- Buffer uploads limited to 100 MiB, checksum-addressed and create-only with `If-None-Match: *`
- Streamed downloads verify byte length and SHA-256 instead of trusting metadata alone
- Remote object deletion is intentionally unsupported until atomic/version-aware R2 semantics are proven

A writable ZIP stream exists, but a real multipart R2 uploader and abort reconciler do not. Multi-gigabyte packages remain blocked from production.

## Test evidence

Command:

```bash
npm test
```

Current result:

```text
15 tests passed
0 failed
```

Covered behaviors include:

1. deterministic bounded derivatives;
2. safe immutable object keys;
3. truthful derived release manifests;
4. reserved, C0/DEL/C1 control, non-ASCII and ASCII-caseless duplicate filename rejection;
5. deterministic buffered and streamed ZIP output;
6. stream entry length/checksum verification;
7. source/destination failure cleanup;
8. archive count and aggregate limits;
9. tenant-bound, checksum-addressed, create-only R2 commands;
10. cross-tenant, unsafe, oversized and overwrite rejection;
11. rejected pre-stream R2 response-body cleanup;
12. downstream verifier cancellation cleanup;
13. end-to-end streamed download verification.

Dependency audit:

```text
npm audit --omit=dev
0 vulnerabilities
```

An S3 emulator was evaluated but immediately removed before commit because its dependency tree reported one moderate and three high vulnerabilities. No force-upgrade or vulnerable test server was retained.

## Corrected benchmark method

Each count ran in a fresh Node process. For every item, the benchmark:

1. generated a **unique synthetic source** at 3000×2000 using a different deterministic seed;
2. created full-resolution and provisional Ontario derivatives sequentially;
3. persisted the unique full-resolution derivative to a temporary file using create-only file semantics;
4. retained only its filename, byte count and SHA-256;
5. reopened every persisted derivative as a fresh file stream;
6. streamed the deterministic ZIP to a persisted temporary ZIP file;
7. verified the written ZIP size against the pipeline’s streamed-byte count;
8. recorded both a 5 ms RSS sampler and Node’s OS-reported high-water RSS;
9. removed only the exact synthetic temporary workspace in `finally`.

This exercises unique derivative generation, disk persistence/reopen I/O, stream verification and package-output I/O. It does not model R2 network latency, multipart behavior, object-store backpressure, Linux/container codecs, concurrent workers or malware scanning.

## Corrected benchmark results

| Images | Unique source bytes | Package bytes | Elapsed | Throughput | Sampled RSS | OS high-water RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 456,795,420 | 392,637,334 | 13,698 ms | 3.65 images/s | 358.9 MiB | **358.9 MiB** |
| 100 | 913,256,543 | 785,133,950 | 26,504 ms | 3.77 images/s | 377.5 MiB | **377.8 MiB** |
| 200 | 1,826,546,748 | 1,570,291,492 | 52,468 ms | 3.81 images/s | 406.9 MiB | **407.3 MiB** |

Package SHA-256:

- 50: `4440a87a2104b31c35340be74022dfaff112acf6069ccaa065be55427db75477`
- 100: `67f5b62c871c5209046a156dde4ab72eafb24851145858593056a458b5978a24`
- 200: `dcb559c8f700391379fcb716533c1066b9187742b222ff4b897588cbc3eba3de`

An earlier exploratory benchmark retained outputs in memory and then reused one derivative when packaging. Those results were methodologically invalid for the claimed persistence model and are superseded by the corrected benchmark above.

## External gates not verified

### Cloudflare R2

R2 credentials were not present in the environment. Therefore the following remain unverified against real R2:

- bucket and scoped-token policy;
- private conditional upload and metadata round-trip;
- streamed verified GET under real SDK/R2 behavior;
- multipart ZIP upload, cancellation and orphaned-part cleanup;
- presigned URL behavior;
- lifecycle and retention rules;
- CORS and custom-domain/cache behavior;
- version-aware or atomic deletion semantics;
- region and contractual data-residency claims;
- actual storage and operation charges.

The local `R2Storage` class exercises official AWS S3 command objects with a deterministic in-memory command fake. It supports bounded image/master buffers only. It has no delete method and no multipart package upload. It is interface evidence, not proof of remote compatibility.

### Container runtime

Docker was not installed on the host, so a container image was not built or exercised. The local native Sharp binary worked on macOS/arm64, but Linux container codec compatibility, cross-platform byte hashes, memory limits, concurrency, shutdown handling and health checks remain human-gated deployment evidence.

## Decision

The local evidence supports:

- Sharp/libvips for deterministic contractual derivatives after Linux verification;
- containerized background processing rather than Vercel request handlers;
- Cloudflare R2 as the leading canonical-store candidate;
- streaming packages to a multipart uploader that still must be built and tested;
- strict manifests derived from exact package inputs;
- immutable checksum-addressed create-only keys;
- tenant-bound storage clients;
- no remote deletion until atomic/version-aware behavior is verified.

The spike does **not** authorize production R2, a database migration, historical backfill, object deletion, route retirement, or current-delivery replacement.

## Reproduction

```bash
cd spikes/media-worker
npm ci
npm test
npm run benchmark -- 50
npm run benchmark -- 100
npm run benchmark -- 200
npm audit --omit=dev
```
