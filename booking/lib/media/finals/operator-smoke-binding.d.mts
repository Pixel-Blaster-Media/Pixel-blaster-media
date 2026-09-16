export const SMOKE_ADMISSION_HEADER: 'x-photo-finals-smoke-admission-sha256';
export const SMOKE_ADMISSION_FIELDS: readonly ['version','issuedAt','expiresAt','runId','actorId','organizationId','origin','claimKey','objectKey','resourceSha256'];
export function smokeAdmissionSha256(admission:Record<string,string>):string;
