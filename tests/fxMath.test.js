import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalPairBase, computeToAmount, deriveSide, weightedAverageCost, computeRealizedPl
} from '../src/domain/fxMath.js';

// Registry order mirrors the app: USD < AFN < PKR.
const ORDER = { USD: 1, AFN: 2, PKR: 3, EUR: 4 };
const sortOrderOf = (code) => ORDER[code];

test('canonical pair base is the lower-sort-order asset', () => {
  assert.equal(canonicalPairBase('USD', 'AFN', sortOrderOf), 'USD');
  assert.equal(canonicalPairBase('AFN', 'USD', sortOrderOf), 'USD');
  assert.equal(canonicalPairBase('AFN', 'PKR', sortOrderOf), 'AFN');
  assert.equal(canonicalPairBase('PKR', 'AFN', sortOrderOf), 'AFN');
});

test('to-amount multiplies when from is the base, divides otherwise', () => {
  // Sell 2,000 USD at 72 (1 USD = 72 AFN) → 144,000 AFN.
  assert.equal(computeToAmount('USD', 'AFN', 2000, 72, sortOrderOf), 144000);
  // Buy USD with 144,000 AFN at 72 → 2,000 USD.
  assert.equal(computeToAmount('AFN', 'USD', 144000, 72, sortOrderOf), 2000);
  // AFN → PKR at 0.28 (1 AFN... base is AFN): 84,000 AFN → 300,000 PKR at rate quoted
  // "1 AFN = N PKR"? No — canonical is "1 AFN = N AFN-quote". The app's seed trade:
  // 84,000 AFN → 300,000 PKR quoted 0.28 as "1 PKR = 0.28 AFN" → base AFN, rate 1/0.28.
  // With canonical quoting the caller sends rate = 300000/84000 ≈ 3.5714.
  assert.ok(Math.abs(computeToAmount('AFN', 'PKR', 84000, 300000 / 84000, sortOrderOf) - 300000) < 1e-6);
});

test('side derives from the funding currency', () => {
  assert.equal(deriveSide('AFN'), 'buy');
  assert.equal(deriveSide('USD'), 'sell');
  assert.equal(deriveSide('PKR'), 'sell');
});

test('weighted-average cost tracks buys and strips sells at average', () => {
  const trades = [
    // Buy 5,000 USD for 355,000 AFN (71/unit).
    { fromCurrency: 'AFN', toCurrency: 'USD', fromAmount: 355000, toAmount: 5000, fromAfnValue: 355000 },
    // Buy 1,000 USD for 73,000 AFN (73/unit) → avg (355000+73000)/6000 = 71.333…
    { fromCurrency: 'AFN', toCurrency: 'USD', fromAmount: 73000, toAmount: 1000, fromAfnValue: 73000 },
    // Sell 2,000 USD — removes 2,000 × avg from cost.
    { fromCurrency: 'USD', toCurrency: 'AFN', fromAmount: 2000, toAmount: 144000, fromAfnValue: 143600 }
  ];
  const { qty, avgCost } = weightedAverageCost(trades, 'USD');
  assert.equal(qty, 4000);
  assert.ok(Math.abs(avgCost - 428000 / 6000) < 1e-9);
});

test('cross-currency buys cost their snapshotted AFN value', () => {
  const trades = [
    // Buy 5,000 USD paying 1,410,000 PKR, AFN value snapshotted at 355,320.
    { fromCurrency: 'PKR', toCurrency: 'USD', fromAmount: 1410000, toAmount: 5000, fromAfnValue: 355320 }
  ];
  const { avgCost } = weightedAverageCost(trades, 'USD');
  assert.ok(Math.abs(avgCost - 355320 / 5000) < 1e-9);
});

test('realized P&L is proceeds minus average cost of the disposed lot', () => {
  const priorTrades = [
    { fromCurrency: 'AFN', toCurrency: 'USD', fromAmount: 355000, toAmount: 5000, fromAfnValue: 355000 }
  ];
  // Sell 2,000 USD for 144,000 AFN; cost basis 71/unit → profit 2,000 AFN.
  const pl = computeRealizedPl({
    fromCur: 'USD', fromAmount: 2000, priorTrades, proceedsAfn: 144000
  });
  assert.ok(Math.abs(pl - 2000) < 1e-9);
});

test('buys from AFN realize nothing', () => {
  assert.equal(
    computeRealizedPl({ fromCur: 'AFN', fromAmount: 1000, priorTrades: [], proceedsAfn: 14 }),
    null
  );
});
