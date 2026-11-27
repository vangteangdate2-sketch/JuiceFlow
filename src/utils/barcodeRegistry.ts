import type {
  BarcodeFormat,
  BarcodePackagingType,
  BarcodeRegistryRecord,
  BarcodeSource,
  ExternalBarcodePrefill,
  PackagingBarcode,
  Product,
  ProductCategory,
  ProductType,
  ProductVariant,
} from '../types';

/**
 * Strictly normalize a barcode identifier as a string.
 * Preserves ALL leading zeros (e.g. "0049000042566") and never coerces to Number.
 */
export function normalizeBarcodeString(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t]/g, '').trim().slice(0, 64);
}

/**
 * Return the normalized barcode along with its EAN-13 <-> UPC-A leading-zero equivalent
 * (since camera scanners frequently decode 12-digit UPC-A codes as 13-digit EAN-13 with a leading '0').
 */
export function getEquivalentBarcodeCodes(raw: string | null | undefined): string[] {
  const code = normalizeBarcodeString(raw);
  if (!code) return [];
  const candidates = [code];
  if (/^\d{12}$/.test(code)) {
    candidates.push(`0${code}`);
  } else if (/^0\d{12}$/.test(code)) {
    candidates.push(code.slice(1));
  }
  return candidates;
}

/**
 * Match a search query against one or more item barcodes, supporting both substring matching
 * and EAN-13 <-> UPC-A leading-zero equivalence.
 */
export function matchesBarcodeSearch(
  barcodes: Array<string | null | undefined>,
  rawQuery: string
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return false;
  const equivQueries = getEquivalentBarcodeCodes(rawQuery).map((c) => c.toLowerCase());
  for (const rawBc of barcodes) {
    if (!rawBc) continue;
    const bcLower = rawBc.trim().toLowerCase();
    if (!bcLower) continue;
    if (bcLower.includes(query)) return true;
    const equivBc = getEquivalentBarcodeCodes(rawBc).map((c) => c.toLowerCase());
    if (equivQueries.some((eq) => equivBc.includes(eq))) return true;
  }
  return false;
}

/**
 * Deterministic 64-bit FNV-1a hex hash fallback for ultra-long strings (>60 bytes UTF-8).
 */
function fnv1aHex64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

/**
 * Convert an exact barcode string into a deterministic Firestore document ID.
 * - Matches `^[a-zA-Z0-9_-]+$` and length <= 128
 * - Collision-free for any ASCII/UTF-8 barcode up to 60 bytes
 * - Strictly distinguishes leading zeros ("0049000042566" !== "49000042566")
 */
export function toBarcodeDocId(rawCode: string): string {
  const code = normalizeBarcodeString(rawCode);
  if (!code) return '';

  const bytes = new TextEncoder().encode(code);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  if (hex.length <= 120) {
    return `bc_${hex}`;
  }
  // Long QR/Code128 payload: prefix + deterministic hash (<= 128 chars)
  return `bc_${hex.slice(0, 96)}_${fnv1aHex64(code)}`;
}

function isValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 8) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  // Standard GS1 Mod-10 weighting from rightmost body digit (weight 3, then 1, alternating)
  for (let i = 0; i < body.length; i += 1) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

/**
 * Expand an 8-digit UPC-E (number system 0 or 1 + 6 digits + check digit) to 12-digit UPC-A
 * so we can verify its check digit accurately without country-prefix assumptions.
 */
function expandUpcEToUpcA(code8: string): string | null {
  if (!/^[01]\d{7}$/.test(code8)) return null;
  const ns = code8[0];
  const d1 = code8[1];
  const d2 = code8[2];
  const d3 = code8[3];
  const d4 = code8[4];
  const d5 = code8[5];
  const d6 = code8[6];
  const check = code8[7];

  let body = '';
  if (d6 === '0' || d6 === '1' || d6 === '2') {
    body = `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  } else if (d6 === '3') {
    body = `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
  } else if (d6 === '4') {
    body = `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
  } else {
    body = `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return `${body}${check}`;
}

/**
 * Detect standard barcode symbology without relying on country-specific prefixes.
 * Supports EAN-13, EAN-8, UPC-A, UPC-E, Code 128, QR Code, and internal JuiceFlow SKUs.
 */
export function detectBarcodeFormat(rawCode: string): BarcodeFormat {
  const code = normalizeBarcodeString(rawCode);
  if (!code) return 'CODE_128';

  if (/^JF-[A-Z0-9]+(?:-[A-Z0-9]+)+$/i.test(code)) {
    return 'INTERNAL';
  }
  if (/^\d{13}$/.test(code)) {
    return 'EAN_13';
  }
  if (/^\d{12}$/.test(code)) {
    return 'UPC_A';
  }
  if (/^\d{8}$/.test(code)) {
    // Distinguish 8-digit UPC-E (starts with 0 or 1) from EAN-8 using check digit
    if (code[0] === '0' || code[0] === '1') {
      const expanded = expandUpcEToUpcA(code);
      const validUpcE = expanded ? isValidGtinCheckDigit(expanded) : false;
      const validEan8 = isValidGtinCheckDigit(code);
      if (validUpcE && !validEan8) {
        return 'UPC_E';
      }
    }
    return 'EAN_8';
  }
  if (/^\d{6}$/.test(code)) {
    return 'UPC_E';
  }
  if (
    /^https?:\/\//i.test(code) ||
    code.startsWith('{') ||
    code.length > 32 ||
    /[^\x20-\x7E]/.test(code)
  ) {
    return 'QR_CODE';
  }
  return 'CODE_128';
}

export function formatBarcodeTypeLabel(format: BarcodeFormat): string {
  switch (format) {
    case 'EAN_13':
      return 'EAN-13';
    case 'EAN_8':
      return 'EAN-8';
    case 'UPC_A':
      return 'UPC-A';
    case 'UPC_E':
      return 'UPC-E';
    case 'CODE_128':
      return 'Code 128';
    case 'QR_CODE':
      return 'QR Code';
    case 'INTERNAL':
      return 'Internal SKU';
  }
}

function inferPackagingType(label: string, unitsPerPack: number): BarcodePackagingType {
  if (unitsPerPack >= 12 || /carton|case|box|thùng|crate/i.test(label)) {
    return 'carton';
  }
  return 'pack';
}

/**
 * Extract all active barcode registry records owned by a single Product.
 */
export function extractProductBarcodeRecords(
  product: Product,
  preferredSource?: BarcodeSource
): BarcodeRegistryRecord[] {
  const records: BarcodeRegistryRecord[] = [];
  const seenIds = new Set<string>();
  const nowIso = product.updatedAt || new Date().toISOString();

  const pushRecord = (
    rawCode: string | undefined,
    packagingType: BarcodePackagingType,
    unitsPerScan: number,
    label: string,
    variantId?: string
  ) => {
    const code = normalizeBarcodeString(rawCode);
    if (!code) return;
    const id = toBarcodeDocId(code);
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);

    const format = detectBarcodeFormat(code);
    const source: BarcodeSource =
      preferredSource ?? (format === 'INTERNAL' ? 'internal' : 'manufacturer');

    records.push({
      id,
      code,
      format,
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      packagingType,
      label: (label || 'Unit').trim().slice(0, 80),
      unitsPerScan: Math.max(1, Math.round(unitsPerScan)),
      active: Boolean(product.active),
      source,
      createdAt: product.createdAt || nowIso,
      updatedAt: nowIso,
    });
  };

  // 1. Primary unit barcode / internal SKU
  pushRecord(product.barcode, 'unit', 1, product.unit || 'Unit');

  // 2. Size variant barcodes
  for (const variant of product.variants || []) {
    pushRecord(variant.barcode, 'variant', 1, variant.name || 'Variant', variant.id);
  }

  // 3. Multi-unit carton / pack barcodes
  for (const pb of product.packagingBarcodes || []) {
    const units = Math.max(1, Math.round(Number(pb.unitsPerPack) || 1));
    pushRecord(
      pb.barcode,
      inferPackagingType(pb.label || '', units),
      units,
      pb.label || `Pack (${units})`
    );
  }

  return records;
}

/**
 * Synthesize a complete local barcode registry from a list of products.
 */
export function buildRegistryFromProducts(products: Product[]): BarcodeRegistryRecord[] {
  const map = new Map<string, BarcodeRegistryRecord>();
  for (const prod of products) {
    const entries = extractProductBarcodeRecords(prod);
    for (const rec of entries) {
      if (!map.has(rec.id)) {
        map.set(rec.id, rec);
      }
    }
  }
  return Array.from(map.values());
}

export interface BarcodeConflict {
  code: string;
  existingProductId: string;
  existingProductName: string;
  existingVariantName?: string;
  existingLabel?: string;
  isInternalDuplicate: boolean;
}

export interface BarcodeConflictCandidate {
  id?: string;
  name?: string;
  barcode?: string;
  variants?: Array<{ id?: string; name?: string; barcode?: string }>;
  packagingBarcodes?: PackagingBarcode[];
}

/**
 * Validate that NO barcode on the candidate product duplicates:
 * 1) Another barcode on the same product (e.g. unit barcode == carton barcode or 2 variants share a code)
 * 2) Any active barcode assigned to a different product in the Firestore registry or product catalog.
 */
export function findDuplicateBarcodeConflicts(
  candidate: BarcodeConflictCandidate,
  existingProducts: Product[],
  registry: BarcodeRegistryRecord[] = []
): BarcodeConflict[] {
  const conflicts: BarcodeConflict[] = [];
  const candidateEntries: Array<{ code: string; label: string }> = [];

  const unitCode = normalizeBarcodeString(candidate.barcode);
  if (unitCode) {
    candidateEntries.push({ code: unitCode, label: 'Unit SKU' });
  }
  for (const v of candidate.variants || []) {
    const vc = normalizeBarcodeString(v.barcode);
    if (vc) {
      candidateEntries.push({ code: vc, label: v.name || 'Variant' });
    }
  }
  for (const pb of candidate.packagingBarcodes || []) {
    const pc = normalizeBarcodeString(pb.barcode);
    if (pc) {
      candidateEntries.push({ code: pc, label: pb.label || `Pack (${pb.unitsPerPack})` });
    }
  }

  // 1. Check duplicates within the same product submission
  const seenLocal = new Map<string, string>();
  for (const entry of candidateEntries) {
    if (seenLocal.has(entry.code)) {
      conflicts.push({
        code: entry.code,
        existingProductId: candidate.id || '',
        existingProductName: candidate.name || 'This product',
        existingLabel: seenLocal.get(entry.code),
        isInternalDuplicate: true,
      });
    } else {
      seenLocal.set(entry.code, entry.label);
    }
  }

  const prodMap = new Map(existingProducts.map((p) => [p.id, p]));
  const alreadyReportedExternal = new Set<string>();

  // 2. Check active registry records belonging to other products
  for (const entry of candidateEntries) {
    const docId = toBarcodeDocId(entry.code);
    const regMatch = registry.find(
      (r) =>
        r.active &&
        (r.code === entry.code || r.id === docId) &&
        r.productId !== candidate.id
    );
    if (regMatch) {
      const owner = prodMap.get(regMatch.productId);
      const variant = owner?.variants?.find((v) => v.id === regMatch.variantId);
      conflicts.push({
        code: entry.code,
        existingProductId: regMatch.productId,
        existingProductName: owner?.name || regMatch.productId,
        existingVariantName: variant?.name,
        existingLabel: regMatch.label,
        isInternalDuplicate: false,
      });
      alreadyReportedExternal.add(entry.code);
      continue;
    }

    // 3. Check product catalog directly (covers offline / un-synced products)
    for (const prod of existingProducts) {
      if (candidate.id && prod.id === candidate.id) continue;
      if (!prod.active) continue;

      if (normalizeBarcodeString(prod.barcode) === entry.code) {
        if (!alreadyReportedExternal.has(entry.code)) {
          conflicts.push({
            code: entry.code,
            existingProductId: prod.id,
            existingProductName: prod.name,
            existingLabel: 'Unit SKU',
            isInternalDuplicate: false,
          });
          alreadyReportedExternal.add(entry.code);
        }
        break;
      }

      const matchedVariant = (prod.variants || []).find(
        (v) => normalizeBarcodeString(v.barcode) === entry.code
      );
      if (matchedVariant) {
        if (!alreadyReportedExternal.has(entry.code)) {
          conflicts.push({
            code: entry.code,
            existingProductId: prod.id,
            existingProductName: prod.name,
            existingVariantName: matchedVariant.name,
            existingLabel: matchedVariant.name,
            isInternalDuplicate: false,
          });
          alreadyReportedExternal.add(entry.code);
        }
        break;
      }

      const matchedPack = (prod.packagingBarcodes || []).find(
        (pb) => normalizeBarcodeString(pb.barcode) === entry.code
      );
      if (matchedPack) {
        if (!alreadyReportedExternal.has(entry.code)) {
          conflicts.push({
            code: entry.code,
            existingProductId: prod.id,
            existingProductName: prod.name,
            existingLabel: matchedPack.label,
            isInternalDuplicate: false,
          });
          alreadyReportedExternal.add(entry.code);
        }
        break;
      }
    }
  }

  return conflicts;
}

export interface RegistryLookupHit {
  code: string;
  format: BarcodeFormat;
  product: Product;
  variant?: ProductVariant;
  registryRecord?: BarcodeRegistryRecord;
  unitsPerScan: number;
  packagingType: BarcodePackagingType;
  packLabel?: string;
}

/**
 * Resolve a scanned barcode against the Barcode Registry first, then fall back to products array.
 */
export function resolveFromRegistryAndProducts(
  rawCode: string,
  registry: BarcodeRegistryRecord[],
  products: Product[]
): RegistryLookupHit | null {
  const candidates = getEquivalentBarcodeCodes(rawCode);
  if (candidates.length === 0) return null;

  const prodMap = new Map(products.map((p) => [p.id, p]));

  for (const code of candidates) {
    const docId = toBarcodeDocId(code);

    // 1. Check Barcode Registry first (exact string match preserving leading zeros)
    const regRecord = registry.find((r) => r.code === code || r.id === docId);
    if (regRecord) {
      const product = prodMap.get(regRecord.productId);
      if (product) {
        const variant = regRecord.variantId
          ? product.variants?.find((v) => v.id === regRecord.variantId)
          : undefined;
        return {
          code,
          format: regRecord.format || detectBarcodeFormat(code),
          product,
          variant,
          registryRecord: regRecord,
          unitsPerScan: Math.max(1, Math.round(regRecord.unitsPerScan || 1)),
          packagingType: regRecord.packagingType,
          packLabel: regRecord.label,
        };
      }
    }

    // 2. Fallback to embedded product fields (ensures 100% continuity for legacy products)
    for (const product of products) {
      if (normalizeBarcodeString(product.barcode) === code) {
        return {
          code,
          format: detectBarcodeFormat(code),
          product,
          unitsPerScan: 1,
          packagingType: 'unit',
          packLabel: product.unit || 'Unit',
        };
      }
      const matchedVariant = (product.variants || []).find(
        (v) => normalizeBarcodeString(v.barcode) === code
      );
      if (matchedVariant) {
        return {
          code,
          format: detectBarcodeFormat(code),
          product,
          variant: matchedVariant,
          unitsPerScan: 1,
          packagingType: 'variant',
          packLabel: matchedVariant.name,
        };
      }
      const matchedPack = (product.packagingBarcodes || []).find(
        (pb) => normalizeBarcodeString(pb.barcode) === code
      );
      if (matchedPack) {
        const units = Math.max(1, Math.round(matchedPack.unitsPerPack || 1));
        return {
          code,
          format: detectBarcodeFormat(code),
          product,
          unitsPerScan: units,
          packagingType: inferPackagingType(matchedPack.label || '', units),
          packLabel: matchedPack.label,
        };
      }
    }
  }

  return null;
}

/**
 * Generate a unique internal Code 128-compatible SKU for products without manufacturer barcodes.
 */
export function generateUniqueInternalSku(options: {
  productType: ProductType;
  category: ProductCategory;
  name?: string;
  existingProducts: Product[];
  registry?: BarcodeRegistryRecord[];
  extraUsedCodes?: string[];
}): string {
  const usedCodes = new Set<string>();
  for (const p of options.existingProducts) {
    if (p.barcode?.trim()) usedCodes.add(normalizeBarcodeString(p.barcode).toUpperCase());
    for (const pb of p.packagingBarcodes || []) {
      if (pb.barcode?.trim()) usedCodes.add(normalizeBarcodeString(pb.barcode).toUpperCase());
    }
    for (const v of p.variants || []) {
      if (v.barcode?.trim()) usedCodes.add(normalizeBarcodeString(v.barcode).toUpperCase());
    }
  }
  for (const r of options.registry || []) {
    if (r.code?.trim()) usedCodes.add(normalizeBarcodeString(r.code).toUpperCase());
  }
  for (const extra of options.extraUsedCodes || []) {
    if (extra?.trim()) usedCodes.add(normalizeBarcodeString(extra).toUpperCase());
  }

  const typePrefix =
    options.productType === 'PACKAGED'
      ? 'PKG'
      : options.productType === 'PREPARED_STOCK'
        ? 'PRP'
        : 'MTO';

  const cleanNameSlug = (options.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 3);

  const catSlug = options.category.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
  const segment = cleanNameSlug.length >= 2 ? cleanNameSlug : catSlug || 'PRD';

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const numPart = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `JF-${typePrefix}-${segment}-${numPart}`;
    if (!usedCodes.has(candidate)) {
      return candidate;
    }
  }

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `JF-${typePrefix}-${segment}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Open Food Facts API v3 Integration (Optional External Prefill Only)
// ---------------------------------------------------------------------------

function mapOpenFoodFactsCategory(tags: unknown): ProductCategory {
  if (!Array.isArray(tags)) return 'packaged';
  const joined = tags
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .toLowerCase();

  if (joined.includes('smoothie')) return 'smoothie';
  if (joined.includes('juice') || joined.includes('nectar')) return 'juice';
  if (joined.includes('coffee') || joined.includes('espresso')) return 'coffee';
  if (joined.includes('tea') || joined.includes('matcha')) return 'tea';
  if (
    joined.includes('snack') ||
    joined.includes('biscuit') ||
    joined.includes('chip') ||
    joined.includes('candy') ||
    joined.includes('chocolate') ||
    joined.includes('cookie') ||
    joined.includes('cake')
  ) {
    return 'snack';
  }
  return 'packaged';
}

/**
 * Pure parser for Open Food Facts API v3 responses.
 * SECURITY & BUSINESS RULE:
 * - Strictly extracts descriptive product metadata (name, brand, category, pack text, thumbnail).
 * - NEVER returns selling price (KHR), cost price, or stock quantity.
 */
export function parseOpenFoodFactsV3Response(
  rawBarcode: string,
  payload: unknown
): ExternalBarcodePrefill | null {
  const code = normalizeBarcodeString(rawBarcode);
  if (!code || !payload || typeof payload !== 'object') return null;

  const data = payload as Record<string, unknown>;
  const status = data.status;
  const isSuccess =
    status === 'success' || status === 'success_with_warnings' || status === 1;
  if (!isSuccess) return null;

  const product = data.product as Record<string, unknown> | undefined;
  if (!product || typeof product !== 'object') return null;

  const str = (v: unknown, maxLen: number) =>
    typeof v === 'string' ? v.trim().slice(0, maxLen) : '';

  const rawNameEn = str(product.product_name_en, 100);
  const rawNameGeneric = str(product.product_name, 100) || str(product.generic_name, 100);
  const rawNameVi = str(product.product_name_vi, 100);
  const rawBrand = str(product.brands, 80).split(',')[0]?.trim() || '';
  const quantityText = str(product.quantity, 40);

  let displayName = rawNameEn || rawNameGeneric;
  if (!displayName && rawBrand) {
    displayName = quantityText ? `${rawBrand} ${quantityText}`.trim() : rawBrand;
  }
  if (!displayName) return null;

  if (quantityText && !displayName.toLowerCase().includes(quantityText.toLowerCase())) {
    const withQty = `${displayName} ${quantityText}`.trim();
    if (withQty.length <= 100) {
      displayName = withQty;
    }
  }

  const rawImg =
    str(product.image_front_small_url, 500) || str(product.image_small_url, 500);
  const safeImg = /^https:\/\//i.test(rawImg) ? rawImg : undefined;

  return {
    barcode: code,
    source: 'open_food_facts',
    name: displayName,
    ...(rawNameVi ? { nameVi: rawNameVi } : {}),
    ...(rawBrand ? { brand: rawBrand } : {}),
    suggestedCategory: mapOpenFoodFactsCategory(product.categories_tags),
    ...(quantityText ? { packQuantityText: quantityText } : {}),
    ...(safeImg ? { imageUrl: safeImg } : {}),
  };
}

/**
 * Query Open Food Facts API v3 for an unknown barcode.
 * Always called ONLY AFTER checking JuiceFlow's Firestore barcode registry.
 * Never throws: returns `null` when not found, offline, or timed out so the app
 * cleanly opens the manual product registration form.
 */
export async function lookupOpenFoodFactsV3(
  rawBarcode: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<ExternalBarcodePrefill | null> {
  const code = normalizeBarcodeString(rawBarcode);
  if (!code) return null;

  // Skip external lookup for JuiceFlow internal SKUs or URLs
  const format = detectBarcodeFormat(code);
  if (format === 'INTERNAL' || format === 'QR_CODE') {
    return null;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fields =
      'product_name,product_name_en,product_name_vi,generic_name,brands,quantity,categories_tags,image_front_small_url,image_small_url';
    const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(
      code
    )}.json?fields=${fields}`;

    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as unknown;
    return parseOpenFoodFactsV3Response(code, json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
