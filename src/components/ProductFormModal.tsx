import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Barcode,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  HardDrive,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Package,
  Plus,
  Printer,
  RefreshCw,
  ScanBarcode,
  Trash2,
  Utensils,
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
import { useStore, type SaveProductResult, type StoreContextValue } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import {
  getCategoriesForScope,
  getCategoryDisplayName,
  resolveProductCategoryId,
} from '../utils/categories';
import {
  calculateRecipeCogs,
  computePriceFromMarkup,
  convertUnitQty,
  formatKhr,
  formatUsdRef,
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

type WizardStep = 1 | 2 | 3;

const NEW_CATEGORY_SENTINEL = '__new_category__';

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
  onSaved?: (product: Product, meta?: { addAnother?: boolean }) => void;
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
  const isEditing = Boolean(editingProduct);
  const exchangeRate = settings.posExchangeRate || settings.usdRate || 4000;
  const { showNoticeToast } = useUndoToast();

  // Wizard step navigation
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [activeVariantRecipeIdx, setActiveVariantRecipeIdx] = useState(0);

  const { categories: allCategories, addCategory } = useStore();
  const productCategories = useMemo(
    () => getCategoriesForScope(allCategories, 'product'),
    [allCategories]
  );

  // Inline "+ New Category" creator state
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState('');
  const [inlineCategoryError, setInlineCategoryError] = useState('');
  const [inlineCategoryBusy, setInlineCategoryBusy] = useState(false);

  // Form fields
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

  const [prefillBanner, setPrefillBanner] = useState<'none' | 'off_prefill' | 'manual_new'>('none');
  const [lookingUpExternal, setLookingUpExternal] = useState(false);
  const [externalLookupNote, setExternalLookupNote] = useState('');
  const [stepError, setStepError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
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
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  // Synchronize form state whenever modal opens or target product changes
  useEffect(() => {
    if (!open) return;
    setSaveError('');
    setStepError('');
    setSaving(false);
    setExternalLookupNote('');
    setLabelModalOpen(false);
    setCreatingCategory(false);
    setInlineCategoryName('');
    setInlineCategoryError('');
    setActiveVariantRecipeIdx(0);
    setCurrentStep(initialFocusSection === 'recipe' ? 3 : 1);

    if (editingProduct) {
      setName(editingProduct.name);
      setNameVi(editingProduct.nameVi);
      setBrand(editingProduct.brand || '');
      setProductType(editingProduct.productType);
      setCategory(resolveProductCategoryId(editingProduct, allCategories));
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
      setRecipe([]);
      setVariants([]);
      setShowSecondaryNaming(Boolean(initialPrefill?.nameVi || initialPrefill?.brand));
      setShowMarkupCalc(false);
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
    settings.lowStockDefault,
  ]);

  // Keep activeVariantRecipeIdx within bounds when variants change
  useEffect(() => {
    if (variants.length === 0) {
      setActiveVariantRecipeIdx(0);
    } else if (activeVariantRecipeIdx >= variants.length) {
      setActiveVariantRecipeIdx(variants.length - 1);
    }
  }, [variants.length, activeVariantRecipeIdx]);

  // Scroll modal body back to top when switching steps
  useEffect(() => {
    if (!open) return;
    scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep, open]);

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

  const unitBarcodeConflicts = useMemo(() => {
    const cleanUnit = normalizeBarcodeString(barcode);
    if (!cleanUnit) return [];
    return barcodeConflicts.filter((c) => c.code === cleanUnit);
  }, [barcode, barcodeConflicts]);

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
        const target = variants[activeVariantRecipeIdx] || variants[0];
        return Math.round(calculateRecipeCogs(target.recipe, ingredients));
      }
      return recipeCogs;
    }
    const manualCost = Math.max(0, Number(costPriceKhr) || 0);
    if (productType === 'PREPARED_STOCK' && manualCost <= 0 && recipe.length > 0) {
      return recipeCogs;
    }
    return manualCost;
  }, [
    productType,
    variants,
    activeVariantRecipeIdx,
    ingredients,
    recipeCogs,
    costPriceKhr,
    recipe.length,
  ]);

  const liveSellingPrice = useMemo(() => {
    if (productType === 'PREPARED_TO_ORDER' && variants.length > 0) {
      const target = variants[activeVariantRecipeIdx] || variants[0];
      return Math.max(0, Number(target.priceKhr) || 0);
    }
    return Math.max(0, Number(priceKhr) || 0);
  }, [productType, variants, activeVariantRecipeIdx, priceKhr]);

  const liveProfit = liveSellingPrice - liveUnitCost;
  const liveMarginPct =
    liveSellingPrice > 0 ? Math.round((liveProfit / liveSellingPrice) * 100) : 0;

  const basePriceNum = Math.max(0, Number(priceKhr) || 0);
  const hasVariantsEnabled = productType === 'PREPARED_TO_ORDER' && variants.length > 0;

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

  const validateStep = (step: WizardStep): string | null => {
    if (step === 1) {
      if (!name.trim()) {
        return isVi
          ? 'Vui lòng nhập tên sản phẩm trước khi tiếp tục.'
          : 'Please enter a product name before continuing.';
      }
      if (!category) {
        return isVi ? 'Vui lòng chọn danh mục sản phẩm.' : 'Please select a product category.';
      }
      if (unitBarcodeConflicts.length > 0) {
        const first = unitBarcodeConflicts[0];
        return first.isInternalDuplicate
          ? isVi
            ? `Mã vạch "${first.code}" bị lặp lại trên sản phẩm này.`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isVi
            ? `Mã vạch "${first.code}" đã thuộc về "${first.existingProductName}".`
            : `Barcode "${first.code}" is already assigned to "${first.existingProductName}".`;
      }
      return null;
    }

    if (step === 2) {
      if (productType === 'PREPARED_TO_ORDER' && variants.length > 0) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          if (!v.name.trim()) {
            return isVi
              ? `Vui lòng nhập tên kích cỡ cho dòng thứ ${i + 1}.`
              : `Please enter a size name for variant #${i + 1}.`;
          }
          if (!Number.isFinite(Number(v.priceKhr)) || Number(v.priceKhr) <= 0) {
            return isVi
              ? `Vui lòng nhập giá bán hợp lệ (lớn hơn 0) cho cỡ "${v.name.trim()}".`
              : `Please enter a valid selling price (> 0 KHR) for "${v.name.trim()}".`;
          }
        }
      } else {
        const parsed = Number(priceKhr);
        if (priceKhr.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
          return isVi
            ? 'Vui lòng nhập giá bán (KHR) lớn hơn 0 trước khi tiếp tục.'
            : 'Please enter a selling price in KHR greater than 0 before continuing.';
        }
      }

      if (barcodeConflicts.length > 0) {
        const first = barcodeConflicts[0];
        return first.isInternalDuplicate
          ? isVi
            ? `Mã vạch "${first.code}" bị trùng lặp trong cùng sản phẩm.`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isVi
            ? `Mã vạch "${first.code}" đã được gắn cho "${first.existingProductName}".`
            : `Barcode "${first.code}" is already assigned to "${first.existingProductName}".`;
      }
      return null;
    }

    return null;
  };

  const handleStepTabClick = (targetStep: WizardStep) => {
    if (targetStep === currentStep) return;
    setStepError('');
    setSaveError('');

    // When editing an existing product, allow jumping freely to any step
    if (isEditing) {
      setCurrentStep(targetStep);
      return;
    }

    // When creating a new product, allow stepping backward freely
    if (targetStep < currentStep) {
      setCurrentStep(targetStep);
      return;
    }

    // Validate current (and any intermediate) step before jumping forward
    for (let s = currentStep; s < targetStep; s++) {
      const err = validateStep(s as WizardStep);
      if (err) {
        setCurrentStep(s as WizardStep);
        setStepError(err);
        return;
      }
    }
    setCurrentStep(targetStep);
  };

  const handleNextStep = () => {
    setStepError('');
    setSaveError('');
    if (!isEditing) {
      const err = validateStep(currentStep);
      if (err) {
        setStepError(err);
        return;
      }
    }
    if (currentStep < 3) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const handleBackStep = () => {
    setStepError('');
    setSaveError('');
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleProductTypeChange = (nextType: ProductType) => {
    setProductType(nextType);
    setStepError('');
    const hasPackaged = productCategories.some((c) => c.id === 'packaged');
    const hasJuice = productCategories.some((c) => c.id === 'juice');
    if (nextType === 'PACKAGED') {
      if (!['packaged', 'snack'].includes(category) && hasPackaged) setCategory('packaged');
      setVariants([]);
    } else if (nextType === 'PREPARED_STOCK') {
      if (['packaged', 'snack'].includes(category) && hasJuice) setCategory('juice');
      setVariants([]);
    } else {
      if (['packaged', 'snack'].includes(category) && hasJuice) setCategory('juice');
    }
  };

  const handleCreateInlineCategory = async () => {
    const trimmed = inlineCategoryName.trim();
    if (!trimmed || inlineCategoryBusy) return;
    setInlineCategoryBusy(true);
    setInlineCategoryError('');
    try {
      const res = await addCategory({
        name: trimmed,
        scope: productType === 'PACKAGED' ? 'both' : 'product',
      });
      if (!res.ok || !res.category) {
        setInlineCategoryError(
          res.error || (isVi ? 'Không thể tạo danh mục.' : 'Could not create category.')
        );
        return;
      }
      setCategory(res.category.id);
      setInlineCategoryName('');
      setCreatingCategory(false);
    } finally {
      setInlineCategoryBusy(false);
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

  const handleSaveProduct = async (mode: 'close' | 'add_another' = 'close') => {
    if (saving) return;
    setSaveError('');
    setStepError('');

    // Validate Step 1 & Step 2 before final save
    const step1Err = validateStep(1);
    if (step1Err) {
      setCurrentStep(1);
      setStepError(step1Err);
      return;
    }

    const step2Err = validateStep(2);
    if (step2Err) {
      setCurrentStep(2);
      setStepError(step2Err);
      return;
    }

    if (barcodeConflicts.length > 0) {
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

    const trimmedName = name.trim();
    setSaving(true);
    try {
      const result = await onSave({
        id: editingProduct?.id,
        name: trimmedName,
        nameVi: nameVi.trim() || trimmedName,
        brand: brand.trim(),
        productType,
        category,
        categoryId: category,
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
        setSaveError(result.error || 'Could not save product.');
        return;
      }

      if (result?.product && onSaved) {
        onSaved(result.product);
      }

      if (mode === 'add_another' && !isEditing) {
        showNoticeToast({
          message: isVi ? `Đã lưu "${trimmedName}"` : `Saved "${trimmedName}"`,
          detail: isVi ? 'Sẵn sàng thêm sản phẩm tiếp theo' : 'Ready for next product',
        });
        // Reset per-product fields while keeping smart defaults (productType, category, unit, reorderLevel, supplier, active)
        setName('');
        setNameVi('');
        setBrand('');
        setBarcode('');
        setBarcodeSource(undefined);
        setPackagingBarcodes([]);
        setStockQty('0');
        setCostPriceKhr('0');
        setMarkupPercent('');
        setManualPriceOverride(false);
        setPriceKhr(productType === 'PACKAGED' ? '' : '8000');
        setImageUrl(DRINK_IMAGE_PRESETS[0].url);
        setPhotoError('');
        setRecipe([]);
        setVariants([]);
        setActiveVariantRecipeIdx(0);
        setShowSecondaryNaming(false);
        setShowMarkupCalc(false);
        setPrefillBanner('none');
        setExternalLookupNote('');
        setStepError('');
        setSaveError('');
        setCurrentStep(1);
        scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentStep < 3) {
      handleNextStep();
    } else {
      void handleSaveProduct('close');
    }
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
  const addVariant = (presetName?: string, presetVi?: string, priceDelta?: number) => {
    const baseRecipeCopy = recipe.map((r) => ({ ...r }));
    setVariants((prev) => {
      const baseNum = Math.max(0, Number(priceKhr) || 8000);
      const nextPrice = baseNum + (priceDelta !== undefined ? priceDelta : prev.length * 2000);
      return [
        ...prev,
        {
          id: generateId('var'),
          name:
            presetName || (prev.length === 0 ? 'Small' : prev.length === 1 ? 'Medium' : 'Large'),
          nameVi:
            presetVi ||
            (prev.length === 0 ? 'Nhỏ (S)' : prev.length === 1 ? 'Vừa (M)' : 'Lớn (L)'),
          priceKhr: nextPrice,
          barcode: '',
          recipe: baseRecipeCopy,
          recipeVersion: 1,
        },
      ];
    });
  };

  const toggleSizeVariants = () => {
    setStepError('');
    if (variants.length > 0) {
      setVariants([]);
      setActiveVariantRecipeIdx(0);
    } else {
      const baseNum = Math.max(0, Number(priceKhr) || 8000);
      const baseRecipeCopy = recipe.map((r) => ({ ...r }));
      setVariants([
        {
          id: generateId('var'),
          name: 'Small',
          nameVi: 'Nhỏ (S)',
          priceKhr: baseNum,
          barcode: '',
          recipe: baseRecipeCopy,
          recipeVersion: 1,
        },
        {
          id: generateId('var'),
          name: 'Medium',
          nameVi: 'Vừa (M)',
          priceKhr: baseNum + 2000,
          barcode: '',
          recipe: baseRecipeCopy.map((r) => ({ ...r })),
          recipeVersion: 1,
        },
      ]);
      setActiveVariantRecipeIdx(0);
    }
  };

  const updateVariant = (index: number, patch: Partial<ProductVariant>) => {
    setVariants((prev) => prev.map((v, idx) => (idx === index ? { ...v, ...patch } : v)));
    setStepError('');
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

  const copyFirstVariantRecipe = (targetIdx: number) => {
    if (variants.length === 0 || targetIdx === 0) return;
    const sourceRecipe = variants[0].recipe.map((r) => ({ ...r }));
    setVariants((prev) =>
      prev.map((v, idx) => (idx === targetIdx ? { ...v, recipe: sourceRecipe } : v))
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
      setStepError('');
      setSaveError('');
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
    setStepError('');
    setSaveError('');
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
          ? `Đã điền gợi ý "${prefill.name}" từ Open Food Facts. Hãy nhập giá bán KHR ở Bước 2.`
          : `Prefilled "${prefill.name}" from Open Food Facts. Enter your local KHR price in Step 2.`
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

  const computeRowCostKhr = (row: RecipeItem): number => {
    const ing = ingMap.get(row.ingredientId);
    if (!ing || !row.quantity || row.quantity <= 0) return 0;
    const qtyInBase = convertUnitQty(row.quantity, row.unit ?? ing.unit, ing.unit);
    return Math.round((Number(ing.unitCostKhr) || 0) * qtyInBase);
  };

  const wizardSteps: { step: WizardStep; shortLabel: string; fullLabel: string }[] = [
    {
      step: 1,
      shortLabel: isVi ? 'Cơ bản' : 'Basic Info',
      fullLabel: isVi ? 'Thông tin & Ảnh' : 'Basic Info',
    },
    {
      step: 2,
      shortLabel: isVi ? 'Giá & Cỡ' : 'Pricing',
      fullLabel: isVi ? 'Giá bán & Kích cỡ' : 'Pricing & Variants',
    },
    {
      step: 3,
      shortLabel: isVi ? 'Kho & Công thức' : 'Recipe & Stock',
      fullLabel:
        productType === 'PREPARED_TO_ORDER'
          ? isVi
            ? 'Công thức & Giá vốn'
            : 'Recipe & Stock'
          : isVi
            ? 'Tồn kho & Giá vốn'
            : 'Recipe & Stock',
    },
  ];

  // Active recipe context for Step 3 Made-to-Order
  const activeVariant = hasVariantsEnabled
    ? variants[activeVariantRecipeIdx] || variants[0]
    : null;
  const activeMtoRecipe = activeVariant ? activeVariant.recipe : recipe;
  const activeMtoCost = Math.round(calculateRecipeCogs(activeMtoRecipe, ingredients));
  const activeMtoPrice = activeVariant
    ? Math.max(0, Number(activeVariant.priceKhr) || 0)
    : basePriceNum;
  const activeMtoProfit = activeMtoPrice - activeMtoCost;
  const activeMtoMargin =
    activeMtoPrice > 0 ? Math.round((activeMtoProfit / activeMtoPrice) * 100) : 0;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-2.5 sm:p-5 animate-backdrop">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-form-modal-title"
          className="w-full max-w-4xl bg-[#F6F7F5] dark:bg-[#0B110E] border border-stone-200 dark:border-[#24352C] rounded-xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl animate-modal"
        >
          {/* Sticky Modal Header + Interactive 3-Step Progress Stepper */}
          <div className="bg-white dark:bg-[#131D18] border-b border-stone-200 dark:border-[#24352C] shrink-0">
            <div className="px-5 sm:px-6 pt-4 pb-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h2
                    id="product-form-modal-title"
                    className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight truncate"
                  >
                    {isEditing ? t.products.editProduct : t.products.addProduct}
                  </h2>
                  <InfoHint
                    compact
                    label={isVi ? 'Hướng dẫn thêm sản phẩm 3 bước' : 'About 3-step product wizard'}
                    text={
                      isVi
                        ? isEditing
                          ? 'Bạn có thể bấm trực tiếp vào bất kỳ bước nào bên dưới để chỉnh sửa nhanh.'
                          : 'Hoàn thành 3 bước: Thông tin cơ bản, Giá bán & Kích cỡ, và Công thức / Tồn kho.'
                        : isEditing
                          ? 'Jump directly to any step tab below to edit details without clicking through sequentially.'
                          : 'Follow the 3 steps to set up basic info, selling prices, and recipe or stock tracking.'
                    }
                  />
                </div>
                {isEditing && name.trim() && (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] truncate mt-0.5">
                    {name.trim()} · {t.productTypes[productType]}
                  </p>
                )}
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

            {/* 3-Step Interactive Progress Header (44px+ touch targets) */}
            <nav
              aria-label={isVi ? 'Các bước thiết lập sản phẩm' : 'Product setup steps'}
              className="grid grid-cols-3 border-t border-stone-100 dark:border-[#1F3028] px-2 sm:px-4"
            >
              {wizardSteps.map(({ step, shortLabel, fullLabel }) => {
                const isActive = currentStep === step;
                const isCompleted = !isActive && (step < currentStep || isEditing);
                return (
                  <button
                    key={step}
                    type="button"
                    onClick={() => handleStepTabClick(step)}
                    aria-current={isActive ? 'step' : undefined}
                    className={`min-h-[48px] px-2 sm:px-3 py-2.5 flex items-center justify-center gap-2 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] ${
                      isActive
                        ? 'border-[#0F5C43] dark:border-[#10B981] text-[#0F5C43] dark:text-[#34D399] bg-emerald-50/40 dark:bg-[#064E3B]/25'
                        : 'border-transparent text-stone-500 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3] hover:bg-stone-50/70 dark:hover:bg-[#18251F]/60'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-mono-num font-bold shrink-0 transition-colors ${
                        isActive
                          ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                          : isCompleted
                            ? 'bg-emerald-100 text-[#0F5C43] dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                            : 'bg-stone-100 text-stone-500 dark:bg-[#18251F] dark:text-[#94A39B]'
                      }`}
                    >
                      {isCompleted && !isEditing ? <Check className="w-3.5 h-3.5" /> : step}
                    </span>
                    <span className="text-xs sm:text-[13px] font-semibold truncate whitespace-nowrap">
                      <span className="sm:hidden">{shortLabel}</span>
                      <span className="hidden sm:inline">{fullLabel}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          <form onSubmit={handleFormSubmit} noValidate className="flex-1 flex flex-col min-h-0">
            {/* Scrollable Step Content Body */}
            <div ref={scrollBodyRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Step Validation or Save / Barcode Conflict Error Banner */}
              {(stepError || saveError || barcodeConflicts.length > 0) && (
                <div
                  role="alert"
                  className="px-4 py-3 rounded-xl border border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-950/50 text-xs text-red-900 dark:text-red-200 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-[#F87171] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {stepError ||
                        saveError ||
                        (isVi
                          ? 'Phát hiện mã vạch trùng lặp đang hoạt động'
                          : 'Duplicate active barcode detected')}
                    </p>
                    {!stepError &&
                      barcodeConflicts.map((c, idx) => (
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

              {/* ============================================================ */}
              {/* STEP 1: BASIC INFO & PHOTO                                   */}
              {/* ============================================================ */}
              {currentStep === 1 && (
                <div className="space-y-5">
                  {/* Open Food Facts Prefill or Unknown Barcode Banner */}
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
                              ? 'Chỉ tự động gợi ý tên, thương hiệu và danh mục. Bạn sẽ nhập giá bán KHR ở Bước 2 và tồn kho ở Bước 3.'
                              : 'Only name, brand, and category were prefilled. Enter your selling price in Step 2 and stock in Step 3.'
                            : isVi
                              ? 'Không tìm thấy trong danh mục ngoài — hãy nhập tên sản phẩm bên dưới, sau đó nhập giá và tồn kho ở các bước tiếp theo.'
                              : 'Not found in external food catalog — enter product details below, then set local price and stock in the next steps.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Primary Inputs Beside Product Photo Card */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                    {/* Left: Name, Category, Item Type */}
                    <fieldset className="lg:col-span-7 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between">
                      <legend className="sr-only">
                        {isVi ? 'Thông tin cơ bản' : 'Basic Information'}
                      </legend>

                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                          <div className="sm:col-span-7">
                            <label
                              htmlFor="pf-name"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Tên sản phẩm' : 'Product Name'} *
                            </label>
                            <input
                              id="pf-name"
                              type="text"
                              required
                              maxLength={100}
                              value={name}
                              onChange={(e) => {
                                setName(e.target.value);
                                if (stepError) setStepError('');
                              }}
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
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {t.products.category} *
                            </label>
                            <select
                              id="pf-category"
                              value={category}
                              onChange={(e) => {
                                if (e.target.value === NEW_CATEGORY_SENTINEL) {
                                  setCreatingCategory(true);
                                  setInlineCategoryError('');
                                  return;
                                }
                                setCategory(e.target.value as ProductCategory);
                              }}
                              className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            >
                              {productCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {getCategoryDisplayName(c, isVi)}
                                </option>
                              ))}
                              <option value={NEW_CATEGORY_SENTINEL}>
                                {isVi ? '+ Thêm danh mục mới...' : '+ New Category...'}
                              </option>
                            </select>

                            {creatingCategory && (
                              <div className="mt-2 p-2.5 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] space-y-2">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    maxLength={64}
                                    value={inlineCategoryName}
                                    onChange={(e) => {
                                      setInlineCategoryName(e.target.value);
                                      if (inlineCategoryError) setInlineCategoryError('');
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void handleCreateInlineCategory();
                                      } else if (e.key === 'Escape') {
                                        setCreatingCategory(false);
                                      }
                                    }}
                                    placeholder={isVi ? 'Tên danh mục mới...' : 'New category name...'}
                                    autoFocus
                                    className="flex-1 min-w-0 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3]"
                                  />
                                  <button
                                    type="button"
                                    disabled={!inlineCategoryName.trim() || inlineCategoryBusy}
                                    onClick={() => void handleCreateInlineCategory()}
                                    className="h-11 px-3 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] disabled:opacity-50 rounded-lg shrink-0"
                                  >
                                    {isVi ? 'Lưu' : 'Add'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCreatingCategory(false);
                                      setInlineCategoryName('');
                                      setInlineCategoryError('');
                                    }}
                                    aria-label={t.common.cancel}
                                    className="w-11 h-11 inline-flex items-center justify-center text-stone-500 hover:text-stone-800 dark:text-[#94A39B] dark:hover:text-[#F1F5F3] rounded-lg shrink-0"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                                {inlineCategoryError && (
                                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                                    {inlineCategoryError}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Item Type Selector */}
                        <div className="pt-1">
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                              {isVi ? 'Loại sản phẩm' : 'Item Type'}
                            </span>
                            <InfoHint
                              compact
                              label={isVi ? 'Giải thích loại sản phẩm' : 'About Item Type'}
                              text={
                                isVi
                                  ? 'Quyết định cách trừ kho khi bán: Pha chế theo ly (trừ nguyên liệu theo công thức), Đóng gói sẵn (trừ số lượng chai/lon), hoặc Pha sẵn theo mẻ (trừ kho thành phẩm).'
                                  : 'Controls how stock deducts on POS sales: Made-to-Order deducts raw ingredients via recipe, Packaged deducts unit stock directly, and Prepared Stock tracks pre-made batches.'
                              }
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {(
                              ['PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as ProductType[]
                            ).map((pt) => {
                              const selected = productType === pt;
                              return (
                                <button
                                  key={pt}
                                  type="button"
                                  onClick={() => handleProductTypeChange(pt)}
                                  aria-pressed={selected}
                                  className={`min-h-[58px] px-3 py-2.5 rounded-lg border text-left transition-colors ${
                                    selected
                                      ? 'border-[#0F5C43] bg-emerald-50/75 text-[#0F5C43] dark:border-[#10B981] dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                                      : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                                  }`}
                                >
                                  <div className="text-xs font-semibold truncate">
                                    {t.productTypes[pt]}
                                  </div>
                                  <div className="text-[11px] font-normal text-stone-500 dark:text-[#94A39B] mt-0.5 line-clamp-1">
                                    {pt === 'PACKAGED'
                                      ? isVi
                                        ? 'Trừ trực tiếp chai/lon'
                                        : 'Direct unit stock'
                                      : pt === 'PREPARED_STOCK'
                                        ? isVi
                                          ? 'Pha sẵn & trữ lạnh'
                                          : 'Pre-made batch stock'
                                        : isVi
                                          ? 'Trừ nguyên liệu theo ly'
                                          : 'Recipe ingredients'}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Optional Secondary Naming & Brand */}
                      <CollapsibleFieldset
                        id="pf-secondary-naming"
                        variant="nested"
                        title={
                          isVi
                            ? 'Tên tiếng Việt & Thương hiệu (tùy chọn)'
                            : 'Secondary Name & Brand (optional)'
                        }
                        summary={secondaryNamingSummary}
                        open={showSecondaryNaming}
                        onToggle={() => setShowSecondaryNaming((prev) => !prev)}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                    {/* Right: Product Photo Upload & Preview Card */}
                    <fieldset className="lg:col-span-5 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between gap-3">
                      <legend className="sr-only">{t.products.imagePreset}</legend>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                            {t.products.imagePreset}
                          </span>
                          <span className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                            {isVi ? 'Hiển thị trên POS' : 'POS thumbnail'}
                          </span>
                        </div>

                        <div className="w-full h-36 sm:h-40 rounded-lg overflow-hidden border border-stone-200 dark:border-[#24352C] relative bg-stone-100 dark:bg-[#18251F]">
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
                      </div>

                      <div className="grid grid-cols-5 gap-1.5 pt-1">
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
                                : 'border-transparent hover:border-stone-300 dark:hover:border-[#24352C]'
                            }`}
                            title={isVi ? preset.labelVi : preset.label}
                          >
                            <ProductPhoto src={preset.url} alt={preset.label} className="w-full h-11" />
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  {/* Compact Barcode + Scan / Lookup Row */}
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 sm:p-5 space-y-2.5">
                    <legend className="sr-only">
                      {isVi ? 'Mã vạch & Tra cứu' : 'Barcode & Lookup'}
                    </legend>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Barcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] mr-0.5 shrink-0" />
                        <label
                          htmlFor="pf-barcode"
                          className="text-xs font-semibold text-stone-800 dark:text-[#F1F5F3]"
                        >
                          {isVi ? 'Mã vạch / SKU (tùy chọn)' : 'Barcode / SKU (optional)'}
                        </label>
                        <InfoHint
                          compact
                          label={isVi ? 'Giải thích tra cứu mã vạch' : 'About barcode lookup'}
                          text={
                            isVi
                              ? 'Quét hoặc nhập mã vạch EAN-13/UPC/Code 128 (giữ nguyên số 0 ở đầu). Dùng nút Tra cứu Open Food Facts để tự động gợi ý tên, thương hiệu và danh mục — hoặc bấm Tạo mã SKU để in tem nội bộ.'
                              : 'Scan or enter EAN-13, UPC, or Code 128 barcodes (leading zeros preserved). Use Lookup to fetch product name and brand from Open Food Facts, or Auto-SKU to generate a printable store label.'
                          }
                        />
                      </div>
                      {detectedUnitFormat && (
                        <span className="font-mono-num text-[11px] font-semibold text-[#0F5C43] dark:text-[#34D399]">
                          {formatBarcodeTypeLabel(detectedUnitFormat)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap gap-2">
                      <input
                        id="pf-barcode"
                        type="text"
                        maxLength={64}
                        value={barcode}
                        onChange={(e) => {
                          setBarcode(e.target.value);
                          setSaveError('');
                          setStepError('');
                          setExternalLookupNote('');
                        }}
                        placeholder="e.g. 0049000042566"
                        className="flex-1 min-w-[160px] h-11 px-3.5 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      />
                      <button
                        type="button"
                        onClick={() => setScannerTarget({ kind: 'unit' })}
                        className="h-11 px-3.5 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                      >
                        <ScanBarcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
                        {isVi ? 'Quét' : 'Scan'}
                      </button>
                      <button
                        type="button"
                        onClick={handleAutoGenerateSku}
                        className="h-11 px-3.5 text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                        title={
                          isVi ? 'Tự động tạo mã SKU duy nhất' : 'Automatically generate a unique SKU'
                        }
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {isVi ? 'Tạo SKU' : 'Auto-SKU'}
                      </button>
                      {settings.enableOpenFoodFactsLookup !== false &&
                        barcode.trim().length >= 6 &&
                        detectedUnitFormat !== 'INTERNAL' && (
                          <button
                            type="button"
                            disabled={lookingUpExternal}
                            onClick={handleExternalPrefillLookup}
                            className="h-11 px-3.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] bg-white dark:bg-[#18251F] border border-emerald-200 dark:border-[#10B981]/40 hover:bg-emerald-50/70 dark:hover:bg-[#064E3B]/50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
                          >
                            {lookingUpExternal ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Globe className="w-3.5 h-3.5" />
                            )}
                            {isVi ? 'Tra cứu' : 'Lookup'}
                          </button>
                        )}
                      {hasAnyLabelableCode && (
                        <button
                          type="button"
                          onClick={() => setLabelModalOpen(true)}
                          className="h-11 px-3.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                          title={isVi ? 'In tem mã vạch / QR' : 'Print Code 128 / QR label'}
                        >
                          <Printer className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                          <span className="hidden sm:inline">{isVi ? 'In tem' : 'Print Label'}</span>
                        </button>
                      )}
                    </div>

                    {externalLookupNote && (
                      <p className="text-xs text-stone-600 dark:text-[#D5DFDA]">{externalLookupNote}</p>
                    )}
                  </fieldset>

                  {/* Available on POS Toggle Switch */}
                  <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <span className="block text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                        {isVi ? 'Hiển thị trên màn hình POS' : 'Available on POS'}
                      </span>
                      <span className="block text-xs text-stone-500 dark:text-[#94A39B]">
                        {isVi
                          ? 'Bật để thu ngân có thể chọn và bán món này ngay lập tức.'
                          : 'Enable so cashiers can tap and ring up this item at the register.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => setActive((prev) => !prev)}
                      className="min-h-[44px] min-w-[52px] inline-flex items-center justify-end shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] rounded-lg"
                      aria-label={isVi ? 'Hiển thị trên POS' : 'Available on POS'}
                    >
                      <span
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                          active
                            ? 'bg-[#0F5C43] dark:bg-[#10B981]'
                            : 'bg-stone-300 dark:bg-[#24352C]'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                            active ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 2: PRICING & VARIANTS                                   */}
              {/* ============================================================ */}
              {currentStep === 2 && (
                <div className="space-y-5">
                  {/* Primary Selling Price Card with Live USD Conversion */}
                  <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                    <legend className="sr-only">
                      {isVi ? 'Giá bán cơ bản' : 'Base Selling Price'}
                    </legend>
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-100 dark:border-[#1F3028]">
                      <div className="flex items-center gap-1">
                        <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                          {isVi ? 'Giá bán (KHR)' : 'Base Selling Price'}
                        </h3>
                        <InfoHint
                          compact
                          label={isVi ? 'Giải thích tỷ giá quy đổi' : 'About USD conversion'}
                          text={
                            isVi
                              ? `Tự động quy đổi tham khảo theo tỷ giá POS (${exchangeRate.toLocaleString('en-US')} ៛/$). Giá bán trên hóa đơn vẫn tính bằng KHR.`
                              : `Shows live USD reference using your POS exchange rate (${exchangeRate.toLocaleString('en-US')} ៛/$). Register totals remain in KHR.`
                          }
                        />
                      </div>
                      <span className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                        {exchangeRate.toLocaleString('en-US')} ៛ / $1
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                      <div className="sm:col-span-7">
                        <label
                          htmlFor="pf-price"
                          className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                        >
                          {t.products.sellingPrice} {!hasVariantsEnabled ? '*' : ''}
                        </label>
                        <div className="relative">
                          <input
                            id="pf-price"
                            type="number"
                            min={0}
                            step={100}
                            value={priceKhr}
                            onChange={(e) => {
                              setManualPriceOverride(true);
                              setPriceKhr(e.target.value);
                              if (stepError) setStepError('');
                            }}
                            placeholder="e.g. 8000"
                            className="w-full h-12 pl-3.5 pr-12 text-base font-mono-num font-bold text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                          />
                          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono-num text-sm font-semibold text-stone-400 dark:text-[#94A39B]">
                            ៛
                          </span>
                        </div>
                      </div>

                      {/* Live USD Reference Box */}
                      <div className="sm:col-span-5 h-12 px-4 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-2">
                        <span className="text-xs text-stone-500 dark:text-[#94A39B]">
                          {isVi ? 'Quy đổi USD' : 'USD Equivalent'}
                        </span>
                        <span className="font-mono-num text-base font-bold text-[#0F5C43] dark:text-[#34D399]">
                          {formatUsdRef(basePriceNum, exchangeRate) || '≈ $0.00'}
                        </span>
                      </div>
                    </div>

                    {hasVariantsEnabled && (
                      <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                        {isVi
                          ? 'Đang bật nhiều kích cỡ bên dưới — thu ngân sẽ chọn giá theo từng cỡ (S / M / L).'
                          : 'Size variants are enabled below — POS cashiers will ring up each size at its variant price.'}
                      </p>
                    )}

                    {/* Optional Markup Auto-Pricing for Packaged / Prepared Stock */}
                    {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                      <CollapsibleFieldset
                        id="pf-markup"
                        variant="nested"
                        title={
                          isVi
                            ? 'Tính giá tự động theo % lãi (tùy chọn)'
                            : 'Markup Auto-Pricing Calculator (optional)'
                        }
                        summary={markupPercent ? `+${markupPercent}%` : undefined}
                        open={showMarkupCalc}
                        onToggle={() => setShowMarkupCalc((prev) => !prev)}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
                          <div>
                            <label
                              htmlFor="pf-cost-step2"
                              className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Giá vốn tham chiếu (KHR)' : 'Unit Cost Reference (KHR)'}
                            </label>
                            <input
                              id="pf-cost-step2"
                              type="number"
                              min={0}
                              step={100}
                              value={costPriceKhr}
                              onChange={(e) =>
                                handleCostOrMarkupChange(e.target.value, markupPercent)
                              }
                              className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="pf-markup-input"
                              className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Phần trăm lãi mục tiêu (%)' : 'Target Markup (%)'}
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
                              className="w-full h-11 px-3 text-sm font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]"
                            />
                          </div>
                        </div>
                        <label className="min-h-[44px] mt-2 inline-flex items-center gap-2.5 text-xs text-stone-600 dark:text-[#D5DFDA] cursor-pointer select-none">
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
                            ? 'Giữ giá bán nhập tay (không tự tính theo % lãi)'
                            : 'Keep manual selling price override'}
                        </label>
                      </CollapsibleFieldset>
                    )}
                  </fieldset>

                  {/* Size Variants Section for Made-to-Order Items */}
                  {productType === 'PREPARED_TO_ORDER' && (
                    <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                      <legend className="sr-only">
                        {isVi ? 'Kích cỡ sản phẩm' : 'Size Variants'}
                      </legend>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                            <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {isVi ? 'Kích cỡ (Small / Medium / Large)' : 'Size Variants'}
                            </h3>
                            <InfoHint
                              compact
                              label={isVi ? 'Giải thích giá theo kích cỡ' : 'About size variant pricing'}
                              text={
                                isVi
                                  ? 'Bật nếu đồ uống có nhiều cỡ (Nhỏ, Vừa, Lớn). Mỗi cỡ có giá bán riêng, mã vạch riêng và công thức nguyên liệu riêng ở Bước 3.'
                                  : 'Enable when a drink comes in multiple cup sizes (Small, Medium, Large). Each size has its own selling price, optional barcode, and recipe in Step 3.'
                              }
                            />
                          </div>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                            {isVi
                              ? 'Tùy chọn bán theo nhiều kích cỡ ly với giá và định lượng riêng.'
                              : 'Offer multiple cup sizes with individual prices and recipe margins.'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={hasVariantsEnabled}
                            onClick={toggleSizeVariants}
                            className="min-h-[44px] inline-flex items-center gap-2 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]"
                          >
                            <span>{hasVariantsEnabled ? (isVi ? 'Đang bật' : 'Enabled') : isVi ? 'Tắt' : 'Off'}</span>
                            <span
                              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                                hasVariantsEnabled
                                  ? 'bg-[#0F5C43] dark:bg-[#10B981]'
                                  : 'bg-stone-300 dark:bg-[#24352C]'
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                                  hasVariantsEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </span>
                          </button>
                        </div>
                      </div>

                      {hasVariantsEnabled && (
                        <div className="space-y-3 pt-2 border-t border-stone-100 dark:border-[#1F3028]">
                          {variants.map((variant, vIdx) => {
                            const vCost = Math.round(
                              calculateRecipeCogs(variant.recipe, ingredients)
                            );
                            const vPrice = Math.max(0, Number(variant.priceKhr) || 0);
                            const vHasRecipe = variant.recipe.length > 0;
                            const vMargin =
                              vPrice > 0 ? Math.round(((vPrice - vCost) / vPrice) * 100) : 0;

                            return (
                              <div
                                key={variant.id}
                                className="p-3.5 rounded-lg bg-stone-50/80 dark:bg-[#0F1814] border border-stone-200 dark:border-[#24352C] space-y-2.5"
                              >
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
                                  {/* Size Name */}
                                  <div className="sm:col-span-3">
                                    <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                                      {isVi ? 'Tên kích cỡ *' : 'Size Name *'}
                                    </label>
                                    <input
                                      type="text"
                                      value={variant.name}
                                      onChange={(e) =>
                                        updateVariant(vIdx, { name: e.target.value })
                                      }
                                      placeholder={isVi ? 'VD: Nhỏ / Vừa / Lớn' : 'e.g. Small'}
                                      className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                    />
                                  </div>

                                  {/* Selling Price */}
                                  <div className="sm:col-span-3">
                                    <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                                      {isVi ? 'Giá bán (KHR) *' : 'Selling Price (KHR) *'}
                                    </label>
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
                                      className="w-full h-11 px-3 text-sm font-mono-num font-semibold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                    />
                                    <span className="block font-mono-num text-[11px] text-stone-500 dark:text-[#94A39B] mt-1">
                                      {formatUsdRef(vPrice, exchangeRate)}
                                    </span>
                                  </div>

                                  {/* Optional Variant Barcode + Scan */}
                                  <div className="sm:col-span-3">
                                    <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                                      {isVi ? 'Mã vạch cỡ (tùy chọn)' : 'Barcode (optional)'}
                                    </label>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        maxLength={64}
                                        value={variant.barcode || ''}
                                        onChange={(e) =>
                                          updateVariant(vIdx, { barcode: e.target.value })
                                        }
                                        placeholder={isVi ? 'Mã vạch' : 'Optional code'}
                                        className="w-full min-w-0 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setScannerTarget({ kind: 'variant', index: vIdx })
                                        }
                                        className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg shrink-0"
                                        title={isVi ? 'Quét mã vạch' : 'Scan barcode'}
                                      >
                                        <ScanBarcode className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Live Gross Margin % + Delete */}
                                  <div className="sm:col-span-3 flex items-end justify-between gap-2 sm:pt-5">
                                    <div className="min-w-0">
                                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                                        {isVi ? 'Biên lãi gộp' : 'Gross Margin'}
                                      </span>
                                      {vHasRecipe ? (
                                        <div className="flex items-baseline gap-1.5 flex-wrap">
                                          <span
                                            className={`font-mono-num text-sm font-bold ${
                                              vMargin >= 0
                                                ? 'text-emerald-700 dark:text-[#34D399]'
                                                : 'text-red-700 dark:text-[#F87171]'
                                            }`}
                                          >
                                            {vMargin}%
                                          </span>
                                          <span className="font-mono-num text-[11px] text-stone-500 dark:text-[#94A39B]">
                                            ({formatKhr(vCost)})
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-stone-400 dark:text-[#94A39B]">
                                          {isVi ? 'Gắn công thức ở Bước 3' : 'Set recipe in Step 3'}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeVariant(vIdx)}
                                      className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg shrink-0 transition-colors"
                                      aria-label={isVi ? 'Xóa kích cỡ' : 'Remove size variant'}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => addVariant()}
                              className="h-11 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] bg-emerald-50/70 dark:bg-[#064E3B]/50 border border-emerald-200 dark:border-[#10B981]/40 hover:bg-emerald-100/70 dark:hover:bg-[#064E3B] rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Plus className="w-4 h-4" />
                              {isVi ? 'Thêm kích cỡ' : 'Add Size'}
                            </button>

                            {!variants.some((v) => v.name.toLowerCase() === 'large') && (
                              <button
                                type="button"
                                onClick={() => addVariant('Large', 'Lớn (L)', 4000)}
                                className="h-11 px-3 text-xs font-medium text-stone-600 dark:text-[#D5DFDA] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                              >
                                + {isVi ? 'Thêm nhanh cỡ Lớn (L)' : 'Quick Add Large'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </fieldset>
                  )}

                  {/* Packaging / Case Barcodes & Supplier for Packaged / Prepared Stock */}
                  {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                    <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                      <legend className="sr-only">
                        {isVi ? 'Đóng gói & Nhà cung cấp' : 'Packaging & Supplier'}
                      </legend>
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-100 dark:border-[#1F3028]">
                        <div className="flex items-center gap-1.5">
                          <Package className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                          <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {isVi
                              ? 'Nhà cung cấp & Mã vạch Thùng / Lốc'
                              : 'Supplier & Case / Pack Barcodes'}
                          </h3>
                          <InfoHint
                            compact
                            label={isVi ? 'Giải thích mã vạch thùng/lốc' : 'About case & pack barcodes'}
                            text={
                              isVi
                                ? 'Gắn mã vạch lốc 6 hoặc thùng 24 để khi quét trên POS hoặc nhập kho, hệ thống tự động nhân đúng số đơn vị.'
                                : 'Map 6-pack or 24-unit carton barcodes so scanning on POS or stock-in automatically multiplies quantity.'
                            }
                          />
                        </div>
                        <button
                          type="button"
                          onClick={addPackagingBarcode}
                          className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#064E3B]/50 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-4 h-4" />
                          {isVi ? 'Thêm mã thùng/lốc' : 'Add Pack / Case'}
                        </button>
                      </div>

                      <div>
                        <label
                          htmlFor="pf-supplier-step2"
                          className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                        >
                          {t.inventory.supplier}
                        </label>
                        <input
                          id="pf-supplier-step2"
                          type="text"
                          maxLength={100}
                          value={supplier}
                          onChange={(e) => setSupplier(e.target.value)}
                          placeholder={
                            isVi
                              ? 'VD: Đại lý nước giải khát Phnom Penh (tùy chọn)'
                              : 'e.g. Beverage Distributor (optional)'
                          }
                          className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        />
                      </div>

                      {packagingBarcodes.length === 0 ? (
                        <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                          {isVi
                            ? 'Chưa có mã vạch thùng/lốc. Bấm "Thêm mã thùng/lốc" nếu bạn nhập hoặc bán theo lốc/thùng.'
                            : 'No pack or carton barcodes added yet. Click "Add Pack / Case" if you buy or sell multi-unit cases.'}
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {packagingBarcodes.map((pb, idx) => (
                            <div
                              key={idx}
                              className="grid grid-cols-12 gap-2 items-center bg-stone-50/80 dark:bg-[#0F1814] p-2.5 border border-stone-200 dark:border-[#24352C] rounded-lg"
                            >
                              <input
                                type="text"
                                placeholder={isVi ? 'Mã vạch thùng/lốc' : 'Pack barcode'}
                                value={pb.barcode}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { barcode: e.target.value })
                                }
                                className="col-span-12 sm:col-span-4 h-11 px-3 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                              />
                              <input
                                type="text"
                                placeholder={isVi ? 'Tên gói (VD: Thùng 24)' : 'Label (e.g. Case 24)'}
                                value={pb.label}
                                onChange={(e) =>
                                  updatePackagingBarcode(idx, { label: e.target.value })
                                }
                                className="col-span-6 sm:col-span-4 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                className="col-span-3 sm:col-span-2 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                title={isVi ? 'Số đơn vị / gói' : 'Units per pack'}
                              />
                              <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setScannerTarget({ kind: 'pack', index: idx })}
                                  className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] rounded-lg"
                                  title={isVi ? 'Quét mã thùng' : 'Scan pack barcode'}
                                >
                                  <ScanBarcode className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePackagingBarcode(idx)}
                                  className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] rounded-lg"
                                  aria-label="Remove pack barcode"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </fieldset>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* STEP 3: RECIPE & STOCK (TAILORED BY ITEM TYPE)               */}
              {/* ============================================================ */}
              {currentStep === 3 && (
                <div className="space-y-5">
                  {/* MODE A: MADE-TO-ORDER (INGREDIENT RECIPE & MARGIN) */}
                  {productType === 'PREPARED_TO_ORDER' && (
                    <>
                      {/* Live Calculated Recipe Cost & Gross Margin Summary Card */}
                      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                          <div className="flex items-center gap-1.5">
                            <Utensils className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                            <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {isVi ? 'Tóm tắt giá vốn & biên lãi' : 'Recipe Cost & Gross Margin'}
                              {activeVariant ? ` · ${activeVariant.name}` : ''}
                            </h3>
                            <InfoHint
                              compact
                              label={isVi ? 'Giải thích trừ kho 3 cấp' : 'About 3-tier stock deduction'}
                              text={
                                isVi
                                  ? 'Với món Pha chế theo ly, mỗi lần bán trên POS sẽ tự động trừ nguyên liệu thô theo đúng định lượng công thức bạn gắn bên dưới.'
                                  : 'For Made-to-Order drinks, each POS sale automatically deducts the exact raw ingredient quantities below and records live COGS.'
                              }
                            />
                          </div>
                          <span className="text-xs text-stone-500 dark:text-[#94A39B]">
                            {t.productTypes.PREPARED_TO_ORDER}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                              {isVi ? 'Giá bán' : 'Selling Price'}
                            </span>
                            <span className="block font-mono-num text-base font-bold text-stone-900 dark:text-[#F1F5F3] mt-0.5">
                              {formatKhr(activeMtoPrice)}
                            </span>
                            <span className="block font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {formatUsdRef(activeMtoPrice, exchangeRate)}
                            </span>
                          </div>

                          <div>
                            <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                              {isVi ? 'Giá vốn công thức' : 'Calculated Recipe Cost'}
                            </span>
                            <span className="block font-mono-num text-base font-bold text-stone-900 dark:text-[#F1F5F3] mt-0.5">
                              {formatKhr(activeMtoCost)}
                            </span>
                            <span className="block text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {activeMtoRecipe.length}{' '}
                              {isVi ? 'nguyên liệu' : activeMtoRecipe.length === 1 ? 'ingredient' : 'ingredients'}
                            </span>
                          </div>

                          <div>
                            <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                              {t.products.grossMargin}
                            </span>
                            <span
                              className={`block font-mono-num text-base font-bold mt-0.5 ${
                                activeMtoProfit >= 0
                                  ? 'text-emerald-700 dark:text-[#34D399]'
                                  : 'text-red-700 dark:text-[#F87171]'
                              }`}
                            >
                              {formatKhr(activeMtoProfit)}
                            </span>
                            <span className="block font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {formatUsdRef(activeMtoProfit, exchangeRate)}
                            </span>
                          </div>

                          <div>
                            <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                              {isVi ? 'Tỷ suất lãi gộp' : 'Gross Margin %'}
                            </span>
                            <span
                              className={`block font-mono-num text-base font-bold mt-0.5 ${
                                activeMtoRecipe.length === 0
                                  ? 'text-stone-400 dark:text-[#94A39B]'
                                  : activeMtoMargin >= 0
                                    ? 'text-emerald-700 dark:text-[#34D399]'
                                    : 'text-red-700 dark:text-[#F87171]'
                              }`}
                            >
                              {activeMtoRecipe.length > 0 ? `${activeMtoMargin}%` : '—'}
                            </span>
                            <span className="block text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {activeMtoRecipe.length > 0
                                ? isVi
                                  ? 'Tính theo giá kho'
                                  : 'Based on stock cost'
                                : isVi
                                  ? 'Chưa có công thức'
                                  : 'Link recipe below'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Ingredient Recipe Mapping Card */}
                      <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                        <legend className="sr-only">{t.products.recipeSection}</legend>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {hasVariantsEnabled
                                ? isVi
                                  ? 'Định lượng nguyên liệu theo từng kích cỡ'
                                  : 'Ingredient Recipe per Size Variant'
                                : isVi
                                  ? 'Định lượng nguyên liệu cho 1 phần bán'
                                  : 'Ingredient Recipe per Serving'}
                            </h4>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {hasVariantsEnabled &&
                              activeVariantRecipeIdx > 0 &&
                              activeMtoRecipe.length === 0 &&
                              variants[0]?.recipe.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => copyFirstVariantRecipe(activeVariantRecipeIdx)}
                                  className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-stone-100 dark:bg-[#18251F] hover:bg-stone-200/80 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  {isVi
                                    ? `Chép từ ${variants[0].name}`
                                    : `Copy from ${variants[0].name}`}
                                </button>
                              )}
                            <button
                              type="button"
                              disabled={ingredients.length === 0}
                              onClick={() =>
                                hasVariantsEnabled
                                  ? addVariantRecipeRow(activeVariantRecipeIdx)
                                  : addRecipeRow()
                              }
                              className="h-11 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Plus className="w-4 h-4" />
                              {t.products.addIngredientRow}
                            </button>
                          </div>
                        </div>

                        {/* Size Variant Selector Tabs (when variants are enabled) */}
                        {hasVariantsEnabled && (
                          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-stone-100 dark:bg-[#0F1814] rounded-lg border border-stone-200 dark:border-[#24352C]">
                            {variants.map((v, idx) => {
                              const selected = idx === activeVariantRecipeIdx;
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  onClick={() => setActiveVariantRecipeIdx(idx)}
                                  className={`min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-2 ${
                                    selected
                                      ? 'bg-white dark:bg-[#18251F] text-[#0F5C43] dark:text-[#34D399] shadow-xs'
                                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                                  }`}
                                >
                                  <span>{v.name || `Size #${idx + 1}`}</span>
                                  <span className="font-mono-num text-[11px] opacity-75">
                                    ({v.recipe.length})
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {activeMtoRecipe.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-stone-300 dark:border-[#24352C] bg-stone-50/70 dark:bg-[#0F1814] px-5 py-7 text-center space-y-3">
                            <p className="text-sm font-semibold text-stone-800 dark:text-[#F1F5F3]">
                              {isVi
                                ? 'Chưa có nguyên liệu nào được gắn vào công thức'
                                : 'No ingredients linked to this recipe yet'}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] max-w-md mx-auto leading-relaxed">
                              {isVi
                                ? 'Gắn nguyên liệu thô (VD: cam tươi, đường, ly nhựa) giúp hệ thống tự động trừ tồn kho và tính lãi gộp chính xác sau mỗi đơn bán trên POS.'
                                : 'Linking raw ingredients (such as fresh fruit, syrup, or cups) enables automatic stock deduction and live gross margin tracking on every POS sale.'}
                            </p>
                            {ingredients.length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  hasVariantsEnabled
                                    ? addVariantRecipeRow(activeVariantRecipeIdx)
                                    : addRecipeRow()
                                }
                                className="h-11 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                                {isVi ? 'Thêm nguyên liệu đầu tiên' : 'Add First Ingredient'}
                              </button>
                            ) : (
                              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                                {isVi
                                  ? 'Hãy thêm nguyên liệu thô trong mục Kho hàng trước, sau đó quay lại gắn công thức bất cứ lúc nào.'
                                  : 'Add raw ingredients in Inventory first, then return here anytime to link them.'}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                              <span className="col-span-5">{isVi ? 'Nguyên liệu' : 'Ingredient'}</span>
                              <span className="col-span-2">{isVi ? 'Định lượng' : 'Qty / Cup'}</span>
                              <span className="col-span-2">{isVi ? 'Đơn vị' : 'Unit'}</span>
                              <span className="col-span-2 text-right">{isVi ? 'Chi phí' : 'Cost'}</span>
                              <span className="col-span-1" />
                            </div>
                            {activeMtoRecipe.map((row, index) => {
                              const chosenIng = ingMap.get(row.ingredientId);
                              const compatibleUnits = chosenIng
                                ? getCompatibleUnits(chosenIng.unit)
                                : (['pcs'] as IngredientUnit[]);
                              const rowCost = computeRowCostKhr(row);
                              return (
                                <div
                                  key={index}
                                  className="grid grid-cols-12 gap-2 items-center"
                                >
                                  <select
                                    value={row.ingredientId}
                                    onChange={(e) =>
                                      hasVariantsEnabled
                                        ? updateVariantRecipeRow(activeVariantRecipeIdx, index, {
                                            ingredientId: e.target.value,
                                          })
                                        : updateRecipeRow(index, { ingredientId: e.target.value })
                                    }
                                    className="col-span-12 sm:col-span-5 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                      hasVariantsEnabled
                                        ? updateVariantRecipeRow(activeVariantRecipeIdx, index, {
                                            quantity: Math.max(0, Number(e.target.value) || 0),
                                          })
                                        : updateRecipeRow(index, {
                                            quantity: Math.max(0, Number(e.target.value) || 0),
                                          })
                                    }
                                    className="col-span-4 sm:col-span-2 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                  />
                                  <select
                                    value={row.unit || chosenIng?.unit || 'pcs'}
                                    onChange={(e) =>
                                      hasVariantsEnabled
                                        ? updateVariantRecipeRow(activeVariantRecipeIdx, index, {
                                            unit: e.target.value as IngredientUnit,
                                          })
                                        : updateRecipeRow(index, {
                                            unit: e.target.value as IngredientUnit,
                                          })
                                    }
                                    className="col-span-4 sm:col-span-2 h-11 px-2 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                  >
                                    {compatibleUnits.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="col-span-3 sm:col-span-2 text-right font-mono-num text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] truncate">
                                    {formatKhr(rowCost)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      hasVariantsEnabled
                                        ? removeVariantRecipeRow(activeVariantRecipeIdx, index)
                                        : removeRecipeRow(index)
                                    }
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
                      </fieldset>
                    </>
                  )}

                  {/* MODE B: PACKAGED OR PREPARED STOCK (COST, STOCK, THRESHOLD, SUPPLIER/CASE) */}
                  {(productType === 'PACKAGED' || productType === 'PREPARED_STOCK') && (
                    <>
                      {/* Live Cost & Margin Summary Strip */}
                      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-stone-100 dark:border-[#1F3028]">
                          <div className="flex items-center gap-1.5">
                            <Package className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                            <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {isVi ? 'Giá vốn & Tồn kho trực tiếp' : 'Unit Cost & Stock Tracking'}
                            </h3>
                            <InfoHint
                              compact
                              label={isVi ? 'Giải thích trừ kho trực tiếp' : 'About direct stock deduction'}
                              text={
                                productType === 'PACKAGED'
                                  ? isVi
                                    ? 'Hàng đóng gói sẵn sẽ trừ trực tiếp số lượng tồn kho mỗi khi bán trên POS và cảnh báo khi xuống dưới mức tối thiểu.'
                                    : 'Packaged goods deduct directly from stock quantity on every POS sale and trigger low-stock alerts below your threshold.'
                                  : isVi
                                    ? 'Đồ uống pha sẵn trừ kho thành phẩm khi bán trên POS. Bạn có thể gắn thêm công thức pha mẻ bên dưới để tự trừ nguyên liệu khi bấm "Pha mẻ mới".'
                                    : 'Prepared stock deducts finished units on POS sales. Link an optional batch recipe below to deduct raw ingredients when running "Prepare Batch".'
                              }
                            />
                          </div>
                          <span className="font-mono-num text-xs font-semibold text-emerald-700 dark:text-[#34D399]">
                            {liveSellingPrice > 0
                              ? `${liveMarginPct}% ${isVi ? 'biên lãi' : 'margin'} · ${formatKhr(liveProfit)}`
                              : formatKhr(liveUnitCost)}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <label
                              htmlFor="pf-cost"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Giá vốn (KHR)' : 'Unit Cost (KHR)'}
                            </label>
                            <input
                              id="pf-cost"
                              type="number"
                              min={0}
                              step={100}
                              value={costPriceKhr}
                              onChange={(e) =>
                                handleCostOrMarkupChange(e.target.value, markupPercent)
                              }
                              className="w-full h-11 px-3 text-sm font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            />
                            <span className="block font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B] mt-1">
                              {formatUsdRef(Math.max(0, Number(costPriceKhr) || 0), exchangeRate)}
                            </span>
                          </div>

                          <div>
                            <label
                              htmlFor="pf-stock"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Số lượng tồn kho' : 'Current Stock Qty'}
                            </label>
                            <input
                              id="pf-stock"
                              type="number"
                              step="any"
                              value={stockQty}
                              onChange={(e) => setStockQty(e.target.value)}
                              className="w-full h-11 px-3 text-sm font-mono-num font-semibold border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="pf-reorder"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isVi ? 'Ngưỡng cảnh báo sắp hết' : 'Low-Stock Alert Threshold'}
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

                          <div>
                            <label
                              htmlFor="pf-unit"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                        </div>

                        {/* Supplier & Case Size Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 mt-4 pt-4 border-t border-stone-100 dark:border-[#1F3028]">
                          <div className="sm:col-span-7">
                            <label
                              htmlFor="pf-supplier"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
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
                              className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            />
                          </div>

                          <div className="sm:col-span-5">
                            <span className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                              {isVi ? 'Quy cách thùng / lốc' : 'Case / Pack Size'}
                            </span>
                            {packagingBarcodes.length > 0 ? (
                              <div className="h-11 px-3 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-stone-800 dark:text-[#F1F5F3] truncate">
                                  {packagingBarcodes[0].label} ({packagingBarcodes[0].unitsPerPack}{' '}
                                  {unit})
                                  {packagingBarcodes.length > 1
                                    ? ` +${packagingBarcodes.length - 1}`
                                    : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setCurrentStep(2)}
                                  className="text-[#0F5C43] dark:text-[#34D399] font-semibold hover:underline shrink-0"
                                >
                                  {isVi ? 'Sửa' : 'Edit'}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  addPackagingBarcode();
                                  setCurrentStep(2);
                                }}
                                className="w-full h-11 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                              >
                                <Plus className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                                {isVi ? 'Thêm quy cách thùng/lốc' : 'Add Case / Pack Size'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Optional Batch Prep Recipe for PREPARED_STOCK */}
                      {productType === 'PREPARED_STOCK' && (
                        <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-3.5">
                          <legend className="sr-only">
                            {isVi ? 'Công thức pha mẻ' : 'Batch Prep Recipe'}
                          </legend>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <h4 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                                  {isVi
                                    ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                                    : 'Batch Prep Recipe (optional · per 1 finished unit)'}
                                </h4>
                                <InfoHint
                                  compact
                                  label={isVi ? 'Giải thích công thức pha mẻ' : 'About batch prep recipe'}
                                  text={
                                    isVi
                                      ? 'Khi bạn bấm "Pha mẻ mới" trong Kho hàng, hệ thống tự động trừ nguyên liệu thô theo công thức này và cộng tồn kho thành phẩm.'
                                      : 'Automatically deducts raw ingredients when you run "Prepare Batch" in Inventory and adds finished units to stock.'
                                  }
                                />
                              </div>
                              {recipe.length > 0 && (
                                <span className="text-xs text-stone-500 dark:text-[#94A39B] block mt-0.5">
                                  {isVi ? 'Giá vốn công thức ước tính:' : 'Est. batch recipe cost:'}{' '}
                                  <strong className="font-mono-num text-stone-800 dark:text-[#F1F5F3]">
                                    {formatKhr(recipeCogs)}
                                  </strong>
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              disabled={ingredients.length === 0}
                              onClick={addRecipeRow}
                              className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#064E3B]/50 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Plus className="w-4 h-4" />
                              {t.products.addIngredientRow}
                            </button>
                          </div>

                          {recipe.length === 0 ? (
                            <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                              {isVi
                                ? 'Chưa gắn nguyên liệu pha mẻ. Bạn có thể bỏ qua hoặc thêm nguyên liệu nếu muốn trừ kho thô khi pha mẻ.'
                                : 'No batch ingredients linked yet. Optional — add ingredients if you want raw stock deducted when preparing batches.'}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {recipe.map((row, index) => {
                                const chosenIng = ingMap.get(row.ingredientId);
                                const compatibleUnits = chosenIng
                                  ? getCompatibleUnits(chosenIng.unit)
                                  : (['pcs'] as IngredientUnit[]);
                                const rowCost = computeRowCostKhr(row);
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
                                      className="col-span-12 sm:col-span-5 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
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
                                      className="col-span-4 sm:col-span-2 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                    />
                                    <select
                                      value={row.unit || chosenIng?.unit || 'pcs'}
                                      onChange={(e) =>
                                        updateRecipeRow(index, {
                                          unit: e.target.value as IngredientUnit,
                                        })
                                      }
                                      className="col-span-4 sm:col-span-2 h-11 px-2 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                    >
                                      {compatibleUnits.map((u) => (
                                        <option key={u} value={u}>
                                          {u}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="col-span-3 sm:col-span-2 text-right font-mono-num text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] truncate">
                                      {formatKhr(rowCost)}
                                    </span>
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
                        </fieldset>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Sticky Modal Footer (h-12 touch-friendly navigation & save) */}
            <div className="shrink-0 border-t border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-2.5">
              {/* Left Action: Cancel (Step 1) or Back (Steps 2 & 3) */}
              <div className="flex items-center gap-2">
                {currentStep === 1 ? (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-12 px-4 text-sm font-semibold text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                  >
                    {t.common.cancel}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleBackStep}
                    className="h-12 px-4 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-700 dark:text-[#D5DFDA] bg-stone-100/80 dark:bg-[#18251F] hover:bg-stone-200/70 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {isVi ? 'Quay lại' : 'Back'}
                  </button>
                )}
              </div>

              {/* Center Quiet Progress Readout (desktop) */}
              <div className="hidden md:flex items-center gap-2 text-xs text-stone-500 dark:text-[#94A39B] whitespace-nowrap">
                <span className="font-mono-num">
                  {isVi ? `Bước ${currentStep} / 3` : `Step ${currentStep} of 3`}
                </span>
                {liveSellingPrice > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num font-semibold text-stone-800 dark:text-[#F1F5F3]">
                      {formatKhr(liveSellingPrice)}
                    </span>
                  </>
                )}
              </div>

              {/* Right Action: Next Step or Save Product */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isEditing && currentStep < 3 && (
                  <button
                    type="button"
                    disabled={saving || barcodeConflicts.length > 0}
                    onClick={() => void handleSaveProduct('close')}
                    className="h-12 px-4 text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {saving ? (isVi ? 'Đang lưu...' : 'Saving...') : isVi ? 'Lưu ngay' : 'Save'}
                  </button>
                )}

                {currentStep === 1 && (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>{isVi ? 'Tiếp: Giá bán' : 'Next: Pricing'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {currentStep === 2 && (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>{isVi ? 'Tiếp: Công thức & Kho' : 'Next: Recipe & Stock'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {currentStep === 3 && (
                  <>
                    {!isEditing && (
                      <button
                        type="button"
                        disabled={saving || barcodeConflicts.length > 0}
                        onClick={() => void handleSaveProduct('add_another')}
                        className="h-12 px-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/80 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4 shrink-0" />
                        <span>{isVi ? 'Lưu & Thêm tiếp' : 'Save & Add Another'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving || barcodeConflicts.length > 0}
                      onClick={() => void handleSaveProduct('close')}
                      className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>
                        {isEditing
                          ? isVi
                            ? 'Lưu thay đổi'
                            : 'Save Product'
                          : isVi
                            ? 'Lưu sản phẩm'
                            : 'Save Product'}
                      </span>
                    </button>
                  </>
                )}
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
