import test from 'node:test';
import assert from 'node:assert/strict';
import {
  balanceStatus, counterpartyPositions, customerBalances, customerBalanceSummary,
  withRunningBalances
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

test('balance status: deposits and advances are independent, flat threshold applies', () => {
  assert.deepEqual(
    balanceStatus({ USD: 9200, AFN: -1050000, PKR: 0 }),
    { hasDeposits: true, hasAdvances: true, settled: false }
  );
  assert.deepEqual(
    balanceStatus({ USD: 0.4, AFN: -0.3 }),
    { hasDeposits: false, hasAdvances: false, settled: true }
  );
  assert.deepEqual(
    balanceStatus({ USD: 0, AFN: 100 }),
    { hasDeposits: true, hasAdvances: false, settled: false }
  );
});

test('customer balance summary aggregates holdings and status counts', () => {
  const { holdings, statusCounts } = customerBalanceSummary([
    { USD: 9200, AFN: -1050000, PKR: 0 },   // deposit + advance
    { USD: 5700, AFN: -280000, PKR: 0 },    // deposit + advance
    { USD: 2100, AFN: 0, PKR: 0 },          // deposit only
    { USD: 0.2, AFN: 0, PKR: 0 }            // settled (within threshold)
  ]);
  assert.equal(holdings.USD.deposits, 17000);
  assert.equal(holdings.USD.advances, 0);
  assert.equal(holdings.USD.net, 17000);
  assert.equal(holdings.AFN.deposits, 0);
  assert.equal(holdings.AFN.advances, 1330000);
  assert.equal(holdings.AFN.net, -1330000);
  assert.equal(holdings.PKR.net, 0);
  assert.deepEqual(statusCounts, { withDeposits: 3, withAdvances: 2, settled: 1 });
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
