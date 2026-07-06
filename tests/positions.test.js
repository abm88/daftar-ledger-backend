import test from 'node:test';
import assert from 'node:assert/strict';
import {
  counterpartyPositions, customerBalances, withRunningBalances
} from '../src/domain/positions.js';

const CURRENCIES = ['USD', 'AFN', 'PKR'];

test('counterparty positions: paid send +, paid recv −, pending ignored', () => {
  const hawalas = [
    { type: 'send', status: 'paid', currency: 'USD', amount: 5000 },
    { type: 'recv', status: 'paid', currency: 'USD', amount: 1500 },
    { type: 'send', status: 'pending', currency: 'USD', amount: 99999 },
    { type: 'recv', status: 'paid', currency: 'AFN', amount: 240000 }
  ];
  const p = counterpartyPositions(hawalas, CURRENCIES);
  assert.equal(p.USD, 3500);
  assert.equal(p.AFN, -240000);
  assert.equal(p.PKR, 0);
});

test('settle entries apply their signed delta directly', () => {
  const hawalas = [
    { type: 'send', status: 'paid', currency: 'USD', amount: 5000 },
    { type: 'settle', status: 'paid', currency: 'USD', amount: -5000 }
  ];
  const p = counterpartyPositions(hawalas, CURRENCIES);
  assert.equal(p.USD, 0);
});

test('customer balances: opening/deposit credit, others debit', () => {
  const txs = [
    { type: 'opening', currency: 'USD', amount: 8500 },
    { type: 'deposit', currency: 'USD', amount: 3200 },
    { type: 'withdrawal', currency: 'USD', amount: 2500 },
    { type: 'withdrawal', currency: 'AFN', amount: 450000 },
    { type: 'charge', currency: 'PKR', amount: 180000 },
    { type: 'credit', currency: 'AFN', amount: 600000 }
  ];
  const b = customerBalances(txs, CURRENCIES);
  assert.equal(b.USD, 9200);
  assert.equal(b.AFN, -1050000);
  assert.equal(b.PKR, -180000);
});

test('running balances annotate per-currency before/after', () => {
  const txs = [
    { id: 1, type: 'opening', currency: 'USD', amount: 1000 },
    { id: 2, type: 'withdrawal', currency: 'USD', amount: 300 },
    { id: 3, type: 'deposit', currency: 'AFN', amount: 5000 }
  ];
  const annotated = withRunningBalances(txs);
  assert.deepEqual(
    annotated.map((t) => [t.balanceBefore, t.balanceAfter]),
    [[0, 1000], [1000, 700], [0, 5000]]
  );
});
