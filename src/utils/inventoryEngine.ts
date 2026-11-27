import type {
  CategoryItem,
  Expense,
  Ingredient,
  IngredientUnit,
  MovementType,
  PaymentMethod,
  Product,
  ProductType,
  ProductVariant,
  PurchaseRecord,
  RecipeItem,
  Sale,
  SaleDeductionSnapshot,
  SaleItem,
  SaleReturnItem,
  SaleReturnRecord,
  StockClassification,
  StockMovement,
  WorkspaceSettings,
} from '../types';
import {
  BUSINESS_TIMEZONE,
  calculateProductCogs,
  calculateRecipeCogs,
  convertUnitQty,
  generateId,
  normalizeName,
  sanitizeString,
  todayIso,
} from './format';
import {
  ensureCategoriesList,
  getCategoryById,
  resolveSaleItemCategoryId,
  UNCATEGORIZED_ID,
} from './categories';

export function roundQty(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 10000) / 10000;
}

export function roundKhr(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val);
}

// ---------------------------------------------------------------------------
// Backward-compatible Normalizers (for legacy Firestore & localStorage docs)
// ---------------------------------------------------------------------------

const VALID_UNITS = new Set<IngredientUnit>(['pcs', 'ml', 'L', 'g', 'kg']);
const VALID_PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'khqr', 'aba', 'wing']);

export function normalizeIngredient(raw: Partial<Ingredient> & { id: string }): Ingredient {
  const unit: IngredientUnit =
    raw.unit && VALID_UNITS.has(raw.unit) ? raw.unit : 'pcs';
  const name = String(raw.name || 'Unnamed Ingredient').trim() || 'Unnamed Ingredient';
  const nameVi = String(raw.nameVi || name).trim() || name;
  const categoryId =
    typeof raw.categoryId === 'string' && raw.categoryId.trim().length > 0
      ? raw.categoryId.trim()
      : undefined;
  return {
    id: String(raw.id),
    name,
    nameVi,
    ...(categoryId ? { categoryId } : {}),
    unit,
    stockQty: Number.isFinite(Number(raw.stockQty)) ? Number(raw.stockQty) : 0,
    reorderLevel: Number.isFinite(Number(raw.reorderLevel))
      ? Math.max(0, Number(raw.reorderLevel))
      : 0,
    unitCostKhr: Number.isFinite(Number(raw.unitCostKhr))
      ? Math.max(0, Number(raw.unitCostKhr))
      : 0,
    supplier: String(raw.supplier || ''),
    ...(raw.createdAt ? { createdAt: String(raw.createdAt) } : {}),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
  };
}

export function normalizeProduct(raw: Partial<Product> & { id: string }): Product {
  const productType: ProductType =
    raw.productType === 'PACKAGED' ||
    raw.productType === 'PREPARED_STOCK' ||
    raw.productType === 'PREPARED_TO_ORDER'
      ? raw.productType
      : 'PREPARED_TO_ORDER';

  const baseRecipe: RecipeItem[] = Array.isArray(raw.recipe)
    ? raw.recipe
        .filter((r) => Boolean(r && typeof r === 'object' && r.ingredientId && Number(r.quantity) > 0))
        .map((r) => ({
          ingredientId: String(r.ingredientId),
          quantity: Number(r.quantity),
          ...(r.unit && VALID_UNITS.has(r.unit) ? { unit: r.unit } : {}),
        }))
    : [];

  const variants: ProductVariant[] =
    Array.isArray(raw.variants) && raw.variants.length > 0
      ? raw.variants
          .filter((v): v is ProductVariant => Boolean(v && typeof v === 'object'))
          .map((v, idx) => ({
            id: String(v.id || `var_${raw.id}_${idx}`),
            name: String(v.name || 'Standard'),
            nameVi: String(v.nameVi || v.name || 'Tiêu chuẩn'),
            priceKhr: Math.max(0, Number(v.priceKhr ?? raw.priceKhr ?? 0) || 0),
            ...(v.costPriceKhr !== undefined && Number.isFinite(Number(v.costPriceKhr))
              ? { costPriceKhr: Math.max(0, Number(v.costPriceKhr)) }
              : {}),
            ...(v.barcode ? { barcode: String(v.barcode).trim() } : {}),
            recipe: Array.isArray(v.recipe)
              ? v.recipe
                  .filter((r) => Boolean(r && typeof r === 'object' && r.ingredientId && Number(r.quantity) > 0))
                  .map((r) => ({
                    ingredientId: String(r.ingredientId),
                    quantity: Number(r.quantity),
                    ...(r.unit && VALID_UNITS.has(r.unit) ? { unit: r.unit } : {}),
                  }))
              : [],
            recipeVersion: Math.max(1, Number(v.recipeVersion ?? raw.recipeVersion ?? 1) || 1),
          }))
      : [];

  const rawCategoryId =
    typeof raw.categoryId === 'string' && raw.categoryId.trim().length > 0
      ? raw.categoryId.trim()
      : undefined;
  const rawCategoryStr =
    typeof raw.category === 'string' && raw.category.trim().length > 0
      ? raw.category.trim()
      : '';
  const safeCategory =
    rawCategoryStr ||
    rawCategoryId ||
    (productType === 'PACKAGED' ? 'packaged' : 'juice');
  const safeCategoryId = rawCategoryId || safeCategory;

  const safeUnit: IngredientUnit =
    raw.unit && VALID_UNITS.has(raw.unit) ? raw.unit : 'pcs';

  return {
    id: String(raw.id),
    name: String(raw.name || 'Untitled Item'),
    nameVi: String(raw.nameVi || raw.name || 'Sản phẩm'),
    brand: String(raw.brand ?? ''),
    category: safeCategory,
    categoryId: safeCategoryId,
    productType,
    priceKhr: Math.max(0, Number(raw.priceKhr ?? 0) || 0),
    costPriceKhr: Math.max(0, Number(raw.costPriceKhr ?? 0) || 0),
    markupPercent:
      raw.markupPercent !== undefined && Number.isFinite(Number(raw.markupPercent))
        ? Number(raw.markupPercent)
        : undefined,
    manualPriceOverride: Boolean(raw.manualPriceOverride),
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
    active: raw.active !== false,
    barcode: raw.barcode ? String(raw.barcode).trim() : '',
    packagingBarcodes: Array.isArray(raw.packagingBarcodes)
      ? raw.packagingBarcodes
          .filter((pb) => Boolean(pb && typeof pb === 'object' && pb.barcode && Number(pb.unitsPerPack) > 0))
          .map((pb) => ({
            barcode: String(pb.barcode).trim(),
            label: String(pb.label || `Pack (${pb.unitsPerPack})`),
            unitsPerPack: Math.max(1, Math.round(Number(pb.unitsPerPack))),
          }))
      : [],
    stockQty: Number.isFinite(Number(raw.stockQty)) ? Number(raw.stockQty) : 0,
    reorderLevel: Number.isFinite(Number(raw.reorderLevel)) ? Math.max(0, Number(raw.reorderLevel)) : 10,
    unit: safeUnit,
    supplier: String(raw.supplier || ''),
    recipe: baseRecipe,
    recipeVersion: Math.max(1, Number(raw.recipeVersion ?? 1) || 1),
    variants,
    ...(raw.createdAt ? { createdAt: String(raw.createdAt) } : {}),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
  };
}

export function normalizeSale(raw: Partial<Sale> & { id: string }): Sale {
  const totalKhr = Math.max(0, Number(raw.totalKhr ?? 0) || 0);
  const status =
    raw.status === 'voided' ||
    raw.status === 'partially_returned' ||
    raw.status === 'refunded' ||
    raw.status === 'completed'
      ? raw.status
      : 'completed';
  const refundedKhr =
    status === 'voided'
      ? totalKhr
      : Math.max(0, Number(raw.refundedKhr ?? 0) || 0);
  const netTotalKhr =
    status === 'voided'
      ? 0
      : Math.max(
          0,
          raw.netTotalKhr !== undefined && Number.isFinite(Number(raw.netTotalKhr))
            ? Number(raw.netTotalKhr)
            : totalKhr - refundedKhr
        );
  const cogsKhr = Math.max(0, Number(raw.cogsKhr ?? 0) || 0);
  const refundedCogsKhr =
    status === 'voided'
      ? cogsKhr
      : Math.max(0, Number(raw.refundedCogsKhr ?? 0) || 0);

  const items: SaleItem[] = Array.isArray(raw.items)
    ? raw.items
        .filter((item): item is SaleItem => Boolean(item && typeof item === 'object'))
        .map((item, idx) => ({
          ...item,
          lineId: String(item.lineId || `${raw.id}_line_${idx}`),
          productId: String(item.productId || ''),
          ...(item.categoryId ? { categoryId: String(item.categoryId).trim() } : {}),
          productName: String(item.productName || 'Item'),
          productNameVi: String(item.productNameVi || item.productName || 'Sản phẩm'),
          ...(item.variantName ? { variantName: String(item.variantName) } : {}),
          quantity: Math.max(0, Number(item.quantity ?? 0) || 0),
          unitPriceKhr: Math.max(0, Number(item.unitPriceKhr ?? 0) || 0),
          unitCogsKhr: Math.max(0, Number(item.unitCogsKhr ?? 0) || 0),
          lineTotalKhr: Math.max(0, Number(item.lineTotalKhr ?? 0) || 0),
          returnedQty: Math.max(0, Number(item.returnedQty ?? 0) || 0),
          deductions: Array.isArray(item.deductions) ? item.deductions : [],
        }))
    : [];

  const paymentMethod: PaymentMethod =
    raw.paymentMethod && VALID_PAYMENT_METHODS.has(raw.paymentMethod)
      ? raw.paymentMethod
      : 'cash';

  return {
    id: String(raw.id),
    clientTxId: String(raw.clientTxId || raw.id),
    orderNumber: String(raw.orderNumber || 'JF-0000'),
    saleDate: String(raw.saleDate || todayIso()),
    items,
    subtotalKhr:
      raw.subtotalKhr !== undefined && Number.isFinite(Number(raw.subtotalKhr))
        ? Number(raw.subtotalKhr)
        : totalKhr,
    totalKhr,
    refundedKhr,
    netTotalKhr,
    cogsKhr,
    refundedCogsKhr,
    paymentMethod,
    cash_received_usd:
      raw.cash_received_usd !== undefined &&
      raw.cash_received_usd !== null &&
      Number.isFinite(Number(raw.cash_received_usd))
        ? Math.max(0, Number(raw.cash_received_usd))
        : null,
    cash_received_khr:
      raw.cash_received_khr !== undefined &&
      raw.cash_received_khr !== null &&
      Number.isFinite(Number(raw.cash_received_khr))
        ? Math.max(0, Math.round(Number(raw.cash_received_khr)))
        : null,
    exchange_rate_used:
      raw.exchange_rate_used !== undefined &&
      raw.exchange_rate_used !== null &&
      Number.isFinite(Number(raw.exchange_rate_used)) &&
      Number(raw.exchange_rate_used) > 0
        ? Math.max(1, Math.round(Number(raw.exchange_rate_used)))
        : null,
    change_given_khr:
      raw.change_given_khr !== undefined &&
      raw.change_given_khr !== null &&
      Number.isFinite(Number(raw.change_given_khr))
        ? Math.max(0, Math.round(Number(raw.change_given_khr)))
        : null,
    customerName: String(raw.customerName || 'Walk-in'),
    note: String(raw.note || ''),
    recordedBy: String(raw.recordedBy || 'Family'),
    status,
    returns: Array.isArray(raw.returns)
      ? raw.returns.filter((ret) => Boolean(ret && typeof ret === 'object'))
      : [],
    ...(raw.voidedAt ? { voidedAt: String(raw.voidedAt) } : {}),
    ...(raw.voidedBy ? { voidedBy: String(raw.voidedBy) } : {}),
    ...(raw.voidReason ? { voidReason: String(raw.voidReason) } : {}),
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

export function normalizeStockMovement(raw: Partial<StockMovement> & { id: string }): StockMovement {
  const itemId = String(raw.itemId || raw.ingredientId || '');
  const itemName = String(raw.itemName || raw.ingredientName || 'Unknown Item');
  const itemClassification: StockClassification =
    raw.itemClassification === 'packaged' ||
    raw.itemClassification === 'prepared_stock' ||
    raw.itemClassification === 'ingredient'
      ? raw.itemClassification
      : 'ingredient';

  return {
    id: String(raw.id),
    itemId,
    itemName,
    itemClassification,
    ingredientId: String(raw.ingredientId || itemId),
    ingredientName: String(raw.ingredientName || itemName),
    movementType: raw.movementType || 'adjustment',
    deltaQty: Number.isFinite(Number(raw.deltaQty)) ? Number(raw.deltaQty) : 0,
    unit: raw.unit && VALID_UNITS.has(raw.unit) ? raw.unit : 'pcs',
    unitCostKhr:
      raw.unitCostKhr !== undefined && Number.isFinite(Number(raw.unitCostKhr))
        ? Number(raw.unitCostKhr)
        : undefined,
    totalCostKhr: Math.max(0, Number(raw.totalCostKhr ?? 0) || 0),
    referenceId: String(raw.referenceId || ''),
    movementDate: String(raw.movementDate || todayIso()),
    note: String(raw.note || ''),
    recordedBy: String(raw.recordedBy || 'Family'),
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

export function normalizeSettings(
  raw: Partial<WorkspaceSettings> | null | undefined,
  fallback: WorkspaceSettings
): WorkspaceSettings {
  const safeRaw = raw && typeof raw === 'object' ? raw : {};
  const rawPosRate = Number(safeRaw.posExchangeRate);
  const fallbackPosRate = Number(fallback.posExchangeRate);
  const rawUsdRate = Number(safeRaw.usdRate);
  const rawLowStock = Number(safeRaw.lowStockDefault);

  const familyMembers =
    Array.isArray(safeRaw.familyMembers) &&
    safeRaw.familyMembers.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).length > 0
      ? safeRaw.familyMembers
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .map((m) => m.trim())
      : fallback.familyMembers;

  const activeOperator =
    typeof safeRaw.activeOperator === 'string' && safeRaw.activeOperator.trim().length > 0
      ? safeRaw.activeOperator.trim()
      : familyMembers[0] || fallback.activeOperator;

  return {
    workspaceId:
      typeof safeRaw.workspaceId === 'string' && safeRaw.workspaceId.trim().length > 0
        ? safeRaw.workspaceId
        : fallback.workspaceId,
    inviteCode:
      typeof safeRaw.inviteCode === 'string' && safeRaw.inviteCode.trim().length > 0
        ? safeRaw.inviteCode
        : fallback.inviteCode,
    name:
      typeof safeRaw.name === 'string' && safeRaw.name.trim().length > 0
        ? safeRaw.name
        : fallback.name,
    location: typeof safeRaw.location === 'string' ? safeRaw.location : fallback.location,
    currency: 'KHR',
    usdRate: Number.isFinite(rawUsdRate) && rawUsdRate > 0 ? rawUsdRate : fallback.usdRate,
    posExchangeRate:
      Number.isFinite(rawPosRate) && rawPosRate > 0
        ? Math.round(rawPosRate)
        : Number.isFinite(fallbackPosRate) && fallbackPosRate > 0
          ? Math.round(fallbackPosRate)
          : 4000,
    language: safeRaw.language === 'vi' ? 'vi' : safeRaw.language === 'en' ? 'en' : fallback.language,
    familyMembers,
    activeOperator,
    lowStockDefault:
      Number.isFinite(rawLowStock) && rawLowStock >= 0 ? rawLowStock : fallback.lowStockDefault,
    allowNegativeStock: Boolean(safeRaw.allowNegativeStock ?? fallback.allowNegativeStock ?? false),
    enableOpenFoodFactsLookup:
      safeRaw.enableOpenFoodFactsLookup !== undefined
        ? Boolean(safeRaw.enableOpenFoodFactsLookup)
        : fallback.enableOpenFoodFactsLookup !== false,
    timezone:
      typeof safeRaw.timezone === 'string' && safeRaw.timezone.trim().length > 0
        ? safeRaw.timezone
        : fallback.timezone || BUSINESS_TIMEZONE,
  };
}

// ---------------------------------------------------------------------------
// Barcode Resolution (Unit, Variant & Carton/Pack Barcodes)
// ---------------------------------------------------------------------------

export interface BarcodeMatch {
  product: Product;
  variant?: ProductVariant;
  unitsPerPack: number;
  packLabel?: string;
  isPackagingBarcode: boolean;
  matchedBarcode: string;
}

export function resolveBarcodeMatch(rawBarcode: string, products: Product[]): BarcodeMatch | null {
  const code = String(rawBarcode || '').trim();
  if (!code || !Array.isArray(products)) return null;

  for (const product of products) {
    if (!product) continue;
    // 1. Direct product unit barcode
    if (product.barcode && String(product.barcode).trim() === code) {
      return {
        product,
        unitsPerPack: 1,
        isPackagingBarcode: false,
        matchedBarcode: code,
      };
    }

    // 2. Variant barcode
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      const matchedVariant = product.variants.find(
        (v) => v && v.barcode && String(v.barcode).trim() === code
      );
      if (matchedVariant) {
        return {
          product,
          variant: matchedVariant,
          unitsPerPack: 1,
          isPackagingBarcode: false,
          matchedBarcode: code,
        };
      }
    }

    // 3. Packaging / Carton barcode (e.g. 24-bottle carton)
    if (Array.isArray(product.packagingBarcodes) && product.packagingBarcodes.length > 0) {
      const matchedPack = product.packagingBarcodes.find(
        (pb) => pb && pb.barcode && String(pb.barcode).trim() === code
      );
      if (matchedPack) {
        return {
          product,
          unitsPerPack: Math.max(1, Math.round(Number(matchedPack.unitsPerPack) || 1)),
          packLabel: matchedPack.label,
          isPackagingBarcode: true,
          matchedBarcode: code,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Live Stock Availability Calculation (for POS tiles & cart validation)
// ---------------------------------------------------------------------------

export interface StockAvailability {
  availableUnits: number | null; // null if PREPARED_TO_ORDER with empty recipe
  status: 'ok' | 'low' | 'out';
  limitingItemName?: string;
}

export function getProductVariant(product: Product, variantId?: string): ProductVariant | undefined {
  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) return undefined;
  if (variantId) {
    const found = product.variants.find((v) => v && v.id === variantId);
    if (found) return found;
  }
  return product.variants[0];
}

export function getActiveRecipe(product: Product, variant?: ProductVariant): RecipeItem[] {
  if (variant && Array.isArray(variant.recipe) && variant.recipe.length > 0) {
    return variant.recipe;
  }
  return Array.isArray(product?.recipe) ? product.recipe : [];
}

export function getAvailableUnitsForProduct(
  product: Product,
  ingredients: Ingredient[],
  variantId?: string
): StockAvailability {
  if (!product) {
    return { availableUnits: 0, status: 'out' };
  }
  if (product.productType === 'PACKAGED' || product.productType === 'PREPARED_STOCK') {
    const stockQty = Number.isFinite(Number(product.stockQty)) ? Number(product.stockQty) : 0;
    const reorderLevel = Number.isFinite(Number(product.reorderLevel)) ? Number(product.reorderLevel) : 0;
    const qty = Math.floor(Math.max(0, stockQty));
    if (stockQty <= 0) {
      return { availableUnits: 0, status: 'out', limitingItemName: product.name };
    }
    if (stockQty <= reorderLevel) {
      return { availableUnits: qty, status: 'low', limitingItemName: product.name };
    }
    return { availableUnits: qty, status: 'ok' };
  }

  // PREPARED_TO_ORDER: check limiting recipe ingredient
  const variant = getProductVariant(product, variantId);
  const recipe = getActiveRecipe(product, variant);
  if (recipe.length === 0) {
    return { availableUnits: null, status: 'ok' };
  }

  const safeIngredients = Array.isArray(ingredients) ? ingredients : [];
  const ingMap = new Map(safeIngredients.filter((i) => i && i.id).map((i) => [i.id, i]));
  let minMakeable = Infinity;
  let limitingName: string | undefined;
  let anyLow = false;

  for (const r of recipe) {
    const ing = ingMap.get(r.ingredientId);
    if (!ing) continue;
    const neededPerUnit = convertUnitQty(r.quantity, r.unit ?? ing.unit, ing.unit);
    if (neededPerUnit <= 0) continue;
    const canMake = Math.floor(Math.max(0, ing.stockQty) / neededPerUnit);
    if (canMake < minMakeable) {
      minMakeable = canMake;
      limitingName = ing.name;
    }
    if (ing.stockQty <= ing.reorderLevel) {
      anyLow = true;
    }
  }

  if (!Number.isFinite(minMakeable)) {
    return { availableUnits: null, status: 'ok' };
  }

  if (minMakeable <= 0) {
    return { availableUnits: 0, status: 'out', limitingItemName: limitingName };
  }

  if (minMakeable <= 3 || anyLow) {
    return { availableUnits: minMakeable, status: 'low', limitingItemName: limitingName };
  }

  return { availableUnits: minMakeable, status: 'ok' };
}

// ---------------------------------------------------------------------------
// Pre-Checkout Stock Validation & Atomic Checkout Plan
// ---------------------------------------------------------------------------

export interface CartRequestItem {
  productId: string;
  variantId?: string;
  quantity: number;
}

export interface StockShortage {
  itemId: string;
  itemName: string;
  itemNameVi?: string;
  itemClassification: StockClassification;
  requiredQty: number;
  availableQty: number;
  unit: IngredientUnit;
}

export interface StockValidationResult {
  ok: boolean;
  shortages: StockShortage[];
  requiredProducts: Map<string, number>;
  requiredIngredients: Map<string, number>;
}

export function validateCheckoutStock(
  cartItems: CartRequestItem[],
  products: Product[],
  ingredients: Ingredient[],
  allowNegativeStock = false
): StockValidationResult {
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const ingMap = new Map(ingredients.map((i) => [i.id, i]));

  const requiredProducts = new Map<string, number>();
  const requiredIngredients = new Map<string, number>();

  for (const line of cartItems) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (qty <= 0) continue;
    const prod = prodMap.get(line.productId);
    if (!prod) continue;

    if (prod.productType === 'PACKAGED' || prod.productType === 'PREPARED_STOCK') {
      requiredProducts.set(prod.id, roundQty((requiredProducts.get(prod.id) ?? 0) + qty));
    } else {
      // PREPARED_TO_ORDER -> deduct ingredients via active variant/product recipe
      const variant = getProductVariant(prod, line.variantId);
      const recipe = getActiveRecipe(prod, variant);
      for (const r of recipe) {
        const ing = ingMap.get(r.ingredientId);
        if (!ing) continue;
        const neededBase = convertUnitQty(r.quantity * qty, r.unit ?? ing.unit, ing.unit);
        if (neededBase <= 0) continue;
        requiredIngredients.set(ing.id, roundQty((requiredIngredients.get(ing.id) ?? 0) + neededBase));
      }
    }
  }

  const shortages: StockShortage[] = [];

  for (const [productId, reqQty] of requiredProducts.entries()) {
    const prod = prodMap.get(productId);
    if (!prod) continue;
    if (prod.stockQty + 1e-9 < reqQty) {
      shortages.push({
        itemId: prod.id,
        itemName: prod.name,
        itemNameVi: prod.nameVi,
        itemClassification: prod.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock',
        requiredQty: roundQty(reqQty),
        availableQty: roundQty(prod.stockQty),
        unit: prod.unit,
      });
    }
  }

  for (const [ingredientId, reqQty] of requiredIngredients.entries()) {
    const ing = ingMap.get(ingredientId);
    if (!ing) continue;
    if (ing.stockQty + 1e-9 < reqQty) {
      shortages.push({
        itemId: ing.id,
        itemName: ing.name,
        itemNameVi: ing.nameVi,
        itemClassification: 'ingredient',
        requiredQty: roundQty(reqQty),
        availableQty: roundQty(ing.stockQty),
        unit: ing.unit,
      });
    }
  }

  return {
    ok: allowNegativeStock || shortages.length === 0,
    shortages,
    requiredProducts,
    requiredIngredients,
  };
}

export interface CheckoutPlanParams {
  clientTxId?: string;
  orderNumber?: string;
  saleDate?: string;
  createdAt?: string;
  items: CartRequestItem[];
  paymentMethod: PaymentMethod;
  cash_received_usd?: number | null;
  cash_received_khr?: number | null;
  exchange_rate_used?: number | null;
  change_given_khr?: number | null;
  customerName: string;
  note: string;
  recordedBy: string;
  products: Product[];
  ingredients: Ingredient[];
  existingSales?: Sale[];
  allowNegativeStock?: boolean;
}

export interface CheckoutPlanResult {
  ok: boolean;
  idempotentDuplicate?: boolean;
  error?: string;
  shortages?: StockShortage[];
  sale?: Sale;
  movements?: StockMovement[];
  updatedProducts?: Product[];
  updatedIngredients?: Ingredient[];
  touchedProductIds?: string[];
  touchedIngredientIds?: string[];
}

export function buildCheckoutPlan(params: CheckoutPlanParams): CheckoutPlanResult {
  const cleanItems = params.items.filter((i) => i.quantity > 0);
  if (cleanItems.length === 0) {
    return { ok: false, error: 'Cart is empty.' };
  }

  const saleId = params.clientTxId ? sanitizeString(params.clientTxId, 120) : generateId('sale');

  // Idempotency guard against duplicate checkout clicks or retried requests
  if (params.existingSales) {
    const existing = params.existingSales.find(
      (s) => s.id === saleId || (s.clientTxId && s.clientTxId === saleId)
    );
    if (existing) {
      return {
        ok: true,
        idempotentDuplicate: true,
        sale: existing,
        movements: [],
        updatedProducts: params.products,
        updatedIngredients: params.ingredients,
        touchedProductIds: [],
        touchedIngredientIds: [],
      };
    }
  }

  const validation = validateCheckoutStock(
    cleanItems,
    params.products,
    params.ingredients,
    Boolean(params.allowNegativeStock)
  );

  if (!validation.ok) {
    return {
      ok: false,
      error: `Insufficient stock for ${validation.shortages.map((s) => s.itemName).join(', ')}.`,
      shortages: validation.shortages,
    };
  }

  const prodMap = new Map(params.products.map((p) => [p.id, { ...p }]));
  const ingMap = new Map(params.ingredients.map((i) => [i.id, { ...i }]));

  const saleDate = params.saleDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const orderNumber =
    params.orderNumber || `JF-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';

  const saleItems: SaleItem[] = [];
  const movements: StockMovement[] = [];
  const touchedProductIds = new Set<string>();
  const touchedIngredientIds = new Set<string>();

  let totalKhr = 0;
  let totalCogsKhr = 0;

  cleanItems.forEach((req, idx) => {
    const prod = prodMap.get(req.productId);
    if (!prod) return;

    const variant = getProductVariant(prod, req.variantId);
    const unitPriceKhr = roundKhr(variant ? variant.priceKhr : prod.priceKhr);
    const unitCogsKhr = roundKhr(calculateProductCogs(prod, params.ingredients, variant));
    const lineTotalKhr = roundKhr(unitPriceKhr * req.quantity);
    const lineId = `${saleId}_l${idx + 1}`;
    const deductions: SaleDeductionSnapshot[] = [];

    if (prod.productType === 'PACKAGED' || prod.productType === 'PREPARED_STOCK') {
      const classification: StockClassification =
        prod.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock';
      const deductQty = roundQty(req.quantity);
      prod.stockQty = roundQty(prod.stockQty - deductQty);
      touchedProductIds.add(prod.id);

      const unitCost = Math.max(0, Number(variant?.costPriceKhr ?? prod.costPriceKhr) || unitCogsKhr);
      deductions.push({
        itemId: prod.id,
        itemName: prod.name,
        itemClassification: classification,
        unit: prod.unit,
        qtyPerSaleUnit: 1,
        totalDeductedQty: deductQty,
        unitCostKhr: unitCost,
      });

      movements.push({
        id: `${saleId}_m_${movements.length + 1}`,
        itemId: prod.id,
        itemName: prod.name,
        itemClassification: classification,
        ingredientId: prod.id,
        ingredientName: prod.name,
        movementType: 'sale_consumption',
        deltaQty: -deductQty,
        unit: prod.unit,
        unitCostKhr: unitCost,
        totalCostKhr: roundKhr(unitCost * deductQty),
        referenceId: saleId,
        movementDate: saleDate,
        note: `Order ${orderNumber} (${req.quantity}x ${prod.name})`,
        recordedBy,
        createdAt,
      });
    } else {
      // PREPARED_TO_ORDER: deduct ingredients from active recipe
      const recipe = getActiveRecipe(prod, variant);
      for (const r of recipe) {
        const ing = ingMap.get(r.ingredientId);
        if (!ing) continue;
        const perUnitBase = convertUnitQty(r.quantity, r.unit ?? ing.unit, ing.unit);
        const totalBase = roundQty(perUnitBase * req.quantity);
        if (totalBase <= 0) continue;

        ing.stockQty = roundQty(ing.stockQty - totalBase);
        touchedIngredientIds.add(ing.id);

        deductions.push({
          itemId: ing.id,
          itemName: ing.name,
          itemClassification: 'ingredient',
          unit: ing.unit,
          qtyPerSaleUnit: roundQty(perUnitBase),
          totalDeductedQty: totalBase,
          unitCostKhr: ing.unitCostKhr,
        });

        movements.push({
          id: `${saleId}_m_${movements.length + 1}`,
          itemId: ing.id,
          itemName: ing.name,
          itemClassification: 'ingredient',
          ingredientId: ing.id,
          ingredientName: ing.name,
          movementType: 'sale_consumption',
          deltaQty: -totalBase,
          unit: ing.unit,
          unitCostKhr: ing.unitCostKhr,
          totalCostKhr: roundKhr(ing.unitCostKhr * totalBase),
          referenceId: saleId,
          movementDate: saleDate,
          note: `Order ${orderNumber} (${req.quantity}x ${prod.name}${variant ? ` - ${variant.name}` : ''})`,
          recordedBy,
          createdAt,
        });
      }
    }

    totalKhr += lineTotalKhr;
    totalCogsKhr += roundKhr(unitCogsKhr * req.quantity);

    saleItems.push({
      lineId,
      productId: prod.id,
      categoryId: prod.categoryId || prod.category || UNCATEGORIZED_ID,
      ...(variant ? { variantId: variant.id, variantName: variant.name, variantNameVi: variant.nameVi } : {}),
      productType: prod.productType,
      recipeVersion: variant?.recipeVersion ?? prod.recipeVersion ?? 1,
      productName: prod.name,
      productNameVi: prod.nameVi,
      quantity: req.quantity,
      returnedQty: 0,
      unitPriceKhr,
      unitCogsKhr,
      lineTotalKhr,
      deductions,
    });
  });

  const isCashPayment = params.paymentMethod === 'cash';
  const hasCashDetails =
    isCashPayment &&
    (params.cash_received_usd !== undefined ||
      params.cash_received_khr !== undefined ||
      params.exchange_rate_used !== undefined ||
      params.change_given_khr !== undefined);

  const cash_received_usd =
    hasCashDetails && params.cash_received_usd !== null && params.cash_received_usd !== undefined
      ? Math.max(0, Math.round(Number(params.cash_received_usd) * 100) / 100)
      : hasCashDetails
        ? 0
        : null;
  const cash_received_khr =
    hasCashDetails && params.cash_received_khr !== null && params.cash_received_khr !== undefined
      ? Math.max(0, Math.round(Number(params.cash_received_khr)))
      : hasCashDetails
        ? 0
        : null;
  const exchange_rate_used =
    hasCashDetails && params.exchange_rate_used !== null && params.exchange_rate_used !== undefined
      ? Math.max(1, Math.round(Number(params.exchange_rate_used)))
      : hasCashDetails
        ? 4000
        : null;
  const change_given_khr =
    hasCashDetails && params.change_given_khr !== null && params.change_given_khr !== undefined
      ? Math.max(0, Math.round(Number(params.change_given_khr)))
      : hasCashDetails
        ? Math.max(
            0,
            Math.round(
              (((cash_received_usd ?? 0) * (exchange_rate_used ?? 4000) +
                (cash_received_khr ?? 0) -
                totalKhr) /
                100)
            ) * 100
          )
        : null;

  const sale: Sale = {
    id: saleId,
    clientTxId: saleId,
    orderNumber,
    saleDate,
    items: saleItems,
    subtotalKhr: totalKhr,
    totalKhr,
    refundedKhr: 0,
    netTotalKhr: totalKhr,
    cogsKhr: totalCogsKhr,
    refundedCogsKhr: 0,
    paymentMethod: params.paymentMethod,
    cash_received_usd,
    cash_received_khr,
    exchange_rate_used,
    change_given_khr,
    customerName: sanitizeString(params.customerName || 'Walk-in', 80) || 'Walk-in',
    note: sanitizeString(params.note || '', 200),
    recordedBy,
    status: 'completed',
    returns: [],
    createdAt,
  };

  return {
    ok: true,
    sale,
    movements,
    updatedProducts: params.products.map((p) => prodMap.get(p.id) || p),
    updatedIngredients: params.ingredients.map((i) => ingMap.get(i.id) || i),
    touchedProductIds: Array.from(touchedProductIds),
    touchedIngredientIds: Array.from(touchedIngredientIds),
  };
}

// ---------------------------------------------------------------------------
// Void & Partial Return Plans (Restores ORIGINAL Deduction Snapshots Only!)
// ---------------------------------------------------------------------------

export interface VoidPlanResult {
  ok: boolean;
  error?: string;
  updatedSale?: Sale;
  movements?: StockMovement[];
  updatedProducts?: Product[];
  updatedIngredients?: Ingredient[];
  touchedProductIds?: string[];
  touchedIngredientIds?: string[];
}

export function buildVoidPlan(params: {
  sale: Sale;
  stockMovements: StockMovement[];
  products: Product[];
  ingredients: Ingredient[];
  recordedBy: string;
  reason?: string;
  movementDate?: string;
  createdAt?: string;
}): VoidPlanResult {
  const sale = normalizeSale(params.sale);
  if (sale.status === 'voided' || sale.status === 'refunded') {
    return { ok: false, error: `Order ${sale.orderNumber} is already ${sale.status}.` };
  }

  const prodMap = new Map(params.products.map((p) => [p.id, { ...p }]));
  const ingMap = new Map(params.ingredients.map((i) => [i.id, { ...i }]));
  const touchedProductIds = new Set<string>();
  const touchedIngredientIds = new Set<string>();
  const movements: StockMovement[] = [];

  const movementDate = params.movementDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';
  const reason = sanitizeString(params.reason || 'Order voided', 160);

  // Check if sale items carry deduction snapshots (all new sales do)
  const hasSnapshots = sale.items.some((it) => Array.isArray(it.deductions) && it.deductions.length > 0);

  // Aggregate exact remaining unreturned deductions per (classification, itemId)
  const restoreEntries: Array<{
    itemId: string;
    itemName: string;
    itemClassification: StockClassification;
    unit: IngredientUnit;
    qty: number;
    unitCostKhr: number;
  }> = [];

  if (hasSnapshots) {
    for (const item of sale.items) {
      const remainingUnits = Math.max(0, item.quantity - (item.returnedQty ?? 0));
      if (remainingUnits <= 0 || !item.deductions) continue;
      for (const snap of item.deductions) {
        const qtyToRestore = roundQty(snap.qtyPerSaleUnit * remainingUnits);
        if (qtyToRestore <= 0) continue;
        restoreEntries.push({
          itemId: snap.itemId,
          itemName: snap.itemName,
          itemClassification: snap.itemClassification,
          unit: snap.unit,
          qty: qtyToRestore,
          unitCostKhr: snap.unitCostKhr,
        });
      }
    }
  } else {
    // Fallback for legacy pre-upgrade sales: read original sale_consumption movements minus prior return_restore
    const originalConsumptions = params.stockMovements.filter(
      (m) => m.referenceId === sale.id && m.movementType === 'sale_consumption'
    );
    const priorRestores = params.stockMovements.filter(
      (m) => m.referenceId === sale.id && (m.movementType === 'return_restore' || m.movementType === 'void_restore')
    );

    const restoredByKey = new Map<string, number>();
    for (const r of priorRestores) {
      const key = `${r.itemClassification ?? 'ingredient'}:${r.itemId || r.ingredientId}`;
      restoredByKey.set(key, roundQty((restoredByKey.get(key) ?? 0) + Math.abs(r.deltaQty)));
    }

    for (const m of originalConsumptions) {
      const itemId = m.itemId || m.ingredientId;
      const classification = m.itemClassification ?? 'ingredient';
      const key = `${classification}:${itemId}`;
      const consumed = Math.abs(m.deltaQty);
      const alreadyRestored = restoredByKey.get(key) ?? 0;
      const toRestore = roundQty(Math.max(0, consumed - alreadyRestored));
      if (toRestore <= 0) continue;
      restoredByKey.set(key, roundQty(alreadyRestored + toRestore));

      restoreEntries.push({
        itemId,
        itemName: m.itemName || m.ingredientName,
        itemClassification: classification,
        unit: m.unit,
        qty: toRestore,
        unitCostKhr: m.unitCostKhr ?? (consumed > 0 ? m.totalCostKhr / consumed : 0),
      });
    }
  }

  for (const entry of restoreEntries) {
    if (entry.itemClassification === 'packaged' || entry.itemClassification === 'prepared_stock') {
      const prod = prodMap.get(entry.itemId);
      if (prod) {
        prod.stockQty = roundQty(prod.stockQty + entry.qty);
        touchedProductIds.add(prod.id);
      }
    } else {
      const ing = ingMap.get(entry.itemId);
      if (ing) {
        ing.stockQty = roundQty(ing.stockQty + entry.qty);
        touchedIngredientIds.add(ing.id);
      }
    }

    movements.push({
      id: generateId('mov'),
      itemId: entry.itemId,
      itemName: entry.itemName,
      itemClassification: entry.itemClassification,
      ingredientId: entry.itemId,
      ingredientName: entry.itemName,
      movementType: 'void_restore',
      deltaQty: entry.qty,
      unit: entry.unit,
      unitCostKhr: entry.unitCostKhr,
      totalCostKhr: roundKhr(entry.unitCostKhr * entry.qty),
      referenceId: sale.id,
      movementDate,
      note: `Void ${sale.orderNumber}${reason ? `: ${reason}` : ''}`,
      recordedBy,
      createdAt,
    });
  }

  const updatedSale: Sale = {
    ...sale,
    status: 'voided',
    refundedKhr: sale.totalKhr,
    netTotalKhr: 0,
    refundedCogsKhr: sale.cogsKhr,
    voidedAt: createdAt,
    voidedBy: recordedBy,
    voidReason: reason,
  };

  return {
    ok: true,
    updatedSale,
    movements,
    updatedProducts: params.products.map((p) => prodMap.get(p.id) || p),
    updatedIngredients: params.ingredients.map((i) => ingMap.get(i.id) || i),
    touchedProductIds: Array.from(touchedProductIds),
    touchedIngredientIds: Array.from(touchedIngredientIds),
  };
}

export interface PartialReturnRequest {
  lineId: string;
  quantity: number;
}

export interface PartialReturnPlanResult {
  ok: boolean;
  error?: string;
  updatedSale?: Sale;
  returnRecord?: SaleReturnRecord;
  movements?: StockMovement[];
  updatedProducts?: Product[];
  updatedIngredients?: Ingredient[];
  touchedProductIds?: string[];
  touchedIngredientIds?: string[];
}

export function buildPartialReturnPlan(params: {
  sale: Sale;
  returnItems: PartialReturnRequest[];
  products: Product[];
  ingredients: Ingredient[];
  recordedBy: string;
  reason?: string;
  returnDate?: string;
  createdAt?: string;
}): PartialReturnPlanResult {
  const sale = normalizeSale(params.sale);
  if (sale.status === 'voided' || sale.status === 'refunded') {
    return { ok: false, error: `Order ${sale.orderNumber} cannot be returned (${sale.status}).` };
  }

  const requested = params.returnItems.filter((r) => r.quantity > 0);
  if (requested.length === 0) {
    return { ok: false, error: 'Select at least one item quantity to return.' };
  }

  const prodMap = new Map(params.products.map((p) => [p.id, { ...p }]));
  const ingMap = new Map(params.ingredients.map((i) => [i.id, { ...i }]));
  const touchedProductIds = new Set<string>();
  const touchedIngredientIds = new Set<string>();
  const movements: StockMovement[] = [];
  const returnRecordItems: SaleReturnItem[] = [];

  const returnDate = params.returnDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';
  const reason = sanitizeString(params.reason || 'Customer return', 160);
  const returnId = generateId('ret');

  const updatedSaleItems = sale.items.map((item) => ({ ...item }));
  let batchRefundKhr = 0;
  let batchRestoredCogsKhr = 0;

  for (const req of requested) {
    const lineIndex = updatedSaleItems.findIndex((it) => it.lineId === req.lineId);
    if (lineIndex === -1) {
      return { ok: false, error: `Line item ${req.lineId} not found on order ${sale.orderNumber}.` };
    }
    const line = updatedSaleItems[lineIndex];
    const alreadyReturned = line.returnedQty ?? 0;
    const maxReturnable = line.quantity - alreadyReturned;

    if (req.quantity > maxReturnable) {
      return {
        ok: false,
        error: `Cannot return ${req.quantity}x ${line.productName}; only ${maxReturnable} remaining.`,
      };
    }

    const lineRefundKhr = roundKhr(line.unitPriceKhr * req.quantity);
    const lineRestoredCogsKhr = roundKhr(line.unitCogsKhr * req.quantity);
    batchRefundKhr += lineRefundKhr;
    batchRestoredCogsKhr += lineRestoredCogsKhr;

    line.returnedQty = alreadyReturned + req.quantity;

    returnRecordItems.push({
      lineId: line.lineId!,
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      productName: line.variantName ? `${line.productName} (${line.variantName})` : line.productName,
      quantity: req.quantity,
      refundAmountKhr: lineRefundKhr,
      restoredCogsKhr: lineRestoredCogsKhr,
    });

    // Restore exact original deduction snapshot proportionally (NEVER from edited recipes!)
    if (line.deductions && line.deductions.length > 0) {
      for (const snap of line.deductions) {
        const restoreQty = roundQty(snap.qtyPerSaleUnit * req.quantity);
        if (restoreQty <= 0) continue;

        if (snap.itemClassification === 'packaged' || snap.itemClassification === 'prepared_stock') {
          const prod = prodMap.get(snap.itemId);
          if (prod) {
            prod.stockQty = roundQty(prod.stockQty + restoreQty);
            touchedProductIds.add(prod.id);
          }
        } else {
          const ing = ingMap.get(snap.itemId);
          if (ing) {
            ing.stockQty = roundQty(ing.stockQty + restoreQty);
            touchedIngredientIds.add(ing.id);
          }
        }

        movements.push({
          id: generateId('mov'),
          itemId: snap.itemId,
          itemName: snap.itemName,
          itemClassification: snap.itemClassification,
          ingredientId: snap.itemId,
          ingredientName: snap.itemName,
          movementType: 'return_restore',
          deltaQty: restoreQty,
          unit: snap.unit,
          unitCostKhr: snap.unitCostKhr,
          totalCostKhr: roundKhr(snap.unitCostKhr * restoreQty),
          referenceId: sale.id,
          movementDate: returnDate,
          note: `Return ${sale.orderNumber} (${req.quantity}x ${line.productName})${reason ? ` - ${reason}` : ''}`,
          recordedBy,
          createdAt,
        });
      }
    }
  }

  const totalRefundedKhr = Math.min(sale.totalKhr, (sale.refundedKhr ?? 0) + batchRefundKhr);
  const totalRefundedCogsKhr = Math.min(sale.cogsKhr, (sale.refundedCogsKhr ?? 0) + batchRestoredCogsKhr);
  const allReturned = updatedSaleItems.every((it) => (it.returnedQty ?? 0) >= it.quantity);

  const returnRecord: SaleReturnRecord = {
    id: returnId,
    returnDate,
    createdAt,
    recordedBy,
    reason,
    refundTotalKhr: batchRefundKhr,
    restoredCogsKhr: batchRestoredCogsKhr,
    items: returnRecordItems,
  };

  const updatedSale: Sale = {
    ...sale,
    items: updatedSaleItems,
    refundedKhr: totalRefundedKhr,
    netTotalKhr: Math.max(0, sale.totalKhr - totalRefundedKhr),
    refundedCogsKhr: totalRefundedCogsKhr,
    status: allReturned ? 'refunded' : 'partially_returned',
    returns: [...(sale.returns ?? []), returnRecord],
  };

  return {
    ok: true,
    updatedSale,
    returnRecord,
    movements,
    updatedProducts: params.products.map((p) => prodMap.get(p.id) || p),
    updatedIngredients: params.ingredients.map((i) => ingMap.get(i.id) || i),
    touchedProductIds: Array.from(touchedProductIds),
    touchedIngredientIds: Array.from(touchedIngredientIds),
  };
}

// ---------------------------------------------------------------------------
// Prepared Stock Batch Preparation (Deduct Raw Ingredients OR Direct Add)
// ---------------------------------------------------------------------------

export type BatchPrepMode = 'deduct_ingredients' | 'direct_add';

export interface BatchPrepPlanResult {
  ok: boolean;
  error?: string;
  shortages?: StockShortage[];
  updatedProduct?: Product;
  updatedProducts?: Product[];
  updatedIngredients?: Ingredient[];
  movements?: StockMovement[];
  touchedIngredientIds?: string[];
  batchUnitCostKhr?: number;
}

export function buildBatchPreparationPlan(params: {
  productId: string;
  batchQty: number;
  mode: BatchPrepMode;
  directUnitCostKhr?: number;
  note?: string;
  recordedBy: string;
  movementDate?: string;
  createdAt?: string;
  products: Product[];
  ingredients: Ingredient[];
  allowNegativeStock?: boolean;
}): BatchPrepPlanResult {
  const batchQty = roundQty(Number(params.batchQty) || 0);
  if (batchQty <= 0) {
    return { ok: false, error: 'Batch quantity must be greater than 0.' };
  }

  const product = params.products.find((p) => p.id === params.productId);
  if (!product) {
    return { ok: false, error: 'Prepared product not found.' };
  }
  if (product.productType !== 'PREPARED_STOCK') {
    return { ok: false, error: `${product.name} is not classified as Prepared Stock.` };
  }

  const movementDate = params.movementDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';
  const batchId = generateId('batch');
  const note = sanitizeString(params.note || '', 180);

  const ingMap = new Map(params.ingredients.map((i) => [i.id, { ...i }]));
  const movements: StockMovement[] = [];
  const touchedIngredientIds: string[] = [];

  let batchTotalIngredientCost = 0;

  if (params.mode === 'deduct_ingredients') {
    const recipe = product.recipe || [];
    if (recipe.length === 0) {
      return {
        ok: false,
        error: `${product.name} has no batch recipe configured. Add a recipe or use Direct Add mode.`,
      };
    }

    // Validate raw ingredient stock first
    const shortages: StockShortage[] = [];
    for (const r of recipe) {
      const ing = ingMap.get(r.ingredientId);
      if (!ing) continue;
      const reqBase = roundQty(convertUnitQty(r.quantity * batchQty, r.unit ?? ing.unit, ing.unit));
      if (ing.stockQty + 1e-9 < reqBase) {
        shortages.push({
          itemId: ing.id,
          itemName: ing.name,
          itemNameVi: ing.nameVi,
          itemClassification: 'ingredient',
          requiredQty: reqBase,
          availableQty: roundQty(ing.stockQty),
          unit: ing.unit,
        });
      }
    }

    if (!params.allowNegativeStock && shortages.length > 0) {
      return {
        ok: false,
        error: `Insufficient ingredients to prepare ${batchQty} ${product.unit}: ${shortages
          .map((s) => s.itemName)
          .join(', ')}.`,
        shortages,
      };
    }

    // Deduct ingredients
    for (const r of recipe) {
      const ing = ingMap.get(r.ingredientId);
      if (!ing) continue;
      const deductBase = roundQty(convertUnitQty(r.quantity * batchQty, r.unit ?? ing.unit, ing.unit));
      if (deductBase <= 0) continue;

      ing.stockQty = roundQty(ing.stockQty - deductBase);
      touchedIngredientIds.push(ing.id);

      const lineCost = roundKhr(ing.unitCostKhr * deductBase);
      batchTotalIngredientCost += lineCost;

      movements.push({
        id: generateId('mov'),
        itemId: ing.id,
        itemName: ing.name,
        itemClassification: 'ingredient',
        ingredientId: ing.id,
        ingredientName: ing.name,
        movementType: 'batch_prep_consume',
        deltaQty: -deductBase,
        unit: ing.unit,
        unitCostKhr: ing.unitCostKhr,
        totalCostKhr: lineCost,
        referenceId: batchId,
        movementDate,
        note: `Batch prep ${batchQty} ${product.unit} ${product.name}${note ? ` - ${note}` : ''}`,
        recordedBy,
        createdAt,
      });
    }
  }

  const batchUnitCostKhr =
    params.mode === 'deduct_ingredients'
      ? roundKhr(batchTotalIngredientCost / batchQty)
      : roundKhr(
          params.directUnitCostKhr !== undefined && params.directUnitCostKhr >= 0
            ? params.directUnitCostKhr
            : product.costPriceKhr || calculateRecipeCogs(product.recipe, params.ingredients)
        );

  const oldQty = Math.max(0, product.stockQty);
  const oldVal = oldQty * Math.max(0, product.costPriceKhr);
  const newTotalQty = roundQty(product.stockQty + batchQty);
  const newWeightedUnitCost =
    oldQty + batchQty > 0
      ? roundKhr((oldVal + batchQty * batchUnitCostKhr) / (oldQty + batchQty))
      : batchUnitCostKhr;

  const updatedProduct: Product = {
    ...product,
    stockQty: newTotalQty,
    costPriceKhr: newWeightedUnitCost,
    updatedAt: createdAt,
  };

  movements.push({
    id: generateId('mov'),
    itemId: product.id,
    itemName: product.name,
    itemClassification: 'prepared_stock',
    ingredientId: product.id,
    ingredientName: product.name,
    movementType: 'batch_prep_in',
    deltaQty: batchQty,
    unit: product.unit,
    unitCostKhr: batchUnitCostKhr,
    totalCostKhr: roundKhr(batchUnitCostKhr * batchQty),
    referenceId: batchId,
    movementDate,
    note:
      params.mode === 'deduct_ingredients'
        ? `Batch prepared (ingredients deducted)${note ? ` - ${note}` : ''}`
        : `Batch added directly${note ? ` - ${note}` : ''}`,
    recordedBy,
    createdAt,
  });

  return {
    ok: true,
    updatedProduct,
    updatedProducts: params.products.map((p) => (p.id === product.id ? updatedProduct : p)),
    updatedIngredients: params.ingredients.map((i) => ingMap.get(i.id) || i),
    movements,
    touchedIngredientIds,
    batchUnitCostKhr,
  };
}

// ---------------------------------------------------------------------------
// Stock-In / Purchases (All 3 Tiers + Carton Multiplication, NO Expense Double-Count)
// ---------------------------------------------------------------------------

export interface PurchasePlanResult {
  ok: boolean;
  error?: string;
  purchase?: PurchaseRecord;
  movement?: StockMovement;
  updatedProduct?: Product;
  updatedIngredient?: Ingredient;
}

export function buildPurchasePlan(params: {
  itemId: string;
  itemClassification: StockClassification;
  quantity: number; // Base units (already multiplied if packs used, or packs * unitsPerPack)
  packCount?: number;
  unitsPerPack?: number;
  totalCostKhr: number;
  paymentMethod: PaymentMethod;
  supplier: string;
  barcodeScanned?: string;
  note?: string;
  recordedBy: string;
  purchaseDate?: string;
  createdAt?: string;
  products: Product[];
  ingredients: Ingredient[];
}): PurchasePlanResult {
  const effectiveQty = roundQty(
    params.packCount && params.unitsPerPack
      ? params.packCount * params.unitsPerPack
      : params.quantity
  );
  if (effectiveQty <= 0) {
    return { ok: false, error: 'Purchase quantity must be greater than 0.' };
  }

  const totalCostKhr = Math.max(0, roundKhr(params.totalCostKhr));
  const unitCostKhr = effectiveQty > 0 ? totalCostKhr / effectiveQty : 0;
  const purchaseDate = params.purchaseDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';
  const purchaseId = generateId('pur');

  if (params.itemClassification === 'ingredient') {
    const ing = params.ingredients.find((i) => i.id === params.itemId);
    if (!ing) return { ok: false, error: 'Ingredient not found.' };

    const oldQty = Math.max(0, ing.stockQty);
    const weightedCost =
      oldQty + effectiveQty > 0
        ? (oldQty * ing.unitCostKhr + totalCostKhr) / (oldQty + effectiveQty)
        : unitCostKhr;

    const supplier = sanitizeString(params.supplier || ing.supplier || 'Market Supplier', 100);
    const updatedIngredient: Ingredient = {
      ...ing,
      stockQty: roundQty(ing.stockQty + effectiveQty),
      unitCostKhr: Math.round(weightedCost * 100) / 100,
      supplier,
      updatedAt: createdAt,
    };

    const purchase: PurchaseRecord = {
      id: purchaseId,
      purchaseDate,
      itemId: ing.id,
      itemName: ing.name,
      itemClassification: 'ingredient',
      quantity: effectiveQty,
      ...(params.packCount ? { packCount: params.packCount } : {}),
      ...(params.unitsPerPack ? { unitsPerPack: params.unitsPerPack } : {}),
      unit: ing.unit,
      totalCostKhr,
      unitCostKhr: Math.round(unitCostKhr * 100) / 100,
      paymentMethod: params.paymentMethod,
      supplier,
      ...(params.barcodeScanned ? { barcodeScanned: params.barcodeScanned } : {}),
      note: sanitizeString(params.note || '', 200),
      recordedBy,
      createdAt,
    };

    const movement: StockMovement = {
      id: generateId('mov'),
      itemId: ing.id,
      itemName: ing.name,
      itemClassification: 'ingredient',
      ingredientId: ing.id,
      ingredientName: ing.name,
      movementType: 'purchase',
      deltaQty: effectiveQty,
      unit: ing.unit,
      unitCostKhr: purchase.unitCostKhr,
      totalCostKhr,
      referenceId: purchaseId,
      movementDate: purchaseDate,
      note: sanitizeString(params.note || `Purchase from ${supplier}`, 200),
      recordedBy,
      createdAt,
    };

    return { ok: true, purchase, movement, updatedIngredient };
  }

  // Packaged or Prepared Stock
  const prod = params.products.find((p) => p.id === params.itemId);
  if (!prod) return { ok: false, error: 'Product not found.' };

  const oldQty = Math.max(0, prod.stockQty);
  const weightedCost =
    oldQty + effectiveQty > 0
      ? roundKhr((oldQty * prod.costPriceKhr + totalCostKhr) / (oldQty + effectiveQty))
      : roundKhr(unitCostKhr);

  const supplier = sanitizeString(params.supplier || prod.supplier || 'Wholesale Supplier', 100);
  const updatedProduct: Product = {
    ...prod,
    stockQty: roundQty(prod.stockQty + effectiveQty),
    costPriceKhr: weightedCost,
    supplier,
    updatedAt: createdAt,
  };

  const packDesc =
    params.packCount && params.unitsPerPack && params.unitsPerPack > 1
      ? `${params.packCount} packs × ${params.unitsPerPack} ${prod.unit}`
      : `${effectiveQty} ${prod.unit}`;

  const purchase: PurchaseRecord = {
    id: purchaseId,
    purchaseDate,
    itemId: prod.id,
    itemName: prod.name,
    itemClassification: params.itemClassification,
    quantity: effectiveQty,
    ...(params.packCount ? { packCount: params.packCount } : {}),
    ...(params.unitsPerPack ? { unitsPerPack: params.unitsPerPack } : {}),
    unit: prod.unit,
    totalCostKhr,
    unitCostKhr: roundKhr(unitCostKhr),
    paymentMethod: params.paymentMethod,
    supplier,
    ...(params.barcodeScanned ? { barcodeScanned: params.barcodeScanned } : {}),
    note: sanitizeString(params.note || `Stock-in ${packDesc}`, 200),
    recordedBy,
    createdAt,
  };

  const movement: StockMovement = {
    id: generateId('mov'),
    itemId: prod.id,
    itemName: prod.name,
    itemClassification: params.itemClassification,
    ingredientId: prod.id,
    ingredientName: prod.name,
    movementType: 'purchase',
    deltaQty: effectiveQty,
    unit: prod.unit,
    unitCostKhr: purchase.unitCostKhr,
    totalCostKhr,
    referenceId: purchaseId,
    movementDate: purchaseDate,
    note: sanitizeString(params.note || `Stock-in ${packDesc} from ${supplier}`, 200),
    recordedBy,
    createdAt,
  };

  return { ok: true, purchase, movement, updatedProduct };
}

// ---------------------------------------------------------------------------
// Opening Stock (Valuation Only — NEVER Treated as an Expense!)
// ---------------------------------------------------------------------------

export interface StockOperationResult {
  ok: boolean;
  error?: string;
  movement?: StockMovement;
  updatedProduct?: Product;
  updatedIngredient?: Ingredient;
}

export function buildOpeningStockPlan(params: {
  itemId: string;
  itemClassification: StockClassification;
  quantity: number;
  unitCostKhr: number;
  note?: string;
  recordedBy: string;
  movementDate?: string;
  createdAt?: string;
  products: Product[];
  ingredients: Ingredient[];
}): StockOperationResult {
  const qty = roundQty(Number(params.quantity) || 0);
  if (qty <= 0) return { ok: false, error: 'Opening stock quantity must be greater than 0.' };

  const unitCostKhr = Math.max(0, Number(params.unitCostKhr) || 0);
  const movementDate = params.movementDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';

  if (params.itemClassification === 'ingredient') {
    const ing = params.ingredients.find((i) => i.id === params.itemId);
    if (!ing) return { ok: false, error: 'Ingredient not found.' };

    const updatedIngredient: Ingredient = {
      ...ing,
      stockQty: roundQty(ing.stockQty + qty),
      unitCostKhr: unitCostKhr > 0 ? unitCostKhr : ing.unitCostKhr,
      updatedAt: createdAt,
    };

    const movement: StockMovement = {
      id: generateId('mov'),
      itemId: ing.id,
      itemName: ing.name,
      itemClassification: 'ingredient',
      ingredientId: ing.id,
      ingredientName: ing.name,
      movementType: 'opening_stock',
      deltaQty: qty,
      unit: ing.unit,
      unitCostKhr: updatedIngredient.unitCostKhr,
      totalCostKhr: roundKhr(updatedIngredient.unitCostKhr * qty),
      referenceId: 'opening_stock',
      movementDate,
      note: sanitizeString(params.note || 'Opening stock balance (non-expense)', 200),
      recordedBy,
      createdAt,
    };
    return { ok: true, movement, updatedIngredient };
  }

  const prod = params.products.find((p) => p.id === params.itemId);
  if (!prod) return { ok: false, error: 'Product not found.' };

  const updatedProduct: Product = {
    ...prod,
    stockQty: roundQty(prod.stockQty + qty),
    costPriceKhr: unitCostKhr > 0 ? roundKhr(unitCostKhr) : prod.costPriceKhr,
    updatedAt: createdAt,
  };

  const movement: StockMovement = {
    id: generateId('mov'),
    itemId: prod.id,
    itemName: prod.name,
    itemClassification: params.itemClassification,
    ingredientId: prod.id,
    ingredientName: prod.name,
    movementType: 'opening_stock',
    deltaQty: qty,
    unit: prod.unit,
    unitCostKhr: updatedProduct.costPriceKhr,
    totalCostKhr: roundKhr(updatedProduct.costPriceKhr * qty),
    referenceId: 'opening_stock',
    movementDate,
    note: sanitizeString(params.note || 'Opening stock balance (non-expense)', 200),
    recordedBy,
    createdAt,
  };

  return { ok: true, movement, updatedProduct };
}

// ---------------------------------------------------------------------------
// Physical Stock Count & Manual / Damaged / Expired Adjustments
// ---------------------------------------------------------------------------

export function buildStockCountPlan(params: {
  itemId: string;
  itemClassification: StockClassification;
  countedQty: number;
  note?: string;
  recordedBy: string;
  movementDate?: string;
  createdAt?: string;
  products: Product[];
  ingredients: Ingredient[];
}): StockOperationResult {
  const countedQty = roundQty(Math.max(0, Number(params.countedQty) || 0));
  const movementDate = params.movementDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';

  if (params.itemClassification === 'ingredient') {
    const ing = params.ingredients.find((i) => i.id === params.itemId);
    if (!ing) return { ok: false, error: 'Ingredient not found.' };
    const variance = roundQty(countedQty - ing.stockQty);
    const updatedIngredient: Ingredient = { ...ing, stockQty: countedQty, updatedAt: createdAt };
    const movement: StockMovement = {
      id: generateId('mov'),
      itemId: ing.id,
      itemName: ing.name,
      itemClassification: 'ingredient',
      ingredientId: ing.id,
      ingredientName: ing.name,
      movementType: 'stock_count',
      deltaQty: variance,
      unit: ing.unit,
      unitCostKhr: ing.unitCostKhr,
      totalCostKhr: roundKhr(Math.abs(variance) * ing.unitCostKhr),
      referenceId: 'stock_count',
      movementDate,
      note: sanitizeString(
        params.note || `Physical count: ${ing.stockQty} → ${countedQty} ${ing.unit}`,
        200
      ),
      recordedBy,
      createdAt,
    };
    return { ok: true, movement, updatedIngredient };
  }

  const prod = params.products.find((p) => p.id === params.itemId);
  if (!prod) return { ok: false, error: 'Product not found.' };
  const variance = roundQty(countedQty - prod.stockQty);
  const updatedProduct: Product = { ...prod, stockQty: countedQty, updatedAt: createdAt };
  const movement: StockMovement = {
    id: generateId('mov'),
    itemId: prod.id,
    itemName: prod.name,
    itemClassification: params.itemClassification,
    ingredientId: prod.id,
    ingredientName: prod.name,
    movementType: 'stock_count',
    deltaQty: variance,
    unit: prod.unit,
    unitCostKhr: prod.costPriceKhr,
    totalCostKhr: roundKhr(Math.abs(variance) * prod.costPriceKhr),
    referenceId: 'stock_count',
    movementDate,
    note: sanitizeString(
      params.note || `Physical count: ${prod.stockQty} → ${countedQty} ${prod.unit}`,
      200
    ),
    recordedBy,
    createdAt,
  };
  return { ok: true, movement, updatedProduct };
}

export function buildAdjustmentPlan(params: {
  itemId: string;
  itemClassification: StockClassification;
  movementType: Extract<MovementType, 'adjustment' | 'damaged' | 'expired'>;
  deltaQty: number;
  note?: string;
  recordedBy: string;
  movementDate?: string;
  createdAt?: string;
  products: Product[];
  ingredients: Ingredient[];
  allowNegativeStock?: boolean;
}): StockOperationResult {
  const rawDelta = roundQty(Number(params.deltaQty) || 0);
  if (rawDelta === 0) return { ok: false, error: 'Adjustment quantity cannot be 0.' };

  // Damaged and expired write-offs always reduce stock
  const deltaQty =
    params.movementType === 'damaged' || params.movementType === 'expired'
      ? -Math.abs(rawDelta)
      : rawDelta;

  const movementDate = params.movementDate || todayIso();
  const createdAt = params.createdAt || new Date().toISOString();
  const recordedBy = sanitizeString(params.recordedBy || 'Family', 80) || 'Family';

  if (params.itemClassification === 'ingredient') {
    const ing = params.ingredients.find((i) => i.id === params.itemId);
    if (!ing) return { ok: false, error: 'Ingredient not found.' };
    const nextQty = roundQty(ing.stockQty + deltaQty);
    if (!params.allowNegativeStock && nextQty < 0) {
      return {
        ok: false,
        error: `Cannot reduce ${ing.name} below 0 (available: ${ing.stockQty} ${ing.unit}).`,
      };
    }
    const updatedIngredient: Ingredient = { ...ing, stockQty: nextQty, updatedAt: createdAt };
    const movement: StockMovement = {
      id: generateId('mov'),
      itemId: ing.id,
      itemName: ing.name,
      itemClassification: 'ingredient',
      ingredientId: ing.id,
      ingredientName: ing.name,
      movementType: params.movementType,
      deltaQty,
      unit: ing.unit,
      unitCostKhr: ing.unitCostKhr,
      totalCostKhr: roundKhr(Math.abs(deltaQty) * ing.unitCostKhr),
      referenceId: params.movementType,
      movementDate,
      note: sanitizeString(params.note || params.movementType, 200),
      recordedBy,
      createdAt,
    };
    return { ok: true, movement, updatedIngredient };
  }

  const prod = params.products.find((p) => p.id === params.itemId);
  if (!prod) return { ok: false, error: 'Product not found.' };
  const nextQty = roundQty(prod.stockQty + deltaQty);
  if (!params.allowNegativeStock && nextQty < 0) {
    return {
      ok: false,
      error: `Cannot reduce ${prod.name} below 0 (available: ${prod.stockQty} ${prod.unit}).`,
    };
  }
  const updatedProduct: Product = { ...prod, stockQty: nextQty, updatedAt: createdAt };
  const movement: StockMovement = {
    id: generateId('mov'),
    itemId: prod.id,
    itemName: prod.name,
    itemClassification: params.itemClassification,
    ingredientId: prod.id,
    ingredientName: prod.name,
    movementType: params.movementType,
    deltaQty,
    unit: prod.unit,
    unitCostKhr: prod.costPriceKhr,
    totalCostKhr: roundKhr(Math.abs(deltaQty) * prod.costPriceKhr),
    referenceId: params.movementType,
    movementDate,
    note: sanitizeString(params.note || params.movementType, 200),
    recordedBy,
    createdAt,
  };
  return { ok: true, movement, updatedProduct };
}

// ---------------------------------------------------------------------------
// Financial Reporting Engine (Accrual P&L vs Cash Flow vs Inventory Valuation)
// ---------------------------------------------------------------------------

export type ReportGrouping = 'daily' | 'monthly' | 'yearly';

export interface PeriodBucket {
  periodKey: string; // YYYY-MM-DD, YYYY-MM, or YYYY
  grossSalesKhr: number;
  refundsKhr: number;
  netRevenueKhr: number;
  cogsKhr: number;
  grossProfitKhr: number;
  operatingExpensesKhr: number;
  netProfitKhr: number;
  inventoryPurchasesKhr: number;
  businessNetCashFlowKhr: number;
  orderCount: number;
}

export interface ProductProfitRow {
  productId: string;
  categoryId: string;
  name: string;
  nameVi: string;
  productType: ProductType;
  netQty: number;
  returnedQty: number;
  netRevenueKhr: number;
  netCogsKhr: number;
  grossProfitKhr: number;
  marginPct: number;
}

export interface CategoryProfitRow {
  categoryId: string;
  categoryName: string;
  categoryNameVi: string;
  netQty: number;
  orderCount: number;
  netRevenueKhr: number;
  netCogsKhr: number;
  grossProfitKhr: number;
  marginPct: number;
}

export interface FinancialReportSummary {
  dateStart: string;
  dateEnd: string;
  grouping: ReportGrouping;
  activeCategoryFilterId: string;
  // Accrual Profit & Loss (NO double-counting of inventory purchases!)
  grossSalesKhr: number;
  returnsRefundsKhr: number;
  voidedOrdersCount: number;
  voidedTotalKhr: number;
  netRevenueKhr: number;
  netCogsKhr: number;
  grossProfitKhr: number;
  grossMarginPct: number;
  operatingExpensesKhr: number;
  netProfitKhr: number;
  netMarginPct: number;
  completedOrderCount: number;
  unitsSoldNet: number;
  // Cash Flow Statement (Explicitly separates inventory purchases from operating expenses)
  cashInflowsKhr: number;
  cashInflowsByMethod: Record<PaymentMethod, number>;
  paymentOrderCountsByMethod: Record<PaymentMethod, number>;
  inventoryPurchasesCashOutKhr: number;
  operatingExpensesCashOutKhr: number;
  householdExpensesCashOutKhr: number;
  businessNetCashFlowKhr: number;
  // Current Inventory Valuation across all 3 tiers (Opening stock included here, NOT in expenses)
  inventoryValuation: {
    packagedValueKhr: number;
    ingredientsValueKhr: number;
    preparedStockValueKhr: number;
    totalInventoryValueKhr: number;
  };
  // Grouped Series, Category Breakdown & Product Profitability
  series: PeriodBucket[];
  categoryBreakdown: CategoryProfitRow[];
  productProfitability: ProductProfitRow[];
}

export function isLegacyInventoryPurchaseExpense(exp: Expense): boolean {
  if (exp.isInventoryPurchase) return true;
  if (exp.scope === 'business' && (exp.category === 'ingredients' || Boolean(exp.linkedIngredientId))) {
    return true;
  }
  return false;
}

function toPeriodKey(dateStr: string, grouping: ReportGrouping): string {
  if (grouping === 'yearly') return dateStr.slice(0, 4);
  if (grouping === 'monthly') return dateStr.slice(0, 7);
  return dateStr.slice(0, 10);
}

export function computeFinancialReport(params: {
  sales: Sale[];
  expenses: Expense[];
  purchases: PurchaseRecord[];
  products: Product[];
  ingredients: Ingredient[];
  categories?: CategoryItem[];
  categoryFilterId?: string;
  dateStart?: string;
  dateEnd?: string;
  grouping?: ReportGrouping;
}): FinancialReportSummary {
  const dateStart = params.dateStart || '2000-01-01';
  const dateEnd = params.dateEnd || '2099-12-31';
  const grouping: ReportGrouping = params.grouping || 'daily';
  const safeCategories = ensureCategoriesList(params.categories);
  const activeCategoryFilterId =
    params.categoryFilterId && params.categoryFilterId !== 'all'
      ? params.categoryFilterId
      : 'all';
  const isFilteredByCategory = activeCategoryFilterId !== 'all';

  const inRange = (d: string) => d >= dateStart && d <= dateEnd;

  const rangeSales = params.sales.map(normalizeSale).filter((s) => inRange(s.saleDate));
  const rangeExpenses = params.expenses.filter((e) => inRange(e.expenseDate));
  const rangePurchases = params.purchases.filter((p) => inRange(p.purchaseDate));

  let grossSalesKhr = 0;
  let returnsRefundsKhr = 0;
  let voidedOrdersCount = 0;
  let voidedTotalKhr = 0;
  let netRevenueKhr = 0;
  let netCogsKhr = 0;
  let completedOrderCount = 0;
  let unitsSoldNet = 0;

  const cashInflowsByMethod: Record<PaymentMethod, number> = {
    cash: 0,
    khqr: 0,
    aba: 0,
    wing: 0,
  };
  const paymentOrderCountsByMethod: Record<PaymentMethod, number> = {
    cash: 0,
    khqr: 0,
    aba: 0,
    wing: 0,
  };

  const bucketMap = new Map<string, PeriodBucket>();
  const ensureBucket = (key: string): PeriodBucket => {
    let b = bucketMap.get(key);
    if (!b) {
      b = {
        periodKey: key,
        grossSalesKhr: 0,
        refundsKhr: 0,
        netRevenueKhr: 0,
        cogsKhr: 0,
        grossProfitKhr: 0,
        operatingExpensesKhr: 0,
        netProfitKhr: 0,
        inventoryPurchasesKhr: 0,
        businessNetCashFlowKhr: 0,
        orderCount: 0,
      };
      bucketMap.set(key, b);
    }
    return b;
  };

  const prodLookup = new Map(params.products.map((p) => [p.id, p]));
  const prodByCanonicalName = new Map<string, Product>();
  for (const p of params.products) {
    const key = normalizeName(p.name);
    if (!key) continue;
    const existingCanonical = prodByCanonicalName.get(key);
    if (!existingCanonical || (!existingCanonical.active && p.active)) {
      prodByCanonicalName.set(key, p);
    }
  }
  const productPerfMap = new Map<string, ProductProfitRow>();
  const categoryPerfMap = new Map<string, CategoryProfitRow>();

  for (const sale of rangeSales) {
    if (sale.status === 'voided') {
      if (!isFilteredByCategory) {
        voidedOrdersCount += 1;
        voidedTotalKhr += sale.totalKhr;
      } else {
        const voidedCatItems = sale.items.filter(
          (it) => resolveSaleItemCategoryId(it, prodLookup, safeCategories) === activeCategoryFilterId
        );
        if (voidedCatItems.length > 0) {
          voidedOrdersCount += 1;
          voidedTotalKhr += voidedCatItems.reduce(
            (sum, it) => sum + roundKhr(it.lineTotalKhr || it.unitPriceKhr * it.quantity),
            0
          );
        }
      }
      continue;
    }

    // 1. Always accumulate full Category Breakdown across ALL categories in the period
    const categoriesSeenInSale = new Set<string>();
    for (const item of sale.items) {
      const catId = resolveSaleItemCategoryId(item, prodLookup, safeCategories);
      const retQty = item.returnedQty ?? 0;
      const netQty = Math.max(0, item.quantity - retQty);
      const itemNetRev = roundKhr(item.unitPriceKhr * netQty);
      const itemNetCogs = roundKhr(item.unitCogsKhr * netQty);

      const catMeta = getCategoryById(catId, safeCategories);
      const existingCat = categoryPerfMap.get(catId) || {
        categoryId: catId,
        categoryName: catMeta.name,
        categoryNameVi: catMeta.nameVi || catMeta.name,
        netQty: 0,
        orderCount: 0,
        netRevenueKhr: 0,
        netCogsKhr: 0,
        grossProfitKhr: 0,
        marginPct: 0,
      };
      existingCat.netQty += netQty;
      if (!categoriesSeenInSale.has(catId)) {
        existingCat.orderCount += 1;
        categoriesSeenInSale.add(catId);
      }
      existingCat.netRevenueKhr += itemNetRev;
      existingCat.netCogsKhr += itemNetCogs;
      existingCat.grossProfitKhr = existingCat.netRevenueKhr - existingCat.netCogsKhr;
      existingCat.marginPct =
        existingCat.netRevenueKhr > 0
          ? Math.round((existingCat.grossProfitKhr / existingCat.netRevenueKhr) * 100)
          : 0;
      categoryPerfMap.set(catId, existingCat);
    }

    // 2. Accumulate filtered (or full) KPIs, trend series, payment reconciliation, and product table
    const relevantItems = isFilteredByCategory
      ? sale.items.filter(
          (item) =>
            resolveSaleItemCategoryId(item, prodLookup, safeCategories) === activeCategoryFilterId
        )
      : sale.items;

    if (isFilteredByCategory && relevantItems.length === 0) {
      continue;
    }

    let saleGross = sale.totalKhr;
    let saleRefund = sale.refundedKhr ?? 0;
    let saleNet = sale.netTotalKhr ?? Math.max(0, sale.totalKhr - saleRefund);
    let saleNetCogs = Math.max(0, sale.cogsKhr - (sale.refundedCogsKhr ?? 0));

    if (isFilteredByCategory) {
      saleGross = 0;
      saleRefund = 0;
      saleNet = 0;
      saleNetCogs = 0;
      for (const item of relevantItems) {
        const retQty = item.returnedQty ?? 0;
        const netQty = Math.max(0, item.quantity - retQty);
        saleGross += roundKhr(item.unitPriceKhr * item.quantity);
        saleRefund += roundKhr(item.unitPriceKhr * retQty);
        saleNet += roundKhr(item.unitPriceKhr * netQty);
        saleNetCogs += roundKhr(item.unitCogsKhr * netQty);
      }
    }

    grossSalesKhr += saleGross;
    returnsRefundsKhr += saleRefund;
    netRevenueKhr += saleNet;
    netCogsKhr += saleNetCogs;
    completedOrderCount += 1;
    cashInflowsByMethod[sale.paymentMethod] =
      (cashInflowsByMethod[sale.paymentMethod] || 0) + saleNet;
    paymentOrderCountsByMethod[sale.paymentMethod] =
      (paymentOrderCountsByMethod[sale.paymentMethod] || 0) + 1;

    const b = ensureBucket(toPeriodKey(sale.saleDate, grouping));
    b.grossSalesKhr += saleGross;
    b.refundsKhr += saleRefund;
    b.netRevenueKhr += saleNet;
    b.cogsKhr += saleNetCogs;
    b.orderCount += 1;

    for (const item of relevantItems) {
      const catId = resolveSaleItemCategoryId(item, prodLookup, safeCategories);
      const retQty = item.returnedQty ?? 0;
      const netQty = Math.max(0, item.quantity - retQty);
      unitsSoldNet += netQty;

      const resolvedProd =
        prodLookup.get(item.productId) ||
        prodByCanonicalName.get(normalizeName(item.productName));
      const canonicalPerfKey =
        normalizeName(resolvedProd?.name || item.productName) || item.productId;

      const existing = productPerfMap.get(canonicalPerfKey) || {
        productId: resolvedProd?.id || item.productId,
        categoryId: catId,
        name: resolvedProd?.name || item.productName,
        nameVi: resolvedProd?.nameVi || item.productNameVi,
        productType:
          item.productType || resolvedProd?.productType || 'PREPARED_TO_ORDER',
        netQty: 0,
        returnedQty: 0,
        netRevenueKhr: 0,
        netCogsKhr: 0,
        grossProfitKhr: 0,
        marginPct: 0,
      };
      existing.netQty += netQty;
      existing.returnedQty += retQty;
      existing.netRevenueKhr += roundKhr(item.unitPriceKhr * netQty);
      existing.netCogsKhr += roundKhr(item.unitCogsKhr * netQty);
      existing.grossProfitKhr = existing.netRevenueKhr - existing.netCogsKhr;
      existing.marginPct =
        existing.netRevenueKhr > 0
          ? Math.round((existing.grossProfitKhr / existing.netRevenueKhr) * 100)
          : 0;
      productPerfMap.set(canonicalPerfKey, existing);
    }
  }

  let operatingExpensesKhr = 0;
  let legacyInventoryPurchaseCashOutKhr = 0;
  let householdExpensesCashOutKhr = 0;

  for (const exp of rangeExpenses) {
    if (exp.scope === 'household') {
      householdExpensesCashOutKhr += exp.amountKhr;
      continue;
    }
    if (isLegacyInventoryPurchaseExpense(exp)) {
      legacyInventoryPurchaseCashOutKhr += exp.amountKhr;
      const b = ensureBucket(toPeriodKey(exp.expenseDate, grouping));
      b.inventoryPurchasesKhr += exp.amountKhr;
    } else {
      operatingExpensesKhr += exp.amountKhr;
      const b = ensureBucket(toPeriodKey(exp.expenseDate, grouping));
      b.operatingExpensesKhr += exp.amountKhr;
    }
  }

  let purchasesTableCashOutKhr = 0;
  for (const pur of rangePurchases) {
    purchasesTableCashOutKhr += pur.totalCostKhr;
    const b = ensureBucket(toPeriodKey(pur.purchaseDate, grouping));
    b.inventoryPurchasesKhr += pur.totalCostKhr;
  }

  const inventoryPurchasesCashOutKhr = roundKhr(
    purchasesTableCashOutKhr + legacyInventoryPurchaseCashOutKhr
  );
  const grossProfitKhr = roundKhr(netRevenueKhr - netCogsKhr);
  const netProfitKhr = roundKhr(grossProfitKhr - operatingExpensesKhr);
  const grossMarginPct = netRevenueKhr > 0 ? Math.round((grossProfitKhr / netRevenueKhr) * 100) : 0;
  const netMarginPct = netRevenueKhr > 0 ? Math.round((netProfitKhr / netRevenueKhr) * 100) : 0;
  const businessNetCashFlowKhr = roundKhr(
    netRevenueKhr - inventoryPurchasesCashOutKhr - operatingExpensesKhr
  );

  // Inventory Valuation across all 3 tiers (current on-hand; opening stock lives here!)
  let packagedValueKhr = 0;
  let preparedStockValueKhr = 0;
  for (const prod of params.products) {
    const qty = Math.max(0, prod.stockQty);
    if (prod.productType === 'PACKAGED') {
      packagedValueKhr += qty * Math.max(0, prod.costPriceKhr);
    } else if (prod.productType === 'PREPARED_STOCK') {
      preparedStockValueKhr += qty * Math.max(0, prod.costPriceKhr);
    }
  }
  const ingredientsValueKhr = params.ingredients.reduce(
    (sum, ing) => sum + Math.max(0, ing.stockQty) * Math.max(0, ing.unitCostKhr),
    0
  );

  const series = Array.from(bucketMap.values())
    .map((b) => {
      const gp = roundKhr(b.netRevenueKhr - b.cogsKhr);
      const np = roundKhr(gp - b.operatingExpensesKhr);
      const cf = roundKhr(b.netRevenueKhr - b.inventoryPurchasesKhr - b.operatingExpensesKhr);
      return {
        ...b,
        grossProfitKhr: gp,
        netProfitKhr: np,
        businessNetCashFlowKhr: cf,
      };
    })
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  const categoryBreakdown = Array.from(categoryPerfMap.values()).sort(
    (a, b) => b.netRevenueKhr - a.netRevenueKhr
  );

  const productProfitability = Array.from(productPerfMap.values()).sort(
    (a, b) => b.netRevenueKhr - a.netRevenueKhr
  );

  return {
    dateStart,
    dateEnd,
    grouping,
    activeCategoryFilterId,
    grossSalesKhr: roundKhr(grossSalesKhr),
    returnsRefundsKhr: roundKhr(returnsRefundsKhr),
    voidedOrdersCount,
    voidedTotalKhr: roundKhr(voidedTotalKhr),
    netRevenueKhr: roundKhr(netRevenueKhr),
    netCogsKhr: roundKhr(netCogsKhr),
    grossProfitKhr,
    grossMarginPct,
    operatingExpensesKhr: roundKhr(operatingExpensesKhr),
    netProfitKhr,
    netMarginPct,
    completedOrderCount,
    unitsSoldNet,
    cashInflowsKhr: roundKhr(netRevenueKhr),
    cashInflowsByMethod,
    paymentOrderCountsByMethod,
    inventoryPurchasesCashOutKhr,
    operatingExpensesCashOutKhr: roundKhr(operatingExpensesKhr),
    householdExpensesCashOutKhr: roundKhr(householdExpensesCashOutKhr),
    businessNetCashFlowKhr,
    inventoryValuation: {
      packagedValueKhr: roundKhr(packagedValueKhr),
      ingredientsValueKhr: roundKhr(ingredientsValueKhr),
      preparedStockValueKhr: roundKhr(preparedStockValueKhr),
      totalInventoryValueKhr: roundKhr(packagedValueKhr + ingredientsValueKhr + preparedStockValueKhr),
    },
    series,
    categoryBreakdown,
    productProfitability,
  };
}
