import assert from 'node:assert/strict';
import type { Expense, Ingredient, Product, PurchaseRecord, Sale } from '../src/types';
import {
  buildAdjustmentPlan,
  buildCheckoutPlan,
  buildOpeningStockPlan,
  buildPartialReturnPlan,
  buildPurchasePlan,
  buildStockCountPlan,
  buildVoidPlan,
  computeFinancialReport,
  getAvailableUnitsForProduct,
  normalizeProduct,
  resolveBarcodeMatch,
} from '../src/utils/inventoryEngine';
import { convertUnitQty, formatDateInPhnomPenh } from '../src/utils/format';

// ---------------------------------------------------------------------------
// Fixture Helpers
// ---------------------------------------------------------------------------

function makeIngredients(): Ingredient[] {
  return [
    {
      id: 'ing_orange',
      name: 'Fresh Oranges',
      nameVi: 'Cam tươi',
      unit: 'kg',
      stockQty: 10,
      reorderLevel: 3,
      unitCostKhr: 8000, // 8,000 KHR / kg
      supplier: 'Orussey Market',
    },
    {
      id: 'ing_milk',
      name: 'Fresh Milk',
      nameVi: 'Sữa tươi',
      unit: 'L',
      stockQty: 5,
      reorderLevel: 2,
      unitCostKhr: 7000, // 7,000 KHR / L
      supplier: 'Dairy Wholesale',
    },
    {
      id: 'ing_matcha',
      name: 'Matcha Powder',
      nameVi: 'Bột Matcha',
      unit: 'g',
      stockQty: 200,
      reorderLevel: 50,
      unitCostKhr: 200, // 200 KHR / g
      supplier: 'Tea Co',
    },
    {
      id: 'ing_bottle',
      name: '330ml Bottle',
      nameVi: 'Chai 330ml',
      unit: 'pcs',
      stockQty: 30,
      reorderLevel: 10,
      unitCostKhr: 500,
      supplier: 'Packaging Hub',
    },
    {
      id: 'ing_cup',
      name: 'Cup + Lid + Straw',
      nameVi: 'Ly + Nắp + Ống hút',
      unit: 'pcs',
      stockQty: 50,
      reorderLevel: 15,
      unitCostKhr: 450,
      supplier: 'Packaging Hub',
    },
  ];
}

function makeProducts(): Product[] {
  return [
    {
      id: 'prod_water',
      name: 'Dasani Water 500ml',
      nameVi: 'Nước suối Dasani 500ml',
      brand: 'Dasani',
      category: 'packaged',
      productType: 'PACKAGED',
      priceKhr: 2000,
      costPriceKhr: 1000,
      imageUrl: '',
      active: true,
      barcode: '8851959132012',
      packagingBarcodes: [
        { barcode: '8851959132241', label: 'Carton (24 bottles)', unitsPerPack: 24 },
      ],
      stockQty: 12,
      reorderLevel: 6,
      unit: 'pcs',
      supplier: 'Beverage Distributor',
      recipe: [],
      recipeVersion: 1,
      variants: [],
    },
    {
      id: 'prod_matcha',
      name: 'Iced Matcha Latte',
      nameVi: 'Matcha Latte Đá',
      brand: 'JuiceFlow',
      category: 'tea',
      productType: 'PREPARED_TO_ORDER',
      priceKhr: 10000,
      costPriceKhr: 0,
      imageUrl: '',
      active: true,
      barcode: '',
      packagingBarcodes: [],
      stockQty: 0,
      reorderLevel: 0,
      unit: 'pcs',
      supplier: '',
      recipe: [
        { ingredientId: 'ing_matcha', quantity: 5, unit: 'g' },
        { ingredientId: 'ing_milk', quantity: 200, unit: 'ml' }, // unit conversion ml -> L (0.2 L)
        { ingredientId: 'ing_cup', quantity: 1, unit: 'pcs' },
      ],
      recipeVersion: 1,
      variants: [
        {
          id: 'var_small',
          name: 'Small',
          nameVi: 'Nhỏ',
          priceKhr: 9000,
          barcode: 'JF-MATCHA-S',
          recipe: [
            { ingredientId: 'ing_matcha', quantity: 4, unit: 'g' },
            { ingredientId: 'ing_milk', quantity: 150, unit: 'ml' },
            { ingredientId: 'ing_cup', quantity: 1, unit: 'pcs' },
          ],
          recipeVersion: 1,
        },
        {
          id: 'var_large',
          name: 'Large',
          nameVi: 'Lớn',
          priceKhr: 13000,
          barcode: 'JF-MATCHA-L',
          recipe: [
            { ingredientId: 'ing_matcha', quantity: 8, unit: 'g' },
            { ingredientId: 'ing_milk', quantity: 300, unit: 'ml' },
            { ingredientId: 'ing_cup', quantity: 1, unit: 'pcs' },
          ],
          recipeVersion: 1,
        },
      ],
    },
    {
      id: 'prod_bottled_oj',
      name: 'Bottled Fresh Orange Juice 330ml',
      nameVi: 'Nước cam tươi đóng chai 330ml',
      brand: 'JuiceFlow',
      category: 'juice',
      productType: 'PACKAGED',
      priceKhr: 8000,
      costPriceKhr: 4500,
      imageUrl: '',
      active: true,
      barcode: 'JF-OJ-330',
      packagingBarcodes: [],
      stockQty: 10,
      reorderLevel: 4,
      unit: 'pcs',
      supplier: 'Local Bottler',
      recipe: [],
      recipeVersion: 1,
      variants: [],
    },
  ];
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: msg });
    console.error(`FAIL  ${name}\n      ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// 13 Acceptance Test Scenarios
// ---------------------------------------------------------------------------

test('1. Packaged product sale deducts exact stock & logs sale_consumption movement', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const res = buildCheckoutPlan({
    clientTxId: 'tx_packaged_1',
    orderNumber: 'JF-1001',
    saleDate: '2026-11-20',
    items: [{ productId: 'prod_water', quantity: 3 }],
    paymentMethod: 'cash',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(res.ok, true);
  const water = res.updatedProducts!.find((p) => p.id === 'prod_water')!;
  assert.equal(water.stockQty, 9); // 12 - 3
  assert.equal(res.sale!.totalKhr, 6000);
  assert.equal(res.sale!.cogsKhr, 3000);
  assert.equal(res.movements!.length, 1);
  assert.equal(res.movements![0].movementType, 'sale_consumption');
  assert.equal(res.movements![0].itemClassification, 'packaged');
  assert.equal(res.movements![0].deltaQty, -3);
  assert.equal(res.movements![0].referenceId, 'tx_packaged_1');
});

test('2. Made-to-order drink sale converts units (ml->L) & deducts recipe ingredients', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();
  // Remove variants to test base recipe with 200ml milk -> 0.2L
  products[1] = { ...products[1], variants: [] };

  const res = buildCheckoutPlan({
    clientTxId: 'tx_mto_1',
    orderNumber: 'JF-1002',
    saleDate: '2026-11-20',
    items: [{ productId: 'prod_matcha', quantity: 2 }],
    paymentMethod: 'khqr',
    customerName: 'Dara',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(res.ok, true);
  assert.equal(convertUnitQty(200, 'ml', 'L'), 0.2);

  const matcha = res.updatedIngredients!.find((i) => i.id === 'ing_matcha')!;
  const milk = res.updatedIngredients!.find((i) => i.id === 'ing_milk')!;
  const cup = res.updatedIngredients!.find((i) => i.id === 'ing_cup')!;

  assert.equal(matcha.stockQty, 190); // 200 - 10g
  assert.equal(milk.stockQty, 4.6); // 5L - 0.4L
  assert.equal(cup.stockQty, 48); // 50 - 2
  assert.equal(res.movements!.length, 3);
  assert.ok(res.movements!.every((m) => m.movementType === 'sale_consumption'));
  // Per cup COGS: 5g*200 (1000) + 0.2L*7000 (1400) + 1*450 (450) = 2850 -> x2 = 5700
  assert.equal(res.sale!.cogsKhr, 5700);
});

test('3. Multi-variant drink (Small vs Large) charges variant price & deducts variant recipe', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const res = buildCheckoutPlan({
    clientTxId: 'tx_variant_1',
    orderNumber: 'JF-1003',
    saleDate: '2026-11-20',
    items: [
      { productId: 'prod_matcha', variantId: 'var_small', quantity: 1 },
      { productId: 'prod_matcha', variantId: 'var_large', quantity: 2 },
    ],
    paymentMethod: 'aba',
    customerName: 'Sovann',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(res.ok, true);
  // Total price: 9,000 + 2 * 13,000 = 35,000 KHR
  assert.equal(res.sale!.totalKhr, 35000);

  // Matcha deducted: 4g + 2*8g = 20g -> 180g remaining
  const matcha = res.updatedIngredients!.find((i) => i.id === 'ing_matcha')!;
  assert.equal(matcha.stockQty, 180);

  // Milk deducted: 150ml + 2*300ml = 750ml = 0.75L -> 4.25L remaining
  const milk = res.updatedIngredients!.find((i) => i.id === 'ing_milk')!;
  assert.equal(milk.stockQty, 4.25);

  // Cups deducted: 1 + 2 = 3 -> 47 remaining
  const cup = res.updatedIngredients!.find((i) => i.id === 'ing_cup')!;
  assert.equal(cup.stockQty, 47);
});

test('4. Retail Packaged sale deducts packaged stock ONLY & never touches raw ingredients', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const res = buildCheckoutPlan({
    clientTxId: 'tx_packaged_sale_1',
    orderNumber: 'JF-1004',
    saleDate: '2026-11-20',
    items: [{ productId: 'prod_bottled_oj', quantity: 4 }],
    paymentMethod: 'cash',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(res.ok, true);
  const oj = res.updatedProducts!.find((p) => p.id === 'prod_bottled_oj')!;
  assert.equal(oj.stockQty, 6); // 10 - 4

  // Raw oranges and bottles must remain untouched (0 deduction at POS sale)
  const oranges = res.updatedIngredients!.find((i) => i.id === 'ing_orange')!;
  const bottles = res.updatedIngredients!.find((i) => i.id === 'ing_bottle')!;
  assert.equal(oranges.stockQty, 10);
  assert.equal(bottles.stockQty, 30);
  assert.equal(res.touchedIngredientIds!.length, 0);
  assert.equal(res.movements!.length, 1);
  assert.equal(res.movements![0].itemClassification, 'packaged');
});

test('5. Legacy PREPARED_STOCK items migrate safely to Made-to-Order (with recipe) or Retail Packaged (without recipe)', () => {
  const withRecipe = normalizeProduct({
    id: 'legacy_with_recipe',
    name: 'Legacy Bottled Juice',
    productType: 'PREPARED_STOCK',
    priceKhr: 8000,
    recipe: [{ ingredientId: 'ing_orange', quantity: 500, unit: 'g' }],
  } as unknown as Partial<Product> & { id: string });
  assert.equal(withRecipe.productType, 'PREPARED_TO_ORDER');

  const withoutRecipe = normalizeProduct({
    id: 'legacy_without_recipe',
    name: 'Legacy Canned Drink',
    productType: 'PREPARED_STOCK',
    priceKhr: 4000,
    stockQty: 15,
    recipe: [],
  } as unknown as Partial<Product> & { id: string });
  assert.equal(withoutRecipe.productType, 'PACKAGED');
  assert.equal(withoutRecipe.stockQty, 15);
});

test('6. Insufficient stock blocks checkout by default AND allows override when enabled in Settings', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();
  // Available Dasani water is 12; attempt to buy 15
  const blocked = buildCheckoutPlan({
    clientTxId: 'tx_short_1',
    items: [{ productId: 'prod_water', quantity: 15 }],
    paymentMethod: 'cash',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
    allowNegativeStock: false,
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.shortages!.length, 1);
  assert.equal(blocked.shortages![0].itemName, 'Dasani Water 500ml');
  assert.equal(blocked.shortages![0].requiredQty, 15);
  assert.equal(blocked.shortages![0].availableQty, 12);

  // With rush-hour override enabled:
  const allowed = buildCheckoutPlan({
    clientTxId: 'tx_short_override',
    items: [{ productId: 'prod_water', quantity: 15 }],
    paymentMethod: 'cash',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
    allowNegativeStock: true,
  });

  assert.equal(allowed.ok, true);
  assert.equal(allowed.updatedProducts!.find((p) => p.id === 'prod_water')!.stockQty, -3);
});

test('7. Idempotency prevents double deduction on retried clientTxId & blocks last-unit contention', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();
  products[0].stockQty = 2; // Only 2 bottles left

  const first = buildCheckoutPlan({
    clientTxId: 'tx_idemp_99',
    items: [{ productId: 'prod_water', quantity: 2 }],
    paymentMethod: 'cash',
    customerName: 'Buyer A',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
    existingSales: [],
  });

  assert.equal(first.ok, true);
  assert.equal(first.updatedProducts![0].stockQty, 0);

  // Retry exact same clientTxId (e.g. double-click or flaky network retry)
  const retry = buildCheckoutPlan({
    clientTxId: 'tx_idemp_99',
    items: [{ productId: 'prod_water', quantity: 2 }],
    paymentMethod: 'cash',
    customerName: 'Buyer A',
    note: '',
    recordedBy: 'Linh',
    products: first.updatedProducts!,
    ingredients: first.updatedIngredients!,
    existingSales: [first.sale!],
  });

  assert.equal(retry.ok, true);
  assert.equal(retry.idempotentDuplicate, true);
  assert.equal(retry.movements!.length, 0);
  assert.equal(retry.updatedProducts![0].stockQty, 0); // NOT -2!

  // Second distinct buyer tries to buy 1 bottle after stock hit 0
  const secondBuyer = buildCheckoutPlan({
    clientTxId: 'tx_buyer_b',
    items: [{ productId: 'prod_water', quantity: 1 }],
    paymentMethod: 'cash',
    customerName: 'Buyer B',
    note: '',
    recordedBy: 'Linh',
    products: first.updatedProducts!,
    ingredients: first.updatedIngredients!,
    existingSales: [first.sale!],
  });

  assert.equal(secondBuyer.ok, false);
  assert.equal(secondBuyer.shortages![0].availableQty, 0);
});

test('8. Voiding a sale AFTER recipe edit restores EXACT original deduction snapshot & blocks re-void', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const checkout = buildCheckoutPlan({
    clientTxId: 'tx_void_snap',
    orderNumber: 'JF-2001',
    saleDate: '2026-11-20',
    items: [{ productId: 'prod_matcha', variantId: 'var_large', quantity: 2 }], // 16g matcha, 0.6L milk
    paymentMethod: 'khqr',
    customerName: 'Customer',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(checkout.ok, true);
  assert.equal(checkout.updatedIngredients!.find((i) => i.id === 'ing_matcha')!.stockQty, 184);
  assert.equal(checkout.updatedIngredients!.find((i) => i.id === 'ing_milk')!.stockQty, 4.4);

  // NOW edit the Large Matcha recipe dramatically (e.g., 25g matcha & 500ml milk)
  const mutatedProducts = checkout.updatedProducts!.map((p) =>
    p.id === 'prod_matcha'
      ? {
          ...p,
          variants: p.variants!.map((v) =>
            v.id === 'var_large'
              ? {
                  ...v,
                  recipeVersion: 2,
                  recipe: [
                    { ingredientId: 'ing_matcha', quantity: 25, unit: 'g' as const },
                    { ingredientId: 'ing_milk', quantity: 500, unit: 'ml' as const },
                  ],
                }
              : v
          ),
        }
      : p
  );

  // Void the original sale
  const voidRes = buildVoidPlan({
    sale: checkout.sale!,
    stockMovements: checkout.movements!,
    products: mutatedProducts,
    ingredients: checkout.updatedIngredients!,
    recordedBy: 'Mom',
    reason: 'Cancelled by customer',
    movementDate: '2026-11-20',
  });

  assert.equal(voidRes.ok, true);
  assert.equal(voidRes.updatedSale!.status, 'voided');
  assert.equal(voidRes.updatedSale!.netTotalKhr, 0);
  // Must restore exact 16g matcha (back to 200) and 0.6L milk (back to 5), NOT 50g / 1L!
  assert.equal(voidRes.updatedIngredients!.find((i) => i.id === 'ing_matcha')!.stockQty, 200);
  assert.equal(voidRes.updatedIngredients!.find((i) => i.id === 'ing_milk')!.stockQty, 5);
  assert.equal(voidRes.updatedIngredients!.find((i) => i.id === 'ing_cup')!.stockQty, 50);

  // Attempt to void the same sale again -> must be rejected
  const reVoid = buildVoidPlan({
    sale: voidRes.updatedSale!,
    stockMovements: [...checkout.movements!, ...voidRes.movements!],
    products: voidRes.updatedProducts!,
    ingredients: voidRes.updatedIngredients!,
    recordedBy: 'Mom',
  });
  assert.equal(reVoid.ok, false);
});

test('9. Partial return restores proportional original stock & transitions partially_returned -> refunded', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const checkout = buildCheckoutPlan({
    clientTxId: 'tx_ret_1',
    orderNumber: 'JF-2002',
    saleDate: '2026-11-20',
    items: [
      { productId: 'prod_water', quantity: 4 }, // 4 * 2000 = 8000, COGS 4000
      { productId: 'prod_bottled_oj', quantity: 2 }, // 2 * 8000 = 16000, COGS 9000
    ],
    paymentMethod: 'cash',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  assert.equal(checkout.ok, true);
  const waterLineId = checkout.sale!.items[0].lineId!;
  const ojLineId = checkout.sale!.items[1].lineId!;

  // Return 1 water bottle and 1 orange juice
  const ret1 = buildPartialReturnPlan({
    sale: checkout.sale!,
    returnItems: [
      { lineId: waterLineId, quantity: 1 },
      { lineId: ojLineId, quantity: 1 },
    ],
    products: checkout.updatedProducts!,
    ingredients: checkout.updatedIngredients!,
    recordedBy: 'Linh',
    reason: 'Customer changed mind',
    returnDate: '2026-11-20',
  });

  assert.equal(ret1.ok, true);
  assert.equal(ret1.updatedSale!.status, 'partially_returned');
  assert.equal(ret1.updatedSale!.refundedKhr, 10000); // 2000 + 8000
  assert.equal(ret1.updatedSale!.netTotalKhr, 14000); // 24000 - 10000
  assert.equal(ret1.updatedSale!.refundedCogsKhr, 5500); // 1000 + 4500
  assert.equal(ret1.updatedProducts!.find((p) => p.id === 'prod_water')!.stockQty, 9); // 12 - 4 + 1
  assert.equal(ret1.updatedProducts!.find((p) => p.id === 'prod_bottled_oj')!.stockQty, 9); // 10 - 2 + 1

  // Return all remaining items -> should transition to 'refunded'
  const ret2 = buildPartialReturnPlan({
    sale: ret1.updatedSale!,
    returnItems: [
      { lineId: waterLineId, quantity: 3 },
      { lineId: ojLineId, quantity: 1 },
    ],
    products: ret1.updatedProducts!,
    ingredients: ret1.updatedIngredients!,
    recordedBy: 'Linh',
    reason: 'Rest returned',
    returnDate: '2026-11-20',
  });

  assert.equal(ret2.ok, true);
  assert.equal(ret2.updatedSale!.status, 'refunded');
  assert.equal(ret2.updatedSale!.netTotalKhr, 0);
  assert.equal(ret2.updatedProducts!.find((p) => p.id === 'prod_water')!.stockQty, 12);
  assert.equal(ret2.updatedProducts!.find((p) => p.id === 'prod_bottled_oj')!.stockQty, 10);
});

test('10. Carton barcode scan multiplies packs & computes weighted-average unit cost', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  // Scan carton barcode
  const match = resolveBarcodeMatch('8851959132241', products);
  assert.ok(match);
  assert.equal(match.product.id, 'prod_water');
  assert.equal(match.isPackagingBarcode, true);
  assert.equal(match.unitsPerPack, 24);

  // Stock-in 2 cartons (48 bottles) at 57,600 KHR (1,200 KHR / bottle)
  // Existing: 12 bottles @ 1,000 KHR = 12,000 KHR
  // Combined: 60 bottles @ (12,000 + 57,600) / 60 = 69,600 / 60 = 1,160 KHR
  const purchaseRes = buildPurchasePlan({
    itemId: match.product.id,
    itemClassification: 'packaged',
    quantity: 48,
    packCount: 2,
    unitsPerPack: match.unitsPerPack,
    totalCostKhr: 57600,
    paymentMethod: 'aba',
    supplier: 'Beverage Distributor',
    barcodeScanned: '8851959132241',
    recordedBy: 'Dad',
    purchaseDate: '2026-11-20',
    products,
    ingredients,
  });

  assert.equal(purchaseRes.ok, true);
  assert.equal(purchaseRes.updatedProduct!.stockQty, 60);
  assert.equal(purchaseRes.updatedProduct!.costPriceKhr, 1160);
  assert.equal(purchaseRes.purchase!.quantity, 48);
  assert.equal(purchaseRes.movement!.movementType, 'purchase');
});

test('11. Opening stock increases stock & inventory valuation with ZERO expense or cash outflow', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  const beforeReport = computeFinancialReport({
    sales: [],
    expenses: [],
    purchases: [],
    products,
    ingredients,
  });

  const openRes = buildOpeningStockPlan({
    itemId: 'prod_water',
    itemClassification: 'packaged',
    quantity: 20,
    unitCostKhr: 1000,
    note: 'Initial shelf count',
    recordedBy: 'Owner',
    movementDate: '2026-11-01',
    products,
    ingredients,
  });

  assert.equal(openRes.ok, true);
  assert.equal(openRes.movement!.movementType, 'opening_stock');
  const nextProducts = products.map((p) => (p.id === 'prod_water' ? openRes.updatedProduct! : p));

  const afterReport = computeFinancialReport({
    sales: [],
    expenses: [],
    purchases: [],
    products: nextProducts,
    ingredients,
  });

  assert.equal(
    afterReport.inventoryValuation.packagedValueKhr - beforeReport.inventoryValuation.packagedValueKhr,
    20000
  );
  assert.equal(afterReport.operatingExpensesKhr, 0);
  assert.equal(afterReport.inventoryPurchasesCashOutKhr, 0);
  assert.equal(afterReport.businessNetCashFlowKhr, 0);
});

test('12. Financial reporting separates Accrual P&L vs Cash Flow (zero double-count) & Asia/Phnom_Penh dates', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  // Verify Asia/Phnom_Penh (+07:00) rollover: 2026-11-20T18:30:00Z is 2026-11-21 01:30 in Phnom Penh!
  const ppDate = formatDateInPhnomPenh(new Date('2026-11-20T18:30:00.000Z'));
  assert.equal(ppDate, '2026-11-21');

  // Record a sale: 5 bottles of Dasani (Revenue 10,000, COGS 5,000)
  const saleRes = buildCheckoutPlan({
    clientTxId: 'tx_fin_1',
    orderNumber: 'JF-3001',
    saleDate: '2026-11-20',
    items: [{ productId: 'prod_water', quantity: 5 }],
    paymentMethod: 'khqr',
    customerName: 'Walk-in',
    note: '',
    recordedBy: 'Linh',
    products,
    ingredients,
  });

  // Record a stock purchase of 24 bottles (24,000 KHR)
  const purchaseRes = buildPurchasePlan({
    itemId: 'prod_water',
    itemClassification: 'packaged',
    quantity: 24,
    totalCostKhr: 24000,
    paymentMethod: 'cash',
    supplier: 'Distributor',
    recordedBy: 'Dad',
    purchaseDate: '2026-11-20',
    products: saleRes.updatedProducts!,
    ingredients: saleRes.updatedIngredients!,
  });

  // Record 1 operating expense (Electricity 3,000), 1 legacy ingredient expense (10,000), and 1 household expense (5,000)
  const expenses: Expense[] = [
    {
      id: 'exp_elec',
      title: 'Electricity',
      scope: 'business',
      category: 'utilities',
      amountKhr: 3000,
      expenseDate: '2026-11-20',
      paymentMethod: 'aba',
      vendor: 'EDC',
      note: '',
      linkedIngredientId: '',
      recordedBy: 'Mom',
      createdAt: '2026-11-20T05:00:00Z',
    },
    {
      id: 'exp_legacy_ing',
      title: 'Legacy Sugar Restock',
      scope: 'business',
      category: 'ingredients',
      amountKhr: 10000,
      expenseDate: '2026-11-20',
      paymentMethod: 'cash',
      vendor: 'Market',
      note: '',
      linkedIngredientId: '',
      recordedBy: 'Mom',
      createdAt: '2026-11-20T05:00:00Z',
    },
    {
      id: 'exp_home',
      title: 'Family Dinner',
      scope: 'household',
      category: 'household',
      amountKhr: 5000,
      expenseDate: '2026-11-20',
      paymentMethod: 'cash',
      vendor: 'Local',
      note: '',
      linkedIngredientId: '',
      recordedBy: 'Mom',
      createdAt: '2026-11-20T05:00:00Z',
    },
  ];

  const purchases: PurchaseRecord[] = [purchaseRes.purchase!];
  const sales: Sale[] = [saleRes.sale!];

  const monthly = computeFinancialReport({
    sales,
    expenses,
    purchases,
    products: saleRes.updatedProducts!.map((p) =>
      p.id === 'prod_water' ? purchaseRes.updatedProduct! : p
    ),
    ingredients: saleRes.updatedIngredients!,
    dateStart: '2026-11-01',
    dateEnd: '2026-11-30',
    grouping: 'monthly',
  });

  // Accrual P&L checks (ZERO double-counting of 24,000 purchase or 10,000 legacy ingredient purchase!):
  assert.equal(monthly.netRevenueKhr, 10000);
  assert.equal(monthly.netCogsKhr, 5000);
  assert.equal(monthly.grossProfitKhr, 5000);
  assert.equal(monthly.operatingExpensesKhr, 3000); // Only Electricity!
  assert.equal(monthly.netProfitKhr, 2000); // 10,000 - 5,000 - 3,000 = +2,000 KHR!

  // Cash Flow checks:
  assert.equal(monthly.cashInflowsKhr, 10000);
  assert.equal(monthly.cashInflowsByMethod.khqr, 10000);
  assert.equal(monthly.inventoryPurchasesCashOutKhr, 34000); // 24,000 + 10,000 legacy
  assert.equal(monthly.operatingExpensesCashOutKhr, 3000);
  assert.equal(monthly.businessNetCashFlowKhr, -27000); // 10,000 - 34,000 - 3,000
  assert.equal(monthly.householdExpensesCashOutKhr, 5000);

  // Grouping check:
  assert.equal(monthly.series.length, 1);
  assert.equal(monthly.series[0].periodKey, '2026-11');
});

test('13. Physical stock count variance & Damaged/Expired write-offs update stock & audit log', () => {
  const products = makeProducts();
  const ingredients = makeIngredients();

  // Live availability helper check for made-to-order drink (Small Matcha: 200g/4=50, 5L/0.15L=33, 50 cups=50 -> 33)
  const avail = getAvailableUnitsForProduct(products[1], ingredients, 'var_small');
  assert.equal(avail.availableUnits, 33);

  // Stock count on Dasani water: physical count = 10 vs system 12 -> variance -2
  const countRes = buildStockCountPlan({
    itemId: 'prod_water',
    itemClassification: 'packaged',
    countedQty: 10,
    note: 'End-of-day shelf audit',
    recordedBy: 'Dad',
    movementDate: '2026-11-20',
    products,
    ingredients,
  });
  assert.equal(countRes.ok, true);
  assert.equal(countRes.updatedProduct!.stockQty, 10);
  assert.equal(countRes.movement!.movementType, 'stock_count');
  assert.equal(countRes.movement!.deltaQty, -2);

  // Expired write-off on Bottled Orange Juice: 2 expired bottles (always negative delta)
  const expiredRes = buildAdjustmentPlan({
    itemId: 'prod_bottled_oj',
    itemClassification: 'packaged',
    movementType: 'expired',
    deltaQty: 2, // positive input must still write off -2
    note: 'Past 48h freshness window',
    recordedBy: 'Mom',
    movementDate: '2026-11-20',
    products,
    ingredients,
  });
  assert.equal(expiredRes.ok, true);
  assert.equal(expiredRes.updatedProduct!.stockQty, 8);
  assert.equal(expiredRes.movement!.movementType, 'expired');
  assert.equal(expiredRes.movement!.deltaQty, -2);

  // Damaged write-off on Fresh Oranges: 1.5 kg spoiled
  const damagedRes = buildAdjustmentPlan({
    itemId: 'ing_orange',
    itemClassification: 'ingredient',
    movementType: 'damaged',
    deltaQty: 1.5,
    note: 'Bruised oranges',
    recordedBy: 'Mom',
    movementDate: '2026-11-20',
    products,
    ingredients,
  });
  assert.equal(damagedRes.ok, true);
  assert.equal(damagedRes.updatedIngredient!.stockQty, 8.5);
  assert.equal(damagedRes.movement!.movementType, 'damaged');
  assert.equal(damagedRes.movement!.deltaQty, -1.5);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passedCount = results.filter((r) => r.passed).length;
console.log(`\nSummary: ${passedCount}/${results.length} acceptance scenarios passed.`);
if (passedCount !== results.length) {
  process.exit(1);
}
