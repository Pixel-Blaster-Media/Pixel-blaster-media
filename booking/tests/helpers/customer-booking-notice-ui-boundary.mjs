import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reverse only this feature's explicit functional UI hunks before comparing
// the earlier marketing/design release boundaries. Every hunk must match once.
const delta = JSON.parse(readFileSync(new URL('./customer-booking-notice-ui-delta.json', import.meta.url), 'utf8'));
export const customerBookingNoticeUiPaths = [...Object.keys(delta), 'app/admin/settings/availability/BookingNoticeEditor.tsx'];
export function beforeCustomerBookingNoticeUi(path, source) {
  for (const [candidate, prior] of delta[path] ?? []) {
    assert.equal(source.split(candidate).length - 1, 1, 'exact booking notice UI hunk: ' + path);
    source = source.replace(candidate, () => prior);
  }
  return source;
}
