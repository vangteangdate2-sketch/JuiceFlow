import assert from 'node:assert/strict';
import {
  addCashPreset,
  calculateCashTender,
  computeExactRemainingKhr,
  DEFAULT_CASH_PRESETS,
  DEFAULT_POS_EXCHANGE_RATE,
  parseNonNegativeNumber,
  removeCashPreset,
  roundKhrToNearest100,
  sanitizeCashPresets,
  updateCashPreset,
} from '../src/utils/cashTender';
import { buildCheckoutPlan } from '../src/utils/inventoryEngine';
import type { Product } from '../src/types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const sampleProduct: Product = {
  id: 'prod_water',
  name: 'Vital Water 500ml',
  nameVi: 'Nước Suối Vital 500ml',
  category: 'packaged',
  productType: 'PACKAGED',
  priceKhr: 10000,
  costPriceKhr: 5000,
  imageUrl: '',
  active: true,
  stockQty: 50,
  reorderLevel: 10,
  unit: 'pcs',
  supplier: 'Local',
  recipe: [],
  recipeVersion: 1,
  variants: [],
};

test('1. Pure KHR exact payment produces 0 KHR change and covers order', () => {
  const exact = computeExactRemainingKhr(20000);
  assert.equal(exact, 20000);

  const res = calculateCashTender({
    totalKhr: 20000,
    khrReceived: exact,
    exchangeRate: DEFAULT_POS_EXCHANGE_RATE,
  });
  assert.equal(res.totalTenderedKhr, 20000);
  assert.equal(res.isCovered, true);
  assert.equal(res.isShortfall, false);
  assert.equal(res.changeDueKhr, 0);
  assert.equal(res.remainingDueKhr, 0);
  assert.equal(res.isMixed, false);
});

test('2. Arbitrary typed KHR amounts calculate exact Change Due and exact Shortfall', () => {
  const overpaid = calculateCashTender({
    totalKhr: 12000,
    khrReceived: parseNonNegativeNumber('15,750'),
  });
  assert.equal(overpaid.isCovered, true);
  assert.equal(overpaid.isShortfall, false);
  assert.equal(overpaid.changeDueKhr, 3750);
  assert.equal(overpaid.remainingDueKhr, 0);

  const slightOver = calculateCashTender({
    totalKhr: 12000,
    khrReceived: parseNonNegativeNumber('12040'),
  });
  assert.equal(slightOver.isCovered, true);
  assert.equal(slightOver.changeDueKhr, 40);

  const short = calculateCashTender({
    totalKhr: 12000,
    khrReceived: parseNonNegativeNumber('11,950'),
  });
  assert.equal(short.isCovered, false);
  assert.equal(short.isShortfall, true);
  assert.equal(short.changeDueKhr, 0);
  assert.equal(short.remainingDueKhr, 50);

  const empty = calculateCashTender({
    totalKhr: 12000,
    khrReceived: parseNonNegativeNumber(''),
  });
  assert.equal(empty.isCovered, false);
  assert.equal(empty.isShortfall, true);
  assert.equal(empty.remainingDueKhr, 12000);
  assert.equal(empty.hasAnyInput, false);
});

test('3. Pure USD overpayment calculates KHR change at configurable exchange rate', () => {
  const res = calculateCashTender({
    totalKhr: 12000,
    usdReceived: 5,
    khrReceived: 0,
    exchangeRate: 4000,
  });
  assert.equal(res.usdEquivalentKhr, 20000);
  assert.equal(res.totalTenderedKhr, 20000);
  assert.equal(res.isCovered, true);
  assert.equal(res.changeDueKhr, 8000);
  assert.equal(res.isMixed, false);
});

test('4. Mixed USD + KHR exact payment (50,000 KHR = $10 + 10,000 KHR)', () => {
  const exactKhr = computeExactRemainingKhr(50000, 10, 4000);
  assert.equal(exactKhr, 10000);

  const res = calculateCashTender({
    totalKhr: 50000,
    usdReceived: 10,
    khrReceived: exactKhr,
    exchangeRate: 4000,
  });
  assert.equal(res.isMixed, true);
  assert.equal(res.totalTenderedKhr, 50000);
  assert.equal(res.isCovered, true);
  assert.equal(res.changeDueKhr, 0);
});

test('5. Mixed USD + KHR overpayment calculates combined KHR change', () => {
  const res = calculateCashTender({
    totalKhr: 50000,
    usdReceived: 10,
    khrReceived: 20000,
    exchangeRate: 4000,
  });
  assert.equal(res.totalTenderedKhr, 60000);
  assert.equal(res.isCovered, true);
  assert.equal(res.changeDueKhr, 10000);
});

test('6. Shortfall disables checkout and reports Remaining Due in KHR', () => {
  const res = calculateCashTender({
    totalKhr: 50000,
    usdReceived: 10,
    khrReceived: 0,
    exchangeRate: 4000,
  });
  assert.equal(res.totalTenderedKhr, 40000);
  assert.equal(res.isCovered, false);
  assert.equal(res.isShortfall, true);
  assert.equal(res.remainingDueKhr, 10000);
  assert.equal(res.changeDueKhr, 0);
});

test('7. Rounding to nearest 100 KHR works with custom USD exchange rates', () => {
  assert.equal(roundKhrToNearest100(340), 300);
  assert.equal(roundKhrToNearest100(350), 400);
  const res = calculateCashTender({
    totalKhr: 10000,
    usdReceived: 3,
    khrReceived: 0,
    exchangeRate: 4050, // 12,150 KHR -> diff 2,150 -> rounds to 2,200 KHR
  });
  assert.equal(res.isCovered, true);
  assert.equal(res.changeDueKhr, 2200);
});

test('8. Custom quick-cash preset sanitization, add, edit, and remove', () => {
  assert.deepEqual([...DEFAULT_CASH_PRESETS], [5000, 10000, 20000, 50000]);

  // Invalid / non-array falls back to defaults
  assert.deepEqual(sanitizeCashPresets(null), [5000, 10000, 20000, 50000]);
  // Explicit empty array stays empty (user cleared all presets)
  assert.deepEqual(sanitizeCashPresets([]), []);
  // Deduplicates, strips invalid, sorts ascending
  assert.deepEqual(sanitizeCashPresets([50000, -100, 0, '20,000', 5000, 5000, 'abc']), [
    5000, 20000, 50000,
  ]);

  // Add new custom preset
  const added = addCashPreset(DEFAULT_CASH_PRESETS, '100,000');
  assert.equal(added.ok, true);
  assert.deepEqual(added.presets, [5000, 10000, 20000, 50000, 100000]);

  // Reject duplicate or invalid add
  const dup = addCashPreset(added.presets, 10000);
  assert.equal(dup.ok, false);
  const zero = addCashPreset(added.presets, 0);
  assert.equal(zero.ok, false);

  // Edit existing preset and keep sorted order
  const edited = updateCashPreset(added.presets, 20000, 15000);
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.presets, [5000, 10000, 15000, 50000, 100000]);

  // Reject editing into an existing duplicate
  const editDup = updateCashPreset(edited.presets, 15000, 10000);
  assert.equal(editDup.ok, false);

  // Remove preset
  const removed = removeCashPreset(edited.presets, 5000);
  assert.deepEqual(removed, [10000, 15000, 50000, 100000]);

  // Quick-cash preset selection covers order & computes exact change
  const presetTender = calculateCashTender({
    totalKhr: 12000,
    khrReceived: removed[1], // 15,000 KHR custom preset
  });
  assert.equal(presetTender.isCovered, true);
  assert.equal(presetTender.changeDueKhr, 3000);
});

test('9. buildCheckoutPlan stores cash drawer fields for Cash and null for digital payments', () => {
  const cashPlan = buildCheckoutPlan({
    clientTxId: 'sale_cash_mixed_1',
    items: [{ productId: sampleProduct.id, quantity: 5 }], // 50,000 KHR
    paymentMethod: 'cash',
    cash_received_usd: 10,
    cash_received_khr: 15000,
    exchange_rate_used: 4000,
    change_given_khr: 5000,
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Sothea',
    products: [sampleProduct],
    ingredients: [],
  });
  assert.equal(cashPlan.ok, true);
  assert.equal(cashPlan.sale?.cash_received_usd, 10);
  assert.equal(cashPlan.sale?.cash_received_khr, 15000);
  assert.equal(cashPlan.sale?.exchange_rate_used, 4000);
  assert.equal(cashPlan.sale?.change_given_khr, 5000);

  const khqrPlan = buildCheckoutPlan({
    clientTxId: 'sale_khqr_1',
    items: [{ productId: sampleProduct.id, quantity: 2 }], // 20,000 KHR
    paymentMethod: 'khqr',
    cash_received_usd: null,
    cash_received_khr: null,
    exchange_rate_used: null,
    change_given_khr: null,
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Sothea',
    products: [sampleProduct],
    ingredients: [],
  });
  assert.equal(khqrPlan.ok, true);
  assert.equal(khqrPlan.sale?.cash_received_usd, null);
  assert.equal(khqrPlan.sale?.cash_received_khr, null);
  assert.equal(khqrPlan.sale?.exchange_rate_used, null);
  assert.equal(khqrPlan.sale?.change_given_khr, null);
});

console.log('All cash tender tests passed!');
