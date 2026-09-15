import { R2Storage } from '../storage/r2-core.ts';

/** Finals-only capability boundary. Wrong-ETag deletion is not certified on R2.
 * Retain quarantine; this is neither cleanup success nor an authorized expiry policy.
 * Keep the shared/legacy adapter unchanged. Enabling deletion needs separate proof.
 */
export class FinalsR2Storage extends R2Storage {
  override async deleteQuarantine(_options: Parameters<R2Storage['deleteQuarantine']>[0]): Promise<void> {
    throw new Error('finals_quarantine_delete_uncertified');
  }
}
