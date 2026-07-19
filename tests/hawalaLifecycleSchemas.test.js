import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issueHawalaSchema, payoutHawalaSchema, createExpenseSchema,
  createTeamMemberSchema, updateTeamMemberSchema, createTransactionSchema
} from '../src/validators/schemas.js';

const UUID = '11111111-1111-1111-1111-111111111111';

// ---- issue hawala: send vs receive ----------------------------------------

test('a cash send needs a sender name; route is optional (auto-derived)', () => {
  const send = {
    type: 'send', counterpartyId: UUID, amount: 5000, currency: 'AFN',
    receiverName: 'Ahmad', senderName: 'Karim'
  };
  assert.equal(issueHawalaSchema.safeParse(send).success, true);
  // missing sender name fails
  assert.equal(issueHawalaSchema.safeParse({ ...send, senderName: undefined }).success, false);
});

test('an account send requires senderCustomerId', () => {
  const base = {
    type: 'send', counterpartyId: UUID, amount: 5000, currency: 'AFN',
    receiverName: 'Ahmad', senderMode: 'account'
  };
  assert.equal(issueHawalaSchema.safeParse(base).success, false);
  assert.equal(issueHawalaSchema.safeParse({ ...base, senderCustomerId: UUID }).success, true);
});

test('a receive requires the origin pickup code and a sender name', () => {
  const recv = {
    type: 'recv', counterpartyId: UUID, amount: 5000, currency: 'AFN',
    receiverName: 'Bilal', senderName: 'Origin sender', code: '100777'
  };
  assert.equal(issueHawalaSchema.safeParse(recv).success, true);
  assert.equal(issueHawalaSchema.safeParse({ ...recv, code: undefined }).success, false);
  assert.equal(issueHawalaSchema.safeParse({ ...recv, senderName: undefined }).success, false);
});

// ---- payout ----------------------------------------------------------------

test('payout defaults to cash and requires a customer only for account', () => {
  assert.deepEqual(payoutHawalaSchema.parse({}), { method: 'cash' });
  assert.equal(payoutHawalaSchema.safeParse({ method: 'account' }).success, false);
  assert.equal(
    payoutHawalaSchema.safeParse({ method: 'account', payoutCustomerId: UUID }).success,
    true
  );
});

// ---- expenses & team -------------------------------------------------------

test('an expense must reference a team member', () => {
  assert.equal(
    createExpenseSchema.safeParse({ teamMemberId: UUID, amount: 100, currency: 'AFN' }).success,
    true
  );
  assert.equal(createExpenseSchema.safeParse({ amount: 100, currency: 'AFN' }).success, false);
});

test('team member roles are constrained to the known set', () => {
  assert.equal(createTeamMemberSchema.safeParse({ name: 'Wali', role: 'Partner' }).success, true);
  assert.equal(createTeamMemberSchema.safeParse({ name: 'Wali', role: 'Boss' }).success, false);
  assert.equal(createTeamMemberSchema.safeParse({ name: 'Wali' }).success, true); // role optional
  assert.equal(updateTeamMemberSchema.safeParse({}).success, false); // needs ≥1 field
});

// ---- transaction photos ----------------------------------------------------

test('transactions accept a photos array and a legacy single photo', () => {
  const base = { type: 'deposit', amount: 100, currency: 'AFN' };
  assert.equal(createTransactionSchema.safeParse(base).success, true);
  assert.equal(
    createTransactionSchema.safeParse({ ...base, photos: ['data:image/png;base64,AAA'] }).success,
    true
  );
  assert.equal(
    createTransactionSchema.safeParse({ ...base, photo: 'https://example.com/a.jpg' }).success,
    true
  );
  // more than 10 attachments is rejected
  const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`);
  assert.equal(createTransactionSchema.safeParse({ ...base, photos: eleven }).success, false);
});
