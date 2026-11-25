import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  HardDrive,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  ScanBarcode,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Ingredient,
  IngredientUnit,
  PackagingBarcode,
  Product,
  ProductCategory,
  ProductType,
  ProductVariant,
  RecipeItem,
  WorkspaceSettings,
} from '../types';
import type { StoreContextValue } from '../context/StoreContext';
import {
  calculateRecipeCogs,
  computePriceFromMarkup,
  formatKhr,
  generateId,
  getCompatibleUnits,
} from '../utils/format';
import { compressImageBlobToDataUrl } from '../utils/image';
import { DRINK_IMAGE_PRESETS } from '../utils/seedData';
import { ProductPhoto } from './ProductPhoto';
import { GoogleDrivePickerModal } from './GoogleDrivePickerModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';

const ALL_CATEGORIES: ProductCategory[] = [
  'juice',
  'smoothie',
  'tea',
  'coffee',
  'specialty',
  'packaged',
  'snack',
];

const ALL_UNITS: IngredientUnit[] = ['pcs', 'ml', 'L', 'g', 'kg'];

interface CollapsibleFieldsetProps {
  id: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  variant?: 'card' | 'nested';
  children: React.ReactNode;
}

const CollapsibleFieldset: React.FC<CollapsibleFieldsetProps> = ({
  id,
  title,
  summary,
  open,
  onToggle,
  variant = 'card',
  children,
}) => {
  const containerClass =
    variant === 'card'
      ? 'bg-white border border-stone-200 rounded-xl overflow-hidden'
      : 'border-t border-stone-200 pt-3.5 mt-4';

  const buttonClass =
    variant === 'card'
      ? 'w-full px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-stone-50/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F5C43]'
      : 'w-full py-1 flex items-center justify-between gap-3 text-left text-stone-700 hover:text-stone-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] rounded';

  const bodyClass =
    variant === 'card' ? 'px-5 pb-5 pt-3 border-t border-stone-100' : 'pt-3';

  return (
    <fieldset className={containerClass}>
      <legend className="sr-only">{title}</legend>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
        className={buttonClass}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
          )}
          <span
            className={
              variant === 'card'
                ? 'font-display text-sm font-semibold text-stone-900 truncate'
                : 'text-xs font-semibold text-stone-700 truncate'
            }
          >
            {title}
          </span>
        </span>
        {summary && !open && (
          <span className="font-mono-num text-[11px] text-stone-500 truncate max-w-[160px]">
            {summary}
          </span>
        )}
      </button>

      {open && (
        <div id={`${id}-panel`} className={bodyClass}>
          {children}
        </div>
      )}
    </fieldset>
  );
};

export type ProductFormPayload = Omit<Product, 'id'> & { id?: string };

interface ProductFormModalProps {
  open: boolean;
  editingProduct: Product | null;
  ingredients: Ingredient[];
  settings: WorkspaceSettings;
  t: StoreContextValue['t'];
  onSave: (payload: ProductFormPayload) => Promise<void>;
  onClose: () => void;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  open,
  editingProduct,
  ingredients,
  settings,
  t,
  onSave,
  onClose,
}) => {
  const isVi = settings.language === 'vi';

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

  const [showSecondaryNaming, setShowSecondaryNaming] = useState(false);
  const [showMarkupCalc, setShowMarkupCalc] = useState(false);
  const [showBarcodes, setShowBarcodes] = useState(false);
  const [showVariants, setShowVariants] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<
    | { kind: 'unit' }
    | { kind: 'pack'; index: number }
    | { kind: 'variant'; index: number }
    | null
  >(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // Synchronize form state whenever modal opens or target product changes
  useEffect(() => {
    if (!open) return;
    if (editingProduct) {
      setName(editingProduct.name);
      setNameVi(editingProduct.nameVi);
      setBrand(editingProduct.brand || '');
      setProductType(editingProduct.productType);
      setCategory(editingProduct.category);
      setCostPriceKhr(String(editingProduct.costPriceKhr ?? 0));
      setMarkupPercent(
        editingProduct.markupPercent !== undefined ? String(editingProduct.markupPercent) : ''
      );
      setManualPriceOverride(Boolean(editingProduct.manualPriceOverride));
      setPriceKhr(String(editingProduct.priceKhr));
      setBarcode(editingProduct.barcode || '');
      setPackagingBarcodes((editingProduct.packagingBarcodes || []).map((pb) => ({ ...pb })));
      setStockQty(String(editingProduct.stockQty ?? 0));
      setReorderLevel(String(editingProduct.reorderLevel ?? 10));
      setUnit(editingProduct.unit || 'pcs');
      setSupplier(editingProduct.supplier || '');
      setImageUrl(editingProduct.imageUrl || '');
      setActive(editingProduct.active);
      setPhotoError('');
      setRecipe((editingProduct.recipe || []).map((r) => ({ ...r })));
      setVariants(
        (editingProduct.variants || []).map((v) => ({
          ...v,
          recipe: (v.recipe || []).map((r) => ({ ...r })),
        }))
      );

      const hasDistinctVi = Boolean(
        editingProduct.nameVi &&
          editingProduct.nameVi.trim() &&
          editingProduct.nameVi.trim() !== editingProduct.name.trim()
      );
      setShowSecondaryNaming(hasDistinctVi || Boolean(editingProduct.brand));
      setShowMarkupCalc(editingProduct.markupPercent !== undefined);
      setShowBarcodes(false);
      setShowVariants(Boolean(editingProduct.variants && editingProduct.variants.length > 0));
    } else {
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
      setShowSecondaryNaming(false);
      setShowMarkupCalc(false);
      setShowBarcodes(false);
      setShowVariants(false);
    }
  }, [open, editingProduct, ingredients, settings.lowStockDefault]);

  // Close modal with Escape when sub-modals are not open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !drivePickerOpen && scannerTarget === null) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, drivePickerOpen, scannerTarget, onClose]);

  const recipeCogs = useMemo(
    () => Math.round(calculateRecipeCogs(recipe, ingredients)),
    [recipe, ingredients]
  );

  const liveUnitCost = useMemo(() => {
    if (productType === 'PREPARED_TO_ORDER') {
      if (variants.length > 0) {
        return Math.round(calculateRecipeCogs(variants[0].recipe, ingredients));
      }
      return recipeCogs;
    }
    const manualCost = Math.max(0, Number(costPriceKhr) || 0);
    if (productType === 'PREPARED_STOCK' && manualCost <= 0 && recipe.length > 0) {
      return recipeCogs;
    }
    return manualCost;
  }, [productType, variants, ingredients, recipeCogs, costPriceKhr, recipe.length]);

  const liveSellingPrice = useMemo(() => {
    if (productType === 'PREPARED_TO_ORDER' && variants.length > 0) {
      return Math.max(0, Number(variants[0].priceKhr) || 0);
    }
    return Math.max(0, Number(priceKhr) || 0);
  }, [productType, variants, priceKhr]);

  const liveProfit = liveSellingPrice - liveUnitCost;
  const liveMarginPct =
    liveSellingPrice > 0 ? Math.round((liveProfit / liveSellingPrice) * 100) : 0;

  if (!open) return null;

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

  const handleCostOrMarkupChange = (
    nextCostStr: string,
    nextMarkupStr: string,
    overrideFlag = manualPriceOverride
  ) => {
    setCostPriceKhr(nextCostStr);
    setMarkupPercent(nextMarkupStr);
    const costNum = Number(nextCostStr);
    const markupNum = Number(nextMarkupStr);
    if (
      !overrideFlag &&
      nextMarkupStr !== '' &&
      Number.isFinite(costNum) &&
      costNum > 0 &&
      Number.isFinite(markupNum)
    ) {
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

  const handleSubmit = async (e: React.FormEvent) => {
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
              barcode: (v.barcode || '').trim(),
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

    await onSave({
      id: editingProduct?.id,
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
      reorderLevel:
        productType === 'PREPARED_TO_ORDER' ? 0 : Math.max(0, Number(reorderLevel) || 0),
      unit,
      supplier: supplier.trim(),
      recipe: productType === 'PACKAGED' ? [] : cleanRecipe,
      recipeVersion: 1,
      variants: cleanVariants,
    });
    onClose();
  };

  // Base recipe helpers
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

  // Size variant helpers
  const addVariant = (presetName?: string, presetVi?: string) => {
    const baseRecipeCopy = recipe.map((r) => ({ ...r }));
    setVariants((prev) => [
      ...prev,
      {
        id: generateId('var'),
        name: presetName || (prev.length === 0 ? 'Small' : prev.length === 1 ? 'Medium' : 'Large'),
        nameVi:
          presetVi || (prev.length === 0 ? 'Nhỏ (S)' : prev.length === 1 ? 'Vừa (M)' : 'Lớn (L)'),
        priceKhr: Math.max(0, Number(priceKhr) || 8000) + prev.length * 2000,
        barcode: '',
        recipe: baseRecipeCopy,
        recipeVersion: 1,
      },
    ]);
  };

  const updateVariant = (index: number, patch: Partial<ProductVariant>) => {
    setVariants((prev) => prev.map((v, idx) => (idx === index ? { ...v, ...patch } : v)));
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

  const secondaryNamingSummary = [
    nameVi.trim() && nameVi.trim() !== name.trim() ? nameVi.trim() : '',
    brand.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const barcodeSummary = [
    barcode.trim(),
    packagingBarcodes.length > 0
      ? `${packagingBarcodes.length} ${isVi ? 'mã thùng' : 'packs'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3 sm:p-5">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-form-modal-title"
          className="w-full max-w-4xl bg-[#F6F7F5] border border-stone-200 rounded-xl max-h-[92vh] flex flex-col overflow-hidden"
        >
          {/* Sticky Modal Header */}
          <div className="px-6 py-4 bg-white border-b border-stone-200 flex items-center justify-between gap-4 shrink-0">
            <div>
              <h2
                id="product-form-modal-title"
                className="font-display text-lg font-bold text-stone-900 tracking-tight"
              >
                {editingProduct ? t.products.editProduct : t.products.addProduct}
              </h2>
              <p className="text-xs text-stone-500 mt-0.5">
                {isVi
                  ? 'Điền thông tin cơ bản, giá bán và cài đặt tồn kho bên dưới.'
                  : 'Organize product details, pricing, and inventory settings.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
              aria-label={t.common.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            {/* Scrollable Grid Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Top Bar: Inventory Classification Selector */}
              <fieldset className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5">
                <legend className="sr-only">
                  {isVi ? 'Phân loại tồn kho' : 'Inventory Classification'}
                </legend>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <span className="font-display text-sm font-semibold text-stone-900">
                    {isVi ? 'Loại sản phẩm' : 'Product Type'}
                  </span>
                  <span className="text-xs text-stone-500">
                    {isVi
                      ? 'Quyết định cách hệ thống tự động trừ tồn kho khi bán hàng'
                      : 'Determines how stock is deducted automatically at checkout'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(['PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as ProductType[]).map(
                    (pt) => {
                      const selected = productType === pt;
                      return (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => handleProductTypeChange(pt)}
                          aria-pressed={selected}
                          className={`px-4 py-3 rounded-lg border text-left transition-colors ${
                            selected
                              ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                              : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                          }`}
                        >
                          <div className="text-xs font-semibold truncate">
                            {t.productTypes[pt]}
                          </div>
                          <div className="text-[11px] font-normal text-stone-500 mt-0.5 truncate">
                            {pt === 'PACKAGED'
                              ? isVi
                                ? 'Trừ trực tiếp số lượng đóng gói'
                                : 'Deducts packaged stock directly'
                              : pt === 'PREPARED_STOCK'
                                ? isVi
                                  ? 'Pha sẵn theo mẻ & trữ lạnh'
                                  : 'Deducts pre-prepared stock'
                                : isVi
                                  ? 'Trừ nguyên liệu theo công thức'
                                  : 'Deducts raw ingredients via recipe'}
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </fieldset>

              {/* Main 12-Column Responsive Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* LEFT COLUMN (7 cols): Basic Info & Inventory Settings */}
                <div className="lg:col-span-7 space-y-5">
                  {/* SECTION 1: Basic Info */}
                  <fieldset className="bg-white border border-stone-200 rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Thông tin cơ bản' : 'Basic Info'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100">
                      <h3 className="font-display text-sm font-semibold text-stone-900">
                        {isVi ? 'Thông tin cơ bản' : 'Basic Info'}
                      </h3>
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => setActive(e.target.checked)}
                          className="w-4 h-4 accent-[#0F5C43] rounded"
                        />
                        {isVi ? 'Hiện trên POS' : 'Show on POS'}
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                      <div className="sm:col-span-7">
                        <label
                          htmlFor="pf-name"
                          className="block text-xs font-medium text-stone-700 mb-1.5"
                        >
                          {isVi ? 'Tên sản phẩm' : 'Product Name'} *
                        </label>
                        <input
                          id="pf-name"
                          type="text"
                          required
                          maxLength={100}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={
                            isVi
                              ? 'VD: Nước cam tươi, Dasani 500ml'
                              : 'e.g. Fresh Orange Juice, Dasani 500ml'
                          }
                          className="w-full px-3.5 py-2.5 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label
                          htmlFor="pf-category"
                          className="block text-xs font-medium text-stone-700 mb-1.5"
                        >
                          {t.products.category}
                        </label>
                        <select
                          id="pf-category"
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
                    </div>

                    {/* Collapsible Nested Fieldset: Secondary Naming & Brand */}
                    <CollapsibleFieldset
                      id="pf-secondary-naming"
                      variant="nested"
                      title={
                        isVi
                          ? 'Tên tiếng Việt & Thương hiệu (tùy chọn)'
                          : 'Secondary Naming & Brand (optional)'
                      }
                      summary={secondaryNamingSummary}
                      open={showSecondaryNaming}
                      onToggle={() => setShowSecondaryNaming((prev) => !prev)}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label
                            htmlFor="pf-name-vi"
                            className="block text-xs font-medium text-stone-600 mb-1.5"
                          >
                            {t.products.nameVi}
                          </label>
                          <input
                            id="pf-name-vi"
                            type="text"
                            maxLength={100}
                            value={nameVi}
                            onChange={(e) => setNameVi(e.target.value)}
                            placeholder={
                              isVi
                                ? 'Tên hiển thị khi dùng tiếng Việt'
                                : 'Optional Vietnamese display name'
                            }
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="pf-brand"
                            className="block text-xs font-medium text-stone-600 mb-1.5"
                          >
                            {isVi ? 'Thương hiệu' : 'Brand'}
                          </label>
                          <input
                            id="pf-brand"
                            type="text"
                            maxLength={80}
                            value={brand}
                            onChange={(e) => setBrand(e.target.value)}
                            placeholder="e.g. Coca-Cola, House"
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>
                      </div>
                    </CollapsibleFieldset>
                  </fieldset>

                  {/* SECTION 2: Inventory Settings (Stock / Recipe / Variants) */}
                  <fieldset className="bg-white border border-stone-200 rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Cài đặt tồn kho' : 'Inventory Settings'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100">
                      <h3 className="font-display text-sm font-semibold text-stone-900">
                        {isVi ? 'Cài đặt kho & Công thức' : 'Inventory Settings'}
                      </h3>
                      <span className="text-[11px] font-medium text-stone-500">
                        {t.productTypes[productType]}
                      </span>
                    </div>

                    {/* Direct Stock Controls for Packaged & Prepared Stock */}
                    {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                      <div className="grid grid-cols-2 sm:grid-cols-12 gap-3.5 mb-5">
                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-stock"
                            className="block text-xs font-medium text-stone-700 mb-1.5"
                          >
                            {t.inventory.inStock}
                          </label>
                          <input
                            id="pf-stock"
                            type="number"
                            step="any"
                            value={stockQty}
                            onChange={(e) => setStockQty(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>

                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-reorder"
                            className="block text-xs font-medium text-stone-700 mb-1.5"
                          >
                            {t.inventory.reorderAt}
                          </label>
                          <input
                            id="pf-reorder"
                            type="number"
                            min={0}
                            step="any"
                            value={reorderLevel}
                            onChange={(e) => setReorderLevel(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>

                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-unit"
                            className="block text-xs font-medium text-stone-700 mb-1.5"
                          >
                            {t.inventory.unit}
                          </label>
                          <select
                            id="pf-unit"
                            value={unit}
                            onChange={(e) => setUnit(e.target.value as IngredientUnit)}
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          >
                            {ALL_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-span-1 sm:col-span-12">
                          <label
                            htmlFor="pf-supplier"
                            className="block text-xs font-medium text-stone-700 mb-1.5"
                          >
                            {t.inventory.supplier}
                          </label>
                          <input
                            id="pf-supplier"
                            type="text"
                            maxLength={100}
                            value={supplier}
                            onChange={(e) => setSupplier(e.target.value)}
                            placeholder={
                              isVi ? 'Tên nhà cung cấp (tùy chọn)' : 'Optional supplier name'
                            }
                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Recipe Builder for Made-to-Order & Prepared Stock */}
                    {productType !== 'PACKAGED' && (
                      <div
                        className={
                          productType === 'PREPARED_STOCK'
                            ? 'pt-4 border-t border-stone-100 space-y-3'
                            : 'space-y-3'
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="text-xs font-semibold text-stone-800 block">
                              {productType === 'PREPARED_STOCK'
                                ? isVi
                                  ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                                  : 'Batch Prep Recipe (per 1 finished unit)'
                                : t.products.recipeSection}
                            </span>
                            {recipe.length > 0 && (
                              <span className="text-[11px] text-stone-500">
                                {isVi ? 'Giá vốn công thức ước tính:' : 'Est. recipe cost:'}{' '}
                                <span className="font-mono-num font-semibold text-stone-700">
                                  {formatKhr(recipeCogs)}
                                </span>
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={addRecipeRow}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline whitespace-nowrap shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {t.products.addIngredientRow}
                          </button>
                        </div>

                        {recipe.length === 0 ? (
                          <p className="text-xs text-stone-400 py-2">{t.products.noRecipeYet}</p>
                        ) : (
                          <div className="space-y-2">
                            {recipe.map((row, index) => {
                              const chosenIng = ingMap.get(row.ingredientId);
                              const compatibleUnits = chosenIng
                                ? getCompatibleUnits(chosenIng.unit)
                                : (['pcs'] as IngredientUnit[]);
                              return (
                                <div
                                  key={index}
                                  className="grid grid-cols-12 gap-2 items-center"
                                >
                                  <select
                                    value={row.ingredientId}
                                    onChange={(e) =>
                                      updateRecipeRow(index, { ingredientId: e.target.value })
                                    }
                                    className="col-span-6 px-2.5 py-2 text-xs border border-stone-200 rounded-lg bg-white"
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
                                    className="col-span-3 px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                                  />
                                  <select
                                    value={row.unit || chosenIng?.unit || 'pcs'}
                                    onChange={(e) =>
                                      updateRecipeRow(index, {
                                        unit: e.target.value as IngredientUnit,
                                      })
                                    }
                                    className="col-span-2 px-2 py-2 text-xs border border-stone-200 rounded-lg bg-white"
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
                                    className="col-span-1 flex items-center justify-center p-1.5 text-stone-400 hover:text-red-700"
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

                    {/* Collapsible Nested Fieldset: Size Variants (Made-to-Order) */}
                    {productType === 'PREPARED_TO_ORDER' && (
                      <CollapsibleFieldset
                        id="pf-variants"
                        variant="nested"
                        title={
                          isVi
                            ? 'Kích cỡ S / M / L (tùy chọn)'
                            : 'Size Variants S / M / L (optional)'
                        }
                        summary={
                          variants.length > 0
                            ? `${variants.length} ${isVi ? 'cỡ' : 'sizes'}`
                            : undefined
                        }
                        open={showVariants}
                        onToggle={() => setShowVariants((prev) => !prev)}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-stone-500 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                              {isVi
                                ? 'Mỗi cỡ có giá bán, mã vạch và công thức riêng.'
                                : 'Give each size its own price, barcode, and recipe.'}
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
                            const vCost = Math.round(
                              calculateRecipeCogs(variant.recipe, ingredients)
                            );
                            return (
                              <div
                                key={variant.id}
                                className="p-3.5 bg-stone-50 border border-stone-200 rounded-lg space-y-3"
                              >
                                <div className="grid grid-cols-12 gap-2 items-center">
                                  <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) =>
                                      updateVariant(vIdx, { name: e.target.value })
                                    }
                                    placeholder={isVi ? 'Tên cỡ (VD: Nhỏ)' : 'Size (e.g. Small)'}
                                    className="col-span-4 px-2.5 py-2 text-xs border border-stone-200 rounded-lg bg-white"
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
                                    className="col-span-3 px-2.5 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                                  />
                                  <div className="col-span-4 flex items-center gap-1">
                                    <input
                                      type="text"
                                      maxLength={64}
                                      value={variant.barcode || ''}
                                      onChange={(e) =>
                                        updateVariant(vIdx, { barcode: e.target.value })
                                      }
                                      placeholder={isVi ? 'Mã vạch cỡ' : 'Variant code'}
                                      className="w-full min-w-0 px-2 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setScannerTarget({ kind: 'variant', index: vIdx })
                                      }
                                      className="p-1.5 text-stone-500 hover:text-[#0F5C43] shrink-0"
                                      title={isVi ? 'Quét mã vạch' : 'Scan barcode'}
                                    >
                                      <ScanBarcode className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeVariant(vIdx)}
                                    className="col-span-1 flex items-center justify-center p-1.5 text-stone-400 hover:text-red-700"
                                    aria-label="Remove size variant"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-stone-200/70">
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
                                      <div
                                        key={rIdx}
                                        className="grid grid-cols-12 gap-1.5 items-center"
                                      >
                                        <select
                                          value={row.ingredientId}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              ingredientId: e.target.value,
                                            })
                                          }
                                          className="col-span-6 px-2 py-1.5 text-xs border border-stone-200 rounded bg-white"
                                        >
                                          {ingredients.map((ing) => (
                                            <option key={ing.id} value={ing.id}>
                                              {isVi ? ing.nameVi || ing.name : ing.name} ({ing.unit}
                                              )
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
                                          className="col-span-3 px-2 py-1.5 text-xs font-mono-num border border-stone-200 rounded bg-white"
                                        />
                                        <select
                                          value={row.unit || chosenIng?.unit || 'pcs'}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              unit: e.target.value as IngredientUnit,
                                            })
                                          }
                                          className="col-span-2 px-1.5 py-1.5 text-xs border border-stone-200 rounded bg-white"
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
                                          className="col-span-1 flex items-center justify-center p-1 text-stone-400 hover:text-red-700"
                                          aria-label="Remove variant ingredient"
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
                      </CollapsibleFieldset>
                    )}
                  </fieldset>
                </div>

                {/* RIGHT COLUMN (5 cols): Pricing, Photo & Advanced Barcodes */}
                <div className="lg:col-span-5 space-y-5">
                  {/* SECTION 3: Pricing */}
                  <fieldset className="bg-white border border-stone-200 rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Giá bán & Lợi nhuận' : 'Pricing'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100">
                      <h3 className="font-display text-sm font-semibold text-stone-900">
                        {isVi ? 'Giá bán & Chi phí' : 'Pricing'}
                      </h3>
                      <span className="font-mono-num text-[11px] font-semibold text-emerald-700">
                        {liveMarginPct}% {isVi ? 'biên lãi' : 'margin'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className={productType === 'PREPARED_TO_ORDER' ? 'sm:col-span-2' : ''}>
                        <label
                          htmlFor="pf-price"
                          className="block text-xs font-medium text-stone-700 mb-1.5"
                        >
                          {t.products.sellingPrice}
                        </label>
                        <input
                          id="pf-price"
                          type="number"
                          min={0}
                          step={100}
                          required
                          value={priceKhr}
                          onChange={(e) => {
                            setManualPriceOverride(true);
                            setPriceKhr(e.target.value);
                          }}
                          className="w-full px-3 py-2.5 text-sm font-mono-num font-semibold text-stone-900 border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                        />
                        {productType === 'PREPARED_TO_ORDER' && variants.length > 0 && (
                          <p className="text-[11px] text-stone-500 mt-1">
                            {isVi
                              ? 'Đang dùng giá theo từng kích cỡ S/M/L.'
                              : 'Using size variant prices below.'}
                          </p>
                        )}
                      </div>

                      {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                        <div>
                          <label
                            htmlFor="pf-cost"
                            className="block text-xs font-medium text-stone-700 mb-1.5"
                          >
                            {isVi ? 'Giá vốn (KHR)' : 'Unit Cost (KHR)'}
                          </label>
                          <input
                            id="pf-cost"
                            type="number"
                            min={0}
                            step={100}
                            value={costPriceKhr}
                            onChange={(e) => handleCostOrMarkupChange(e.target.value, markupPercent)}
                            className="w-full px-3 py-2.5 text-sm font-mono-num border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                          />
                        </div>
                      )}
                    </div>

                    {/* Live Cost / Profit Readout */}
                    <div className="mt-4 pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-stone-500 block">
                          {productType === 'PACKAGED'
                            ? isVi
                              ? 'Giá vốn nhập'
                              : 'Est. Unit Cost'
                            : t.products.recipeCost}
                        </span>
                        <span className="font-mono-num font-semibold text-stone-900">
                          {formatKhr(liveUnitCost)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500 block">{t.products.grossMargin}</span>
                        <span
                          className={`font-mono-num font-semibold ${
                            liveProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {formatKhr(liveProfit)}
                        </span>
                      </div>
                    </div>

                    {/* Collapsible Nested Fieldset: Auto-Price Markup */}
                    {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                      <CollapsibleFieldset
                        id="pf-markup"
                        variant="nested"
                        title={
                          isVi
                            ? 'Tính giá tự động theo % lãi (tùy chọn)'
                            : 'Markup Auto-Pricing (optional)'
                        }
                        summary={markupPercent ? `+${markupPercent}%` : undefined}
                        open={showMarkupCalc}
                        onToggle={() => setShowMarkupCalc((prev) => !prev)}
                      >
                        <div className="space-y-3">
                          <div>
                            <label
                              htmlFor="pf-markup-input"
                              className="block text-xs font-medium text-stone-600 mb-1.5"
                            >
                              {isVi ? 'Phần trăm lãi (%)' : 'Target Markup (%)'}
                            </label>
                            <input
                              id="pf-markup-input"
                              type="number"
                              min={0}
                              step={5}
                              placeholder="e.g. 50"
                              value={markupPercent}
                              onChange={(e) => {
                                setManualPriceOverride(false);
                                handleCostOrMarkupChange(costPriceKhr, e.target.value, false);
                              }}
                              className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg bg-white"
                            />
                          </div>
                          <label className="inline-flex items-center gap-2 text-xs text-stone-600 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={manualPriceOverride}
                              onChange={(e) => {
                                const nextOverride = e.target.checked;
                                setManualPriceOverride(nextOverride);
                                if (!nextOverride) {
                                  handleCostOrMarkupChange(costPriceKhr, markupPercent, false);
                                }
                              }}
                              className="w-3.5 h-3.5 accent-[#0F5C43]"
                            />
                            {isVi
                              ? 'Giữ giá bán nhập tay (không tự tính)'
                              : 'Keep manual selling price override'}
                          </label>
                        </div>
                      </CollapsibleFieldset>
                    )}
                  </fieldset>

                  {/* SECTION 4: Product Photo */}
                  <fieldset className="bg-white border border-stone-200 rounded-xl p-5">
                    <legend className="sr-only">{t.products.imagePreset}</legend>
                    <h3 className="font-display text-sm font-semibold text-stone-900 pb-3 mb-4 border-b border-stone-100">
                      {t.products.imagePreset}
                    </h3>

                    <div className="space-y-3">
                      <div className="w-full h-32 rounded-lg overflow-hidden border border-stone-200 relative bg-stone-100">
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

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <ImagePlus className="w-3.5 h-3.5 text-[#0F5C43]" />
                          {uploadingPhoto ? t.products.processingPhoto : t.products.uploadFromPhotos}
                        </button>

                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => setDrivePickerOpen(true)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap"
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

                      <div className="grid grid-cols-5 gap-1.5">
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
                            <ProductPhoto src={preset.url} alt={preset.label} className="w-full h-10" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                </div>
              </div>
            </div>

            {/* Sticky Bottom Bar + Docked Advanced Barcode Configuration Drawer (All Product Types) */}
            <div className="shrink-0 border-t border-stone-200 bg-white">
              {showBarcodes && (
                <fieldset
                  id="pf-barcodes-panel"
                  className="bg-[#FAFBF9] border-b border-stone-200 px-5 sm:px-6 py-4 max-h-64 overflow-y-auto"
                >
                  <legend className="sr-only">
                    {isVi ? 'Cấu hình mã vạch nâng cao' : 'Advanced Barcode Configurations'}
                  </legend>

                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Barcode className="w-4 h-4 text-[#0F5C43] shrink-0" />
                      <span className="font-display text-xs font-semibold text-stone-900">
                        {isVi ? 'Cấu hình mã vạch nâng cao' : 'Advanced Barcode Configurations'}
                      </span>
                      <span className="text-[11px] text-stone-500 truncate">
                        · {t.productTypes[productType]}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBarcodes(false)}
                      className="p-1 text-stone-400 hover:text-stone-700 rounded transition-colors"
                      aria-label={t.common.close}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    {/* Unit Barcode / SKU (All product types) */}
                    <div className="md:col-span-5 space-y-1.5">
                      <label
                        htmlFor="pf-barcode"
                        className="block text-xs font-medium text-stone-700"
                      >
                        {isVi ? 'Mã vạch đơn vị / SKU' : 'Unit Barcode / SKU'}
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="pf-barcode"
                          type="text"
                          maxLength={64}
                          value={barcode}
                          onChange={(e) => setBarcode(e.target.value)}
                          placeholder="e.g. 8851959132012"
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                        />
                        <button
                          type="button"
                          onClick={() => setScannerTarget({ kind: 'unit' })}
                          className="px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <ScanBarcode className="w-3.5 h-3.5 text-[#0F5C43]" />
                          {isVi ? 'Quét' : 'Scan'}
                        </button>
                      </div>
                      <p className="text-[11px] text-stone-500">
                        {isVi
                          ? 'Áp dụng cho quét bán hàng POS và tìm kiếm nhanh.'
                          : 'Works for quick POS scanning across made-to-order, packaged, and prepared items.'}
                      </p>
                    </div>

                    {/* Carton / Pack / Multi-Unit Barcodes (All product types) */}
                    <div className="md:col-span-7 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-stone-700">
                          {isVi ? 'Mã vạch Thùng / Lốc / Gói' : 'Carton / Pack / Bundle Barcodes'}
                        </span>
                        <button
                          type="button"
                          onClick={addPackagingBarcode}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {isVi ? 'Thêm mã gói' : 'Add Pack'}
                        </button>
                      </div>

                      {packagingBarcodes.length === 0 ? (
                        <p className="text-[11px] text-stone-500 py-1.5">
                          {isVi
                            ? 'Gắn thêm mã vạch thùng/lốc để tự động nhân số lượng khi quét POS hoặc nhập kho.'
                            : 'Map multi-unit pack or tray barcodes to auto-multiply quantity on scan.'}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {packagingBarcodes.map((pb, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-12 gap-1.5 items-center bg-white p-2 border border-stone-200 rounded-lg"
                            >
                              <input
                                type="text"
                                placeholder={isVi ? 'Mã vạch gói' : 'Pack barcode'}
                                value={pb.barcode}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { barcode: e.target.value })
                                }
                                className="col-span-4 px-2 py-1.5 text-xs font-mono-num border border-stone-200 rounded bg-white"
                              />
                              <input
                                type="text"
                                placeholder={isVi ? 'Tên gói (Lốc 6)' : 'Label (Pack 6)'}
                                value={pb.label}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { label: e.target.value })
                                }
                                className="col-span-4 px-2 py-1.5 text-xs border border-stone-200 rounded bg-white"
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
                                className="col-span-2 px-2 py-1.5 text-xs font-mono-num border border-stone-200 rounded bg-white"
                                title={isVi ? 'Số đơn vị / gói' : 'Units per pack'}
                              />
                              <div className="col-span-2 flex items-center justify-end gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setScannerTarget({ kind: 'pack', index: idx })}
                                  className="p-1.5 text-stone-500 hover:text-[#0F5C43]"
                                  title={isVi ? 'Quét mã gói' : 'Scan pack barcode'}
                                >
                                  <ScanBarcode className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePackagingBarcode(idx)}
                                  className="p-1.5 text-stone-400 hover:text-red-700"
                                  aria-label="Remove pack barcode"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </fieldset>
              )}

              {/* Bottom Action Bar: Price & Profit | Advanced Barcode Config | Cancel & Save */}
              <div className="px-5 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
                  <div className="hidden sm:flex items-center gap-2.5 text-xs text-stone-500 whitespace-nowrap">
                    <span>
                      {isVi ? 'Giá bán:' : 'Price:'}{' '}
                      <strong className="font-mono-num text-stone-900">
                        {formatKhr(liveSellingPrice)}
                      </strong>
                    </span>
                    <span className="text-stone-300">|</span>
                    <span>
                      {isVi ? 'Lãi gộp:' : 'Profit:'}{' '}
                      <strong
                        className={`font-mono-num ${
                          liveProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatKhr(liveProfit)} ({liveMarginPct}%)
                      </strong>
                    </span>
                  </div>

                  <span className="hidden md:inline text-stone-200">|</span>

                  <button
                    type="button"
                    aria-expanded={showBarcodes}
                    aria-controls="pf-barcodes-panel"
                    onClick={() => setShowBarcodes((prev) => !prev)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      showBarcodes || barcodeSummary
                        ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                        : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <Barcode className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isVi ? 'Cấu hình mã vạch' : 'Advanced Barcode'}
                    </span>
                    {barcodeSummary && (
                      <span className="font-mono-num text-[11px] font-medium opacity-80 max-w-[110px] truncate">
                        ({barcodeSummary})
                      </span>
                    )}
                    {showBarcodes ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={onClose}
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
              </div>
            </div>
          </form>
        </div>
      </div>

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
    </>
  );
};
