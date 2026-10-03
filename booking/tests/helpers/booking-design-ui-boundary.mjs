import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reverse only the explicitly reviewed booking design hunks. Earlier audit,
// privacy, admin and media boundaries continue to compare every remaining byte.
const delta = JSON.parse(readFileSync(new URL('./booking-design-ui-delta.json', import.meta.url), 'utf8'));
export const bookingDesignUiPaths = Object.keys(delta);
export function beforeBookingDesignUi(path, source) {
  for (const [candidate, prior] of delta[path] ?? []) {
    assert.equal(source.split(candidate).length - 1, 1, 'exact booking design UI hunk: ' + path);
    source = source.replace(candidate, () => prior);
  }
  return source;
}
