import test from 'node:test';
import assert from 'node:assert/strict';
import { commissionAmount } from '../src/domain/commission.js';
import { formatHawalaCode } from '../src/domain/codes.js';

test('percent commission is pct of the amount, defaulting to 1%', () => {
  assert.equal(
    commissionAmount({ amount: 5000, commissionMode: 'percent', commissionPct: 1.0 }),
    50
  );
  assert.equal(
    commissionAmount({ amount: 850000, commissionMode: 'percent', commissionPct: 1.2 }),
    10200
  );
  assert.equal(
    commissionAmount({ amount: 1000, commissionMode: 'percent', commissionPct: undefined }),
    10
  );
});

test('fixed commission uses the explicit fee', () => {
  assert.equal(
    commissionAmount({ amount: 5000, commissionMode: 'fixed', commissionFixed: 35 }),
    35
  );
  assert.equal(
    commissionAmount({ amount: 5000, commissionMode: 'fixed', commissionFixed: undefined }),
    0
  );
});

test('hawala codes are 6-digit zero-padded', () => {
  assert.equal(formatHawalaCode(100001), '100001');
  assert.equal(formatHawalaCode(7), '000007');
  assert.equal(formatHawalaCode(1234567), '234567');
});
