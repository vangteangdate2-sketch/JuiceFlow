import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
  HardDrive,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  ScanBarcode,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BarcodeRegistryRecord,
  BarcodeSource,
  ExternalBarcodePrefill,
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
import type { SaveProductResult, StoreContextValue } from '../context/StoreContext';
import {
  calculateRecipeCogs,
  computePriceFromMarkup,
  formatKhr,
  generateId,
  getCompatibleUnits,
} from '../utils/format';
import {
  detectBarcodeFormat,
  findDuplicateBarcodeConflicts,
  formatBarcodeTypeLabel,
  generateUniqueInternalSku,
  lookupOpenFoodFactsV3,
  normalizeBarcodeString,
} from '../utils/barcodeRegistry';
import { InfoHint } from './InfoHint';
import { compressImageBlobToDataUrl } from '../utils/image';
import { DRINK_IMAGE_PRESETS } from '../utils/seedData';
import { ProductPhoto } from './ProductPhoto';
import { GoogleDrivePickerModal } from './GoogleDrivePickerModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { BarcodeLabelModal } from './BarcodeLabelModal';

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
      ? 'bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden'
      : 'border-t border-stone-200 dark:border-[#24352C] pt-3.5 mt-4';

  const buttonClass =
    variant === 'card'
      ? 'w-full min-h-[44px] px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-stone-50/80 dark:hover:bg-[#18251F] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]'
      : 'w-full min-h-[44px] py-1 flex items-center justify-between gap-3 text-left text-stone-700 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] rounded';

  const bodyClass =
    variant === 'card'
      ? 'px-5 pb-5 pt-3 border-t border-stone-100 dark:border-[#1F3028]'
      : 'pt-3';

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
            <ChevronDown className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0" />
          )}
          <span
            className={
              variant === 'card'
                ? 'font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] truncate'
                : 'text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] truncate'
            }
          >
            {title}
          </span>
        </span>
        {summary && !open && (
          <span className="font-mono-num text-[11px] text-stone-500 dark:text-[#94A39B] truncate max-w-[160px]">
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

export type ProductFormPayload = Omit<Product, 'id'> & {
  id?: string;
  barcodeSource?: BarcodeSource;
};

interface ProductFormModalProps {
  open: boolean;
  editingProduct: Product | null;
  existingProducts?: Product[];
  barcodeRegistry?: BarcodeRegistryRecord[];
  initialBarcode?: string;
  initialPrefill?: ExternalBarcodePrefill | null;
  initialNotFoundExternally?: boolean;
  initialFocusSection?: 'recipe' | null;
  ingredients: Ingredient[];
  settings: WorkspaceSettings;
  t: StoreContextValue['t'];
  onSave: (payload: ProductFormPayload) => Promise<SaveProductResult | void>;
  onSaved?: (product: Product) => void;
  onClose: () => void;
}

export const ProductFormModal: React.FC<ProductFormModalProps> = ({
  open,
  editingProduct,
  existingProducts = [],
  barcodeRegistry = [],
  initialBarcode,
  initialPrefill = null,
  initialNotFoundExternally = false,
  initialFocusSection = null,
  ingredients,
  settings,
  t,
  onSave,
  onSaved,
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
  const [barcodeSource, setBarcodeSource] = useState<BarcodeSource | undefined>(undefined);
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

  const [prefillBanner, setPrefillBanner] = useState<'none' | 'off_prefill' | 'manual_new'>('none');
  const [lookingUpExternal, setLookingUpExternal] = useState(false);
  const [externalLookupNote, setExternalLookupNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [labelModalOpen, setLabelModalOpen] = useState(false);

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
  const recipeSectionRef = useRef<HTMLDivElement | null>(null);
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // Synchronize form state whenever modal opens or target product changes
  useEffect(() => {
    if (!open) return;
    setSaveError('');
    setExternalLookupNote('');
    setLabelModalOpen(false);

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
      setBarcodeSource(undefined);
      setPackagingBarcodes((editingProduct.packagingBarcodes || []).map((pb) => ({ ...pb })));
      setStockQty(String(editingProduct.stockQty ?? 0));
      setReorderLevel(String(editingProduct.reorderLevel ?? 10));
      setUnit(editingProduct.unit || 'pcs');
      setSupplier(editingProduct.supplier || '');
      setImageUrl(editingProduct.imageUrl || '');
      setActive(editingProduct.active);
      setPhotoError('');
      const initialRecipe = (editingProduct.recipe || []).map((r) => ({ ...r }));
      if (
        initialFocusSection === 'recipe' &&
        initialRecipe.length === 0 &&
        !(editingProduct.variants && editingProduct.variants.length > 0) &&
        ingredients.length > 0
      ) {
        const firstIng = ingredients[0];
        initialRecipe.push({
          ingredientId: firstIng.id,
          quantity: 1,
          unit: firstIng.unit,
        });
      }
      setRecipe(initialRecipe);
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
      setPrefillBanner('none');
    } else {
      const cleanInitCode = normalizeBarcodeString(initialPrefill?.barcode || initialBarcode || '');
      const hasScannedInit = Boolean(cleanInitCode);

      setName(initialPrefill?.name || '');
      setNameVi(initialPrefill?.nameVi || '');
      setBrand(initialPrefill?.brand || '');
      setProductType(hasScannedInit ? 'PACKAGED' : 'PREPARED_TO_ORDER');
      setCategory(
        initialPrefill?.suggestedCategory || (hasScannedInit ? 'packaged' : 'juice')
      );
      // External prefill NEVER sets local KHR selling price, unit cost, or stock quantity
      setCostPriceKhr('0');
      setMarkupPercent('');
      setManualPriceOverride(false);
      setPriceKhr(hasScannedInit ? '' : '8000');
      setBarcode(cleanInitCode);
      setBarcodeSource(initialPrefill ? 'open_food_facts' : undefined);
      setPackagingBarcodes([]);
      setStockQty('0');
      setReorderLevel(String(settings.lowStockDefault || 12));
      setUnit('pcs');
      setSupplier('');
      setImageUrl(initialPrefill?.imageUrl || DRINK_IMAGE_PRESETS[0].url);
      setActive(true);
      setPhotoError('');
      setRecipe(
        !hasScannedInit && ingredients.length > 0
          ? [{ ingredientId: ingredients[0].id, quantity: 1, unit: ingredients[0].unit }]
          : []
      );
      setVariants([]);
      setShowSecondaryNaming(Boolean(initialPrefill?.nameVi || initialPrefill?.brand));
      setShowMarkupCalc(false);
      setShowBarcodes(hasScannedInit);
      setShowVariants(false);
      setPrefillBanner(
        initialPrefill
          ? 'off_prefill'
          : hasScannedInit && initialNotFoundExternally
            ? 'manual_new'
            : hasScannedInit
              ? 'manual_new'
              : 'none'
      );
    }
  }, [
    open,
    editingProduct,
    initialBarcode,
    initialPrefill,
    initialNotFoundExternally,
    initialFocusSection,
    ingredients,
    settings.lowStockDefault,
  ]);

  // Smoothly scroll directly to recipe mapping when opened via "+ Link Ingredients"
  useEffect(() => {
    if (!open || initialFocusSection !== 'recipe') return;
    const timer = window.setTimeout(() => {
      recipeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, initialFocusSection, editingProduct?.id]);

  // Close modal with Escape when sub-modals are not open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !drivePickerOpen && scannerTarget === null && !labelModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, drivePickerOpen, scannerTarget, labelModalOpen, onClose]);

  // Real-time duplicate active barcode validation across products, variants, and cartons
  const barcodeConflicts = useMemo(
    () =>
      findDuplicateBarcodeConflicts(
        {
          id: editingProduct?.id,
          name: name.trim() || editingProduct?.name || 'This product',
          barcode,
          variants: productType === 'PREPARED_TO_ORDER' ? variants : [],
          packagingBarcodes,
        },
        existingProducts,
        barcodeRegistry
      ),
    [editingProduct, name, barcode, productType, variants, packagingBarcodes, existingProducts, barcodeRegistry]
  );

  const detectedUnitFormat = useMemo(
    () => (barcode.trim() ? detectBarcodeFormat(barcode) : null),
    [barcode]
  );

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

  const draftProductForLabels = useMemo<Product>(
    () => ({
      id: editingProduct?.id || 'draft',
      name: name.trim() || (isVi ? 'Sản phẩm mới' : 'New Product'),
      nameVi: nameVi.trim() || name.trim() || 'Sản phẩm mới',
      brand: brand.trim(),
      category,
      productType,
      priceKhr: liveSellingPrice,
      costPriceKhr: liveUnitCost,
      imageUrl,
      active,
      barcode: normalizeBarcodeString(barcode),
      packagingBarcodes,
      stockQty: Number(stockQty) || 0,
      reorderLevel: Number(reorderLevel) || 0,
      unit,
      supplier,
      recipe,
      recipeVersion: 1,
      variants,
    }),
    [
      editingProduct,
      name,
      nameVi,
      brand,
      category,
      productType,
      liveSellingPrice,
      liveUnitCost,
      imageUrl,
      active,
      barcode,
      packagingBarcodes,
      stockQty,
      reorderLevel,
      unit,
      supplier,
      recipe,
      variants,
      isVi,
    ]
  );

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
    setSaveError('');

    if (barcodeConflicts.length > 0) {
      setShowBarcodes(true);
      const first = barcodeConflicts[0];
      setSaveError(
        first.isInternalDuplicate
          ? isVi
            ? `Mã vạch "${first.code}" bị lặp lại nhiều lần trong cùng sản phẩm.`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isVi
            ? `Mã vạch "${first.code}" đã thuộc về sản phẩm "${first.existingProductName}".`
            : `Barcode "${first.code}" is already assigned to "${first.existingProductName}".`
      );
      return;
    }

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
              barcode: normalizeBarcodeString(v.barcode),
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

    const cleanUnitBarcode = normalizeBarcodeString(barcode);
    const cleanPackBarcodes = packagingBarcodes
      .map((pb) => ({
        ...pb,
        barcode: normalizeBarcodeString(pb.barcode),
        label: pb.label.trim() || `Pack (${Math.max(1, Math.round(Number(pb.unitsPerPack) || 1))})`,
        unitsPerPack: Math.max(1, Math.round(Number(pb.unitsPerPack) || 1)),
      }))
      .filter((pb) => pb.barcode && pb.unitsPerPack >= 1);

    const result = await onSave({
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
      barcode: cleanUnitBarcode,
      barcodeSource,
      packagingBarcodes: cleanPackBarcodes,
      stockQty: productType === 'PREPARED_TO_ORDER' ? 0 : Number(stockQty) || 0,
      reorderLevel:
        productType === 'PREPARED_TO_ORDER' ? 0 : Math.max(0, Number(reorderLevel) || 0),
      unit,
      supplier: supplier.trim(),
      recipe: productType === 'PACKAGED' ? [] : cleanRecipe,
      recipeVersion: 1,
      variants: cleanVariants,
    });

    if (result && !result.ok) {
      setShowBarcodes(true);
      setSaveError(result.error || 'Could not save product.');
      return;
    }

    if (result?.product && onSaved) {
      onSaved(result.product);
    }
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

  const handleBarcodeScanned = (rawCode: string) => {
    const code = normalizeBarcodeString(rawCode);
    if (!scannerTarget) return;
    if (scannerTarget.kind === 'unit') {
      setBarcode(code);
      setBarcodeSource('manufacturer');
    } else if (scannerTarget.kind === 'pack') {
      updatePackagingBarcode(scannerTarget.index, { barcode: code });
    } else if (scannerTarget.kind === 'variant') {
      updateVariant(scannerTarget.index, { barcode: code });
    }
    setScannerTarget(null);
  };

  const handleAutoGenerateSku = () => {
    const extraCodes = [
      barcode,
      ...packagingBarcodes.map((pb) => pb.barcode),
      ...variants.map((v) => v.barcode || ''),
    ].filter(Boolean);
    const candidate = generateUniqueInternalSku({
      productType,
      category,
      name,
      existingProducts,
      registry: barcodeRegistry,
      extraUsedCodes: extraCodes,
    });
    setBarcode(candidate);
    setBarcodeSource('internal');
    setExternalLookupNote('');
  };

  const handleExternalPrefillLookup = async () => {
    const code = normalizeBarcodeString(barcode);
    if (!code || lookingUpExternal) return;
    setLookingUpExternal(true);
    setExternalLookupNote('');
    try {
      const prefill = await lookupOpenFoodFactsV3(code);
      if (!prefill) {
        setExternalLookupNote(
          isVi
            ? 'Không tìm thấy trên Open Food Facts — bạn có thể nhập thông tin thủ công bên trên.'
            : 'Not found on Open Food Facts — fill in product details manually above.'
        );
        return;
      }
      if (!name.trim()) setName(prefill.name);
      if (prefill.nameVi && !nameVi.trim()) {
        setNameVi(prefill.nameVi);
        setShowSecondaryNaming(true);
      }
      if (prefill.brand && !brand.trim()) {
        setBrand(prefill.brand);
        setShowSecondaryNaming(true);
      }
      if (prefill.suggestedCategory) setCategory(prefill.suggestedCategory);
      if (prefill.imageUrl && imageUrl === DRINK_IMAGE_PRESETS[0].url) {
        setImageUrl(prefill.imageUrl);
      }
      setBarcodeSource('open_food_facts');
      setPrefillBanner('off_prefill');
      setExternalLookupNote(
        isVi
          ? `Đã điền gợi ý "${prefill.name}" từ Open Food Facts. Hãy nhập giá bán KHR và tồn kho thực tế.`
          : `Prefilled "${prefill.name}" from Open Food Facts. Enter your local KHR price and stock.`
      );
    } finally {
      setLookingUpExternal(false);
    }
  };

  const hasAnyLabelableCode = Boolean(
    barcode.trim() ||
      variants.some((v) => v.barcode?.trim()) ||
      packagingBarcodes.some((pb) => pb.barcode?.trim())
  );

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
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-3 sm:p-5">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-form-modal-title"
          className="w-full max-w-4xl bg-[#F6F7F5] dark:bg-[#0B110E] border border-stone-200 dark:border-[#24352C] rounded-xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl"
        >
          {/* Sticky Modal Header */}
          <div className="px-6 py-4 bg-white dark:bg-[#131D18] border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-4 shrink-0">
            <div className="flex flex-wrap items-center gap-x-1 min-w-0">
              <h2
                id="product-form-modal-title"
                className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight"
              >
                {editingProduct ? t.products.editProduct : t.products.addProduct}
              </h2>
              <InfoHint
                compact
                label={isVi ? 'Hướng dẫn biểu mẫu sản phẩm' : 'About product setup'}
                text={
                  isVi
                    ? 'Điền thông tin cơ bản, giá bán và cài đặt tồn kho bên dưới.'
                    : 'Organize product details, pricing, and inventory settings.'
                }
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
              aria-label={t.common.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            {/* Scrollable Grid Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Calm Info Banner for Open Food Facts Prefill or Unknown Barcode Manual Registration */}
              {prefillBanner !== 'none' && (
                <div
                  role="status"
                  className={`px-4 py-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    prefillBanner === 'off_prefill'
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950 dark:bg-[#064E3B] dark:border-[#10B981]/50 dark:text-[#D1FAE5]'
                      : 'bg-white border-stone-200 text-stone-700 dark:bg-[#131D18] dark:border-[#24352C] dark:text-[#D5DFDA]'
                  }`}
                >
                  <Info className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                      {prefillBanner === 'off_prefill'
                        ? isVi
                          ? 'Đã điền thông tin tham khảo từ Open Food Facts'
                          : 'Product details prefilled from Open Food Facts'
                        : isVi
                          ? `Đăng ký sản phẩm mới cho mã vạch ${barcode}`
                          : `Registering new product for barcode ${barcode}`}
                    </p>
                    <p className="text-stone-600 dark:text-[#D5DFDA]">
                      {prefillBanner === 'off_prefill'
                        ? isVi
                          ? 'Chỉ tự động gợi ý tên, thương hiệu và danh mục. Vui lòng nhập giá bán (KHR), giá vốn và tồn kho của cửa hàng.'
                          : 'Only name, brand, and category were prefilled. Please enter your local selling price (KHR), cost, and opening stock.'
                        : isVi
                          ? 'Không tìm thấy trong danh mục ngoài — hãy nhập tên sản phẩm, giá bán KHR và tồn kho thủ công bên dưới.'
                          : 'Not found in external food catalog — enter product name, local KHR price, and stock manually below.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Duplicate Active Barcode Error Banner */}
              {(saveError || barcodeConflicts.length > 0) && (
                <div
                  role="alert"
                  className="px-4 py-3 rounded-xl border border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-950/50 text-xs text-red-900 dark:text-red-200 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-[#F87171] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {saveError ||
                        (isVi
                          ? 'Phát hiện mã vạch trùng lặp đang hoạt động'
                          : 'Duplicate active barcode detected')}
                    </p>
                    {barcodeConflicts.map((c, idx) => (
                      <p key={`${c.code}-${idx}`} className="font-mono-num">
                        {c.isInternalDuplicate
                          ? isVi
                            ? `Mã "${c.code}" xuất hiện hơn 1 lần trên sản phẩm này.`
                            : `"${c.code}" is entered more than once on this product.`
                          : isVi
                            ? `Mã "${c.code}" đang được gắn cho "${c.existingProductName}"${
                                c.existingVariantName ? ` (${c.existingVariantName})` : ''
                              }.`
                            : `"${c.code}" is already assigned to "${c.existingProductName}"${
                                c.existingVariantName ? ` (${c.existingVariantName})` : ''
                              }.`}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Bar: Inventory Classification Selector */}
              <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 sm:p-5">
                <legend className="sr-only">
                  {isVi ? 'Phân loại tồn kho' : 'Inventory Classification'}
                </legend>
                <div className="flex flex-wrap items-center gap-x-1 mb-3">
                  <span className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                    {isVi ? 'Loại sản phẩm' : 'Product Type'}
                  </span>
                  <InfoHint
                    compact
                    label={isVi ? 'Giải thích loại sản phẩm' : 'About Product Type'}
                    text={
                      isVi
                        ? 'Quyết định cách hệ thống tự động trừ tồn kho khi bán hàng: trừ trực tiếp hàng đóng gói, trừ hàng pha sẵn, hoặc trừ nguyên liệu theo công thức.'
                        : 'Determines how stock is deducted automatically at checkout: direct packaged units, prepared batch stock, or raw ingredients via recipe.'
                    }
                  />
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
                          className={`min-h-[56px] px-4 py-3 rounded-lg border text-left transition-colors ${
                            selected
                              ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                              : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                          }`}
                        >
                          <div className="text-xs font-semibold truncate">
                            {t.productTypes[pt]}
                          </div>
                          <div className="text-[11px] font-normal text-stone-500 dark:text-[#94A39B] mt-0.5 truncate">
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
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Thông tin cơ bản' : 'Basic Info'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                      <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Thông tin cơ bản' : 'Basic Info'}
                      </h3>
                      <label className="min-h-[44px] inline-flex items-center gap-2.5 text-xs font-medium text-stone-700 dark:text-[#D5DFDA] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => setActive(e.target.checked)}
                          className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981] rounded"
                        />
                        {isVi ? 'Hiện trên POS' : 'Show on POS'}
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                      <div className="sm:col-span-7">
                        <label
                          htmlFor="pf-name"
                          className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                          className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label
                          htmlFor="pf-category"
                          className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                        >
                          {t.products.category}
                        </label>
                        <select
                          id="pf-category"
                          value={category}
                          onChange={(e) => setCategory(e.target.value as ProductCategory)}
                          className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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
                            className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
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
                            className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="pf-brand"
                            className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
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
                            className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>
                      </div>
                    </CollapsibleFieldset>
                  </fieldset>

                  {/* SECTION 2: Inventory Settings (Stock / Recipe / Variants) */}
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Cài đặt tồn kho' : 'Inventory Settings'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                      <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Cài đặt kho & Công thức' : 'Inventory Settings'}
                      </h3>
                      <span className="text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                        {t.productTypes[productType]}
                      </span>
                    </div>

                    {/* Direct Stock Controls for Packaged & Prepared Stock */}
                    {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                      <div className="grid grid-cols-2 sm:grid-cols-12 gap-3.5 mb-5">
                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-stock"
                            className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                          >
                            {t.inventory.inStock}
                          </label>
                          <input
                            id="pf-stock"
                            type="number"
                            step="any"
                            value={stockQty}
                            onChange={(e) => setStockQty(e.target.value)}
                            className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>

                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-reorder"
                            className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                            className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>

                        <div className="col-span-1 sm:col-span-4">
                          <label
                            htmlFor="pf-unit"
                            className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                          >
                            {t.inventory.unit}
                          </label>
                          <select
                            id="pf-unit"
                            value={unit}
                            onChange={(e) => setUnit(e.target.value as IngredientUnit)}
                            className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          >
                            {ALL_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-span-2 sm:col-span-12">
                          <label
                            htmlFor="pf-supplier"
                            className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                            className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Recipe Builder for Made-to-Order & Prepared Stock */}
                    {productType !== 'PACKAGED' && (
                      <div
                        ref={recipeSectionRef}
                        className={`${
                          productType === 'PREPARED_STOCK'
                            ? 'pt-4 border-t border-stone-100 dark:border-[#1F3028] space-y-3'
                            : 'space-y-3'
                        } ${
                          initialFocusSection === 'recipe'
                            ? 'rounded-xl p-3 -m-1 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-400/60 dark:ring-amber-500/40'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-1">
                              <span className="text-xs font-semibold text-stone-800 dark:text-[#F1F5F3]">
                                {productType === 'PREPARED_STOCK'
                                  ? isVi
                                    ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                                    : 'Batch Prep Recipe (per 1 finished unit)'
                                  : t.products.recipeSection}
                              </span>
                              <InfoHint
                                compact
                                label={
                                  productType === 'PREPARED_STOCK'
                                    ? isVi
                                      ? 'Giải thích công thức pha mẻ'
                                      : 'About Batch Prep Recipe'
                                    : isVi
                                      ? 'Giải thích định lượng nguyên liệu'
                                      : 'About Recipe Mapping'
                                }
                                text={
                                  productType === 'PREPARED_STOCK'
                                    ? isVi
                                      ? 'Định lượng nguyên liệu cho 1 đơn vị thành phẩm; tự động trừ kho nguyên liệu khi bạn bấm "Pha mẻ mới" trong Kho hàng.'
                                      : 'Ingredients per finished unit; automatically deducted from raw stock when you run "Prepare Batch" in Inventory.'
                                    : isVi
                                      ? 'Tự động trừ kho nguyên liệu thô và tính giá vốn (COGS) mỗi khi bán món này trên POS.'
                                      : 'Automatically deducts raw ingredient stock and calculates COGS whenever this drink is sold on POS.'
                                }
                              />
                            </div>
                            {recipe.length > 0 && (
                              <span className="text-[11px] text-stone-500 dark:text-[#94A39B] block mt-0.5">
                                {isVi ? 'Giá vốn công thức ước tính:' : 'Est. recipe cost:'}{' '}
                                <span className="font-mono-num font-semibold text-stone-700 dark:text-[#D5DFDA]">
                                  {formatKhr(recipeCogs)}
                                </span>
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={addRecipeRow}
                            className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#064E3B]/50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {t.products.addIngredientRow}
                          </button>
                        </div>

                        {recipe.length === 0 ? (
                          <p className="text-xs text-stone-400 dark:text-[#94A39B] py-2">
                            {t.products.noRecipeYet}
                          </p>
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
                                    className="col-span-6 h-11 px-2.5 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                    className="col-span-3 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                  />
                                  <select
                                    value={row.unit || chosenIng?.unit || 'pcs'}
                                    onChange={(e) =>
                                      updateRecipeRow(index, {
                                        unit: e.target.value as IngredientUnit,
                                      })
                                    }
                                    className="col-span-2 h-11 px-2 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                    className="col-span-1 h-11 flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg"
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
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-x-1.5 min-w-0">
                              <Layers className="w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] shrink-0" />
                              <span className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                                {isVi ? 'Danh sách kích cỡ' : 'Size Variants'}
                              </span>
                              <InfoHint
                                compact
                                label={isVi ? 'Giải thích kích cỡ sản phẩm' : 'About Size Variants'}
                                text={
                                  isVi
                                    ? 'Mỗi cỡ (S / M / L) có giá bán, mã vạch và công thức nguyên liệu riêng.'
                                    : 'Give each size (S / M / L) its own selling price, barcode, and ingredient recipe.'
                                }
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => addVariant()}
                              className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#064E3B]/50 rounded-lg transition-colors whitespace-nowrap shrink-0"
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
                                className="p-3.5 bg-stone-50 dark:bg-[#0F1814] border border-stone-200 dark:border-[#24352C] rounded-lg space-y-3"
                              >
                                <div className="grid grid-cols-12 gap-2 items-center">
                                  <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) =>
                                      updateVariant(vIdx, { name: e.target.value })
                                    }
                                    placeholder={isVi ? 'Tên cỡ (VD: Nhỏ)' : 'Size (e.g. Small)'}
                                    className="col-span-4 h-11 px-2.5 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
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
                                    className="col-span-3 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
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
                                      className="w-full min-w-0 h-11 px-2 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setScannerTarget({ kind: 'variant', index: vIdx })
                                      }
                                      className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] rounded-lg shrink-0"
                                      title={isVi ? 'Quét mã vạch' : 'Scan barcode'}
                                    >
                                      <ScanBarcode className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeVariant(vIdx)}
                                    className="col-span-1 h-11 flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg"
                                    aria-label="Remove size variant"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="space-y-2 pt-2 border-t border-stone-200/70 dark:border-[#24352C]">
                                  <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-[#94A39B]">
                                    <span>
                                      {isVi ? 'Công thức' : 'Recipe'} ·{' '}
                                      <span className="font-mono-num text-stone-700 dark:text-[#D5DFDA] font-semibold">
                                        COGS {formatKhr(vCost)}
                                      </span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => addVariantRecipeRow(vIdx)}
                                      className="h-9 px-2 text-[#0F5C43] dark:text-[#34D399] font-semibold hover:underline"
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
                                          className="col-span-6 h-11 px-2 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                          className="col-span-3 h-11 px-2 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                        />
                                        <select
                                          value={row.unit || chosenIng?.unit || 'pcs'}
                                          onChange={(e) =>
                                            updateVariantRecipeRow(vIdx, rIdx, {
                                              unit: e.target.value as IngredientUnit,
                                            })
                                          }
                                          className="col-span-2 h-11 px-1.5 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                          className="col-span-1 h-11 flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg"
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
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                    <legend className="sr-only">
                      {isVi ? 'Giá bán & Lợi nhuận' : 'Pricing'}
                    </legend>
                    <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                      <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Giá bán & Chi phí' : 'Pricing'}
                      </h3>
                      <span className="font-mono-num text-[11px] font-semibold text-emerald-700 dark:text-[#34D399]">
                        {liveMarginPct}% {isVi ? 'biên lãi' : 'margin'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className={productType === 'PREPARED_TO_ORDER' ? 'sm:col-span-2' : ''}>
                        <label
                          htmlFor="pf-price"
                          className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                          className="w-full h-11 px-3 text-sm font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        />
                        {productType === 'PREPARED_TO_ORDER' && variants.length > 0 && (
                          <p className="text-[11px] text-stone-500 dark:text-[#94A39B] mt-1">
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
                            className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                            className="w-full h-11 px-3 text-sm font-mono-num text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                        </div>
                      )}
                    </div>

                    {/* Live Cost / Profit Readout */}
                    <div className="mt-4 pt-3 border-t border-stone-100 dark:border-[#1F3028] grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-stone-500 dark:text-[#94A39B] block">
                          {productType === 'PACKAGED'
                            ? isVi
                              ? 'Giá vốn nhập'
                              : 'Est. Unit Cost'
                            : t.products.recipeCost}
                        </span>
                        <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                          {formatKhr(liveUnitCost)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500 dark:text-[#94A39B] block">
                          {t.products.grossMargin}
                        </span>
                        <span
                          className={`font-mono-num font-semibold ${
                            liveProfit >= 0
                              ? 'text-emerald-700 dark:text-[#34D399]'
                              : 'text-red-700 dark:text-[#F87171]'
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
                              className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
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
                              className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            />
                          </div>
                          <label className="min-h-[44px] inline-flex items-center gap-2.5 text-xs text-stone-600 dark:text-[#D5DFDA] cursor-pointer select-none">
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
                              className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981] rounded"
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
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                    <legend className="sr-only">{t.products.imagePreset}</legend>
                    <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                      {t.products.imagePreset}
                    </h3>

                    <div className="space-y-3">
                      <div className="w-full h-32 rounded-lg overflow-hidden border border-stone-200 dark:border-[#24352C] relative bg-stone-100 dark:bg-[#18251F]">
                        <ProductPhoto
                          src={imageUrl}
                          alt={name || t.products.imagePreset}
                          category={category}
                          className="w-full h-full"
                        />
                        {uploadingPhoto && (
                          <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-xs gap-1.5">
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => photoInputRef.current?.click()}
                          className="h-11 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <ImagePlus className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                          {uploadingPhoto ? t.products.processingPhoto : t.products.uploadFromPhotos}
                        </button>

                        <button
                          type="button"
                          disabled={uploadingPhoto}
                          onClick={() => setDrivePickerOpen(true)}
                          className="h-11 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <HardDrive className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
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

                      {photoError && (
                        <p className="text-xs text-red-700 dark:text-[#F87171] font-medium">
                          {photoError}
                        </p>
                      )}

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
                              imageUrl === preset.url
                                ? 'border-[#0F5C43] dark:border-[#10B981]'
                                : 'border-transparent'
                            }`}
                            title={isVi ? preset.labelVi : preset.label}
                          >
                            <ProductPhoto src={preset.url} alt={preset.label} className="w-full h-11" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                </div>
              </div>
            </div>

            {/* Sticky Bottom Bar + Docked Advanced Barcode Configuration Drawer (All Product Types) */}
            <div className="shrink-0 border-t border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18]">
              {showBarcodes && (
                <fieldset
                  id="pf-barcodes-panel"
                  className="bg-[#FAFBF9] dark:bg-[#0F1814] border-b border-stone-200 dark:border-[#24352C] px-5 sm:px-6 py-4 max-h-72 overflow-y-auto"
                >
                  <legend className="sr-only">
                    {isVi ? 'Cấu hình mã vạch nâng cao' : 'Advanced Barcode Configurations'}
                  </legend>

                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Barcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                      <span className="font-display text-xs font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Cấu hình mã vạch nâng cao' : 'Advanced Barcode Configurations'}
                      </span>
                      <span className="text-[11px] text-stone-500 dark:text-[#94A39B] truncate">
                        · {t.productTypes[productType]}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBarcodes(false)}
                      className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors shrink-0"
                      aria-label={t.common.close}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    {/* Unit Barcode / SKU (All product types) */}
                    <div className="md:col-span-6 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="pf-barcode"
                          className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA]"
                        >
                          {isVi ? 'Mã vạch đơn vị / SKU' : 'Unit Barcode / SKU'}
                        </label>
                        {detectedUnitFormat && (
                          <span className="font-mono-num text-[11px] font-semibold text-[#0F5C43] dark:text-[#34D399]">
                            {formatBarcodeTypeLabel(detectedUnitFormat)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                        <input
                          id="pf-barcode"
                          type="text"
                          maxLength={64}
                          value={barcode}
                          onChange={(e) => {
                            setBarcode(e.target.value);
                            setSaveError('');
                            setExternalLookupNote('');
                          }}
                          placeholder="e.g. 0049000042566"
                          className="flex-1 min-w-[130px] h-11 px-3 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        />
                        <button
                          type="button"
                          onClick={handleAutoGenerateSku}
                          className="h-11 px-3 text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                          title={
                            isVi
                              ? 'Tự động tạo mã SKU duy nhất'
                              : 'Automatically generate a unique SKU'
                          }
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {isVi ? 'Tạo mã SKU' : 'Auto-Generate SKU'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setScannerTarget({ kind: 'unit' })}
                          className="h-11 px-3 text-xs font-semibold text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                        >
                          <ScanBarcode className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                          {isVi ? 'Quét' : 'Scan'}
                        </button>
                      </div>

                      {/* External Lookup + Label Studio Action Row */}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {settings.enableOpenFoodFactsLookup !== false &&
                          barcode.trim().length >= 6 &&
                          detectedUnitFormat !== 'INTERNAL' && (
                            <button
                              type="button"
                              disabled={lookingUpExternal}
                              onClick={handleExternalPrefillLookup}
                              className="min-h-[36px] inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F5C43] dark:text-[#34D399] hover:underline disabled:opacity-50"
                            >
                              {lookingUpExternal ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Globe className="w-3.5 h-3.5" />
                              )}
                              {isVi
                                ? 'Tra Open Food Facts (chỉ gợi ý tên)'
                                : 'Lookup Open Food Facts (name only)'}
                            </button>
                          )}

                        {hasAnyLabelableCode && (
                          <button
                            type="button"
                            onClick={() => setLabelModalOpen(true)}
                            className="min-h-[36px] inline-flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 dark:text-[#D5DFDA] hover:text-[#0F5C43] dark:hover:text-[#34D399]"
                          >
                            <Printer className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                            {isVi ? 'In tem Code 128 / QR' : 'Print Code 128 / QR Label'}
                          </button>
                        )}
                      </div>

                      {externalLookupNote ? (
                        <p className="text-[11px] text-stone-600 dark:text-[#D5DFDA]">
                          {externalLookupNote}
                        </p>
                      ) : (
                        <p className="text-[11px] text-stone-500 dark:text-[#94A39B]">
                          {isVi
                            ? 'Giữ nguyên số 0 ở đầu (EAN-13/8, UPC-A/E, Code 128, QR).'
                            : 'Preserves leading zeros across EAN-13/8, UPC-A/E, Code 128, and QR.'}
                        </p>
                      )}
                    </div>

                    {/* Carton / Pack / Multi-Unit Barcodes (All product types) */}
                    <div className="md:col-span-6 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
                          {isVi ? 'Mã vạch Thùng / Lốc / Gói' : 'Carton / Pack / Bundle Barcodes'}
                        </span>
                        <button
                          type="button"
                          onClick={addPackagingBarcode}
                          className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#064E3B]/50 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {isVi ? 'Thêm mã gói' : 'Add Pack'}
                        </button>
                      </div>

                      {packagingBarcodes.length === 0 ? (
                        <p className="text-[11px] text-stone-500 dark:text-[#94A39B] py-1.5">
                          {isVi
                            ? 'Gắn thêm mã vạch thùng/lốc để tự động nhân số lượng khi quét POS hoặc nhập kho.'
                            : 'Map multi-unit pack or tray barcodes to auto-multiply quantity on scan.'}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {packagingBarcodes.map((pb, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-12 gap-1.5 items-center bg-white dark:bg-[#131D18] p-2 border border-stone-200 dark:border-[#24352C] rounded-lg"
                            >
                              <input
                                type="text"
                                placeholder={isVi ? 'Mã vạch gói' : 'Pack barcode'}
                                value={pb.barcode}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { barcode: e.target.value })
                                }
                                className="col-span-4 h-11 px-2 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                              />
                              <input
                                type="text"
                                placeholder={isVi ? 'Tên gói (Lốc 6)' : 'Label (Pack 6)'}
                                value={pb.label}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { label: e.target.value })
                                }
                                className="col-span-4 h-11 px-2 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
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
                                className="col-span-2 h-11 px-2 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                title={isVi ? 'Số đơn vị / gói' : 'Units per pack'}
                              />
                              <div className="col-span-2 flex items-center justify-end gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setScannerTarget({ kind: 'pack', index: idx })}
                                  className="w-9 h-9 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] rounded-lg"
                                  title={isVi ? 'Quét mã gói' : 'Scan pack barcode'}
                                >
                                  <ScanBarcode className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePackagingBarcode(idx)}
                                  className="w-9 h-9 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg"
                                  aria-label="Remove pack barcode"
                                >
                                  <X className="w-4 h-4" />
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
                  <div className="hidden sm:flex items-center gap-2.5 text-xs text-stone-500 dark:text-[#94A39B] whitespace-nowrap">
                    <span>
                      {isVi ? 'Giá bán:' : 'Price:'}{' '}
                      <strong className="font-mono-num text-stone-900 dark:text-[#F1F5F3]">
                        {formatKhr(liveSellingPrice)}
                      </strong>
                    </span>
                    <span className="text-stone-300 dark:text-[#24352C]">|</span>
                    <span>
                      {isVi ? 'Lãi gộp:' : 'Profit:'}{' '}
                      <strong
                        className={`font-mono-num ${
                          liveProfit >= 0
                            ? 'text-emerald-700 dark:text-[#34D399]'
                            : 'text-red-700 dark:text-[#F87171]'
                        }`}
                      >
                        {formatKhr(liveProfit)} ({liveMarginPct}%)
                      </strong>
                    </span>
                  </div>

                  <span className="hidden md:inline text-stone-200 dark:text-[#24352C]">|</span>

                  <button
                    type="button"
                    aria-expanded={showBarcodes}
                    aria-controls="pf-barcodes-panel"
                    onClick={() => setShowBarcodes((prev) => !prev)}
                    className={`h-11 inline-flex items-center gap-2 px-3.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      showBarcodes || barcodeSummary
                        ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                        : 'border-stone-200 dark:border-[#24352C] bg-stone-50 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
                    }`}
                  >
                    <Barcode className="w-4 h-4 shrink-0" />
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
                    className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={barcodeConflicts.length > 0}
                    className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-colors"
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

      {/* Internal Code 128 & QR Label Studio */}
      <BarcodeLabelModal
        open={labelModalOpen}
        product={draftProductForLabels}
        initialCode={barcode.trim() || undefined}
        shopName={settings.name}
        isVi={isVi}
        onClose={() => setLabelModalOpen(false)}
      />
    </>
  );
};
