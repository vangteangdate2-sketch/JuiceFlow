import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
  type Timestamp,
} from 'firebase/firestore';
import {
  applyAuthPersistence,
  auth,
  checkPendingRedirectResult,
  db,
  getFirebaseAuthErrorCode,
  handleFirestoreError,
  isAllowedCloudUser,
  loadRememberMePreference,
  OperationType,
  PENDING_JOIN_STORAGE_KEY,
  saveRememberMePreference,
  signInAnonymouslyForSync,
  signInWithGoogleForSync,
  signOutWorkspace,
} from '../lib/firebase';
import { getTranslations } from '../i18n/translations';
import type {
  AppLanguage,
  BarcodeFormat,
  BarcodePackagingType,
  BarcodeRegistryRecord,
  BarcodeResolutionResult,
  BarcodeSource,
  Expense,
  ExpenseCategory,
  ExpenseScope,
  Ingredient,
  MovementType,
  PaymentMethod,
  Product,
  PurchaseRecord,
  Sale,
  StockClassification,
  StockMovement,
  WorkspaceSettings,
} from '../types';
import {
  buildRegistryFromProducts,
  detectBarcodeFormat,
  extractProductBarcodeRecords,
  findDuplicateBarcodeConflicts,
  lookupOpenFoodFactsV3,
  normalizeBarcodeString,
  resolveFromRegistryAndProducts,
  toBarcodeDocId,
} from '../utils/barcodeRegistry';
import {
  BUSINESS_TIMEZONE,
  clampNumber,
  generateId,
  generateInviteCode,
  sanitizeString,
  todayIso,
} from '../utils/format';
import {
  buildAdjustmentPlan,
  buildBatchPreparationPlan,
  buildCheckoutPlan,
  buildOpeningStockPlan,
  buildPartialReturnPlan,
  buildPurchasePlan,
  buildStockCountPlan,
  buildVoidPlan,
  normalizeIngredient,
  normalizeProduct,
  normalizeSale,
  normalizeSettings,
  normalizeStockMovement,
  type BatchPrepMode,
  type PartialReturnRequest,
  type StockShortage,
} from '../utils/inventoryEngine';
import {
  createInitialSettings,
  createSeedData,
  getEnhancedSampleAdditions,
} from '../utils/seedData';

const LOCAL_STORAGE_KEY = 'juiceflow_store_v1';
const SAMPLE_PACK_MIGRATION_KEY = 'juiceflow_sample_pack_v2_migrated';

interface LocalSnapshot {
  settings: WorkspaceSettings;
  ingredients: Ingredient[];
  products: Product[];
  barcodeRegistry: BarcodeRegistryRecord[];
  sales: Sale[];
  expenses: Expense[];
  purchases: PurchaseRecord[];
  stockMovements: StockMovement[];
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function normalizeBarcodeRecord(
  raw: Partial<BarcodeRegistryRecord> & { id?: string }
): BarcodeRegistryRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const code = normalizeBarcodeString(typeof raw.code === 'string' ? raw.code : '');
  const productId = typeof raw.productId === 'string' ? raw.productId.trim() : '';
  if (!code || !productId) return null;
  return {
    id: String(raw.id || toBarcodeDocId(code)),
    code,
    format: raw.format || detectBarcodeFormat(code),
    productId,
    ...(raw.variantId ? { variantId: String(raw.variantId) } : {}),
    packagingType: raw.packagingType || 'unit',
    label: String(raw.label || 'Unit'),
    unitsPerScan: Math.max(1, Math.round(Number(raw.unitsPerScan) || 1)),
    active: raw.active !== false,
    source: raw.source || 'manufacturer',
    ...(raw.createdAt ? { createdAt: String(raw.createdAt) } : {}),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
  };
}

function loadLocalSnapshot(): LocalSnapshot {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalSnapshot>;
      if (parsed.settings && Array.isArray(parsed.ingredients) && Array.isArray(parsed.products)) {
        const settings = normalizeSettings(parsed.settings, createInitialSettings());
        let ingredients = parsed.ingredients
          .filter((i): i is Ingredient => Boolean(i && typeof i === 'object' && i.id))
          .map((i) => normalizeIngredient(i));
        let products = parsed.products
          .filter((p): p is Product => Boolean(p && typeof p === 'object' && p.id))
          .map((p) => normalizeProduct(p));
        const sales = Array.isArray(parsed.sales)
          ? parsed.sales
              .filter((s): s is Sale => Boolean(s && typeof s === 'object' && s.id))
              .map((s) => normalizeSale(s))
          : [];
        const expenses = Array.isArray(parsed.expenses)
          ? parsed.expenses.filter((e): e is Expense => Boolean(e && typeof e === 'object' && e.id))
          : [];
        const purchases = Array.isArray(parsed.purchases)
          ? parsed.purchases.filter((p): p is PurchaseRecord => Boolean(p && typeof p === 'object' && p.id))
          : [];
        const stockMovements = Array.isArray(parsed.stockMovements)
          ? parsed.stockMovements
              .filter((m): m is StockMovement => Boolean(m && typeof m === 'object' && m.id))
              .map((m) => normalizeStockMovement(m))
          : [];

        // Preserve 100% of existing data & append sample packaged/prepared items once
        let alreadyMigrated = false;
        try {
          alreadyMigrated = localStorage.getItem(SAMPLE_PACK_MIGRATION_KEY) === 'true';
        } catch {
          alreadyMigrated = false;
        }

        if (!alreadyMigrated) {
          const additions = getEnhancedSampleAdditions();
          const existingIngIds = new Set(ingredients.map((i) => i.id));
          const existingProdIds = new Set(products.map((p) => p.id));

          const newIngs = additions.ingredients.filter((i) => !existingIngIds.has(i.id));
          const newProds = additions.products.filter((p) => !existingProdIds.has(p.id));
          if (newIngs.length > 0) ingredients = [...ingredients, ...newIngs];
          if (newProds.length > 0) products = [...products, ...newProds];

          try {
            localStorage.setItem(SAMPLE_PACK_MIGRATION_KEY, 'true');
          } catch {
            // Ignore storage errors
          }
        }

        const parsedRegistry = Array.isArray(parsed.barcodeRegistry)
          ? parsed.barcodeRegistry
              .map((rec) => normalizeBarcodeRecord(rec))
              .filter((rec): rec is BarcodeRegistryRecord => rec !== null)
          : [];

        const barcodeRegistry =
          parsedRegistry.length > 0 ? parsedRegistry : buildRegistryFromProducts(products);

        return {
          settings,
          ingredients,
          products,
          barcodeRegistry,
          sales,
          expenses,
          purchases,
          stockMovements,
        };
      }
    }
  } catch {
    // Fallback to clean seed data
  }
  try {
    localStorage.setItem(SAMPLE_PACK_MIGRATION_KEY, 'true');
  } catch {
    // Ignore
  }
  const seed = createSeedData();
  return {
    settings: createInitialSettings(),
    barcodeRegistry: buildRegistryFromProducts(seed.products),
    ...seed,
  };
}

function tsToIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

function isOfflineNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code?: unknown }).code || '');
    return code === 'unavailable' || code === 'failed-precondition';
  }
  return false;
}

export interface RecordSaleInput {
  clientTxId?: string;
  items: { productId: string; variantId?: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  cash_received_usd?: number | null;
  cash_received_khr?: number | null;
  exchange_rate_used?: number | null;
  change_given_khr?: number | null;
  customerName: string;
  note: string;
  saleDate?: string;
}

export interface SaleOperationResult {
  ok: boolean;
  sale?: Sale;
  idempotentDuplicate?: boolean;
  shortages?: StockShortage[];
  error?: string;
}

export interface OperationResult {
  ok: boolean;
  shortages?: StockShortage[];
  error?: string;
}

export interface SaveProductResult {
  ok: boolean;
  product?: Product;
  error?: string;
}

export interface RecordPurchaseInput {
  ingredientId: string;
  addedQty: number;
  totalCostKhr: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  note: string;
  purchaseDate?: string;
}

export interface RecordStockPurchaseInput {
  itemId: string;
  itemClassification: StockClassification;
  quantity: number;
  packCount?: number;
  unitsPerPack?: number;
  totalCostKhr: number;
  paymentMethod: PaymentMethod;
  supplier: string;
  barcodeScanned?: string;
  note: string;
  purchaseDate?: string;
}

export interface RecordOpeningStockInput {
  itemId: string;
  itemClassification: StockClassification;
  quantity: number;
  unitCostKhr: number;
  note?: string;
  movementDate?: string;
}

export interface PrepareBatchStockInput {
  productId: string;
  batchQty: number;
  mode: BatchPrepMode;
  directUnitCostKhr?: number;
  note?: string;
  movementDate?: string;
}

export interface RecordStockCountInput {
  itemId: string;
  itemClassification: StockClassification;
  countedQty: number;
  note?: string;
  movementDate?: string;
}

export interface RecordStockAdjustmentInput {
  itemId: string;
  itemClassification: StockClassification;
  movementType: Extract<MovementType, 'adjustment' | 'damaged' | 'expired'>;
  deltaQty: number;
  note?: string;
  movementDate?: string;
}

export interface ReturnSaleItemsInput {
  saleId: string;
  returnItems: PartialReturnRequest[];
  reason?: string;
}

export interface CloudAuthResult {
  ok: boolean;
  errorCode?: string;
  error?: string;
  redirected?: boolean;
}

export interface StoreContextValue {
  settings: WorkspaceSettings;
  ingredients: Ingredient[];
  products: Product[];
  barcodeRegistry: BarcodeRegistryRecord[];
  sales: Sale[];
  expenses: Expense[];
  purchases: PurchaseRecord[];
  stockMovements: StockMovement[];
  user: User | null;
  authReady: boolean;
  cloudSynced: boolean;
  syncing: boolean;
  refreshing: boolean;
  refreshData: () => Promise<OperationResult>;
  rememberMe: boolean;
  setRememberMe: (value: boolean) => void;
  t: ReturnType<typeof getTranslations>;
  setLanguage: (lang: AppLanguage) => void;
  setActiveOperator: (name: string) => void;
  updateSettings: (patch: Partial<WorkspaceSettings>) => Promise<void>;
  saveProduct: (
    product: Omit<Product, 'id'> & { id?: string; barcodeSource?: BarcodeSource }
  ) => Promise<SaveProductResult>;
  deleteProduct: (productId: string) => Promise<void>;
  lookupBarcode: (
    rawCode: string,
    options?: { skipExternal?: boolean }
  ) => Promise<BarcodeResolutionResult>;
  saveIngredient: (ingredient: Omit<Ingredient, 'id'> & { id?: string }) => Promise<void>;
  deleteIngredient: (ingredientId: string) => Promise<void>;
  recordIngredientPurchase: (input: RecordPurchaseInput) => Promise<OperationResult>;
  recordStockPurchase: (input: RecordStockPurchaseInput) => Promise<OperationResult>;
  recordOpeningStock: (input: RecordOpeningStockInput) => Promise<OperationResult>;
  prepareBatchStock: (input: PrepareBatchStockInput) => Promise<OperationResult>;
  recordStockCount: (input: RecordStockCountInput) => Promise<OperationResult>;
  recordStockAdjustment: (input: RecordStockAdjustmentInput) => Promise<OperationResult>;
  adjustIngredientStock: (ingredientId: string, deltaQty: number, note: string) => Promise<OperationResult>;
  recordSale: (input: RecordSaleInput) => Promise<SaleOperationResult>;
  voidSale: (saleId: string, reason?: string) => Promise<OperationResult>;
  returnSaleItems: (input: ReturnSaleItemsInput) => Promise<SaleOperationResult>;
  saveExpense: (
    expense: Omit<Expense, 'id' | 'createdAt' | 'recordedBy' | 'linkedIngredientId'> & {
      id?: string;
      linkedIngredientId?: string;
      recordedBy?: string;
    }
  ) => Promise<void>;
  deleteExpense: (expenseId: string) => Promise<void>;
  startQuickCloudSync: () => Promise<CloudAuthResult>;
  signInWithGoogle: () => Promise<CloudAuthResult>;
  signOutGoogle: () => Promise<void>;
  joinWorkspaceByCode: (code: string) => Promise<CloudAuthResult>;
  exportJsonBackup: () => string;
  importJsonBackup: (jsonText: string) => { ok: boolean; error?: string };
  resetDemoData: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function productToFirestoreFields(clean: Product) {
  return stripUndefined({
    name: sanitizeString(clean.name, 100),
    nameVi: sanitizeString(clean.nameVi || clean.name, 100),
    brand: sanitizeString(clean.brand || '', 80),
    category: clean.category,
    productType: clean.productType,
    priceKhr: clampNumber(clean.priceKhr, 0, 100000000),
    costPriceKhr: clampNumber(clean.costPriceKhr, 0, 100000000),
    ...(clean.markupPercent !== undefined
      ? { markupPercent: clampNumber(clean.markupPercent, 0, 10000) }
      : {}),
    manualPriceOverride: Boolean(clean.manualPriceOverride),
    imageUrl: sanitizeString(clean.imageUrl, 200000),
    active: Boolean(clean.active),
    barcode: sanitizeString(clean.barcode || '', 64),
    packagingBarcodes: (clean.packagingBarcodes || []).slice(0, 10).map((pb) => ({
      barcode: sanitizeString(pb.barcode, 64),
      label: sanitizeString(pb.label, 60),
      unitsPerPack: clampNumber(Math.round(pb.unitsPerPack), 1, 10000),
    })),
    stockQty: clampNumber(clean.stockQty, -1000000, 100000000),
    reorderLevel: clampNumber(clean.reorderLevel, 0, 100000000),
    unit: clean.unit || 'pcs',
    supplier: sanitizeString(clean.supplier || '', 100),
    recipe: (clean.recipe || []).slice(0, 25).map((r) =>
      stripUndefined({
        ingredientId: r.ingredientId,
        quantity: clampNumber(r.quantity, 0.0001, 1000000),
        ...(r.unit ? { unit: r.unit } : {}),
      })
    ),
    recipeVersion: Math.max(1, Math.round(clean.recipeVersion || 1)),
    variants: (clean.variants || []).slice(0, 10).map((v) =>
      stripUndefined({
        id: sanitizeString(v.id, 64),
        name: sanitizeString(v.name, 60),
        nameVi: sanitizeString(v.nameVi || v.name, 60),
        priceKhr: clampNumber(v.priceKhr, 0, 100000000),
        ...(v.costPriceKhr !== undefined
          ? { costPriceKhr: clampNumber(v.costPriceKhr, 0, 100000000) }
          : {}),
        ...(v.barcode ? { barcode: sanitizeString(v.barcode, 64) } : {}),
        recipe: (v.recipe || []).slice(0, 25).map((r) =>
          stripUndefined({
            ingredientId: r.ingredientId,
            quantity: clampNumber(r.quantity, 0.0001, 1000000),
            ...(r.unit ? { unit: r.unit } : {}),
          })
        ),
        recipeVersion: Math.max(1, Math.round(v.recipeVersion || 1)),
      })
    ),
  });
}

function barcodeRecordToFirestoreDoc(
  rec: BarcodeRegistryRecord,
  workspaceId: string,
  memberUids: string[],
  createdByUid: string
) {
  return stripUndefined({
    workspaceId,
    memberUids,
    code: normalizeBarcodeString(rec.code),
    format: rec.format,
    productId: rec.productId,
    ...(rec.variantId ? { variantId: sanitizeString(rec.variantId, 64) } : {}),
    packagingType: rec.packagingType,
    label: sanitizeString(rec.label || 'Unit', 80),
    unitsPerScan: clampNumber(Math.round(rec.unitsPerScan || 1), 1, 10000),
    active: Boolean(rec.active),
    source: rec.source,
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function movementToFirestoreDoc(
  mov: StockMovement,
  workspaceId: string,
  memberUids: string[],
  createdByUid: string
) {
  return stripUndefined({
    workspaceId,
    memberUids,
    itemId: mov.itemId || mov.ingredientId,
    itemName: sanitizeString(mov.itemName || mov.ingredientName, 100),
    itemClassification: mov.itemClassification || 'ingredient',
    ingredientId: mov.ingredientId || mov.itemId || 'unknown',
    ingredientName: sanitizeString(mov.ingredientName || mov.itemName || 'Unknown', 100),
    movementType: mov.movementType,
    deltaQty: clampNumber(mov.deltaQty, -10000000, 10000000),
    unit: mov.unit,
    ...(mov.unitCostKhr !== undefined
      ? { unitCostKhr: clampNumber(mov.unitCostKhr, 0, 100000000) }
      : {}),
    totalCostKhr: clampNumber(mov.totalCostKhr, 0, 1000000000),
    referenceId: sanitizeString(mov.referenceId, 128),
    movementDate: mov.movementDate,
    note: sanitizeString(mov.note, 200),
    recordedBy: sanitizeString(mov.recordedBy, 80),
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
  });
}

function purchaseToFirestoreDoc(
  pur: PurchaseRecord,
  workspaceId: string,
  memberUids: string[],
  createdByUid: string
) {
  return stripUndefined({
    workspaceId,
    memberUids,
    purchaseDate: pur.purchaseDate,
    itemId: pur.itemId,
    itemName: sanitizeString(pur.itemName, 100),
    itemClassification: pur.itemClassification,
    quantity: clampNumber(pur.quantity, 0.0001, 10000000),
    ...(pur.packCount !== undefined ? { packCount: clampNumber(pur.packCount, 0, 100000) } : {}),
    ...(pur.unitsPerPack !== undefined
      ? { unitsPerPack: clampNumber(pur.unitsPerPack, 1, 10000) }
      : {}),
    unit: pur.unit,
    totalCostKhr: clampNumber(pur.totalCostKhr, 0, 1000000000),
    unitCostKhr: clampNumber(pur.unitCostKhr, 0, 100000000),
    paymentMethod: pur.paymentMethod,
    supplier: sanitizeString(pur.supplier, 100),
    ...(pur.barcodeScanned ? { barcodeScanned: sanitizeString(pur.barcodeScanned, 64) } : {}),
    note: sanitizeString(pur.note, 200),
    recordedBy: sanitizeString(pur.recordedBy, 80),
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
  });
}

function saleToFirestoreDoc(
  sale: Sale,
  workspaceId: string,
  memberUids: string[],
  createdByUid: string
) {
  return stripUndefined({
    workspaceId,
    memberUids,
    clientTxId: sanitizeString(sale.clientTxId || sale.id, 128),
    orderNumber: sanitizeString(sale.orderNumber, 32),
    saleDate: sale.saleDate,
    items: sale.items.slice(0, 40),
    subtotalKhr: clampNumber(sale.subtotalKhr ?? sale.totalKhr, 0, 1000000000),
    totalKhr: clampNumber(sale.totalKhr, 0, 1000000000),
    refundedKhr: clampNumber(sale.refundedKhr ?? 0, 0, sale.totalKhr),
    netTotalKhr: clampNumber(sale.netTotalKhr ?? sale.totalKhr, 0, sale.totalKhr),
    cogsKhr: clampNumber(sale.cogsKhr, 0, 1000000000),
    refundedCogsKhr: clampNumber(sale.refundedCogsKhr ?? 0, 0, sale.cogsKhr),
    paymentMethod: sale.paymentMethod,
    cash_received_usd:
      sale.paymentMethod === 'cash' &&
      sale.cash_received_usd !== undefined &&
      sale.cash_received_usd !== null
        ? clampNumber(sale.cash_received_usd, 0, 1000000)
        : null,
    cash_received_khr:
      sale.paymentMethod === 'cash' &&
      sale.cash_received_khr !== undefined &&
      sale.cash_received_khr !== null
        ? clampNumber(Math.round(sale.cash_received_khr), 0, 1000000000)
        : null,
    exchange_rate_used:
      sale.paymentMethod === 'cash' &&
      sale.exchange_rate_used !== undefined &&
      sale.exchange_rate_used !== null
        ? clampNumber(Math.round(sale.exchange_rate_used), 1, 100000)
        : null,
    change_given_khr:
      sale.paymentMethod === 'cash' &&
      sale.change_given_khr !== undefined &&
      sale.change_given_khr !== null
        ? clampNumber(Math.round(sale.change_given_khr), 0, 1000000000)
        : null,
    customerName: sanitizeString(sale.customerName, 80),
    note: sanitizeString(sale.note, 200),
    recordedBy: sanitizeString(sale.recordedBy, 80),
    status: sale.status,
    returns: (sale.returns || []).slice(0, 20),
    ...(sale.voidedAt ? { voidedAt: sale.voidedAt } : {}),
    ...(sale.voidedBy ? { voidedBy: sanitizeString(sale.voidedBy, 80) } : {}),
    ...(sale.voidReason ? { voidReason: sanitizeString(sale.voidReason, 200) } : {}),
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(() => loadLocalSnapshot(), []);

  const [settings, setSettings] = useState<WorkspaceSettings>(initial.settings);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial.ingredients);
  const [products, setProducts] = useState<Product[]>(initial.products);
  const [barcodeRegistry, setBarcodeRegistry] = useState<BarcodeRegistryRecord[]>(
    initial.barcodeRegistry
  );
  const [sales, setSales] = useState<Sale[]>(initial.sales);
  const [expenses, setExpenses] = useState<Expense[]>(initial.expenses);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(initial.purchases);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(initial.stockMovements);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState<string | null>(null);
  const [memberUids, setMemberUids] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rememberMe, setRememberMeState] = useState<boolean>(() => loadRememberMePreference());

  const setRememberMe = useCallback((value: boolean) => {
    setRememberMeState(value);
    saveRememberMePreference(value);
    void applyAuthPersistence(value);
  }, []);

  const pendingDirectJoinRef = useRef(false);

  const latestRef = useRef({
    settings,
    ingredients,
    products,
    barcodeRegistry,
    sales,
    expenses,
    purchases,
    stockMovements,
    memberUids,
  });

  latestRef.current = {
    settings,
    ingredients,
    products,
    barcodeRegistry,
    sales,
    expenses,
    purchases,
    stockMovements,
    memberUids,
  };

  // Persist offline-first snapshot to localStorage on every state update
  useEffect(() => {
    try {
      const snapshot: LocalSnapshot = {
        settings,
        ingredients,
        products,
        barcodeRegistry,
        sales,
        expenses,
        purchases,
        stockMovements,
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage quota errors
    }
  }, [settings, ingredients, products, barcodeRegistry, sales, expenses, purchases, stockMovements]);

  // Listen to Firebase Auth state & resolve any pending redirect sign-in
  useEffect(() => {
    void checkPendingRedirectResult();
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setCloudWorkspaceId(null);
        setMemberUids([]);
      }
    });
    return () => unsub();
  }, []);

  // Provision or load Cloud Family Workspace when authenticated
  useEffect(() => {
    if (!authReady || !isAllowedCloudUser(user) || !user) return;
    if (pendingDirectJoinRef.current) return;
    try {
      if (sessionStorage.getItem(PENDING_JOIN_STORAGE_KEY)) return;
    } catch {
      // Ignore sessionStorage read errors
    }
    let cancelled = false;

    const bootstrapWorkspace = async () => {
      setSyncing(true);
      const userPath = `users/${user.uid}`;
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;

        if (userSnap.exists()) {
          const data = userSnap.data();
          if (typeof data.workspaceId === 'string' && data.workspaceId.length > 0) {
            setCloudWorkspaceId(data.workspaceId);
            setSyncing(false);
            return;
          }
        }

        // First-time sign-in: create shared family workspace and upload local records atomically
        const wsId = generateId('ws');
        const inviteCode = generateInviteCode();
        const cur = latestRef.current;
        const displayName = sanitizeString(
          user.displayName || user.email?.split('@')[0] || cur.settings.activeOperator || 'Family Member',
          100
        );
        const familyList = cur.settings.familyMembers.includes(displayName)
          ? cur.settings.familyMembers.slice(0, 10)
          : [displayName, ...cur.settings.familyMembers].slice(0, 10);

        const batch = writeBatch(db);
        const uids = [user.uid];

        batch.set(doc(db, 'workspaces', wsId), {
          name: sanitizeString(cur.settings.name || 'JuiceFlow Family Bar', 100),
          location: sanitizeString(cur.settings.location || 'Phnom Penh, Cambodia', 120),
          inviteCode,
          ownerId: user.uid,
          memberUids: uids,
          currency: 'KHR',
          usdRate: clampNumber(cur.settings.usdRate, 1, 100000),
          posExchangeRate: clampNumber(cur.settings.posExchangeRate ?? 4000, 1, 100000),
          language: cur.settings.language === 'vi' ? 'vi' : 'en',
          familyMembers: familyList,
          lowStockDefault: clampNumber(cur.settings.lowStockDefault, 0, 1000000),
          allowNegativeStock: Boolean(cur.settings.allowNegativeStock),
          enableOpenFoodFactsLookup: cur.settings.enableOpenFoodFactsLookup !== false,
          timezone: cur.settings.timezone || BUSINESS_TIMEZONE,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'workspaces', wsId, 'members', user.uid), {
          uid: user.uid,
          displayName,
          inviteCode,
          joinedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'workspaceInvites', inviteCode), {
          inviteCode,
          workspaceId: wsId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });

        batch.set(doc(db, 'users', user.uid), {
          uid: user.uid,
          displayName,
          workspaceId: wsId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        if (cancelled) return;

        // Seed existing local records into the newly created cloud workspace
        const seedBatch = writeBatch(db);
        for (const ing of cur.ingredients) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'ingredients', ing.id), {
            workspaceId: wsId,
            memberUids: uids,
            name: sanitizeString(ing.name, 100),
            nameVi: sanitizeString(ing.nameVi, 100),
            unit: ing.unit,
            stockQty: clampNumber(ing.stockQty, -1000000, 100000000),
            reorderLevel: clampNumber(ing.reorderLevel, 0, 100000000),
            unitCostKhr: clampNumber(ing.unitCostKhr, 0, 100000000),
            supplier: sanitizeString(ing.supplier, 100),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const prod of cur.products) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'products', prod.id), {
            workspaceId: wsId,
            memberUids: uids,
            ...productToFirestoreFields(prod),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          for (const rec of extractProductBarcodeRecords(prod)) {
            seedBatch.set(
              doc(db, 'workspaces', wsId, 'barcodes', rec.id),
              barcodeRecordToFirestoreDoc(rec, wsId, uids, user.uid)
            );
          }
        }
        for (const sale of cur.sales) {
          seedBatch.set(
            doc(db, 'workspaces', wsId, 'sales', sale.id),
            saleToFirestoreDoc({ ...sale, status: 'completed' }, wsId, uids, user.uid)
          );
        }
        for (const exp of cur.expenses) {
          seedBatch.set(doc(db, 'workspaces', wsId, 'expenses', exp.id), {
            workspaceId: wsId,
            memberUids: uids,
            expenseDate: exp.expenseDate,
            title: sanitizeString(exp.title, 120),
            category: exp.category,
            scope: exp.scope,
            amountKhr: clampNumber(exp.amountKhr, 0, 1000000000),
            paymentMethod: exp.paymentMethod,
            vendor: sanitizeString(exp.vendor, 100),
            note: sanitizeString(exp.note, 200),
            linkedIngredientId: sanitizeString(exp.linkedIngredientId, 128),
            isInventoryPurchase: Boolean(exp.isInventoryPurchase),
            recordedBy: sanitizeString(exp.recordedBy, 80),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const pur of cur.purchases) {
          seedBatch.set(
            doc(db, 'workspaces', wsId, 'purchases', pur.id),
            purchaseToFirestoreDoc(pur, wsId, uids, user.uid)
          );
        }
        for (const mov of cur.stockMovements) {
          seedBatch.set(
            doc(db, 'workspaces', wsId, 'stockMovements', mov.id),
            movementToFirestoreDoc(mov, wsId, uids, user.uid)
          );
        }
        await seedBatch.commit();

        if (!cancelled) {
          setCloudWorkspaceId(wsId);
          setMemberUids(uids);
          setSyncing(false);
        }
      } catch (err) {
        if (!cancelled) {
          setSyncing(false);
          handleFirestoreError(err, OperationType.WRITE, userPath);
        }
      }
    };

    bootstrapWorkspace();
    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  // Attach real-time Firestore listeners when authenticated & workspace loaded
  useEffect(() => {
    if (!authReady || !user || !cloudWorkspaceId) return;

    const wsRef = doc(db, 'workspaces', cloudWorkspaceId);
    const unsubWs = onSnapshot(
      wsRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const uids = Array.isArray(d.memberUids) ? (d.memberUids as string[]) : [user.uid];
        setMemberUids(uids);
        setSettings((prev) =>
          normalizeSettings(
            {
              ...prev,
              workspaceId: cloudWorkspaceId,
              inviteCode: String(d.inviteCode || prev.inviteCode),
              name: String(d.name || prev.name),
              location: String(d.location ?? prev.location),
              currency: 'KHR',
              usdRate: Number(d.usdRate) || prev.usdRate,
              posExchangeRate:
                d.posExchangeRate !== undefined && Number(d.posExchangeRate) > 0
                  ? Math.round(Number(d.posExchangeRate))
                  : prev.posExchangeRate ?? 4000,
              language: d.language === 'vi' ? 'vi' : 'en',
              familyMembers:
                Array.isArray(d.familyMembers) && d.familyMembers.length > 0
                  ? (d.familyMembers as string[])
                  : prev.familyMembers,
              lowStockDefault: Number(d.lowStockDefault ?? prev.lowStockDefault),
              allowNegativeStock: Boolean(d.allowNegativeStock ?? prev.allowNegativeStock ?? false),
              enableOpenFoodFactsLookup:
                d.enableOpenFoodFactsLookup !== undefined
                  ? Boolean(d.enableOpenFoodFactsLookup)
                  : prev.enableOpenFoodFactsLookup !== false,
              timezone: String(d.timezone || BUSINESS_TIMEZONE),
            },
            prev
          )
        );
      },
      (err) => handleFirestoreError(err, OperationType.GET, `workspaces/${cloudWorkspaceId}`)
    );

    const prodPath = `workspaces/${cloudWorkspaceId}/products`;
    const unsubProducts = onSnapshot(
      query(collection(db, prodPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Product[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return normalizeProduct({
            id: docSnap.id,
            ...d,
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          } as Partial<Product> & { id: string });
        });
        setProducts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, prodPath)
    );

    const ingPath = `workspaces/${cloudWorkspaceId}/ingredients`;
    const unsubIngredients = onSnapshot(
      query(collection(db, ingPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Ingredient[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return normalizeIngredient({
            id: docSnap.id,
            ...d,
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          } as Partial<Ingredient> & { id: string });
        });
        setIngredients(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, ingPath)
    );

    const salesPath = `workspaces/${cloudWorkspaceId}/sales`;
    const unsubSales = onSnapshot(
      query(collection(db, salesPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Sale[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return normalizeSale({
              id: docSnap.id,
              ...d,
              createdAt: tsToIso(d.createdAt),
            } as Partial<Sale> & { id: string });
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSales(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, salesPath)
    );

    const expPath = `workspaces/${cloudWorkspaceId}/expenses`;
    const unsubExpenses = onSnapshot(
      query(collection(db, expPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: Expense[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              expenseDate: String(d.expenseDate || todayIso()),
              title: String(d.title || ''),
              category: d.category as ExpenseCategory,
              scope: (d.scope === 'household' ? 'household' : 'business') as ExpenseScope,
              amountKhr: Number(d.amountKhr) || 0,
              paymentMethod: d.paymentMethod as PaymentMethod,
              vendor: String(d.vendor || ''),
              note: String(d.note || ''),
              linkedIngredientId: String(d.linkedIngredientId || ''),
              isInventoryPurchase: Boolean(d.isInventoryPurchase),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt));
        setExpenses(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, expPath)
    );

    const purPath = `workspaces/${cloudWorkspaceId}/purchases`;
    const unsubPurchases = onSnapshot(
      query(collection(db, purPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: PurchaseRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              purchaseDate: String(d.purchaseDate || todayIso()),
              itemId: String(d.itemId || ''),
              itemName: String(d.itemName || ''),
              itemClassification: d.itemClassification as StockClassification,
              quantity: Number(d.quantity) || 0,
              ...(d.packCount !== undefined ? { packCount: Number(d.packCount) } : {}),
              ...(d.unitsPerPack !== undefined ? { unitsPerPack: Number(d.unitsPerPack) } : {}),
              unit: d.unit,
              totalCostKhr: Number(d.totalCostKhr) || 0,
              unitCostKhr: Number(d.unitCostKhr) || 0,
              paymentMethod: d.paymentMethod as PaymentMethod,
              supplier: String(d.supplier || ''),
              ...(d.barcodeScanned ? { barcodeScanned: String(d.barcodeScanned) } : {}),
              note: String(d.note || ''),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt));
        setPurchases(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, purPath)
    );

    const movPath = `workspaces/${cloudWorkspaceId}/stockMovements`;
    const unsubMovements = onSnapshot(
      query(collection(db, movPath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: StockMovement[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return normalizeStockMovement({
              id: docSnap.id,
              ...d,
              createdAt: tsToIso(d.createdAt),
            } as Partial<StockMovement> & { id: string });
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setStockMovements(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, movPath)
    );

    const barcodePath = `workspaces/${cloudWorkspaceId}/barcodes`;
    const unsubBarcodes = onSnapshot(
      query(collection(db, barcodePath), where('memberUids', 'array-contains', user.uid)),
      (snap) => {
        const list: BarcodeRegistryRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            code: normalizeBarcodeString(String(d.code || '')),
            format: (d.format as BarcodeFormat) || detectBarcodeFormat(String(d.code || '')),
            productId: String(d.productId || ''),
            ...(d.variantId ? { variantId: String(d.variantId) } : {}),
            packagingType: (d.packagingType as BarcodePackagingType) || 'unit',
            label: String(d.label || 'Unit'),
            unitsPerScan: Math.max(1, Math.round(Number(d.unitsPerScan) || 1)),
            active: d.active !== false,
            source: (d.source as BarcodeSource) || 'manufacturer',
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          };
        });
        setBarcodeRegistry(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, barcodePath)
    );

    return () => {
      unsubWs();
      unsubProducts();
      unsubBarcodes();
      unsubIngredients();
      unsubSales();
      unsubExpenses();
      unsubPurchases();
      unsubMovements();
    };
  }, [authReady, user, cloudWorkspaceId]);

  // Propagate memberUids to existing subcollection docs whenever a new family member joins
  useEffect(() => {
    if (!user || !cloudWorkspaceId || memberUids.length <= 1) return;
    const propagateMembers = async () => {
      try {
        const cur = latestRef.current;
        const batch = writeBatch(db);
        let ops = 0;
        for (const p of cur.products) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', p.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const bc of cur.barcodeRegistry) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'barcodes', bc.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const ing of cur.ingredients) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ing.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const s of cur.sales) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'sales', s.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const e of cur.expenses) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', e.id), {
            memberUids,
            updatedAt: serverTimestamp(),
          });
          ops++;
        }
        for (const pur of cur.purchases) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'purchases', pur.id), {
            memberUids,
          });
          ops++;
        }
        for (const m of cur.stockMovements) {
          batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', m.id), {
            memberUids,
          });
          ops++;
        }
        if (ops > 0 && ops < 450) {
          await batch.commit();
        }
      } catch {
        // Non-fatal background sync
      }
    };
    propagateMembers();
  }, [memberUids.length, user, cloudWorkspaceId]);

  const activeMemberUids = useCallback((): string[] => {
    if (!user) return [];
    return memberUids.includes(user.uid) ? memberUids : [user.uid, ...memberUids].slice(0, 10);
  }, [user, memberUids]);

  const setLanguage = useCallback(
    (lang: AppLanguage) => {
      setSettings((prev) => ({ ...prev, language: lang }));
      if (user && cloudWorkspaceId) {
        updateDoc(doc(db, 'workspaces', cloudWorkspaceId), {
          language: lang,
          updatedAt: serverTimestamp(),
        }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `workspaces/${cloudWorkspaceId}`));
      }
    },
    [user, cloudWorkspaceId]
  );

  const setActiveOperator = useCallback((name: string) => {
    setSettings((prev) => ({ ...prev, activeOperator: name }));
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<WorkspaceSettings>) => {
      const next: WorkspaceSettings = {
        ...latestRef.current.settings,
        ...patch,
      };
      setSettings(next);
      if (user && cloudWorkspaceId) {
        const wsPath = `workspaces/${cloudWorkspaceId}`;
        try {
          await updateDoc(doc(db, 'workspaces', cloudWorkspaceId), {
            name: sanitizeString(next.name || 'JuiceFlow', 100),
            location: sanitizeString(next.location, 120),
            usdRate: clampNumber(next.usdRate, 1, 100000),
            posExchangeRate: clampNumber(next.posExchangeRate ?? 4000, 1, 100000),
            language: next.language === 'vi' ? 'vi' : 'en',
            familyMembers: next.familyMembers.slice(0, 10),
            lowStockDefault: clampNumber(next.lowStockDefault, 0, 1000000),
            allowNegativeStock: Boolean(next.allowNegativeStock),
            enableOpenFoodFactsLookup: next.enableOpenFoodFactsLookup !== false,
            timezone: next.timezone || BUSINESS_TIMEZONE,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, wsPath);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const saveProduct = useCallback(
    async (
      input: Omit<Product, 'id'> & { id?: string; barcodeSource?: BarcodeSource }
    ): Promise<SaveProductResult> => {
      const { barcodeSource, ...productInput } = input;
      const isEdit = Boolean(productInput.id);
      const id = productInput.id || generateId('prod');
      const cur = latestRef.current;
      const existingProd = isEdit ? cur.products.find((p) => p.id === id) : undefined;

      // Prevent duplicate active barcode assignments across products, variants, and cartons
      const conflicts = findDuplicateBarcodeConflicts(
        {
          id,
          name: productInput.name,
          barcode: productInput.barcode,
          variants: productInput.variants,
          packagingBarcodes: productInput.packagingBarcodes,
        },
        cur.products,
        cur.barcodeRegistry
      );
      if (conflicts.length > 0) {
        const first = conflicts[0];
        const msg = first.isInternalDuplicate
          ? `Duplicate barcode "${first.code}" appears more than once on this product.`
          : `Barcode "${first.code}" is already assigned to "${first.existingProductName}"${
              first.existingVariantName ? ` (${first.existingVariantName})` : ''
            }.`;
        return { ok: false, error: msg };
      }

      // Increment recipeVersion whenever recipe changes on edit
      const recipeChanged =
        existingProd && JSON.stringify(existingProd.recipe) !== JSON.stringify(productInput.recipe);
      const nextRecipeVersion = recipeChanged
        ? (existingProd?.recipeVersion ?? 1) + 1
        : Math.max(1, productInput.recipeVersion ?? existingProd?.recipeVersion ?? 1);

      const clean = normalizeProduct({
        ...productInput,
        id,
        recipeVersion: nextRecipeVersion,
        updatedAt: new Date().toISOString(),
      });

      const nextBarcodeRecords = extractProductBarcodeRecords(clean, barcodeSource);
      const nextBarcodeIds = new Set(nextBarcodeRecords.map((r) => r.id));
      const previousProductRecords = cur.barcodeRegistry.filter((r) => r.productId === id);
      const removedBarcodeIds = previousProductRecords
        .filter((r) => !nextBarcodeIds.has(r.id))
        .map((r) => r.id);

      setProducts((prev) => (isEdit ? prev.map((p) => (p.id === id ? clean : p)) : [clean, ...prev]));
      setBarcodeRegistry((prev) => {
        const withoutThisProduct = prev.filter((r) => r.productId !== id && !nextBarcodeIds.has(r.id));
        return [...nextBarcodeRecords, ...withoutThisProduct];
      });

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/products/${id}`;
        const fields = productToFirestoreFields(clean);
        const uids = activeMemberUids();
        try {
          const batch = writeBatch(db);
          if (isEdit) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', id), {
              ...fields,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.set(doc(db, 'workspaces', cloudWorkspaceId, 'products', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: uids,
              ...fields,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          for (const removedId of removedBarcodeIds) {
            batch.delete(doc(db, 'workspaces', cloudWorkspaceId, 'barcodes', removedId));
          }

          const existingRegMap = new Map(cur.barcodeRegistry.map((r) => [r.id, r]));
          for (const rec of nextBarcodeRecords) {
            const existingRec = existingRegMap.get(rec.id);
            const bcRef = doc(db, 'workspaces', cloudWorkspaceId, 'barcodes', rec.id);
            if (existingRec && existingRec.productId === id) {
              batch.update(
                bcRef,
                stripUndefined({
                  format: rec.format,
                  productId: rec.productId,
                  ...(rec.variantId ? { variantId: sanitizeString(rec.variantId, 64) } : {}),
                  packagingType: rec.packagingType,
                  label: sanitizeString(rec.label || 'Unit', 80),
                  unitsPerScan: clampNumber(Math.round(rec.unitsPerScan || 1), 1, 10000),
                  active: Boolean(rec.active),
                  source: rec.source,
                  updatedAt: serverTimestamp(),
                })
              );
            } else {
              batch.set(bcRef, barcodeRecordToFirestoreDoc(rec, cloudWorkspaceId, uids, user.uid));
            }
          }

          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }

      return { ok: true, product: clean };
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteProduct = useCallback(
    async (productId: string) => {
      const removedBarcodes = latestRef.current.barcodeRegistry.filter(
        (r) => r.productId === productId
      );
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      setBarcodeRegistry((prev) => prev.filter((r) => r.productId !== productId));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/products/${productId}`;
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'workspaces', cloudWorkspaceId, 'products', productId));
          for (const rec of removedBarcodes) {
            batch.delete(doc(db, 'workspaces', cloudWorkspaceId, 'barcodes', rec.id));
          }
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const lookupBarcode = useCallback(
    async (
      rawCode: string,
      options?: { skipExternal?: boolean }
    ): Promise<BarcodeResolutionResult> => {
      const code = normalizeBarcodeString(rawCode);
      const format = detectBarcodeFormat(code);
      if (!code) {
        return {
          found: false,
          code: '',
          format,
          source: 'not_found',
          unitsPerScan: 1,
          externalPrefill: null,
          lookedUpExternally: false,
        };
      }

      const cur = latestRef.current;

      // Step 1: Always check JuiceFlow Firestore barcode registry FIRST
      if (user && cloudWorkspaceId) {
        const docId = toBarcodeDocId(code);
        try {
          const bcSnap = await getDoc(doc(db, 'workspaces', cloudWorkspaceId, 'barcodes', docId));
          if (bcSnap.exists()) {
            const d = bcSnap.data();
            const regRecord: BarcodeRegistryRecord = {
              id: bcSnap.id,
              code: normalizeBarcodeString(String(d.code || code)),
              format: (d.format as BarcodeFormat) || format,
              productId: String(d.productId || ''),
              ...(d.variantId ? { variantId: String(d.variantId) } : {}),
              packagingType: (d.packagingType as BarcodePackagingType) || 'unit',
              label: String(d.label || 'Unit'),
              unitsPerScan: Math.max(1, Math.round(Number(d.unitsPerScan) || 1)),
              active: d.active !== false,
              source: (d.source as BarcodeSource) || 'manufacturer',
              createdAt: tsToIso(d.createdAt),
              updatedAt: tsToIso(d.updatedAt),
            };
            const matchedProduct = cur.products.find((p) => p.id === regRecord.productId);
            if (matchedProduct) {
              const matchedVariant = regRecord.variantId
                ? matchedProduct.variants?.find((v) => v.id === regRecord.variantId)
                : undefined;
              return {
                found: true,
                code,
                format: regRecord.format,
                source: 'firestore_registry',
                product: matchedProduct,
                variant: matchedVariant,
                registryRecord: regRecord,
                unitsPerScan: regRecord.unitsPerScan,
                packagingType: regRecord.packagingType,
                packLabel: regRecord.label,
                externalPrefill: null,
                lookedUpExternally: false,
              };
            }
          }
        } catch {
          // Offline or transient read miss -> fall through to local registry
        }
      }

      // Step 2: Check local mirrored barcode registry & embedded product barcodes
      const localHit = resolveFromRegistryAndProducts(code, cur.barcodeRegistry, cur.products);
      if (localHit) {
        return {
          found: true,
          code: localHit.code,
          format: localHit.format,
          source: 'local_registry',
          product: localHit.product,
          variant: localHit.variant,
          registryRecord: localHit.registryRecord,
          unitsPerScan: localHit.unitsPerScan,
          packagingType: localHit.packagingType,
          packLabel: localHit.packLabel,
          externalPrefill: null,
          lookedUpExternally: false,
        };
      }

      // Step 3: Optional Open Food Facts API v3 external lookup (prefill metadata only)
      const allowExternal =
        !options?.skipExternal && cur.settings.enableOpenFoodFactsLookup !== false;
      if (allowExternal) {
        const prefill = await lookupOpenFoodFactsV3(code);
        if (prefill) {
          return {
            found: false,
            code,
            format,
            source: 'open_food_facts',
            unitsPerScan: 1,
            externalPrefill: prefill,
            lookedUpExternally: true,
          };
        }
        return {
          found: false,
          code,
          format,
          source: 'not_found',
          unitsPerScan: 1,
          externalPrefill: null,
          lookedUpExternally: true,
        };
      }

      return {
        found: false,
        code,
        format,
        source: 'not_found',
        unitsPerScan: 1,
        externalPrefill: null,
        lookedUpExternally: false,
      };
    },
    [user, cloudWorkspaceId]
  );

  const saveIngredient = useCallback(
    async (input: Omit<Ingredient, 'id'> & { id?: string }) => {
      const isEdit = Boolean(input.id);
      const id = input.id || generateId('ing');
      const clean: Ingredient = {
        id,
        name: sanitizeString(input.name, 100),
        nameVi: sanitizeString(input.nameVi || input.name, 100),
        unit: input.unit,
        stockQty: clampNumber(input.stockQty, -1000000, 100000000),
        reorderLevel: clampNumber(input.reorderLevel, 0, 100000000),
        unitCostKhr: clampNumber(input.unitCostKhr, 0, 100000000),
        supplier: sanitizeString(input.supplier, 100),
        updatedAt: new Date().toISOString(),
      };

      setIngredients((prev) => (isEdit ? prev.map((i) => (i.id === id ? clean : i)) : [clean, ...prev]));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/ingredients/${id}`;
        try {
          if (isEdit) {
            await updateDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', id), {
              name: clean.name,
              nameVi: clean.nameVi,
              unit: clean.unit,
              stockQty: clean.stockQty,
              reorderLevel: clean.reorderLevel,
              unitCostKhr: clean.unitCostKhr,
              supplier: clean.supplier,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: activeMemberUids(),
              name: clean.name,
              nameVi: clean.nameVi,
              unit: clean.unit,
              stockQty: clean.stockQty,
              reorderLevel: clean.reorderLevel,
              unitCostKhr: clean.unitCostKhr,
              supplier: clean.supplier,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteIngredient = useCallback(
    async (ingredientId: string) => {
      setIngredients((prev) => prev.filter((i) => i.id !== ingredientId));
      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/ingredients/${ingredientId}`;
        try {
          await deleteDoc(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingredientId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  // Unified Stock-In / Purchase across Packaged, Ingredients, and Prepared Stock
  // Writes to `purchases` + `stockMovements` (NEVER creates a duplicate operating Expense!)
  const recordStockPurchase = useCallback(
    async (input: RecordStockPurchaseInput): Promise<OperationResult> => {
      const cur = latestRef.current;
      const plan = buildPurchasePlan({
        itemId: input.itemId,
        itemClassification: input.itemClassification,
        quantity: input.quantity,
        packCount: input.packCount,
        unitsPerPack: input.unitsPerPack,
        totalCostKhr: input.totalCostKhr,
        paymentMethod: input.paymentMethod,
        supplier: input.supplier,
        barcodeScanned: input.barcodeScanned,
        note: input.note,
        recordedBy: cur.settings.activeOperator || 'Family',
        purchaseDate: input.purchaseDate,
        products: cur.products,
        ingredients: cur.ingredients,
      });

      if (!plan.ok || !plan.purchase || !plan.movement) {
        return { ok: false, error: plan.error || 'Could not record purchase.' };
      }

      if (plan.updatedIngredient) {
        const updated = plan.updatedIngredient;
        setIngredients((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      if (plan.updatedProduct) {
        const updated = plan.updatedProduct;
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setPurchases((prev) => [plan.purchase!, ...prev]);
      setStockMovements((prev) => [plan.movement!, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const colName = input.itemClassification === 'ingredient' ? 'ingredients' : 'products';
        const path = `workspaces/${cloudWorkspaceId}/${colName}/${input.itemId}`;
        try {
          const batch = writeBatch(db);
          if (plan.updatedIngredient) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', plan.updatedIngredient.id), {
              stockQty: plan.updatedIngredient.stockQty,
              unitCostKhr: plan.updatedIngredient.unitCostKhr,
              supplier: plan.updatedIngredient.supplier,
              updatedAt: serverTimestamp(),
            });
          } else if (plan.updatedProduct) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', plan.updatedProduct.id), {
              stockQty: plan.updatedProduct.stockQty,
              costPriceKhr: plan.updatedProduct.costPriceKhr,
              supplier: plan.updatedProduct.supplier,
              updatedAt: serverTimestamp(),
            });
          }
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'purchases', plan.purchase.id),
            purchaseToFirestoreDoc(plan.purchase, cloudWorkspaceId, uids, user.uid)
          );
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', plan.movement.id),
            movementToFirestoreDoc(plan.movement, cloudWorkspaceId, uids, user.uid)
          );
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      return { ok: true };
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Backward-compatible wrapper for legacy callers
  const recordIngredientPurchase = useCallback(
    async (input: RecordPurchaseInput): Promise<OperationResult> => {
      return recordStockPurchase({
        itemId: input.ingredientId,
        itemClassification: 'ingredient',
        quantity: input.addedQty,
        totalCostKhr: input.totalCostKhr,
        paymentMethod: input.paymentMethod,
        supplier: input.vendor,
        note: input.note,
        purchaseDate: input.purchaseDate,
      });
    },
    [recordStockPurchase]
  );

  // Opening Stock across all 3 tiers (Valuation only — NEVER an expense or cash outflow!)
  const recordOpeningStock = useCallback(
    async (input: RecordOpeningStockInput): Promise<OperationResult> => {
      const cur = latestRef.current;
      const plan = buildOpeningStockPlan({
        itemId: input.itemId,
        itemClassification: input.itemClassification,
        quantity: input.quantity,
        unitCostKhr: input.unitCostKhr,
        note: input.note,
        recordedBy: cur.settings.activeOperator || 'Family',
        movementDate: input.movementDate,
        products: cur.products,
        ingredients: cur.ingredients,
      });

      if (!plan.ok || !plan.movement) {
        return { ok: false, error: plan.error || 'Could not record opening stock.' };
      }

      if (plan.updatedIngredient) {
        const updated = plan.updatedIngredient;
        setIngredients((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      if (plan.updatedProduct) {
        const updated = plan.updatedProduct;
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setStockMovements((prev) => [plan.movement!, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const colName = input.itemClassification === 'ingredient' ? 'ingredients' : 'products';
        const path = `workspaces/${cloudWorkspaceId}/${colName}/${input.itemId}`;
        try {
          const batch = writeBatch(db);
          if (plan.updatedIngredient) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', plan.updatedIngredient.id), {
              stockQty: plan.updatedIngredient.stockQty,
              unitCostKhr: plan.updatedIngredient.unitCostKhr,
              updatedAt: serverTimestamp(),
            });
          } else if (plan.updatedProduct) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', plan.updatedProduct.id), {
              stockQty: plan.updatedProduct.stockQty,
              costPriceKhr: plan.updatedProduct.costPriceKhr,
              supplier: plan.updatedProduct.supplier,
              updatedAt: serverTimestamp(),
            });
          }
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', plan.movement.id),
            movementToFirestoreDoc(plan.movement, cloudWorkspaceId, uids, user.uid)
          );
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      return { ok: true };
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Prepared Stock Batch Preparation (Deduct Raw Ingredients OR Direct Add)
  const prepareBatchStock = useCallback(
    async (input: PrepareBatchStockInput): Promise<OperationResult> => {
      const cur = latestRef.current;
      const recordedBy = cur.settings.activeOperator || 'Family';

      const applyLocal = (): OperationResult => {
        const plan = buildBatchPreparationPlan({
          productId: input.productId,
          batchQty: input.batchQty,
          mode: input.mode,
          directUnitCostKhr: input.directUnitCostKhr,
          note: input.note,
          recordedBy,
          movementDate: input.movementDate,
          products: cur.products,
          ingredients: cur.ingredients,
          allowNegativeStock: Boolean(cur.settings.allowNegativeStock),
        });
        if (!plan.ok || !plan.updatedProduct || !plan.movements) {
          return { ok: false, error: plan.error, shortages: plan.shortages };
        }
        setProducts(plan.updatedProducts!);
        setIngredients(plan.updatedIngredients!);
        setStockMovements((prev) => [...plan.movements!, ...prev]);
        return { ok: true };
      };

      if (!user || !cloudWorkspaceId) {
        return applyLocal();
      }

      const uids = activeMemberUids();
      const prodPath = `workspaces/${cloudWorkspaceId}/products/${input.productId}`;
      try {
        let txResult: OperationResult = { ok: false };
        await runTransaction(db, async (tx) => {
          const prodRef = doc(db, 'workspaces', cloudWorkspaceId, 'products', input.productId);
          const prodSnap = await tx.get(prodRef);
          if (!prodSnap.exists()) {
            txResult = { ok: false, error: 'Prepared product not found.' };
            return;
          }
          const liveProd = normalizeProduct({
            id: prodSnap.id,
            ...prodSnap.data(),
          } as Partial<Product> & { id: string });

          const ingIds =
            input.mode === 'deduct_ingredients'
              ? Array.from(new Set((liveProd.recipe || []).map((r) => r.ingredientId)))
              : [];

          const liveIngredients: Ingredient[] = [];
          for (const ingId of ingIds) {
            const ingSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingId));
            if (ingSnap.exists()) {
              const d = ingSnap.data();
              liveIngredients.push({
                id: ingSnap.id,
                name: String(d.name || ''),
                nameVi: String(d.nameVi || ''),
                unit: d.unit,
                stockQty: Number(d.stockQty) || 0,
                reorderLevel: Number(d.reorderLevel) || 0,
                unitCostKhr: Number(d.unitCostKhr) || 0,
                supplier: String(d.supplier || ''),
              });
            }
          }

          const plan = buildBatchPreparationPlan({
            productId: liveProd.id,
            batchQty: input.batchQty,
            mode: input.mode,
            directUnitCostKhr: input.directUnitCostKhr,
            note: input.note,
            recordedBy,
            movementDate: input.movementDate,
            products: [liveProd],
            ingredients: liveIngredients,
            allowNegativeStock: Boolean(cur.settings.allowNegativeStock),
          });

          if (!plan.ok || !plan.updatedProduct || !plan.movements) {
            txResult = { ok: false, error: plan.error, shortages: plan.shortages };
            return;
          }

          tx.update(prodRef, {
            stockQty: plan.updatedProduct.stockQty,
            costPriceKhr: plan.updatedProduct.costPriceKhr,
            supplier: plan.updatedProduct.supplier,
            updatedAt: serverTimestamp(),
          });

          for (const ingId of plan.touchedIngredientIds || []) {
            const updatedIng = plan.updatedIngredients?.find((i) => i.id === ingId);
            if (!updatedIng) continue;
            tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', ingId), {
              stockQty: updatedIng.stockQty,
              updatedAt: serverTimestamp(),
            });
          }

          for (const mov of plan.movements) {
            tx.set(
              doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id),
              movementToFirestoreDoc(mov, cloudWorkspaceId, uids, user.uid)
            );
          }

          txResult = { ok: true };
        });

        return txResult;
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          return applyLocal();
        }
        handleFirestoreError(err, OperationType.WRITE, prodPath);
        return { ok: false, error: 'Failed to prepare batch stock.' };
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Physical Stock Count
  const recordStockCount = useCallback(
    async (input: RecordStockCountInput): Promise<OperationResult> => {
      const cur = latestRef.current;
      const plan = buildStockCountPlan({
        itemId: input.itemId,
        itemClassification: input.itemClassification,
        countedQty: input.countedQty,
        note: input.note,
        recordedBy: cur.settings.activeOperator || 'Family',
        movementDate: input.movementDate,
        products: cur.products,
        ingredients: cur.ingredients,
      });

      if (!plan.ok || !plan.movement) {
        return { ok: false, error: plan.error || 'Could not record stock count.' };
      }

      if (plan.updatedIngredient) {
        const updated = plan.updatedIngredient;
        setIngredients((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      if (plan.updatedProduct) {
        const updated = plan.updatedProduct;
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setStockMovements((prev) => [plan.movement!, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const colName = input.itemClassification === 'ingredient' ? 'ingredients' : 'products';
        const path = `workspaces/${cloudWorkspaceId}/${colName}/${input.itemId}`;
        try {
          const batch = writeBatch(db);
          if (plan.updatedIngredient) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', plan.updatedIngredient.id), {
              stockQty: plan.updatedIngredient.stockQty,
              updatedAt: serverTimestamp(),
            });
          } else if (plan.updatedProduct) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', plan.updatedProduct.id), {
              stockQty: plan.updatedProduct.stockQty,
              updatedAt: serverTimestamp(),
            });
          }
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', plan.movement.id),
            movementToFirestoreDoc(plan.movement, cloudWorkspaceId, uids, user.uid)
          );
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      return { ok: true };
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Manual Adjustment / Damaged / Expired write-off across all 3 tiers
  const recordStockAdjustment = useCallback(
    async (input: RecordStockAdjustmentInput): Promise<OperationResult> => {
      const cur = latestRef.current;
      const plan = buildAdjustmentPlan({
        itemId: input.itemId,
        itemClassification: input.itemClassification,
        movementType: input.movementType,
        deltaQty: input.deltaQty,
        note: input.note,
        recordedBy: cur.settings.activeOperator || 'Family',
        movementDate: input.movementDate,
        products: cur.products,
        ingredients: cur.ingredients,
        allowNegativeStock: Boolean(cur.settings.allowNegativeStock),
      });

      if (!plan.ok || !plan.movement) {
        return { ok: false, error: plan.error || 'Could not adjust stock.' };
      }

      if (plan.updatedIngredient) {
        const updated = plan.updatedIngredient;
        setIngredients((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      }
      if (plan.updatedProduct) {
        const updated = plan.updatedProduct;
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setStockMovements((prev) => [plan.movement!, ...prev]);

      if (user && cloudWorkspaceId) {
        const uids = activeMemberUids();
        const colName = input.itemClassification === 'ingredient' ? 'ingredients' : 'products';
        const path = `workspaces/${cloudWorkspaceId}/${colName}/${input.itemId}`;
        try {
          const batch = writeBatch(db);
          if (plan.updatedIngredient) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', plan.updatedIngredient.id), {
              stockQty: plan.updatedIngredient.stockQty,
              updatedAt: serverTimestamp(),
            });
          } else if (plan.updatedProduct) {
            batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', plan.updatedProduct.id), {
              stockQty: plan.updatedProduct.stockQty,
              updatedAt: serverTimestamp(),
            });
          }
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', plan.movement.id),
            movementToFirestoreDoc(plan.movement, cloudWorkspaceId, uids, user.uid)
          );
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }

      return { ok: true };
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Backward-compatible wrapper
  const adjustIngredientStock = useCallback(
    async (ingredientId: string, deltaQty: number, note: string): Promise<OperationResult> => {
      return recordStockAdjustment({
        itemId: ingredientId,
        itemClassification: 'ingredient',
        movementType: 'adjustment',
        deltaQty,
        note,
      });
    },
    [recordStockAdjustment]
  );

  // Atomic Concurrency-Safe Checkout (Firestore runTransaction online + deterministic idempotent offline fallback)
  const recordSale = useCallback(
    async (input: RecordSaleInput): Promise<SaleOperationResult> => {
      const cur = latestRef.current;
      const clientTxId = input.clientTxId || generateId('sale');
      const orderNumber = `JF-${String(1043 + cur.sales.length).padStart(4, '0')}`;
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const applyLocalCheckout = (queueOfflineBatch: boolean): SaleOperationResult => {
        const plan = buildCheckoutPlan({
          clientTxId,
          orderNumber,
          saleDate: input.saleDate,
          items: input.items,
          paymentMethod: input.paymentMethod,
          cash_received_usd: input.paymentMethod === 'cash' ? input.cash_received_usd ?? 0 : null,
          cash_received_khr: input.paymentMethod === 'cash' ? input.cash_received_khr ?? 0 : null,
          exchange_rate_used:
            input.paymentMethod === 'cash'
              ? input.exchange_rate_used ?? cur.settings.posExchangeRate ?? 4000
              : null,
          change_given_khr: input.paymentMethod === 'cash' ? input.change_given_khr : null,
          customerName: input.customerName,
          note: input.note,
          recordedBy: operator,
          products: cur.products,
          ingredients: cur.ingredients,
          existingSales: cur.sales,
          allowNegativeStock: Boolean(cur.settings.allowNegativeStock),
        });

        if (!plan.ok) {
          return { ok: false, error: plan.error, shortages: plan.shortages };
        }
        if (plan.idempotentDuplicate) {
          return { ok: true, idempotentDuplicate: true, sale: plan.sale };
        }

        setSales((prev) => [plan.sale!, ...prev]);
        setProducts(plan.updatedProducts!);
        setIngredients(plan.updatedIngredients!);
        if (plan.movements && plan.movements.length > 0) {
          setStockMovements((prev) => [...plan.movements!, ...prev]);
        }

        if (queueOfflineBatch && user && cloudWorkspaceId && plan.sale) {
          const uids = activeMemberUids();
          const batch = writeBatch(db);
          batch.set(
            doc(db, 'workspaces', cloudWorkspaceId, 'sales', plan.sale.id),
            saleToFirestoreDoc(plan.sale, cloudWorkspaceId, uids, user.uid)
          );
          for (const pid of plan.touchedProductIds || []) {
            const p = plan.updatedProducts?.find((x) => x.id === pid);
            if (p) {
              batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid), {
                stockQty: p.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const iid of plan.touchedIngredientIds || []) {
            const i = plan.updatedIngredients?.find((x) => x.id === iid);
            if (i) {
              batch.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid), {
                stockQty: i.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const mov of plan.movements || []) {
            batch.set(
              doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id),
              movementToFirestoreDoc(mov, cloudWorkspaceId, uids, user.uid)
            );
          }
          void batch.commit().catch(() => {
            // Firestore offline cache will retry on reconnect
          });
        }

        return { ok: true, sale: plan.sale };
      };

      if (!user || !cloudWorkspaceId) {
        return applyLocalCheckout(false);
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return applyLocalCheckout(true);
      }

      const uids = activeMemberUids();
      const salePath = `workspaces/${cloudWorkspaceId}/sales/${clientTxId}`;

      try {
        let txResult: SaleOperationResult = { ok: false, error: 'Checkout failed.' };

        await runTransaction(db, async (tx) => {
          // 1. Idempotency check on deterministic saleId = clientTxId
          const saleRef = doc(db, 'workspaces', cloudWorkspaceId, 'sales', clientTxId);
          const existingSaleSnap = await tx.get(saleRef);
          if (existingSaleSnap.exists()) {
            txResult = {
              ok: true,
              idempotentDuplicate: true,
              sale: normalizeSale({
                id: existingSaleSnap.id,
                ...existingSaleSnap.data(),
                createdAt: tsToIso(existingSaleSnap.data().createdAt),
              } as Partial<Sale> & { id: string }),
            };
            return;
          }

          // 2. Read authoritative workspace negative-stock policy
          const wsSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId));
          const allowNegativeStock = wsSnap.exists()
            ? Boolean(wsSnap.data().allowNegativeStock ?? cur.settings.allowNegativeStock ?? false)
            : Boolean(cur.settings.allowNegativeStock);

          // 3. Read all referenced products inside transaction
          const uniqueProdIds = Array.from(new Set(input.items.map((i) => i.productId)));
          const liveProducts: Product[] = [];
          const neededIngIds = new Set<string>();

          for (const pid of uniqueProdIds) {
            const pSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid));
            if (pSnap.exists()) {
              const norm = normalizeProduct({
                id: pSnap.id,
                ...pSnap.data(),
              } as Partial<Product> & { id: string });
              liveProducts.push(norm);
              if (norm.productType === 'PREPARED_TO_ORDER') {
                for (const r of norm.recipe || []) neededIngIds.add(r.ingredientId);
                for (const v of norm.variants || []) {
                  for (const r of v.recipe || []) neededIngIds.add(r.ingredientId);
                }
              }
            }
          }

          // 4. Read all referenced ingredients inside transaction (ALL reads BEFORE any writes!)
          const liveIngredients: Ingredient[] = [];
          for (const iid of neededIngIds) {
            const iSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid));
            if (iSnap.exists()) {
              const d = iSnap.data();
              liveIngredients.push({
                id: iSnap.id,
                name: String(d.name || ''),
                nameVi: String(d.nameVi || ''),
                unit: d.unit,
                stockQty: Number(d.stockQty) || 0,
                reorderLevel: Number(d.reorderLevel) || 0,
                unitCostKhr: Number(d.unitCostKhr) || 0,
                supplier: String(d.supplier || ''),
              });
            }
          }

          // 5. Run pure deterministic checkout planner against live server balances
          const plan = buildCheckoutPlan({
            clientTxId,
            orderNumber,
            saleDate: input.saleDate,
            items: input.items,
            paymentMethod: input.paymentMethod,
            cash_received_usd: input.paymentMethod === 'cash' ? input.cash_received_usd ?? 0 : null,
            cash_received_khr: input.paymentMethod === 'cash' ? input.cash_received_khr ?? 0 : null,
            exchange_rate_used:
              input.paymentMethod === 'cash'
                ? input.exchange_rate_used ?? cur.settings.posExchangeRate ?? 4000
                : null,
            change_given_khr: input.paymentMethod === 'cash' ? input.change_given_khr : null,
            customerName: input.customerName,
            note: input.note,
            recordedBy: operator,
            products: liveProducts,
            ingredients: liveIngredients,
            allowNegativeStock,
          });

          if (!plan.ok || !plan.sale) {
            txResult = { ok: false, error: plan.error, shortages: plan.shortages };
            return;
          }

          // 6. Atomic writes (sale + touched products + touched ingredients + stock movements)
          tx.set(saleRef, saleToFirestoreDoc(plan.sale, cloudWorkspaceId, uids, user.uid));

          for (const pid of plan.touchedProductIds || []) {
            const updatedProd = plan.updatedProducts?.find((p) => p.id === pid);
            if (!updatedProd) continue;
            tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid), {
              stockQty: updatedProd.stockQty,
              updatedAt: serverTimestamp(),
            });
          }

          for (const iid of plan.touchedIngredientIds || []) {
            const updatedIng = plan.updatedIngredients?.find((i) => i.id === iid);
            if (!updatedIng) continue;
            tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid), {
              stockQty: updatedIng.stockQty,
              updatedAt: serverTimestamp(),
            });
          }

          for (const mov of plan.movements || []) {
            tx.set(
              doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id),
              movementToFirestoreDoc(mov, cloudWorkspaceId, uids, user.uid)
            );
          }

          txResult = { ok: true, sale: plan.sale };
        });

        return txResult;
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          return applyLocalCheckout(true);
        }
        handleFirestoreError(err, OperationType.WRITE, salePath);
        return { ok: false, error: 'Checkout failed while syncing to cloud.' };
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Atomic Void (Restores EXACT original deduction snapshot — NEVER recalculates from edited recipes!)
  const voidSale = useCallback(
    async (saleId: string, reason?: string): Promise<OperationResult> => {
      const cur = latestRef.current;
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const applyLocal = (): OperationResult => {
        const target = cur.sales.find((s) => s.id === saleId);
        if (!target) return { ok: false, error: 'Order not found.' };
        const plan = buildVoidPlan({
          sale: target,
          stockMovements: cur.stockMovements,
          products: cur.products,
          ingredients: cur.ingredients,
          recordedBy: operator,
          reason,
        });
        if (!plan.ok || !plan.updatedSale) {
          return { ok: false, error: plan.error };
        }
        setSales((prev) => prev.map((s) => (s.id === saleId ? plan.updatedSale! : s)));
        setProducts(plan.updatedProducts!);
        setIngredients(plan.updatedIngredients!);
        if (plan.movements && plan.movements.length > 0) {
          setStockMovements((prev) => [...plan.movements!, ...prev]);
        }
        return { ok: true };
      };

      if (!user || !cloudWorkspaceId) {
        return applyLocal();
      }

      const uids = activeMemberUids();
      const salePath = `workspaces/${cloudWorkspaceId}/sales/${saleId}`;

      try {
        let txResult: OperationResult = { ok: false };
        await runTransaction(db, async (tx) => {
          const saleRef = doc(db, 'workspaces', cloudWorkspaceId, 'sales', saleId);
          const saleSnap = await tx.get(saleRef);
          if (!saleSnap.exists()) {
            txResult = { ok: false, error: 'Order not found.' };
            return;
          }
          const liveSale = normalizeSale({
            id: saleSnap.id,
            ...saleSnap.data(),
            createdAt: tsToIso(saleSnap.data().createdAt),
          } as Partial<Sale> & { id: string });

          const prodIds = new Set<string>();
          const ingIds = new Set<string>();

          const hasSnapshots = liveSale.items.some((i) => i.deductions && i.deductions.length > 0);
          if (hasSnapshots) {
            for (const item of liveSale.items) {
              for (const snap of item.deductions || []) {
                if (snap.itemClassification === 'ingredient') ingIds.add(snap.itemId);
                else prodIds.add(snap.itemId);
              }
            }
          } else {
            for (const m of cur.stockMovements.filter(
              (mv) => mv.referenceId === saleId && mv.movementType === 'sale_consumption'
            )) {
              const id = m.itemId || m.ingredientId;
              if ((m.itemClassification ?? 'ingredient') === 'ingredient') ingIds.add(id);
              else prodIds.add(id);
            }
          }

          const liveProducts: Product[] = [];
          for (const pid of prodIds) {
            const pSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid));
            if (pSnap.exists()) {
              liveProducts.push(
                normalizeProduct({ id: pSnap.id, ...pSnap.data() } as Partial<Product> & { id: string })
              );
            }
          }
          const liveIngredients: Ingredient[] = [];
          for (const iid of ingIds) {
            const iSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid));
            if (iSnap.exists()) {
              const d = iSnap.data();
              liveIngredients.push({
                id: iSnap.id,
                name: String(d.name || ''),
                nameVi: String(d.nameVi || ''),
                unit: d.unit,
                stockQty: Number(d.stockQty) || 0,
                reorderLevel: Number(d.reorderLevel) || 0,
                unitCostKhr: Number(d.unitCostKhr) || 0,
                supplier: String(d.supplier || ''),
              });
            }
          }

          const plan = buildVoidPlan({
            sale: liveSale,
            stockMovements: cur.stockMovements,
            products: liveProducts,
            ingredients: liveIngredients,
            recordedBy: operator,
            reason,
          });

          if (!plan.ok || !plan.updatedSale) {
            txResult = { ok: false, error: plan.error };
            return;
          }

          tx.update(
            saleRef,
            stripUndefined({
              status: 'voided',
              refundedKhr: plan.updatedSale.refundedKhr ?? plan.updatedSale.totalKhr,
              netTotalKhr: 0,
              refundedCogsKhr: plan.updatedSale.refundedCogsKhr ?? plan.updatedSale.cogsKhr,
              voidedAt: plan.updatedSale.voidedAt,
              voidedBy: plan.updatedSale.voidedBy,
              voidReason: plan.updatedSale.voidReason,
              updatedAt: serverTimestamp(),
            })
          );

          for (const pid of plan.touchedProductIds || []) {
            const p = plan.updatedProducts?.find((x) => x.id === pid);
            if (p) {
              tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid), {
                stockQty: p.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const iid of plan.touchedIngredientIds || []) {
            const i = plan.updatedIngredients?.find((x) => x.id === iid);
            if (i) {
              tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid), {
                stockQty: i.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const mov of plan.movements || []) {
            tx.set(
              doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id),
              movementToFirestoreDoc(mov, cloudWorkspaceId, uids, user.uid)
            );
          }

          txResult = { ok: true };
        });

        return txResult;
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          return applyLocal();
        }
        handleFirestoreError(err, OperationType.UPDATE, salePath);
        return { ok: false, error: 'Failed to void order.' };
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  // Atomic Partial Return (Restores exact proportional original deduction snapshot)
  const returnSaleItems = useCallback(
    async (input: ReturnSaleItemsInput): Promise<SaleOperationResult> => {
      const cur = latestRef.current;
      const operator = sanitizeString(cur.settings.activeOperator || 'Family', 80);

      const applyLocal = (): SaleOperationResult => {
        const target = cur.sales.find((s) => s.id === input.saleId);
        if (!target) return { ok: false, error: 'Order not found.' };
        const plan = buildPartialReturnPlan({
          sale: target,
          returnItems: input.returnItems,
          products: cur.products,
          ingredients: cur.ingredients,
          recordedBy: operator,
          reason: input.reason,
        });
        if (!plan.ok || !plan.updatedSale) {
          return { ok: false, error: plan.error };
        }
        setSales((prev) => prev.map((s) => (s.id === input.saleId ? plan.updatedSale! : s)));
        setProducts(plan.updatedProducts!);
        setIngredients(plan.updatedIngredients!);
        if (plan.movements && plan.movements.length > 0) {
          setStockMovements((prev) => [...plan.movements!, ...prev]);
        }
        return { ok: true, sale: plan.updatedSale };
      };

      if (!user || !cloudWorkspaceId) {
        return applyLocal();
      }

      const uids = activeMemberUids();
      const salePath = `workspaces/${cloudWorkspaceId}/sales/${input.saleId}`;

      try {
        let txResult: SaleOperationResult = { ok: false };
        await runTransaction(db, async (tx) => {
          const saleRef = doc(db, 'workspaces', cloudWorkspaceId, 'sales', input.saleId);
          const saleSnap = await tx.get(saleRef);
          if (!saleSnap.exists()) {
            txResult = { ok: false, error: 'Order not found.' };
            return;
          }
          const liveSale = normalizeSale({
            id: saleSnap.id,
            ...saleSnap.data(),
            createdAt: tsToIso(saleSnap.data().createdAt),
          } as Partial<Sale> & { id: string });

          const prodIds = new Set<string>();
          const ingIds = new Set<string>();
          for (const item of liveSale.items) {
            for (const snap of item.deductions || []) {
              if (snap.itemClassification === 'ingredient') ingIds.add(snap.itemId);
              else prodIds.add(snap.itemId);
            }
          }

          const liveProducts: Product[] = [];
          for (const pid of prodIds) {
            const pSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid));
            if (pSnap.exists()) {
              liveProducts.push(
                normalizeProduct({ id: pSnap.id, ...pSnap.data() } as Partial<Product> & { id: string })
              );
            }
          }
          const liveIngredients: Ingredient[] = [];
          for (const iid of ingIds) {
            const iSnap = await tx.get(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid));
            if (iSnap.exists()) {
              const d = iSnap.data();
              liveIngredients.push({
                id: iSnap.id,
                name: String(d.name || ''),
                nameVi: String(d.nameVi || ''),
                unit: d.unit,
                stockQty: Number(d.stockQty) || 0,
                reorderLevel: Number(d.reorderLevel) || 0,
                unitCostKhr: Number(d.unitCostKhr) || 0,
                supplier: String(d.supplier || ''),
              });
            }
          }

          const plan = buildPartialReturnPlan({
            sale: liveSale,
            returnItems: input.returnItems,
            products: liveProducts,
            ingredients: liveIngredients,
            recordedBy: operator,
            reason: input.reason,
          });

          if (!plan.ok || !plan.updatedSale) {
            txResult = { ok: false, error: plan.error };
            return;
          }

          tx.update(
            saleRef,
            stripUndefined({
              status: plan.updatedSale.status,
              items: plan.updatedSale.items,
              refundedKhr: plan.updatedSale.refundedKhr ?? 0,
              netTotalKhr: plan.updatedSale.netTotalKhr ?? 0,
              refundedCogsKhr: plan.updatedSale.refundedCogsKhr ?? 0,
              returns: plan.updatedSale.returns ?? [],
              updatedAt: serverTimestamp(),
            })
          );

          for (const pid of plan.touchedProductIds || []) {
            const p = plan.updatedProducts?.find((x) => x.id === pid);
            if (p) {
              tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'products', pid), {
                stockQty: p.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const iid of plan.touchedIngredientIds || []) {
            const i = plan.updatedIngredients?.find((x) => x.id === iid);
            if (i) {
              tx.update(doc(db, 'workspaces', cloudWorkspaceId, 'ingredients', iid), {
                stockQty: i.stockQty,
                updatedAt: serverTimestamp(),
              });
            }
          }
          for (const mov of plan.movements || []) {
            tx.set(
              doc(db, 'workspaces', cloudWorkspaceId, 'stockMovements', mov.id),
              movementToFirestoreDoc(mov, cloudWorkspaceId, uids, user.uid)
            );
          }

          txResult = { ok: true, sale: plan.updatedSale };
        });

        return txResult;
      } catch (err) {
        if (isOfflineNetworkError(err)) {
          return applyLocal();
        }
        handleFirestoreError(err, OperationType.UPDATE, salePath);
        return { ok: false, error: 'Failed to process partial return.' };
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const saveExpense = useCallback(
    async (
      input: Omit<Expense, 'id' | 'createdAt' | 'recordedBy' | 'linkedIngredientId'> & {
        id?: string;
        linkedIngredientId?: string;
        recordedBy?: string;
      }
    ) => {
      const isEdit = Boolean(input.id);
      const id = input.id || generateId('exp');
      const operator = sanitizeString(
        input.recordedBy || latestRef.current.settings.activeOperator || 'Family',
        80
      );
      const clean: Expense = {
        id,
        expenseDate: input.expenseDate || todayIso(),
        title: sanitizeString(input.title, 120),
        category: input.category,
        scope: input.scope,
        amountKhr: clampNumber(input.amountKhr, 0, 1000000000),
        paymentMethod: input.paymentMethod,
        vendor: sanitizeString(input.vendor, 100),
        note: sanitizeString(input.note, 200),
        linkedIngredientId: sanitizeString(input.linkedIngredientId || '', 128),
        isInventoryPurchase: Boolean(input.isInventoryPurchase),
        recordedBy: operator,
        createdAt: new Date().toISOString(),
      };

      setExpenses((prev) => (isEdit ? prev.map((e) => (e.id === id ? { ...e, ...clean } : e)) : [clean, ...prev]));

      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/expenses/${id}`;
        try {
          if (isEdit) {
            await updateDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', id), {
              expenseDate: clean.expenseDate,
              title: clean.title,
              category: clean.category,
              scope: clean.scope,
              amountKhr: clean.amountKhr,
              paymentMethod: clean.paymentMethod,
              vendor: clean.vendor,
              note: clean.note,
              isInventoryPurchase: Boolean(clean.isInventoryPurchase),
              recordedBy: clean.recordedBy,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', id), {
              workspaceId: cloudWorkspaceId,
              memberUids: activeMemberUids(),
              expenseDate: clean.expenseDate,
              title: clean.title,
              category: clean.category,
              scope: clean.scope,
              amountKhr: clean.amountKhr,
              paymentMethod: clean.paymentMethod,
              vendor: clean.vendor,
              note: clean.note,
              linkedIngredientId: clean.linkedIngredientId,
              isInventoryPurchase: Boolean(clean.isInventoryPurchase),
              recordedBy: clean.recordedBy,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
        }
      }
    },
    [user, cloudWorkspaceId, activeMemberUids]
  );

  const deleteExpense = useCallback(
    async (expenseId: string) => {
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      if (user && cloudWorkspaceId) {
        const path = `workspaces/${cloudWorkspaceId}/expenses/${expenseId}`;
        try {
          await deleteDoc(doc(db, 'workspaces', cloudWorkspaceId, 'expenses', expenseId));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, path);
        }
      }
    },
    [user, cloudWorkspaceId]
  );

  const startQuickCloudSync = useCallback(async (): Promise<CloudAuthResult> => {
    try {
      await signInAnonymouslyForSync(rememberMe);
      return { ok: true };
    } catch (err) {
      const code = getFirebaseAuthErrorCode(err);
      if (code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed') {
        return {
          ok: false,
          errorCode: 'auth/operation-not-allowed',
          error: 'Quick code-only sync needs the Anonymous toggle enabled once in Firebase Console.',
        };
      }
      return {
        ok: false,
        errorCode: code || 'auth/unknown',
        error: err instanceof Error ? err.message : 'Unable to start cloud sync.',
      };
    }
  }, [rememberMe]);

  const signInWithGoogle = useCallback(async (): Promise<CloudAuthResult> => {
    try {
      const signedIn = await signInWithGoogleForSync(rememberMe);
      if (!signedIn) {
        return { ok: true, redirected: true };
      }
      return { ok: true };
    } catch (err) {
      const code = getFirebaseAuthErrorCode(err);
      if (code === 'auth/unauthorized-domain') {
        return {
          ok: false,
          errorCode: 'auth/unauthorized-domain',
          error: 'This site domain is not yet authorized in Firebase Authentication.',
        };
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return {
          ok: false,
          errorCode: code,
          error: 'Google sign-in popup was closed before finishing.',
        };
      }
      return {
        ok: false,
        errorCode: code || 'auth/unknown',
        error: err instanceof Error ? err.message : 'Google sign-in failed.',
      };
    }
  }, [rememberMe]);

  const signOutGoogle = useCallback(async () => {
    await signOutWorkspace();
  }, []);

  const joinWorkspaceByCode = useCallback(
    async (rawCode: string): Promise<CloudAuthResult> => {
      const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 6 || code.length > 16) {
        return { ok: false, error: 'Invalid code format. Enter the 6–10 character code.' };
      }

      let activeUser = user ?? auth.currentUser;
      const initiatedBeforeLogin = !activeUser;

      if (!activeUser) {
        pendingDirectJoinRef.current = true;
        try {
          activeUser = await signInAnonymouslyForSync(rememberMe);
        } catch (anonErr) {
          const anonCode = getFirebaseAuthErrorCode(anonErr);
          if (anonCode === 'auth/admin-restricted-operation' || anonCode === 'auth/operation-not-allowed') {
            try {
              const googleUser = await signInWithGoogleForSync(rememberMe, code);
              if (!googleUser) {
                return { ok: true, redirected: true };
              }
              activeUser = googleUser;
            } catch (googleErr) {
              pendingDirectJoinRef.current = false;
              const googleCode = getFirebaseAuthErrorCode(googleErr);
              if (googleCode === 'auth/unauthorized-domain') {
                return {
                  ok: false,
                  errorCode: 'auth/unauthorized-domain',
                  error: 'This external domain needs one quick Firebase setup step (enable Anonymous Sign-In or add this domain).',
                };
              }
              if (googleCode === 'auth/popup-closed-by-user' || googleCode === 'auth/cancelled-popup-request') {
                return {
                  ok: false,
                  errorCode: googleCode,
                  error: 'Sign-in was canceled before connecting to the workspace.',
                };
              }
              return {
                ok: false,
                errorCode: googleCode || 'auth/unknown',
                error: 'Unable to authenticate. Please try again.',
              };
            }
          } else {
            pendingDirectJoinRef.current = false;
            return {
              ok: false,
              errorCode: anonCode || 'auth/unknown',
              error: anonErr instanceof Error ? anonErr.message : 'Unable to connect to cloud sync.',
            };
          }
        }
      }

      if (!isAllowedCloudUser(activeUser) || !activeUser) {
        pendingDirectJoinRef.current = false;
        return { ok: false, error: 'An active cloud session is required to sync.' };
      }

      setSyncing(true);
      try {
        const inviteSnap = await getDoc(doc(db, 'workspaceInvites', code));
        if (!inviteSnap.exists()) {
          if (initiatedBeforeLogin) {
            try {
              const existingProfile = await getDoc(doc(db, 'users', activeUser.uid));
              if (existingProfile.exists() && typeof existingProfile.data().workspaceId === 'string') {
                setCloudWorkspaceId(existingProfile.data().workspaceId);
              }
            } catch {
              // Ignore fallback read error
            }
          }
          return { ok: false, error: 'Workspace code not found. Please check the code and try again.' };
        }

        const targetWsId = String(inviteSnap.data().workspaceId || '');
        if (!targetWsId) {
          return { ok: false, error: 'Invalid invite record.' };
        }

        const displayName = sanitizeString(
          activeUser.displayName ||
            activeUser.email?.split('@')[0] ||
            latestRef.current.settings.activeOperator ||
            'Family Member',
          100
        );

        const memberRef = doc(db, 'workspaces', targetWsId, 'members', activeUser.uid);
        const existingMemberSnap = await getDoc(memberRef);
        if (!existingMemberSnap.exists()) {
          await setDoc(memberRef, {
            uid: activeUser.uid,
            displayName,
            inviteCode: code,
            joinedAt: serverTimestamp(),
          });
        }

        const wsSnap = await getDoc(doc(db, 'workspaces', targetWsId));
        if (wsSnap.exists()) {
          const wsData = wsSnap.data();
          const currentUids: string[] = Array.isArray(wsData.memberUids) ? wsData.memberUids : [];
          const hasUid = currentUids.includes(activeUser.uid);
          const nextUids = hasUid ? currentUids : [...currentUids, activeUser.uid].slice(0, 10);

          const currentFamily: string[] = Array.isArray(wsData.familyMembers) ? wsData.familyMembers : [];
          const hasName = currentFamily.includes(displayName);
          const nextFamily = hasName ? currentFamily : [...currentFamily, displayName].slice(0, 10);

          if (!hasUid || !hasName) {
            await updateDoc(doc(db, 'workspaces', targetWsId), {
              memberUids: nextUids,
              familyMembers: nextFamily,
              updatedAt: serverTimestamp(),
            });
          }
        }

        const userRef = doc(db, 'users', activeUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await updateDoc(userRef, {
            displayName,
            workspaceId: targetWsId,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(userRef, {
            uid: activeUser.uid,
            displayName,
            workspaceId: targetWsId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        setCloudWorkspaceId(targetWsId);
        if (typeof window !== 'undefined' && window.location.search.includes('join=')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Unable to join workspace. Check code and network connection.' };
      } finally {
        pendingDirectJoinRef.current = false;
        setSyncing(false);
      }
    },
    [user, rememberMe]
  );

  useEffect(() => {
    if (!authReady || !isAllowedCloudUser(user) || !user) return;
    let pendingCode: string | null = null;
    try {
      pendingCode = sessionStorage.getItem(PENDING_JOIN_STORAGE_KEY);
      if (pendingCode) {
        sessionStorage.removeItem(PENDING_JOIN_STORAGE_KEY);
      }
    } catch {
      pendingCode = null;
    }
    if (pendingCode) {
      void joinWorkspaceByCode(pendingCode);
    }
  }, [authReady, user, joinWorkspaceByCode]);

  const exportJsonBackup = useCallback((): string => {
    const payload = {
      app: 'JuiceFlow',
      exportedAt: new Date().toISOString(),
      settings: latestRef.current.settings,
      ingredients: latestRef.current.ingredients,
      products: latestRef.current.products,
      barcodeRegistry: latestRef.current.barcodeRegistry,
      sales: latestRef.current.sales,
      expenses: latestRef.current.expenses,
      purchases: latestRef.current.purchases,
      stockMovements: latestRef.current.stockMovements,
    };
    return JSON.stringify(payload, null, 2);
  }, []);

  const importJsonBackup = useCallback((jsonText: string): { ok: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<LocalSnapshot>;
      if (!parsed.settings || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.products)) {
        return { ok: false, error: 'Invalid JuiceFlow backup file.' };
      }
      const normalizedProds = parsed.products
        .filter((p): p is Product => Boolean(p && typeof p === 'object' && p.id))
        .map((p) => normalizeProduct(p));
      const normalizedIngs = parsed.ingredients
        .filter((i): i is Ingredient => Boolean(i && typeof i === 'object' && i.id))
        .map((i) => normalizeIngredient(i));
      const normalizedRegistry = Array.isArray(parsed.barcodeRegistry)
        ? parsed.barcodeRegistry
            .map((rec) => normalizeBarcodeRecord(rec))
            .filter((rec): rec is BarcodeRegistryRecord => rec !== null)
        : [];
      setSettings(normalizeSettings(parsed.settings, createInitialSettings()));
      setIngredients(normalizedIngs);
      setProducts(normalizedProds);
      setBarcodeRegistry(
        normalizedRegistry.length > 0
          ? normalizedRegistry
          : buildRegistryFromProducts(normalizedProds)
      );
      setSales(
        Array.isArray(parsed.sales)
          ? parsed.sales
              .filter((s): s is Sale => Boolean(s && typeof s === 'object' && s.id))
              .map((s) => normalizeSale(s))
          : []
      );
      setExpenses(
        Array.isArray(parsed.expenses)
          ? parsed.expenses.filter((e): e is Expense => Boolean(e && typeof e === 'object' && e.id))
          : []
      );
      setPurchases(
        Array.isArray(parsed.purchases)
          ? parsed.purchases.filter((p): p is PurchaseRecord => Boolean(p && typeof p === 'object' && p.id))
          : []
      );
      setStockMovements(
        Array.isArray(parsed.stockMovements)
          ? parsed.stockMovements
              .filter((m): m is StockMovement => Boolean(m && typeof m === 'object' && m.id))
              .map((m) => normalizeStockMovement(m))
          : []
      );
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not parse JSON backup.' };
    }
  }, []);

  const resetDemoData = useCallback(() => {
    const seed = createSeedData();
    setIngredients(seed.ingredients);
    setProducts(seed.products);
    setBarcodeRegistry(buildRegistryFromProducts(seed.products));
    setSales(seed.sales);
    setExpenses(seed.expenses);
    setPurchases(seed.purchases);
    setStockMovements(seed.stockMovements);
  }, []);

  const refreshData = useCallback(async (): Promise<OperationResult> => {
    setRefreshing(true);
    try {
      if (!user || !cloudWorkspaceId) {
        const snap = loadLocalSnapshot();
        setSettings(snap.settings);
        setIngredients(snap.ingredients);
        setProducts(snap.products);
        setBarcodeRegistry(snap.barcodeRegistry);
        setSales(snap.sales);
        setExpenses(snap.expenses);
        setPurchases(snap.purchases);
        setStockMovements(snap.stockMovements);
        return { ok: true };
      }

      const fetchDoc = async (ref: DocumentReference<DocumentData>) => {
        try {
          return await getDocFromServer(ref);
        } catch {
          return await getDoc(ref);
        }
      };

      const fetchQuery = async (q: Query<DocumentData>) => {
        try {
          return await getDocsFromServer(q);
        } catch {
          return await getDocs(q);
        }
      };

      const wsRef = doc(db, 'workspaces', cloudWorkspaceId);
      const prodPath = `workspaces/${cloudWorkspaceId}/products`;
      const bcPath = `workspaces/${cloudWorkspaceId}/barcodes`;
      const ingPath = `workspaces/${cloudWorkspaceId}/ingredients`;
      const salesPath = `workspaces/${cloudWorkspaceId}/sales`;
      const expPath = `workspaces/${cloudWorkspaceId}/expenses`;
      const purPath = `workspaces/${cloudWorkspaceId}/purchases`;
      const movPath = `workspaces/${cloudWorkspaceId}/stockMovements`;

      const [wsSnap, prodSnap, bcSnap, ingSnap, salesSnap, expSnap, purSnap, movSnap] =
        await Promise.all([
          fetchDoc(wsRef),
          fetchQuery(query(collection(db, prodPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, bcPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, ingPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, salesPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, expPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, purPath), where('memberUids', 'array-contains', user.uid))),
          fetchQuery(query(collection(db, movPath), where('memberUids', 'array-contains', user.uid))),
        ]);

      if (wsSnap.exists()) {
        const d = wsSnap.data();
        const uids = Array.isArray(d.memberUids) ? (d.memberUids as string[]) : [user.uid];
        setMemberUids(uids);
        setSettings((prev) =>
          normalizeSettings(
            {
              ...prev,
              workspaceId: cloudWorkspaceId,
              inviteCode: String(d.inviteCode || prev.inviteCode),
              name: String(d.name || prev.name),
              location: String(d.location ?? prev.location),
              currency: 'KHR',
              usdRate: Number(d.usdRate) || prev.usdRate,
              posExchangeRate:
                d.posExchangeRate !== undefined && Number(d.posExchangeRate) > 0
                  ? Math.round(Number(d.posExchangeRate))
                  : prev.posExchangeRate ?? 4000,
              language: d.language === 'vi' ? 'vi' : 'en',
              familyMembers:
                Array.isArray(d.familyMembers) && d.familyMembers.length > 0
                  ? (d.familyMembers as string[])
                  : prev.familyMembers,
              lowStockDefault: Number(d.lowStockDefault ?? prev.lowStockDefault),
              allowNegativeStock: Boolean(d.allowNegativeStock ?? prev.allowNegativeStock ?? false),
              enableOpenFoodFactsLookup:
                d.enableOpenFoodFactsLookup !== undefined
                  ? Boolean(d.enableOpenFoodFactsLookup)
                  : prev.enableOpenFoodFactsLookup !== false,
              timezone: String(d.timezone || BUSINESS_TIMEZONE),
            },
            prev
          )
        );
      }

      setProducts(
        prodSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return normalizeProduct({
            id: docSnap.id,
            ...d,
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          } as Partial<Product> & { id: string });
        })
      );

      setBarcodeRegistry(
        bcSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            code: normalizeBarcodeString(String(d.code || '')),
            format: (d.format as BarcodeFormat) || detectBarcodeFormat(String(d.code || '')),
            productId: String(d.productId || ''),
            ...(d.variantId ? { variantId: String(d.variantId) } : {}),
            packagingType: (d.packagingType as BarcodePackagingType) || 'unit',
            label: String(d.label || 'Unit'),
            unitsPerScan: Math.max(1, Math.round(Number(d.unitsPerScan) || 1)),
            active: d.active !== false,
            source: (d.source as BarcodeSource) || 'manufacturer',
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          };
        })
      );

      setIngredients(
        ingSnap.docs.map((docSnap) => {
          const d = docSnap.data();
          return normalizeIngredient({
            id: docSnap.id,
            ...d,
            createdAt: tsToIso(d.createdAt),
            updatedAt: tsToIso(d.updatedAt),
          } as Partial<Ingredient> & { id: string });
        })
      );

      setSales(
        salesSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return normalizeSale({
              id: docSnap.id,
              ...d,
              createdAt: tsToIso(d.createdAt),
            } as Partial<Sale> & { id: string });
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );

      setExpenses(
        expSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              expenseDate: String(d.expenseDate || todayIso()),
              title: String(d.title || ''),
              category: d.category as ExpenseCategory,
              scope: (d.scope === 'household' ? 'household' : 'business') as ExpenseScope,
              amountKhr: Number(d.amountKhr) || 0,
              paymentMethod: d.paymentMethod as PaymentMethod,
              vendor: String(d.vendor || ''),
              note: String(d.note || ''),
              linkedIngredientId: String(d.linkedIngredientId || ''),
              isInventoryPurchase: Boolean(d.isInventoryPurchase),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort(
            (a, b) =>
              b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt)
          )
      );

      setPurchases(
        purSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              purchaseDate: String(d.purchaseDate || todayIso()),
              itemId: String(d.itemId || ''),
              itemName: String(d.itemName || ''),
              itemClassification: d.itemClassification as StockClassification,
              quantity: Number(d.quantity) || 0,
              ...(d.packCount !== undefined ? { packCount: Number(d.packCount) } : {}),
              ...(d.unitsPerPack !== undefined ? { unitsPerPack: Number(d.unitsPerPack) } : {}),
              unit: d.unit,
              totalCostKhr: Number(d.totalCostKhr) || 0,
              unitCostKhr: Number(d.unitCostKhr) || 0,
              paymentMethod: d.paymentMethod as PaymentMethod,
              supplier: String(d.supplier || ''),
              ...(d.barcodeScanned ? { barcodeScanned: String(d.barcodeScanned) } : {}),
              note: String(d.note || ''),
              recordedBy: String(d.recordedBy || ''),
              createdAt: tsToIso(d.createdAt),
            };
          })
          .sort(
            (a, b) =>
              b.purchaseDate.localeCompare(a.purchaseDate) || b.createdAt.localeCompare(a.createdAt)
          )
      );

      setStockMovements(
        movSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return normalizeStockMovement({
              id: docSnap.id,
              ...d,
              createdAt: tsToIso(d.createdAt),
            } as Partial<StockMovement> & { id: string });
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );

      return { ok: true };
    } catch (err) {
      if (cloudWorkspaceId) {
        try {
          handleFirestoreError(err, OperationType.LIST, `workspaces/${cloudWorkspaceId}`);
        } catch {
          // Structured error logged via handleFirestoreError; return user-friendly result
        }
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to refresh data from cloud.',
      };
    } finally {
      setRefreshing(false);
    }
  }, [user, cloudWorkspaceId]);

  const t = useMemo(() => getTranslations(settings.language), [settings.language]);

  const value: StoreContextValue = {
    settings,
    ingredients,
    products,
    barcodeRegistry,
    sales,
    expenses,
    purchases,
    stockMovements,
    user,
    authReady,
    cloudSynced: Boolean(user && cloudWorkspaceId),
    syncing,
    refreshing,
    refreshData,
    rememberMe,
    setRememberMe,
    t,
    setLanguage,
    setActiveOperator,
    updateSettings,
    saveProduct,
    deleteProduct,
    lookupBarcode,
    saveIngredient,
    deleteIngredient,
    recordIngredientPurchase,
    recordStockPurchase,
    recordOpeningStock,
    prepareBatchStock,
    recordStockCount,
    recordStockAdjustment,
    adjustIngredientStock,
    recordSale,
    voidSale,
    returnSaleItems,
    saveExpense,
    deleteExpense,
    startQuickCloudSync,
    signInWithGoogle,
    signOutGoogle,
    joinWorkspaceByCode,
    exportJsonBackup,
    importJsonBackup,
    resetDemoData,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
