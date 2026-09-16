import {createHash} from 'node:crypto';

export const SMOKE_ADMISSION_HEADER = 'x-photo-finals-smoke-admission-sha256';
export const SMOKE_ADMISSION_FIELDS = Object.freeze(['version','issuedAt','expiresAt','runId','actorId','organizationId','origin','claimKey','objectKey','resourceSha256']);

// Fixed-order JSON array, UTF-8, domain-separated; callers validate admission first.
export function smokeAdmissionSha256(admission) {
  return createHash('sha256').update(JSON.stringify([
    'photo-finals-operator-smoke-admission-sha256-v1',
    ...SMOKE_ADMISSION_FIELDS.map(key=>admission[key]),
  ])).digest('hex');
}
