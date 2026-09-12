import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildMasterKey, inspectMediaObjectKey, type MediaObjectKey } from "../storage/keys.ts";
import type { R2Storage } from "../storage/r2-core.ts";
import { photoFinalsEligibility, type PhotoFinalsScope } from "./config.ts";

// Compatible with PostgREST's rpc result; no credentials or production factory here.
export interface FinalsDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>;
}
async function rpc(db: FinalsDatabase, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) {
    const message=typeof result.error==="object" && result.error!==null && "message" in result.error ? result.error.message : null;
    const known=new Set(["finals_hash_collision_other_intent_or_booking","finals_intent_payload_conflict","finals_actor_denied","finals_booking_denied","finals_tenant_quota","finals_batch_quota","finals_lease_lost"]);
    throw new Error(typeof message==="string" && known.has(message) ? message : `finals_rpc_failed:${name}`);
  }
  return result.data;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("finals_envelope_invalid");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("finals_envelope_invalid");
  return value;
}
function localGate(env: Readonly<Record<string,string|undefined>>, scope: PhotoFinalsScope) {
  const eligibility = photoFinalsEligibility(env,scope);
  // Production execution intentionally unavailable until factory/budget/release gates pass.
  if (!eligibility.eligible || eligibility.environment !== "synthetic-local") throw new Error("finals_ingest_disabled");
}
export async function createFinalIntent(options: {
  db: FinalsDatabase; env: Readonly<Record<string,string|undefined>>; scope: PhotoFinalsScope;
  actorId: string; requestId: string; intentId: string; sha256: string; byteSize: number;
}) {
  localGate(options.env,options.scope);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (![options.actorId,options.requestId,options.intentId].every(id=>typeof id==="string" && uuid.test(id)) ||
      !/^[a-f0-9]{64}$/.test(options.sha256) || !Number.isSafeInteger(options.byteSize) || options.byteSize<1 || options.byteSize>FINAL_MAX_BYTES) throw new Error("finals_input_invalid");
  return rpc(options.db,"photo_finals_create_intent",{
    p_org:options.scope.organizationId,p_actor:options.actorId,p_booking:options.scope.bookingId,
    p_property:options.scope.propertyId,p_request:options.requestId,p_intent:options.intentId,
    p_sha256:options.sha256,p_bytes:options.byteSize,
  });
}

async function readBounded(storage: R2Storage,key: MediaObjectKey,hash: string,size: number,signal: AbortSignal): Promise<Buffer> {
  const download = await storage.getVerified(key,signal);
  try {
    if (download.bytes !== size || download.sha256 !== hash || size>FINAL_MAX_BYTES) throw new Error("finals_object_identity_mismatch");
    const chunks: Buffer[]=[];
    let received=0;
    for await (const chunk of download.body) {
      signal.throwIfAborted();
      received+=chunk.length;
      if (received>size || received>FINAL_MAX_BYTES) throw new Error("finals_object_size_exceeded");
      chunks.push(Buffer.from(chunk));
    }
    if (received!==size) throw new Error("finals_object_size_mismatch");
    return Buffer.concat(chunks,received);
  } finally { download.body.destroy(); }
}

/** One local synthetic job per invocation; retry dispatcher is separately bounded below.
 * No browser completion assertion is evidence. Quarantine and masters are private.
 * Lost PUT/accept responses leave durable identity and are recovered create-only.
 */
export async function processFinalIntent(options: {
  db: FinalsDatabase; storage: R2Storage;
  env: Readonly<Record<string,string|undefined>>; scope: PhotoFinalsScope; jobId: string; workerId: string;
}): Promise<{status:"accepted"|"not_claimed";versionId?:string}> {
  localGate(options.env,options.scope);
  const {db,storage,scope,jobId}=options;
  const common={p_org:scope.organizationId,p_job:jobId};
  const raw=await rpc(db,"photo_finals_claim",{...common,p_worker:options.workerId});
  if (!raw || !row(raw).id) return {status:"not_claimed"};
  const claim=row(raw);
  const lease=text(claim.finals_lease_token);
  const fenced={...common,p_lease:lease};
  const signal=AbortSignal.timeout(90_000);
  let reject=false;
  let accepting=false;
  try {
    const target=row(await rpc(db,"photo_finals_target",fenced));
    const job=row(target.job), version=row(target.version);
    if (job.id!==jobId || job.organization_id!==scope.organizationId || job.property_id!==scope.propertyId ||
        job.finals_lease_token!==lease || target.booking_id!==scope.bookingId ||
        version.id!==job.finals_version_id || version.organization_id!==scope.organizationId ||
        version.property_id!==scope.propertyId || version.batch_id!==job.batch_id) throw new Error("finals_envelope_scope_mismatch");
    const size=Number(job.finals_byte_size);
    const bytea=text(job.finals_sha256);
    if (!/^\\x[0-9a-f]{64}$/.test(bytea) || !Number.isSafeInteger(size) || size<1 || size>FINAL_MAX_BYTES) throw new Error("finals_envelope_evidence_invalid");
    const hash=bytea.slice(2);
    const quarantine=inspectMediaObjectKey(text(job.finals_quarantine_key),scope.organizationId);
    if (quarantine.objectClass!=="quarantine" || !quarantine.key.startsWith(`quarantine/${scope.organizationId}/${jobId}/`)) throw new Error("finals_quarantine_invalid");
    const bytes=await readBounded(storage,quarantine.key,hash,size,signal);
    await rpc(db,"photo_finals_stage",{...fenced,p_stage:"quarantined"});
    await rpc(db,"photo_finals_stage",{...fenced,p_stage:"validating"});
    let evidence: JpegEvidence;
    try {
      evidence=await verifyFinalJpeg(bytes,hash,size,async()=>{await rpc(db,"photo_finals_stage",{...fenced,p_stage:"scanning"});});
    } catch(error) { reject=true; throw error; }
    const master=buildMasterKey(scope.organizationId,text(version.asset_id),text(version.id),hash,"jpg");
    signal.throwIfAborted();
    await rpc(db,"photo_finals_fence",fenced);
    try {
      await storage.putBufferCreateOnly({key:master,bytes,sha256:hash,contentType:"image/jpeg",signal});
    } catch (error) {
      // Includes ambiguous success. Only a complete verified GET of this exact identity allows recovery.
      try { await readBounded(storage,master,hash,size,signal); } catch { throw error; }
    }
    await readBounded(storage,master,hash,size,signal);
    signal.throwIfAborted();
    // Never settle retryable after an ambiguous acceptance response: it may already be committed.
    accepting=true;
    const accepted=row(await rpc(db,"photo_finals_accept",{...fenced,p_bucket:storage.location(master).bucket,p_width:evidence.width,p_height:evidence.height}));
    if (accepted.id!==version.id || accepted.ingest_state!=="accepted" || accepted.object_key!==master || !accepted.accepted_at) throw new Error("finals_accept_evidence_invalid");
    return {status:"accepted",versionId:text(version.id)};
  } catch(error) {
    if (!accepting) {
      try { await rpc(db,"photo_finals_fail",{...fenced,p_reject:reject}); }
      catch(settlement) { throw new AggregateError([error,settlement],"finals_failed_with_unsettled_lease"); }
    }
    throw error;
  }
}


/** Operator-invoked local dispatcher: at most two files, sequential, no whole-shoot buffer.
 * No scheduler is installed and no automatic background execution is claimed.
 */
export async function dispatchFinalIntents(options: Omit<Parameters<typeof processFinalIntent>[0],"jobId">) {
  localGate(options.env,options.scope);
  const due=await rpc(options.db,"photo_finals_due",{p_org:options.scope.organizationId,p_booking:options.scope.bookingId,p_property:options.scope.propertyId});
  if (!Array.isArray(due) || due.length>2 || due.some(id=>typeof id!=="string" || !/^[0-9a-f-]{36}$/.test(id))) throw new Error("finals_due_invalid");
  const results: Array<{jobId:string;status:string}>=[];
  for (const jobId of due) {
    try { results.push({jobId,...await processFinalIntent({...options,jobId})}); }
    catch { results.push({jobId,status:"failed_check_durable_state"}); }
  }
  return results;
}

export const FINAL_MAX_BYTES = 32 * 1024 * 1024;
export const FINAL_MAX_PIXELS = 100_000_000;
export type JpegEvidence = { sha256: string; byteSize: number; width: number; height: number };

/** Fully decode one bounded file; never buffer a shoot or a raw decoded image. */
export async function verifyFinalJpeg(bytes: Buffer, expectedHash: string, expectedBytes: number, beforePixelScan?: () => Promise<void>): Promise<JpegEvidence> {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 ||
      expectedBytes > FINAL_MAX_BYTES || bytes.length !== expectedBytes) throw new Error("jpeg_size_invalid");
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("jpeg_hash_invalid");
  const input = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(input).digest("hex");
  if (sha256 !== expectedHash) throw new Error("jpeg_checksum_mismatch");
  if (input[0] !== 0xff || input[1] !== 0xd8 || input.at(-2) !== 0xff || input.at(-1) !== 0xd9) throw new Error("jpeg_signature_invalid");
  const decoder = sharp(input, {failOn:"warning", limitInputPixels:FINAL_MAX_PIXELS, sequentialRead:true}).timeout({seconds:30});
  const meta = await decoder.metadata();
  if (meta.format !== "jpeg" || !meta.width || !meta.height || meta.width > 16384 || meta.height > 16384 ||
      meta.width * meta.height > FINAL_MAX_PIXELS || (meta.pages ?? 1) !== 1) throw new Error("jpeg_dimensions_invalid");
  await beforePixelScan?.();
  // stats forces a full libvips decode, returns only bounded aggregates (not raw pixel buffers).
  await decoder.stats();
  return {sha256, byteSize: input.length, width:meta.width, height:meta.height};
}
