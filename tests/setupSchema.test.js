import test from 'node:test';
import assert from 'node:assert/strict';
import { setupSchema } from '../src/validators/schemas.js';

const valid = {
  activeAssets: ['USD', 'AFN', 'PKR', 'GOLD'],
  reportingCurrency: 'AFN',
  tradeCurrency: 'USD',
  amounts: { USD: 12000, AFN: 500000 }
};

test('setup wizard payload: assets, currencies, and at least one amount', () => {
  assert.equal(setupSchema.safeParse(valid).success, true);

  assert.equal(setupSchema.safeParse({ ...valid, activeAssets: [] }).success, false);
  assert.equal(setupSchema.safeParse({ ...valid, reportingCurrency: undefined }).success, false);
  assert.equal(setupSchema.safeParse({ ...valid, tradeCurrency: undefined }).success, false);
  assert.equal(setupSchema.safeParse({ ...valid, amounts: {} }).success, false);
});

test('setup amounts must be strictly positive numbers', () => {
  assert.equal(setupSchema.safeParse({ ...valid, amounts: { USD: 0 } }).success, false);
  assert.equal(setupSchema.safeParse({ ...valid, amounts: { USD: -5 } }).success, false);
  assert.equal(setupSchema.safeParse({ ...valid, amounts: { USD: '12000' } }).success, true); // coerced
});

test('asset codes are trimmed and uppercased', () => {
  const parsed = setupSchema.parse({ ...valid, activeAssets: ['usd', ' afn '], amounts: { AFN: 1000 } });
  assert.deepEqual(parsed.activeAssets, ['USD', 'AFN']);
});
