import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoute } from '../src/domain/route.js';

test('send routes local → partner branch', () => {
  assert.deepEqual(
    deriveRoute({ type: 'send', localCity: 'KBL', counterpartyCity: 'HRT' }),
    { fromCity: 'KBL', toCity: 'HRT' }
  );
});

test('receive routes partner branch → local', () => {
  assert.deepEqual(
    deriveRoute({ type: 'recv', localCity: 'KBL', counterpartyCity: 'HRT' }),
    { fromCity: 'HRT', toCity: 'KBL' }
  );
});

test('a missing local city leaves that side null for the caller to fill', () => {
  assert.deepEqual(
    deriveRoute({ type: 'send', localCity: null, counterpartyCity: 'MZR' }),
    { fromCity: null, toCity: 'MZR' }
  );
  assert.deepEqual(
    deriveRoute({ type: 'recv', localCity: undefined, counterpartyCity: 'MZR' }),
    { fromCity: 'MZR', toCity: undefined }
  );
});
