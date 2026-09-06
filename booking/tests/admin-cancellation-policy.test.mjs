import test from 'node:test';
import assert from 'node:assert/strict';
import { isCancellable } from '../lib/booking/booking-status.ts';
test('admin cancellation permits work started; customer policy and terminal states unchanged', () => {
  for (const status of ['requested','confirmed','shot','editing','delivered','cancelled']) {
    assert.equal(isCancellable(status, 'admin'), ['requested','confirmed','shot','editing'].includes(status), status);
    assert.equal(isCancellable(status), ['requested','confirmed'].includes(status), status);
    assert.equal(isCancellable(status, 'realtor'), ['requested','confirmed'].includes(status), status);
  }
});
