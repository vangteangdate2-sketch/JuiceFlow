import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Edit2,
  History,
  Loader2,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wheat,
  X,
} from 'lucide-react';
import { normalizeName, useStore } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import type {
  BarcodeFormat,
  ExternalBarcodePrefill,
  Ingredient,
  IngredientUnit,
  MovementType,
  NetSizeUnit,
  PackOption,
  PaymentMethod,
  Product,
  StockClassification,
} from '../types';
import { formatKhr, formatQty, todayIso } from '../utils/format';
import { formatStockWithCartons, getProductPackSizes } from '../utils/inventoryEngine';
import {
  findDuplicateBarcodeConflicts,
  formatBarcodeTypeLabel,
  matchesBarcodeSearch,
  normalizeBarcodeString,
} from '../utils/barcodeRegistry';
import {
  getCategoriesForScope,
  getCategoryById,
  getCategoryDisplayName,
  getCategoryDotClass,
  getStockClassificationBadgeClass,
  resolveIngredientCategoryId,
  resolveProductCategoryId,
  UNCATEGORIZED_ID,
} from '../utils/categories';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useFilterVisibility } from '../hooks/useFilterVisibility';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { CurrencyInput } from '../components/CurrencyInput';
import { ProductFormModal } from '../components/ProductFormModal';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { InfoHint } from '../components/InfoHint';
import { ModalPortal } from '../components/ModalPortal';

const NEW_CATEGORY_OPTION_VALUE = '__new_category__';

type InventoryTab = 'all' | 'ingredients' | 'packaged' | 'movements';
type StockStatusFilter = 'all' | 'healthy' | 'low' | 'out';
type AttentionFilter = 'none' | 'all_urgent' | 'out' | 'low';
type AdjustModalMode = 'waste' | 'count' | 'adjust' | 'opening';

interface StockItemTarget {
  id: string;
  name: string;
  nameVi: string;
  netSizeValue?: string;
  netSizeUnit?: NetSizeUnit;
  classification: StockClassification;
  unit: IngredientUnit;
  stockQty: number;
  reorderLevel: number;
  unitCostKhr: number;
  supplier: string;
  defaultUnitsPerPack?: number;
  packLabel?: string;
  packSizes?: PackOption[];
  barcodeScanned?: string;
}

interface UnifiedStockItem {
  id: string;
  name: string;
  nameVi: string;
  netSizeValue?: string;
  netSizeUnit?: NetSizeUnit;
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
  status: 'out' | 'low' | 'healthy';
  progressPct: number;
  target: StockItemTarget;
  sourceIngredient?: Ingredient;
  sourceProduct?: Product;
}

function computeStockProgressPct(stockQty: number, reorderLevel: number): number {
  if (stockQty <= 0) return 0;
  const fullRef = reorderLevel > 0 ? reorderLevel * 2.5 : Math.max(stockQty, 10);
  return Math.min(100, Math.max(6, Math.round((stockQty / fullRef) * 100)));
}

export interface PendingInventoryTarget {
  kind: 'product' | 'ingredient';
  id: string;
  mode: 'restock' | 'edit';
}

interface InventoryViewProps {
  pendingTarget?: PendingInventoryTarget | null;
  onPendingTargetHandled?: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  pendingTarget = null,
  onPendingTargetHandled,
}) => {
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
    recordStockCount,
    recordStockAdjustment,
    t,
  } = useStore();
  const isKm = settings.language === 'km';
  const getLocalizedName = (name: string, nameVi?: string) =>
    isKm && nameVi && /[\u1780-\u17FF]/.test(nameVi) ? nameVi : name;
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

  const drawerFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);
  const activeFilterCount = drawerFilterCount + (attentionFilter !== 'none' ? 1 : 0);
  const hasActiveStockFilters = activeFilterCount > 0 || search.trim().length > 0;
  const hasActiveMovementFilters =
    movementTierFilter !== 'ALL' || movementTypeFilter !== 'ALL' || search.trim().length > 0;

  const [feedbackMsg, setFeedbackMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Camera barcode scanner & quick-registration for Stock-In / Catalog Search
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanLookingUp, setScanLookingUp] = useState(false);
  const [scannedInventoryMatch, setScannedInventoryMatch] = useState<{
    code: string;
    format: BarcodeFormat;
    itemType: 'product' | 'ingredient';
    product?: Product;
    ingredient?: Ingredient;
    unitsPerScan: number;
    packId?: string;
    packLabel?: string;
  } | null>(null);
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
  const [ingBarcode, setIngBarcode] = useState('');
  const [ingBarcodeScannerOpen, setIngBarcodeScannerOpen] = useState(false);
  const [ingSaveError, setIngSaveError] = useState<string | null>(null);

  // Live canonical duplicate guard (normalized name + cross-item barcodeRegistry check)
  const ingDuplicateGuard = useMemo<
    | {
        kind: 'ingredient';
        ingredient: Ingredient;
        displayName: string;
        reason: 'name' | 'barcode';
        matchedCode?: string;
      }
    | {
        kind: 'product';
        product: Product;
        displayName: string;
        reason: 'name' | 'barcode';
        matchedCode?: string;
      }
    | null
  >(() => {
    if (!ingModalOpen) return null;
    const norm = normalizeName(ingName);
    if (norm) {
      const existingIng = ingredients.find(
        (i) => i.id !== editingIng?.id && normalizeName(i.name) === norm
      );
      if (existingIng) {
        return {
          kind: 'ingredient',
          ingredient: existingIng,
          displayName: getLocalizedName(existingIng.name, existingIng.nameVi),
          reason: 'name',
        };
      }

      const existingProd = products.find(
        (p) => p.active && p.productType !== 'PREPARED_TO_ORDER' && normalizeName(p.name) === norm
      );
      if (existingProd) {
        return {
          kind: 'product',
          product: existingProd,
          displayName: getLocalizedName(existingProd.name, existingProd.nameVi),
          reason: 'name',
        };
      }
    }

    const cleanCode = normalizeBarcodeString(ingBarcode);
    if (cleanCode) {
      const conflicts = findDuplicateBarcodeConflicts(
        {
          id: editingIng?.id,
          itemType: 'ingredient',
          name: ingName.trim() || editingIng?.name || 'Ingredient',
          barcode: cleanCode,
        },
        products,
        barcodeRegistry,
        ingredients
      );
      const first = conflicts.find((c) => !c.isInternalDuplicate);
      if (first) {
        if (first.existingItemType === 'ingredient' && first.existingIngredientId) {
          const matchedIng = ingredients.find((i) => i.id === first.existingIngredientId);
          if (matchedIng) {
            return {
              kind: 'ingredient',
              ingredient: matchedIng,
              displayName: getLocalizedName(matchedIng.name, matchedIng.nameVi),
              reason: 'barcode',
              matchedCode: first.code,
            };
          }
        } else if (first.existingProductId) {
          const matchedProd = products.find((p) => p.id === first.existingProductId);
          if (matchedProd) {
            return {
              kind: 'product',
              product: matchedProd,
              displayName: getLocalizedName(matchedProd.name, matchedProd.nameVi),
              reason: 'barcode',
              matchedCode: first.code,
            };
          }
        }
      }
    }

    return null;
  }, [ingModalOpen, ingName, ingBarcode, ingredients, products, barcodeRegistry, editingIng?.id, editingIng?.name, isKm]);

  const exchangeRate = settings.posExchangeRate || settings.usdRate || 4000;

  // Stock-In / Quick Restock Purchase modal (supports Raw Ingredients & Retail Packaged + pack/carton multiplication)
  const [purchaseTarget, setPurchaseTarget] = useState<StockItemTarget | null>(null);
  const [purchaseUsePacks, setPurchaseUsePacks] = useState(false);
  const [selectedRestockPackId, setSelectedRestockPackId] = useState<string>('');
  const [purchasePackCount, setPurchasePackCount] = useState('1');
  const [purchaseUnitsPerPack, setPurchaseUnitsPerPack] = useState('24');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseCostKhr, setPurchaseCostKhr] = useState('');
  const [purchaseCostManual, setPurchaseCostManual] = useState(false);
  const [purchasePayment, setPurchasePayment] = useState<PaymentMethod>('cash');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [purchaseNote, setPurchaseNote] = useState('');

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

  const toTargetFromProduct = (p: Product): StockItemTarget => {
    const packs = getProductPackSizes(p);
    return {
      id: p.id,
      name: p.name,
      nameVi: p.nameVi,
      netSizeValue: p.netSizeValue,
      netSizeUnit: p.netSizeUnit,
      classification: 'packaged',
      unit: 'pcs',
      stockQty: p.stockQty,
      reorderLevel: p.reorderLevel,
      unitCostKhr: p.costPriceKhr,
      supplier: p.supplier,
      defaultUnitsPerPack: packs[0]?.unitsPerPack,
      packLabel: packs[0]?.label,
      packSizes: packs,
    };
  };

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

  // Unified 2-tier stock items list (Raw Ingredients & Retail Packaged)
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
        barcode: ing.barcode || undefined,
        status,
        progressPct: computeStockProgressPct(ing.stockQty, ing.reorderLevel),
        target: toTargetFromIngredient(ing),
        sourceIngredient: ing,
      });
    }

    for (const prod of packagedProducts) {
      const status: UnifiedStockItem['status'] =
        prod.stockQty <= 0 ? 'out' : prod.stockQty <= prod.reorderLevel ? 'low' : 'healthy';
      const firstPack = getProductPackSizes(prod)[0];
      items.push({
        id: prod.id,
        name: prod.name,
        nameVi: prod.nameVi,
        netSizeValue: prod.netSizeValue,
        netSizeUnit: prod.netSizeUnit,
        tier: 'packaged',
        categoryId: resolveProductCategoryId(prod, categories),
        unit: 'pcs',
        stockQty: prod.stockQty,
        reorderLevel: prod.reorderLevel,
        unitCostKhr: prod.costPriceKhr,
        supplier: prod.supplier,
        barcode: prod.barcode || undefined,
        packSummary: firstPack ? `${firstPack.label}` : undefined,
        status,
        progressPct: computeStockProgressPct(prod.stockQty, prod.reorderLevel),
        target: toTargetFromProduct(prod),
        sourceProduct: prod,
      });
    }

    // Sort urgently: Out of stock -> Low -> Healthy, then alphabetical
    const rank = (item: UnifiedStockItem) => {
      if (item.status === 'out') return 0;
      if (item.status === 'low') return 1;
      return 2;
    };
    return items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [ingredients, packagedProducts, categories]);

  // "Needs Attention Today" priority buckets
  const attentionItems = useMemo(() => {
    const outOfStock = allUnifiedItems.filter((item) => item.status === 'out');
    const lowStock = allUnifiedItems.filter((item) => item.status === 'low');
    const combined = [...outOfStock, ...lowStock];
    return {
      outOfStock,
      lowStock,
      combined,
    };
  }, [allUnifiedItems]);

  // Auto-clear active alert filter if its bucket becomes empty after restocking
  useEffect(() => {
    if (attentionFilter === 'none') return;
    if (
      (attentionFilter === 'all_urgent' && attentionItems.combined.length === 0) ||
      (attentionFilter === 'out' && attentionItems.outOfStock.length === 0) ||
      (attentionFilter === 'low' && attentionItems.lowStock.length === 0)
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

  // Valuation KPIs across Raw Ingredients & Retail Packaged
  const valuation = useMemo(() => {
    const packagedVal = packagedProducts.reduce(
      (s, p) => s + Math.max(0, p.stockQty) * Math.max(0, p.costPriceKhr),
      0
    );
    const ingVal = ingredients.reduce(
      (s, i) => s + Math.max(0, i.stockQty) * Math.max(0, i.unitCostKhr),
      0
    );
    return {
      packagedVal,
      ingVal,
      totalVal: packagedVal + ingVal,
    };
  }, [packagedProducts, ingredients]);

  const showNotice = (kind: 'ok' | 'err', text: string) => {
    setFeedbackMsg({ kind, text });
    window.setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const openPurchaseModal = (
    target: StockItemTarget,
    scannedPackUnits?: number,
    scannedPackId?: string
  ) => {
    setPurchaseTarget(target);
    setPurchaseCostManual(false);
    const configuredPacks = target.packSizes || [];
    const matchedScannedPack =
      (scannedPackId ? configuredPacks.find((pk) => pk.id === scannedPackId) : undefined) ||
      (scannedPackUnits && scannedPackUnits > 1
        ? configuredPacks.find((pk) => pk.unitsPerPack === scannedPackUnits) || configuredPacks[0]
        : configuredPacks[0]);
    const usePacks = Boolean(scannedPackId || (scannedPackUnits && scannedPackUnits > 1));
    setPurchaseUsePacks(usePacks);
    setSelectedRestockPackId(matchedScannedPack?.id || '');
    setPurchasePackCount('1');
    setPurchaseUnitsPerPack(
      String(matchedScannedPack?.unitsPerPack || scannedPackUnits || target.defaultUnitsPerPack || 24)
    );
    // Pre-suggest a practical restock quantity when item is low or out
    const suggestedQty =
      target.stockQty <= target.reorderLevel && target.reorderLevel > 0
        ? Math.max(1, Math.ceil(target.reorderLevel * 2 - Math.max(0, target.stockQty)))
        : '';
    setPurchaseQty(suggestedQty !== '' ? String(suggestedQty) : '');
    if (usePacks && matchedScannedPack && matchedScannedPack.costKhr > 0) {
      setPurchaseCostKhr(String(Math.round(matchedScannedPack.costKhr)));
    } else if (usePacks && target.unitCostKhr > 0) {
      const units = matchedScannedPack?.unitsPerPack || scannedPackUnits || target.defaultUnitsPerPack || 24;
      setPurchaseCostKhr(String(Math.round(units * target.unitCostKhr)));
    } else {
      const estCost =
        suggestedQty !== '' && target.unitCostKhr > 0
          ? Math.round(Number(suggestedQty) * target.unitCostKhr)
          : '';
      setPurchaseCostKhr(estCost !== '' ? String(estCost) : '');
    }
    setPurchasePayment('cash');
    setPurchaseSupplier(target.supplier || '');
    setPurchaseDate(todayIso());
    setPurchaseNote(usePacks && (matchedScannedPack?.label || target.packLabel) ? `Scanned ${matchedScannedPack?.label || target.packLabel}` : '');
  };

  const applyRestockPackSelection = (target: StockItemTarget, pack: PackOption, packCountNum: number) => {
    setPurchaseUsePacks(true);
    setSelectedRestockPackId(pack.id);
    setPurchaseUnitsPerPack(String(pack.unitsPerPack));
    const safeCount = Math.max(1, Math.round(packCountNum) || 1);
    if (!purchaseCostManual) {
      if (pack.costKhr > 0) {
        setPurchaseCostKhr(String(Math.round(safeCount * pack.costKhr)));
      } else if (target.unitCostKhr > 0) {
        setPurchaseCostKhr(String(Math.round(safeCount * pack.unitsPerPack * target.unitCostKhr)));
      }
    }
  };

  const openQuickRestockForItem = (item: UnifiedStockItem) => {
    openPurchaseModal(item.target);
  };

  const openAdjustWasteModal = (item: UnifiedStockItem, defaultMode: AdjustModalMode = 'waste') => {
    setAdjustModalTarget(item.target);
    setAdjustModalMode(defaultMode);
    setWasteKind('damaged');
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
    setScannedInventoryMatch(null);
    setScanLookingUp(true);

    try {
      const res = await lookupBarcode(cleaned);
      const effectiveCode = res.code || cleaned;

      // Automatically search the inventory catalog for the scanned barcode
      setActiveTab('all');
      setCategoryFilter('all');
      setStatusFilter('all');
      setAttentionFilter('none');
      setSearch(effectiveCode);

      if (res.found && res.ingredient) {
        triggerHighlightItem(res.ingredient.id);
        setScannedInventoryMatch({
          code: effectiveCode,
          format: res.format,
          itemType: 'ingredient',
          ingredient: res.ingredient,
          unitsPerScan: res.unitsPerScan,
          packLabel: res.packLabel,
        });
        return;
      }

      if (res.found && res.product) {
        triggerHighlightItem(res.product.id);
        const matchedPack =
          res.pack ||
          (res.unitsPerScan > 1
            ? getProductPackSizes(res.product).find(
                (pk) =>
                  pk.unitsPerPack === res.unitsPerScan &&
                  (!res.packLabel || pk.label === res.packLabel)
              )
            : undefined);
        setScannedInventoryMatch({
          code: effectiveCode,
          format: res.format,
          itemType: 'product',
          product: res.product,
          unitsPerScan: res.unitsPerScan,
          packId: matchedPack?.id,
          packLabel: matchedPack?.label || res.packLabel || getProductPackSizes(res.product)[0]?.label,
        });
        return;
      }

      setUnknownStockBarcode({
        code: effectiveCode,
        format: res.format,
        prefill: res.externalPrefill || null,
      });
    } finally {
      setScanLookingUp(false);
    }
  };

  useBarcodeScanner({
    enabled:
      !scannerOpen &&
      !ingBarcodeScannerOpen &&
      !purchaseTarget &&
      !ingModalOpen &&
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
      const nextCatName = getCategoryDisplayName(nextCat, isKm);
      const itemLabel = getLocalizedName(item.name, item.nameVi);

      if (item.sourceIngredient) {
        const ing = item.sourceIngredient;
        const res = await saveIngredient({
          id: ing.id,
          name: ing.name,
          nameVi: ing.nameVi,
          categoryId: nextCategoryId,
          barcode: ing.barcode,
          unit: ing.unit,
          stockQty: ing.stockQty,
          reorderLevel: ing.reorderLevel,
          unitCostKhr: ing.unitCostKhr,
          supplier: ing.supplier,
          updatedAt: ing.updatedAt,
        });
        if (!res.ok) {
          showNotice(
            'err',
            res.error || (isKm ? 'មិនអាចប្តូរប្រភេទបានទេ។' : 'Could not update category.')
          );
          return;
        }
      } else if (item.sourceProduct) {
        const prod = item.sourceProduct;
        const res = await saveProduct({
          id: prod.id,
          name: prod.name,
          nameVi: prod.nameVi,
          brand: prod.brand,
          netSizeValue: prod.netSizeValue,
          netSizeUnit: prod.netSizeUnit,
          productType: prod.productType,
          category: nextCategoryId,
          categoryId: nextCategoryId,
          priceKhr: prod.priceKhr,
          costPriceKhr: prod.costPriceKhr,
          markupPercent: prod.markupPercent,
          manualPriceOverride: prod.manualPriceOverride,
          allowSingleUnitSale: prod.allowSingleUnitSale,
          imageUrl: prod.imageUrl,
          active: prod.active,
          barcode: prod.barcode,
          packSizes: prod.packSizes,
          packagingBarcodes: prod.packagingBarcodes,
          stockQty: prod.stockQty,
          reorderLevel: prod.reorderLevel,
          unit: prod.productType === 'PACKAGED' ? 'pcs' : prod.unit,
          supplier: prod.supplier,
          recipe: prod.recipe,
          recipeVersion: prod.recipeVersion,
          variants: prod.variants,
        });
        if (!res.ok) {
          showNotice(
            'err',
            res.error || (isKm ? 'មិនអាចប្តូរប្រភេទបានទេ។' : 'Could not update category.')
          );
          return;
        }
      }

      triggerHighlightItem(item.id);
      showNoticeToast({
        message: isKm
          ? `បានផ្លាស់ប្តូរ "${itemLabel}" ទៅ ${nextCatName}`
          : `Moved "${itemLabel}" to ${nextCatName}`,
      });
    } finally {
      setUpdatingCategoryKey(null);
    }
  };

  const openNewIngredient = (initialBarcode?: string, initialName?: string) => {
    setEditingIng(null);
    setIngName(initialName || '');
    setIngNameVi(initialName || '');
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
    setIngBarcode(initialBarcode || '');
    setIngBarcodeScannerOpen(false);
    setIngSaveError(null);
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
    setIngBarcode(ing.barcode || '');
    setIngBarcodeScannerOpen(false);
    setIngSaveError(null);
    setIngModalOpen(true);
  };

  // Handle cross-view restock/edit requests (e.g. from ProductFormModal duplicate guard)
  useEffect(() => {
    if (!pendingTarget) return;
    if (pendingTarget.kind === 'ingredient') {
      const ing = ingredients.find((i) => i.id === pendingTarget.id);
      if (ing) {
        setActiveTab('ingredients');
        triggerHighlightItem(ing.id);
        if (pendingTarget.mode === 'edit') {
          openEditIngredient(ing);
        } else {
          openPurchaseModal(toTargetFromIngredient(ing));
        }
      }
      onPendingTargetHandled?.();
      return;
    }

    const prod = products.find((p) => p.id === pendingTarget.id);
    if (prod) {
      triggerHighlightItem(prod.id);
      if (pendingTarget.mode === 'edit') {
        setEditingStockProduct(prod);
      } else if (prod.productType === 'PACKAGED') {
        setActiveTab('packaged');
        openPurchaseModal(toTargetFromProduct(prod));
      } else {
        setActiveTab('ingredients');
        const label = getLocalizedName(prod.name, prod.nameVi);
        showNotice(
          'ok',
          isKm
            ? `"${label}" ជាទំនិញធ្វើតាមការកុម្ម៉ង់ — សូមបញ្ចូលស្តុកវត្ថុធាតុដើមខាងក្រោម។`
            : `"${label}" is Made-to-Order — restock its Raw Ingredients below.`
        );
      }
    }
    onPendingTargetHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget]);

  const handleCreateInlineIngCategory = async () => {
    const trimmed = newIngCategoryName.trim();
    if (!trimmed) {
      setNewIngCategoryError(
        isKm ? 'សូមបញ្ចូលឈ្មោះប្រភេទ។' : 'Please enter a category name.'
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
          res.error || (isKm ? 'មិនអាចបង្កើតប្រភេទបានទេ។' : 'Could not create category.')
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
    if (!trimmedName || ingDuplicateGuard) return;
    setIngSaveError(null);
    const cleanCode = normalizeBarcodeString(ingBarcode);
    const res = await saveIngredient({
      id: editingIng?.id,
      name: trimmedName,
      nameVi: ingNameVi.trim() || trimmedName,
      categoryId: ingCategoryId || UNCATEGORIZED_ID,
      barcode: cleanCode || undefined,
      unit: ingUnit,
      stockQty: Number(ingStock) || 0,
      reorderLevel: Math.max(0, Number(ingReorder) || 0),
      unitCostKhr: Math.max(0, Number(ingCost) || 0),
      supplier: ingSupplier.trim(),
    });
    if (!res.ok || !res.id) {
      setIngSaveError(
        res.error ||
          (isKm ? 'មិនអាចរក្សាទុកវត្ថុធាតុដើមបានទេ (ឈ្មោះមានរួចហើយ)។' : 'Could not save ingredient.')
      );
      return;
    }
    triggerHighlightItem(res.id);
    if (unknownStockBarcode && cleanCode && unknownStockBarcode.code === cleanCode) {
      setUnknownStockBarcode(null);
    }

    if (mode === 'add_another' && !editingIng) {
      showNoticeToast({
        message: isKm ? `បានរក្សាទុក "${trimmedName}"` : `Saved "${trimmedName}"`,
        detail: isKm
          ? 'រួចរាល់សម្រាប់វត្ថុធាតុដើមបន្ទាប់ (បានរក្សាប្រភេទ និងឯកតា)។'
          : 'Ready for next ingredient (category & unit kept).',
      });
      // Reset per-item fields while retaining smart defaults (category, unit, reorder level, supplier)
      setIngName('');
      setIngNameVi('');
      setIngBarcode('');
      setIngStock('0');
      setIngCost('10');
      setIngSaveError(null);
      window.requestAnimationFrame(() => ingNameInputRef.current?.focus());
      return;
    }

    setIngModalOpen(false);
    showNotice(
      'ok',
      editingIng
        ? isKm
          ? `បានកែប្រែវត្ថុធាតុដើម "${trimmedName}"។`
          : `Updated ingredient "${trimmedName}".`
        : isKm
          ? `បានបន្ថែមវត្ថុធាតុដើម "${trimmedName}"។`
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
      isKm
        ? `បានបញ្ចូលស្តុក +${formatQty(effectiveQty, purchaseTarget.unit)} ${getLocalizedName(purchaseTarget.name, purchaseTarget.nameVi)}។`
        : `Restocked +${formatQty(effectiveQty, purchaseTarget.unit)} ${purchaseTarget.name}.`
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
        showNotice('err', res.error || (isKm ? 'មិនអាចកត់ត្រាការរាប់ស្តុកបានទេ។' : 'Could not record stock count.'));
        return;
      }
      setAdjustModalTarget(null);
      showNotice('ok', isKm ? 'បានកត់ត្រាការរាប់ស្តុកជាក់ស្តែង។' : 'Physical stock count recorded.');
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
        showNotice('err', res.error || (isKm ? 'មិនអាចកត់ត្រាស្តុកដើមគ្រាបានទេ។' : 'Could not record opening stock.'));
        return;
      }
      setAdjustModalTarget(null);
      showNotice(
        'ok',
        isKm
          ? `បានកត់ត្រាស្តុកដើមគ្រាសម្រាប់ ${getLocalizedName(adjustModalTarget.name, adjustModalTarget.nameVi)}។`
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
        showNotice('err', res.error || (isKm ? 'មិនអាចកត់ត្រាការខូចខាតបានទេ។' : 'Could not log waste.'));
        return;
      }
      setAdjustModalTarget(null);
      showNotice(
        'ok',
        isKm
          ? `បានកត់ត្រាការខូចខាត -${formatQty(qty, adjustModalTarget.unit)}។`
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
      showNotice('err', res.error || (isKm ? 'មិនអាចកែសម្រួលស្តុកបានទេ។' : 'Could not adjust stock.'));
      return;
    }
    setAdjustModalTarget(null);
    showNotice('ok', isKm ? 'បានកត់ត្រាការកែសម្រួលស្តុក។' : 'Stock adjustment recorded.');
  };

  // Filtered stock items for active tier tab + status filter + search
  const q = search.trim().toLowerCase();

  const filteredStockItems = useMemo(() => {
    return allUnifiedItems.filter((item) => {
      if (activeTab === 'ingredients' && item.tier !== 'ingredient') return false;
      if (activeTab === 'packaged' && item.tier !== 'packaged') return false;

      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) return false;

      if (attentionFilter === 'all_urgent') {
        const isUrgent = item.status === 'out' || item.status === 'low';
        if (!isUrgent) return false;
      } else if (attentionFilter === 'out') {
        if (item.status !== 'out') return false;
      } else if (attentionFilter === 'low') {
        if (item.status !== 'low') return false;
      }

      if (statusFilter === 'out' && item.status !== 'out') return false;
      if (statusFilter === 'low' && item.status !== 'low') return false;
      if (statusFilter === 'healthy' && item.status !== 'healthy') return false;

      if (!q) return true;
      const itemBarcodes = [
        item.barcode,
        ...getProductPackSizes(item.sourceProduct).map((pk) => pk.barcode),
        ...(item.sourceProduct?.variants || []).map((v) => v.barcode),
      ];
      return (
        item.name.toLowerCase().includes(q) ||
        item.nameVi.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q) ||
        matchesBarcodeSearch(itemBarcodes, search)
      );
    });
  }, [allUnifiedItems, activeTab, categoryFilter, attentionFilter, statusFilter, q, search]);

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
        label: isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients',
        badgeClass: getStockClassificationBadgeClass('ingredient'),
        icon: Wheat,
        hintText: isKm
          ? 'វាស់តាមទម្ងន់ ឬមាឌ។ កាត់ស្តុកដោយស្វ័យប្រវត្តិតាមរូបមន្ត ពេលលក់ទំនិញធ្វើតាមការកុម្ម៉ង់លើ POS។'
          : 'Measured by weight or volume. Automatically deducted via recipe on Made-to-Order POS sales.',
      };
    }
    return {
      label: isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged',
      badgeClass: getStockClassificationBadgeClass('packaged'),
      icon: Package,
      hintText: isKm
        ? 'ដប កំប៉ុង និងនំចំណី គ្រប់គ្រងតាមឯកតា ឬកេស។ កាត់ស្តុកដោយផ្ទាល់ពេលគិតប្រាក់លើ POS។'
        : 'Bottles, cans, and snacks tracked by unit or carton count. Deducted directly at POS checkout.',
    };
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-5">
      {/* Row 1: Minimalist Page Header — Title, Single Subtitle Line & Strictly 2 Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/60 dark:border-emerald-950/50">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="font-display text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {t.inventory.title}
            </h1>
            <InfoHint
              label={isKm ? 'អំពីការគ្រប់គ្រងស្តុក' : 'About Inventory Management'}
              text={
                isKm
                  ? 'ត្រួតពិនិត្យស្តុកជិតអស់ និងបញ្ចូលស្តុកប្រចាំថ្ងៃសម្រាប់វត្ថុធាតុដើម និងទំនិញវេចខ្ចប់ស្រាប់។'
                  : 'Daily stock checks and restocking across Raw Ingredients and Retail Packaged goods.'
              }
            />
          </div>
          <p className="mt-1 text-xs sm:text-sm text-stone-500 dark:text-[#94A39B] font-mono-num flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {t.inventory.stockValue}:{' '}
              <span className="font-semibold text-stone-700 dark:text-[#D5DFDA]">
                {formatKhr(valuation.totalVal)}
              </span>
            </span>
            <span className="text-stone-300 dark:text-[#2F463A]" aria-hidden="true">
              ·
            </span>
            <span>
              {isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients'}:{' '}
              <span className="font-medium text-teal-700 dark:text-teal-400">
                {formatKhr(valuation.ingVal)}
              </span>
            </span>
            <span className="text-stone-300 dark:text-[#2F463A]" aria-hidden="true">
              ·
            </span>
            <span>
              {isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged'}:{' '}
              <span className="font-medium text-sky-700 dark:text-sky-400">
                {formatKhr(valuation.packagedVal)}
              </span>
            </span>
            <span className="text-stone-300 dark:text-[#2F463A]" aria-hidden="true">
              ·
            </span>
            {attentionItems.combined.length === 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-sans font-medium bg-emerald-50/90 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>{isKm ? 'ស្តុកគ្រប់គ្រាន់ទាំងអស់' : 'All Stock Healthy'}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-sans font-medium bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-700/40">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>
                  {attentionItems.combined.length}{' '}
                  {isKm ? 'ត្រូវពិនិត្យ' : 'need attention'}
                </span>
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'movements'}
            onClick={() => setActiveTab(activeTab === 'movements' ? 'all' : 'movements')}
            className={`inline-flex items-center justify-center gap-1.5 h-11 px-3.5 text-sm font-medium rounded-lg border transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap ${
              activeTab === 'movements'
                ? 'bg-emerald-50/80 border-emerald-500/40 text-[#0F5C43] dark:bg-[#064E3B]/70 dark:border-[#10B981]/50 dark:text-[#6EE7B7]'
                : 'text-stone-600 dark:text-[#A8B8B0] bg-transparent border-slate-200/80 dark:border-emerald-950/80 hover:bg-stone-100/80 dark:hover:bg-[#18251F] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span>{isKm ? 'ប្រវត្តិស្តុក' : 'History'}</span>
          </button>

          <button
            type="button"
            onClick={() => openNewIngredient()}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg shadow-2xs transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t.inventory.addIngredient}</span>
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

      {/* Matched Scanned Barcode Banner (supports Products & Raw Ingredients via barcodeRegistry) */}
      {scannedInventoryMatch && (
        <div
          role="status"
          className="bg-emerald-50 dark:bg-[#064E3B]/75 border border-emerald-200 dark:border-[#10B981]/45 text-emerald-950 dark:text-[#D1FAE5] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-drawer-in"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0 mt-0.5" />
            <div className="min-w-0">
              {scannedInventoryMatch.itemType === 'ingredient' && scannedInventoryMatch.ingredient ? (
                <>
                  <p className="text-sm font-semibold truncate">
                    {isKm ? 'បានរកឃើញវត្ថុធាតុដើម' : 'Matched Raw Ingredient'}:{' '}
                    {getLocalizedName(
                      scannedInventoryMatch.ingredient.name,
                      scannedInventoryMatch.ingredient.nameVi
                    )}
                  </p>
                  <p className="text-xs opacity-85 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <span className="font-mono-num">
                      {formatBarcodeTypeLabel(scannedInventoryMatch.format)} ·{' '}
                      {scannedInventoryMatch.code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">
                      {isKm ? 'ក្នុងស្តុក' : 'In stock'}:{' '}
                      {formatQty(
                        scannedInventoryMatch.ingredient.stockQty,
                        scannedInventoryMatch.ingredient.unit
                      )}
                    </span>
                  </p>
                </>
              ) : scannedInventoryMatch.product ? (
                <>
                  <p className="text-sm font-semibold truncate">
                    {isKm ? 'បានរកឃើញ' : 'Matched'}:{' '}
                    {getLocalizedName(
                      scannedInventoryMatch.product.name,
                      scannedInventoryMatch.product.nameVi
                    )}
                  </p>
                  <p className="text-xs opacity-85 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <span className="font-mono-num">
                      {formatBarcodeTypeLabel(scannedInventoryMatch.format)} ·{' '}
                      {scannedInventoryMatch.code}
                    </span>
                    <span aria-hidden="true">·</span>
                    {scannedInventoryMatch.product.productType === 'PREPARED_TO_ORDER' ? (
                      <span>
                        {isKm
                          ? 'ធ្វើតាមការកុម្ម៉ង់ — តាមដានតាមវត្ថុធាតុដើម'
                          : 'Made-to-Order — tracked via raw ingredients'}
                      </span>
                    ) : (
                      <span className="font-mono-num">
                        {isKm ? 'ក្នុងស្តុក' : 'In stock'}:{' '}
                        {formatQty(
                          scannedInventoryMatch.product.stockQty,
                          scannedInventoryMatch.product.unit || 'pcs'
                        )}
                        {scannedInventoryMatch.unitsPerScan > 1
                          ? ` (${scannedInventoryMatch.packLabel || `${scannedInventoryMatch.unitsPerScan}x pack`})`
                          : ''}
                      </span>
                    )}
                  </p>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {scannedInventoryMatch.itemType === 'ingredient' && scannedInventoryMatch.ingredient ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const ing = scannedInventoryMatch.ingredient!;
                    openPurchaseModal({
                      ...toTargetFromIngredient(ing),
                      barcodeScanned: scannedInventoryMatch.code,
                    });
                  }}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                >
                  {isKm ? '+ បញ្ចូលស្តុក' : '+ Restock'}
                </button>
                <button
                  type="button"
                  onClick={() => openEditIngredient(scannedInventoryMatch.ingredient!)}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-[#D1FAE5] bg-white/90 dark:bg-[#131D18] border border-emerald-300 dark:border-[#10B981]/40 hover:bg-white dark:hover:bg-[#18251F] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t.common.edit}
                </button>
              </>
            ) : scannedInventoryMatch.product ? (
              <>
                {scannedInventoryMatch.product.productType === 'PACKAGED' && (
                  <button
                    type="button"
                    onClick={() => {
                      const prod = scannedInventoryMatch.product!;
                      const target: StockItemTarget = {
                        ...toTargetFromProduct(prod),
                        barcodeScanned: scannedInventoryMatch.code,
                        packLabel: scannedInventoryMatch.packLabel,
                      };
                      openPurchaseModal(
                        target,
                        scannedInventoryMatch.unitsPerScan > 1
                          ? scannedInventoryMatch.unitsPerScan
                          : undefined,
                        scannedInventoryMatch.packId
                      );
                    }}
                    className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                  >
                    {isKm ? '+ បញ្ចូលស្តុក' : '+ Restock'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingStockProduct(scannedInventoryMatch.product!)}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-[#D1FAE5] bg-white/90 dark:bg-[#131D18] border border-emerald-300 dark:border-[#10B981]/40 hover:bg-white dark:hover:bg-[#18251F] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t.common.edit}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setScannedInventoryMatch(null);
                setSearch('');
              }}
              className="h-9 px-2.5 inline-flex items-center justify-center text-xs font-semibold rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              {isKm ? 'សម្អាត' : 'Clear'}
            </button>
          </div>
        </div>
      )}

      {/* Unregistered Stock-In Barcode Prompt */}
      {unknownStockBarcode && (
        <div
          role="status"
          className="bg-white dark:bg-[#131D18] border border-stone-300 dark:border-[#24352C] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-drawer-in"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {isKm ? 'មិនមានទំនិញក្នុងស្តុកត្រូវនឹងបាកូដ' : 'No inventory item matches'}:{' '}
                <span className="font-mono-num text-[#0F5C43] dark:text-[#34D399]">
                  {unknownStockBarcode.code}
                </span>{' '}
                <span className="text-xs font-normal text-stone-500 dark:text-[#94A39B]">
                  ({formatBarcodeTypeLabel(unknownStockBarcode.format)})
                </span>
              </p>
              <p className="text-xs text-stone-600 dark:text-[#94A39B] mt-0.5 truncate">
                {unknownStockBarcode.prefill
                  ? isKm
                    ? `ណែនាំពី Open Food Facts៖ ${unknownStockBarcode.prefill.name}${unknownStockBarcode.prefill.brand ? ` · ${unknownStockBarcode.prefill.brand}` : ''}`
                    : `Prefill from Open Food Facts: ${unknownStockBarcode.prefill.name}${unknownStockBarcode.prefill.brand ? ` · ${unknownStockBarcode.prefill.brand}` : ''}`
                  : isKm
                    ? 'រកមិនឃើញក្នុងប្រព័ន្ធខាងក្រៅ — សូមភ្ជាប់បាកូដនេះទៅផលិតផល ឬវត្ថុធាតុដើមថ្មី។'
                    : 'Not found externally — link this barcode to a new product or raw ingredient.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center">
            <button
              type="button"
              onClick={() => setQuickRegisterOpen(true)}
              className="h-11 inline-flex items-center justify-center px-3.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
            >
              {isKm ? '+ ចុះឈ្មោះផលិតផល' : '+ Register Product'}
            </button>
            <button
              type="button"
              onClick={() =>
                openNewIngredient(unknownStockBarcode.code, unknownStockBarcode.prefill?.name)
              }
              className="h-11 inline-flex items-center justify-center px-3.5 text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/80 dark:hover:bg-[#065F46] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
            >
              {isKm ? '+ បន្ថែមវត្ថុធាតុដើម' : '+ Add Ingredient'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUnknownStockBarcode(null);
                setSearch('');
              }}
              aria-label={t.common.close}
              className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Compact Single-Line Needs Attention Quick-Filter Strip (only when urgent items exist) */}
      {attentionItems.combined.length > 0 && activeTab !== 'movements' && (
        <section
          aria-label={isKm ? 'ត្រូវពិនិត្យថ្ងៃនេះ' : 'Needs Attention Today'}
          className="needs-attention-container min-h-12 py-2 px-3.5 rounded-xl bg-amber-50/45 dark:bg-amber-950/15 border border-amber-200/60 dark:border-amber-800/35 flex flex-wrap items-center justify-between gap-2 transition-all duration-150 ease-out animate-drawer-in"
        >
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <div className="inline-flex items-center gap-1.5 pr-1 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] whitespace-nowrap">
                {isKm ? 'ត្រូវពិនិត្យ' : 'Needs Attention'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleSelectAttentionFilter('all_urgent')}
              aria-pressed={attentionFilter === 'all_urgent'}
              className={`h-8 px-2.5 text-xs font-medium rounded-full border transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap inline-flex items-center gap-1 ${
                attentionFilter === 'all_urgent'
                  ? 'border-stone-900 bg-stone-900 text-white dark:border-[#10B981] dark:bg-[#10B981] dark:text-[#042419]'
                  : 'border-slate-200/80 dark:border-emerald-950/80 bg-white/90 dark:bg-[#131D18] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F]'
              }`}
            >
              <span>{isKm ? 'បន្ទាន់ទាំងអស់' : 'All Urgent'}</span>
              <span className="font-mono-num opacity-80">({attentionItems.combined.length})</span>
            </button>

            {attentionItems.outOfStock.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelectAttentionFilter('out')}
                aria-pressed={attentionFilter === 'out'}
                className={`h-8 px-2.5 text-xs font-medium rounded-full border transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap inline-flex items-center gap-1 ${
                  attentionFilter === 'out'
                    ? 'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500 dark:text-white'
                    : 'border-red-200/70 dark:border-red-500/35 bg-red-50/80 dark:bg-red-950/35 text-red-700 dark:text-red-200 hover:bg-red-100/80 dark:hover:bg-red-950/60'
                }`}
              >
                <span>{t.inventory.statusOut}</span>
                <span className="font-mono-num opacity-80">({attentionItems.outOfStock.length})</span>
              </button>
            )}

            {attentionItems.lowStock.length > 0 && (
              <button
                type="button"
                onClick={() => handleSelectAttentionFilter('low')}
                aria-pressed={attentionFilter === 'low'}
                className={`h-8 px-2.5 text-xs font-medium rounded-full border transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap inline-flex items-center gap-1 ${
                  attentionFilter === 'low'
                    ? 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-stone-950'
                    : 'border-amber-200/70 dark:border-amber-500/35 bg-amber-50/80 dark:bg-amber-950/35 text-amber-800 dark:text-amber-200 hover:bg-amber-100/80 dark:hover:bg-amber-950/60'
                }`}
              >
                <span>{t.inventory.statusLow}</span>
                <span className="font-mono-num opacity-80">({attentionItems.lowStock.length})</span>
              </button>
            )}
          </div>

          {attentionFilter !== 'none' && (
            <button
              type="button"
              onClick={() => setAttentionFilter('none')}
              className="h-8 px-2.5 text-xs font-medium text-stone-600 hover:text-stone-900 dark:text-[#A8B8B0] dark:hover:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
            >
              {isKm ? 'បង្ហាញទាំងអស់' : 'Show All'}
            </button>
          )}
        </section>
      )}

      {/* Row 2: Unboxed Single-Strip Toolbar (Search & Filters Left → Segmented Tabs Right, Identical to ProductsView) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Side: Search (with integrated barcode icon), Filters toggle & conditional Reset */}
          <div className="flex items-center gap-2.5 flex-1 min-w-[260px] flex-wrap sm:flex-nowrap">
            <div className="relative flex-1 max-w-md min-w-[160px]">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#6E8278] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (scannedInventoryMatch) setScannedInventoryMatch(null);
                }}
                placeholder={isKm ? 'ស្វែងរក...' : 'Search'}
                className={`w-full h-11 pl-9 ${search ? 'pr-20' : 'pr-11'} text-sm bg-white/80 dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#6E8278] border border-slate-200/80 dark:border-emerald-950/80 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]/30 dark:focus-visible:ring-[#10B981]/40 focus-visible:border-[#0F5C43] dark:focus-visible:border-[#10B981] transition-all duration-150`}
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setScannedInventoryMatch(null);
                      setUnknownStockBarcode(null);
                    }}
                    className="w-9 h-9 inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-md transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={scanLookingUp}
                  onClick={() => setScannerOpen(true)}
                  title={isKm ? 'ស្កេនបាកូដ (EAN-13 / UPC-A)' : 'Scan Barcode (EAN-13 / UPC-A)'}
                  aria-label={isKm ? 'ស្កេនបាកូដ' : 'Scan Barcode'}
                  className="w-9 h-9 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-emerald-50/70 dark:hover:bg-[#064E3B]/50 rounded-md transition-colors"
                >
                  {scanLookingUp ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#0F5C43] dark:text-[#34D399]" />
                  ) : (
                    <ScanBarcode className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {activeTab !== 'movements' ? (
              <>
                <button
                  type="button"
                  onClick={toggleFilters}
                  aria-expanded={filtersOpen}
                  aria-controls="inventory-stock-filters"
                  className={`inline-flex items-center gap-1.5 h-11 px-3 text-xs sm:text-sm font-medium rounded-lg border transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0 ${
                    filtersOpen || drawerFilterCount > 0
                      ? 'bg-stone-100/90 dark:bg-[#18251F] border-slate-300/90 dark:border-emerald-800/60 text-stone-900 dark:text-[#F1F5F3]'
                      : 'bg-transparent border-slate-200/80 dark:border-emerald-950/80 text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100/70 dark:hover:bg-[#18251F]'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                  <span>{isKm ? 'តម្រង' : 'Filters'}</span>
                  {drawerFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-mono-num font-semibold bg-[#0F5C43]/12 text-[#0F5C43] dark:bg-[#10B981]/20 dark:text-[#6EE7B7]">
                      {drawerFilterCount}
                    </span>
                  )}
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] transition-transform duration-150 motion-reduce:transition-none ${
                      filtersOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {hasActiveStockFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('all');
                      setStatusFilter('all');
                      setAttentionFilter('none');
                      setSearch('');
                      setScannedInventoryMatch(null);
                      setUnknownStockBarcode(null);
                    }}
                    className="inline-flex items-center justify-center h-11 px-2 text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-[#94A39B] dark:hover:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
                  >
                    {isKm ? 'កំណត់ឡើងវិញ' : 'Reset'}
                  </button>
                )}
              </>
            ) : (
              <>
                <select
                  value={movementTierFilter}
                  onChange={(e) =>
                    setMovementTierFilter(e.target.value as 'ALL' | StockClassification)
                  }
                  className="h-11 px-3 text-xs sm:text-sm border border-slate-200/80 dark:border-emerald-950/80 rounded-lg bg-white/80 dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3]"
                >
                  <option value="ALL">{isKm ? 'គ្រប់ក្រុមស្តុក' : 'All Tiers'}</option>
                  <option value="ingredient">{isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients'}</option>
                  <option value="packaged">{isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged'}</option>
                </select>
                <select
                  value={movementTypeFilter}
                  onChange={(e) => setMovementTypeFilter(e.target.value as 'ALL' | MovementType)}
                  className="h-11 px-3 text-xs sm:text-sm border border-slate-200/80 dark:border-emerald-950/80 rounded-lg bg-white/80 dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3]"
                >
                  <option value="ALL">{isKm ? 'គ្រប់ប្រភេទ' : 'All Types'}</option>
                  {(Object.keys(t.movementTypes) as MovementType[]).map((mt) => (
                    <option key={mt} value={mt}>
                      {t.movementTypes[mt]}
                    </option>
                  ))}
                </select>
                {hasActiveMovementFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setMovementTierFilter('ALL');
                      setMovementTypeFilter('ALL');
                      setSearch('');
                    }}
                    className="inline-flex items-center justify-center h-11 px-2 text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-[#94A39B] dark:hover:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
                  >
                    {isKm ? 'កំណត់ឡើងវិញ' : 'Reset'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Right Side: Compact Segmented Item-Type Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-0 max-w-full overflow-x-auto">
              <div
                role="tablist"
                aria-label={isKm ? 'ក្រុមស្តុកទំនិញ' : 'Inventory tiers'}
                className="inline-flex items-center gap-0.5 h-11 p-1 bg-stone-100/90 dark:bg-[#131D18] border border-slate-200/60 dark:border-emerald-950/60 rounded-xl"
              >
                {(
                  [
                    {
                      id: 'all',
                      label: t.common.all,
                      count: allUnifiedItems.length,
                      icon: null,
                      iconClass: '',
                    },
                    {
                      id: 'ingredients',
                      label: isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients',
                      count: ingredients.length,
                      icon: Wheat,
                      iconClass: 'text-teal-600 dark:text-teal-400',
                    },
                    {
                      id: 'packaged',
                      label: isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged',
                      count: packagedProducts.length,
                      icon: Package,
                      iconClass: 'text-sky-600 dark:text-sky-400',
                    },
                  ] as const
                ).map((tab) => {
                  const active = activeTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(tab.id)}
                      className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs sm:text-sm rounded-lg transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-white dark:bg-[#1F3028] text-stone-900 dark:text-[#F1F5F3] font-semibold shadow-2xs'
                          : 'text-stone-500 dark:text-[#94A39B] font-medium hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                      }`}
                    >
                      {TabIcon && <TabIcon className={`w-3.5 h-3.5 shrink-0 ${tab.iconClass}`} />}
                      <span>{tab.label}</span>
                      <span className="font-mono-num text-[11px] opacity-65">
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Category & Stock Status Pills Drawer (Unboxed, Hairline Top Divider) */}
        {activeTab !== 'movements' && (
          <div
            id="inventory-stock-filters"
            className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
              filtersOpen
                ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-slate-200/60 dark:border-emerald-950/50 animate-drawer-in'
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
                  isKm={isKm}
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
                        ['healthy', t.inventory.statusHealthy],
                        ['low', t.inventory.statusLow],
                        ['out', t.inventory.statusOut],
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
                        className={`h-10 px-3.5 text-xs font-medium rounded-full transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap shrink-0 border ${
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
                  {isKm ? 'មិនមានទំនិញក្នុងស្តុកត្រូវគ្នាទេ' : 'No matching inventory items'}
                </p>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {search ||
                  statusFilter !== 'all' ||
                  categoryFilter !== 'all' ||
                  attentionFilter !== 'none'
                    ? isKm
                      ? 'សូមសាកល្បងសម្អាតពាក្យស្វែងរក ឬប្តូរតម្រងប្រភេទ និងស្ថានភាព។'
                      : 'Try clearing your search or changing the category or status filter.'
                    : activeTab === 'packaged'
                      ? isKm
                        ? 'បន្ថែមផលិតផលទំនិញវេចខ្ចប់ស្រាប់ក្នុងទំព័រផលិតផល ដើម្បីតាមដានស្តុកនៅទីនេះ។'
                        : 'Add a Retail Packaged product under Products to track its unit stock here.'
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
                  <div>{isKm ? 'ទំនិញ' : 'Item'}</div>
                  <div>{isKm ? 'ថ្លៃដើម និងតម្លៃ' : 'Cost & Value'}</div>
                  <div>{isKm ? 'ស្ថានភាពស្តុក' : 'Stock Health'}</div>
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

                    const TierIcon = tierMeta.icon;
                    const packUnitDetail = item.packSummary
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
                                  ? isKm
                                    ? 'បង្រួមព័ត៌មានលម្អិត'
                                    : 'Collapse details'
                                  : isKm
                                    ? 'ពង្រីកព័ត៌មានលម្អិត'
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
                                {getLocalizedName(item.name, item.nameVi)}
                              </h3>
                              <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#94A39B] min-w-0">
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-medium shrink-0 ${tierMeta.badgeClass}`}
                                >
                                  <TierIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{tierMeta.label}</span>
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-stone-300 dark:text-[#344B3F] shrink-0"
                                >
                                  ·
                                </span>
                                <span className="truncate">
                                  {getCategoryDisplayName(catItem, isKm)}
                                </span>
                              </div>
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
                                {isKm ? 'ថ្លៃដើម៖' : 'Avg:'} {formatKhr(item.unitCostKhr)}
                              </span>
                              {isZeroCost && (
                                <button
                                  type="button"
                                  onClick={() => openEditItem(item)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
                                >
                                  <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{isKm ? 'កំណត់ថ្លៃដើម' : 'Set Cost'}</span>
                                </button>
                              )}
                            </div>
                            <p className="font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] lg:mt-0.5 whitespace-nowrap">
                              {isKm ? 'តម្លៃសរុប៖' : 'Val:'} {formatKhr(stockValueKhr)}
                            </p>
                          </div>

                          {/* Column 3: Stock Health & Bar */}
                          <div className="min-w-0 pl-9 lg:pl-0 space-y-1.5">
                            {(() => {
                              const stockDisplay =
                                item.tier === 'packaged' && (item.target.packSizes?.length ?? 0) > 0
                                  ? formatStockWithCartons(
                                      item.stockQty,
                                      item.unit,
                                      item.target.packSizes || [],
                                      isKm
                                    )
                                  : null;
                              return (
                                <div className="flex items-baseline justify-between gap-2 min-w-0">
                                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0">
                                    <span className="font-mono-num text-sm sm:text-[15px] font-bold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                                      {formatQty(item.stockQty, item.unit)}
                                    </span>
                                    {stockDisplay?.cartonBreakdown && (
                                      <span className="font-mono-num text-[11px] font-semibold text-sky-700 dark:text-sky-400 whitespace-nowrap">
                                        · {stockDisplay.cartonBreakdown}
                                      </span>
                                    )}
                                    <span className="font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] whitespace-nowrap truncate">
                                      / {isKm ? 'កម្រិតអប្បបរមា' : 'min'}{' '}
                                      {formatQty(item.reorderLevel, item.unit)}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1 shrink-0 ${statusTextClass}`}
                                  >
                                    {statusLabel}
                                  </span>
                                </div>
                              );
                            })()}

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
                              className="flex-1 lg:flex-none h-10 px-3 inline-flex items-center justify-center text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/80 dark:hover:bg-[#065F46] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                            >
                              {isKm ? '+ បញ្ចូលស្តុក' : '+ Restock'}
                            </button>

                            <button
                              type="button"
                              onClick={() => openAdjustWasteModal(item)}
                              title={isKm ? 'កែសម្រួល / ខូចខាត' : 'Adjust / Waste'}
                              aria-label={isKm ? 'កែសម្រួល / ខូចខាត' : 'Adjust / Waste'}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-all active:scale-[0.97] shrink-0"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditItem(item)}
                              title={t.common.edit}
                              aria-label={t.common.edit}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-all active:scale-[0.97] shrink-0"
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
                                  {isKm ? 'លេខកូដ SKU / បាកូដ' : 'SKU / Barcode'}
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
                                  {isKm ? 'កញ្ចប់ / ឯកតា' : 'Pack / Unit'}
                                </p>
                                <p className="mt-0.5 text-stone-800 dark:text-[#F1F5F3] break-words">
                                  {packUnitDetail}
                                </p>
                              </div>

                              <div className="min-w-0">
                                <label
                                  htmlFor={`inline-cat-${rowKey}`}
                                  className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1"
                                >
                                  {isKm ? 'ប្រភេទ' : 'Category'}
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
                                      {getCategoryDisplayName(cat, isKm)}
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
                      {isKm ? 'ទំនិញ / ក្រុម' : 'Item / Tier'}
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
                            isKm
                              ? 'មូលហេតុនៃការផ្លាស់ប្តូរស្តុក៖ ការទិញចូល ស្តុកដើមគ្រា ការលក់ POS ការរាប់ស្តុក ឬខូចខាត។'
                              : 'Audit reason for each stock change: purchase, opening stock, POS sale, count, or spoilage.'
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
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIngModalOpen(false);
            }}
          >
            <div className="w-full max-w-md max-h-[92vh] sm:max-h-[90vh] flex flex-col bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl animate-modal">
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
                  onChange={(e) => {
                    setIngName(e.target.value);
                    if (ingSaveError) setIngSaveError(null);
                  }}
                  className={`w-full h-11 px-3.5 text-sm border rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 ${
                    ingDuplicateGuard
                      ? 'border-amber-400 dark:border-amber-500/70 focus-visible:ring-amber-500'
                      : 'border-stone-200 dark:border-[#24352C] focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]'
                  }`}
                />
              </div>

              {ingDuplicateGuard && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-600/50 space-y-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-950 dark:text-amber-200">
                        {isKm
                          ? `"${ingDuplicateGuard.displayName}" មានរួចហើយ`
                          : `"${ingDuplicateGuard.displayName}" already exists`}
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
                        {ingDuplicateGuard.reason === 'barcode'
                          ? isKm
                            ? `បាកូដ ${ingDuplicateGuard.matchedCode} ត្រូវបានចុះបញ្ជីសម្រាប់ទំនិញនេះរួចហើយ។ សូមកែប្រែ ឬបញ្ចូលស្តុកបន្ថែម ជំនួសឱ្យការបង្កើតស្ទួន។`
                            : `Barcode ${ingDuplicateGuard.matchedCode} is already registered to this item in barcodeRegistry. Edit or restock it instead of creating a duplicate.`
                          : ingDuplicateGuard.kind === 'ingredient'
                            ? isKm
                              ? `មានក្នុងវត្ថុធាតុដើម (${formatQty(ingDuplicateGuard.ingredient.stockQty, ingDuplicateGuard.ingredient.unit)})។ ការបង្កើតស្ទួនត្រូវបានទប់ស្កាត់ ដើម្បីរក្សាស្តុកឱ្យរួមគ្នា។`
                              : `Found in Raw Ingredients (${formatQty(ingDuplicateGuard.ingredient.stockQty, ingDuplicateGuard.ingredient.unit)}). Duplicates are blocked so stock stays unified.`
                            : isKm
                              ? `មានក្នុងបញ្ជីផលិតផល (${formatQty(ingDuplicateGuard.product.stockQty, ingDuplicateGuard.product.unit || 'pcs')})។ ការបង្កើតស្ទួនត្រូវបានទប់ស្កាត់។`
                              : `Found in Product Catalog (${formatQty(ingDuplicateGuard.product.stockQty, ingDuplicateGuard.product.unit || 'pcs')}). Duplicates are blocked so stock stays unified.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <button
                      type="button"
                      onClick={() => {
                        if (ingDuplicateGuard.kind === 'ingredient') {
                          openEditIngredient(ingDuplicateGuard.ingredient);
                        } else {
                          setIngModalOpen(false);
                          setEditingStockProduct(ingDuplicateGuard.product);
                        }
                      }}
                      className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-950 dark:text-amber-100 bg-white dark:bg-[#18251F] border border-amber-300 dark:border-amber-600/60 hover:bg-amber-100/80 dark:hover:bg-amber-900/40 rounded-lg transition-all active:scale-[0.97]"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {isKm ? 'កែប្រែទំនិញមានស្រាប់' : 'Edit Existing Item'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIngModalOpen(false);
                        if (ingDuplicateGuard.kind === 'ingredient') {
                          openPurchaseModal(toTargetFromIngredient(ingDuplicateGuard.ingredient));
                        } else {
                          openPurchaseModal(toTargetFromProduct(ingDuplicateGuard.product));
                        }
                      }}
                      className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97]"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      {isKm ? 'បញ្ចូលស្តុកមានស្រាប់' : 'Restock Existing'}
                    </button>
                  </div>
                </div>
              )}

              {ingSaveError && !ingDuplicateGuard && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-800/60 text-xs text-red-700 dark:text-red-300 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{ingSaveError}</span>
                </div>
              )}
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
                  {isKm ? 'ប្រភេទស្តុក' : 'Category'}
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
                      {getCategoryDisplayName(cat, isKm)}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY_OPTION_VALUE}>
                    {isKm ? '+ បង្កើតប្រភេទថ្មី...' : '+ New Category...'}
                  </option>
                </select>

                {addingIngCategory && (
                  <div className="mt-2 p-3 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] space-y-2 animate-drawer-in">
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
                          isKm ? 'ឧ. ផ្លែឈើស្រស់, ស៊ីរ៉ូ, កែវ...' : 'e.g. Fresh Produce, Syrups...'
                        }
                        className="flex-1 min-w-0 h-11 px-3 text-sm bg-white dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        autoFocus
                      />
                      <button
                        type="button"
                        disabled={creatingIngCategory}
                        onClick={() => void handleCreateInlineIngCategory()}
                        className="h-11 px-3.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                      >
                        {isKm ? 'បន្ថែម' : 'Add'}
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
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                <div className="sm:col-span-5">
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
                <div className="sm:col-span-7">
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.avgUnitCost} ({ingUnit})
                  </label>
                  <CurrencyInput
                    valueKhr={Math.max(0, Number(ingCost) || 0)}
                    onChangeKhr={(nextKhr) => setIngCost(String(nextKhr))}
                    exchangeRate={exchangeRate}
                    allowDecimalsKhr
                    placeholderKhr="0"
                    placeholderUsd="0.00"
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
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {isKm ? 'បាកូដ (ស្រេចចិត្ត — EAN-13 / UPC-A)' : 'Barcode (optional — EAN-13 / UPC-A)'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={64}
                    value={ingBarcode}
                    onChange={(e) => {
                      setIngBarcode(e.target.value);
                      setIngSaveError(null);
                    }}
                    placeholder={isKm ? 'ស្កេន ឬវាយបាកូដ...' : 'Scan or enter barcode...'}
                    className="flex-1 min-w-0 h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                  <button
                    type="button"
                    onClick={() => setIngBarcodeScannerOpen(true)}
                    className="h-11 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap shrink-0"
                  >
                    <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
                    {isKm ? 'ស្កេន' : 'Scan'}
                  </button>
                </div>
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
                    disabled={!ingName.trim() || Boolean(ingDuplicateGuard)}
                    onClick={() => void submitIngredient('add_another')}
                    className="h-12 px-4 inline-flex items-center justify-center text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                  >
                    {isKm ? '+ រក្សាទុក និងបន្ថែមទៀត' : '+ Save & Add Another'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!ingName.trim() || Boolean(ingDuplicateGuard)}
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-all active:scale-[0.97] whitespace-nowrap"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* ================================================================== */}
      {/* MODAL 2: QUICK RESTOCK / PURCHASE STOCK-IN MODAL                   */}
      {/* ================================================================== */}
      {purchaseTarget && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPurchaseTarget(null);
            }}
          >
            <div className="w-full max-w-md bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl overflow-hidden shadow-2xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1">
                  <h2 className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                    {isKm ? 'បញ្ចូលស្តុករហ័ស' : 'Quick Restock'}:{' '}
                    {getLocalizedName(purchaseTarget.name, purchaseTarget.nameVi)}
                  </h2>
                  <InfoHint
                    compact
                    label={isKm ? 'អំពីការទិញបញ្ចូលស្តុក' : 'About Stock-In Purchase'}
                    text={
                      isKm
                        ? 'កត់ត្រាជាការទិញស្តុក (លំហូរសាច់ប្រាក់ចេញ និងបង្កើនទ្រព្យសកម្មស្តុក) — មិនរាប់ជាន់ជាមួយថ្លៃដើមទំនិញលក់ក្នុងរបាយការណ៍ P&L ឡើយ។'
                        : 'Recorded as an Inventory Purchase (Cash Flow outflow & Stock Asset increase) — never double-counted with COGS in Accrual P&L.'
                    }
                  />
                </div>
                <p className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isKm ? 'ស្តុកបច្ចុប្បន្ន៖' : 'Current:'}{' '}
                  <strong className="text-stone-800 dark:text-[#F1F5F3]">
                    {formatQty(purchaseTarget.stockQty, purchaseTarget.unit)}
                  </strong>{' '}
                  · {isKm ? 'កម្រិតអប្បបរមា៖' : 'Min:'}{' '}
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
              {/* Carton / Pack Mode Segmented Toggle for Packaged Goods */}
              {purchaseTarget.classification === 'packaged' && (() => {
                const configuredPacks = purchaseTarget.packSizes || [];
                const activePack =
                  configuredPacks.find((pk) => pk.id === selectedRestockPackId) || configuredPacks[0];

                if (configuredPacks.length > 0 && activePack) {
                  return (
                    <div className="space-y-2.5">
                      <div
                        role="group"
                        aria-label={isKm ? 'របៀបបញ្ចូលស្តុក' : 'Restock unit mode'}
                        className="grid grid-cols-2 p-1 rounded-xl bg-stone-100 dark:bg-[#18251F] border border-stone-200/70 dark:border-[#24352C] gap-1"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setPurchaseUsePacks(false);
                            if (!purchaseCostManual) {
                              const baseQtyNum = Number(purchaseQty) || 0;
                              if (baseQtyNum > 0 && purchaseTarget.unitCostKhr > 0) {
                                setPurchaseCostKhr(String(Math.round(baseQtyNum * purchaseTarget.unitCostKhr)));
                              }
                            }
                          }}
                          className={`h-11 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                            !purchaseUsePacks
                              ? 'bg-white dark:bg-[#111916] text-stone-900 dark:text-[#F1F5F3] shadow-xs'
                              : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                          }`}
                        >
                          {isKm
                            ? `ឯកតារាយ (${purchaseTarget.unit})`
                            : `Base Units (${purchaseTarget.unit})`}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            applyRestockPackSelection(
                              purchaseTarget,
                              activePack,
                              Math.max(1, Number(purchasePackCount) || 1)
                            )
                          }
                          className={`h-11 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap truncate ${
                            purchaseUsePacks
                              ? 'bg-white dark:bg-[#111916] text-[#0F5C43] dark:text-[#34D399] shadow-xs'
                              : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                          }`}
                        >
                          {configuredPacks.length === 1
                            ? isKm
                              ? `កេស (×${activePack.unitsPerPack} ${purchaseTarget.unit})`
                              : `Cartons (×${activePack.unitsPerPack} ${purchaseTarget.unit})`
                            : isKm
                              ? `កេស / យួរ (×${activePack.unitsPerPack})`
                              : `Cartons / Packs (×${activePack.unitsPerPack})`}
                        </button>
                      </div>

                      {purchaseUsePacks && configuredPacks.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {configuredPacks.map((pk) => {
                            const selected = pk.id === activePack.id;
                            return (
                              <button
                                key={pk.id}
                                type="button"
                                onClick={() =>
                                  applyRestockPackSelection(
                                    purchaseTarget,
                                    pk,
                                    Math.max(1, Number(purchasePackCount) || 1)
                                  )
                                }
                                className={`h-9 px-3 rounded-lg text-xs font-medium border transition-colors ${
                                  selected
                                    ? 'bg-[#E6F2ED] dark:bg-[#064E3B]/60 border-[#0F5C43] dark:border-[#10B981] text-[#0F5C43] dark:text-[#6EE7B7] font-semibold'
                                    : 'bg-white dark:bg-[#18251F] border-stone-200 dark:border-[#24352C] text-stone-600 dark:text-[#94A39B] hover:border-stone-300'
                                }`}
                              >
                                {pk.label}
                                {pk.costKhr > 0 ? ` · ${formatKhr(pk.costKhr)}` : ''}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <label className="min-h-[44px] inline-flex items-center gap-2.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={purchaseUsePacks}
                      onChange={(e) => setPurchaseUsePacks(e.target.checked)}
                      className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981] rounded"
                    />
                    {isKm
                      ? 'បញ្ចូលតាមកេស / កញ្ចប់ (គុណចំនួនរាយដោយស្វ័យប្រវត្តិ)'
                      : 'Enter by Cartons / Packs (auto-multiply into base units)'}
                  </label>
                );
              })()}

              {purchaseUsePacks ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2.5 items-end">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isKm ? 'ចំនួនកេស' : 'Cartons / Packs'}
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={purchasePackCount}
                        onChange={(e) => {
                          const rawVal = e.target.value;
                          setPurchasePackCount(rawVal);
                          const cnt = Number(rawVal) || 0;
                          const matchedPack = (purchaseTarget.packSizes || []).find(
                            (pk) => pk.id === selectedRestockPackId
                          );
                          if (!purchaseCostManual && cnt > 0 && matchedPack && matchedPack.costKhr > 0) {
                            setPurchaseCostKhr(String(Math.round(cnt * matchedPack.costKhr)));
                          }
                        }}
                        className="w-full h-11 px-3 text-sm font-mono-num font-semibold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isKm ? 'ឯកតា / កេស' : 'Units / Pack'}
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
                        {isKm ? 'បន្ថែមសរុប' : 'Total Added'}
                      </span>
                      <span className="font-mono-num text-sm leading-tight font-bold text-[#0F5C43] dark:text-[#34D399]">
                        {(Number(purchasePackCount) || 0) * (Number(purchaseUnitsPerPack) || 0)}{' '}
                        {purchaseTarget.unit}
                      </span>
                    </div>
                  </div>
                  {(() => {
                    const matchedPack = (purchaseTarget.packSizes || []).find(
                      (pk) => pk.id === selectedRestockPackId
                    );
                    if (!matchedPack || matchedPack.costKhr <= 0) return null;
                    return (
                      <p className="text-[11px] font-mono-num text-stone-500 dark:text-[#94A39B]">
                        {matchedPack.label}: {formatKhr(matchedPack.costKhr)}{' '}
                        {isKm ? '/ ១ កេស (បានបំពេញដោយស្វ័យប្រវត្តិ)' : '/ carton (auto-filled)'}
                      </p>
                    );
                  })()}
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

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {isKm ? 'ប្រាក់ចំណាយសរុប' : 'Total Paid'}
                  </label>
                  {(() => {
                    const totalPaidNum = Math.max(0, Number(purchaseCostKhr) || 0);
                    const totalUnitsAdded = purchaseUsePacks
                      ? Math.max(0, (Number(purchasePackCount) || 0) * (Number(purchaseUnitsPerPack) || 0))
                      : Math.max(0, Number(purchaseQty) || 0);
                    const perUnitCost =
                      totalUnitsAdded > 0 && totalPaidNum > 0
                        ? totalPaidNum / totalUnitsAdded
                        : 0;
                    const packCnt = Math.max(0, Number(purchasePackCount) || 0);
                    const perPackCost =
                      purchaseUsePacks && packCnt > 0 && totalPaidNum > 0
                        ? Math.round(totalPaidNum / packCnt)
                        : 0;
                    const perUnitLabel =
                      perUnitCost > 0
                        ? `${
                            purchaseTarget.classification === 'ingredient' && !Number.isInteger(perUnitCost)
                              ? `${perUnitCost.toLocaleString('en-US', { maximumFractionDigits: 2 })} ៛`
                              : formatKhr(Math.round(perUnitCost))
                          } / ${purchaseTarget.unit}`
                        : null;
                    const helperText =
                      perPackCost > 0 && perUnitLabel
                        ? `${formatKhr(perPackCost)} / ${isKm ? 'កេស' : 'ctn'} · ${perUnitLabel}`
                        : perUnitLabel || undefined;

                    return (
                      <CurrencyInput
                        valueKhr={totalPaidNum}
                        onChangeKhr={(nextKhr) => {
                          setPurchaseCostManual(true);
                          setPurchaseCostKhr(String(nextKhr));
                        }}
                        exchangeRate={exchangeRate}
                        placeholderKhr="24000"
                        placeholderUsd="6.00"
                        helperExtra={helperText}
                      />
                    );
                  })()}
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
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97]"
                >
                  {isKm ? 'បញ្ជាក់ការបញ្ចូលស្តុក' : 'Confirm Restock'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* ================================================================== */}
      {/* MODAL 3: UNIFIED ADJUST / WASTE / COUNT / OPENING STOCK MODAL      */}
      {/* ================================================================== */}
      {adjustModalTarget && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAdjustModalTarget(null);
            }}
          >
            <div className="w-full max-w-md bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl overflow-hidden shadow-2xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isKm ? 'កែសម្រួល / ខូចខាត' : 'Adjust / Waste'}:{' '}
                  {getLocalizedName(adjustModalTarget.name, adjustModalTarget.nameVi)}
                </h2>
                <p className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isKm ? 'ស្តុកក្នុងប្រព័ន្ធ៖' : 'System stock:'}{' '}
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
                    { id: 'waste', label: isKm ? 'ខូចខាត' : 'Waste' },
                    { id: 'count', label: isKm ? 'រាប់ស្តុក' : 'Count' },
                    { id: 'adjust', label: isKm ? 'កែសម្រួល' : 'Adjust' },
                    { id: 'opening', label: isKm ? 'ដើមគ្រា' : 'Opening' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setAdjustModalMode(mode.id)}
                    className={`h-10 px-2 text-xs font-semibold rounded-md transition-all active:scale-[0.97] whitespace-nowrap ${
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
                        className={`h-11 px-3 text-xs font-semibold rounded-lg border transition-all active:scale-[0.97] ${
                          wasteKind === k
                            ? 'border-amber-600 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-600 dark:text-[#D5DFDA]'
                        }`}
                      >
                        {k === 'expired'
                          ? isKm
                            ? 'ផុតកំណត់ / ខូច'
                            : 'Expired / Spoiled'
                          : isKm
                            ? 'ខូចខាត / កំពប់'
                            : 'Damaged / Spilled'}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                      {isKm ? 'បរិមាណកាត់ចោល' : 'Write-off Quantity'} ({adjustModalTarget.unit})
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
                      {isKm ? 'បរិមាណរាប់បានជាក់ស្តែង' : 'Actual Counted Quantity'} (
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
                      {isKm
                        ? 'បន្ថែមតែតម្លៃស្តុកដើមគ្រាប៉ុណ្ណោះ — មិនកត់ត្រាជាចំណាយទេ។'
                        : 'Adds initial balance valuation only — never logged as an expense.'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                    <div className="sm:col-span-5">
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isKm ? 'បរិមាណដើមគ្រា' : 'Opening Qty'} ({adjustModalTarget.unit})
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
                    <div className="sm:col-span-7">
                      <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {isKm ? 'ថ្លៃដើមឯកតា' : 'Unit Cost'} ({adjustModalTarget.unit})
                      </label>
                      <CurrencyInput
                        valueKhr={Math.max(0, Number(openingUnitCost) || 0)}
                        onChangeKhr={(nextKhr) => setOpeningUnitCost(String(nextKhr))}
                        exchangeRate={exchangeRate}
                        allowDecimalsKhr={adjustModalTarget.classification === 'ingredient'}
                        placeholderKhr="0"
                        placeholderUsd="0.00"
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
                      ? isKm
                        ? 'ឧ. ខូចគុណភាពចុងថ្ងៃ'
                        : 'e.g. End-of-day spoilage'
                      : adjustModalMode === 'count'
                        ? isKm
                          ? 'ឧ. ពិនិត្យធ្នើរប្រចាំថ្ងៃ'
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
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97]"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Camera Barcode Scanner for Inventory Search & Stock-In */}
      <BarcodeScannerModal
        open={scannerOpen}
        title={isKm ? 'ស្កេនបាកូដស្តុកទំនិញ' : 'Scan Barcode'}
        subtitle={
          isKm
            ? 'តម្រង់កាមេរ៉ាទៅលើបាកូដ EAN-13, UPC-A ឬកេស ដើម្បីស្វែងរកក្នុងស្តុកដោយស្វ័យប្រវត្តិ។'
            : 'Point camera at an EAN-13, UPC-A, or carton barcode to automatically search inventory.'
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
          const displayName = getLocalizedName(newProd.name, newProd.nameVi);
          showNotice(
            'ok',
            isKm
              ? `បានចុះឈ្មោះ "${displayName}" — រួចរាល់សម្រាប់បញ្ចូលស្តុក និងលក់ POS។`
              : `Registered "${displayName}" — ready for Stock-In & POS.`
          );
          if (newProd.productType === 'PACKAGED') {
            setActiveTab('packaged');
            openPurchaseModal(toTargetFromProduct(newProd));
          }
        }}
        onEditExisting={(prod) => {
          setQuickRegisterOpen(false);
          setUnknownStockBarcode(null);
          setEditingStockProduct(prod);
        }}
        onRestockExisting={(prod) => {
          setQuickRegisterOpen(false);
          setUnknownStockBarcode(null);
          if (prod.productType === 'PACKAGED') {
            openPurchaseModal(toTargetFromProduct(prod));
          } else {
            setActiveTab('ingredients');
          }
        }}
        onEditExistingIngredient={(ing) => {
          setQuickRegisterOpen(false);
          setUnknownStockBarcode(null);
          openEditIngredient(ing);
        }}
        onRestockExistingIngredient={(ing) => {
          setQuickRegisterOpen(false);
          setUnknownStockBarcode(null);
          openPurchaseModal(toTargetFromIngredient(ing));
        }}
        onClose={() => setQuickRegisterOpen(false)}
      />

      {/* Edit Retail Packaged Product Directly From Inventory */}
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
          const displayName = getLocalizedName(savedProd.name, savedProd.nameVi);
          showNotice(
            'ok',
            isKm ? `បានកែប្រែ "${displayName}"។` : `Updated "${displayName}".`
          );
        }}
        onEditExisting={(prod) => setEditingStockProduct(prod)}
        onRestockExisting={(prod) => {
          setEditingStockProduct(null);
          if (prod.productType === 'PACKAGED') {
            openPurchaseModal(toTargetFromProduct(prod));
          } else {
            setActiveTab('ingredients');
          }
        }}
        onEditExistingIngredient={(ing) => {
          setEditingStockProduct(null);
          openEditIngredient(ing);
        }}
        onRestockExistingIngredient={(ing) => {
          setEditingStockProduct(null);
          openPurchaseModal(toTargetFromIngredient(ing));
        }}
        onClose={() => setEditingStockProduct(null)}
      />

      {/* Camera Barcode Scanner for Ingredient Modal Barcode Field */}
      <BarcodeScannerModal
        open={ingBarcodeScannerOpen}
        title={isKm ? 'ស្កេនបាកូដវត្ថុធាតុដើម' : 'Scan Ingredient Barcode'}
        subtitle={
          isKm
            ? 'តម្រង់កាមេរ៉ាទៅលើបាកូដ EAN-13 ឬ UPC-A លើកញ្ចប់វត្ថុធាតុដើម ដើម្បីភ្ជាប់។'
            : 'Point camera at an EAN-13 or UPC-A barcode on the ingredient package to link it.'
        }
        onDetected={(code) => {
          setIngBarcode(normalizeBarcodeString(code));
          setIngSaveError(null);
        }}
        onClose={() => setIngBarcodeScannerOpen(false)}
      />

      {/* Bottom-Right Floating Action Button + Scroll-to-Top Pill */}
      <FloatingActionBar
        label={t.inventory.addIngredient}
        topLabel={isKm ? 'ឡើងលើ' : 'Top'}
        onAction={() => openNewIngredient()}
        hidden={
          ingModalOpen ||
          ingBarcodeScannerOpen ||
          Boolean(purchaseTarget) ||
          Boolean(adjustModalTarget) ||
          scannerOpen ||
          quickRegisterOpen ||
          Boolean(editingStockProduct)
        }
      />
    </div>
  );
};
