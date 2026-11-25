import React, { useMemo, useRef, useState } from 'react';
import {
  Barcode,
  ChevronDown,
  ChevronRight,
  Edit2,
  HardDrive,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type {
  IngredientUnit,
  PackagingBarcode,
  Product,
  ProductCategory,
  ProductType,
  ProductVariant,
  RecipeItem,
} from '../types';
import {
  calculateProductCogs,
  calculateRecipeCogs,
  computePriceFromMarkup,
  formatKhr,
  formatQty,
  generateId,
  getCompatibleUnits,
} from '../utils/format';
import { compressImageBlobToDataUrl } from '../utils/image';
import { DRINK_IMAGE_PRESETS } from '../utils/seedData';
import { ProductPhoto } from '../components/ProductPhoto';
import { GoogleDrivePickerModal } from '../components/GoogleDrivePickerModal';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';

const ALL_CATEGORIES: ProductCategory[] = [
  'juice',
  'smoothie',
  'tea',
  'coffee',
  'specialty',
  'packaged',
  'snack',
];

export const ProductsView: React.FC = () => {
  const { settings, products, ingredients, saveProduct, deleteProduct, t } = useStore();
  const isVi = settings.language === 'vi';

  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [brand, setBrand] = useState('');
  const [productType, setProductType] = useState<ProductType>('PREPARED_TO_ORDER');
  const [category, setCategory] = useState<ProductCategory>('juice');
  const [costPriceKhr, setCostPriceKhr] = useState('0');
  const [markupPercent, setMarkupPercent] = useState('');
  const [manualPriceOverride, setManualPriceOverride] = useState(false);
  const [priceKhr, setPriceKhr] = useState('8000');
  const [barcode, setBarcode] = useState('');
  const [packagingBarcodes, setPackagingBarcodes] = useState<PackagingBarcode[]>([]);
  const [stockQty, setStockQty] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('12');
  const [unit, setUnit] = useState<IngredientUnit>('pcs');
  const [supplier, setSupplier] = useState('');
  const [imageUrl, setImageUrl] = useState(DRINK_IMAGE_PRESETS[0].url);
  const [active, setActive] = useState(true);
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [showNameVi, setShowNameVi] = useState(false);
  const [showAdvancedPricing, setShowAdvancedPricing] = useState(false);
  const [showBarcodes, setShowBarcodes] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<
    | { kind: 'unit' }
    | { kind: 'pack'; index: number }
    | { kind: 'variant'; index: number }
    | null
  >(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (!q) return true;
      const packCodes = (p.packagingBarcodes || []).map((pb) => pb.barcode).join(' ');
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameVi.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        packCodes.toLowerCase().includes(q)
      );
    });
  }, [products, typeFilter, search]);

  const openNew = () => {
    setEditingId(null);
    setName('');
    setNameVi('');
    setBrand('');
    setProductType('PREPARED_TO_ORDER');
    setCategory('juice');
    setCostPriceKhr('0');
    setMarkupPercent('');
    setManualPriceOverride(false);
    setPriceKhr('8000');
    setBarcode('');
    setPackagingBarcodes([]);
    setStockQty('0');
    setReorderLevel(String(settings.lowStockDefault || 12));
    setUnit('pcs');
    setSupplier('');
    setImageUrl(DRINK_IMAGE_PRESETS[0].url);
    setActive(true);
    setPhotoError('');
    setRecipe(
      ingredients.length > 0
        ? [{ ingredientId: ingredients[0].id, quantity: 1, unit: ingredients[0].unit }]
        : []
    );
    setVariants([]);
    setShowNameVi(false);
    setShowAdvancedPricing(false);
    setShowBarcodes(false);
    setShowVariants(false);
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingId(product.id);
    setName(product.name);
    setNameVi(product.nameVi);
    setBrand(product.brand || '');
    setProductType(product.productType);
    setCategory(product.category);
    setCostPriceKhr(String(product.costPriceKhr ?? 0));
    setMarkupPercent(product.markupPercent !== undefined ? String(product.markupPercent) : '');
    setManualPriceOverride(Boolean(product.manualPriceOverride));
    setPriceKhr(String(product.priceKhr));
    setBarcode(product.barcode || '');
    setPackagingBarcodes((product.packagingBarcodes || []).map((pb) => ({ ...pb })));
    setStockQty(String(product.stockQty ?? 0));
    setReorderLevel(String(product.reorderLevel ?? 10));
    setUnit(product.unit || 'pcs');
    setSupplier(product.supplier || '');
    setImageUrl(product.imageUrl || '');
    setActive(product.active);
    setPhotoError('');
    setRecipe((product.recipe || []).map((r) => ({ ...r })));
    setVariants(
      (product.variants || []).map((v) => ({
        ...v,
        recipe: (v.recipe || []).map((r) => ({ ...r })),
      }))
    );
    setShowNameVi(
      Boolean(product.nameVi && product.nameVi.trim() && product.nameVi.trim() !== product.name.trim())
    );
    setShowAdvancedPricing(Boolean(product.brand || product.markupPercent !== undefined));
    setShowBarcodes(
      Boolean(product.barcode || (product.packagingBarcodes && product.packagingBarcodes.length > 0))
    );
    setShowVariants(Boolean(product.variants && product.variants.length > 0));
    setModalOpen(true);
  };

  const handleProductTypeChange = (nextType: ProductType) => {
    setProductType(nextType);
    if (nextType === 'PACKAGED') {
      if (!['packaged', 'snack'].includes(category)) setCategory('packaged');
      setVariants([]);
    } else if (nextType === 'PREPARED_STOCK') {
      if (['packaged', 'snack'].includes(category)) setCategory('juice');
      setVariants([]);
    } else {
      if (['packaged', 'snack'].includes(category)) setCategory('juice');
    }
  };

  const handleCostOrMarkupChange = (nextCostStr: string, nextMarkupStr: string) => {
    setCostPriceKhr(nextCostStr);
    setMarkupPercent(nextMarkupStr);
    const costNum = Number(nextCostStr);
    const markupNum = Number(nextMarkupStr);
    if (!manualPriceOverride && nextMarkupStr !== '' && Number.isFinite(costNum) && costNum > 0 && Number.isFinite(markupNum)) {
      setPriceKhr(String(computePriceFromMarkup(costNum, markupNum)));
    }
  };

  const handleLocalPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError('');
    setUploadingPhoto(true);
    try {
      const compressedDataUrl = await compressImageBlobToDataUrl(file);
      setImageUrl(compressedDataUrl);
    } catch {
      setPhotoError(t.products.photoError);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const cleanRecipe = recipe.filter((r) => r.ingredientId && r.quantity > 0);
    const cleanVariants =
      productType === 'PREPARED_TO_ORDER'
        ? variants
            .filter((v) => v.name.trim())
            .map((v) => ({
              ...v,
              name: v.name.trim(),
              nameVi: (v.nameVi || v.name).trim(),
              priceKhr: Math.max(0, Number(v.priceKhr) || 0),
              recipe: v.recipe.filter((r) => r.ingredientId && r.quantity > 0),
              recipeVersion: Math.max(1, v.recipeVersion || 1),
            }))
        : [];

    const effectivePrice =
      cleanVariants.length > 0 ? cleanVariants[0].priceKhr : Math.max(0, Number(priceKhr) || 0);

    const effectiveCost =
      productType === 'PREPARED_STOCK' && Number(costPriceKhr) <= 0 && cleanRecipe.length > 0
        ? Math.round(calculateRecipeCogs(cleanRecipe, ingredients))
        : Math.max(0, Number(costPriceKhr) || 0);

    await saveProduct({
      id: editingId || undefined,
      name: name.trim(),
      nameVi: nameVi.trim() || name.trim(),
      brand: brand.trim(),
      productType,
      category,
      priceKhr: effectivePrice,
      costPriceKhr: effectiveCost,
      markupPercent: markupPercent !== '' ? Math.max(0, Number(markupPercent) || 0) : undefined,
      manualPriceOverride,
      imageUrl,
      active,
      barcode: barcode.trim(),
      packagingBarcodes: packagingBarcodes.filter(
        (pb) => pb.barcode.trim() && Number(pb.unitsPerPack) >= 1
      ),
      stockQty: productType === 'PREPARED_TO_ORDER' ? 0 : Number(stockQty) || 0,
      reorderLevel: productType === 'PREPARED_TO_ORDER' ? 0 : Math.max(0, Number(reorderLevel) || 0),
      unit,
      supplier: supplier.trim(),
      recipe: productType === 'PACKAGED' ? [] : cleanRecipe,
      recipeVersion: 1,
      variants: cleanVariants,
    });
    setModalOpen(false);
  };

  // Base recipe row helpers
  const addRecipeRow = () => {
    if (ingredients.length === 0) return;
    setRecipe((prev) => [
      ...prev,
      { ingredientId: ingredients[0].id, quantity: 1, unit: ingredients[0].unit },
    ]);
  };

  const updateRecipeRow = (index: number, patch: Partial<RecipeItem>) => {
    setRecipe((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        const next = { ...row, ...patch };
        if (patch.ingredientId) {
          const ing = ingMap.get(patch.ingredientId);
          if (ing) next.unit = ing.unit;
        }
        return next;
      })
    );
  };

  const removeRecipeRow = (index: number) => {
    setRecipe((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Packaging barcode helpers
  const addPackagingBarcode = () => {
    setPackagingBarcodes((prev) => [
      ...prev,
      { barcode: '', label: 'Carton (24 pcs)', unitsPerPack: 24 },
    ]);
  };

  const updatePackagingBarcode = (index: number, patch: Partial<PackagingBarcode>) => {
    setPackagingBarcodes((prev) =>
      prev.map((pb, idx) => (idx === index ? { ...pb, ...patch } : pb))
    );
  };

  const removePackagingBarcode = (index: number) => {
    setPackagingBarcodes((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Variant helpers (Small / Medium / Large)
  const addVariant = (presetName?: string, presetVi?: string) => {
    const baseRecipeCopy = recipe.map((r) => ({ ...r }));
    setVariants((prev) => [
      ...prev,
      {
        id: generateId('var'),
        name: presetName || (prev.length === 0 ? 'Small' : prev.length === 1 ? 'Medium' : 'Large'),
        nameVi: presetVi || (prev.length === 0 ? 'Nhỏ (S)' : prev.length === 1 ? 'Vừa (M)' : 'Lớn (L)'),
        priceKhr: Math.max(0, Number(priceKhr) || 8000) + prev.length * 2000,
        barcode: '',
        recipe: baseRecipeCopy,
        recipeVersion: 1,
      },
    ]);
  };

  const updateVariant = (index: number, patch: Partial<ProductVariant>) => {
    setVariants((prev) =>
      prev.map((v, idx) => (idx === index ? { ...v, ...patch } : v))
    );
  };

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, idx) => idx !== index));
  };

  const addVariantRecipeRow = (vIdx: number) => {
    if (ingredients.length === 0) return;
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === vIdx
          ? {
              ...v,
              recipe: [
                ...v.recipe,
                { ingredientId: ingredients[0].id, quantity: 1, unit: ingredients[0].unit },
              ],
            }
          : v
      )
    );
  };

  const updateVariantRecipeRow = (vIdx: number, rIdx: number, patch: Partial<RecipeItem>) => {
    setVariants((prev) =>
      prev.map((v, idx) => {
        if (idx !== vIdx) return v;
        return {
          ...v,
          recipe: v.recipe.map((row, j) => {
            if (j !== rIdx) return row;
            const next = { ...row, ...patch };
            if (patch.ingredientId) {
              const ing = ingMap.get(patch.ingredientId);
              if (ing) next.unit = ing.unit;
            }
            return next;
          }),
        };
      })
    );
  };

  const removeVariantRecipeRow = (vIdx: number, rIdx: number) => {
    setVariants((prev) =>
      prev.map((v, idx) =>
        idx === vIdx ? { ...v, recipe: v.recipe.filter((_, j) => j !== rIdx) } : v
      )
    );
  };

  const handleBarcodeScanned = (code: string) => {
    if (!scannerTarget) return;
    if (scannerTarget.kind === 'unit') {
      setBarcode(code);
    } else if (scannerTarget.kind === 'pack') {
      updatePackagingBarcode(scannerTarget.index, { barcode: code });
    } else if (scannerTarget.kind === 'variant') {
      updateVariant(scannerTarget.index, { barcode: code });
    }
    setScannerTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.products.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {isVi
              ? 'Quản lý sản phẩm đóng gói, pha chế theo đơn (nhiều kích cỡ S/M/L) và hàng pha sẵn trữ lạnh.'
              : 'Manage packaged goods, made-to-order drinks with size variants, and prepared-stock items.'}
          </p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {isVi ? 'Thêm sản phẩm' : 'Add Product'}
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as const).map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setTypeFilter(pt)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                typeFilter === pt
                  ? 'bg-[#0F5C43] text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {pt === 'ALL' ? `${t.common.all} (${products.length})` : t.productTypes[pt]}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isVi ? 'Tìm tên, thương hiệu, mã vạch...' : 'Search name, brand, barcode...'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900">
            {t.products.emptyTitle}
          </h2>
          <p className="mt-1 text-sm text-stone-500 max-w-md mx-auto">{t.products.emptyDesc}</p>
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
                className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col"
              >
                <ProductPhoto src={product.imageUrl} alt={displayName} className="w-full h-40" />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-stone-500">
                        <span className="font-semibold text-stone-700">
                          {t.productTypes[product.productType]}
                        </span>{' '}
                        · {t.productCategories[product.category]} ·{' '}
                        <span
                          className={
                            product.active ? 'text-emerald-700 font-medium' : 'text-stone-400'
                          }
                        >
                          {product.active ? t.products.activeStatus : t.products.pausedStatus}
                        </span>
                      </p>
                      <h3 className="mt-1 font-display text-lg font-semibold text-stone-900 truncate">
                        {displayName}
                      </h3>
                      {(product.brand || product.barcode) && (
                        <p className="text-xs text-stone-500 mt-0.5 font-mono-num truncate">
                          {[product.brand, product.barcode ? `SKU: ${product.barcode}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-num text-lg font-bold text-[#0F5C43] whitespace-nowrap">
                        {product.variants && product.variants.length > 1
                          ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                          : formatKhr(basePrice)}
                      </p>
                      {isDirectStock && (
                        <p
                          className={`text-xs font-mono-num font-semibold mt-0.5 ${
                            product.stockQty <= 0
                              ? 'text-red-700'
                              : isLowStock
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatQty(product.stockQty, product.unit)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Cost & Margin Row */}
                  <div className="mt-4 pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-stone-500 block">
                        {product.productType === 'PACKAGED'
                          ? isVi
                            ? 'Giá vốn nhập'
                            : 'Unit Cost'
                          : t.products.recipeCost}
                      </span>
                      <span className="font-mono-num font-semibold text-stone-900">
                        {formatKhr(cogs)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-stone-500 block">{t.products.grossMargin}</span>
                      <span className="font-mono-num font-semibold text-emerald-700">
                        {formatKhr(profit)} ({margin}%)
                      </span>
                    </div>
                  </div>

                  {/* Variants / Packaging / Recipe Summary */}
                  <div className="mt-4 pt-3 border-t border-stone-100 flex-1 space-y-2 text-xs">
                    {product.productType === 'PACKAGED' ? (
                      <div className="space-y-1 text-stone-600">
                        <div className="flex justify-between">
                          <span className="text-stone-500">{t.inventory.supplier}</span>
                          <span className="font-medium text-stone-800">
                            {product.supplier || '—'}
                          </span>
                        </div>
                        {product.packagingBarcodes && product.packagingBarcodes.length > 0 && (
                          <div className="pt-1 space-y-0.5">
                            {product.packagingBarcodes.map((pb, idx) => (
                              <div key={idx} className="flex justify-between font-mono-num text-[11px]">
                                <span className="text-stone-500">{pb.label}</span>
                                <span className="text-stone-700">
                                  {pb.barcode} (×{pb.unitsPerPack})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : product.variants && product.variants.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-stone-500 mb-1.5 flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5" />
                          {isVi ? 'Kích cỡ & Giá bán' : 'Size Variants'} ({product.variants.length})
                        </p>
                        <ul className="space-y-1">
                          {product.variants.map((v) => {
                            const vCogs = Math.round(calculateRecipeCogs(v.recipe, ingredients));
                            return (
                              <li key={v.id} className="flex justify-between text-stone-700">
                                <span className="font-medium">
                                  {isVi ? v.nameVi || v.name : v.name}
                                </span>
                                <span className="font-mono-num">
                                  {formatKhr(v.priceKhr)}{' '}
                                  <span className="text-stone-400">({formatKhr(vCogs)})</span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-medium text-stone-500 mb-1.5">
                          {product.productType === 'PREPARED_STOCK'
                            ? isVi
                              ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                              : 'Batch Prep Recipe (per 1 finished unit)'
                            : t.products.recipeSection}
                        </p>
                        {product.recipe.length === 0 ? (
                          <p className="text-xs text-stone-400">{t.products.noRecipeYet}</p>
                        ) : (
                          <ul className="space-y-1 text-stone-700">
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
                                  <span className="font-mono-num text-stone-500 whitespace-nowrap shrink-0">
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
                  <div className="mt-5 pt-3 border-t border-stone-100 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 hover:text-[#0F5C43] transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {t.common.edit}
                    </button>

                    {confirmDeleteId === product.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteProduct(product.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-xs font-semibold text-red-700 hover:underline"
                        >
                          {t.common.delete}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-stone-500"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(product.id)}
                        className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-red-700 transition-colors"
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
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white border border-stone-200 rounded-xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between shrink-0">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {editingId ? t.products.editProduct : t.products.addProduct}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-stone-500 hover:text-stone-900 rounded-md"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0">
              {/* Spacious Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {/* 1. Product Type */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-stone-700">
                    {isVi ? 'Loại sản phẩm' : 'Product Type'}
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {(['PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as ProductType[]).map(
                      (pt) => (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => handleProductTypeChange(pt)}
                          className={`px-3.5 py-2.5 text-xs font-semibold rounded-lg border text-left transition-colors ${
                            productType === pt
                              ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                              : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                          }`}
                        >
                          <div className="truncate">{t.productTypes[pt]}</div>
                          <div className="text-[11px] font-normal text-stone-500 mt-0.5 truncate">
                            {pt === 'PACKAGED'
                              ? isVi
                                ? 'Trừ tồn trực tiếp'
                                : 'Direct stock'
                              : pt === 'PREPARED_STOCK'
                                ? isVi
                                  ? 'Pha sẵn trữ lạnh'
                                  : 'Pre-prepared'
                                : isVi
                                  ? 'Pha theo công thức'
                                  : 'Uses recipe'}
                          </div>
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* 2. Core Details: Name (+ Optional Vietnamese Toggle), Category & Price */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label className="text-xs font-medium text-stone-700">
                        {showNameVi
                          ? t.products.nameEn
                          : isVi
                            ? 'Tên sản phẩm'
                            : 'Product Name'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowNameVi((prev) => !prev)}
                        className="text-xs font-medium text-[#0F5C43] hover:underline whitespace-nowrap"
                      >
                        {showNameVi
                          ? isVi
                            ? 'Ẩn tên tiếng Việt'
                            : 'Hide Vietnamese name'
                          : isVi
                            ? '+ Thêm tên tiếng Việt'
                            : '+ Add Vietnamese name'}
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={
                        isVi ? 'VD: Nước cam tươi, Dasani 500ml...' : 'e.g. Fresh Orange Juice, Dasani 500ml'
                      }
                      className="w-full px-3.5 py-2.5 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                    />
                  </div>

                  {showNameVi && (
                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1.5">
                        {t.products.nameVi}
                      </label>
                      <input
                        type="text"
                        maxLength={100}
                        value={nameVi}
                        onChange={(e) => setNameVi(e.target.value)}
                        placeholder={isVi ? 'Nhập tên tiếng Việt (tùy chọn)' : 'Optional Vietnamese display name'}
                        className="w-full px-3.5 py-2.5 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1.5">
                        {t.products.category}
                      </label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as ProductCategory)}
                        className="w-full px-3.5 py-2.5 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                      >
                        {ALL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {t.productCategories[c]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700 mb-1.5">
                        {t.products.sellingPrice}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        required
                        value={priceKhr}
                        onChange={(e) => {
                          setManualPriceOverride(true);
                          setPriceKhr(e.target.value);
                        }}
                        className="w-full px-3.5 py-2.5 text-sm font-mono-num border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                      />
                    </div>
                  </div>

                  {/* Direct Cost & Stock Row for Packaged / Prepared Stock */}
                  {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-stone-700 mb-1.5">
                          {isVi ? 'Giá vốn (KHR)' : 'Unit Cost (KHR)'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={costPriceKhr}
                          onChange={(e) => handleCostOrMarkupChange(e.target.value, markupPercent)}
                          className="w-full px-3.5 py-2.5 text-sm font-mono-num border border-stone-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-700 mb-1.5">
                          {t.inventory.inStock}
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={stockQty}
                          onChange={(e) => setStockQty(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm font-mono-num border border-stone-200 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-700 mb-1.5">
                          {t.inventory.reorderAt}
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={reorderLevel}
                          onChange={(e) => setReorderLevel(e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm font-mono-num border border-stone-200 rounded-lg"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2 text-sm text-stone-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                        className="w-4 h-4 accent-[#0F5C43]"
                      />
                      {isVi ? 'Hiển thị trên màn hình bán hàng (POS)' : 'Show on POS menu'}
                    </label>
                  </div>
                </div>

                {/* 3. Product Photo (Device Photos, Google Drive & Studio Presets) */}
                <div className="pt-5 border-t border-stone-200 space-y-3">
                  <label className="block text-xs font-semibold text-stone-700">
                    {t.products.imagePreset}
                  </label>

                  <div className="flex flex-col sm:flex-row items-start gap-4">
                    <div className="w-full sm:w-32 h-24 rounded-lg overflow-hidden border border-stone-200 shrink-0 relative bg-stone-100">
                      <ProductPhoto
                        src={imageUrl}
                        alt={name || t.products.imagePreset}
                        className="w-full h-full"
                      />
                      {uploadingPhoto && (
                        <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white text-xs gap-1.5">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 w-full space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          <ImagePlus className="w-3.5 h-3.5 text-[#0F5C43]" />
                          {uploadingPhoto ? t.products.processingPhoto : t.products.uploadFromPhotos}
                        </button>

                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => setDrivePickerOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          <HardDrive className="w-3.5 h-3.5 text-[#0F5C43]" />
                          {t.products.pickFromDrive}
                        </button>

                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleLocalPhotoSelect}
                          className="hidden"
                        />
                      </div>

                      {photoError && <p className="text-xs text-red-700 font-medium">{photoError}</p>}

                      <div className="grid grid-cols-5 gap-2">
                        {DRINK_IMAGE_PRESETS.map((preset) => (
                          <button
                            key={preset.url}
                            type="button"
                            onClick={() => {
                              setPhotoError('');
                              setImageUrl(preset.url);
                            }}
                            className={`rounded-lg overflow-hidden border-2 transition-colors ${
                              imageUrl === preset.url ? 'border-[#0F5C43]' : 'border-transparent'
                            }`}
                            title={isVi ? preset.labelVi : preset.label}
                          >
                            <ProductPhoto src={preset.url} alt={preset.label} className="w-full h-11" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Recipe Builder (Shown for Made-to-Order & Prepared Stock) */}
                {productType !== 'PACKAGED' && (
                  <div className="pt-5 border-t border-stone-200 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-stone-800">
                        {productType === 'PREPARED_STOCK'
                          ? isVi
                            ? 'Công thức pha mẻ (cho 1 đơn vị)'
                            : 'Batch Recipe (per 1 finished unit)'
                          : t.products.recipeSection}
                      </label>
                      <button
                        type="button"
                        onClick={addRecipeRow}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t.products.addIngredientRow}
                      </button>
                    </div>

                    {recipe.length === 0 ? (
                      <p className="text-xs text-stone-400">{t.products.noRecipeYet}</p>
                    ) : (
                      <div className="space-y-2.5">
                        {recipe.map((row, index) => {
                          const chosenIng = ingMap.get(row.ingredientId);
                          const compatibleUnits = chosenIng
                            ? getCompatibleUnits(chosenIng.unit)
                            : (['pcs'] as IngredientUnit[]);
                          return (
                            <div key={index} className="flex items-center gap-2">
                              <select
                                value={row.ingredientId}
                                onChange={(e) =>
                                  updateRecipeRow(index, { ingredientId: e.target.value })
                                }
                                className="flex-1 min-w-0 px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white"
                              >
                                {ingredients.map((ing) => (
                                  <option key={ing.id} value={ing.id}>
                                    {isVi ? ing.nameVi || ing.name : ing.name} ({ing.unit})
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min={0.001}
                                step="any"
                                value={row.quantity}
                                onChange={(e) =>
                                  updateRecipeRow(index, {
                                    quantity: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                className="w-20 px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg"
                              />
                              <select
                                value={row.unit || chosenIng?.unit || 'pcs'}
                                onChange={(e) =>
                                  updateRecipeRow(index, {
                                    unit: e.target.value as IngredientUnit,
                                  })
                                }
                                className="w-16 px-2 py-2 text-xs border border-stone-200 rounded-lg bg-white"
                              >
                                {compatibleUnits.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => removeRecipeRow(index)}
                                className="p-1.5 text-stone-400 hover:text-red-700"
                                aria-label="Remove ingredient"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Collapsible Optional Sections (Keep the form light & uncluttered) */}
                <div className="pt-4 border-t border-stone-200 divide-y divide-stone-100">
                  {/* Optional: Barcode & Carton Codes */}
                  <div className="py-3">
                    <button
                      type="button"
                      onClick={() => setShowBarcodes((prev) => !prev)}
                      className="w-full flex items-center justify-between text-left text-xs font-semibold text-stone-700 hover:text-stone-900"
                    >
                      <span className="inline-flex items-center gap-2">
                        {showBarcodes ? (
                          <ChevronDown className="w-4 h-4 text-stone-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-stone-400" />
                        )}
                        {isVi ? 'Mã vạch & Mã thùng (tùy chọn)' : 'Barcode & Pack Codes (optional)'}
                      </span>
                      {barcode && (
                        <span className="font-mono-num text-[11px] font-normal text-stone-500">
                          {barcode}
                        </span>
                      )}
                    </button>

                    {showBarcodes && (
                      <div className="mt-3 space-y-3 pl-6">
                        <div>
                          <label className="block text-xs font-medium text-stone-600 mb-1.5">
                            {isVi ? 'Mã vạch sản phẩm' : 'Unit Barcode / SKU'}
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              maxLength={64}
                              value={barcode}
                              onChange={(e) => setBarcode(e.target.value)}
                              placeholder="e.g. 8851959132012"
                              className="flex-1 px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => setScannerTarget({ kind: 'unit' })}
                              className="px-3 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <ScanBarcode className="w-4 h-4 text-[#0F5C43]" />
                              Scan
                            </button>
                          </div>
                        </div>

                        {productType === 'PACKAGED' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-stone-600 flex items-center gap-1.5">
                                <Barcode className="w-3.5 h-3.5 text-stone-400" />
                                {isVi ? 'Mã vạch Thùng / Lốc' : 'Carton / Pack Barcodes'}
                              </span>
                              <button
                                type="button"
                                onClick={addPackagingBarcode}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {isVi ? 'Thêm mã thùng' : 'Add Pack'}
                              </button>
                            </div>
                            {packagingBarcodes.map((pb, idx) => (
                              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                                <input
                                  type="text"
                                  placeholder="Carton code"
                                  value={pb.barcode}
                                  onChange={(e) =>
                                    updatePackagingBarcode(idx, { barcode: e.target.value })
                                  }
                                  className="col-span-4 px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg"
                                />
                                <input
                                  type="text"
                                  placeholder="Carton 24"
                                  value={pb.label}
                                  onChange={(e) =>
                                    updatePackagingBarcode(idx, { label: e.target.value })
                                  }
                                  className="col-span-4 px-2.5 py-2 text-xs border border-stone-200 rounded-lg"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  value={pb.unitsPerPack}
                                  onChange={(e) =>
                                    updatePackagingBarcode(idx, {
                                      unitsPerPack: Math.max(1, Number(e.target.value) || 1),
                                    })
                                  }
                                  className="col-span-2 px-2 py-2 text-xs font-mono-num border border-stone-200 rounded-lg"
                                  title="Units per pack"
                                />
                                <div className="col-span-2 flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setScannerTarget({ kind: 'pack', index: idx })}
                                    className="p-1.5 text-stone-500 hover:text-[#0F5C43]"
                                    title="Scan carton barcode"
                                  >
                                    <ScanBarcode className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removePackagingBarcode(idx)}
                                    className="p-1.5 text-stone-400 hover:text-red-700"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Optional: Size Variants (Small / Medium / Large) for Made-to-Order */}
                  {productType === 'PREPARED_TO_ORDER' && (
                    <div className="py-3">
                      <button
                        type="button"
                        onClick={() => setShowVariants((prev) => !prev)}
                        className="w-full flex items-center justify-between text-left text-xs font-semibold text-stone-700 hover:text-stone-900"
                      >
                        <span className="inline-flex items-center gap-2">
                          {showVariants ? (
                            <ChevronDown className="w-4 h-4 text-stone-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-stone-400" />
                          )}
                          {isVi
                            ? 'Kích cỡ S / M / L (tùy chọn)'
                            : 'Size Variants S / M / L (optional)'}
                        </span>
                        {variants.length > 0 && (
                          <span className="font-mono-num text-[11px] font-normal text-stone-500">
                            {variants.length} {isVi ? 'cỡ' : 'sizes'}
                          </span>
                        )}
                      </button>

                      {showVariants && (
                        <div className="mt-3 space-y-3 pl-6">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-stone-500">
                              {isVi
                                ? 'Mỗi cỡ có giá bán và công thức riêng.'
                                : 'Give each size its own price and ingredient amounts.'}
                            </p>
                            <button
                              type="button"
                              onClick={() => addVariant()}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {isVi ? 'Thêm cỡ' : 'Add Size'}
                            </button>
                          </div>

                          {variants.map((variant, vIdx) => {
                            const vCost = Math.round(calculateRecipeCogs(variant.recipe, ingredients));
                            return (
                              <div
                                key={variant.id}
                                className="p-3.5 bg-stone-50 border border-stone-200 rounded-lg space-y-3"
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) => updateVariant(vIdx, { name: e.target.value })}
                                    placeholder="Size (e.g. Small)"
                                    className="flex-1 min-w-0 px-2.5 py-2 text-xs border border-stone-200 rounded-lg bg-white"
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    step={500}
                                    value={variant.priceKhr}
                                    onChange={(e) =>
                                      updateVariant(vIdx, {
                                        priceKhr: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    placeholder="Price KHR"
                                    className="w-28 px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeVariant(vIdx)}
                                    className="p-1.5 text-stone-400 hover:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                                    <span>
                                      {isVi ? 'Công thức' : 'Recipe'} ·{' '}
                                      <span className="font-mono-num text-stone-700 font-semibold">
                                        COGS {formatKhr(vCost)}
                                      </span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => addVariantRecipeRow(vIdx)}
                                      className="text-[#0F5C43] font-semibold hover:underline"
                                    >
                                      + {t.products.addIngredientRow}
                                    </button>
                                  </div>

                                  {variant.recipe.map((row, rIdx) => {
                                    const chosenIng = ingMap.get(row.ingredientId);
                                    const compatibleUnits = chosenIng
                                      ? getCompatibleUnits(chosenIng.unit)
                                      : (['pcs'] as IngredientUnit[]);
                                    return (
                                      <div key={rIdx} className="flex items-center gap-1.5">
                                        <select
                                          value={row.ingredientId}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              ingredientId: e.target.value,
                                            })
                                          }
                                          className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-stone-200 rounded bg-white"
                                        >
                                          {ingredients.map((ing) => (
                                            <option key={ing.id} value={ing.id}>
                                              {isVi ? ing.nameVi || ing.name : ing.name} ({ing.unit})
                                            </option>
                                          ))}
                                        </select>
                                        <input
                                          type="number"
                                          min={0.001}
                                          step="any"
                                          value={row.quantity}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              quantity: Math.max(0, Number(e.target.value) || 0),
                                            })
                                          }
                                          className="w-16 px-2 py-1.5 text-xs font-mono-num border border-stone-200 rounded bg-white"
                                        />
                                        <select
                                          value={row.unit || chosenIng?.unit || 'pcs'}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              unit: e.target.value as IngredientUnit,
                                            })
                                          }
                                          className="w-14 px-1.5 py-1.5 text-xs border border-stone-200 rounded bg-white"
                                        >
                                          {compatibleUnits.map((u) => (
                                            <option key={u} value={u}>
                                              {u}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => removeVariantRecipeRow(vIdx, rIdx)}
                                          className="p-1 text-stone-400 hover:text-red-700"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Optional: Brand, Unit, Supplier & Markup Calculator */}
                  <div className="py-3">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedPricing((prev) => !prev)}
                      className="w-full flex items-center justify-between text-left text-xs font-semibold text-stone-700 hover:text-stone-900"
                    >
                      <span className="inline-flex items-center gap-2">
                        {showAdvancedPricing ? (
                          <ChevronDown className="w-4 h-4 text-stone-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-stone-400" />
                        )}
                        {isVi
                          ? 'Thông tin thêm (Thương hiệu, NCC, % Lãi)'
                          : 'More Details (Brand, Supplier, Markup %)'}
                      </span>
                    </button>

                    {showAdvancedPricing && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3.5 pl-6">
                        <div>
                          <label className="block text-xs font-medium text-stone-600 mb-1">
                            {isVi ? 'Thương hiệu' : 'Brand'}
                          </label>
                          <input
                            type="text"
                            maxLength={80}
                            value={brand}
                            onChange={(e) => setBrand(e.target.value)}
                            placeholder="e.g. Coca-Cola, House"
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-stone-600 mb-1">
                            {isVi ? 'Tự tính giá từ % lãi' : 'Auto-price Markup (%)'}
                          </label>
                          <input
                            type="number"
                            min={0}
                            step={5}
                            placeholder="e.g. 50"
                            value={markupPercent}
                            onChange={(e) => handleCostOrMarkupChange(costPriceKhr, e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                          />
                        </div>

                        {productType !== 'PREPARED_TO_ORDER' && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-stone-600 mb-1">
                                {t.inventory.unit}
                              </label>
                              <select
                                value={unit}
                                onChange={(e) => setUnit(e.target.value as IngredientUnit)}
                                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white"
                              >
                                {(['pcs', 'ml', 'L', 'g', 'kg'] as IngredientUnit[]).map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-stone-600 mb-1">
                                {t.inventory.supplier}
                              </label>
                              <input
                                type="text"
                                maxLength={100}
                                value={supplier}
                                onChange={(e) => setSupplier(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sticky Bottom Action Bar */}
              <div className="px-6 py-4 border-t border-stone-200 bg-white flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google Drive Photo Browser Modal */}
      <GoogleDrivePickerModal
        open={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        onSelectPhoto={(dataUrl) => {
          setPhotoError('');
          setImageUrl(dataUrl);
        }}
      />

      {/* Camera Barcode Scanner Modal */}
      <BarcodeScannerModal
        open={scannerTarget !== null}
        title={isVi ? 'Quét mã vạch sản phẩm' : 'Scan Product Barcode'}
        onDetected={handleBarcodeScanned}
        onClose={() => setScannerTarget(null)}
      />
    </div>
  );
};
