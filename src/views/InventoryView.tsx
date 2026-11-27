import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Edit2,
  FlaskConical,
  History,
  Layers,
  Package,
  PackageCheck,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wheat,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import type {
  BarcodeFormat,
  ExternalBarcodePrefill,
  Ingredient,
  IngredientUnit,
  MovementType,
  PaymentMethod,
  Product,
  StockClassification,
} from '../types';
import { calculateRecipeCogs, formatKhr, formatQty, todayIso } from '../utils/format';
import { type BatchPrepMode, type StockShortage } from '../utils/inventoryEngine';
import { formatBarcodeTypeLabel } from '../utils/barcodeRegistry';
import {
  getCategoriesForScope,
  getCategoryById,
  getCategoryDisplayName,
  getCategoryDotClass,
  resolveIngredientCategoryId,
  resolveProductCategoryId,
  UNCATEGORIZED_ID,
} from '../utils/categories';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useFilterVisibility } from '../hooks/useFilterVisibility';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ProductFormModal } from '../components/ProductFormModal';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { InfoHint } from '../components/InfoHint';

const NEW_CATEGORY_OPTION_VALUE = '__new_category__';

type InventoryTab = 'all' | 'ingredients' | 'prepared_stock' | 'packaged' | 'movements';
type StockStatusFilter = 'all' | 'healthy' | 'low' | 'out';
type AttentionFilter = 'none' | 'all_urgent' | 'out' | 'low' | 'prepared_attention';
type AdjustModalMode = 'waste' | 'count' | 'adjust' | 'opening';

interface StockItemTarget {
  id: string;
  name: string;
  nameVi: string;
  classification: StockClassification;
  unit: IngredientUnit;
  stockQty: number;
  reorderLevel: number;
  unitCostKhr: number;
  supplier: string;
  defaultUnitsPerPack?: number;
  packLabel?: string;
  barcodeScanned?: string;
}

interface UnifiedStockItem {
  id: string;
  name: string;
  nameVi: string;
  tier: StockClassification;
  categoryId: string;
  unit: IngredientUnit;
  stockQty: number;
  reorderLevel: number;
  unitCostKhr: number;
  supplier: string;
  barcode?: string;
  packSummary?: string;
  recipeCount?: number;
  lastBatchPrepDate?: string | null;
  daysSinceBatchPrep?: number | null;
  status: 'out' | 'low' | 'healthy';
  isExpiringBatch: boolean;
  progressPct: number;
  target: StockItemTarget;
  sourceIngredient?: Ingredient;
  sourceProduct?: Product;
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

function computeStockProgressPct(stockQty: number, reorderLevel: number): number {
  if (stockQty <= 0) return 0;
  const fullRef = reorderLevel > 0 ? reorderLevel * 2.5 : Math.max(stockQty, 10);
  return Math.min(100, Math.max(6, Math.round((stockQty / fullRef) * 100)));
}

export const InventoryView: React.FC = () => {
  const {
    settings,
    products,
    ingredients,
    categories,
    barcodeRegistry,
    stockMovements,
    saveProduct,
    lookupBarcode,
    saveIngredient,
    addCategory,
    recordStockPurchase,
    recordOpeningStock,
    prepareBatchStock,
    recordStockCount,
    recordStockAdjustment,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';
  const today = todayIso();
  const { showNoticeToast } = useUndoToast();
  const ingNameInputRef = useRef<HTMLInputElement | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const triggerHighlightItem = (id: string) => {
    setHighlightedItemId(id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedItemId((prev) => (prev === id ? null : prev));
      highlightTimerRef.current = null;
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const inventoryCategories = useMemo(
    () => getCategoriesForScope(categories, 'inventory'),
    [categories]
  );
  const productCategories = useMemo(
    () => getCategoriesForScope(categories, 'product'),
    [categories]
  );

  // Expandable row drawer & inline editing across all 3 inventory tiers
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [editingStockProduct, setEditingStockProduct] = useState<Product | null>(null);
  const [updatingCategoryKey, setUpdatingCategoryKey] = useState<string | null>(null);

  // Main navigation & filtering
  const [activeTab, setActiveTab] = useState<InventoryTab>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StockStatusFilter>('all');
  const { filtersOpen, toggleFilters } = useFilterVisibility();
  const [search, setSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<'ALL' | MovementType>('ALL');
  const [movementTierFilter, setMovementTierFilter] = useState<'ALL' | StockClassification>('ALL');

  useEffect(() => {
    if (
      categoryFilter !== 'all' &&
      !inventoryCategories.some((c) => c.id === categoryFilter)
    ) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, inventoryCategories]);

  // "Needs Attention Today" single-line alert filter state (filters the main list directly)
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('none');

  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (attentionFilter !== 'none' ? 1 : 0);

  const [feedbackMsg, setFeedbackMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Camera barcode scanner & quick-registration for Stock-In
  const [scannerOpen, setScannerOpen] = useState(false);
  const [unknownStockBarcode, setUnknownStockBarcode] = useState<{
    code: string;
    format: BarcodeFormat;
    prefill: ExternalBarcodePrefill | null;
  } | null>(null);
  const [quickRegisterOpen, setQuickRegisterOpen] = useState(false);

  // Ingredient CRUD modal
  const [ingModalOpen, setIngModalOpen] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [ingName, setIngName] = useState('');
  const [ingNameVi, setIngNameVi] = useState('');
  const [ingCategoryId, setIngCategoryId] = useState<string>(UNCATEGORIZED_ID);
  const [addingIngCategory, setAddingIngCategory] = useState(false);
  const [newIngCategoryName, setNewIngCategoryName] = useState('');
  const [newIngCategoryError, setNewIngCategoryError] = useState<string | null>(null);
  const [creatingIngCategory, setCreatingIngCategory] = useState(false);
  const [ingUnit, setIngUnit] = useState<IngredientUnit>('g');
  const [ingStock, setIngStock] = useState('0');
  const [ingReorder, setIngReorder] = useState('500');
  const [ingCost, setIngCost] = useState('10');
  const [ingSupplier, setIngSupplier] = useState('');

  // Stock-In / Quick Restock Purchase modal (supports all 3 tiers + pack/carton multiplication)
  const [purchaseTarget, setPurchaseTarget] = useState<StockItemTarget | null>(null);
  const [purchaseUsePacks, setPurchaseUsePacks] = useState(false);
  const [purchasePackCount, setPurchasePackCount] = useState('1');
  const [purchaseUnitsPerPack, setPurchaseUnitsPerPack] = useState('24');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseCostKhr, setPurchaseCostKhr] = useState('');
  const [purchasePayment, setPurchasePayment] = useState<PaymentMethod>('cash');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [purchaseNote, setPurchaseNote] = useState('');

  // Prepared Stock Batch Prep modal (Deduct Raw Ingredients OR Direct Add)
  const [batchProduct, setBatchProduct] = useState<Product | null>(null);
  const [batchQty, setBatchQty] = useState('10');
  const [batchMode, setBatchMode] = useState<BatchPrepMode>('deduct_ingredients');
  const [batchDirectUnitCost, setBatchDirectUnitCost] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchShortages, setBatchShortages] = useState<StockShortage[]>([]);

  // Unified Adjust / Waste / Physical Count / Opening Stock Modal
  const [adjustModalTarget, setAdjustModalTarget] = useState<StockItemTarget | null>(null);
  const [adjustModalMode, setAdjustModalMode] = useState<AdjustModalMode>('waste');
  const [wasteKind, setWasteKind] = useState<'damaged' | 'expired'>('expired');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [openingQty, setOpeningQty] = useState('');
  const [openingUnitCost, setOpeningUnitCost] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const packagedProducts = useMemo(
    () => products.filter((p) => p.productType === 'PACKAGED'),
    [products]
  );
  const preparedStockProducts = useMemo(
    () => products.filter((p) => p.productType === 'PREPARED_STOCK'),
    [products]
  );

  // Track the latest batch_prep_in date per prepared_stock item for aging/expiry alerts
  const latestBatchPrepByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of stockMovements) {
      if (m.movementType !== 'batch_prep_in') continue;
      const itemId = m.itemId || m.ingredientId;
      if (!itemId) continue;
      const existing = map.get(itemId);
      if (!existing || m.movementDate > existing) {
        map.set(itemId, m.movementDate);
      }
    }
    return map;
  }, [stockMovements]);

  const toTargetFromProduct = (p: Product): StockItemTarget => ({
    id: p.id,
    name: p.name,
    nameVi: p.nameVi,
    classification: p.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock',
    unit: p.unit || 'pcs',
    stockQty: p.stockQty,
    reorderLevel: p.reorderLevel,
    unitCostKhr: p.costPriceKhr,
    supplier: p.supplier,
    defaultUnitsPerPack: p.packagingBarcodes?.[0]?.unitsPerPack,
    packLabel: p.packagingBarcodes?.[0]?.label,
  });

  const toTargetFromIngredient = (i: Ingredient): StockItemTarget => ({
    id: i.id,
    name: i.name,
    nameVi: i.nameVi,
    classification: 'ingredient',
    unit: i.unit,
    stockQty: i.stockQty,
    reorderLevel: i.reorderLevel,
    unitCostKhr: i.unitCostKhr,
    supplier: i.supplier,
  });

  // Unified 3-tier stock items list
  const allUnifiedItems = useMemo<UnifiedStockItem[]>(() => {
    const items: UnifiedStockItem[] = [];

    for (const ing of ingredients) {
      const status: UnifiedStockItem['status'] =
        ing.stockQty <= 0 ? 'out' : ing.stockQty <= ing.reorderLevel ? 'low' : 'healthy';
      items.push({
        id: ing.id,
        name: ing.name,
        nameVi: ing.nameVi,
        tier: 'ingredient',
        categoryId: resolveIngredientCategoryId(ing, categories),
        unit: ing.unit,
        stockQty: ing.stockQty,
        reorderLevel: ing.reorderLevel,
        unitCostKhr: ing.unitCostKhr,
        supplier: ing.supplier,
        status,
        isExpiringBatch: false,
        progressPct: computeStockProgressPct(ing.stockQty, ing.reorderLevel),
        target: toTargetFromIngredient(ing),
        sourceIngredient: ing,
      });
    }

    for (const prod of preparedStockProducts) {
      const status: UnifiedStockItem['status'] =
        prod.stockQty <= 0 ? 'out' : prod.stockQty <= prod.reorderLevel ? 'low' : 'healthy';
      const lastDate = latestBatchPrepByItem.get(prod.id) || null;
      const daysOld = lastDate ? daysBetweenIsoDates(lastDate, today) : null;
      const isExpiringBatch = prod.stockQty > 0 && daysOld !== null && daysOld >= 2;
      items.push({
        id: prod.id,
        name: prod.name,
        nameVi: prod.nameVi,
        tier: 'prepared_stock',
        categoryId: resolveProductCategoryId(prod, categories),
        unit: prod.unit || 'pcs',
        stockQty: prod.stockQty,
        reorderLevel: prod.reorderLevel,
        unitCostKhr: prod.costPriceKhr,
        supplier: prod.supplier,
        barcode: prod.barcode || undefined,
        recipeCount: prod.recipe.length,
        lastBatchPrepDate: lastDate,
        daysSinceBatchPrep: daysOld,
        status,
        isExpiringBatch,
        progressPct: computeStockProgressPct(prod.stockQty, prod.reorderLevel),
        target: toTargetFromProduct(prod),
        sourceProduct: prod,
      });
    }

    for (const prod of packagedProducts) {
      const status: UnifiedStockItem['status'] =
        prod.stockQty <= 0 ? 'out' : prod.stockQty <= prod.reorderLevel ? 'low' : 'healthy';
      items.push({
        id: prod.id,
        name: prod.name,
        nameVi: prod.nameVi,
        tier: 'packaged',
        categoryId: resolveProductCategoryId(prod, categories),
        unit: prod.unit || 'pcs',
        stockQty: prod.stockQty,
        reorderLevel: prod.reorderLevel,
        unitCostKhr: prod.costPriceKhr,
        supplier: prod.supplier,
        barcode: prod.barcode || undefined,
        packSummary: prod.packagingBarcodes?.[0]
          ? `${prod.packagingBarcodes[0].label}`
          : undefined,
        status,
        isExpiringBatch: false,
        progressPct: computeStockProgressPct(prod.stockQty, prod.reorderLevel),
        target: toTargetFromProduct(prod),
        sourceProduct: prod,
      });
    }

    // Sort urgently: Out of stock -> Low / Expiring -> Healthy, then alphabetical
    const rank = (item: UnifiedStockItem) => {
      if (item.status === 'out') return 0;
      if (item.status === 'low') return 1;
      if (item.isExpiringBatch) return 2;
      return 3;
    };
    return items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [ingredients, preparedStockProducts, packagedProducts, categories, latestBatchPrepByItem, today]);

  // "Needs Attention Today" 3 priority buckets
  const attentionItems = useMemo(() => {
    const outOfStock = allUnifiedItems.filter((item) => item.status === 'out');
    const preparedAttention = allUnifiedItems.filter(
      (item) =>
        item.tier === 'prepared_stock' &&
        item.stockQty > 0 &&
        (item.status === 'low' || item.isExpiringBatch)
    );
    const lowStock = allUnifiedItems.filter(
      (item) => item.tier !== 'prepared_stock' && item.status === 'low'
    );
    const combined = [...outOfStock, ...lowStock, ...preparedAttention];
    return {
      outOfStock,
      lowStock,
      preparedAttention,
      combined,
    };
  }, [allUnifiedItems]);

  // Auto-clear active alert filter if its bucket becomes empty after restocking
  useEffect(() => {
    if (attentionFilter === 'none') return;
    if (
      (attentionFilter === 'all_urgent' && attentionItems.combined.length === 0) ||
      (attentionFilter === 'out' && attentionItems.outOfStock.length === 0) ||
      (attentionFilter === 'low' && attentionItems.lowStock.length === 0) ||
      (attentionFilter === 'prepared_attention' && attentionItems.preparedAttention.length === 0)
    ) {
      setAttentionFilter('none');
    }
  }, [attentionFilter, attentionItems]);

  const handleSelectAttentionFilter = (bucket: Exclude<AttentionFilter, 'none'>) => {
    setAttentionFilter((prev) => {
      const next = prev === bucket ? 'none' : bucket;
      if (next !== 'none') {
        setActiveTab('all');
        setStatusFilter('all');
        setCategoryFilter('all');
      }
      return next;
    });
  };

  // Valuation KPIs across all 3 tiers
  const valuation = useMemo(() => {
    const packagedVal = packagedProducts.reduce(
      (s, p) => s + Math.max(0, p.stockQty) * Math.max(0, p.costPriceKhr),
      0
    );
    const ingVal = ingredients.reduce(
      (s, i) => s + Math.max(0, i.stockQty) * Math.max(0, i.unitCostKhr),
      0
    );
    const prepVal = preparedStockProducts.reduce(
      (s, p) => s + Math.max(0, p.stockQty) * Math.max(0, p.costPriceKhr),
      0
    );
    return {
      packagedVal,
      ingVal,
      prepVal,
      totalVal: packagedVal + ingVal + prepVal,
    };
  }, [packagedProducts, ingredients, preparedStockProducts]);

  const showNotice = (kind: 'ok' | 'err', text: string) => {
    setFeedbackMsg({ kind, text });
    window.setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const openPurchaseModal = (target: StockItemTarget, scannedPackUnits?: number) => {
    setPurchaseTarget(target);
    const usePacks = Boolean(scannedPackUnits && scannedPackUnits > 1);
    setPurchaseUsePacks(usePacks);
    setPurchasePackCount('1');
    setPurchaseUnitsPerPack(String(scannedPackUnits || target.defaultUnitsPerPack || 24));
    // Pre-suggest a practical restock quantity when item is low or out
    const suggestedQty =
      target.stockQty <= target.reorderLevel && target.reorderLevel > 0
        ? Math.max(1, Math.ceil(target.reorderLevel * 2 - Math.max(0, target.stockQty)))
        : '';
    setPurchaseQty(suggestedQty !== '' ? String(suggestedQty) : '');
    const estCost =
      suggestedQty !== '' && target.unitCostKhr > 0
        ? Math.round(Number(suggestedQty) * target.unitCostKhr)
        : '';
    setPurchaseCostKhr(estCost !== '' ? String(estCost) : '');
    setPurchasePayment('cash');
    setPurchaseSupplier(target.supplier || '');
    setPurchaseDate(todayIso());
    setPurchaseNote(usePacks && target.packLabel ? `Scanned ${target.packLabel}` : '');
  };

  const openBatchPrepModal = (product: Product) => {
    setBatchProduct(product);
    const suggestedBatch =
      product.stockQty <= product.reorderLevel && product.reorderLevel > 0
        ? Math.max(5, Math.ceil(product.reorderLevel * 2 - Math.max(0, product.stockQty)))
        : 10;
    setBatchQty(String(suggestedBatch));
    setBatchMode(product.recipe && product.recipe.length > 0 ? 'deduct_ingredients' : 'direct_add');
    setBatchDirectUnitCost(
      String(
        product.costPriceKhr || Math.round(calculateRecipeCogs(product.recipe || [], ingredients))
      )
    );
    setBatchNote('');
    setBatchError(null);
    setBatchShortages([]);
  };

  const openQuickRestockForItem = (item: UnifiedStockItem) => {
    if (item.tier === 'prepared_stock' && item.sourceProduct) {
      openBatchPrepModal(item.sourceProduct);
    } else {
      openPurchaseModal(item.target);
    }
  };

  const openAdjustWasteModal = (item: UnifiedStockItem, defaultMode: AdjustModalMode = 'waste') => {
    setAdjustModalTarget(item.target);
    setAdjustModalMode(defaultMode);
    setWasteKind(item.tier === 'prepared_stock' ? 'expired' : 'damaged');
    setAdjustDelta('');
    setCountedQty(String(item.stockQty));
    setOpeningQty('');
    setOpeningUnitCost(String(item.unitCostKhr));
    setAdjustNote('');
  };

  const handleStockInBarcode = async (rawCode: string) => {
    const cleaned = rawCode.trim();
    if (!cleaned) return;
    setUnknownStockBarcode(null);

    const res = await lookupBarcode(cleaned);
    if (!res.found || !res.product) {
      setUnknownStockBarcode({
        code: res.code || cleaned,
        format: res.format,
        prefill: res.externalPrefill || null,
      });
      return;
    }
    if (res.product.productType === 'PREPARED_TO_ORDER') {
      showNotice(
        'err',
        isVi
          ? `"${res.product.nameVi || res.product.name}" là món pha chế theo đơn — hãy nhập nguyên liệu ở mục Nguyên liệu thô.`
          : `"${res.product.name}" is Made-to-Order — restock raw ingredients instead.`
      );
      return;
    }

    const target: StockItemTarget = {
      ...toTargetFromProduct(res.product),
      barcodeScanned: res.code,
      packLabel: res.packLabel || res.product.packagingBarcodes?.[0]?.label,
    };
    openPurchaseModal(target, res.unitsPerScan > 1 ? res.unitsPerScan : undefined);
  };

  useBarcodeScanner({
    enabled:
      !scannerOpen &&
      !purchaseTarget &&
      !ingModalOpen &&
      !batchProduct &&
      !adjustModalTarget &&
      !quickRegisterOpen &&
      !editingStockProduct,
    onScan: (code) => {
      void handleStockInBarcode(code);
    },
  });

  const openEditItem = (item: UnifiedStockItem) => {
    if (item.sourceIngredient) {
      openEditIngredient(item.sourceIngredient);
    } else if (item.sourceProduct) {
      setEditingStockProduct(item.sourceProduct);
    }
  };

  const handleInlineCategoryChange = async (
    item: UnifiedStockItem,
    nextCategoryId: string
  ) => {
    if (!nextCategoryId || nextCategoryId === item.categoryId) return;
    const rowKey = `${item.tier}-${item.id}`;
    setUpdatingCategoryKey(rowKey);
    try {
      const nextCat = getCategoryById(nextCategoryId, categories);
      const nextCatName = getCategoryDisplayName(nextCat, isVi);
      const itemLabel = isVi ? item.nameVi || item.name : item.name;

      if (item.sourceIngredient) {
        const ing = item.sourceIngredient;
        await saveIngredient({
          id: ing.id,
          name: ing.name,
          nameVi: ing.nameVi,
          categoryId: nextCategoryId,
          unit: ing.unit,
          stockQty: ing.stockQty,
          reorderLevel: ing.reorderLevel,
          unitCostKhr: ing.unitCostKhr,
          supplier: ing.supplier,
          updatedAt: ing.updatedAt,
        });
      } else if (item.sourceProduct) {
        const prod = item.sourceProduct;
        const res = await saveProduct({
          id: prod.id,
          name: prod.name,
          nameVi: prod.nameVi,
          brand: prod.brand,
          productType: prod.productType,
          category: nextCategoryId,
          categoryId: nextCategoryId,
          priceKhr: prod.priceKhr,
          costPriceKhr: prod.costPriceKhr,
          markupPercent: prod.markupPercent,
          manualPriceOverride: prod.manualPriceOverride,
          imageUrl: prod.imageUrl,
          active: prod.active,
          barcode: prod.barcode,
          packagingBarcodes: prod.packagingBarcodes,
          stockQty: prod.stockQty,
          reorderLevel: prod.reorderLevel,
          unit: prod.unit,
          supplier: prod.supplier,
          recipe: prod.recipe,
          recipeVersion: prod.recipeVersion,
          variants: prod.variants,
        });
        if (!res.ok) {
          showNotice('err', res.error || (isVi ? 'Không thể đổi danh mục.' : 'Could not update category.'));
          return;
        }
      }

      triggerHighlightItem(item.id);
      showNoticeToast({
        message: isVi
          ? `Đã chuyển "${itemLabel}" sang ${nextCatName}`
          : `Moved "${itemLabel}" to ${nextCatName}`,
      });
    } finally {
      setUpdatingCategoryKey(null);
    }
  };

  const openNewIngredient = () => {
    setEditingIng(null);
    setIngName('');
    setIngNameVi('');
    const defaultCat =
      inventoryCategories.find((c) => c.id === 'produce')?.id ||
      inventoryCategories[0]?.id ||
      UNCATEGORIZED_ID;
    setIngCategoryId(defaultCat);
    setAddingIngCategory(false);
    setNewIngCategoryName('');
    setNewIngCategoryError(null);
    setIngUnit('g');
    setIngStock('0');
    setIngReorder(String(settings.lowStockDefault || 15));
    setIngCost('10');
    setIngSupplier('');
    setIngModalOpen(true);
    window.requestAnimationFrame(() => ingNameInputRef.current?.focus());
  };

  const openEditIngredient = (ing: Ingredient) => {
    setEditingIng(ing);
    setIngName(ing.name);
    setIngNameVi(ing.nameVi);
    setIngCategoryId(resolveIngredientCategoryId(ing, categories));
    setAddingIngCategory(false);
    setNewIngCategoryName('');
    setNewIngCategoryError(null);
    setIngUnit(ing.unit);
    setIngStock(String(ing.stockQty));
    setIngReorder(String(ing.reorderLevel));
    setIngCost(String(ing.unitCostKhr));
    setIngSupplier(ing.supplier);
    setIngModalOpen(true);
  };

  const handleCreateInlineIngCategory = async () => {
    const trimmed = newIngCategoryName.trim();
    if (!trimmed) {
      setNewIngCategoryError(
        isVi ? 'Vui lòng nhập tên danh mục.' : 'Please enter a category name.'
      );
      return;
    }
    setCreatingIngCategory(true);
    setNewIngCategoryError(null);
    try {
      const res = await addCategory({
        name: trimmed,
        scope: 'inventory',
      });
      if (!res.ok || !res.category) {
        setNewIngCategoryError(
          res.error || (isVi ? 'Không thể tạo danh mục.' : 'Could not create category.')
        );
        return;
      }
      setIngCategoryId(res.category.id);
      setAddingIngCategory(false);
      setNewIngCategoryName('');
    } finally {
      setCreatingIngCategory(false);
    }
  };

  const submitIngredient = async (mode: 'close' | 'add_another' = 'close') => {
    const trimmedName = ingName.trim();
    if (!trimmedName) return;
    const savedId = await saveIngredient({
      id: editingIng?.id,
      name: trimmedName,
      nameVi: ingNameVi.trim() || trimmedName,
      categoryId: ingCategoryId || UNCATEGORIZED_ID,
      unit: ingUnit,
      stockQty: Number(ingStock) || 0,
      reorderLevel: Math.max(0, Number(ingReorder) || 0),
      unitCostKhr: Math.max(0, Number(ingCost) || 0),
      supplier: ingSupplier.trim(),
    });
    triggerHighlightItem(savedId);

    if (mode === 'add_another' && !editingIng) {
      showNoticeToast({
        message: isVi ? `Đã thêm "${trimmedName}"` : `Saved "${trimmedName}"`,
        detail: isVi
          ? 'Sẵn sàng thêm nguyên liệu tiếp theo (đã giữ danh mục & đơn vị).'
          : 'Ready for next ingredient (category & unit kept).',
      });
      // Reset per-item fields while retaining smart defaults (category, unit, reorder level, supplier)
      setIngName('');
      setIngNameVi('');
      setIngStock('0');
      setIngCost('10');
      window.requestAnimationFrame(() => ingNameInputRef.current?.focus());
      return;
    }

    setIngModalOpen(false);
    showNotice(
      'ok',
      editingIng
        ? isVi
          ? `Đã cập nhật nguyên liệu "${trimmedName}".`
          : `Updated ingredient "${trimmedName}".`
        : isVi
          ? `Đã thêm nguyên liệu "${trimmedName}".`
          : `Added ingredient "${trimmedName}".`
    );
  };

  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitIngredient('close');
  };

  useEffect(() => {
    if (!ingModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIngModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ingModalOpen]);

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseTarget) return;

    const packCount = purchaseUsePacks ? Math.max(1, Number(purchasePackCount) || 0) : undefined;
    const unitsPerPack = purchaseUsePacks
      ? Math.max(1, Number(purchaseUnitsPerPack) || 1)
      : undefined;
    const effectiveQty = purchaseUsePacks
      ? (packCount || 0) * (unitsPerPack || 1)
      : Number(purchaseQty) || 0;

    if (effectiveQty <= 0) return;

    const res = await recordStockPurchase({
      itemId: purchaseTarget.id,
      itemClassification: purchaseTarget.classification,
      quantity: effectiveQty,
      packCount,
      unitsPerPack,
      totalCostKhr: Math.max(0, Number(purchaseCostKhr) || 0),
      paymentMethod: purchasePayment,
      supplier: purchaseSupplier,
      barcodeScanned: purchaseTarget.barcodeScanned,
      note: purchaseNote,
      purchaseDate,
    });

    if (!res.ok) {
      showNotice('err', res.error || 'Could not record stock-in.');
      return;
    }
    setPurchaseTarget(null);
    showNotice(
      'ok',
      isVi
        ? `Đã nhập kho +${formatQty(effectiveQty, purchaseTarget.unit)} ${purchaseTarget.nameVi || purchaseTarget.name}.`
        : `Restocked +${formatQty(effectiveQty, purchaseTarget.unit)} ${purchaseTarget.name}.`
    );
  };

  const handleSaveBatchPrep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchProduct) return;
    setBatchError(null);
    setBatchShortages([]);

    const qty = Number(batchQty) || 0;
    if (qty <= 0) return;

    const res = await prepareBatchStock({
      productId: batchProduct.id,
      batchQty: qty,
      mode: batchMode,
      directUnitCostKhr:
        batchMode === 'direct_add' ? Math.max(0, Number(batchDirectUnitCost) || 0) : undefined,
      note: batchNote,
    });

    if (!res.ok) {
      setBatchError(res.error || 'Could not prepare batch.');
      setBatchShortages(res.shortages || []);
      return;
    }

    setBatchProduct(null);
    showNotice(
      'ok',
      isVi
        ? `Đã thêm +${qty} ${batchProduct.unit} ${batchProduct.nameVi || batchProduct.name} vào kho pha sẵn.`
        : `Prepared +${qty} ${batchProduct.unit} of ${batchProduct.name} (${
            batchMode === 'deduct_ingredients' ? 'ingredients deducted' : 'direct add'
          }).`
    );
  };

  const handleSaveUnifiedAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalTarget) return;

    if (adjustModalMode === 'count') {
      const counted = Number(countedQty);
      if (!Number.isFinite(counted) || counted < 0) return;
      const res = await recordStockCount({
        itemId: adjustModalTarget.id,
        itemClassification: adjustModalTarget.classification,
        countedQty: counted,
        note: adjustNote,
      });
      if (!res.ok) {
        showNotice('err', res.error || 'Could not record stock count.');
        return;
      }
      setAdjustModalTarget(null);
      showNotice('ok', isVi ? 'Đã cập nhật kiểm kê thực tế.' : 'Physical stock count recorded.');
      return;
    }

    if (adjustModalMode === 'opening') {
      const qty = Number(openingQty) || 0;
      if (qty <= 0) return;
      const res = await recordOpeningStock({
        itemId: adjustModalTarget.id,
        itemClassification: adjustModalTarget.classification,
        quantity: qty,
        unitCostKhr: Math.max(0, Number(openingUnitCost) || adjustModalTarget.unitCostKhr),
        note: adjustNote || 'Opening stock balance',
      });
      if (!res.ok) {
        showNotice('err', res.error || 'Could not record opening stock.');
        return;
      }
      setAdjustModalTarget(null);
      showNotice(
        'ok',
        isVi
          ? `Đã ghi nhận tồn đầu kỳ cho ${adjustModalTarget.nameVi || adjustModalTarget.name}.`
          : `Opening stock recorded (non-expense) for ${adjustModalTarget.name}.`
      );
      return;
    }

    if (adjustModalMode === 'waste') {
      const qty = Math.abs(Number(adjustDelta) || 0);
      if (qty <= 0) return;
      const res = await recordStockAdjustment({
        itemId: adjustModalTarget.id,
        itemClassification: adjustModalTarget.classification,
        movementType: wasteKind,
        deltaQty: qty,
        note: adjustNote,
      });
      if (!res.ok) {
        showNotice('err', res.error || 'Could not log waste.');
        return;
      }
      setAdjustModalTarget(null);
      showNotice(
        'ok',
        isVi
          ? `Đã ghi nhận hao hụt -${formatQty(qty, adjustModalTarget.unit)}.`
          : `Logged write-off of -${formatQty(qty, adjustModalTarget.unit)}.`
      );
      return;
    }

    // Manual delta adjustment
    const val = Number(adjustDelta);
    if (!Number.isFinite(val) || val === 0) return;
    const res = await recordStockAdjustment({
      itemId: adjustModalTarget.id,
      itemClassification: adjustModalTarget.classification,
      movementType: 'adjustment',
      deltaQty: val,
      note: adjustNote,
    });
    if (!res.ok) {
      showNotice('err', res.error || 'Could not adjust stock.');
      return;
    }
    setAdjustModalTarget(null);
    showNotice('ok', isVi ? 'Đã cập nhật điều chỉnh tồn kho.' : 'Stock adjustment recorded.');
  };

  // Filtered stock items for active tier tab + status filter + search
  const q = search.trim().toLowerCase();

  const filteredStockItems = useMemo(() => {
    return allUnifiedItems.filter((item) => {
      if (activeTab === 'ingredients' && item.tier !== 'ingredient') return false;
      if (activeTab === 'prepared_stock' && item.tier !== 'prepared_stock') return false;
      if (activeTab === 'packaged' && item.tier !== 'packaged') return false;

      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) return false;

      if (attentionFilter === 'all_urgent') {
        const isUrgent =
          item.status === 'out' ||
          item.status === 'low' ||
          (item.tier === 'prepared_stock' && item.stockQty > 0 && item.isExpiringBatch);
        if (!isUrgent) return false;
      } else if (attentionFilter === 'out') {
        if (item.status !== 'out') return false;
      } else if (attentionFilter === 'low') {
        if (item.tier === 'prepared_stock' || item.status !== 'low') return false;
      } else if (attentionFilter === 'prepared_attention') {
        if (
          !(
            item.tier === 'prepared_stock' &&
            item.stockQty > 0 &&
            (item.status === 'low' || item.isExpiringBatch)
          )
        ) {
          return false;
        }
      }

      if (statusFilter === 'out' && item.status !== 'out') return false;
      if (statusFilter === 'low' && item.status !== 'low') return false;
      if (statusFilter === 'healthy' && item.status !== 'healthy') return false;

      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.nameVi.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q) ||
        (item.barcode || '').toLowerCase().includes(q)
      );
    });
  }, [allUnifiedItems, activeTab, categoryFilter, attentionFilter, statusFilter, q]);

  const filteredMovements = useMemo(
    () =>
      stockMovements.filter((m) => {
        if (movementTypeFilter !== 'ALL' && m.movementType !== movementTypeFilter) return false;
        if (
          movementTierFilter !== 'ALL' &&
          (m.itemClassification ?? 'ingredient') !== movementTierFilter
        ) {
          return false;
        }
        if (!q) return true;
        return (
          (m.itemName || m.ingredientName).toLowerCase().includes(q) ||
          m.note.toLowerCase().includes(q) ||
          m.recordedBy.toLowerCase().includes(q)
        );
      }),
    [stockMovements, movementTypeFilter, movementTierFilter, q]
  );

  const getTierMeta = (tier: StockClassification) => {
    if (tier === 'ingredient') {
      return {
        label: isVi ? 'Nguyên liệu thô' : 'Raw Ingredient',
        badgeClass:
          'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-[#064E3B]/60 dark:text-[#6EE7B7] dark:border-[#10B981]/30',
        dotClass: 'bg-emerald-600 dark:bg-[#10B981]',
        hintText: isVi
          ? 'Đo theo trọng lượng/thể tích. Tự động trừ theo công thức khi bán món pha chế theo ly hoặc khi pha mẻ.'
          : 'Measured by weight or volume. Automatically deducted via recipe on Made-to-Order POS sales or batch prep.',
      };
    }
    if (tier === 'prepared_stock') {
      return {
        label: isVi ? 'Mẻ pha sẵn' : 'Prepared Batch',
        badgeClass:
          'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-500/35',
        dotClass: 'bg-purple-600 dark:bg-purple-400',
        hintText: isVi
          ? 'Thành phẩm pha theo mẻ trữ lạnh. Khi bán trên POS sẽ trừ trực tiếp số lượng mẻ sẵn có (không trừ trùng nguyên liệu).'
          : 'Pre-blended bases or bottled chilled batches. Deducts ready units on POS sales without double-deducting raw ingredients.',
      };
    }
    return {
      label: isVi ? 'Hàng đóng gói' : 'Packaged Good',
      badgeClass:
        'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-500/35',
      dotClass: 'bg-sky-600 dark:bg-sky-400',
      hintText: isVi
        ? 'Nước chai, lon, đồ ăn vặt quản lý theo đơn vị hoặc thùng. Trừ trực tiếp số lượng bán tại POS.'
        : 'Bottles, cans, and snacks tracked by unit or carton count. Deducted directly at POS checkout.',
    };
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {t.inventory.title}
            </h1>
            <InfoHint
              label={isVi ? 'Thông tin quản lý kho' : 'About Inventory Management'}
              text={
                isVi
                  ? 'Kiểm tra nhanh hàng sắp hết và quản lý đồng bộ 3 nhóm kho: Nguyên liệu thô, Mẻ pha sẵn và Hàng đóng gói.'
                  : 'Daily stock checks and restocking across Raw Ingredients, Prepared Batches, and Packaged Goods.'
              }
            />
          </div>
          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-1 font-mono-num flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span>
              {t.inventory.stockValue}:{' '}
              <strong className="text-stone-800 dark:text-[#F1F5F3]">
                {formatKhr(valuation.totalVal)}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isVi ? 'Nguyên liệu' : 'Raw'} {formatKhr(valuation.ingVal)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isVi ? 'Pha sẵn' : 'Batches'} {formatKhr(valuation.prepVal)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isVi ? 'Đóng gói' : 'Packaged'} {formatKhr(valuation.packagedVal)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
          >
            <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
            {isVi ? 'Quét nhập kho' : 'Scan Stock-In'}
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg && (
        <div
          role="status"
          className={`px-4 py-3 rounded-xl border text-sm font-medium flex items-center justify-between gap-3 ${
            feedbackMsg.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-[#064E3B] border-emerald-200 dark:border-[#10B981]/50 text-emerald-900 dark:text-[#D1FAE5]'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-500/40 text-red-900 dark:text-red-200'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Unregistered Stock-In Barcode Prompt */}
      {unknownStockBarcode && (
        <div
          role="status"
          className="bg-white dark:bg-[#131D18] border border-stone-300 dark:border-[#24352C] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {isVi ? 'Mã vạch chưa có trong kho' : 'Unregistered Stock-In Barcode'}:{' '}
                <span className="font-mono-num text-[#0F5C43] dark:text-[#34D399]">
                  {unknownStockBarcode.code}
                </span>{' '}
                <span className="text-xs font-normal text-stone-500 dark:text-[#94A39B]">
                  ({formatBarcodeTypeLabel(unknownStockBarcode.format)})
                </span>
              </p>
              <p className="text-xs text-stone-600 dark:text-[#94A39B] mt-0.5 truncate">
                {unknownStockBarcode.prefill
                  ? isVi
                    ? `Gợi ý từ Open Food Facts: ${unknownStockBarcode.prefill.name}${unknownStockBarcode.prefill.brand ? ` · ${unknownStockBarcode.prefill.brand}` : ''}`
                    : `Prefill from Open Food Facts: ${unknownStockBarcode.prefill.name}${unknownStockBarcode.prefill.brand ? ` · ${unknownStockBarcode.prefill.brand}` : ''}`
                  : isVi
                    ? 'Không tìm thấy trên Open Food Facts — bạn có thể đăng ký sản phẩm mới ngay rồi nhập kho.'
                    : 'Not found externally — register this product now and proceed directly to Stock-In.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={() => setQuickRegisterOpen(true)}
              className="h-11 inline-flex items-center justify-center px-3.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
            >
              {isVi ? '+ Đăng ký sản phẩm' : '+ Register Product'}
            </button>
            <button
              type="button"
              onClick={() => setUnknownStockBarcode(null)}
              aria-label={t.common.close}
              className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* 1. SINGLE-LINE "NEEDS ATTENTION TODAY" ALERT FILTER BAR            */}
      {/* ================================================================== */}
      {attentionItems.combined.length === 0 ? (
        <div className="needs-attention-container flex items-center animate-drawer-in">
          <span className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-[#064E3B]/60 dark:text-[#6EE7B7] dark:border-[#10B981]/35 transition-colors duration-200 ease-out">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-[#34D399] shrink-0" />
            <span>{isVi ? 'Tất cả tồn kho ổn định' : 'All Stock Healthy'}</span>
          </span>
        </div>
      ) : (
        <section
          aria-label={isVi ? 'Cần xử lý hôm nay' : 'Needs Attention Today'}
          className="needs-attention-container min-h-12 py-2.5 px-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-500/30 flex flex-wrap items-center justify-between gap-2.5 transition-all duration-200 ease-out animate-drawer-in"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="inline-flex items-center gap-1.5 pr-1 shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs sm:text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                {isVi ? 'Cần xử lý hôm nay' : 'Needs Attention Today'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleSelectAttentionFilter('all_urgent')}
              aria-pressed={attentionFilter === 'all_urgent'}
              className={`h-9 px-3 text-xs font-semibold rounded-full border transition-colors duration-200 ease-out whitespace-nowrap inline-flex items-center gap-1 ${
                attentionFilter === 'all_urgent'
                  ? 'border-stone-900 bg-stone-900 text-white dark:border-[#10B981] dark:bg-[#10B981] dark:text-[#042419]'
                  : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-800 dark:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
              }`}
            >
              <span>{isVi ? 'Tất cả khẩn cấp' : 'All Urgent'}</span>
              <span className="font-mono-num">({attentionItems.combined.length})</span>
            </button>

            {attentionItems.outOfStock.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelectAttentionFilter('out')}
                aria-pressed={attentionFilter === 'out'}
                className={`h-9 px-3 text-xs font-semibold rounded-full border transition-colors duration-200 ease-out whitespace-nowrap inline-flex items-center gap-1 ${
                  attentionFilter === 'out'
                    ? 'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500 dark:text-white'
                    : 'border-red-200 dark:border-red-500/40 bg-red-50/90 dark:bg-red-950/45 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-950/75'
                }`}
              >
                <span>{isVi ? 'Hết hàng' : 'Out of Stock'}</span>
                <span className="font-mono-num">({attentionItems.outOfStock.length})</span>
              </button>
            )}

            {attentionItems.lowStock.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelectAttentionFilter('low')}
                aria-pressed={attentionFilter === 'low'}
                className={`h-9 px-3 text-xs font-semibold rounded-full border transition-colors duration-200 ease-out whitespace-nowrap inline-flex items-center gap-1 ${
                  attentionFilter === 'low'
                    ? 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-stone-950'
                    : 'border-amber-200 dark:border-amber-500/40 bg-amber-50/90 dark:bg-amber-950/45 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/75'
                }`}
              >
                <span>{isVi ? 'Sắp hết' : 'Low Stock'}</span>
                <span className="font-mono-num">({attentionItems.lowStock.length})</span>
              </button>
            )}

            {attentionItems.preparedAttention.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelectAttentionFilter('prepared_attention')}
                aria-pressed={attentionFilter === 'prepared_attention'}
                className={`h-9 px-3 text-xs font-semibold rounded-full border transition-colors duration-200 ease-out whitespace-nowrap inline-flex items-center gap-1 ${
                  attentionFilter === 'prepared_attention'
                    ? 'border-purple-600 bg-purple-600 text-white dark:border-purple-500 dark:bg-purple-500 dark:text-white'
                    : 'border-purple-200 dark:border-purple-500/40 bg-purple-50/90 dark:bg-purple-950/45 text-purple-900 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-950/75'
                }`}
              >
                <span>{isVi ? 'Mẻ thấp' : 'Low Batch'}</span>
                <span className="font-mono-num">({attentionItems.preparedAttention.length})</span>
              </button>
            )}
          </div>

          {attentionFilter !== 'none' && (
            <button
              type="button"
              onClick={() => setAttentionFilter('none')}
              className="h-9 px-3 text-xs font-semibold rounded-full border border-stone-300 dark:border-[#344E41] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors duration-200 ease-out whitespace-nowrap shrink-0"
            >
              {isVi ? 'Hiện tất cả' : 'Show All'}
            </button>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* 2. STICKY 3-TIER NAVIGATION TABS + SEARCH & ACTION TOOLBAR         */}
      {/* ================================================================== */}
      <div className="sticky top-16 z-20 w-full max-w-full bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-md border border-stone-200 dark:border-[#24352C] rounded-xl p-3.5 sm:p-4 space-y-3 shadow-xs">
        {/* Row 1: 3-Tier Navigation Tabs + Secondary Stock History Tab */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
          <div className="min-w-0 max-w-full overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div
              role="tablist"
              aria-label={isVi ? 'Phân nhóm kho hàng' : 'Inventory tiers'}
              className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl"
            >
              {(
                [
                  {
                    id: 'all',
                    icon: Layers,
                    label: isVi ? 'Tất cả' : 'All Items',
                    count: allUnifiedItems.length,
                  },
                  {
                    id: 'ingredients',
                    icon: Wheat,
                    label: isVi ? 'Nguyên liệu thô' : 'Raw Ingredients',
                    count: ingredients.length,
                  },
                  {
                    id: 'prepared_stock',
                    icon: FlaskConical,
                    label: isVi ? 'Mẻ pha sẵn' : 'Prepared Batches',
                    count: preparedStockProducts.length,
                  },
                  {
                    id: 'packaged',
                    icon: Package,
                    label: isVi ? 'Hàng đóng gói' : 'Packaged Goods',
                    count: packagedProducts.length,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={`h-10 px-3 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 ease-out whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono-num text-[11px] font-bold ${
                        active ? 'opacity-80' : 'text-stone-400 dark:text-[#94A39B]'
                      }`}
                    >
                      ({tab.count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Secondary Stock History Tab Button */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'movements'}
            onClick={() => setActiveTab(activeTab === 'movements' ? 'all' : 'movements')}
            className={`h-11 px-3.5 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'movements'
                ? 'border-[#0F5C43] bg-emerald-50 text-[#0F5C43] dark:border-[#10B981] dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span>{isVi ? 'Lịch sử kho' : 'Stock History'}</span>
            <span className="font-mono-num text-[11px] opacity-80">
              ({stockMovements.length})
            </span>
          </button>
        </div>

        {/* Row 2: Aligned Search Bar + Wrapping Toolbar Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                activeTab === 'movements'
                  ? isVi
                    ? 'Tìm theo tên món, ghi chú, người thực hiện...'
                    : 'Search item, note, or staff...'
                  : isVi
                    ? 'Tìm nguyên liệu, sản phẩm, nhà cung cấp, mã vạch...'
                    : 'Search item name, barcode, or supplier...'
              }
              className="w-full h-11 pl-10 pr-9 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="w-9 h-9 inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] absolute right-1 top-1/2 -translate-y-1/2 rounded-md"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {activeTab !== 'movements' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleFilters}
                aria-expanded={filtersOpen}
                aria-controls="inventory-stock-filters"
                className={`inline-flex items-center gap-1.5 h-11 px-3 text-xs font-semibold rounded-[10px] transition-colors whitespace-nowrap border ${
                  filtersOpen || activeFilterCount > 0
                    ? 'bg-stone-100 dark:bg-[#18251F] border-transparent dark:border-[#24352C] text-stone-900 dark:text-[#F1F5F3] hover:bg-stone-200/70 dark:hover:bg-[#1F3028]'
                    : 'bg-transparent border-transparent text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#0D5C3E] dark:text-[#10B981] shrink-0" />
                <span>
                  {filtersOpen
                    ? isVi
                      ? 'Ẩn bộ lọc'
                      : 'Hide Filters'
                    : isVi
                      ? 'Hiện bộ lọc'
                      : 'Show Filters'}
                </span>
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-mono-num font-semibold bg-[#0D5C3E]/12 text-[#0D5C3E] dark:bg-[#10B981]/20 dark:text-[#6EE7B7]">
                    {activeFilterCount}
                  </span>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] transition-transform duration-200 motion-reduce:transition-none ${
                    filtersOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                disabled={activeFilterCount === 0 && !search.trim()}
                onClick={() => {
                  setCategoryFilter('all');
                  setStatusFilter('all');
                  setAttentionFilter('none');
                  setSearch('');
                }}
                className="inline-flex items-center justify-center h-11 px-2.5 text-xs font-semibold text-[#0D5C3E] dark:text-[#34D399] hover:underline disabled:text-stone-400 dark:disabled:text-[#94A39B]/40 disabled:no-underline disabled:cursor-default rounded-lg transition-colors whitespace-nowrap"
              >
                {isVi ? 'Đặt lại' : 'Reset All'}
              </button>

              <button
                type="button"
                onClick={openNewIngredient}
                className="inline-flex items-center justify-center h-11 px-4 text-xs sm:text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {`+ ${t.inventory.addIngredient}`}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={movementTierFilter}
                onChange={(e) =>
                  setMovementTierFilter(e.target.value as 'ALL' | StockClassification)
                }
                className="h-11 px-3 text-xs sm:text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
              >
                <option value="ALL">{isVi ? 'Mọi nhóm kho' : 'All Tiers'}</option>
                <option value="ingredient">{isVi ? 'Nguyên liệu thô' : 'Raw Ingredients'}</option>
                <option value="prepared_stock">{isVi ? 'Mẻ pha sẵn' : 'Prepared Batches'}</option>
                <option value="packaged">{isVi ? 'Hàng đóng gói' : 'Packaged Goods'}</option>
              </select>
              <select
                value={movementTypeFilter}
                onChange={(e) => setMovementTypeFilter(e.target.value as 'ALL' | MovementType)}
                className="h-11 px-3 text-xs sm:text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
              >
                <option value="ALL">{isVi ? 'Mọi loại biến động' : 'All Types'}</option>
                {(Object.keys(t.movementTypes) as MovementType[]).map((mt) => (
                  <option key={mt} value={mt}>
                    {t.movementTypes[mt]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Collapsible Category & Stock Status Pills Drawer (matches SalesView) */}
        {activeTab !== 'movements' && (
          <div
            id="inventory-stock-filters"
            className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
              filtersOpen
                ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-stone-100 dark:border-[#24352C]'
                : '!mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
            }`}
          >
            <div className="overflow-hidden">
              <div className="space-y-2.5">
                <CategoryFilterPills
                  categories={inventoryCategories}
                  selectedCategoryId={categoryFilter}
                  onSelect={(id) => {
                    setCategoryFilter(id);
                    if (id !== 'all') setAttentionFilter('none');
                  }}
                  isVi={isVi}
                  allLabel={t.common.all}
                />

                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-[11px] font-semibold text-stone-500 dark:text-[#94A39B] w-16 shrink-0">
                    {t.common.status}
                  </span>
                  <div className="flex flex-nowrap items-center gap-2 overflow-x-auto min-w-0 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(
                      [
                        ['all', t.common.all],
                        ['healthy', isVi ? 'Ổn định' : 'Healthy'],
                        ['low', isVi ? 'Sắp hết' : 'Low Stock'],
                        ['out', isVi ? 'Hết hàng' : 'Out of Stock'],
                      ] as const
                    ).map(([st, label]) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setStatusFilter(st);
                          setAttentionFilter('none');
                        }}
                        aria-pressed={statusFilter === st && attentionFilter === 'none'}
                        className={`h-11 px-4 text-xs font-medium rounded-full transition-colors duration-200 ease-out whitespace-nowrap shrink-0 border ${
                          statusFilter === st && attentionFilter === 'none'
                            ? 'bg-[#E6F2ED] text-[#0D5C3E] border-[#0D5C3E]/30 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/45 font-semibold'
                            : 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* 3. SCANNABLE 4-COLUMN INVENTORY TABLE (LOCKED TO 100% WIDTH)       */}
      {/* ================================================================== */}
      <div className="w-full max-w-full overflow-x-hidden bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl">
        {activeTab !== 'movements' && (
          <div className="w-full">
            {filteredStockItems.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <p className="text-sm font-semibold text-stone-700 dark:text-[#D5DFDA]">
                  {isVi ? 'Không tìm thấy mặt hàng phù hợp' : 'No matching inventory items'}
                </p>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {search ||
                  statusFilter !== 'all' ||
                  categoryFilter !== 'all' ||
                  attentionFilter !== 'none'
                    ? isVi
                      ? 'Hãy thử xóa từ khóa tìm kiếm hoặc đổi bộ lọc danh mục / trạng thái.'
                      : 'Try clearing your search or changing the category or status filter.'
                    : activeTab === 'packaged'
                      ? isVi
                        ? 'Thêm sản phẩm đóng gói ở mục Sản phẩm để theo dõi tồn kho tại đây.'
                        : 'Add a Packaged product under Products to track its unit stock here.'
                      : activeTab === 'prepared_stock'
                        ? isVi
                          ? 'Thêm sản phẩm loại "Hàng pha sẵn" ở mục Sản phẩm để quản lý mẻ pha.'
                          : 'Add a Prepared Stock product under Products to track batches here.'
                        : t.inventory.emptyStock}
                </p>
              </div>
            ) : (
              <div className="w-full">
                {/* Desktop Column Alignment Header */}
                <div
                  aria-hidden="true"
                  className="hidden lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(112px,0.8fr)_minmax(0,1.15fr)_196px] items-center gap-3 px-4 sm:px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-[#94A39B] bg-stone-50/75 dark:bg-[#18251F]/80 border-b border-stone-200 dark:border-[#24352C]"
                >
                  <div>{isVi ? 'Mặt hàng' : 'Item'}</div>
                  <div>{isVi ? 'Giá vốn & Giá trị' : 'Cost & Value'}</div>
                  <div>{isVi ? 'Tình trạng tồn kho' : 'Stock Health'}</div>
                  <div className="text-right">{t.common.actions}</div>
                </div>

                <div className="divide-y divide-stone-100 dark:divide-[#1F3028]">
                  {filteredStockItems.map((item) => {
                    const rowKey = `${item.tier}-${item.id}`;
                    const isExpanded = expandedRowKey === rowKey;
                    const tierMeta = getTierMeta(item.tier);
                    const catItem = getCategoryById(item.categoryId, categories);
                    const isOut = item.status === 'out';
                    const isLow = item.status === 'low';
                    const isZeroCost = item.unitCostKhr <= 0;
                    const stockValueKhr = Math.max(0, item.stockQty) * Math.max(0, item.unitCostKhr);

                    const progressBarColor = isOut
                      ? 'bg-red-600 dark:bg-red-500'
                      : isLow
                        ? 'bg-amber-500 dark:bg-amber-400'
                        : 'bg-emerald-600 dark:bg-[#10B981]';

                    const statusTextClass = isOut
                      ? 'text-red-700 dark:text-[#F87171]'
                      : isLow
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-[#34D399]';

                    const statusLabel = isOut
                      ? t.inventory.statusOut
                      : isLow
                        ? t.inventory.statusLow
                        : t.inventory.statusHealthy;

                    const isHighlighted = highlightedItemId === item.id;
                    const baseScopeCategories =
                      item.tier === 'ingredient' ? inventoryCategories : productCategories;
                    const selectableCategories = baseScopeCategories.some(
                      (c) => c.id === item.categoryId
                    )
                      ? baseScopeCategories
                      : [catItem, ...baseScopeCategories];

                    const packOrBatchDetail =
                      item.tier === 'prepared_stock'
                        ? [
                            item.recipeCount !== undefined
                              ? item.recipeCount > 0
                                ? isVi
                                  ? `Công thức ${item.recipeCount} nguyên liệu`
                                  : `Recipe (${item.recipeCount} ingredients)`
                                : isVi
                                  ? 'Mẻ nhập trực tiếp'
                                  : 'Direct batch prep'
                              : '',
                            item.daysSinceBatchPrep !== null && item.daysSinceBatchPrep !== undefined
                              ? isVi
                                ? `Pha cách đây ${item.daysSinceBatchPrep} ngày`
                                : `Prepped ${item.daysSinceBatchPrep}d ago`
                              : '',
                            item.unit,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : item.packSummary
                          ? `${item.packSummary} (${item.unit})`
                          : item.unit;

                    return (
                      <div
                        key={rowKey}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-emerald-50/90 dark:bg-[#064E3B]/45 ring-2 ring-inset ring-[#10B981]/60'
                            : isExpanded
                              ? 'bg-stone-50/50 dark:bg-[#16231C]/65'
                              : 'hover:bg-stone-50/70 dark:hover:bg-[#18251F]/60'
                        }`}
                      >
                        {/* Strict 4-Column Row (Locked within 100% Container Width) */}
                        <div
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('button, select, input, a')) {
                              return;
                            }
                            setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey));
                          }}
                          className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(112px,0.8fr)_minmax(0,1.15fr)_196px] items-center gap-3 px-4 sm:px-5 py-3.5 cursor-pointer"
                        >
                          {/* Column 1: Item Identity */}
                          <div className="min-w-0 flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey))
                              }
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded
                                  ? isVi
                                    ? 'Thu gọn chi tiết'
                                    : 'Collapse details'
                                  : isVi
                                    ? 'Xem chi tiết'
                                    : 'Expand details'
                              }
                              className="w-8 h-8 -ml-1 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] hover:bg-stone-200/60 dark:hover:bg-[#1F3028] transition-colors shrink-0"
                            >
                              <ChevronDown
                                className={`w-4 h-4 transition-transform duration-150 ${
                                  isExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>

                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm sm:text-[15px] font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                                {isVi ? item.nameVi || item.name : item.name}
                              </h3>
                              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#94A39B] min-w-0">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${tierMeta.dotClass}`}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{tierMeta.label}</span>
                                <span
                                  aria-hidden="true"
                                  className="text-stone-300 dark:text-[#344B3F] shrink-0"
                                >
                                  ·
                                </span>
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${getCategoryDotClass(
                                    catItem
                                  )}`}
                                  aria-hidden="true"
                                />
                                <span className="truncate">
                                  {getCategoryDisplayName(catItem, isVi)}
                                </span>
                              </p>
                            </div>
                          </div>

                          {/* Column 2: Cost & Value */}
                          <div className="min-w-0 pl-9 lg:pl-0 flex items-baseline justify-between lg:block gap-3">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span
                                className={`font-mono-num text-xs whitespace-nowrap ${
                                  isZeroCost
                                    ? 'text-stone-500 dark:text-[#94A39B]'
                                    : 'font-semibold text-stone-800 dark:text-[#F1F5F3]'
                                }`}
                              >
                                {isVi ? 'Vốn:' : 'Avg:'} {formatKhr(item.unitCostKhr)}
                              </span>
                              {isZeroCost && (
                                <button
                                  type="button"
                                  onClick={() => openEditItem(item)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{isVi ? 'Đặt giá vốn' : 'Set Cost'}</span>
                                </button>
                              )}
                            </div>
                            <p className="font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] lg:mt-0.5 whitespace-nowrap">
                              {isVi ? 'Giá trị:' : 'Val:'} {formatKhr(stockValueKhr)}
                            </p>
                          </div>

                          {/* Column 3: Stock Health & Bar */}
                          <div className="min-w-0 pl-9 lg:pl-0 space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2 min-w-0">
                              <div className="flex items-baseline gap-1.5 min-w-0">
                                <span className="font-mono-num text-sm sm:text-[15px] font-bold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                                  {formatQty(item.stockQty, item.unit)}
                                </span>
                                <span className="font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] whitespace-nowrap truncate">
                                  / {isVi ? 'tối thiểu' : 'min'}{' '}
                                  {formatQty(item.reorderLevel, item.unit)}
                                </span>
                              </div>
                              <span
                                className={`text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1 shrink-0 ${statusTextClass}`}
                              >
                                {item.isExpiringBatch && !isOut && (
                                  <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                )}
                                {statusLabel}
                              </span>
                            </div>

                            <div
                              className="w-full h-1.5 rounded-full bg-stone-100 dark:bg-[#1F3028] overflow-hidden"
                              role="progressbar"
                              aria-valuenow={item.progressPct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${item.name} stock level`}
                            >
                              <div
                                className={`h-full rounded-full transition-all duration-200 ${progressBarColor}`}
                                style={{ width: `${item.progressPct}%` }}
                              />
                            </div>
                          </div>

                          {/* Column 4: Clean Touch Actions (Always 100% Visible) */}
                          <div className="pl-9 lg:pl-0 flex items-center justify-end gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openQuickRestockForItem(item)}
                              className="flex-1 lg:flex-none h-10 px-3 inline-flex items-center justify-center text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/80 dark:hover:bg-[#065F46] rounded-lg transition-colors whitespace-nowrap"
                            >
                              {item.tier === 'prepared_stock'
                                ? isVi
                                  ? '+ Pha mẻ'
                                  : '+ Restock'
                                : isVi
                                  ? '+ Nhập thêm'
                                  : '+ Restock'}
                            </button>

                            <button
                              type="button"
                              onClick={() => openAdjustWasteModal(item)}
                              title={isVi ? 'Điều chỉnh / Hủy hàng' : 'Adjust / Waste'}
                              aria-label={isVi ? 'Điều chỉnh / Hủy hàng' : 'Adjust / Waste'}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-colors shrink-0"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditItem(item)}
                              title={t.common.edit}
                              aria-label={t.common.edit}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-colors shrink-0"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Expandable Detail Bar (Full Metadata + Inline Category Selector) */}
                        {isExpanded && (
                          <div className="px-4 sm:px-5 lg:pl-14 py-3.5 bg-stone-50/85 dark:bg-[#0F1814]/85 border-t border-stone-100 dark:border-[#1F3028] animate-drawer-in">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 items-start lg:items-center text-xs">
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                                  {isVi ? 'Mã SKU / Mã vạch' : 'SKU / Barcode'}
                                </p>
                                <p className="mt-0.5 font-mono-num text-stone-800 dark:text-[#F1F5F3] break-all">
                                  {item.barcode || '—'}
                                </p>
                              </div>

                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                                  {t.inventory.supplier}
                                </p>
                                <p className="mt-0.5 text-stone-800 dark:text-[#F1F5F3] break-words">
                                  {item.supplier || '—'}
                                </p>
                              </div>

                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                                  {isVi ? 'Quy cách / Đơn vị mẻ' : 'Pack / Batch Unit'}
                                </p>
                                <p className="mt-0.5 text-stone-800 dark:text-[#F1F5F3] break-words">
                                  {packOrBatchDetail}
                                </p>
                              </div>

                              <div className="min-w-0">
                                <label
                                  htmlFor={`inline-cat-${rowKey}`}
                                  className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1"
                                >
                                  {isVi ? 'Danh mục' : 'Category'}
                                </label>
                                <select
                                  id={`inline-cat-${rowKey}`}
                                  disabled={updatingCategoryKey === rowKey}
                                  value={item.categoryId}
                                  onChange={(e) =>
                                    void handleInlineCategoryChange(item, e.target.value)
                                  }
                                  className="w-full h-10 px-2.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                                >
                                  {selectableCategories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                      {getCategoryDisplayName(cat, isVi)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* SECONDARY TAB: STOCK MOVEMENT & DEDUCTION AUDIT HISTORY            */}
        {/* ================================================================== */}
        {activeTab === 'movements' && (
          <div className="overflow-x-auto">
            {filteredMovements.length === 0 ? (
              <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                {t.common.noResults}
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-5 font-medium">{t.common.date}</th>
                    <th className="py-3 px-4 font-medium">
                      {isVi ? 'Mặt hàng / Nhóm' : 'Item / Tier'}
                    </th>
                    <th className="py-3 px-4 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <span>{t.inventory.movementType}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="left"
                          label={t.inventory.movementType}
                          text={
                            isVi
                              ? 'Phân loại nguyên nhân biến động kho: nhập mua, đầu kỳ, bán POS, pha mẻ, kiểm kê hoặc hao hụt.'
                              : 'Audit reason for each stock change: purchase, opening stock, POS sale, batch prep, count, or spoilage.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {t.inventory.quantityChange}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">{t.inventory.costImpact}</th>
                    <th className="py-3 px-5 font-medium">{t.common.note}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {filteredMovements.map((mov) => (
                    <tr
                      key={mov.id}
                      className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                    >
                      <td className="py-3 px-5 font-mono-num text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                        {mov.movementDate}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                          {mov.itemName || mov.ingredientName}
                        </p>
                        <p className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                          {getTierMeta(mov.itemClassification || 'ingredient').label}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-600 dark:text-[#D5DFDA] whitespace-nowrap">
                        {t.movementTypes[mov.movementType]} · {mov.recordedBy}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                          mov.deltaQty >= 0
                            ? 'text-emerald-700 dark:text-[#34D399]'
                            : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {mov.deltaQty > 0 ? '+' : ''}
                        {formatQty(mov.deltaQty, mov.unit)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-xs text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                        {formatKhr(mov.totalCostKhr)}
                      </td>
                      <td className="py-3 px-5 text-xs text-stone-500 dark:text-[#94A39B] max-w-xs truncate">
                        {mov.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* MODAL 1: ADD / EDIT RAW INGREDIENT                                 */}
      {/* ================================================================== */}
      {ingModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIngModalOpen(false);
          }}
        >
          <div className="w-full max-w-md max-h-[92vh] sm:max-h-[90vh] flex flex-col bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-t-2xl sm:rounded-xl overflow-hidden shadow-xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3 shrink-0">
              <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {editingIng ? t.inventory.editIngredient : t.inventory.addIngredient}
              </h2>
              <button
                type="button"
                onClick={() => setIngModalOpen(false)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveIngredient} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.ingredientName}
                </label>
                <input
                  ref={ingNameInputRef}
                  type="text"
                  required
                  maxLength={100}
                  value={ingName}
                  onChange={(e) => setIngName(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.ingredientNameVi}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={ingNameVi}
                  onChange={(e) => setIngNameVi(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div>
                <label
                  htmlFor="ing-category-select"
                  className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                >
                  {isVi ? 'Danh mục kho' : 'Category'}
                </label>
                <select
                  id="ing-category-select"
                  value={addingIngCategory ? NEW_CATEGORY_OPTION_VALUE : ingCategoryId}
                  onChange={(e) => {
                    if (e.target.value === NEW_CATEGORY_OPTION_VALUE) {
                      setAddingIngCategory(true);
                      setNewIngCategoryName('');
                      setNewIngCategoryError(null);
                    } else {
                      setAddingIngCategory(false);
                      setNewIngCategoryError(null);
                      setIngCategoryId(e.target.value);
                    }
                  }}
                  className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                >
                  {inventoryCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {getCategoryDisplayName(cat, isVi)}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY_OPTION_VALUE}>
                    {isVi ? '+ Tạo danh mục mới...' : '+ New Category...'}
                  </option>
                </select>

                {addingIngCategory && (
                  <div className="mt-2 p-3 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={40}
                        value={newIngCategoryName}
                        onChange={(e) => {
                          setNewIngCategoryName(e.target.value);
                          setNewIngCategoryError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleCreateInlineIngCategory();
                          }
                        }}
                        placeholder={
                          isVi ? 'VD: Trái cây tươi, Ly & Ống hút...' : 'e.g. Fresh Produce, Syrups...'
                        }
                        className="flex-1 min-w-0 h-11 px-3 text-sm bg-white dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        autoFocus
                      />
                      <button
                        type="button"
                        disabled={creatingIngCategory}
                        onClick={() => void handleCreateInlineIngCategory()}
                        className="h-11 px-3.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {isVi ? 'Thêm' : 'Add'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingIngCategory(false);
                          setNewIngCategoryName('');
                          setNewIngCategoryError(null);
                        }}
                        className="h-11 px-2.5 text-xs font-medium text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                    {newIngCategoryError && (
                      <p className="text-xs text-red-600 dark:text-[#F87171]">
                        {newIngCategoryError}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.unit}
                  </label>
                  <select
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value as IngredientUnit)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  >
                    {(['g', 'kg', 'ml', 'L', 'pcs'] as IngredientUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.inStock}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={ingStock}
                    onChange={(e) => setIngStock(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.reorderAt}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={ingReorder}
                    onChange={(e) => setIngReorder(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.avgUnitCost} (KHR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={ingCost}
                    onChange={(e) => setIngCost(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.supplier}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={ingSupplier}
                  onChange={(e) => setIngSupplier(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIngModalOpen(false)}
                  className="h-12 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                >
                  {t.common.cancel}
                </button>
                {!editingIng && (
                  <button
                    type="button"
                    disabled={!ingName.trim()}
                    onClick={() => void submitIngredient('add_another')}
                    className="h-12 px-4 inline-flex items-center justify-center text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isVi ? '+ Lưu & Thêm tiếp' : '+ Save & Add Another'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!ingName.trim()}
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 2: QUICK RESTOCK / PURCHASE STOCK-IN MODAL                   */}
      {/* ================================================================== */}
      {purchaseTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 animate-backdrop">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1">
                  <h2 className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                    {isVi ? 'Nhập kho nhanh' : 'Quick Restock'}:{' '}
                    {isVi ? purchaseTarget.nameVi || purchaseTarget.name : purchaseTarget.name}
                  </h2>
                  <InfoHint
                    compact
                    label={isVi ? 'Giải thích nhập kho mua hàng' : 'About Stock-In Purchase'}
                    text={
                      isVi
                        ? 'Ghi nhận vào Sổ Mua Hàng (Dòng tiền chi ra) và cập nhật giá vốn bình quân — không tính trùng vào chi phí vận hành P&L.'
                        : 'Recorded as an Inventory Purchase (Cash Flow outflow & Stock Asset increase) — never double-counted with COGS in Accrual P&L.'
                    }
                  />
                </div>
                <p className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isVi ? 'Hiện còn:' : 'Current:'}{' '}
                  <strong className="text-stone-800 dark:text-[#F1F5F3]">
                    {formatQty(purchaseTarget.stockQty, purchaseTarget.unit)}
                  </strong>{' '}
                  · {isVi ? 'Ngưỡng:' : 'Min:'}{' '}
                  {formatQty(purchaseTarget.reorderLevel, purchaseTarget.unit)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPurchaseTarget(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePurchase} className="p-6 space-y-4">
              {/* Carton / Pack Mode Toggle for Packaged Goods */}
              {purchaseTarget.classification === 'packaged' && (
                <label className="min-h-[44px] inline-flex items-center gap-2.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={purchaseUsePacks}
                    onChange={(e) => setPurchaseUsePacks(e.target.checked)}
                    className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981] rounded"
                  />
                  {isVi
                    ? 'Nhập theo Thùng / Lốc (tự nhân số lượng lẻ)'
                    : 'Enter by Cartons / Packs (auto-multiply into base units)'}
                </label>
              )}

              {purchaseUsePacks ? (
                <div className="grid grid-cols-3 gap-2.5 items-end">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                      {isVi ? 'Số thùng' : 'Packs / Cases'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={purchasePackCount}
                      onChange={(e) => setPurchasePackCount(e.target.value)}
                      className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                      {isVi ? 'SL / thùng' : 'Units / Pack'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={purchaseUnitsPerPack}
                      onChange={(e) => setPurchaseUnitsPerPack(e.target.value)}
                      className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                    />
                  </div>
                  <div className="h-11 px-2 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg flex flex-col items-center justify-center text-center">
                    <span className="block text-[10px] leading-tight text-stone-500 dark:text-[#94A39B]">
                      {isVi ? 'Tổng cộng' : 'Total Added'}
                    </span>
                    <span className="font-mono-num text-sm leading-tight font-bold text-[#0F5C43] dark:text-[#34D399]">
                      {(Number(purchasePackCount) || 0) * (Number(purchaseUnitsPerPack) || 0)}{' '}
                      {purchaseTarget.unit}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.purchaseQty} ({purchaseTarget.unit})
                  </label>
                  <input
                    type="number"
                    required
                    min={0.01}
                    step="any"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="w-full h-12 px-3.5 text-base font-mono-num font-bold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.totalPaidKhr}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={500}
                    value={purchaseCostKhr}
                    onChange={(e) => setPurchaseCostKhr(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.common.payment}
                  </label>
                  <select
                    value={purchasePayment}
                    onChange={(e) => setPurchasePayment(e.target.value as PaymentMethod)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  >
                    {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => (
                      <option key={pm} value={pm}>
                        {t.paymentMethods[pm]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.supplier}
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={purchaseSupplier}
                    onChange={(e) => setPurchaseSupplier(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={purchaseNote}
                  onChange={(e) => setPurchaseNote(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPurchaseTarget(null)}
                  className="h-12 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {isVi ? 'Xác nhận nhập kho' : 'Confirm Restock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 3: PREPARE BATCH MODAL (PREPARED STOCK)                      */}
      {/* ================================================================== */}
      {batchProduct && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 animate-backdrop">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <PackageCheck className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                  <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                    {isVi ? 'Pha mẻ mới' : 'Prepare Batch'}:{' '}
                    {isVi ? batchProduct.nameVi || batchProduct.name : batchProduct.name}
                  </h2>
                  <InfoHint
                    compact
                    label={isVi ? 'Giải thích pha mẻ' : 'About Prepare Batch'}
                    text={
                      isVi
                        ? 'Chọn "Trừ nguyên liệu theo mẻ" để tự trừ kho nguyên liệu theo công thức và tính giá vốn, hoặc "Thêm trực tiếp" nếu không cần trừ kho thô.'
                        : 'Choose "Deduct Raw Ingredients" to consume ingredients via the batch recipe and recalculate unit cost, or "Direct Add" to add ready units directly.'
                    }
                  />
                </div>
                <p className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isVi ? 'Hiện còn:' : 'Current:'}{' '}
                  <strong className="text-stone-800 dark:text-[#F1F5F3]">
                    {formatQty(batchProduct.stockQty, batchProduct.unit)}
                  </strong>{' '}
                  · {isVi ? 'Ngưỡng:' : 'Min:'}{' '}
                  {formatQty(batchProduct.reorderLevel, batchProduct.unit)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchProduct(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBatchPrep} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setBatchMode('deduct_ingredients')}
                  className={`min-h-[48px] px-3 py-2.5 rounded-lg border text-left text-xs font-semibold transition-colors ${
                    batchMode === 'deduct_ingredients'
                      ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                      : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                  }`}
                >
                  {isVi ? 'Trừ nguyên liệu theo mẻ' : 'Deduct Raw Ingredients'}
                </button>
                <button
                  type="button"
                  onClick={() => setBatchMode('direct_add')}
                  className={`min-h-[48px] px-3 py-2.5 rounded-lg border text-left text-xs font-semibold transition-colors ${
                    batchMode === 'direct_add'
                      ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                      : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                  }`}
                >
                  {isVi ? 'Thêm trực tiếp thành phẩm' : 'Direct Add Finished Stock'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {isVi ? 'Số lượng thành phẩm' : 'Batch Yield'} ({batchProduct.unit})
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="any"
                    value={batchQty}
                    onChange={(e) => setBatchQty(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num font-bold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
                {batchMode === 'direct_add' && (
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                      {isVi ? 'Giá vốn / đơn vị (KHR)' : 'Unit Cost (KHR)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={batchDirectUnitCost}
                      onChange={(e) => setBatchDirectUnitCost(e.target.value)}
                      className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={180}
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                  placeholder="Morning chill batch"
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                />
              </div>

              {batchError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/40 rounded-lg text-xs text-red-900 dark:text-red-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{batchError}</span>
                  </div>
                  {batchShortages.length > 0 && (
                    <ul className="pl-5 list-disc font-mono-num">
                      {batchShortages.map((s) => (
                        <li key={s.itemId}>
                          {s.itemName}: need {formatQty(s.requiredQty, s.unit)}, have{' '}
                          {formatQty(s.availableQty, s.unit)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setBatchProduct(null)}
                  className="h-12 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {isVi ? 'Hoàn tất mẻ pha' : 'Confirm Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 4: UNIFIED ADJUST / WASTE / COUNT / OPENING STOCK MODAL      */}
      {/* ================================================================== */}
      {adjustModalTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 animate-backdrop">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Điều chỉnh & Hao hụt' : 'Adjust / Waste'}:{' '}
                  {isVi ? adjustModalTarget.nameVi || adjustModalTarget.name : adjustModalTarget.name}
                </h2>
                <p className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isVi ? 'Tồn hệ thống:' : 'System stock:'}{' '}
                  <strong className="text-stone-900 dark:text-[#F1F5F3]">
                    {formatQty(adjustModalTarget.stockQty, adjustModalTarget.unit)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalTarget(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUnifiedAdjust} className="p-6 space-y-4">
              {/* 4-Mode Touch Segmented Selector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-stone-100 dark:bg-[#0F1814] rounded-lg border border-stone-200 dark:border-[#24352C]">
                {(
                  [
                    { id: 'waste', label: isVi ? 'Hao hụt' : 'Waste' },
                    { id: 'count', label: isVi ? 'Kiểm kê' : 'Count' },
                    { id: 'adjust', label: isVi ? 'Cộng / Trừ' : 'Adjust' },
                    { id: 'opening', label: isVi ? 'Đầu kỳ' : 'Opening' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setAdjustModalMode(mode.id)}
                    className={`h-10 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      adjustModalMode === mode.id
                        ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {/* MODE: WASTE / SPOILAGE */}
              {adjustModalMode === 'waste' && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {(['expired', 'damaged'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setWasteKind(k)}
                        className={`h-11 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                          wasteKind === k
                            ? 'border-amber-600 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-600 dark:text-[#D5DFDA]'
                        }`}
                      >
                        {k === 'expired'
                          ? isVi
                            ? 'Hết hạn / Hỏng'
                            : 'Expired / Spoiled'
                          : isVi
                            ? 'Hư hỏng / Đổ vỡ'
                            : 'Damaged / Spilled'}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                      {isVi ? 'Số lượng hủy' : 'Write-off Quantity'} ({adjustModalTarget.unit})
                    </label>
                    <input
                      type="number"
                      required
                      min={0.01}
                      step="any"
                      placeholder="e.g. 2"
                      value={adjustDelta}
                      onChange={(e) => setAdjustDelta(e.target.value)}
                      className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                    />
                  </div>
                </>
              )}

              {/* MODE: PHYSICAL STOCK COUNT */}
              {adjustModalMode === 'count' && (
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    <span className="inline-flex items-center gap-1">
                      <ClipboardCheck className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                      {isVi ? 'Số lượng đếm được thực tế' : 'Actual Counted Quantity'} (
                      {adjustModalTarget.unit})
                    </span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="any"
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num font-bold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
              )}

              {/* MODE: MANUAL DELTA ADJUSTMENT */}
              {adjustModalMode === 'adjust' && (
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.deltaQty} ({adjustModalTarget.unit})
                  </label>
                  <input
                    type="number"
                    required
                    step="any"
                    placeholder="-2 or +5"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  />
                </div>
              )}

              {/* MODE: OPENING STOCK (NON-EXPENSE) */}
              {adjustModalMode === 'opening' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#94A39B]">
                    <Sparkles className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                    <span>
                      {isVi
                        ? 'Tồn đầu kỳ chỉ tăng giá trị kho, không tính vào chi phí.'
                        : 'Adds initial balance valuation only — never logged as an expense.'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isVi ? 'Số lượng thêm' : 'Opening Qty'} ({adjustModalTarget.unit})
                      </label>
                      <input
                        type="number"
                        required
                        min={0.01}
                        step="any"
                        value={openingQty}
                        onChange={(e) => setOpeningQty(e.target.value)}
                        className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isVi ? 'Đơn giá vốn (KHR)' : 'Unit Cost (KHR)'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={openingUnitCost}
                        onChange={(e) => setOpeningUnitCost(e.target.value)}
                        className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.adjustReason}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder={
                    adjustModalMode === 'waste'
                      ? isVi
                        ? 'VD: Hết hạn cuối ngày'
                        : 'e.g. End-of-day spoilage'
                      : adjustModalMode === 'count'
                        ? isVi
                          ? 'VD: Kiểm kê cuối tuần'
                          : 'e.g. Daily shelf check'
                        : ''
                  }
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustModalTarget(null)}
                  className="h-12 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Camera Barcode Scanner for Stock-In */}
      <BarcodeScannerModal
        open={scannerOpen}
        title={isVi ? 'Quét mã vạch nhập kho' : 'Scan Barcode for Stock-In'}
        subtitle={
          isVi
            ? 'Quét mã lẻ hoặc mã thùng (VD: thùng 24 chai sẽ tự động nhân 24).'
            : 'Scan a unit or carton barcode (carton barcodes auto-multiply pack quantities).'
        }
        onDetected={(code) => {
          void handleStockInBarcode(code);
        }}
        onClose={() => setScannerOpen(false)}
      />

      {/* Quick Product Registration from Unrecognized Stock-In Scan */}
      <ProductFormModal
        open={quickRegisterOpen}
        editingProduct={null}
        existingProducts={products}
        barcodeRegistry={barcodeRegistry}
        ingredients={ingredients}
        settings={settings}
        t={t}
        initialBarcode={unknownStockBarcode?.code || undefined}
        initialPrefill={unknownStockBarcode?.prefill || null}
        initialNotFoundExternally={Boolean(
          unknownStockBarcode && !unknownStockBarcode.prefill
        )}
        onSave={saveProduct}
        onSaved={(newProd) => {
          setUnknownStockBarcode(null);
          const displayName = isVi ? newProd.nameVi || newProd.name : newProd.name;
          showNotice(
            'ok',
            isVi
              ? `Đã đăng ký "${displayName}" — sẵn sàng nhập kho & bán POS.`
              : `Registered "${displayName}" — ready for Stock-In & POS.`
          );
          if (newProd.productType === 'PACKAGED' || newProd.productType === 'PREPARED_STOCK') {
            setActiveTab(newProd.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock');
            openPurchaseModal(toTargetFromProduct(newProd));
          }
        }}
        onClose={() => setQuickRegisterOpen(false)}
      />

      {/* Edit Packaged / Prepared Stock Product Directly From Inventory */}
      <ProductFormModal
        open={Boolean(editingStockProduct)}
        editingProduct={editingStockProduct}
        existingProducts={products}
        barcodeRegistry={barcodeRegistry}
        ingredients={ingredients}
        settings={settings}
        t={t}
        onSave={saveProduct}
        onSaved={(savedProd) => {
          triggerHighlightItem(savedProd.id);
          const displayName = isVi ? savedProd.nameVi || savedProd.name : savedProd.name;
          showNotice(
            'ok',
            isVi ? `Đã cập nhật "${displayName}".` : `Updated "${displayName}".`
          );
        }}
        onClose={() => setEditingStockProduct(null)}
      />

      {/* Bottom-Right Floating Action Button + Scroll-to-Top Pill */}
      <FloatingActionBar
        label={t.inventory.addIngredient}
        topLabel={isVi ? 'Lên đầu' : 'Top'}
        onAction={openNewIngredient}
        hidden={
          ingModalOpen ||
          Boolean(purchaseTarget) ||
          Boolean(batchProduct) ||
          Boolean(adjustModalTarget) ||
          scannerOpen ||
          quickRegisterOpen ||
          Boolean(editingStockProduct)
        }
      />
    </div>
  );
};
