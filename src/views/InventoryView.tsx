import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ClipboardCheck,
  Edit2,
  FlaskConical,
  PackageCheck,
  Plus,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
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
import {
  type BatchPrepMode,
  type StockShortage,
} from '../utils/inventoryEngine';
import { formatBarcodeTypeLabel } from '../utils/barcodeRegistry';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ProductFormModal } from '../components/ProductFormModal';
import { InfoHint } from '../components/InfoHint';

type InventoryTab = 'packaged' | 'ingredients' | 'prepared_stock' | 'movements';

interface StockItemTarget {
  id: string;
  name: string;
  nameVi: string;
  classification: StockClassification;
  unit: IngredientUnit;
  stockQty: number;
  unitCostKhr: number;
  supplier: string;
  defaultUnitsPerPack?: number;
  packLabel?: string;
  barcodeScanned?: string;
}

export const InventoryView: React.FC = () => {
  const {
    settings,
    products,
    ingredients,
    barcodeRegistry,
    stockMovements,
    saveProduct,
    lookupBarcode,
    saveIngredient,
    recordStockPurchase,
    recordOpeningStock,
    prepareBatchStock,
    recordStockCount,
    recordStockAdjustment,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';

  const [activeTab, setActiveTab] = useState<InventoryTab>('packaged');
  const [search, setSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState<'ALL' | MovementType>('ALL');
  const [movementTierFilter, setMovementTierFilter] = useState<'ALL' | StockClassification>('ALL');
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
  const [ingUnit, setIngUnit] = useState<IngredientUnit>('g');
  const [ingStock, setIngStock] = useState('0');
  const [ingReorder, setIngReorder] = useState('500');
  const [ingCost, setIngCost] = useState('10');
  const [ingSupplier, setIngSupplier] = useState('');

  // Stock-In / Purchase modal (supports all 3 tiers + pack/carton multiplication)
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

  // Opening Stock modal (non-expense)
  const [openingTarget, setOpeningTarget] = useState<StockItemTarget | null>(null);
  const [openingQty, setOpeningQty] = useState('');
  const [openingUnitCost, setOpeningUnitCost] = useState('');
  const [openingNote, setOpeningNote] = useState('');

  // Prepared Stock Batch Prep modal (Deduct Raw Ingredients OR Direct Add)
  const [batchProduct, setBatchProduct] = useState<Product | null>(null);
  const [batchQty, setBatchQty] = useState('10');
  const [batchMode, setBatchMode] = useState<BatchPrepMode>('deduct_ingredients');
  const [batchDirectUnitCost, setBatchDirectUnitCost] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchShortages, setBatchShortages] = useState<StockShortage[]>([]);

  // Physical Stock Count modal
  const [countTarget, setCountTarget] = useState<StockItemTarget | null>(null);
  const [countedQty, setCountedQty] = useState('');
  const [countNote, setCountNote] = useState('');

  // Adjust / Damaged / Expired modal
  const [adjustTarget, setAdjustTarget] = useState<StockItemTarget | null>(null);
  const [adjustKind, setAdjustKind] = useState<'adjustment' | 'damaged' | 'expired'>('adjustment');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const packagedProducts = useMemo(
    () => products.filter((p) => p.productType === 'PACKAGED'),
    [products]
  );
  const preparedStockProducts = useMemo(
    () => products.filter((p) => p.productType === 'PREPARED_STOCK'),
    [products]
  );

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
    const lowPackaged = packagedProducts.filter((p) => p.stockQty <= p.reorderLevel).length;
    const lowIng = ingredients.filter((i) => i.stockQty <= i.reorderLevel).length;
    const lowPrep = preparedStockProducts.filter((p) => p.stockQty <= p.reorderLevel).length;
    return {
      packagedVal,
      ingVal,
      prepVal,
      totalVal: packagedVal + ingVal + prepVal,
      lowTotal: lowPackaged + lowIng + lowPrep,
    };
  }, [packagedProducts, ingredients, preparedStockProducts]);

  const showNotice = (kind: 'ok' | 'err', text: string) => {
    setFeedbackMsg({ kind, text });
    window.setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const toTargetFromProduct = (p: Product): StockItemTarget => ({
    id: p.id,
    name: p.name,
    nameVi: p.nameVi,
    classification: p.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock',
    unit: p.unit || 'pcs',
    stockQty: p.stockQty,
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
    unitCostKhr: i.unitCostKhr,
    supplier: i.supplier,
  });

  const openPurchaseModal = (target: StockItemTarget, scannedPackUnits?: number) => {
    setPurchaseTarget(target);
    const usePacks = Boolean(scannedPackUnits && scannedPackUnits > 1);
    setPurchaseUsePacks(usePacks);
    setPurchasePackCount('1');
    setPurchaseUnitsPerPack(String(scannedPackUnits || target.defaultUnitsPerPack || 24));
    setPurchaseQty('');
    setPurchaseCostKhr('');
    setPurchasePayment('cash');
    setPurchaseSupplier(target.supplier || '');
    setPurchaseDate(todayIso());
    setPurchaseNote(
      usePacks && target.packLabel ? `Scanned ${target.packLabel}` : ''
    );
  };

  const handleStockInBarcode = async (rawCode: string) => {
    const cleaned = rawCode.trim();
    if (!cleaned) return;
    setUnknownStockBarcode(null);

    const res = await lookupBarcode(cleaned);
    if (!res.found || !res.product) {
      // Calm registration prompt (not an error)
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
          ? `"${res.product.nameVi || res.product.name}" là món pha chế theo đơn — hãy nhập nguyên liệu ở tab Nguyên liệu.`
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
      !openingTarget &&
      !countTarget &&
      !adjustTarget &&
      !quickRegisterOpen,
    onScan: (code) => {
      void handleStockInBarcode(code);
    },
  });

  const openNewIngredient = () => {
    setEditingIng(null);
    setIngName('');
    setIngNameVi('');
    setIngUnit('g');
    setIngStock('0');
    setIngReorder(String(settings.lowStockDefault || 15));
    setIngCost('10');
    setIngSupplier('');
    setIngModalOpen(true);
  };

  const openEditIngredient = (ing: Ingredient) => {
    setEditingIng(ing);
    setIngName(ing.name);
    setIngNameVi(ing.nameVi);
    setIngUnit(ing.unit);
    setIngStock(String(ing.stockQty));
    setIngReorder(String(ing.reorderLevel));
    setIngCost(String(ing.unitCostKhr));
    setIngSupplier(ing.supplier);
    setIngModalOpen(true);
  };

  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingName.trim()) return;
    await saveIngredient({
      id: editingIng?.id,
      name: ingName.trim(),
      nameVi: ingNameVi.trim() || ingName.trim(),
      unit: ingUnit,
      stockQty: Number(ingStock) || 0,
      reorderLevel: Math.max(0, Number(ingReorder) || 0),
      unitCostKhr: Math.max(0, Number(ingCost) || 0),
      supplier: ingSupplier.trim(),
    });
    setIngModalOpen(false);
  };

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
        : `Stock-in recorded: +${formatQty(effectiveQty, purchaseTarget.unit)} ${purchaseTarget.name}.`
    );
  };

  const handleSaveOpeningStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingTarget) return;
    const qty = Number(openingQty) || 0;
    if (qty <= 0) return;
    const res = await recordOpeningStock({
      itemId: openingTarget.id,
      itemClassification: openingTarget.classification,
      quantity: qty,
      unitCostKhr: Math.max(0, Number(openingUnitCost) || openingTarget.unitCostKhr),
      note: openingNote || 'Opening stock balance',
    });
    if (!res.ok) {
      showNotice('err', res.error || 'Could not record opening stock.');
      return;
    }
    setOpeningTarget(null);
    showNotice(
      'ok',
      isVi
        ? `Đã ghi nhận tồn đầu kỳ (không tính vào chi phí) cho ${openingTarget.nameVi || openingTarget.name}.`
        : `Opening stock recorded (non-expense) for ${openingTarget.name}.`
    );
  };

  const openBatchPrepModal = (product: Product) => {
    setBatchProduct(product);
    setBatchQty('10');
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

  const handleSaveStockCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!countTarget) return;
    const counted = Number(countedQty);
    if (!Number.isFinite(counted) || counted < 0) return;

    const res = await recordStockCount({
      itemId: countTarget.id,
      itemClassification: countTarget.classification,
      countedQty: counted,
      note: countNote,
    });
    if (!res.ok) {
      showNotice('err', res.error || 'Could not record stock count.');
      return;
    }
    setCountTarget(null);
    showNotice('ok', isVi ? 'Đã cập nhật kiểm kê thực tế.' : 'Physical stock count recorded.');
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const val = Number(adjustDelta);
    if (!Number.isFinite(val) || val === 0) return;

    const res = await recordStockAdjustment({
      itemId: adjustTarget.id,
      itemClassification: adjustTarget.classification,
      movementType: adjustKind,
      deltaQty: val,
      note: adjustNote,
    });
    if (!res.ok) {
      showNotice('err', res.error || 'Could not adjust stock.');
      return;
    }
    setAdjustTarget(null);
    showNotice('ok', isVi ? 'Đã cập nhật điều chỉnh tồn kho.' : 'Stock adjustment recorded.');
  };

  const q = search.trim().toLowerCase();

  const filteredPackaged = useMemo(
    () =>
      packagedProducts.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.nameVi.toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          p.supplier.toLowerCase().includes(q)
      ),
    [packagedProducts, q]
  );

  const filteredIngredients = useMemo(
    () =>
      ingredients.filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.nameVi.toLowerCase().includes(q) ||
          i.supplier.toLowerCase().includes(q)
      ),
    [ingredients, q]
  );

  const filteredPrepared = useMemo(
    () =>
      preparedStockProducts.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.nameVi.toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q)
      ),
    [preparedStockProducts, q]
  );

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
            {t.inventory.title}
          </h1>
          <InfoHint
            label={isVi ? 'Thông tin quản lý kho' : 'About Inventory Management'}
            text={
              isVi
                ? 'Quản lý thống nhất 3 phân nhóm tồn kho: Hàng đóng gói, Nguyên liệu thô và Hàng pha sẵn.'
                : 'Unified inventory management across Packaged Stock, Raw Ingredients, Prepared Stock, and Audit Ledger.'
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
          >
            <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
            {isVi ? 'Quét nhập kho (Thùng/Lẻ)' : 'Scan Stock-In'}
          </button>
          <button
            type="button"
            onClick={openNewIngredient}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {t.inventory.addIngredient}
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div
          role="status"
          className={`px-4 py-3 rounded-lg border text-sm font-medium ${
            feedbackMsg.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-[#064E3B] border-emerald-200 dark:border-[#10B981]/50 text-emerald-900 dark:text-[#D1FAE5]'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-500/40 text-red-900 dark:text-red-200'
          }`}
        >
          {feedbackMsg.text}
        </div>
      )}

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
              className="h-11 inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              {isVi ? 'Đăng ký sản phẩm' : 'Register Product'}
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

      {/* 3-Tier Inventory Valuation Strip */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-stone-200 dark:divide-[#24352C]">
        <div className="p-4 col-span-2 lg:col-span-1">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {t.inventory.stockValue}
            </p>
            <InfoHint
              compact
              label={t.inventory.stockValue}
              text={
                isVi
                  ? 'Tổng giá trị tài sản tồn kho hiện có trên cả 3 phân nhóm (tính theo giá vốn bình quân).'
                  : 'Combined on-hand asset valuation across all 3 inventory tiers at weighted average unit cost.'
              }
            />
          </div>
          <p className="mt-1 font-mono-num text-xl font-bold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(valuation.totalVal)}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Hàng đóng gói' : 'Packaged Stock'}
            </p>
            <InfoHint
              compact
              label={isVi ? 'Hàng đóng gói' : 'Packaged Stock'}
              text={
                isVi
                  ? 'Nước đóng chai, lon, đồ ăn vặt bán trực tiếp — trừ thẳng tồn kho khi bán POS.'
                  : 'Bottled drinks and snacks sold as-is; deducted directly by unit count at POS checkout.'
              }
            />
          </div>
          <p className="mt-1 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(valuation.packagedVal)}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Nguyên liệu thô' : 'Raw Ingredients'}
            </p>
            <InfoHint
              compact
              label={isVi ? 'Nguyên liệu thô' : 'Raw Ingredients'}
              text={
                isVi
                  ? 'Trái cây tươi, đường, sữa, ly — tự động trừ theo công thức khi bán món pha chế hoặc khi pha mẻ.'
                  : 'Fresh fruit, syrups, cups, and milk; auto-deducted via recipe on made-to-order sales or batch prep.'
              }
            />
          </div>
          <p className="mt-1 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(valuation.ingVal)}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Hàng pha sẵn' : 'Prepared Stock'}
            </p>
            <InfoHint
              compact
              label={isVi ? 'Hàng pha sẵn' : 'Prepared Stock'}
              text={
                isVi
                  ? 'Thành phẩm pha theo mẻ trữ lạnh — chỉ trừ số lượng sẵn bán tại POS, không trừ trùng nguyên liệu.'
                  : 'Pre-batched chilled items; POS deducts ready units only and never double-deducts raw ingredients.'
              }
            />
          </div>
          <p className="mt-1 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(valuation.prepVal)}
          </p>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {t.inventory.lowStockItems}
            </p>
            <InfoHint
              compact
              label={t.inventory.lowStockItems}
              text={
                isVi
                  ? 'Số mặt hàng có tồn kho bằng hoặc thấp hơn mức cảnh báo nhập lại (min).'
                  : 'Count of items across all 3 tiers currently at or below their reorder threshold.'
              }
            />
          </div>
          <p
            className={`mt-1 font-mono-num text-lg font-bold ${
              valuation.lowTotal > 0
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-emerald-700 dark:text-[#34D399]'
            }`}
          >
            {valuation.lowTotal}
          </p>
        </div>
      </div>

      {/* 4-Tab Panel */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-[#24352C] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] rounded-lg self-start">
            {(
              [
                {
                  id: 'packaged',
                  label: isVi
                    ? `Đóng gói (${packagedProducts.length})`
                    : `Packaged (${packagedProducts.length})`,
                },
                {
                  id: 'ingredients',
                  label: isVi
                    ? `Nguyên liệu (${ingredients.length})`
                    : `Ingredients (${ingredients.length})`,
                },
                {
                  id: 'prepared_stock',
                  label: isVi
                    ? `Pha sẵn (${preparedStockProducts.length})`
                    : `Prepared Stock (${preparedStockProducts.length})`,
                },
                {
                  id: 'movements',
                  label: isVi
                    ? `Nhật ký (${stockMovements.length})`
                    : `Movements (${stockMovements.length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-9 px-3.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                    : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'movements' && (
              <>
                <select
                  value={movementTierFilter}
                  onChange={(e) =>
                    setMovementTierFilter(e.target.value as 'ALL' | StockClassification)
                  }
                  className="h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                >
                  <option value="ALL">{isVi ? 'Mọi nhóm kho' : 'All Tiers'}</option>
                  <option value="packaged">{isVi ? 'Đóng gói' : 'Packaged'}</option>
                  <option value="ingredient">{isVi ? 'Nguyên liệu' : 'Ingredients'}</option>
                  <option value="prepared_stock">{isVi ? 'Pha sẵn' : 'Prepared Stock'}</option>
                </select>
                <select
                  value={movementTypeFilter}
                  onChange={(e) => setMovementTypeFilter(e.target.value as 'ALL' | MovementType)}
                  className="h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                >
                  <option value="ALL">{isVi ? 'Mọi loại giao dịch' : 'All Types'}</option>
                  {(Object.keys(t.movementTypes) as MovementType[]).map((mt) => (
                    <option key={mt} value={mt}>
                      {t.movementTypes[mt]}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.common.search}
                className="w-full h-11 pl-9 pr-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
          </div>
        </div>

        {/* TAB 1: PACKAGED STOCK */}
        {activeTab === 'packaged' && (
          <div className="overflow-x-auto">
            {filteredPackaged.length === 0 ? (
              <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                {isVi
                  ? 'Chưa có sản phẩm đóng gói. Thêm ở mục Sản phẩm với loại Đóng gói sẵn.'
                  : 'No packaged items yet. Add one under Products with classification "Packaged".'}
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-5 font-medium">
                      {isVi ? 'Sản phẩm / Mã vạch' : 'Product / Barcode'}
                    </th>
                    <th className="py-3 px-4 font-medium">{t.common.status}</th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{t.inventory.inStock}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={t.inventory.inStock}
                          text={
                            isVi
                              ? 'Số lượng hiện có trong kho so với mức tối thiểu (min) cần nhập thêm.'
                              : 'Current on-hand quantity compared against the minimum reorder threshold.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{t.inventory.avgUnitCost}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={t.inventory.avgUnitCost}
                          text={
                            isVi
                              ? 'Giá vốn bình quân gia quyền tự động cập nhật sau mỗi lần nhập kho mua hàng.'
                              : 'Weighted average unit cost recalculated automatically on each Stock-In purchase.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {isVi ? 'Giá trị' : 'Value'}
                    </th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {filteredPackaged.map((prod) => {
                    const isOut = prod.stockQty <= 0;
                    const isLow = !isOut && prod.stockQty <= prod.reorderLevel;
                    const target = toTargetFromProduct(prod);
                    return (
                      <tr
                        key={prod.id}
                        className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                            {isVi ? prod.nameVi || prod.name : prod.name}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num mt-0.5">
                            {[
                              prod.barcode || 'No barcode',
                              prod.packagingBarcodes?.[0]
                                ? `${prod.packagingBarcodes[0].label}: ${prod.packagingBarcodes[0].barcode}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                          {isOut ? (
                            <span className="text-red-700 dark:text-[#F87171]">
                              {t.inventory.statusOut}
                            </span>
                          ) : isLow ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              {t.inventory.statusLow}
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-[#34D399]">
                              {t.inventory.statusHealthy}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatQty(prod.stockQty, prod.unit)}
                          <span className="block text-[11px] font-normal text-stone-400 dark:text-[#94A39B]">
                            min {prod.reorderLevel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                          {formatKhr(prod.costPriceKhr)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatKhr(Math.max(0, prod.stockQty) * prod.costPriceKhr)}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => openPurchaseModal(target)}
                              className="h-9 px-2.5 inline-flex items-center gap-1 font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              <ArrowDownCircle className="w-3.5 h-3.5" />
                              {isVi ? 'Nhập kho' : 'Stock-In'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningTarget(target);
                                setOpeningQty('');
                                setOpeningUnitCost(String(prod.costPriceKhr));
                                setOpeningNote('');
                              }}
                              className="h-9 px-2.5 text-stone-600 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              {isVi ? 'Đầu kỳ' : 'Opening'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCountTarget(target);
                                setCountedQty(String(prod.stockQty));
                                setCountNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Physical Count"
                            >
                              <ClipboardCheck className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(target);
                                setAdjustKind('adjustment');
                                setAdjustDelta('');
                                setAdjustNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Adjust / Damaged / Expired"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 2: INGREDIENTS / RAW MATERIALS */}
        {activeTab === 'ingredients' && (
          <div className="overflow-x-auto">
            {filteredIngredients.length === 0 ? (
              <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                {t.inventory.emptyStock}
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-5 font-medium">{t.inventory.ingredientName}</th>
                    <th className="py-3 px-4 font-medium">{t.common.status}</th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{t.inventory.inStock}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={t.inventory.inStock}
                          text={
                            isVi
                              ? 'Lượng nguyên liệu hiện còn; tự động trừ khi bán món pha chế hoặc pha mẻ.'
                              : 'Remaining raw ingredient balance; auto-deducted on made-to-order sales and batch prep.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{t.inventory.avgUnitCost}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={t.inventory.avgUnitCost}
                          text={
                            isVi
                              ? 'Giá vốn bình quân trên 1 đơn vị dùng để tính giá vốn công thức (COGS).'
                              : 'Weighted average cost per unit used to calculate recipe COGS automatically.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {isVi ? 'Giá trị' : 'Value'}
                    </th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {filteredIngredients.map((ing) => {
                    const isOut = ing.stockQty <= 0;
                    const isLow = !isOut && ing.stockQty <= ing.reorderLevel;
                    const target = toTargetFromIngredient(ing);
                    return (
                      <tr
                        key={ing.id}
                        className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                            {isVi ? ing.nameVi || ing.name : ing.name}
                          </p>
                          {ing.supplier && (
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                              {ing.supplier}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                          {isOut ? (
                            <span className="text-red-700 dark:text-[#F87171]">
                              {t.inventory.statusOut}
                            </span>
                          ) : isLow ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              {t.inventory.statusLow}
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-[#34D399]">
                              {t.inventory.statusHealthy}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatQty(ing.stockQty, ing.unit)}
                          <span className="block text-[11px] font-normal text-stone-400 dark:text-[#94A39B]">
                            min {formatQty(ing.reorderLevel, ing.unit)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                          {formatKhr(ing.unitCostKhr)} / {ing.unit}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatKhr(Math.max(0, ing.stockQty) * ing.unitCostKhr)}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => openPurchaseModal(target)}
                              className="h-9 px-2.5 inline-flex items-center gap-1 font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              <ArrowDownCircle className="w-3.5 h-3.5" />
                              {isVi ? 'Nhập mua' : 'Purchase'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningTarget(target);
                                setOpeningQty('');
                                setOpeningUnitCost(String(ing.unitCostKhr));
                                setOpeningNote('');
                              }}
                              className="h-9 px-2.5 text-stone-600 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              {isVi ? 'Đầu kỳ' : 'Opening'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCountTarget(target);
                                setCountedQty(String(ing.stockQty));
                                setCountNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Stock Count"
                            >
                              <ClipboardCheck className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(target);
                                setAdjustKind('adjustment');
                                setAdjustDelta('');
                                setAdjustNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Adjust / Damaged / Expired"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditIngredient(ing)}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              aria-label={t.common.edit}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: PREPARED STOCK / FINISHED GOODS */}
        {activeTab === 'prepared_stock' && (
          <div className="overflow-x-auto">
            {filteredPrepared.length === 0 ? (
              <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                {isVi
                  ? 'Chưa có sản phẩm pha sẵn. Thêm ở mục Sản phẩm với loại Pha sẵn trữ lạnh.'
                  : 'No prepared-stock items yet. Add one under Products with classification "Prepared Stock".'}
              </p>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-5 font-medium">
                      {isVi ? 'Sản phẩm pha sẵn' : 'Prepared Item'}
                    </th>
                    <th className="py-3 px-4 font-medium">{t.common.status}</th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{isVi ? 'Sẵn bán' : 'Ready Qty'}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={isVi ? 'Sẵn bán' : 'Ready Qty'}
                          text={
                            isVi
                              ? 'Số lượng thành phẩm đã pha sẵn trữ lạnh. Khi bán POS chỉ trừ số này, không trừ trùng nguyên liệu.'
                              : 'Pre-batched units ready to sell. POS deducts this count only and never double-deducts ingredients.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1">
                        <span>{t.inventory.avgUnitCost}</span>
                        <InfoHint
                          mode="popover"
                          compact
                          align="right"
                          label={t.inventory.avgUnitCost}
                          text={
                            isVi
                              ? 'Giá vốn mỗi thành phẩm được tính bình quân từ chi phí mẻ pha.'
                              : 'Average cost per finished unit updated from each prepared batch.'
                          }
                        />
                      </span>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {isVi ? 'Giá trị' : 'Value'}
                    </th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {filteredPrepared.map((prod) => {
                    const isOut = prod.stockQty <= 0;
                    const isLow = !isOut && prod.stockQty <= prod.reorderLevel;
                    const target = toTargetFromProduct(prod);
                    return (
                      <tr
                        key={prod.id}
                        className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                            {isVi ? prod.nameVi || prod.name : prod.name}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                            {prod.recipe.length > 0
                              ? isVi
                                ? `Công thức mẻ: ${prod.recipe.length} nguyên liệu`
                                : `Batch recipe: ${prod.recipe.length} ingredients`
                              : isVi
                                ? 'Nhập trực tiếp thành phẩm'
                                : 'Direct finished-goods entry'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                          {isOut ? (
                            <span className="text-red-700 dark:text-[#F87171]">
                              {t.inventory.statusOut}
                            </span>
                          ) : isLow ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              {t.inventory.statusLow}
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-[#34D399]">
                              {t.inventory.statusHealthy}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatQty(prod.stockQty, prod.unit)}
                          <span className="block text-[11px] font-normal text-stone-400 dark:text-[#94A39B]">
                            min {prod.reorderLevel}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                          {formatKhr(prod.costPriceKhr)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                          {formatKhr(Math.max(0, prod.stockQty) * prod.costPriceKhr)}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => openBatchPrepModal(prod)}
                              className="h-9 px-2.5 inline-flex items-center gap-1 font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              <FlaskConical className="w-3.5 h-3.5" />
                              {isVi ? 'Pha mẻ mới' : 'Prepare Batch'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningTarget(target);
                                setOpeningQty('');
                                setOpeningUnitCost(String(prod.costPriceKhr));
                                setOpeningNote('');
                              }}
                              className="h-9 px-2.5 text-stone-600 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              {isVi ? 'Đầu kỳ' : 'Opening'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCountTarget(target);
                                setCountedQty(String(prod.stockQty));
                                setCountNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Stock Count"
                            >
                              <ClipboardCheck className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(target);
                                setAdjustKind('expired');
                                setAdjustDelta('');
                                setAdjustNote('');
                              }}
                              className="w-9 h-9 inline-flex items-center justify-center text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                              title="Adjust / Damaged / Expired"
                            >
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 4: UNIFIED STOCK MOVEMENT AUDIT LEDGER */}
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
                      <span className="inline-flex flex-wrap items-center gap-x-1">
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
                        <p className="text-[11px] text-stone-400 dark:text-[#94A39B] uppercase tracking-wide">
                          {(mov.itemClassification || 'ingredient').replace('_', ' ')}
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

      {/* Add / Edit Ingredient Modal */}
      {ingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
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
            <form onSubmit={handleSaveIngredient} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.ingredientName}
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={ingName}
                  onChange={(e) => setIngName(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.inventory.unit}
                  </label>
                  <select
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value as IngredientUnit)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIngModalOpen(false)}
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock-In / Purchase Modal (Supports Carton/Pack Multiplication & Zero COGS Double-Counting) */}
      {purchaseTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Nhập kho mua hàng' : 'Record Stock-In Purchase'}:{' '}
                  {isVi ? purchaseTarget.nameVi || purchaseTarget.name : purchaseTarget.name}
                </h2>
                <InfoHint
                  compact
                  label={isVi ? 'Giải thích nhập kho mua hàng' : 'About Stock-In Purchase'}
                  text={
                    isVi
                      ? 'Ghi nhận vào Sổ Mua Hàng (Dòng tiền chi ra) và tăng Giá trị Tồn kho — không tính trùng hai lần vào chi phí vận hành P&L.'
                      : 'Recorded as an Inventory Purchase (Cash Flow outflow & Stock Asset increase) — never double-counted with COGS in Accrual P&L.'
                  }
                />
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

              {/* Carton / Pack Mode Toggle */}
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
                      {isVi ? 'Số thùng' : 'Packs / Cartons'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={purchasePackCount}
                      onChange={(e) => setPurchasePackCount(e.target.value)}
                      className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                      className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                    />
                  </div>
                  <div className="h-11 px-2 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg flex flex-col items-center justify-center text-center">
                    <span className="block text-[10px] leading-tight text-stone-500 dark:text-[#94A39B]">
                      Total Added
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {t.common.payment}
                  </label>
                  <select
                    value={purchasePayment}
                    onChange={(e) => setPurchasePayment(e.target.value as PaymentMethod)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPurchaseTarget(null)}
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Opening Stock Modal (Valuation Only — Non-Expense) */}
      {openingTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-1 min-w-0">
                <h2 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Nhập tồn đầu kỳ' : 'Opening Stock'}:{' '}
                  {isVi ? openingTarget.nameVi || openingTarget.name : openingTarget.name}
                </h2>
                <InfoHint
                  compact
                  label={isVi ? 'Giải thích tồn đầu kỳ' : 'About Opening Stock'}
                  text={
                    isVi
                      ? 'Tồn kho đầu kỳ chỉ tăng số dư và giá trị tài sản kho — KHÔNG tính là chi phí hay tiền chi ra.'
                      : 'Opening stock adds initial on-hand inventory valuation ONLY — it is NEVER recorded as an expense or cash outflow.'
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => setOpeningTarget(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOpeningStock} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {isVi ? 'Số lượng thêm' : 'Opening Qty'} ({openingTarget.unit})
                  </label>
                  <input
                    type="number"
                    required
                    min={0.01}
                    step="any"
                    value={openingQty}
                    onChange={(e) => setOpeningQty(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={180}
                  value={openingNote}
                  onChange={(e) => setOpeningNote(e.target.value)}
                  placeholder="Initial count before system go-live"
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOpeningTarget(null)}
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prepare Batch Modal for PREPARED_STOCK (Both Modes: Deduct Ingredients OR Direct Add) */}
      {batchProduct && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-1.5 min-w-0">
                <PackageCheck className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Pha mẻ hàng trữ sẵn' : 'Prepare Batch'}:{' '}
                  {isVi ? batchProduct.nameVi || batchProduct.name : batchProduct.name}
                </h2>
                <InfoHint
                  compact
                  label={isVi ? 'Giải thích pha mẻ hàng trữ sẵn' : 'About Prepare Batch'}
                  text={
                    isVi
                      ? 'Chọn "Trừ nguyên liệu theo mẻ" để trừ kho nguyên liệu theo công thức và tự tính giá vốn thành phẩm, hoặc "Thêm trực tiếp" nếu không cần trừ nguyên liệu thô.'
                      : 'Choose "Deduct Raw Ingredients" to consume ingredients via the batch recipe and recalculate unit cost, or "Direct Add" to increase ready stock without deducting raw stock.'
                  }
                />
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
              {/* Mode Toggle */}
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
                    {isVi ? 'Số lượng thành phẩm' : 'Batch Quantity'} ({batchProduct.unit})
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="any"
                    value={batchQty}
                    onChange={(e) => setBatchQty(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                      className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {isVi ? 'Hoàn tất mẻ pha' : 'Confirm Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Physical Stock Count Modal */}
      {countTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                {isVi ? 'Kiểm kê thực tế' : 'Physical Stock Count'}:{' '}
                {isVi ? countTarget.nameVi || countTarget.name : countTarget.name}
              </h2>
              <button
                type="button"
                onClick={() => setCountTarget(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveStockCount} className="p-6 space-y-4">
              <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                {isVi ? 'Tồn hệ thống hiện tại:' : 'System stock:'}{' '}
                <span className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {formatQty(countTarget.stockQty, countTarget.unit)}
                </span>
              </p>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {isVi ? 'Số lượng đếm được thực tế' : 'Actual Counted Quantity'} (
                  {countTarget.unit})
                </label>
                <input
                  type="number"
                  required
                  min={0}
                  step="any"
                  value={countedQty}
                  onChange={(e) => setCountedQty(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={180}
                  value={countNote}
                  onChange={(e) => setCountNote(e.target.value)}
                  placeholder="End-of-week count"
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCountTarget(null)}
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Adjustment / Damaged / Expired Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                {t.inventory.adjustStock}:{' '}
                {isVi ? adjustTarget.nameVi || adjustTarget.name : adjustTarget.name}
              </h2>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
              <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                {t.inventory.inStock}:{' '}
                <span className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {formatQty(adjustTarget.stockQty, adjustTarget.unit)}
                </span>
              </p>

              <div className="grid grid-cols-3 gap-2">
                {(['adjustment', 'damaged', 'expired'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAdjustKind(k)}
                    className={`h-11 px-2 text-xs font-semibold rounded-lg border transition-colors ${
                      adjustKind === k
                        ? 'border-[#0F5C43] bg-emerald-50 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                        : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-600 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                    }`}
                  >
                    {k === 'adjustment'
                      ? isVi
                        ? 'Điều chỉnh'
                        : 'Adjust'
                      : k === 'damaged'
                      ? isVi
                        ? 'Hư hỏng'
                        : 'Damaged'
                      : isVi
                      ? 'Hết hạn'
                      : 'Expired'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {adjustKind === 'adjustment'
                    ? `${t.inventory.deltaQty} (${adjustTarget.unit})`
                    : `${isVi ? 'Số lượng hủy' : 'Write-off Quantity'} (${adjustTarget.unit})`}
                </label>
                <input
                  type="number"
                  required
                  step="any"
                  placeholder={adjustKind === 'adjustment' ? '-2 or +5' : '2'}
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {t.inventory.adjustReason}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
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
    </div>
  );
};
