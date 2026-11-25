import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
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
import { ProductPhoto } from '../components/ProductPhoto';
import { BarcodeScanner, type BarcodeScanSource } from '../components/BarcodeScanner';
import { ReceiptModal } from '../components/ReceiptModal';
import { ProductFormModal } from '../components/ProductFormModal';

interface CartEntry {
  key: string; // `${productId}::${variantId || ''}`
  productId: string;
  variantId?: string;
  quantity: number;
}

const POS_CATEGORIES: Array<'all' | ProductCategory> = [
  'all',
  'juice',
  'smoothie',
  'coffee',
  'tea',
  'packaged',
  'snack',
  'specialty',
];

export const SalesView: React.FC = () => {
  const {
    settings,
    products,
    ingredients,
    barcodeRegistry,
    sales,
    saveProduct,
    lookupBarcode,
    recordSale,
    voidSale,
    returnSaleItems,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';

  const [subTab, setSubTab] = useState<'pos' | 'ledger'>('pos');
  const [posSearch, setPosSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ProductCategory>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [cartTxId, setCartTxId] = useState<string>(() => generateId('sale'));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
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

  const activeProducts = useMemo(() => {
    const q = posSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.active) return false;
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (!q) return true;
      const varMatch = (p.variants || []).some(
        (v) => v.name.toLowerCase().includes(q) || (v.barcode || '').toLowerCase().includes(q)
      );
      const packMatch = (p.packagingBarcodes || []).some(
        (pb) => pb.barcode.toLowerCase().includes(q) || pb.label.toLowerCase().includes(q)
      );
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameVi.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        varMatch ||
        packMatch
      );
    });
  }, [products, typeFilter, categoryFilter, posSearch]);

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

  const addEntryToCart = (productId: string, variantId?: string, qtyToAdd = 1) => {
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

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
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
        customerName,
        note,
        saleDate,
      });

      if (!result.ok) {
        setCheckoutError(result.error || 'Insufficient stock for checkout.');
        setCheckoutShortages(result.shortages || []);
        return;
      }

      setCart({});
      setCartTxId(generateId('sale'));
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

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (paymentFilter !== 'all' && s.paymentMethod !== paymentFilter) return false;
      if (!q) return true;
      const itemsText = s.items
        .map((i) => `${i.productName} ${i.productNameVi} ${i.variantName || ''}`)
        .join(' ')
        .toLowerCase();
      return (
        s.orderNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q) ||
        s.recordedBy.toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [sales, search, paymentFilter]);

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
    <div className="space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.sales.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {isVi
              ? 'Bán hàng tích hợp mã vạch, kiểm tra tồn kho trực tiếp và tự động trừ kho theo loại sản phẩm.'
              : 'Connected POS with barcode scanning, live stock checks, and automatic 3-tier stock deduction.'}
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-stone-200/70 rounded-lg self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'pos'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {t.sales.tabPos}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ledger'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
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
          className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm font-medium flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          {lastCompletedSale && (
            <button
              type="button"
              onClick={() => setReceiptSale(lastCompletedSale)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-md"
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
            <div className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 space-y-3">
              <BarcodeScanner
                enabled={
                  subTab === 'pos' &&
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
                      barcodeRegistry.some((r) => r.code === code.trim())
                  )
                }
                secondaryLeftSlot={
                  <>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen((prev) => !prev)}
                      aria-expanded={filtersOpen}
                      aria-controls="pos-catalog-filters"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                        filtersOpen || categoryFilter !== 'all' || typeFilter !== 'ALL'
                          ? 'bg-stone-100 text-stone-900'
                          : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#0F5C43] shrink-0" />
                      <span>
                        {filtersOpen
                          ? isVi
                            ? 'Ẩn bộ lọc'
                            : 'Hide Filters'
                          : isVi
                            ? 'Bộ lọc'
                            : 'Filters'}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-200 motion-reduce:transition-none ${
                          filtersOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {(categoryFilter !== 'all' || typeFilter !== 'ALL') && (
                      <div className="flex items-center gap-2 text-xs text-stone-600 min-w-0">
                        <span className="truncate">
                          {[
                            categoryFilter !== 'all' ? t.productCategories[categoryFilter] : null,
                            typeFilter !== 'ALL' ? t.productTypes[typeFilter] : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryFilter('all');
                            setTypeFilter('ALL');
                          }}
                          className="text-xs font-medium text-[#0F5C43] hover:underline whitespace-nowrap shrink-0"
                        >
                          {isVi ? 'Xóa lọc' : 'Clear'}
                        </button>
                      </div>
                    )}
                  </>
                }
              />

              {/* Live Registry / Open Food Facts Lookup Indicator */}
              {lookingUpBarcode && (
                <div
                  role="status"
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-stone-50 border border-stone-200 text-xs text-stone-700"
                >
                  <Loader2 className="w-3.5 h-3.5 text-[#0F5C43] animate-spin shrink-0" />
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
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-stone-50 border border-stone-300"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ScanBarcode className="w-4 h-4 text-[#0F5C43] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-900">
                        {isVi ? 'Mã vạch chưa đăng ký' : 'Unregistered Barcode'}:{' '}
                        <span className="font-mono-num text-[#0F5C43]">
                          {unknownBarcodePrompt.code}
                        </span>{' '}
                        <span className="font-normal text-stone-500">
                          ({formatBarcodeTypeLabel(unknownBarcodePrompt.format)})
                        </span>
                      </p>
                      <p className="text-[11px] text-stone-600 truncate mt-0.5">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-md transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isVi ? 'Đăng ký ngay' : 'Register Now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnknownBarcodePrompt(null)}
                      aria-label={t.common.close}
                      className="p-1.5 text-stone-400 hover:text-stone-700 rounded-md"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Smooth Collapsible Category & Product Type Filter Drawer */}
              <div
                id="pos-catalog-filters"
                className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
                  filtersOpen
                    ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-stone-100'
                    : '!mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-3">
                    {/* Row 1: Category Filters */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-[11px] font-semibold text-stone-500 sm:w-20 shrink-0">
                        {isVi ? 'Danh mục' : 'Category'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {POS_CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategoryFilter(cat)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                              categoryFilter === cat
                                ? 'bg-[#0F5C43] text-white'
                                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                            }`}
                          >
                            {cat === 'all' ? t.common.all : t.productCategories[cat]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Row 2: Product Type Filters */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-[11px] font-semibold text-stone-500 sm:w-20 shrink-0">
                        {isVi ? 'Loại hàng' : 'Item Type'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(['ALL', 'PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as const).map(
                          (pt) => (
                            <button
                              key={pt}
                              type="button"
                              onClick={() => setTypeFilter(pt)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                typeFilter === pt
                                  ? 'bg-stone-900 text-white'
                                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                              }`}
                            >
                              {pt === 'ALL' ? t.common.all : t.productTypes[pt]}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {activeProducts.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-sm text-stone-500">
                {t.common.noResults}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeProducts.map((product) => {
                  const qtyInCart = getQtyInCartForProduct(product.id);
                  const displayName = isVi ? product.nameVi || product.name : product.name;
                  const availability = getAvailableUnitsForProduct(
                    product,
                    ingredients,
                    product.variants?.[0]?.id
                  );
                  const hasMultiVariants = product.variants && product.variants.length > 1;
                  const minPrice = hasMultiVariants
                    ? Math.min(...product.variants.map((v) => v.priceKhr))
                    : product.variants?.[0]?.priceKhr ?? product.priceKhr;

                  const outBlocked = availability.status === 'out' && !settings.allowNegativeStock;

                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={outBlocked}
                      onClick={() => handleProductTileClick(product)}
                      className={`group text-left bg-white border rounded-xl overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] ${
                        outBlocked
                          ? 'opacity-55 border-stone-200 cursor-not-allowed'
                          : qtyInCart > 0
                          ? 'border-[#0F5C43]'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="relative">
                        <ProductPhoto
                          src={product.imageUrl}
                          alt={displayName}
                          className="w-full h-32"
                        />
                        {qtyInCart > 0 && (
                          <span className="absolute top-2 right-2 bg-[#0F5C43] text-white font-mono-num text-xs font-semibold px-2 py-0.5 rounded-md">
                            ×{qtyInCart}
                          </span>
                        )}
                      </div>
                      <div className="p-3.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-stone-500 truncate">
                            {t.productTypes[product.productType]}
                            {hasMultiVariants ? ` · ${product.variants.length} sizes` : ''}
                          </span>
                          {availability.availableUnits !== null && (
                            <span
                              className={`font-mono-num font-semibold shrink-0 ${
                                availability.status === 'out'
                                  ? 'text-red-700'
                                  : availability.status === 'low'
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
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
                          )}
                        </div>
                        <h3 className="mt-1 font-display text-sm font-semibold text-stone-900 truncate">
                          {displayName}
                        </h3>
                        <div className="mt-1.5 flex items-baseline justify-between gap-2">
                          <span className="font-mono-num text-sm font-bold text-[#0F5C43]">
                            {hasMultiVariants ? `${formatKhr(minPrice)}+` : formatKhr(minPrice)}
                          </span>
                          <span className="text-[11px] text-stone-400 font-mono-num">
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

          {/* Order Cart Panel */}
          <form
            onSubmit={handleCheckout}
            className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-5 space-y-4 lg:sticky lg:top-20"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#0F5C43]" />
                <h2 className="font-display text-base font-semibold text-stone-900">
                  {t.sales.cartTitle}
                </h2>
              </div>
              {cartLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart({});
                    setCheckoutError(null);
                    setCheckoutShortages([]);
                  }}
                  className="text-xs text-stone-500 hover:text-red-700 transition-colors"
                >
                  {t.common.cancel}
                </button>
              )}
            </div>

            {cartLines.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-500">{t.sales.emptyCart}</p>
            ) : (
              <ul className="divide-y divide-stone-100 max-h-64 overflow-y-auto pr-1">
                {cartLines.map(({ key, product, variant, unitPrice, quantity, lineTotal }) => (
                  <li key={key} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        {isVi ? product.nameVi || product.name : product.name}
                        {variant ? (
                          <span className="text-stone-500 font-normal">
                            {' '}
                            ({isVi ? variant.nameVi || variant.name : variant.name})
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-stone-500 font-mono-num">
                        {formatKhr(unitPrice)} × {quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="inline-flex items-center border border-stone-200 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateCartQty(key, -1)}
                          aria-label="Decrease quantity"
                          className="p-1 text-stone-600 hover:text-stone-900"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2 font-mono-num text-xs font-semibold text-stone-900">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(key, 1)}
                          aria-label="Increase quantity"
                          className="p-1 text-stone-600 hover:text-stone-900"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono-num text-xs font-semibold text-stone-900 w-20 text-right">
                        {formatKhr(lineTotal)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Live Stock Shortage Warning / Override Banner */}
            {(liveStockValidation.shortages.length > 0 || checkoutError) && (
              <div
                role="alert"
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                  settings.allowNegativeStock && !checkoutError
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
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
              </div>
            )}

            {/* Payment & Order Metadata */}
            <div className="space-y-3 pt-3 border-t border-stone-200">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  {t.common.payment}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPaymentMethod(pm)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        paymentMethod === pm
                          ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                          : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                      }`}
                    >
                      {t.paymentMethods[pm]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white text-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    {t.common.operator}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={settings.activeOperator}
                    className="w-full px-2.5 py-2 text-xs border border-stone-200 rounded-lg bg-stone-50 text-stone-700"
                  />
                </div>
              </div>

              <input
                type="text"
                maxLength={80}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder={t.sales.customerPlaceholder}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 placeholder:text-stone-400"
              />

              <input
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.sales.notePlaceholder}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 placeholder:text-stone-400"
              />
            </div>

            {/* Order Totals */}
            <div className="pt-3 border-t border-stone-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-stone-500">
                <span>{t.sales.estimatedCogs}</span>
                <span className="font-mono-num">{formatKhr(cartCogs)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>{t.sales.estProfit}</span>
                <span className="font-mono-num">{formatKhr(cartTotal - cartCogs)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-2 border-t border-stone-100">
                <span className="text-sm font-semibold text-stone-900">{t.common.total}</span>
                <div className="text-right">
                  <span className="font-mono-num text-xl font-bold text-stone-900">
                    {formatKhr(cartTotal)}
                  </span>
                  <span className="block font-mono-num text-xs text-stone-400">
                    {formatUsdRef(cartTotal, settings.usdRate)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={cartLines.length === 0 || submitting || !liveStockValidation.ok}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
            >
              {submitting ? (isVi ? 'Đang xử lý...' : 'Recording Sale...') : t.sales.completeSale}
            </button>
          </form>
        </div>
      ) : (
        /* Sales Ledger Tab */
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.sales.searchOrders}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'cash', 'khqr', 'aba', 'wing'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPaymentFilter(pm)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    paymentFilter === pm
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {pm === 'all' ? t.common.all : t.paymentMethods[pm]}
                </button>
              ))}
            </div>
          </div>

          {filteredSales.length === 0 ? (
            <p className="p-10 text-center text-sm text-stone-500">{t.common.noResults}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                    <th className="py-3 px-5 font-medium">Order / {t.common.date}</th>
                    <th className="py-3 px-4 font-medium">{t.sales.itemsSummary}</th>
                    <th className="py-3 px-4 font-medium">{t.common.payment}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.sales.cogs}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.common.total}</th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
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
                      <tr key={sale.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-3.5 px-5 whitespace-nowrap">
                          <p className="font-mono-num font-semibold text-stone-900">
                            {sale.orderNumber}
                          </p>
                          <p className="text-xs text-stone-500 font-mono-num">
                            {sale.saleDate} ·{' '}
                            <span
                              className={
                                sale.status === 'voided'
                                  ? 'text-red-700 font-medium'
                                  : sale.status === 'partially_returned' ||
                                    sale.status === 'refunded'
                                  ? 'text-amber-700 font-medium'
                                  : 'text-emerald-700'
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
                          <p className="text-stone-900">
                            {sale.items
                              .map(
                                (i) =>
                                  `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}${
                                    i.variantName ? ` (${i.variantName})` : ''
                                  }`
                              )
                              .join(', ')}
                          </p>
                          <p className="text-xs text-stone-500 truncate mt-0.5">
                            {[sale.recordedBy, sale.customerName, sale.note]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-stone-600 whitespace-nowrap">
                          {t.paymentMethods[sale.paymentMethod]}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-600 whitespace-nowrap">
                          {formatKhr(netCogs)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num whitespace-nowrap">
                          <span
                            className={
                              sale.status === 'voided'
                                ? 'line-through text-stone-400'
                                : 'font-semibold text-stone-900'
                            }
                          >
                            {formatKhr(netTotal)}
                          </span>
                          {sale.refundedKhr && sale.refundedKhr > 0 && sale.status !== 'voided' ? (
                            <span className="block text-[11px] text-amber-700">
                              -{formatKhr(sale.refundedKhr)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setReceiptSale(sale)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-[#0F5C43]"
                              title="Receipt"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openOrderDetail(sale)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {isVi ? 'Chi tiết' : 'Details'}
                            </button>
                            {canModify &&
                              (confirmVoidId === sale.id ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await voidSale(sale.id, 'Voided from ledger');
                                      setConfirmVoidId(null);
                                    }}
                                    className="text-xs font-semibold text-red-700 hover:underline"
                                  >
                                    {t.sales.voidOrder}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmVoidId(null)}
                                    className="text-xs text-stone-500"
                                  >
                                    {t.common.cancel}
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmVoidId(sale.id)}
                                  className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-red-700"
                                  title={t.sales.voidOrder}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-stone-900">
                  {isVi
                    ? variantPickerProduct.nameVi || variantPickerProduct.name
                    : variantPickerProduct.name}
                </h3>
                <p className="text-xs text-stone-500">
                  {isVi ? 'Chọn kích cỡ để thêm vào đơn' : 'Choose size variant to add to order'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVariantPickerProduct(null)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5">
              {variantPickerProduct.variants.map((variant) => {
                const avail = getAvailableUnitsForProduct(
                  variantPickerProduct,
                  ingredients,
                  variant.id
                );
                const blocked = avail.status === 'out' && !settings.allowNegativeStock;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      addEntryToCart(variantPickerProduct.id, variant.id, 1);
                      setVariantPickerProduct(null);
                    }}
                    className="w-full px-4 py-3 border border-stone-200 hover:border-[#0F5C43] hover:bg-emerald-50/40 disabled:opacity-50 rounded-lg flex items-center justify-between transition-colors"
                  >
                    <div className="text-left">
                      <div className="text-sm font-semibold text-stone-900">
                        {isVi ? variant.nameVi || variant.name : variant.name}
                      </div>
                      {avail.availableUnits !== null && (
                        <div className="text-[11px] text-stone-500 font-mono-num">
                          {avail.status === 'out'
                            ? isVi
                              ? 'Thiếu nguyên liệu'
                              : `Out (${avail.limitingItemName})`
                            : `~${avail.availableUnits} makeable`}
                        </div>
                      )}
                    </div>
                    <span className="font-mono-num text-sm font-bold text-[#0F5C43]">
                      {formatKhr(variant.priceKhr)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Order Details & Partial Return Modal */}
      {detailSale && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white border border-stone-200 rounded-xl my-8 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-stone-900">
                  {detailSale.orderNumber} ·{' '}
                  <span className="text-sm font-medium text-stone-500">
                    {formatDateTimeInPhnomPenh(detailSale.createdAt)} (ICT)
                  </span>
                </h2>
                <p className="text-xs text-stone-500">
                  {t.paymentMethods[detailSale.paymentMethod]} · {detailSale.recordedBy} ·{' '}
                  {detailSale.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailSaleId(null)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Line Items + Return Quantity Pickers */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-stone-700 uppercase tracking-wide">
                  {isVi ? 'Chi tiết món & Hoàn trả một phần' : 'Order Items & Partial Returns'}
                </h3>
                <div className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
                  {detailSale.items.map((item, idx) => {
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
                            <p className="text-sm font-semibold text-stone-900">
                              {item.quantity}×{' '}
                              {isVi ? item.productNameVi || item.productName : item.productName}
                              {item.variantName ? ` (${item.variantName})` : ''}
                            </p>
                            <p className="text-xs text-stone-500 font-mono-num">
                              {formatKhr(item.unitPriceKhr)} ea · COGS {formatKhr(item.unitCogsKhr)}
                              {returned > 0 ? ` · Returned: ${returned}` : ''}
                            </p>
                          </div>

                          {canReturnLine && (
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-stone-500">
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
                                className="w-16 px-2 py-1 text-xs font-mono-num border border-stone-300 rounded-md text-center"
                              />
                            </div>
                          )}
                        </div>

                        {/* Immutable Stock Deduction Snapshot */}
                        {item.deductions && item.deductions.length > 0 && (
                          <p className="text-[11px] text-stone-500 font-mono-num">
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
                <div className="p-3.5 bg-stone-50 border border-stone-200 rounded-lg space-y-2.5">
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
                      className="flex-1 px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white"
                    />
                    <button
                      type="button"
                      disabled={
                        returnBusy ||
                        Object.values(returnQtyMap).every((q) => !q || q <= 0)
                      }
                      onClick={handleProcessPartialReturn}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-45 rounded-lg whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isVi ? 'Xác nhận hoàn trả' : 'Process Return'}
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-500">
                    {isVi
                      ? 'Hoàn trả luôn cộng lại đúng số lượng đã trừ khi bán (không bị ảnh hưởng nếu bạn đã sửa công thức sau đó).'
                      : 'Returns always restore exact original deduction snapshots (safe even if product recipes were edited later).'}
                  </p>
                </div>
              )}

              {returnFeedback && (
                <p className="text-xs font-semibold text-[#0F5C43]">{returnFeedback}</p>
              )}

              {/* Prior Return History */}
              {detailSale.returns && detailSale.returns.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-stone-700">
                    {isVi ? 'Lịch sử hoàn trả' : 'Return History'}
                  </h4>
                  {detailSale.returns.map((ret) => (
                    <div
                      key={ret.id}
                      className="text-xs text-stone-600 flex justify-between border-b border-stone-100 py-1.5"
                    >
                      <span>
                        {ret.returnDate} · {ret.reason} ({ret.recordedBy})
                      </span>
                      <span className="font-mono-num font-semibold text-amber-700">
                        -{formatKhr(ret.refundTotalKhr)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-stone-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setReceiptSale(detailSale)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-lg"
              >
                <Printer className="w-3.5 h-3.5" />
                {isVi ? 'In / Chép hóa đơn' : 'Print / Copy Receipt'}
              </button>
              <button
                type="button"
                onClick={() => setDetailSaleId(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F5C43] rounded-lg"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
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
