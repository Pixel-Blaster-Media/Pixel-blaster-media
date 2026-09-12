import 'server-only';
import type { FinalsIdentity, FinalsRuntime } from './http';
import { photoFinalsEligibility } from './config';
/** Separate production boundary. Deliberately returns unavailable until the exact
 * schema, dedicated private storage/capability adapter and deployed worker budget
 * have independent proof. Never calls or relaxes the development R2 factory.
 * Flags alone cannot enable this local-execution candidate. */
export async function createProductionFinalsRuntime(identity:FinalsIdentity):Promise<FinalsRuntime|null>{
 const eligibility=photoFinalsEligibility(process.env,identity.scope);
 if(!eligibility.eligible||eligibility.environment!=='production')return null;
 return null;
}
