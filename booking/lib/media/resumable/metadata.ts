import type {Metadata} from './transfer';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[0-9a-f]{64}$/;
/** Authenticated server metadata remains authority; local geometry is fail-closed. */
export function validateMetadata(value:unknown):Metadata{
 const m=value as Metadata;
 if(!m||!uuid.test(m.transferId)||!uuid.test(m.packageId)||!hash.test(m.indexSha256)||!hash.test(m.packageSha256)||!Number.isSafeInteger(m.byteSize)||m.byteSize<1||m.byteSize>1_100_000_000||m.chunkSize!==131072||m.chunkCount!==Math.ceil(m.byteSize/m.chunkSize)||!Array.isArray(m.chunkDigests)||m.chunkDigests.length!==m.chunkCount||m.chunkDigests.some(x=>typeof x!=='string'||!hash.test(x)))throw Error('invalid_metadata');
 return m;
}
export function samePackage(a:Metadata,b:Metadata){return a.packageId===b.packageId&&a.indexSha256===b.indexSha256&&a.packageSha256===b.packageSha256&&a.byteSize===b.byteSize&&a.chunkDigests.join('')===b.chunkDigests.join('');}
