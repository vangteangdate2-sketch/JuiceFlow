import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  ScanBarcode,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import type {
  BarcodeFormat,
  ExternalBarcodePrefill,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductType,
  Sale,
} from '../types';
import {
  calculateProductCogs,
  formatDateTimeInPhnomPenh,
  formatKhr,
  formatQty,
  formatUsdRef,
  generateId,
  todayIso,
} from '../utils/format';
import {
  getAvailableUnitsForProduct,
  getProductVariant,
  resolveBarcodeMatch,
  validateCheckoutStock,
  type StockShortage,
} from '../utils/inventoryEngine';
import { formatBarcodeTypeLabel } from '../utils/barcodeRegistry';
import {
  calculateCashTender,
  computeExactRemainingKhr,
  DEFAULT_POS_EXCHANGE_RATE,
  formatUsdClean,
  parseNonNegativeNumber,
} from '../utils/cashTender';
import { ProductPhoto } from '../components/ProductPhoto';
import { BarcodeScanner, type BarcodeScanSource } from '../components/BarcodeScanner';
import { ReceiptModal } from '../components/ReceiptModal';
import { ProductFormModal } from '../components/ProductFormModal';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { ModalPortal } from '../components/ModalPortal';
import {
  getCategoriesForScope,
  getCategoryBadgeClass,
  getCategoryById,
  getCategoryDisplayName,
  getCategoryDotClass,
  getProductTypeBadgeClass,
  getProductTypeDotClass,
  getProductTypeFilterPillClass,
  resolveProductCategoryId,
} from '../utils/categories';
import { useFilterVisibility } from '../hooks/useFilterVisibility';

interface CartEntry {
  key: string; // `${productId}::${variantId || ''}`
  productId: string;
  variantId?: string;
  quantity: number;
}

interface SalesViewProps {
  sidebarCollapsed?: boolean;
}

export const SalesView: React.FC<SalesViewProps> = ({ sidebarCollapsed = false }) => {
  const {
    settings,
    categories: rawCategories,
    cashPresets,
    products: rawProducts,
    ingredients: rawIngredients,
    barcodeRegistry: rawBarcodeRegistry,
    sales: rawSales,
    saveProduct,
    lookupBarcode,
    recordSale,
    voidSale,
    returnSaleItems,
    t,
  } = useStore();
  const categories = Array.isArray(rawCategories) ? rawCategories : [];
  const posCategories = useMemo(
    () => getCategoriesForScope(categories, 'product'),
    [categories]
  );
  const products = Array.isArray(rawProducts) ? rawProducts : [];
  const ingredients = Array.isArray(rawIngredients) ? rawIngredients : [];
  const barcodeRegistry = Array.isArray(rawBarcodeRegistry) ? rawBarcodeRegistry : [];
  const sales = Array.isArray(rawSales) ? rawSales : [];
  const isVi = settings?.language === 'vi';
  const { showUndoToast } = useUndoToast();

  const [subTab, setSubTab] = useState<'pos' | 'ledger'>('pos');
  const [posSearch, setPosSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ProductCategory>('all');
  const { filtersOpen, toggleFilters } = useFilterVisibility();
  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) + (typeFilter !== 'ALL' ? 1 : 0);

  // Right checkout panel progressive disclosure states
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [showMargins, setShowMargins] = useState(false);

  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [cartTxId, setCartTxId] = useState<string>(() => generateId('sale'));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [showUsdTender, setShowUsdTender] = useState(false);
  const [cashUsdInput, setCashUsdInput] = useState('');
  const [cashKhrInput, setCashKhrInput] = useState('');
  const cashKhrInputRef = useRef<HTMLInputElement | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState('');
  const [lastCompletedSale, setLastCompletedSale] = useState<Sale | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutShortages, setCheckoutShortages] = useState<StockShortage[]>([]);

  // Universal Barcode lookup & quick-registration state (preserves active cart)
  const [lookingUpBarcode, setLookingUpBarcode] = useState<string | null>(null);
  const [unknownBarcodePrompt, setUnknownBarcodePrompt] = useState<{
    code: string;
    format: BarcodeFormat;
    prefill: ExternalBarcodePrefill | null;
    lookedUpExternally: boolean;
  } | null>(null);
  const [quickRegisterOpen, setQuickRegisterOpen] = useState(false);

  // Modals
  const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null);
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
  const [returnQtyMap, setReturnQtyMap] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnFeedback, setReturnFeedback] = useState<string | null>(null);

  // Ledger filters
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);

  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !posCategories.some((c) => c.id === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, posCategories]);

  const activeProducts = useMemo(() => {
    const q = posSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (!p || !p.active) return false;
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (categoryFilter !== 'all' && resolveProductCategoryId(p, categories) !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const varMatch = (p.variants || []).some(
        (v) =>
          (v?.name || '').toLowerCase().includes(q) ||
          (v?.barcode || '').toLowerCase().includes(q)
      );
      const packMatch = (p.packagingBarcodes || []).some(
        (pb) =>
          (pb?.barcode || '').toLowerCase().includes(q) ||
          (pb?.label || '').toLowerCase().includes(q)
      );
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.nameVi || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        varMatch ||
        packMatch
      );
    });
  }, [products, typeFilter, categoryFilter, categories, posSearch]);

  const cartLines = useMemo(() => {
    return Object.values(cart)
      .filter((entry) => entry.quantity > 0)
      .map((entry) => {
        const product = prodMap.get(entry.productId);
        if (!product) return null;
        const variant = getProductVariant(product, entry.variantId);
        const unitPrice = variant ? variant.priceKhr : product.priceKhr;
        const unitCogs = Math.round(calculateProductCogs(product, ingredients, variant));
        return {
          ...entry,
          product,
          variant,
          unitPrice,
          lineTotal: unitPrice * entry.quantity,
          lineCogs: unitCogs * entry.quantity,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
  }, [cart, prodMap, ingredients]);

  const cartTotal = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines]);
  const cartCogs = useMemo(() => cartLines.reduce((s, l) => s + l.lineCogs, 0), [cartLines]);

  const posExchangeRate = useMemo(() => {
    const rate = Number(settings.posExchangeRate);
    return Number.isFinite(rate) && rate > 0 ? Math.round(rate) : DEFAULT_POS_EXCHANGE_RATE;
  }, [settings.posExchangeRate]);

  const cashCalc = useMemo(
    () =>
      calculateCashTender({
        totalKhr: cartTotal,
        usdReceived: parseNonNegativeNumber(cashUsdInput),
        khrReceived: parseNonNegativeNumber(cashKhrInput),
        exchangeRate: posExchangeRate,
      }),
    [cartTotal, cashUsdInput, cashKhrInput, posExchangeRate]
  );

  const isCashSelected = paymentMethod === 'cash';

  const handleQuickAddUsd = (deltaUsd: number) => {
    const current = parseNonNegativeNumber(cashUsdInput);
    const next = Math.round((current + deltaUsd) * 100) / 100;
    setCashUsdInput(String(next));
  };

  const handleSelectKhrPreset = (amountKhr: number) => {
    setCashKhrInput(String(amountKhr));
  };

  const handleExactKhr = () => {
    const remaining = computeExactRemainingKhr(
      cartTotal,
      parseNonNegativeNumber(cashUsdInput),
      posExchangeRate
    );
    setCashKhrInput(String(remaining));
  };

  const closeCashModal = () => {
    if (submitting) return;
    setCashModalOpen(false);
  };

  // Focus cash input when Cash Payment Modal opens & dismiss on Escape
  useEffect(() => {
    if (!cashModalOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      cashKhrInputRef.current?.focus();
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        setCashModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cashModalOpen, submitting]);

  // Live stock validation for current cart
  const liveStockValidation = useMemo(() => {
    return validateCheckoutStock(
      cartLines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: l.quantity,
      })),
      products,
      ingredients,
      Boolean(settings.allowNegativeStock)
    );
  }, [cartLines, products, ingredients, settings.allowNegativeStock]);

  // Strictly verify whether adding `qtyToAdd` to current cart stays within available stock
  const canAddToCart = (
    productId: string,
    variantId?: string,
    qtyToAdd = 1
  ): { allowed: boolean; reason?: string; shortages?: StockShortage[] } => {
    if (qtyToAdd <= 0 || settings.allowNegativeStock) {
      return { allowed: true };
    }
    const key = `${productId}::${variantId || ''}`;
    const nextMap: Record<string, CartEntry> = {
      ...cart,
      [key]: {
        key,
        productId,
        variantId,
        quantity: (cart[key]?.quantity || 0) + qtyToAdd,
      },
    };
    const nextItems = Object.values(nextMap)
      .filter((e) => e.quantity > 0)
      .map((e) => ({
        productId: e.productId,
        variantId: e.variantId,
        quantity: e.quantity,
      }));
    const check = validateCheckoutStock(nextItems, products, ingredients, false);
    if (!check.ok) {
      const first = check.shortages[0];
      const itemLabel = first
        ? isVi
          ? first.itemNameVi || first.itemName
          : first.itemName
        : '';
      const reason = first
        ? isVi
          ? `Đã đạt giới hạn tồn kho cho ${itemLabel} (còn ${formatQty(first.availableQty, first.unit)}).`
          : `Stock limit reached for ${itemLabel} (${formatQty(first.availableQty, first.unit)} available).`
        : isVi
          ? 'Đã đạt giới hạn tồn kho.'
          : 'Stock limit reached.';
      return { allowed: false, reason, shortages: check.shortages };
    }
    return { allowed: true };
  };

  const addEntryToCart = (productId: string, variantId?: string, qtyToAdd = 1): boolean => {
    const stockCheck = canAddToCart(productId, variantId, qtyToAdd);
    if (!stockCheck.allowed) {
      setCheckoutError(stockCheck.reason || (isVi ? 'Đã đạt giới hạn tồn kho.' : 'Stock limit reached.'));
      setCheckoutShortages(stockCheck.shortages || []);
      return false;
    }
    const key = `${productId}::${variantId || ''}`;
    setCheckoutError(null);
    setCheckoutShortages([]);
    setCart((prev) => {
      const existing = prev[key];
      return {
        ...prev,
        [key]: {
          key,
          productId,
          variantId,
          quantity: (existing?.quantity || 0) + qtyToAdd,
        },
      };
    });
    return true;
  };

  const handleProductTileClick = (product: Product) => {
    if (product.variants && product.variants.length > 1) {
      setVariantPickerProduct(product);
      return;
    }
    const onlyVariant = product.variants?.[0];
    addEntryToCart(product.id, onlyVariant?.id, 1);
  };

  const updateCartQty = (key: string, delta: number) => {
    const current = cart[key];
    if (!current) return;
    if (delta > 0) {
      const stockCheck = canAddToCart(current.productId, current.variantId, delta);
      if (!stockCheck.allowed) {
        setCheckoutError(stockCheck.reason || (isVi ? 'Đã đạt giới hạn tồn kho.' : 'Stock limit reached.'));
        setCheckoutShortages(stockCheck.shortages || []);
        return;
      }
    }
    setCheckoutError(null);
    setCheckoutShortages([]);
    setCart((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: { ...existing, quantity: nextQty } };
    });
  };

  const handleBarcodeScan = async (
    rawCode: string,
    _source: BarcodeScanSource
  ): Promise<{ ok: boolean; message: string; suppressToast?: boolean }> => {
    const cleaned = rawCode.trim();
    if (!cleaned) {
      return { ok: false, message: '', suppressToast: true };
    }

    setCheckoutError(null);
    setUnknownBarcodePrompt(null);
    setLookingUpBarcode(cleaned);

    let result;
    try {
      result = await lookupBarcode(cleaned);
    } finally {
      setLookingUpBarcode(null);
    }

    if (!result.found || !result.product) {
      // Calm quick-registration prompt (never treated as an error; keeps current cart intact)
      setUnknownBarcodePrompt({
        code: result.code || cleaned,
        format: result.format,
        prefill: result.externalPrefill || null,
        lookedUpExternally: result.lookedUpExternally,
      });
      return {
        ok: false,
        message: isVi
          ? `Mã "${result.code || cleaned}" chưa có trong kho — nhấn Đăng ký ngay.`
          : `Unregistered barcode "${result.code || cleaned}" — tap Register Now.`,
        suppressToast: true,
      };
    }

    if (!result.product.active) {
      const msg = isVi
        ? `Sản phẩm "${result.product.nameVi || result.product.name}" đang tạm ngưng bán.`
        : `"${result.product.name}" is currently paused.`;
      setCheckoutError(msg);
      return { ok: false, message: msg };
    }

    const qty = Math.max(1, result.unitsPerScan || 1);
    const availability = getAvailableUnitsForProduct(
      result.product,
      ingredients,
      result.variant?.id
    );
    if (availability.status === 'out' && !settings.allowNegativeStock) {
      const displayName = isVi ? result.product.nameVi || result.product.name : result.product.name;
      const msg = isVi
        ? `${displayName} hiện đã hết hàng trong kho.`
        : `${displayName} is currently out of stock.`;
      setCheckoutError(msg);
      return { ok: false, message: msg };
    }

    const stockCheck = canAddToCart(result.product.id, result.variant?.id, qty);
    if (!stockCheck.allowed) {
      const msg =
        stockCheck.reason ||
        (isVi ? 'Đã đạt giới hạn tồn kho.' : 'Stock limit reached.');
      setCheckoutError(msg);
      setCheckoutShortages(stockCheck.shortages || []);
      return { ok: false, message: msg };
    }

    addEntryToCart(result.product.id, result.variant?.id, qty);
    const displayName = isVi ? result.product.nameVi || result.product.name : result.product.name;
    const variantSuffix = result.variant
      ? ` (${isVi ? result.variant.nameVi || result.variant.name : result.variant.name})`
      : '';
    const packSuffix =
      qty > 1 && result.packLabel ? ` · ${result.packLabel}` : '';
    const msg = isVi
      ? `Đã thêm +${qty}× ${displayName}${variantSuffix}${packSuffix} vào giỏ`
      : `Added +${qty}× ${displayName}${variantSuffix}${packSuffix} to cart`;
    return { ok: true, message: msg };
  };

  const completeSale = async (cashTender?: {
    usdReceived: number;
    khrReceived: number;
    exchangeRate: number;
    changeDueKhr: number;
  }) => {
    if (cartLines.length === 0 || submitting) return;

    setCheckoutError(null);
    setCheckoutShortages([]);
    setSubmitting(true);
    try {
      const result = await recordSale({
        clientTxId: cartTxId,
        items: cartLines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
        })),
        paymentMethod,
        cash_received_usd: cashTender ? cashTender.usdReceived : null,
        cash_received_khr: cashTender ? cashTender.khrReceived : null,
        exchange_rate_used: cashTender ? cashTender.exchangeRate : null,
        change_given_khr: cashTender ? cashTender.changeDueKhr : null,
        customerName,
        note,
        saleDate,
      });

      if (!result.ok) {
        setCheckoutError(result.error || 'Insufficient stock for checkout.');
        setCheckoutShortages(result.shortages || []);
        return;
      }

      setCashModalOpen(false);
      setShowUsdTender(false);
      setCart({});
      setCartTxId(generateId('sale'));
      setCashUsdInput('');
      setCashKhrInput('');
      setCustomerName('');
      setNote('');
      setSaleDate(todayIso());
      setLastCompletedSale(result.sale || null);
      setToastMessage(t.sales.saleRecorded);
      window.setTimeout(() => setToastMessage(''), 6000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartLines.length === 0 || submitting || !liveStockValidation.ok) return;

    if (paymentMethod === 'cash') {
      setCheckoutError(null);
      setCheckoutShortages([]);
      setCashUsdInput('');
      setCashKhrInput('');
      setShowUsdTender(false);
      setCashModalOpen(true);
      return;
    }

    await completeSale();
  };

  const handleConfirmCashPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartLines.length === 0 || submitting || !liveStockValidation.ok) return;
    if (cartTotal > 0 && !cashCalc.isCovered) return;

    await completeSale({
      usdReceived: cashCalc.usdReceived,
      khrReceived: cashCalc.khrReceived,
      exchangeRate: cashCalc.exchangeRate,
      changeDueKhr: cashCalc.changeDueKhr,
    });
  };

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (!s) return false;
      if (paymentFilter !== 'all' && s.paymentMethod !== paymentFilter) return false;
      if (!q) return true;
      const itemsText = (s.items || [])
        .map((i) => `${i?.productName || ''} ${i?.productNameVi || ''} ${i?.variantName || ''}`)
        .join(' ')
        .toLowerCase();
      return (
        (s.orderNumber || '').toLowerCase().includes(q) ||
        (s.customerName || '').toLowerCase().includes(q) ||
        (s.recordedBy || '').toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [sales, search, paymentFilter]);

  const cashDrawerSummary = useMemo(() => {
    let cashOrderCount = 0;
    let usdBillsIn = 0;
    let khrCashIn = 0;
    let changeGivenKhr = 0;

    for (const s of filteredSales) {
      if (s.status === 'voided' || s.paymentMethod !== 'cash') continue;
      const hasTenderData =
        (s.cash_received_usd !== null && s.cash_received_usd !== undefined) ||
        (s.cash_received_khr !== null && s.cash_received_khr !== undefined);
      if (!hasTenderData) continue;
      cashOrderCount += 1;
      usdBillsIn += Number(s.cash_received_usd ?? 0);
      khrCashIn += Number(s.cash_received_khr ?? 0);
      changeGivenKhr += Number(s.change_given_khr ?? 0);
    }

    return {
      cashOrderCount,
      usdBillsIn: Math.round(usdBillsIn * 100) / 100,
      khrCashIn: Math.round(khrCashIn),
      changeGivenKhr: Math.round(changeGivenKhr),
      netKhrDrawer: Math.round(khrCashIn - changeGivenKhr),
    };
  }, [filteredSales]);

  const detailSale = useMemo(
    () => (detailSaleId ? sales.find((s) => s.id === detailSaleId) || null : null),
    [detailSaleId, sales]
  );

  const openOrderDetail = (sale: Sale) => {
    setDetailSaleId(sale.id);
    setReturnQtyMap({});
    setReturnReason('');
    setReturnFeedback(null);
  };

  const handleProcessPartialReturn = async () => {
    if (!detailSale || returnBusy) return;
    const reqs = Object.entries(returnQtyMap)
      .filter(([, q]) => q > 0)
      .map(([lineId, quantity]) => ({ lineId, quantity }));
    if (reqs.length === 0) return;

    setReturnBusy(true);
    setReturnFeedback(null);
    try {
      const res = await returnSaleItems({
        saleId: detailSale.id,
        returnItems: reqs,
        reason: returnReason || 'Customer return',
      });
      if (!res.ok) {
        setReturnFeedback(res.error || 'Could not process return.');
      } else {
        setReturnQtyMap({});
        setReturnReason('');
        setReturnFeedback(
          isVi
            ? 'Đã hoàn trả hàng và cộng lại chính xác lượng tồn kho gốc.'
            : 'Return recorded and exact original stock restored.'
        );
      }
    } finally {
      setReturnBusy(false);
    }
  };

  const getQtyInCartForProduct = (productId: string) =>
    Object.values(cart)
      .filter((c) => c.productId === productId)
      .reduce((s, c) => s + c.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Condensed Single-Row Header: Title + Inline POS / Sales Ledger Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
          {t.sales.title}
        </h1>

        <div className="inline-flex items-center p-1 bg-stone-200/70 dark:bg-[#131D18] border border-transparent dark:border-[#24352C] rounded-lg shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`h-11 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'pos'
                ? 'bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] shadow-xs'
                : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
            }`}
          >
            {t.sales.tabPos}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`h-11 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ledger'
                ? 'bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] shadow-xs'
                : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
            }`}
          >
            {t.sales.tabLedger} ({sales.length})
          </button>
        </div>
      </div>

      {/* Post-sale Toast with Quick Receipt Trigger */}
      {toastMessage && (
        <div
          role="status"
          className="bg-emerald-50 dark:bg-[#064E3B]/60 border border-emerald-200 dark:border-[#10B981]/40 text-emerald-900 dark:text-[#D1FAE5] px-4 py-3 rounded-lg text-sm font-medium flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-700 dark:text-[#34D399] shrink-0" />
            <span>{toastMessage}</span>
          </div>
          {lastCompletedSale && (
            <button
              type="button"
              onClick={() => setReceiptSale(lastCompletedSale)}
              className="inline-flex items-center gap-1.5 h-11 px-3.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg"
            >
              <Printer className="w-3.5 h-3.5" />
              {isVi ? `In hóa đơn ${lastCompletedSale.orderNumber}` : `Receipt ${lastCompletedSale.orderNumber}`}
            </button>
          )}
        </div>
      )}

      {subTab === 'pos' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Product Grid & Barcode Search */}
          <div className="lg:col-span-8 space-y-4">
            {/* Unified Search + Camera & USB/Bluetooth Barcode Scanner */}
            <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 sm:p-5 space-y-3 transition-colors">
              <BarcodeScanner
                enabled={
                  subTab === 'pos' &&
                  !cashModalOpen &&
                  !variantPickerProduct &&
                  !receiptSale &&
                  !detailSaleId &&
                  !quickRegisterOpen
                }
                isVi={isVi}
                searchValue={posSearch}
                onSearchChange={setPosSearch}
                onScan={handleBarcodeScan}
                hasBarcodeMatch={(code) =>
                  Boolean(
                    resolveBarcodeMatch(code, products) ||
                      barcodeRegistry.some((r) => r && typeof r.code === 'string' && r.code === code.trim())
                  )
                }
                secondaryLeftSlot={
                  <button
                    type="button"
                    onClick={toggleFilters}
                    aria-expanded={filtersOpen}
                    aria-controls="pos-catalog-filters"
                    className={`inline-flex items-center gap-1.5 h-11 px-3.5 text-xs font-semibold rounded-[10px] transition-colors whitespace-nowrap border ${
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
                }
                secondaryRightSlot={
                  <button
                    type="button"
                    disabled={activeFilterCount === 0 && !posSearch.trim()}
                    onClick={() => {
                      setCategoryFilter('all');
                      setTypeFilter('ALL');
                      setPosSearch('');
                    }}
                    className="inline-flex items-center justify-center h-11 px-3 text-xs font-semibold text-[#0D5C3E] dark:text-[#34D399] hover:underline disabled:text-stone-400 dark:disabled:text-[#94A39B]/40 disabled:no-underline disabled:cursor-default rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isVi ? 'Đặt lại tất cả' : 'Reset All'}
                  </button>
                }
              />

              {/* Live Registry / Open Food Facts Lookup Indicator */}
              {lookingUpBarcode && (
                <div
                  role="status"
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] text-xs text-stone-700 dark:text-[#F1F5F3]"
                >
                  <Loader2 className="w-3.5 h-3.5 text-[#0D5C3E] dark:text-[#10B981] animate-spin shrink-0" />
                  <span>
                    {isVi
                      ? `Đang kiểm tra sổ mã vạch JuiceFlow cho "${lookingUpBarcode}"...`
                      : `Checking JuiceFlow registry for "${lookingUpBarcode}"...`}
                  </span>
                </div>
              )}

              {/* Quick Prompt for Unregistered Barcodes (preserves active cart) */}
              {unknownBarcodePrompt && !lookingUpBarcode && (
                <div
                  role="status"
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C]"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ScanBarcode className="w-4 h-4 text-[#0D5C3E] dark:text-[#10B981] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Mã vạch chưa đăng ký' : 'Unregistered Barcode'}:{' '}
                        <span className="font-mono-num text-[#0D5C3E] dark:text-[#34D399]">
                          {unknownBarcodePrompt.code}
                        </span>{' '}
                        <span className="font-normal text-stone-500 dark:text-[#94A39B]">
                          ({formatBarcodeTypeLabel(unknownBarcodePrompt.format)})
                        </span>
                      </p>
                      <p className="text-[11px] text-stone-600 dark:text-[#94A39B] truncate mt-0.5">
                        {unknownBarcodePrompt.prefill
                          ? isVi
                            ? `Tìm thấy từ Open Food Facts: ${unknownBarcodePrompt.prefill.name}${unknownBarcodePrompt.prefill.brand ? ` · ${unknownBarcodePrompt.prefill.brand}` : ''} (giá KHR & tồn kho bạn tự nhập)`
                            : `Found on Open Food Facts: ${unknownBarcodePrompt.prefill.name}${unknownBarcodePrompt.prefill.brand ? ` · ${unknownBarcodePrompt.prefill.brand}` : ''} (local KHR price & stock required)`
                          : isVi
                          ? 'Không có trên Open Food Facts — nhấn Đăng ký ngay để tạo sản phẩm thủ công.'
                          : 'Not found externally — tap Register Now to add manually while keeping your cart.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => setQuickRegisterOpen(true)}
                      className="inline-flex items-center gap-1.5 h-11 px-3.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0D5C3E] hover:bg-[#0A4A31] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isVi ? 'Đăng ký ngay' : 'Register Now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnknownBarcodePrompt(null)}
                      aria-label={t.common.close}
                      className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Smooth Collapsible Category & Product Type Filter Drawer (minimum 44px touch pills) */}
              <div
                id="pos-catalog-filters"
                className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
                  filtersOpen
                    ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-stone-100 dark:border-[#24352C]'
                    : '!mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-2.5">
                    {/* Row 1: Single-Line Horizontal Category Pills (h-11 = 44px) */}
                    <CategoryFilterPills
                      categories={posCategories}
                      selectedCategoryId={categoryFilter}
                      onSelect={setCategoryFilter}
                      isVi={isVi}
                      allLabel={t.common.all}
                    />

                    {/* Row 2: Color-Coded Item Type Pills matching Inventory & Products (h-11 = 44px) */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[11px] font-semibold text-stone-500 dark:text-[#94A39B] w-16 shrink-0">
                        {isVi ? 'Loại hàng' : 'Item Type'}
                      </span>
                      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto min-w-0 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {(['ALL', 'PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as const).map(
                          (pt) => {
                            const active = typeFilter === pt;
                            return (
                              <button
                                key={pt}
                                type="button"
                                onClick={() => setTypeFilter(pt)}
                                aria-pressed={active}
                                className={`inline-flex items-center gap-1.5 h-11 px-4 text-xs font-medium rounded-full transition-colors duration-200 ease-out whitespace-nowrap shrink-0 border ${getProductTypeFilterPillClass(
                                  pt,
                                  active
                                )}`}
                              >
                                {pt !== 'ALL' && (
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${getProductTypeDotClass(
                                      pt
                                    )}`}
                                    aria-hidden="true"
                                  />
                                )}
                                <span>{pt === 'ALL' ? t.common.all : t.productTypes[pt]}</span>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {activeProducts.length === 0 ? (
              <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                {t.common.noResults}
              </div>
            ) : (
              <div
                className={`grid grid-cols-1 sm:grid-cols-2 gap-3.5 ${
                  sidebarCollapsed
                    ? 'lg:grid-cols-3 xl:grid-cols-4'
                    : 'xl:grid-cols-3'
                }`}
              >
                {activeProducts.map((product) => {
                  const qtyInCart = getQtyInCartForProduct(product.id);
                  const displayName = isVi ? product.nameVi || product.name : product.name;
                  const productVariants = Array.isArray(product.variants) ? product.variants : [];
                  const availability = getAvailableUnitsForProduct(
                    product,
                    ingredients,
                    productVariants[0]?.id
                  );
                  const hasMultiVariants = productVariants.length > 1;
                  const minPrice = hasMultiVariants
                    ? Math.min(...productVariants.map((v) => Number(v.priceKhr) || 0))
                    : productVariants[0]?.priceKhr ?? product.priceKhr;

                  const outBlocked = availability.status === 'out' && !settings.allowNegativeStock;
                  const atStockLimit =
                    !outBlocked &&
                    !settings.allowNegativeStock &&
                    (hasMultiVariants
                      ? productVariants.every((v) => !canAddToCart(product.id, v.id, 1).allowed)
                      : !canAddToCart(product.id, productVariants[0]?.id, 1).allowed);
                  const cardDisabled = outBlocked || atStockLimit;

                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={cardDisabled}
                      onClick={() => handleProductTileClick(product)}
                      title={
                        outBlocked
                          ? isVi
                            ? 'Hết hàng'
                            : 'Out of Stock'
                          : atStockLimit
                            ? isVi
                              ? 'Đã đạt giới hạn tồn kho trong giỏ'
                              : 'Stock limit reached in cart'
                            : undefined
                      }
                      className={`group text-left bg-white dark:bg-[#18251F] rounded-xl overflow-hidden transition-all duration-150 ease-out pos-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981] ${
                        outBlocked
                          ? 'opacity-60 grayscale-[40%] dark:opacity-55 dark:grayscale-[50%] border border-stone-200 dark:border-[#24352C] cursor-not-allowed'
                          : qtyInCart > 0
                            ? `border-2 border-[#0D5C3E] dark:border-[#10B981] ring-2 ring-[#0D5C3E]/15 dark:ring-[#10B981]/25 shadow-sm ${
                                atStockLimit ? 'cursor-not-allowed' : 'dark:hover:bg-[#1F3028]'
                              }`
                            : atStockLimit
                              ? 'opacity-75 border border-stone-200 dark:border-[#24352C] cursor-not-allowed'
                              : 'border border-stone-200 dark:border-[#24352C] hover:border-stone-300 dark:hover:border-[#344E41] dark:hover:bg-[#1F3028] hover:shadow-xs'
                      }`}
                    >
                      <div className="relative">
                        <ProductPhoto
                          src={product.imageUrl}
                          alt={displayName}
                          category={product.category}
                          className="w-full h-32"
                        />

                        {outBlocked && (
                          <div className="absolute inset-0 flex items-center justify-center bg-stone-900/20 dark:bg-black/45">
                            <span className="px-3 py-1 rounded-full bg-stone-900/85 dark:bg-red-950/95 text-white dark:text-red-200 border border-transparent dark:border-red-500/50 text-xs font-semibold tracking-wide shadow-xs">
                              {isVi ? 'Hết hàng' : 'Out of Stock'}
                            </span>
                          </div>
                        )}

                        {!outBlocked && qtyInCart > 0 && (
                          <span className="absolute top-2 right-2 bg-[#0D5C3E] text-white dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border dark:border-[#10B981]/50 font-mono-num text-[11px] font-semibold px-2.5 py-0.5 rounded-full shadow-xs">
                            {isVi ? `${qtyInCart} trong giỏ` : `${qtyInCart} in cart`}
                          </span>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${getProductTypeBadgeClass(
                                product.productType
                              )}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${getProductTypeDotClass(
                                  product.productType
                                )}`}
                                aria-hidden="true"
                              />
                              {t.productTypes[product.productType] || product.productType}
                            </span>
                            {(() => {
                              const catItem = getCategoryById(
                                resolveProductCategoryId(product, categories),
                                categories
                              );
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${getCategoryBadgeClass(
                                    catItem
                                  )}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${getCategoryDotClass(
                                      catItem
                                    )}`}
                                    aria-hidden="true"
                                  />
                                  {getCategoryDisplayName(catItem, isVi)}
                                </span>
                              );
                            })()}
                            {hasMultiVariants && (
                              <span className="text-stone-500 dark:text-[#94A39B] truncate">
                                {productVariants.length} {isVi ? 'cỡ' : 'sizes'}
                              </span>
                            )}
                          </div>
                          {atStockLimit ? (
                            <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                              {isVi ? 'Đạt giới hạn' : 'Max limit'}
                            </span>
                          ) : (
                            availability.availableUnits !== null && (
                              <span
                                className={`font-mono-num font-semibold shrink-0 ${
                                  availability.status === 'out'
                                    ? 'text-red-700 dark:text-[#F87171]'
                                    : availability.status === 'low'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-[#0D5C3E] dark:text-[#34D399]'
                                }`}
                              >
                                {availability.status === 'out'
                                  ? isVi
                                    ? 'Hết hàng'
                                    : 'Out'
                                  : product.productType === 'PREPARED_TO_ORDER'
                                  ? `~${availability.availableUnits}`
                                  : `${availability.availableUnits} ${product.unit}`}
                              </span>
                            )
                          )}
                        </div>
                        <h3 className="mt-1 font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                          {displayName}
                        </h3>
                        <div className="mt-1.5 flex items-baseline justify-between gap-2">
                          <span className="font-mono-num text-sm font-bold text-[#0D5C3E] dark:text-[#34D399]">
                            {hasMultiVariants ? `${formatKhr(minPrice)}+` : formatKhr(minPrice)}
                          </span>
                          <span className="text-[11px] text-stone-400 dark:text-[#94A39B] font-mono-num">
                            {formatUsdRef(minPrice, settings.usdRate)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pinned Right-Hand "Current Order" Checkout Panel (4-region layout keeps Total & 48px Charge CTA permanently pinned) */}
          <form
            onSubmit={handleCheckout}
            className="lg:col-span-4 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-[80px] lg:h-[calc(100vh-96px)] transition-colors"
          >
            {/* Region 1: Pinned Panel Header */}
            <div className="px-4 sm:px-5 py-2.5 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingBag className="w-4 h-4 text-[#0D5C3E] dark:text-[#10B981] shrink-0" />
                <h2 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.sales.cartTitle}
                </h2>
                {cartLines.length > 0 && (
                  <span className="font-mono-num text-xs font-semibold text-[#0D5C3E] dark:text-[#6EE7B7] bg-[#E6F2ED] dark:bg-[#064E3B] px-2 py-0.5 rounded-full shrink-0">
                    {cartLines.reduce((s, l) => s + l.quantity, 0)}
                  </span>
                )}
              </div>
              {cartLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const prevCart = { ...cart };
                    const prevCashUsd = cashUsdInput;
                    const prevCashKhr = cashKhrInput;
                    const itemCount = cartLines.reduce((s, l) => s + l.quantity, 0);
                    const totalSnapshot = cartTotal;

                    setCart({});
                    setCashUsdInput('');
                    setCashKhrInput('');
                    setCheckoutError(null);
                    setCheckoutShortages([]);

                    showUndoToast({
                      message: isVi
                        ? `Đã xóa giỏ hàng (${itemCount} món)`
                        : `Cleared cart (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`,
                      detail: formatKhr(totalSnapshot),
                      onUndo: () => {
                        setCart(prevCart);
                        setCashUsdInput(prevCashUsd);
                        setCashKhrInput(prevCashKhr);
                        setCheckoutError(null);
                        setCheckoutShortages([]);
                      },
                    });
                  }}
                  className="h-11 px-2.5 -mr-2 text-xs font-medium text-stone-500 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg transition-colors shrink-0"
                >
                  {isVi ? 'Xóa giỏ' : 'Clear'}
                </button>
              )}
            </div>

            {/* Region 2: Spacious Scrollable Cart Line Items + Stock Warnings */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-2 space-y-3">
              {cartLines.length === 0 ? (
                <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center py-8 text-sm text-stone-400 dark:text-[#94A39B]">
                  <ShoppingBag className="w-7 h-7 text-stone-300 dark:text-[#24352C] mb-2" />
                  <p>{t.sales.emptyCart}</p>
                </div>
              ) : (
                <ul className="divide-y divide-stone-100 dark:divide-[#24352C]">
                  {cartLines.map(({ key, product, variant, unitPrice, quantity, lineTotal }) => {
                    const incCheck = canAddToCart(product.id, variant?.id, 1);
                    return (
                      <li key={key} className="py-2.5 flex items-center justify-between gap-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3] truncate">
                            {isVi ? product.nameVi || product.name : product.name}
                            {variant ? (
                              <span className="text-stone-500 dark:text-[#94A39B] font-normal">
                                {' '}
                                ({isVi ? variant.nameVi || variant.name : variant.name})
                              </span>
                            ) : null}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num mt-0.5">
                            <span>
                              {formatKhr(unitPrice)} × {quantity}
                            </span>
                            {!incCheck.allowed && (
                              <span className="text-[10px] font-sans font-semibold text-amber-700 dark:text-amber-400">
                                · {isVi ? 'Tối đa' : 'Max'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Touch-Friendly 36x36px (- / +) Steppers with 8px spacing */}
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateCartQty(key, -1)}
                              aria-label="Decrease quantity"
                              className="w-9 h-9 inline-flex items-center justify-center border border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="font-mono-num text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] min-w-[20px] text-center">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              disabled={!incCheck.allowed}
                              onClick={() => updateCartQty(key, 1)}
                              aria-label="Increase quantity"
                              title={
                                !incCheck.allowed
                                  ? incCheck.reason || (isVi ? 'Đã đạt giới hạn tồn kho' : 'Stock limit reached')
                                  : undefined
                              }
                              className="w-9 h-9 inline-flex items-center justify-center border border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] disabled:opacity-35 disabled:cursor-not-allowed rounded-lg transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <span className="font-mono-num text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] w-[72px] text-right">
                            {formatKhr(lineTotal)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Live Stock Shortage Warning / Limit Notice */}
              {(liveStockValidation.shortages.length > 0 || checkoutError) && (
                <div
                  role="alert"
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    settings.allowNegativeStock && !checkoutError
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-500/40 text-amber-900 dark:text-amber-200'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-500/40 text-red-900 dark:text-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="leading-snug">
                        {checkoutError ||
                          (settings.allowNegativeStock
                            ? isVi
                              ? 'Cảnh báo âm kho (đang bật chế độ cho phép):'
                              : 'Negative stock override active:'
                            : isVi
                            ? 'Không đủ tồn kho để thanh toán:'
                            : 'Insufficient stock — checkout blocked:')}
                      </span>
                    </div>
                    {checkoutError && (
                      <button
                        type="button"
                        onClick={() => {
                          setCheckoutError(null);
                          setCheckoutShortages([]);
                        }}
                        aria-label={t.common.close}
                        className="w-8 h-8 inline-flex items-center justify-center opacity-70 hover:opacity-100 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {(checkoutShortages.length > 0
                    ? checkoutShortages
                    : liveStockValidation.shortages
                  ).length > 0 && (
                    <ul className="space-y-0.5 pl-5 list-disc font-mono-num">
                      {(checkoutShortages.length > 0
                        ? checkoutShortages
                        : liveStockValidation.shortages
                      ).map((sh) => (
                        <li key={sh.itemId}>
                          {isVi ? sh.itemNameVi || sh.itemName : sh.itemName}: need{' '}
                          {formatQty(sh.requiredQty, sh.unit)}, have{' '}
                          {formatQty(sh.availableQty, sh.unit)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Region 3: Compact Pinned Checkout Footer (Details Accordion, 1-Row Payment Selector, Total, 48px Charge CTA) */}
            <div className="shrink-0 border-t border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] px-4 sm:px-5 py-3 space-y-2.5">
              {/* Collapsible 1-Line "Order Details & Notes" Accordion (44px touch height) */}
              <div className="border border-stone-200 dark:border-[#24352C] rounded-lg bg-stone-50/60 dark:bg-[#18251F] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOrderDetailsOpen((prev) => !prev)}
                  aria-expanded={orderDetailsOpen}
                  aria-controls="pos-order-details-panel"
                  className="w-full h-11 px-3 flex items-center justify-between gap-2 text-xs font-medium text-stone-700 dark:text-[#F1F5F3] hover:bg-stone-100/70 dark:hover:bg-[#1F3028] transition-colors"
                >
                  <span className="truncate">
                    {isVi ? 'Chi tiết đơn & Ghi chú' : 'Order Details & Notes'}
                    {(customerName.trim() || note.trim()) && !orderDetailsOpen && (
                      <span className="text-stone-400 dark:text-[#94A39B] font-normal">
                        {' '}
                        · {[customerName.trim(), note.trim()].filter(Boolean).join(' — ')}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                      orderDetailsOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <div
                  id="pos-order-details-panel"
                  className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
                    orderDetailsOpen
                      ? 'grid-rows-[1fr] opacity-100'
                      : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-3 pb-3 pt-2.5 border-t border-stone-200/80 dark:border-[#24352C] bg-white dark:bg-[#131D18] space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                            {t.common.date}
                          </label>
                          <input
                            type="date"
                            value={saleDate}
                            onChange={(e) => setSaleDate(e.target.value)}
                            className="w-full h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                            {t.common.operator}
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={settings.activeOperator}
                            className="w-full h-11 px-2.5 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-stone-50 dark:bg-[#0B110E] text-stone-700 dark:text-[#94A39B]"
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        maxLength={80}
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder={t.sales.customerPlaceholder}
                        className="w-full h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                      />
                      <input
                        type="text"
                        maxLength={200}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t.sales.notePlaceholder}
                        className="w-full h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Compact Single-Row Payment Method Selector (44px touch height) */}
              <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t.common.payment}>
                {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => {
                  const selected = paymentMethod === pm;
                  return (
                    <button
                      key={pm}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPaymentMethod(pm)}
                      className={`h-11 px-1.5 text-[11px] xl:text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap truncate ${
                        selected
                          ? 'border-[#0D5C3E] bg-[#E6F2ED] text-[#0D5C3E] dark:border-[#10B981] dark:bg-[#064E3B] dark:text-[#D1FAE5]'
                          : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                      }`}
                    >
                      {t.paymentMethods[pm]}
                    </button>
                  );
                })}
              </div>

              {/* Optional Hidden Margin Breakdown + Total Row with Eye Toggle */}
              <div className="space-y-1.5 pt-1 border-t border-stone-100 dark:border-[#24352C]">
                {showMargins && (
                  <div className="space-y-1 pb-1.5 border-b border-stone-100 dark:border-[#24352C] text-xs">
                    <div className="flex justify-between text-stone-500 dark:text-[#94A39B]">
                      <span>{t.sales.estimatedCogs}</span>
                      <span className="font-mono-num">{formatKhr(cartCogs)}</span>
                    </div>
                    <div className="flex justify-between text-[#0D5C3E] dark:text-[#34D399] font-medium">
                      <span>{t.sales.estProfit}</span>
                      <span className="font-mono-num">{formatKhr(cartTotal - cartCogs)}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                      {t.common.total}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMargins((prev) => !prev)}
                      aria-label={
                        showMargins
                          ? isVi
                            ? 'Ẩn giá vốn & lợi nhuận'
                            : 'Hide cost & profit'
                          : isVi
                            ? 'Hiện giá vốn & lợi nhuận'
                            : 'Show cost & profit'
                      }
                      title={
                        showMargins
                          ? isVi
                            ? 'Ẩn giá vốn & lợi nhuận'
                            : 'Hide cost & profit'
                          : isVi
                            ? 'Hiện giá vốn & lợi nhuận'
                            : 'Show cost & profit'
                      }
                      className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                    >
                      {showMargins ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="font-mono-num text-xl font-bold text-stone-900 dark:text-[#F1F5F3] leading-none">
                      {formatKhr(cartTotal)}
                    </span>
                    <span className="block font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] mt-0.5">
                      {formatUsdRef(cartTotal, isCashSelected ? posExchangeRate : settings.usdRate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pinned Full-Width 48px Primary Charge CTA */}
              <button
                type="submit"
                disabled={cartLines.length === 0 || submitting || !liveStockValidation.ok}
                className="w-full h-12 px-4 text-sm font-bold text-white dark:text-[#042419] bg-[#0D5C3E] hover:bg-[#0A4A31] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap font-mono-num"
              >
                {submitting
                  ? isVi
                    ? 'Đang xử lý...'
                    : 'Recording Sale...'
                  : isVi
                    ? `Thu ${formatKhr(cartTotal)}`
                    : `Charge ${formatKhr(cartTotal)}`}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Sales Ledger Tab */
        <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-[#24352C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.sales.searchOrders}
                className="w-full h-11 pl-10 pr-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'cash', 'khqr', 'aba', 'wing'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPaymentFilter(pm)}
                  className={`h-11 px-3.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 border ${
                    paymentFilter === pm
                      ? 'bg-stone-900 text-white border-stone-900 dark:bg-[#10B981] dark:text-[#042419] dark:border-[#10B981] font-semibold'
                      : 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  {pm === 'all' ? t.common.all : t.paymentMethods[pm]}
                </button>
              ))}
            </div>
          </div>

          {/* End-of-Day Dual-Currency Cash Drawer Reconciliation Strip */}
          {cashDrawerSummary.cashOrderCount > 0 && (
            <div className="px-5 py-3 bg-stone-50/80 dark:bg-[#18251F]/70 border-b border-stone-200 dark:border-[#24352C] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'Tiền USD thu vào' : 'USD Bills Received'}
                </span>
                <span className="font-mono-num text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {formatUsdClean(cashDrawerSummary.usdBillsIn)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'Tiền KHR thu vào' : 'KHR Cash Received'}
                </span>
                <span className="font-mono-num text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {formatKhr(cashDrawerSummary.khrCashIn)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'Tiền thối KHR đã trả' : 'KHR Change Given'}
                </span>
                <span className="font-mono-num text-sm font-semibold text-amber-700 dark:text-amber-400">
                  -{formatKhr(cashDrawerSummary.changeGivenKhr)}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'KHR thực giữ trong két' : 'Net KHR in Drawer'}
                </span>
                <span className="font-mono-num text-sm font-semibold text-[#0D5C3E] dark:text-[#34D399]">
                  {formatKhr(cashDrawerSummary.netKhrDrawer)}
                </span>
              </div>
            </div>
          )}

          {filteredSales.length === 0 ? (
            <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">{t.common.noResults}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/60">
                    <th className="py-3 px-5 font-medium">Order / {t.common.date}</th>
                    <th className="py-3 px-4 font-medium">{t.sales.itemsSummary}</th>
                    <th className="py-3 px-4 font-medium">{t.common.payment}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.sales.cogs}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.common.total}</th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#24352C] text-sm">
                  {filteredSales.map((sale) => {
                    const netTotal =
                      sale.status === 'voided'
                        ? 0
                        : sale.netTotalKhr ?? Math.max(0, sale.totalKhr - (sale.refundedKhr ?? 0));
                    const netCogs =
                      sale.status === 'voided'
                        ? 0
                        : Math.max(0, sale.cogsKhr - (sale.refundedCogsKhr ?? 0));
                    const canModify =
                      sale.status === 'completed' || sale.status === 'partially_returned';

                    return (
                      <tr key={sale.id} className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/60 transition-colors">
                        <td className="py-3.5 px-5 whitespace-nowrap">
                          <p className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {sale.orderNumber}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                            {sale.saleDate} ·{' '}
                            <span
                              className={
                                sale.status === 'voided'
                                  ? 'text-red-700 dark:text-[#F87171] font-medium'
                                  : sale.status === 'partially_returned' ||
                                    sale.status === 'refunded'
                                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                                  : 'text-emerald-700 dark:text-[#34D399]'
                              }
                            >
                              {sale.status === 'voided'
                                ? t.sales.voided
                                : sale.status === 'partially_returned'
                                ? isVi
                                  ? 'Trả 1 phần'
                                  : 'Partial Return'
                                : sale.status === 'refunded'
                                ? isVi
                                  ? 'Đã hoàn trả'
                                  : 'Refunded'
                                : t.sales.completed}
                            </span>
                          </p>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="text-stone-900 dark:text-[#F1F5F3]">
                            {(sale.items || [])
                              .map(
                                (i) =>
                                  `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}${
                                    i.variantName ? ` (${i.variantName})` : ''
                                  }`
                              )
                              .join(', ')}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] truncate mt-0.5">
                            {[sale.recordedBy, sale.customerName, sale.note]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                          <span className="font-medium text-stone-700 dark:text-[#F1F5F3]">
                            {t.paymentMethods[sale.paymentMethod] || sale.paymentMethod}
                          </span>
                          {sale.paymentMethod === 'cash' &&
                            ((sale.cash_received_usd !== null &&
                              sale.cash_received_usd !== undefined) ||
                              (sale.cash_received_khr !== null &&
                                sale.cash_received_khr !== undefined)) && (
                              <span className="block text-[11px] text-stone-500 dark:text-[#94A39B] font-mono-num mt-0.5">
                                {[
                                  (sale.cash_received_usd ?? 0) > 0
                                    ? formatUsdClean(sale.cash_received_usd ?? 0)
                                    : null,
                                  (sale.cash_received_khr ?? 0) > 0
                                    ? formatKhr(sale.cash_received_khr ?? 0)
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' + ') || '0 ៛'}
                                {sale.change_given_khr !== null &&
                                sale.change_given_khr !== undefined
                                  ? ` · ${isVi ? 'Thối' : 'Chg'} ${formatKhr(sale.change_given_khr)}`
                                  : ''}
                              </span>
                            )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                          {formatKhr(netCogs)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num whitespace-nowrap">
                          <span
                            className={
                              sale.status === 'voided'
                                ? 'line-through text-stone-400 dark:text-[#94A39B]/60'
                                : 'font-semibold text-stone-900 dark:text-[#F1F5F3]'
                            }
                          >
                            {formatKhr(netTotal)}
                          </span>
                          {sale.refundedKhr && sale.refundedKhr > 0 && sale.status !== 'voided' ? (
                            <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                              -{formatKhr(sale.refundedKhr)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setReceiptSale(sale)}
                              className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-stone-100 dark:hover:bg-[#1F3028]"
                              title="Receipt"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openOrderDetail(sale)}
                              className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-[#E6F2ED] dark:hover:bg-[#064E3B]/50"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {isVi ? 'Chi tiết' : 'Details'}
                            </button>
                            {canModify &&
                              (confirmVoidId === sale.id ? (
                                <span className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await voidSale(sale.id, 'Voided from ledger');
                                      setConfirmVoidId(null);
                                    }}
                                    className="text-xs font-semibold text-red-700 dark:text-[#F87171] hover:underline"
                                  >
                                    {t.sales.voidOrder}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmVoidId(null)}
                                    className="text-xs text-stone-500 dark:text-[#94A39B]"
                                  >
                                    {t.common.cancel}
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmVoidId(sale.id)}
                                  className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40"
                                  title={t.sales.voidOrder}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Size Variant Picker Modal */}
      {variantPickerProduct && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setVariantPickerProduct(null);
            }}
          >
            <div className="w-full max-w-sm bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl overflow-hidden shadow-2xl animate-modal">
            <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3]">
                  {isVi
                    ? variantPickerProduct.nameVi || variantPickerProduct.name
                    : variantPickerProduct.name}
                </h3>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'Chọn kích cỡ để thêm vào đơn' : 'Choose size variant to add to order'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariantPickerProduct(null)}
                className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5">
              {(variantPickerProduct.variants || []).map((variant) => {
                const avail = getAvailableUnitsForProduct(
                  variantPickerProduct,
                  ingredients,
                  variant.id
                );
                const outBlocked = avail.status === 'out' && !settings.allowNegativeStock;
                const variantLimitCheck = canAddToCart(variantPickerProduct.id, variant.id, 1);
                const blocked = outBlocked || !variantLimitCheck.allowed;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      if (addEntryToCart(variantPickerProduct.id, variant.id, 1)) {
                        setVariantPickerProduct(null);
                      }
                    }}
                    className="w-full min-h-[52px] px-4 py-3 bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:border-[#0D5C3E] dark:hover:border-[#10B981] hover:bg-[#E6F2ED]/50 dark:hover:bg-[#1F3028] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg flex items-center justify-between transition-colors"
                  >
                    <div className="text-left">
                      <div className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? variant.nameVi || variant.name : variant.name}
                      </div>
                      {!outBlocked && !variantLimitCheck.allowed ? (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                          {isVi ? 'Đã đạt giới hạn tồn kho' : 'Stock limit reached in cart'}
                        </div>
                      ) : (
                        avail.availableUnits !== null && (
                          <div className="text-[11px] text-stone-500 dark:text-[#94A39B] font-mono-num">
                            {avail.status === 'out'
                              ? isVi
                                ? 'Thiếu nguyên liệu'
                                : `Out (${avail.limitingItemName})`
                              : `~${avail.availableUnits} makeable`}
                          </div>
                        )
                      )}
                    </div>
                    <span className="font-mono-num text-sm font-bold text-[#0D5C3E] dark:text-[#34D399]">
                      {formatKhr(variant.priceKhr)}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Order Details & Partial Return Modal */}
      {detailSale && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDetailSaleId(null);
            }}
          >
            <div className="w-full max-w-xl bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl my-8 overflow-hidden shadow-2xl animate-modal">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3]">
                  {detailSale.orderNumber} ·{' '}
                  <span className="text-sm font-medium text-stone-500 dark:text-[#94A39B]">
                    {formatDateTimeInPhnomPenh(detailSale.createdAt)} (ICT)
                  </span>
                </h2>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {t.paymentMethods[detailSale.paymentMethod]} · {detailSale.recordedBy} ·{' '}
                  {detailSale.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailSaleId(null)}
                className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Cash Drawer Breakdown (for Cash orders with tender data) */}
              {detailSale.paymentMethod === 'cash' &&
                ((detailSale.cash_received_usd !== null &&
                  detailSale.cash_received_usd !== undefined) ||
                  (detailSale.cash_received_khr !== null &&
                    detailSale.cash_received_khr !== undefined)) && (
                  <div className="p-3.5 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isVi ? 'Nhận USD' : 'USD Received'}
                      </span>
                      <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {formatUsdClean(detailSale.cash_received_usd ?? 0)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isVi ? 'Nhận KHR' : 'KHR Received'}
                      </span>
                      <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {formatKhr(detailSale.cash_received_khr ?? 0)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isVi ? 'Tỷ giá áp dụng' : 'Rate Used'}
                      </span>
                      <span className="font-mono-num font-semibold text-stone-700 dark:text-[#F1F5F3]">
                        {(detailSale.exchange_rate_used ?? posExchangeRate).toLocaleString('en-US')}{' '}
                        ៛/$
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isVi ? 'Tiền thối KHR' : 'Change Given'}
                      </span>
                      <span className="font-mono-num font-semibold text-[#0D5C3E] dark:text-[#34D399]">
                        {formatKhr(detailSale.change_given_khr ?? 0)}
                      </span>
                    </div>
                  </div>
                )}

              {/* Line Items + Return Quantity Pickers */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-stone-700 dark:text-[#94A39B] uppercase tracking-wide">
                  {isVi ? 'Chi tiết món & Hoàn trả một phần' : 'Order Items & Partial Returns'}
                </h3>
                <div className="divide-y divide-stone-100 dark:divide-[#24352C] border border-stone-200 dark:border-[#24352C] rounded-lg">
                  {(detailSale.items || []).map((item, idx) => {
                    const lineId = item.lineId || `${detailSale.id}_line_${idx}`;
                    const returned = item.returnedQty ?? 0;
                    const remaining = Math.max(0, item.quantity - returned);
                    const selectedReturn = returnQtyMap[lineId] || 0;
                    const canReturnLine =
                      remaining > 0 &&
                      (detailSale.status === 'completed' ||
                        detailSale.status === 'partially_returned');

                    return (
                      <div key={lineId} className="p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {item.quantity}×{' '}
                              {isVi ? item.productNameVi || item.productName : item.productName}
                              {item.variantName ? ` (${item.variantName})` : ''}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                              {formatKhr(item.unitPriceKhr)} ea · COGS {formatKhr(item.unitCogsKhr)}
                              {returned > 0 ? ` · Returned: ${returned}` : ''}
                            </p>
                          </div>

                          {canReturnLine && (
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-stone-500 dark:text-[#94A39B]">
                                {isVi ? 'Trả:' : 'Return:'}
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={remaining}
                                value={selectedReturn}
                                onChange={(e) =>
                                  setReturnQtyMap((prev) => ({
                                    ...prev,
                                    [lineId]: Math.min(
                                      remaining,
                                      Math.max(0, Math.round(Number(e.target.value) || 0))
                                    ),
                                  }))
                                }
                                className="w-16 h-11 px-2 text-xs font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-300 dark:border-[#24352C] rounded-md text-center"
                              />
                            </div>
                          )}
                        </div>

                        {/* Immutable Stock Deduction Snapshot */}
                        {item.deductions && item.deductions.length > 0 && (
                          <p className="text-[11px] text-stone-500 dark:text-[#94A39B] font-mono-num">
                            {isVi ? 'Đã trừ kho gốc: ' : 'Original deduction snapshot: '}
                            {item.deductions
                              .map((d) => `${d.itemName} (-${formatQty(d.totalDeductedQty, d.unit)})`)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Partial Return Action Bar */}
              {(detailSale.status === 'completed' ||
                detailSale.status === 'partially_returned') && (
                <div className="p-3.5 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg space-y-2.5">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      placeholder={
                        isVi
                          ? 'Lý do trả hàng (VD: Khách đổi ý, giao nhầm...)'
                          : 'Return reason (e.g., Customer changed mind, wrong size...)'
                      }
                      className="flex-1 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#0B110E] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                    />
                    <button
                      type="button"
                      disabled={
                        returnBusy ||
                        Object.values(returnQtyMap).every((q) => !q || q <= 0)
                      }
                      onClick={handleProcessPartialReturn}
                      className="inline-flex items-center justify-center gap-1.5 h-11 px-4 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-45 rounded-lg whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isVi ? 'Xác nhận hoàn trả' : 'Process Return'}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-500 dark:text-[#94A39B]">
                    {isVi
                      ? 'Hoàn trả luôn cộng lại đúng số lượng đã trừ khi bán (không bị ảnh hưởng nếu bạn đã sửa công thức sau đó).'
                      : 'Returns always restore exact original deduction snapshots (safe even if product recipes were edited later).'}
                  </p>
                </div>
              )}

              {returnFeedback && (
                <p className="text-xs font-semibold text-[#0F5C43] dark:text-[#34D399]">{returnFeedback}</p>
              )}

              {/* Prior Return History */}
              {detailSale.returns && detailSale.returns.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-stone-700 dark:text-[#94A39B]">
                    {isVi ? 'Lịch sử hoàn trả' : 'Return History'}
                  </h4>
                  {detailSale.returns.map((ret) => (
                    <div
                      key={ret.id}
                      className="text-xs text-stone-600 dark:text-[#94A39B] flex justify-between border-b border-stone-100 dark:border-[#24352C] py-1.5"
                    >
                      <span>
                        {ret.returnDate} · {ret.reason} ({ret.recordedBy})
                      </span>
                      <span className="font-mono-num font-semibold text-amber-700 dark:text-amber-400">
                        -{formatKhr(ret.refundTotalKhr)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setReceiptSale(detailSale)}
                className="inline-flex items-center gap-1.5 h-11 px-4 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-lg"
              >
                <Printer className="w-3.5 h-3.5" />
                {isVi ? 'In / Chép hóa đơn' : 'Print / Copy Receipt'}
              </button>
              <button
                type="button"
                onClick={() => setDetailSaleId(null)}
                className="h-11 px-5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg"
              >
                {t.common.close}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Dedicated Cash Payment Modal (Triggered when Cash is selected & Charge is clicked) */}
      {cashModalOpen && (
        <ModalPortal>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-payment-modal-title"
            onClick={closeCashModal}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
          >
            <form
              onSubmit={handleConfirmCashPayment}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl shadow-2xl overflow-hidden my-auto animate-modal"
            >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[#E6F2ED] dark:bg-[#064E3B] text-[#0D5C3E] dark:text-[#34D399] inline-flex items-center justify-center shrink-0">
                  <Banknote className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="cash-payment-modal-title"
                    className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] truncate"
                  >
                    {isVi ? 'Thanh toán tiền mặt' : 'Cash Payment'}
                  </h2>
                  <p className="text-[11px] font-mono-num text-stone-500 dark:text-[#94A39B]">
                    {cartLines.reduce((s, l) => s + l.quantity, 0)}{' '}
                    {isVi ? 'món' : cartLines.reduce((s, l) => s + l.quantity, 0) === 1 ? 'item' : 'items'}
                    {' · '}
                    {isVi ? 'Tỷ giá' : 'Rate'}: {posExchangeRate.toLocaleString('en-US')} ៛/$
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={closeCashModal}
                aria-label={t.common.close}
                className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] disabled:opacity-45 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Order Total Summary Banner */}
              <div className="rounded-xl bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] px-4 py-3.5 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-[#94A39B]">
                  {isVi ? 'Tổng đơn hàng' : 'Order Total'}
                </span>
                <div className="text-right">
                  <div className="font-mono-num text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] leading-tight">
                    {formatKhr(cartTotal)}
                  </div>
                  <div className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                    {formatUsdRef(cartTotal, posExchangeRate)}
                  </div>
                </div>
              </div>

              {/* Freely Editable Cash Received Input + Exact Button */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="cash-modal-khr-input"
                    className="text-xs font-semibold text-stone-700 dark:text-[#F1F5F3]"
                  >
                    {isVi ? 'Tiền khách đưa (KHR ៛)' : 'Cash Received (KHR ៛)'}
                  </label>
                  {cashCalc.hasAnyInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setCashKhrInput('');
                        setCashUsdInput('');
                        cashKhrInputRef.current?.focus();
                      }}
                      className="text-xs font-medium text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] underline px-1 py-0.5"
                    >
                      {isVi ? 'Xóa số tiền' : 'Clear'}
                    </button>
                  )}
                </div>

                <div className="flex items-stretch gap-2.5">
                  <div className="relative flex-1">
                    <input
                      ref={cashKhrInputRef}
                      id="cash-modal-khr-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={cashKhrInput}
                      onChange={(e) => {
                        const sanitized = e.target.value.replace(/[^0-9,]/g, '');
                        setCashKhrInput(sanitized);
                      }}
                      placeholder="0"
                      className="w-full h-12 pl-3.5 pr-10 text-lg font-mono-num font-bold text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] bg-white dark:bg-[#0B110E] border-2 border-stone-200 dark:border-[#24352C] rounded-xl focus:outline-none focus:border-[#0D5C3E] dark:focus:border-[#10B981] transition-colors"
                    />
                    {cashKhrInput ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCashKhrInput('');
                          cashKhrInputRef.current?.focus();
                        }}
                        aria-label={isVi ? 'Xóa tiền KHR' : 'Clear KHR'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-stone-400 dark:text-[#94A39B]">
                        ៛
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleExactKhr}
                    disabled={cartTotal <= 0}
                    className="h-12 px-4 sm:px-5 text-sm font-bold text-[#0D5C3E] dark:text-[#6EE7B7] bg-[#E6F2ED] dark:bg-[#064E3B] border border-[#0D5C3E]/30 dark:border-[#10B981]/50 hover:bg-[#D5EAE0] dark:hover:bg-[#065F46] disabled:opacity-45 rounded-xl transition-all duration-150 ease-out whitespace-nowrap shrink-0"
                  >
                    {isVi ? 'Đủ tiền' : 'Exact'}
                  </button>
                </div>
              </div>

              {/* User-Configured Quick-Cash Preset Buttons */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-[#94A39B]">
                    {isVi ? 'Chọn nhanh' : 'Quick Cash'}
                  </span>
                </div>
                {cashPresets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {cashPresets.map((amt) => {
                      const isActivePreset =
                        !cashUsdInput && parseNonNegativeNumber(cashKhrInput) === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => handleSelectKhrPreset(amt)}
                          className={`h-12 px-3 text-sm font-mono-num font-bold rounded-xl border transition-all duration-150 ease-out whitespace-nowrap ${
                            isActivePreset
                              ? 'border-[#0D5C3E] bg-[#E6F2ED] text-[#0D5C3E] dark:border-[#10B981] dark:bg-[#064E3B] dark:text-[#D1FAE5]'
                              : 'border-stone-200 dark:border-[#24352C] bg-stone-50/70 dark:bg-[#18251F] text-stone-800 dark:text-[#F1F5F3] hover:border-[#0D5C3E] dark:hover:border-[#10B981] hover:bg-[#E6F2ED]/50 dark:hover:bg-[#1F3028]'
                          }`}
                        >
                          {amt.toLocaleString('en-US')} ៛
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                    {isVi
                      ? 'Bạn có thể thêm nút chọn nhanh trong Cài đặt.'
                      : 'Add custom quick-cash buttons in Settings.'}
                  </p>
                )}
              </div>

              {/* Optional Collapsible USD Tender Support (Dual-Currency Cash Drawer) */}
              <div className="border-t border-stone-100 dark:border-[#24352C] pt-2">
                <button
                  type="button"
                  onClick={() => setShowUsdTender((prev) => !prev)}
                  aria-expanded={showUsdTender}
                  className="h-11 w-full px-2 flex items-center justify-between text-xs font-semibold text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg hover:bg-stone-50 dark:hover:bg-[#18251F] transition-colors"
                >
                  <span>
                    {isVi ? 'Khách đưa thêm tiền USD ($)?' : 'Also received USD bills ($)?'}
                    {cashCalc.usdReceived > 0 && !showUsdTender && (
                      <span className="ml-1.5 font-mono-num text-[#0D5C3E] dark:text-[#34D399]">
                        · {formatUsdClean(cashCalc.usdReceived)}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showUsdTender ? 'rotate-180' : ''}`}
                  />
                </button>

                <div
                  className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
                    showUsdTender
                      ? 'grid-rows-[1fr] opacity-100 mt-2'
                      : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="p-3 rounded-xl bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] space-y-2.5">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400 dark:text-[#94A39B]">
                          $
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={cashUsdInput}
                          onChange={(e) => setCashUsdInput(e.target.value)}
                          placeholder="0"
                          aria-label={isVi ? 'Nhận USD ($)' : 'USD Received ($)'}
                          className="w-full h-11 pl-8 pr-9 text-sm font-mono-num font-bold text-stone-900 dark:text-[#F1F5F3] bg-white dark:bg-[#0B110E] border border-stone-200 dark:border-[#24352C] rounded-lg focus:outline-none focus:border-[#0D5C3E] dark:focus:border-[#10B981]"
                        />
                        {cashUsdInput && (
                          <button
                            type="button"
                            onClick={() => setCashUsdInput('')}
                            aria-label="Clear USD"
                            className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3]"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 5, 10, 20].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => handleQuickAddUsd(amt)}
                            className="h-11 text-xs font-mono-num font-semibold text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:border-[#0D5C3E] dark:hover:border-[#10B981] rounded-lg transition-all duration-150 ease-out"
                          >
                            +${amt}
                          </button>
                        ))}
                      </div>
                      {cashCalc.isMixed && (
                        <p className="text-[11px] font-mono-num text-stone-600 dark:text-[#94A39B] text-center">
                          {formatUsdClean(cashCalc.usdReceived)} ({formatKhr(cashCalc.usdEquivalentKhr)}) +{' '}
                          {formatKhr(cashCalc.khrReceived)} ={' '}
                          <span className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {formatKhr(cashCalc.totalTenderedKhr)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Change Due / Insufficient Cash Feedback */}
              {cashCalc.isCovered ? (
                <div
                  role="status"
                  className="rounded-xl px-4 py-3.5 bg-emerald-50 dark:bg-[#064E3B]/55 border border-emerald-200 dark:border-[#10B981]/45 flex items-center justify-between gap-3"
                >
                  <div>
                    <span className="block text-xs font-semibold text-emerald-900 dark:text-[#D1FAE5]">
                      {isVi ? 'Tiền thối lại' : 'Change Due'}
                    </span>
                    {cashCalc.changeDueKhr === 0 && cartTotal > 0 && (
                      <span className="text-[11px] text-emerald-700 dark:text-[#6EE7B7]">
                        {isVi ? 'Khách đưa vừa đủ' : 'Exact amount received'}
                      </span>
                    )}
                  </div>
                  <span className="font-mono-num text-2xl font-bold text-[#0D5C3E] dark:text-[#34D399]">
                    {formatKhr(cashCalc.changeDueKhr)}
                  </span>
                </div>
              ) : (
                <div
                  role="alert"
                  className="rounded-xl px-4 py-3.5 bg-red-50 dark:bg-red-950/45 border border-red-200 dark:border-red-500/45 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 text-red-800 dark:text-red-200 min-w-0">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">
                      {isVi ? 'Tiền mặt chưa đủ' : 'Insufficient cash'}
                    </span>
                  </div>
                  <span className="font-mono-num text-sm font-bold text-red-700 dark:text-[#F87171] whitespace-nowrap">
                    {isVi
                      ? `Thiếu ${formatKhr(cashCalc.remainingDueKhr)}`
                      : `Short by ${formatKhr(cashCalc.remainingDueKhr)}`}
                  </span>
                </div>
              )}

              {/* Stock / Submission Error inside Modal */}
              {checkoutError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg border border-red-200 dark:border-red-500/45 bg-red-50 dark:bg-red-950/40 text-xs text-red-900 dark:text-red-200 font-medium"
                >
                  {checkoutError}
                </div>
              )}
            </div>

            {/* Modal Footer: Cancel + Confirm Payment & Complete Sale */}
            <div className="px-5 py-4 border-t border-stone-200 dark:border-[#24352C] bg-stone-50/60 dark:bg-[#0F1814] flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={closeCashModal}
                className="h-12 px-5 text-sm font-semibold text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] disabled:opacity-45 rounded-xl transition-colors whitespace-nowrap"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  cartLines.length === 0 ||
                  !liveStockValidation.ok ||
                  (cartTotal > 0 && !cashCalc.isCovered)
                }
                className="h-12 flex-1 px-4 text-sm font-bold text-white dark:text-[#042419] bg-[#0D5C3E] hover:bg-[#0A4A31] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-45 disabled:cursor-not-allowed rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isVi ? 'Đang hoàn tất...' : 'Completing Sale...'}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {isVi ? 'Xác nhận & Hoàn tất đơn' : 'Confirm Payment & Complete Sale'}
                  </>
                )}
              </button>
            </div>
            </form>
          </div>
        </ModalPortal>
      )}

      {/* Printable 58mm / 80mm Receipt Modal */}
      <ReceiptModal
        sale={receiptSale}
        settings={settings}
        onClose={() => setReceiptSale(null)}
      />

      {/* Quick Product Registration Modal triggered from Unrecognized POS Barcode */}
      <ProductFormModal
        open={quickRegisterOpen}
        editingProduct={null}
        existingProducts={products}
        barcodeRegistry={barcodeRegistry}
        ingredients={ingredients}
        settings={settings}
        t={t}
        initialBarcode={unknownBarcodePrompt?.code || undefined}
        initialPrefill={unknownBarcodePrompt?.prefill || null}
        initialNotFoundExternally={Boolean(
          unknownBarcodePrompt && !unknownBarcodePrompt.prefill
        )}
        onSave={saveProduct}
        onSaved={(newProd) => {
          setUnknownBarcodePrompt(null);
          setPosSearch('');
          const canAddNow =
            newProd.active &&
            (newProd.productType === 'PREPARED_TO_ORDER' ||
              newProd.stockQty > 0 ||
              Boolean(settings.allowNegativeStock));
          if (canAddNow) {
            addEntryToCart(newProd.id, newProd.variants?.[0]?.id, 1);
          }
          setLastCompletedSale(null);
          const displayName = isVi ? newProd.nameVi || newProd.name : newProd.name;
          setToastMessage(
            canAddNow
              ? isVi
                ? `Đã đăng ký "${displayName}" và thêm vào giỏ POS.`
                : `Registered "${displayName}" and added to POS cart.`
              : isVi
              ? `Đã đăng ký "${displayName}" — sẵn sàng trong POS & Kho hàng.`
              : `Registered "${displayName}" — now searchable in POS & Inventory.`
          );
          window.setTimeout(() => setToastMessage(''), 4500);
        }}
        onClose={() => setQuickRegisterOpen(false)}
      />
    </div>
  );
};
