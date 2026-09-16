// Intentionally RED prerequisite witness, not part of the green regression suite.
// No credentials, network, production ACK or application changes.
import assert from 'node:assert/strict';
import {finalsExecutionAllowed} from '../lib/media/finals/production-config.ts';
const scope={organizationId:'11111111-1111-4111-8111-111111111111',bookingId:'21111111-1111-4111-8111-111111111111',propertyId:'31111111-1111-4111-8111-111111111111'};
const env={PHOTO_FINALS_ENABLED:'true',PHOTO_FINALS_ENVIRONMENT:'production',VERCEL_ENV:'production',PHOTO_FINALS_ALLOWED_SCOPES:JSON.stringify([scope])};
assert.equal(finalsExecutionAllowed(env,scope),true,'BLOCKER: current hosted entry requires prior certification ACK; it cannot itself perform un-certified prerequisites truthfully. Keep this RED until a separately reviewed non-attesting probe exists. Do not fix by supplying ACK.');
