import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeExpense } from '../src/services/expenseService.js';

test('serializeExpense derives ts (epoch ms) and date (YYYY-MM-DD) from created_at', () => {
  const createdAt = new Date('2026-07-19T09:30:00.000Z');
  const out = serializeExpense({
    id: 'e1',
    teamMemberId: 'tm1',
    teamMemberName: 'Wali',
    teamMemberRole: 'Partner',
    amount: '2500.000000',
    currency: 'AFN',
    note: 'Shop rent',
    createdAt
  });

  assert.equal(out.amount, 2500); // numeric, not the DB string
  assert.equal(out.ts, createdAt.getTime());
  assert.equal(out.date, '2026-07-19');
  assert.equal(out.teamMemberName, 'Wali');
  assert.equal(out.note, 'Shop rent');
});

test('serializeExpense tolerates a string created_at and a null note', () => {
  const out = serializeExpense({
    id: 'e2', teamMemberId: 'tm1', amount: 10, currency: 'USD',
    note: null, createdAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(out.date, '2026-01-02');
  assert.equal(out.note, '');
});
