// Configuration eligibility only: never an authorization or storage capability.
// Code-dark until the complete transactional workflow and adapters are reviewed.
export interface PhotoFinalsScope {
  readonly organizationId: string;
  readonly bookingId: string;
  readonly propertyId: string;
}

export type PhotoFinalsEligibility =
  | Readonly<{ eligible: true; environment: 'production' | 'synthetic-local' }>
  | Readonly<{ eligible: false; reason: 'disabled' | 'environment' | 'allowlist' }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCOPE_KEYS = ['bookingId', 'organizationId', 'propertyId'];

function isScope(value: unknown): value is PhotoFinalsScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(',') === SCOPE_KEYS.join(',')
    && SCOPE_KEYS.every((key) => typeof row[key] === 'string' && UUID.test(row[key] as string));
}

function scopeKey(scope: PhotoFinalsScope): string {
  return `${scope.organizationId}/${scope.bookingId}/${scope.propertyId}`;
}

export function photoFinalsEligibility(
  env: Readonly<Record<string, string | undefined>>,
  scope: PhotoFinalsScope,
): PhotoFinalsEligibility {
  if (env.PHOTO_FINALS_ENABLED !== 'true') return Object.freeze({ eligible: false, reason: 'disabled' });
  const environment = env.PHOTO_FINALS_ENVIRONMENT;
  if (environment === 'production') {
    if (env.VERCEL_ENV !== 'production') return Object.freeze({ eligible: false, reason: 'environment' });
  } else if (environment === 'synthetic-local') {
    if (env.VERCEL_ENV !== undefined || !['test', 'development'].includes(env.NODE_ENV ?? '')
      || env.PHOTO_FINALS_SYNTHETIC_ACK !== 'isolated-no-network') {
      return Object.freeze({ eligible: false, reason: 'environment' });
    }
  } else {
    return Object.freeze({ eligible: false, reason: 'environment' });
  }
  const raw = env.PHOTO_FINALS_ALLOWED_SCOPES;
  if (!isScope(scope) || typeof raw !== 'string' || raw.length > 65536) {
    return Object.freeze({ eligible: false, reason: 'allowlist' });
  }
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100 || !entries.every(isScope)) {
      return Object.freeze({ eligible: false, reason: 'allowlist' });
    }
    const keys = new Set(entries.map(scopeKey));
    if (keys.size !== entries.length || !keys.has(scopeKey(scope))) {
      return Object.freeze({ eligible: false, reason: 'allowlist' });
    }
    return Object.freeze({ eligible: true, environment });
  } catch {
    return Object.freeze({ eligible: false, reason: 'allowlist' });
  }
}
