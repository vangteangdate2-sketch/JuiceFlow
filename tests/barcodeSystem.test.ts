import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {
  buildRegistryFromProducts,
  detectBarcodeFormat,
  extractProductBarcodeRecords,
  findDuplicateBarcodeConflicts,
  formatBarcodeTypeLabel,
  generateUniqueInternalSku,
  lookupOpenFoodFactsV3,
  normalizeBarcodeString,
  parseOpenFoodFactsV3Response,
  resolveFromRegistryAndProducts,
  toBarcodeDocId,
} from '../src/utils/barcodeRegistry';
import {
  buildCheckoutPlan,
  buildPurchasePlan,
  buildVoidPlan,
  normalizeProduct,
  resolveBarcodeMatch,
} from '../src/utils/inventoryEngine';
import type { Product } from '../src/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return normalizeProduct({
    id: 'prod_test_1',
    name: 'Oishi Green Tea 380ml',
    nameVi: 'Trà Xanh Oishi 380ml',
    productType: 'PACKAGED',
    category: 'packaged',
    priceKhr: 4000,
    costPriceKhr: 2400,
    stockQty: 48,
    reorderLevel: 12,
    unit: 'pcs',
    supplier: 'Phnom Penh Beverage Co.',
    brand: 'Oishi',
    barcode: '8854698005015',
    packagingBarcodes: [
      {
        barcode: '00885469800501',
        label: 'Carton 24 bottles',
        unitsPerPack: 24,
      },
    ],
    variants: [],
    recipe: [],
    imageUrl: '',
    active: true,
    ...overrides,
  });
}

async function runTests() {
  let passed = 0;
  const run = async (name: string, fn: () => void | Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  };

  // 1. Standard barcode formats without country-prefix assumptions
  await run('detects EAN-13, EAN-8, UPC-A, UPC-E, Code 128, QR Code, and Internal SKU regardless of country prefix', () => {
    // Thailand (885), Cambodia (884), Vietnam (893), USA leading zero (004), Europe (544)
    assert.equal(detectBarcodeFormat('8854698005015'), 'EAN_13');
    assert.equal(detectBarcodeFormat('8840001000016'), 'EAN_13');
    assert.equal(detectBarcodeFormat('8934588012228'), 'EAN_13');
    assert.equal(detectBarcodeFormat('0049000042566'), 'EAN_13');
    assert.equal(detectBarcodeFormat('96385074'), 'EAN_8');
    assert.equal(detectBarcodeFormat('036000291452'), 'UPC_A');
    assert.equal(detectBarcodeFormat('04252614'), 'UPC_E');
    assert.equal(detectBarcodeFormat('425261'), 'UPC_E');
    assert.equal(detectBarcodeFormat('JF-PKG-OISHI-001'), 'INTERNAL');
    assert.equal(detectBarcodeFormat('LOT-2026-AB12'), 'CODE_128');
    assert.equal(detectBarcodeFormat('https://juiceflow.app/p/001'), 'QR_CODE');
    assert.equal(formatBarcodeTypeLabel('EAN_13'), 'EAN-13');
    assert.equal(formatBarcodeTypeLabel('CODE_128'), 'Code 128');
    assert.equal(formatBarcodeTypeLabel('QR_CODE'), 'QR Code');
  });

  // 2. Leading-zero string preservation & distinct deterministic Firestore doc IDs
  await run('preserves leading zeros strictly as strings and generates unique valid Firestore IDs', () => {
    const withLeadingZero = normalizeBarcodeString('  0049000042566\r\n');
    const withoutLeadingZero = normalizeBarcodeString('49000042566');

    assert.equal(withLeadingZero, '0049000042566');
    assert.equal(withoutLeadingZero, '49000042566');
    assert.notEqual(withLeadingZero, withoutLeadingZero);

    const idA = toBarcodeDocId(withLeadingZero);
    const idB = toBarcodeDocId(withoutLeadingZero);
    assert.notEqual(idA, idB);
    assert.match(idA, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.match(idB, /^[a-zA-Z0-9_-]{1,128}$/);

    // normalizeProduct must keep leading zeros on unit, variant, and carton barcodes
    const prod = makeProduct({
      barcode: '0049000042566',
      packagingBarcodes: [{ barcode: '00012345678905', label: 'Case 12', unitsPerPack: 12 }],
    });
    assert.equal(prod.barcode, '0049000042566');
    assert.equal(prod.packagingBarcodes?.[0]?.barcode, '00012345678905');
  });

  // 3. Physical HID keyboard scanner burst sanitization
  await run('normalizes HID keyboard scanner input with trailing CR/LF/whitespace', () => {
    const hidRaw = '0049000042566\r\n';
    const normalized = normalizeBarcodeString(hidRaw);
    assert.equal(normalized, '0049000042566');

    const product = makeProduct({ barcode: '0049000042566' });
    const registry = buildRegistryFromProducts([product]);
    const match = resolveFromRegistryAndProducts(hidRaw, registry, [product]);
    assert.ok(match);
    assert.equal(match.code, '0049000042566');
    assert.equal(match.product.id, product.id);
    assert.equal(match.unitsPerScan, 1);
  });

  // 4. Multi-barcode per product (unit + variants + carton) & registry-first precedence
  await run('resolves unit, size variant, and carton packaging barcodes from JuiceFlow registry first', () => {
    const packaged = makeProduct({
      id: 'prod_coke',
      name: 'Coca-Cola Zero 330ml',
      barcode: '0049000042566',
      packagingBarcodes: [
        { barcode: '0049000042566-CTN24', label: 'Carton 24 cans', unitsPerPack: 24 },
      ],
    });
    const drink = makeProduct({
      id: 'prod_mango',
      name: 'Fresh Mango Juice',
      productType: 'PREPARED_TO_ORDER',
      category: 'juice',
      barcode: 'JF-MTO-MANGO-001',
      packagingBarcodes: [],
      variants: [
        { id: 'v_m', name: 'Medium 500ml', nameVi: 'Cỡ Vừa', priceKhr: 6000, barcode: 'JF-MTO-MANGO-M', recipe: [], recipeVersion: 1 },
        { id: 'v_l', name: 'Large 700ml', nameVi: 'Cỡ Lớn', priceKhr: 8000, barcode: 'JF-MTO-MANGO-L', recipe: [], recipeVersion: 1 },
      ],
    });

    const records = extractProductBarcodeRecords(packaged);
    assert.equal(records.length, 2);
    assert.equal(records[0].packagingType, 'unit');
    assert.equal(records[0].unitsPerScan, 1);
    assert.equal(records[1].packagingType, 'carton');
    assert.equal(records[1].unitsPerScan, 24);

    const allProducts = [packaged, drink];
    const registry = buildRegistryFromProducts(allProducts);
    assert.equal(registry.length, 5); // 2 packaged + 3 drink (1 base + 2 variants)

    // Carton hit from registry
    const cartonRes = resolveFromRegistryAndProducts('0049000042566-CTN24', registry, allProducts);
    assert.ok(cartonRes);
    assert.ok(cartonRes.registryRecord);
    assert.equal(cartonRes.product.id, 'prod_coke');
    assert.equal(cartonRes.unitsPerScan, 24);
    assert.equal(cartonRes.packLabel, 'Carton 24 cans');

    // Variant hit from registry
    const variantRes = resolveFromRegistryAndProducts('JF-MTO-MANGO-L', registry, allProducts);
    assert.ok(variantRes);
    assert.equal(variantRes.product.id, 'prod_mango');
    assert.equal(variantRes.variant?.id, 'v_l');
    assert.equal(variantRes.unitsPerScan, 1);

    // Leading-zero mismatch must NOT falsely match
    const wrongZeroRes = resolveFromRegistryAndProducts('49000042566', registry, allProducts);
    assert.equal(wrongZeroRes, null);
  });

  // 5. Open Food Facts API v3 prefill parser & strict NO price/stock enforcement
  await run('parses Open Food Facts API v3 imported product metadata without ever setting KHR price or stock', async () => {
    const sampleV3Payload = {
      status: 'success',
      product: {
        product_name: 'Red Bull Energy Drink',
        product_name_vi: 'Nước Tăng Lực Red Bull 250ml',
        brands: 'Red Bull, TCP',
        categories_tags: ['en:beverages', 'en:energy-drinks'],
        quantity: '250ml',
        image_front_small_url: 'https://images.openfoodfacts.org/redbull.jpg',
        price: 9999,
        stock: 500,
      },
    };

    const parsed = parseOpenFoodFactsV3Response('0090024901000', sampleV3Payload);
    assert.ok(parsed);
    assert.equal(parsed.barcode, '0090024901000');
    assert.equal(parsed.name, 'Red Bull Energy Drink 250ml');
    assert.equal(parsed.nameVi, 'Nước Tăng Lực Red Bull 250ml');
    assert.equal(parsed.brand, 'Red Bull');
    assert.equal(parsed.suggestedCategory, 'packaged');
    assert.equal(parsed.source, 'open_food_facts');
    // Strictly assert local pricing & stock are NEVER populated by external lookup
    assert.equal('priceKhr' in (parsed as unknown as Record<string, unknown>), false);
    assert.equal('costPriceKhr' in (parsed as unknown as Record<string, unknown>), false);
    assert.equal('stockQty' in (parsed as unknown as Record<string, unknown>), false);

    // Mocked fetch test for lookupOpenFoodFactsV3
    let calledUrl = '';
    const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify(sampleV3Payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const fetched = await lookupOpenFoodFactsV3('0090024901000', mockFetch);
    assert.ok(fetched);
    assert.ok(
      calledUrl.startsWith('https://world.openfoodfacts.org/api/v3/product/0090024901000.json?')
    );
    assert.equal(fetched.barcode, '0090024901000');
  });

  // 6. Unknown products (404 / failure / network error / internal SKU skip) never throw
  await run('handles unknown barcodes and Open Food Facts failures gracefully for manual registration', async () => {
    const notFoundFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ status: 'failure' }), { status: 404 })) as typeof fetch;

    const res404 = await lookupOpenFoodFactsV3('8849999888877', notFoundFetch);
    assert.equal(res404, null);

    const networkErrFetch: typeof fetch = (async () => {
      throw new Error('Offline');
    }) as typeof fetch;
    const resOffline = await lookupOpenFoodFactsV3('8849999888877', networkErrFetch);
    assert.equal(resOffline, null);

    // Internal SKU should skip external lookup entirely
    let fetchInvoked = false;
    const spyFetch: typeof fetch = (async () => {
      fetchInvoked = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const resInternal = await lookupOpenFoodFactsV3('JF-PKG-LOCAL-001', spyFetch);
    assert.equal(resInternal, null);
    assert.equal(fetchInvoked, false);
  });

  // 7. Duplicate active barcode prevention across products, variants, cartons & self-duplicates
  await run('prevents duplicate active barcode assignment across products, variants, cartons, and self-duplicates', () => {
    const existing = [
      makeProduct({
        id: 'prod_a',
        name: 'Oishi Green Tea',
        barcode: '8854698005015',
        packagingBarcodes: [{ barcode: '00885469800501', label: 'Carton 24', unitsPerPack: 24 }],
      }),
      makeProduct({
        id: 'prod_b',
        name: 'Iced Latte',
        productType: 'PREPARED_TO_ORDER',
        barcode: 'JF-MTO-LATTE-001',
        packagingBarcodes: [],
        variants: [
          { id: 'v_l', name: 'Large', nameVi: 'Lớn', priceKhr: 9000, barcode: 'JF-MTO-LATTE-L', recipe: [], recipeVersion: 1 },
        ],
      }),
    ];
    const registry = buildRegistryFromProducts(existing);

    // Conflict with another product's primary barcode
    const conflicts1 = findDuplicateBarcodeConflicts(
      { id: 'prod_new', barcode: '8854698005015', variants: [], packagingBarcodes: [] },
      existing,
      registry
    );
    assert.equal(conflicts1.length, 1);
    assert.equal(conflicts1[0].existingProductId, 'prod_a');

    // Conflict with another product's carton barcode
    const conflicts2 = findDuplicateBarcodeConflicts(
      { id: 'prod_new', barcode: '00885469800501', variants: [], packagingBarcodes: [] },
      existing,
      registry
    );
    assert.equal(conflicts2.length, 1);
    assert.equal(conflicts2[0].existingProductId, 'prod_a');

    // Conflict with another product's variant barcode
    const conflicts3 = findDuplicateBarcodeConflicts(
      {
        id: 'prod_new',
        barcode: 'JF-PKG-OTHER-001',
        variants: [],
        packagingBarcodes: [{ barcode: 'JF-MTO-LATTE-L', label: 'Box 6', unitsPerPack: 6 }],
      },
      existing,
      registry
    );
    assert.equal(conflicts3.length, 1);
    assert.equal(conflicts3[0].existingProductId, 'prod_b');

    // Duplicate within the same product (unit barcode reused as carton barcode)
    const selfConflicts = findDuplicateBarcodeConflicts(
      {
        id: 'prod_new',
        barcode: '8840000111122',
        variants: [],
        packagingBarcodes: [{ barcode: '8840000111122', label: 'Carton 12', unitsPerPack: 12 }],
      },
      existing,
      registry
    );
    assert.equal(selfConflicts.length, 1);
    assert.equal(selfConflicts[0].existingProductId, 'prod_new');

    // Editing prod_a keeping its own barcodes MUST succeed with 0 conflicts
    const editSelfConflicts = findDuplicateBarcodeConflicts(
      {
        id: 'prod_a',
        barcode: '8854698005015',
        variants: [],
        packagingBarcodes: [{ barcode: '00885469800501', label: 'Carton 24', unitsPerPack: 24 }],
      },
      existing,
      registry
    );
    assert.equal(editSelfConflicts.length, 0);
  });

  // 8. Unique internal SKU generation avoids existing collisions
  await run('generates unique internal SKUs without colliding with existing products or registry', () => {
    const existing = [
      makeProduct({ id: 'p1', barcode: 'JF-PKG-SUGAR-001' }),
      makeProduct({ id: 'p2', barcode: 'JF-PKG-SUGAR-002' }),
    ];
    const registry = buildRegistryFromProducts(existing);
    const nextSku = generateUniqueInternalSku({
      productType: 'PACKAGED',
      category: 'packaged',
      name: 'Sugarcane Juice',
      existingProducts: existing,
      registry,
    });
    assert.notEqual(nextSku, 'JF-PKG-SUGAR-001');
    assert.notEqual(nextSku, 'JF-PKG-SUGAR-002');
    assert.equal(detectBarcodeFormat(nextSku), 'INTERNAL');
    assert.ok(nextSku.startsWith('JF-PKG-'));
  });

  // 9. Carton-to-unit stock receiving + POS carton sale stock deduction + void restoration
  await run('executes carton-to-unit stock-in, POS carton sale deduction (24 units), and exact void restoration', () => {
    const product = makeProduct({
      id: 'prod_water',
      name: 'Angkor Puro Water 500ml',
      stockQty: 10,
      costPriceKhr: 1000,
      priceKhr: 2000,
      barcode: '8841234567893',
      packagingBarcodes: [{ barcode: '00884123456789', label: 'Carton 24 bottles', unitsPerPack: 24 }],
    });

    // Step A: Scan carton barcode for Stock-In (2 cartons × 24 bottles = +48 bottles)
    const scanMatch = resolveBarcodeMatch('00884123456789', [product]);
    assert.ok(scanMatch);
    assert.equal(scanMatch.isPackagingBarcode, true);
    assert.equal(scanMatch.unitsPerPack, 24);

    const purchasePlan = buildPurchasePlan({
      itemId: product.id,
      itemClassification: 'packaged',
      quantity: 2 * scanMatch.unitsPerPack,
      packCount: 2,
      unitsPerPack: 24,
      totalCostKhr: 48000,
      paymentMethod: 'cash',
      supplier: product.supplier,
      barcodeScanned: '00884123456789',
      note: 'Carton restock',
      purchaseDate: '2026-11-25',
      products: [product],
      ingredients: [],
      recordedBy: 'Owner',
    });
    assert.equal(purchasePlan.ok, true);
    assert.ok(purchasePlan.updatedProduct);
    const stockedProduct = purchasePlan.updatedProduct;
    assert.equal(stockedProduct.stockQty, 58); // 10 + 48

    // Step B: Scan carton barcode at POS -> sells 24 bottles and deducts 24 units
    const checkoutPlan = buildCheckoutPlan({
      clientTxId: 'sale_carton_1',
      orderNumber: 'ORD-0001',
      items: [{ productId: stockedProduct.id, quantity: scanMatch.unitsPerPack }],
      products: [stockedProduct],
      ingredients: [],
      paymentMethod: 'aba',
      customerName: 'Wholesale Buyer',
      note: 'Scanned carton barcode',
      saleDate: '2026-11-25',
      recordedBy: 'Owner',
      allowNegativeStock: false,
    });
    assert.equal(checkoutPlan.ok, true);
    assert.ok(checkoutPlan.sale);
    assert.ok(checkoutPlan.updatedProducts);
    assert.equal(checkoutPlan.sale.totalKhr, 48000); // 24 × 2000
    assert.equal(checkoutPlan.updatedProducts[0].stockQty, 34); // 58 - 24

    // Step C: Void sale -> restores exact 24 bottles
    const voidPlan = buildVoidPlan({
      sale: checkoutPlan.sale,
      stockMovements: checkoutPlan.movements || [],
      products: checkoutPlan.updatedProducts,
      ingredients: [],
      recordedBy: 'Owner',
      reason: 'Test void',
    });
    assert.equal(voidPlan.ok, true);
    assert.ok(voidPlan.updatedProducts);
    assert.equal(voidPlan.updatedProducts[0].stockQty, 58); // 34 + 24
  });

  // 10. Internal QR Code SVG generation smoke test preserving leading zeros & internal SKUs
  await run('generates scannable QR code SVG payload for internal SKU and leading-zero codes', async () => {
    const svg = await QRCode.toString('0049000042566', { type: 'svg', margin: 1 });
    assert.ok(svg.includes('<svg'));
    const skuSvg = await QRCode.toString('JF-PKG-SUGAR-003', { type: 'svg', margin: 1 });
    assert.ok(skuSvg.includes('<svg'));
  });

  console.log(`\nAll ${passed} barcode system tests passed.`);
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
