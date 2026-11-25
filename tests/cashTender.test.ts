import assert from 'node:assert/strict';
import {
  calculateCashTender,
  computeExactRemainingKhr,
  DEFAULT_POS_EXCHANGE_RATE,
  roundKhrToNearest100,
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
  const res = calculateCashTender({
    totalKhr: 20000,
    usdReceived: 0,
    khrReceived: 20000,
    exchangeRate: DEFAULT_POS_EXCHANGE_RATE,
  });
  assert.equal(res.totalTenderedKhr, 20000);
  assert.equal(res.isCovered, true);
  assert.equal(res.changeDueKhr, 0);
  assert.equal(res.remainingDueKhr, 0);
  assert.equal(res.isMixed, false);
});

test('2. Pure USD overpayment calculates KHR change at configurable exchange rate', () => {
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

test('3. Mixed USD + KHR exact payment (50,000 KHR = $10 + 10,000 KHR)', () => {
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

test('4. Mixed USD + KHR overpayment calculates combined KHR change', () => {
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

test('5. Shortfall disables checkout and reports Remaining Due in KHR', () => {
  const res = calculateCashTender({
    totalKhr: 50000,
    usdReceived: 10,
    khrReceived: 0,
    exchangeRate: 4000,
  });
  assert.equal(res.totalTenderedKhr, 40000);
  assert.equal(res.isCovered, false);
  assert.equal(res.remainingDueKhr, 10000);
  assert.equal(res.changeDueKhr, 0);
});

test('6. Rounding to nearest 100 KHR works with custom exchange rates', () => {
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

test('7. buildCheckoutPlan stores cash drawer fields for Cash and null for digital payments', () => {
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
