# Development R2 Gate

Status: code-dark, synthetic-only, and prohibited from production use.

## Approved development topology

Use one private Cloudflare R2 bucket for this gate:

- bucket: `pixel-blaster-dev-synthetic-media`
- storage class: Standard
- location hint: Eastern North America (`enam`)
- public `r2.dev` URL: disabled
- custom domains: none
- CORS: none
- customer or production media: prohibited

The canonical key prefixes preserve future trust-zone separation inside the isolated bucket:

```text
quarantine/{organizationId}/{ingestJobId}/{randomUuid}
masters/{organizationId}/{assetId}/{versionId}/{sha256}.{extension}
derivatives/{organizationId}/{versionId}/{profileVersion}/{sha256}.{extension}
packages/{organizationId}/{releaseId}/{packageType}/{manifestSha256}.zip
```

A single bucket is intentionally used for the development proof because it minimizes provisioning surface and permits one bucket-scoped token. Separate quarantine, master, delivery, and public buckets remain the likely production topology once independent worker roles, retention classes, and credentials justify those boundaries. Passing this gate does not authorize that production topology.

## Lifecycle policy

Configure two development-only lifecycle rules:

1. Expire synthetic objects after 14 days.
2. Abort incomplete multipart uploads after 1 day.

Application code must still abort failed multipart uploads immediately. The lifecycle rule is only a last-resort orphan safeguard.

## Credential separation

Two credentials have different purposes and must not be reused:

1. **Provisioning credential**
   - Account-level Cloudflare permission sufficient to create/configure this bucket and its lifecycle rules.
   - Used interactively or by an operator only.
   - Never placed in application environment files.

2. **Runtime S3 credential**
   - R2 Object Read & Write.
   - Scoped only to `pixel-blaster-dev-synthetic-media`.
   - No account administration and no unrelated bucket access.
   - Stored only in the local ignored `.env.local` file for the live synthetic probe.

If read and write workloads separate later, replace this token with distinct read-only and read/write credentials. Browser clients must never receive either credential; future direct uploads must use narrowly scoped, short-lived presigned capabilities.

## Local configuration

Copy only the media variables from `.env.example` into ignored `.env.local` and fill them locally. Do not paste credentials into chat, documentation, source control, test output, or Mission Control.

Keep the boundary disabled except during the explicit live probe:

```dotenv
MEDIA_STORAGE_ENABLED=false
MEDIA_STORAGE_ENVIRONMENT=development
MEDIA_STORAGE_LIVE_PROBE_ACK=
MEDIA_R2_ACCOUNT_ID=
MEDIA_R2_ACCESS_KEY_ID=
MEDIA_R2_SECRET_ACCESS_KEY=
MEDIA_R2_BUCKET=pixel-blaster-dev-synthetic-media
```

For the authorized live test only, set:

```dotenv
MEDIA_STORAGE_ENABLED=true
MEDIA_STORAGE_LIVE_PROBE_ACK=development-synthetic-only
```

Immediately restore `MEDIA_STORAGE_ENABLED=false` and clear the acknowledgement after verification.

## Required live verification

Run:

```bash
npm run verify:r2:development
```

The verifier uses fixed synthetic tenant identities and must prove:

- the exact private development bucket exists;
- create-only buffered upload rejects replacement;
- HEAD returns exact byte and SHA-256 metadata;
- streamed GET reproduces and verifies every byte;
- multipart upload completes with the expected parts and checksum;
- checksum-invalid multipart work is aborted;
- no incomplete multipart upload remains under the synthetic prefix;
- every created synthetic object is conditionally removed;
- no synthetic object residue remains.

Expected output is one aggregate JSON object containing no credentials, URLs, customer identifiers, or full object keys.

## Fail-closed boundaries

- Configuration rejects production environment selection and Vercel production execution.
- The account endpoint is derived from a strict 32-character lowercase account ID.
- Operations cannot supply a bucket or endpoint.
- Keys are canonical, tenant-bound, and reject traversal or arbitrary filenames.
- Immutable writes use `If-None-Match: *`.
- Master, derivative, and package keys bind expected SHA-256 values.
- Deletion is unavailable for canonical objects. The development verifier may conditionally delete only exact quarantine objects using their returned ETag.
- The app has no route importing the R2 factory, so existing provider and delivery workflows remain authoritative.
- Any real-R2 mismatch, orphan, public access, credential overreach, or unexplained residue blocks this gate.

## Cost boundary

Standard storage is appropriate for this short-lived gate. Cloudflare's current Standard free tier includes 10 GB-month, one million Class A operations, and ten million Class B operations monthly; internet egress is free. Infrequent Access is deliberately excluded because it has retrieval fees, no free tier, and a 30-day minimum duration.
