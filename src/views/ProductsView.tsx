import React, { useMemo, useState } from 'react';
import {
  Edit2,
  Layers,
  Loader2,
  Plus,
  QrCode,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { ExternalBarcodePrefill, Product, ProductType } from '../types';
import {
  calculateProductCogs,
  calculateRecipeCogs,
  formatKhr,
  formatQty,
} from '../utils/format';
import { ProductPhoto } from '../components/ProductPhoto';
import { ProductFormModal } from '../components/ProductFormModal';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { BarcodeLabelModal } from '../components/BarcodeLabelModal';

export const ProductsView: React.FC = () => {
  const {
    settings,
    products,
    ingredients,
    barcodeRegistry,
    saveProduct,
    deleteProduct,
    lookupBarcode,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';

  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Barcode Scan / Lookup & Label Studio state
  const [scanLookupOpen, setScanLookupOpen] = useState(false);
  const [scanLookingUp, setScanLookingUp] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [quickInitialBarcode, setQuickInitialBarcode] = useState<string | null>(null);
  const [quickInitialPrefill, setQuickInitialPrefill] = useState<ExternalBarcodePrefill | null>(null);
  const [quickNotFoundExternally, setQuickNotFoundExternally] = useState(false);
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (!q) return true;
      const packCodes = (p.packagingBarcodes || []).map((pb) => pb.barcode).join(' ');
      const variantCodes = (p.variants || []).map((v) => v.barcode || '').join(' ');
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameVi.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        packCodes.toLowerCase().includes(q) ||
        variantCodes.toLowerCase().includes(q)
      );
    });
  }, [products, typeFilter, search]);

  const resetQuickScanSeed = () => {
    setQuickInitialBarcode(null);
    setQuickInitialPrefill(null);
    setQuickNotFoundExternally(false);
  };

  const openNew = () => {
    resetQuickScanSeed();
    setEditingProduct(null);
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    resetQuickScanSeed();
    setEditingProduct(product);
    setModalOpen(true);
  };

  const handleScanLookup = async (rawCode: string) => {
    const cleaned = rawCode.trim();
    if (!cleaned) return;
    setScanLookingUp(true);
    setScanNotice(null);
    try {
      const res = await lookupBarcode(cleaned);
      if (res.found && res.product) {
        resetQuickScanSeed();
        setEditingProduct(res.product);
        setModalOpen(true);
        const displayName = isVi ? res.product.nameVi || res.product.name : res.product.name;
        setScanNotice(
          isVi
            ? `Đã tìm thấy "${displayName}" (${res.code}) trong sổ mã vạch JuiceFlow.`
            : `Found "${displayName}" (${res.code}) in your JuiceFlow registry.`
        );
      } else {
        setEditingProduct(null);
        setQuickInitialBarcode(res.code || cleaned);
        setQuickInitialPrefill(res.externalPrefill || null);
        setQuickNotFoundExternally(!res.externalPrefill);
        setModalOpen(true);
      }
    } finally {
      setScanLookingUp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
            {t.products.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B]">
            {isVi
              ? 'Quản lý sản phẩm đóng gói, pha chế theo đơn (nhiều kích cỡ S/M/L) và hàng pha sẵn trữ lạnh.'
              : 'Manage packaged goods, made-to-order drinks with size variants, and prepared-stock items.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            type="button"
            disabled={scanLookingUp}
            onClick={() => setScanLookupOpen(true)}
            className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
          >
            {scanLookingUp ? (
              <Loader2 className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] animate-spin" />
            ) : (
              <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
            )}
            {isVi ? 'Quét / Tra cứu mã' : 'Scan / Lookup'}
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {isVi ? 'Thêm sản phẩm' : 'Add Product'}
          </button>
        </div>
      </div>

      {scanNotice && (
        <div
          role="status"
          className="bg-emerald-50 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/40 text-emerald-900 dark:text-[#D1FAE5] px-4 py-3 rounded-lg text-xs font-medium flex items-center justify-between gap-3"
        >
          <span>{scanNotice}</span>
          <button
            type="button"
            onClick={() => setScanNotice(null)}
            className="text-emerald-700 dark:text-[#6EE7B7] hover:text-emerald-950 dark:hover:text-white"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['ALL', 'PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as const).map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setTypeFilter(pt)}
              className={`h-11 px-3.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap ${
                typeFilter === pt
                  ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                  : 'bg-stone-100 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-200 dark:hover:bg-[#1F3028] border border-transparent dark:border-[#24352C]'
              }`}
            >
              {pt === 'ALL' ? `${t.common.all} (${products.length})` : t.productTypes[pt]}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isVi ? 'Tìm tên, thương hiệu, mã vạch...' : 'Search name, brand, barcode...'}
            className="w-full h-11 pl-9 pr-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]/70 border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {t.products.emptyTitle}
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B] max-w-md mx-auto">
            {t.products.emptyDesc}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProducts.map((product) => {
            const firstVariant = product.variants?.[0];
            const cogs = Math.round(calculateProductCogs(product, ingredients, firstVariant));
            const basePrice = firstVariant ? firstVariant.priceKhr : product.priceKhr;
            const profit = basePrice - cogs;
            const margin = basePrice > 0 ? Math.round((profit / basePrice) * 100) : 0;
            const displayName = isVi ? product.nameVi || product.name : product.name;
            const isDirectStock =
              product.productType === 'PACKAGED' || product.productType === 'PREPARED_STOCK';
            const isLowStock = isDirectStock && product.stockQty <= product.reorderLevel;

            return (
              <div
                key={product.id}
                className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden flex flex-col"
              >
                <ProductPhoto
                  src={product.imageUrl}
                  alt={displayName}
                  category={product.category}
                  className="w-full h-40"
                />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                        <span className="font-semibold text-stone-700 dark:text-[#D5DFDA]">
                          {t.productTypes[product.productType]}
                        </span>{' '}
                        · {t.productCategories[product.category]} ·{' '}
                        <span
                          className={
                            product.active
                              ? 'text-emerald-700 dark:text-[#34D399] font-medium'
                              : 'text-stone-400 dark:text-[#94A39B]/60'
                          }
                        >
                          {product.active ? t.products.activeStatus : t.products.pausedStatus}
                        </span>
                      </p>
                      <h3 className="mt-1 font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                        {displayName}
                      </h3>
                      {(product.brand || product.barcode) && (
                        <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5 font-mono-num truncate">
                          {[product.brand, product.barcode ? `SKU: ${product.barcode}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-num text-lg font-bold text-[#0F5C43] dark:text-[#34D399] whitespace-nowrap">
                        {product.variants && product.variants.length > 1
                          ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                          : formatKhr(basePrice)}
                      </p>
                      {isDirectStock && (
                        <p
                          className={`text-xs font-mono-num font-semibold mt-0.5 ${
                            product.stockQty <= 0
                              ? 'text-red-700 dark:text-[#F87171]'
                              : isLowStock
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-emerald-700 dark:text-[#34D399]'
                          }`}
                        >
                          {formatQty(product.stockQty, product.unit)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Cost & Margin Row */}
                  <div className="mt-4 pt-3 border-t border-stone-100 dark:border-[#1F3028] grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-stone-500 dark:text-[#94A39B] block">
                        {product.productType === 'PACKAGED'
                          ? isVi
                            ? 'Giá vốn nhập'
                            : 'Unit Cost'
                          : t.products.recipeCost}
                      </span>
                      <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {formatKhr(cogs)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-stone-500 dark:text-[#94A39B] block">
                        {t.products.grossMargin}
                      </span>
                      <span className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399]">
                        {formatKhr(profit)} ({margin}%)
                      </span>
                    </div>
                  </div>

                  {/* Variants / Packaging / Recipe Summary */}
                  <div className="mt-4 pt-3 border-t border-stone-100 dark:border-[#1F3028] flex-1 space-y-2 text-xs">
                    {product.productType === 'PACKAGED' ? (
                      <div className="space-y-1 text-stone-600 dark:text-[#94A39B]">
                        <div className="flex justify-between">
                          <span className="text-stone-500 dark:text-[#94A39B]">
                            {t.inventory.supplier}
                          </span>
                          <span className="font-medium text-stone-800 dark:text-[#F1F5F3]">
                            {product.supplier || '—'}
                          </span>
                        </div>
                        {product.packagingBarcodes && product.packagingBarcodes.length > 0 && (
                          <div className="pt-1 space-y-0.5">
                            {product.packagingBarcodes.map((pb, idx) => (
                              <div key={idx} className="flex justify-between font-mono-num text-[11px]">
                                <span className="text-stone-500 dark:text-[#94A39B]">{pb.label}</span>
                                <span className="text-stone-700 dark:text-[#D5DFDA]">
                                  {pb.barcode} (×{pb.unitsPerPack})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : product.variants && product.variants.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B] mb-1.5 flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5" />
                          {isVi ? 'Kích cỡ & Giá bán' : 'Size Variants'} ({product.variants.length})
                        </p>
                        <ul className="space-y-1">
                          {product.variants.map((v) => {
                            const vCogs = Math.round(calculateRecipeCogs(v.recipe, ingredients));
                            return (
                              <li
                                key={v.id}
                                className="flex justify-between text-stone-700 dark:text-[#D5DFDA]"
                              >
                                <span className="font-medium">
                                  {isVi ? v.nameVi || v.name : v.name}
                                </span>
                                <span className="font-mono-num">
                                  {formatKhr(v.priceKhr)}{' '}
                                  <span className="text-stone-400 dark:text-[#94A39B]">
                                    ({formatKhr(vCogs)})
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B] mb-1.5">
                          {product.productType === 'PREPARED_STOCK'
                            ? isVi
                              ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                              : 'Batch Prep Recipe (per 1 finished unit)'
                            : t.products.recipeSection}
                        </p>
                        {product.recipe.length === 0 ? (
                          <p className="text-xs text-stone-400 dark:text-[#94A39B]/70">
                            {t.products.noRecipeYet}
                          </p>
                        ) : (
                          <ul className="space-y-1 text-stone-700 dark:text-[#D5DFDA]">
                            {product.recipe.slice(0, 5).map((row, idx) => {
                              const ing = ingMap.get(row.ingredientId);
                              if (!ing) return null;
                              return (
                                <li
                                  key={`${row.ingredientId}-${idx}`}
                                  className="flex justify-between gap-2"
                                >
                                  <span className="truncate">
                                    {isVi ? ing.nameVi || ing.name : ing.name}
                                  </span>
                                  <span className="font-mono-num text-stone-500 dark:text-[#94A39B] whitespace-nowrap shrink-0">
                                    {formatQty(row.quantity, row.unit || ing.unit)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-3 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="inline-flex items-center gap-1.5 h-9 px-2 -ml-2 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] hover:text-[#0F5C43] dark:hover:text-[#34D399] transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        {t.common.edit}
                      </button>

                      <button
                        type="button"
                        onClick={() => setLabelProduct(product)}
                        className="inline-flex items-center gap-1.5 h-9 px-2 text-xs font-semibold text-stone-600 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        {isVi ? 'In nhãn' : 'Labels'}
                      </button>
                    </div>

                    {confirmDeleteId === product.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteProduct(product.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-xs font-semibold text-red-700 dark:text-[#F87171] hover:underline"
                        >
                          {t.common.delete}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-stone-500 dark:text-[#94A39B]"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(product.id)}
                        className="inline-flex items-center gap-1 h-9 px-2 text-xs text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t.common.delete}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Product Modal */}
      <ProductFormModal
        open={modalOpen}
        editingProduct={editingProduct}
        existingProducts={products}
        barcodeRegistry={barcodeRegistry}
        ingredients={ingredients}
        settings={settings}
        t={t}
        initialBarcode={quickInitialBarcode || undefined}
        initialPrefill={quickInitialPrefill}
        initialNotFoundExternally={quickNotFoundExternally}
        onSave={saveProduct}
        onClose={() => {
          setModalOpen(false);
          resetQuickScanSeed();
        }}
      />

      {/* Camera Barcode Scan & Lookup Modal */}
      <BarcodeScannerModal
        open={scanLookupOpen}
        title={isVi ? 'Quét mã vạch sản phẩm' : 'Scan or Lookup Product Barcode'}
        subtitle={
          isVi
            ? 'Kiểm tra sổ mã vạch JuiceFlow trước, sau đó tự động gợi ý từ Open Food Facts nếu chưa đăng ký.'
            : 'Checks JuiceFlow registry first, then prefills from Open Food Facts if unregistered.'
        }
        onDetected={handleScanLookup}
        onClose={() => setScanLookupOpen(false)}
      />

      {/* Code 128 & QR Code Thermal Label Studio */}
      <BarcodeLabelModal
        open={Boolean(labelProduct)}
        product={labelProduct}
        shopName={settings.name}
        isVi={isVi}
        onClose={() => setLabelProduct(null)}
      />
    </div>
  );
};
