import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Barcode,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CupSoda,
  Globe,
  HardDrive,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Package,
  PackagePlus,
  Pencil,
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
  PackOption,
  PackagingBarcode,
  Product,
  ProductCategory,
  ProductType,
  ProductVariant,
  RecipeItem,
  WorkspaceSettings,
} from '../types';
import {
  normalizeName,
  useStore,
  type SaveProductResult,
  type StoreContextValue,
} from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import {
  getCategoriesForScope,
  getCategoryDisplayName,
  resolveProductCategoryId,
} from '../utils/categories';
import {
  calculateRecipeCogs,
  convertUnitQty,
  formatKhr,
  formatQty,
  formatUsdRef,
  generateId,
  getCompatibleUnits,
} from '../utils/format';
import { getProductPackSizes } from '../utils/inventoryEngine';
import {
  detectBarcodeFormat,
  findDuplicateBarcodeConflicts,
  formatBarcodeTypeLabel,
  generateUniqueInternalSku,
  lookupOpenFoodFactsV3,
  normalizeBarcodeString,
} from '../utils/barcodeRegistry';
import { InfoHint } from './InfoHint';
import { ModalPortal } from './ModalPortal';
import { compressImageBlobToDataUrl } from '../utils/image';
import { DRINK_IMAGE_PRESETS } from '../utils/seedData';
import { ProductPhoto } from './ProductPhoto';
import { GoogleDrivePickerModal } from './GoogleDrivePickerModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { BarcodeLabelModal } from './BarcodeLabelModal';
import { CurrencyInput } from './CurrencyInput';

type WizardStep = 1 | 2 | 3;
type BuyMode = 'carton' | 'unit';
type StockEntryMode = 'carton' | 'pcs';

const NEW_CATEGORY_SENTINEL = '__new_category__';

const AccordionReveal: React.FC<{ open: boolean; children: React.ReactNode }> = ({
  open,
  children,
}) => (
  <div
    className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out motion-reduce:transition-none ${
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
    }`}
    aria-hidden={!open}
  >
    <div className={`overflow-hidden ${open ? 'visible' : 'invisible'}`}>{children}</div>
  </div>
);

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
        <div id={`${id}-panel`} className={`animate-drawer-in ${bodyClass}`}>
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
  onEditExisting?: (product: Product) => void;
  onRestockExisting?: (product: Product) => void;
  onEditExistingIngredient?: (ingredient: Ingredient) => void;
  onRestockExistingIngredient?: (ingredient: Ingredient) => void;
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
  onEditExisting,
  onRestockExisting,
  onEditExistingIngredient,
  onRestockExistingIngredient,
  onClose,
}) => {
  const isKm = settings.language === 'km';
  const khmerRe = /[\u1780-\u17FF]/;
  const displayLocalName = (primary: string, secondary?: string) =>
    isKm && secondary && khmerRe.test(secondary) ? secondary : primary;
  const [internalEditingProduct, setInternalEditingProduct] = useState<Product | null>(null);
  const activeEditingProduct = internalEditingProduct ?? editingProduct;
  const isEditing = Boolean(activeEditingProduct);
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
  const [manualPriceOverride, setManualPriceOverride] = useState(true);
  const [allowSingleUnitSale, setAllowSingleUnitSale] = useState(true);
  const [sellByCarton, setSellByCarton] = useState(false);
  const [buyMode, setBuyMode] = useState<BuyMode>('unit');
  const [stockEntryMode, setStockEntryMode] = useState<StockEntryMode>('pcs');
  const [stockCartonsInput, setStockCartonsInput] = useState('');
  const [priceKhr, setPriceKhr] = useState('8000');
  const [barcode, setBarcode] = useState('');
  const [barcodeSource, setBarcodeSource] = useState<BarcodeSource | undefined>(undefined);
  const [packSizes, setPackSizes] = useState<PackOption[]>([]);
  const [stockQty, setStockQty] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('12');
  const [unit, setUnit] = useState<IngredientUnit>('pcs');
  const [supplier, setSupplier] = useState('');
  const [imageUrl, setImageUrl] = useState(DRINK_IMAGE_PRESETS[0].url);
  const [active, setActive] = useState(true);
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  const [showSecondaryNaming, setShowSecondaryNaming] = useState(false);
  const buyModeTouchedRef = useRef(false);

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

  // Reset internal switch-to-edit override when modal closes or parent editingProduct changes
  useEffect(() => {
    setInternalEditingProduct(null);
  }, [open, editingProduct]);

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

    if (activeEditingProduct) {
      const existingPacks = getProductPackSizes(activeEditingProduct).map((pk) => ({
        ...pk,
        sellableOnPos: pk.sellableOnPos !== undefined ? Boolean(pk.sellableOnPos) : pk.priceKhr > 0,
      }));
      const hasSellablePack = existingPacks.some((pk) => pk.sellableOnPos !== false && pk.priceKhr > 0);
      const hasAnyPack = existingPacks.length > 0;

      setName(activeEditingProduct.name);
      setNameVi(activeEditingProduct.nameVi);
      setBrand(activeEditingProduct.brand || '');
      setProductType(activeEditingProduct.productType);
      setCategory(resolveProductCategoryId(activeEditingProduct, allCategories));
      setCostPriceKhr(String(activeEditingProduct.costPriceKhr ?? 0));
      setMarkupPercent(
        activeEditingProduct.markupPercent !== undefined
          ? String(activeEditingProduct.markupPercent)
          : ''
      );
      setManualPriceOverride(Boolean(activeEditingProduct.manualPriceOverride ?? true));
      setAllowSingleUnitSale(
        activeEditingProduct.productType === 'PACKAGED'
          ? activeEditingProduct.allowSingleUnitSale !== false
          : true
      );
      setSellByCarton(activeEditingProduct.productType === 'PACKAGED' && hasSellablePack);
      setBuyMode(
        activeEditingProduct.productType === 'PACKAGED' && hasAnyPack ? 'carton' : 'unit'
      );
      setStockEntryMode('pcs');
      setStockCartonsInput('');
      buyModeTouchedRef.current = activeEditingProduct.productType === 'PACKAGED';
      setPriceKhr(String(activeEditingProduct.priceKhr));
      setBarcode(activeEditingProduct.barcode || '');
      setBarcodeSource(undefined);
      setPackSizes(existingPacks);
      setStockQty(String(activeEditingProduct.stockQty ?? 0));
      setReorderLevel(String(activeEditingProduct.reorderLevel ?? 10));
      setUnit(activeEditingProduct.unit || 'pcs');
      setSupplier(activeEditingProduct.supplier || '');
      setImageUrl(activeEditingProduct.imageUrl || '');
      setActive(activeEditingProduct.active);
      setPhotoError('');
      const initialRecipe = (activeEditingProduct.recipe || []).map((r) => ({ ...r }));
      setRecipe(initialRecipe);
      setVariants(
        (activeEditingProduct.variants || []).map((v) => ({
          ...v,
          recipe: (v.recipe || []).map((r) => ({ ...r })),
        }))
      );

      const hasDistinctVi = Boolean(
        activeEditingProduct.nameVi &&
          activeEditingProduct.nameVi.trim() &&
          activeEditingProduct.nameVi.trim() !== activeEditingProduct.name.trim()
      );
      setShowSecondaryNaming(hasDistinctVi || Boolean(activeEditingProduct.brand));
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
      setManualPriceOverride(true);
      setAllowSingleUnitSale(true);
      setSellByCarton(false);
      setBuyMode('carton');
      setStockEntryMode('carton');
      setStockCartonsInput('');
      buyModeTouchedRef.current = false;
      setPriceKhr(hasScannedInit ? '' : '8000');
      setBarcode(cleanInitCode);
      setBarcodeSource(initialPrefill ? 'open_food_facts' : undefined);
      setPackSizes([]);
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
    activeEditingProduct,
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

  // Real-time duplicate active barcode validation across products, variants, cartons, and ingredients
  const activePacksForValidation = useMemo(
    () => (productType === 'PACKAGED' && (sellByCarton || buyMode === 'carton') ? packSizes : []),
    [productType, sellByCarton, buyMode, packSizes]
  );

  const barcodeConflicts = useMemo(
    () =>
      findDuplicateBarcodeConflicts(
        {
          id: activeEditingProduct?.id,
          itemType: 'product',
          name: name.trim() || activeEditingProduct?.name || 'This product',
          barcode,
          variants: productType === 'PREPARED_TO_ORDER' ? variants : [],
          packSizes: activePacksForValidation,
        },
        existingProducts,
        barcodeRegistry,
        ingredients
      ),
    [
      activeEditingProduct,
      name,
      barcode,
      productType,
      variants,
      activePacksForValidation,
      existingProducts,
      barcodeRegistry,
      ingredients,
    ]
  );

  const unitBarcodeConflicts = useMemo(() => {
    const cleanUnit = normalizeBarcodeString(barcode);
    if (!cleanUnit) return [];
    return barcodeConflicts.filter((c) => c.code === cleanUnit);
  }, [barcode, barcodeConflicts]);

  // Real-time canonical normalized-name & barcode duplicate guard
  const duplicateGuard = useMemo<
    | { kind: 'product'; product: Product; reason: 'name' | 'barcode'; matchedCode?: string }
    | { kind: 'ingredient'; ingredient: Ingredient; reason: 'name' | 'barcode'; matchedCode?: string }
    | null
  >(() => {
    const normInput = normalizeName(name);
    if (normInput && active) {
      const matchedProduct = existingProducts.find(
        (p) =>
          p.id !== activeEditingProduct?.id &&
          p.active &&
          normalizeName(p.name) === normInput
      );
      if (matchedProduct) {
        return { kind: 'product', product: matchedProduct, reason: 'name' };
      }
      if (productType !== 'PREPARED_TO_ORDER') {
        const matchedIng = ingredients.find((i) => normalizeName(i.name) === normInput);
        if (matchedIng) {
          return { kind: 'ingredient', ingredient: matchedIng, reason: 'name' };
        }
      }
    }

    const externalBarcodeConflict = unitBarcodeConflicts.find((c) => !c.isInternalDuplicate);
    if (externalBarcodeConflict) {
      if (
        externalBarcodeConflict.existingItemType === 'ingredient' &&
        externalBarcodeConflict.existingIngredientId
      ) {
        const matchedIngredient = ingredients.find(
          (i) => i.id === externalBarcodeConflict.existingIngredientId
        );
        if (matchedIngredient) {
          return {
            kind: 'ingredient',
            ingredient: matchedIngredient,
            reason: 'barcode',
            matchedCode: externalBarcodeConflict.code,
          };
        }
      } else {
        const matchedProduct = existingProducts.find(
          (p) => p.id === externalBarcodeConflict.existingProductId
        );
        if (matchedProduct) {
          return {
            kind: 'product',
            product: matchedProduct,
            reason: 'barcode',
            matchedCode: externalBarcodeConflict.code,
          };
        }
      }
    }

    return null;
  }, [
    name,
    active,
    productType,
    existingProducts,
    ingredients,
    activeEditingProduct,
    unitBarcodeConflicts,
  ]);

  const detectedUnitFormat = useMemo(
    () => (barcode.trim() ? detectBarcodeFormat(barcode) : null),
    [barcode]
  );

  const recipeCogs = useMemo(
    () => Math.round(calculateRecipeCogs(recipe, ingredients)),
    [recipe, ingredients]
  );

  const unitCostKhr = Math.max(0, Number(costPriceKhr) || 0);
  const basePriceNum = Math.max(0, Number(priceKhr) || 0);

  // Primary carton live state (synced across Step 2 Selling & Step 3 Buying)
  const primaryPack = packSizes[0] ?? null;
  const cartonLabel = primaryPack?.label ?? '';
  const cartonUnits = Math.max(1, Math.round(Number(primaryPack?.unitsPerPack) || 24));
  const cartonSellingPriceKhr = Math.max(0, Number(primaryPack?.priceKhr) || 0);
  const cartonCostKhr = Math.max(0, Number(primaryPack?.costKhr) || 0);
  const cartonBarcode = primaryPack?.barcode ?? '';
  const unitLabel = unit || 'pcs';

  const suggestedUnitCostKhr =
    cartonCostKhr > 0 && cartonUnits > 0 ? Math.round(cartonCostKhr / cartonUnits) : 0;

  const liveUnitCost = useMemo(() => {
    if (productType === 'PREPARED_TO_ORDER') {
      if (variants.length > 0) {
        const target = variants[activeVariantRecipeIdx] || variants[0];
        return Math.round(calculateRecipeCogs(target.recipe, ingredients));
      }
      return recipeCogs;
    }
    return unitCostKhr;
  }, [
    productType,
    variants,
    activeVariantRecipeIdx,
    ingredients,
    recipeCogs,
    unitCostKhr,
  ]);

  const liveSellingPrice = useMemo(() => {
    if (productType === 'PREPARED_TO_ORDER' && variants.length > 0) {
      const target = variants[activeVariantRecipeIdx] || variants[0];
      return Math.max(0, Number(target.priceKhr) || 0);
    }
    if (productType === 'PACKAGED' && !allowSingleUnitSale && sellByCarton) {
      return cartonSellingPriceKhr;
    }
    return basePriceNum;
  }, [
    productType,
    variants,
    activeVariantRecipeIdx,
    allowSingleUnitSale,
    sellByCarton,
    cartonSellingPriceKhr,
    basePriceNum,
  ]);

  // Direct live margin calculations bound to unitCostKhr & cartonCostKhr
  const unitProfitKhr = basePriceNum - unitCostKhr;
  const unitMarginPct =
    basePriceNum > 0 ? Math.round((unitProfitKhr / basePriceNum) * 100) : 0;
  const hasLiveUnitMargin = allowSingleUnitSale && basePriceNum > 0 && unitCostKhr > 0;

  const cartonProfitKhr = cartonSellingPriceKhr - cartonCostKhr;
  const cartonMarginPct =
    cartonSellingPriceKhr > 0 ? Math.round((cartonProfitKhr / cartonSellingPriceKhr) * 100) : 0;
  const hasLiveCartonMargin = sellByCarton && cartonSellingPriceKhr > 0 && cartonCostKhr > 0;

  const stockQtyNum = Math.max(0, Number(stockQty) || 0);
  const hasVariantsEnabled = productType === 'PREPARED_TO_ORDER' && variants.length > 0;

  const draftProductForLabels = useMemo<Product>(
    () => ({
      id: editingProduct?.id || 'draft',
      name: name.trim() || (isKm ? 'ផលិតផលថ្មី' : 'New Product'),
      nameVi: nameVi.trim() || name.trim() || 'ផលិតផលថ្មី',
      brand: brand.trim(),
      category,
      productType,
      priceKhr: liveSellingPrice,
      costPriceKhr: liveUnitCost,
      allowSingleUnitSale: productType === 'PACKAGED' ? allowSingleUnitSale : true,
      imageUrl,
      active,
      barcode: normalizeBarcodeString(barcode),
      packSizes,
      packagingBarcodes: packSizes
        .filter((pk) => Boolean(pk.barcode?.trim()))
        .map((pk) => ({
          id: pk.id,
          barcode: pk.barcode!.trim(),
          label: pk.label,
          unitsPerPack: pk.unitsPerPack,
          costKhr: pk.costKhr,
          priceKhr: pk.priceKhr,
        })),
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
      allowSingleUnitSale,
      imageUrl,
      active,
      barcode,
      packSizes,
      stockQty,
      reorderLevel,
      unit,
      supplier,
      recipe,
      variants,
      isKm,
    ]
  );

  if (!open) return null;

  const validateStep = (step: WizardStep): string | null => {
    if (step === 1) {
      if (!name.trim()) {
        return isKm
          ? 'សូមបញ្ចូលឈ្មោះផលិតផលមុនពេលបន្ត។'
          : 'Please enter a product name before continuing.';
      }
      if (!category) {
        return isKm ? 'សូមជ្រើសរើសប្រភេទផលិតផល។' : 'Please select a product category.';
      }
      if (duplicateGuard) {
        const existingName =
          duplicateGuard.kind === 'product'
            ? displayLocalName(duplicateGuard.product.name, duplicateGuard.product.nameVi)
            : displayLocalName(duplicateGuard.ingredient.name, duplicateGuard.ingredient.nameVi);
        return isKm
          ? `"${existingName}" មានរួចហើយ។ សូមកែប្រែ ឬបញ្ចូលស្តុកបន្ថែមជំនួសវិញ។`
          : `"${existingName}" already exists. Edit or restock the existing item instead.`;
      }
      if (unitBarcodeConflicts.length > 0) {
        const first = unitBarcodeConflicts[0];
        return first.isInternalDuplicate
          ? isKm
            ? `បាកូដ "${first.code}" ត្រូវបានបញ្ចូលស្ទួនលើផលិតផលនេះ។`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isKm
            ? `បាកូដ "${first.code}" ត្រូវបានប្រើសម្រាប់ "${first.existingProductName}" រួចហើយ។`
            : `Barcode "${first.code}" is already assigned to "${first.existingProductName}".`;
      }
      return null;
    }

    if (step === 2) {
      if (productType === 'PREPARED_TO_ORDER' && variants.length > 0) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          if (!v.name.trim()) {
            return isKm
              ? `សូមបញ្ចូលឈ្មោះទំហំសម្រាប់ជួរទី ${i + 1}។`
              : `Please enter a size name for variant #${i + 1}.`;
          }
          if (!Number.isFinite(Number(v.priceKhr)) || Number(v.priceKhr) <= 0) {
            return isKm
              ? `សូមបញ្ចូលតម្លៃលក់ (> 0 រៀល) សម្រាប់ "${v.name.trim()}"។`
              : `Please enter a valid selling price (> 0 KHR) for "${v.name.trim()}".`;
          }
        }
      } else if (productType === 'PACKAGED') {
        if (!allowSingleUnitSale && !sellByCarton) {
          return isKm
            ? 'សូមបើកជម្រើសលក់យ៉ាងហោចណាស់ ១ (លក់រាយ ឬ លក់ជាកេស)។'
            : 'Enable at least one selling option (Single Unit or Carton / Pack).';
        }
        if (allowSingleUnitSale) {
          const parsed = Number(priceKhr);
          if (priceKhr.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
            return isKm
              ? 'សូមបញ្ចូលតម្លៃលក់រាយធំជាង 0 ៛។'
              : 'Enter a single-unit selling price greater than 0.';
          }
        }
        if (sellByCarton) {
          if (cartonUnits < 1) {
            return isKm
              ? 'ចំនួនក្នុង ១ កេសត្រូវតែធំជាង ឬស្មើ ១។'
              : 'Units per carton must be at least 1.';
          }
          if (cartonSellingPriceKhr <= 0) {
            return isKm
              ? 'សូមបញ្ចូលតម្លៃលក់កេសធំជាង 0 ៛។'
              : 'Enter a carton selling price greater than 0.';
          }
        }
      } else {
        const parsed = Number(priceKhr);
        if (priceKhr.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
          return isKm
            ? 'សូមបញ្ចូលតម្លៃលក់ (KHR) ធំជាង 0 មុនពេលបន្ត។'
            : 'Please enter a selling price in KHR greater than 0 before continuing.';
        }
      }

      if (barcodeConflicts.length > 0) {
        const first = barcodeConflicts[0];
        return first.isInternalDuplicate
          ? isKm
            ? `បាកូដ "${first.code}" ស្ទួនគ្នាក្នុងផលិតផលតែមួយ។`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isKm
            ? `បាកូដ "${first.code}" ត្រូវបានភ្ជាប់ទៅ "${first.existingProductName}" រួចហើយ។`
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

    // When editing an existing product, allow jumping freely unless a duplicate conflict exists
    if (isEditing) {
      if (duplicateGuard) {
        setStepError(validateStep(1) || '');
        return;
      }
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
    const mustValidate =
      !isEditing ||
      Boolean(duplicateGuard) ||
      (currentStep === 2 && productType === 'PACKAGED');
    if (mustValidate) {
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

  const handleSwitchToEditExisting = () => {
    if (!duplicateGuard) return;
    if (duplicateGuard.kind === 'product') {
      const target = duplicateGuard.product;
      if (onEditExisting) {
        onEditExisting(target);
      } else {
        setInternalEditingProduct(target);
      }
      setStepError('');
      setSaveError('');
      showNoticeToast({
        message: isKm
          ? `បានប្ដូរទៅកែប្រែ "${displayLocalName(target.name, target.nameVi)}"`
          : `Switched to editing "${target.name}"`,
        detail:
          target.productType === 'PREPARED_TO_ORDER'
            ? isKm
              ? 'បើកជំហានទី ២ ដើម្បីបន្ថែម ឬកែប្រែទំហំកែវ។'
              : 'Open Step 2 to add or update size variants.'
            : undefined,
      });
    } else if (onEditExistingIngredient) {
      onClose();
      onEditExistingIngredient(duplicateGuard.ingredient);
    }
  };

  const handleRestockExisting = () => {
    if (!duplicateGuard) return;
    if (duplicateGuard.kind === 'product' && onRestockExisting) {
      onClose();
      onRestockExisting(duplicateGuard.product);
    } else if (duplicateGuard.kind === 'ingredient' && onRestockExistingIngredient) {
      onClose();
      onRestockExistingIngredient(duplicateGuard.ingredient);
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
    } else {
      setAllowSingleUnitSale(true);
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
          res.error || (isKm ? 'មិនអាចបង្កើតប្រភេទបានទេ។' : 'Could not create category.')
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

  // Primary carton helpers (100% manual cost & price — never auto-overwrite)
  const updatePrimaryPack = (patch: Partial<PackOption>) => {
    setPackSizes((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: generateId('pack'),
            label: 'Carton',
            unitsPerPack: 24,
            costKhr: 0,
            priceKhr: 0,
            sellableOnPos: sellByCarton,
            barcode: '',
            ...patch,
          },
        ];
      }
      return prev.map((pk, idx) => (idx === 0 ? { ...pk, ...patch } : pk));
    });
    if (stepError) setStepError('');
    if (saveError) setSaveError('');
  };

  const handleToggleSellSingleUnit = () => {
    setAllowSingleUnitSale((prev) => !prev);
    if (stepError) setStepError('');
    if (saveError) setSaveError('');
  };

  const handleToggleSellByCarton = () => {
    const next = !sellByCarton;
    setSellByCarton(next);
    if (next) {
      setPackSizes((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: generateId('pack'),
              label: 'Carton',
              unitsPerPack: 24,
              costKhr: 0,
              priceKhr: 0,
              sellableOnPos: true,
              barcode: '',
            },
          ];
        }
        return prev.map((pk, idx) => (idx === 0 ? { ...pk, sellableOnPos: true } : pk));
      });
      if (!buyModeTouchedRef.current) {
        setBuyMode('carton');
      }
    } else {
      setPackSizes((prev) =>
        prev.map((pk, idx) => (idx === 0 ? { ...pk, sellableOnPos: false } : pk))
      );
    }
    if (stepError) setStepError('');
    if (saveError) setSaveError('');
  };

  const handleSelectBuyMode = (nextMode: BuyMode) => {
    buyModeTouchedRef.current = true;
    setBuyMode(nextMode);
    if (nextMode === 'carton') {
      setPackSizes((prev) =>
        prev.length === 0
          ? [
              {
                id: generateId('pack'),
                label: 'Carton',
                unitsPerPack: 24,
                costKhr: 0,
                priceKhr: 0,
                sellableOnPos: sellByCarton,
                barcode: '',
              },
            ]
          : prev
      );
    } else {
      setStockEntryMode('pcs');
    }
  };

  const handleStockEntryModeSwitch = (nextMode: StockEntryMode) => {
    if (nextMode === stockEntryMode) return;
    setStockEntryMode(nextMode);
    if (nextMode === 'carton') {
      const currentPcs = Math.max(0, Number(stockQty) || 0);
      const cartons = cartonUnits > 0 ? currentPcs / cartonUnits : 0;
      const cleanCartons = Math.round(cartons * 100) / 100;
      setStockCartonsInput(cleanCartons > 0 ? String(cleanCartons) : '');
    }
  };

  const handleStockCartonsChange = (raw: string) => {
    const cleaned = raw.replace(/[\u17E0-\u17E9]/g, (ch) =>
      String(ch.charCodeAt(0) - 0x17e0)
    );
    if (!/^\d*\.?\d*$/.test(cleaned)) return;
    setStockCartonsInput(cleaned);
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStockQty('0');
      return;
    }
    const basePcs = Math.round(parsed * cartonUnits * 100) / 100;
    setStockQty(String(basePcs));
  };

  const handleCartonUnitsChange = (nextUnitsRaw: string) => {
    const parsed = Math.max(1, Math.round(Number(nextUnitsRaw) || 1));
    updatePrimaryPack({ unitsPerPack: parsed });
    if (buyMode === 'carton' && stockEntryMode === 'carton') {
      const c = parseFloat(stockCartonsInput);
      if (Number.isFinite(c) && c > 0) {
        setStockQty(String(Math.round(c * parsed * 100) / 100));
      }
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
          ? isKm
            ? `បាកូដ "${first.code}" ត្រូវបានបញ្ចូលស្ទួនលើផលិតផលនេះ។`
            : `Barcode "${first.code}" is entered more than once on this product.`
          : isKm
            ? `បាកូដ "${first.code}" ត្រូវបានប្រើសម្រាប់ "${first.existingProductName}" រួចហើយ។`
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

    const effectiveCost = Math.max(0, Number(costPriceKhr) || 0);

    const cleanUnitBarcode = normalizeBarcodeString(barcode);
    const shouldPersistCarton = productType === 'PACKAGED' && (sellByCarton || buyMode === 'carton');
    const sourcePacksForSave: PackOption[] = shouldPersistCarton
      ? packSizes.length > 0
        ? packSizes
        : [
            {
              id: generateId('pack'),
              label: 'Carton',
              unitsPerPack: cartonUnits,
              costKhr: cartonCostKhr,
              priceKhr: sellByCarton ? cartonSellingPriceKhr : 0,
              sellableOnPos: sellByCarton,
              barcode: cartonBarcode,
            },
          ]
      : [];

    const cleanPackSizes: PackOption[] = sourcePacksForSave
      .map((pk, idx) => {
        const units = Math.max(1, Math.round(Number(pk.unitsPerPack) || 1));
        const bc = normalizeBarcodeString(pk.barcode);
        const isRowSellable = idx === 0 ? sellByCarton : pk.sellableOnPos !== false;
        const packPrice = isRowSellable ? Math.max(0, Math.round(Number(pk.priceKhr) || 0)) : 0;
        return {
          id: pk.id?.trim() || generateId(`pack_${idx}`),
          label: pk.label.trim() || 'Carton',
          unitsPerPack: units,
          costKhr: Math.max(0, Math.round(Number(pk.costKhr) || 0)),
          priceKhr: packPrice,
          sellableOnPos: isRowSellable,
          ...(bc ? { barcode: bc } : {}),
        };
      })
      .filter((pk) => pk.unitsPerPack >= 1);

    if (productType === 'PACKAGED' && !allowSingleUnitSale) {
      const hasSellablePack = cleanPackSizes.some(
        (pk) => pk.sellableOnPos !== false && pk.priceKhr > 0
      );
      if (!hasSellablePack) {
        setCurrentStep(2);
        setSaveError(
          isKm
            ? 'ទំនិញលក់តែជាកេសត្រូវបើកការលក់ជាកេស និងមានតម្លៃលក់ធំជាង 0 ៛។'
            : 'Carton-only products require Sell by Carton enabled with a selling price greater than 0.'
        );
        return;
      }
    }

    const cleanPackBarcodes: PackagingBarcode[] = cleanPackSizes
      .filter((pk) => Boolean(pk.barcode))
      .map((pk) => ({
        id: pk.id,
        barcode: pk.barcode!,
        label: pk.label,
        unitsPerPack: pk.unitsPerPack,
        costKhr: pk.costKhr,
        priceKhr: pk.priceKhr,
        sellableOnPos: pk.sellableOnPos,
      }));

    const trimmedName = name.trim();
    setSaving(true);
    try {
      const result = await onSave({
        id: activeEditingProduct?.id,
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
        allowSingleUnitSale: productType === 'PACKAGED' ? allowSingleUnitSale : true,
        imageUrl,
        active,
        barcode: cleanUnitBarcode,
        barcodeSource,
        packSizes: cleanPackSizes,
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
          message: isKm ? `បានរក្សាទុក "${trimmedName}"` : `Saved "${trimmedName}"`,
          detail: isKm ? 'រួចរាល់សម្រាប់បន្ថែមផលិតផលបន្ទាប់' : 'Ready for next product',
        });
        // Reset per-product fields while keeping smart defaults (productType, category, unit, reorderLevel, supplier, active)
        setName('');
        setNameVi('');
        setBrand('');
        setBarcode('');
        setBarcodeSource(undefined);
        setPackSizes([]);
        setStockQty('0');
        setStockCartonsInput('');
        setStockEntryMode('carton');
        setBuyMode('carton');
        buyModeTouchedRef.current = false;
        setCostPriceKhr('0');
        setMarkupPercent('');
        setManualPriceOverride(true);
        setAllowSingleUnitSale(true);
        setSellByCarton(false);
        setPriceKhr(productType === 'PACKAGED' ? '' : '8000');
        setImageUrl(DRINK_IMAGE_PRESETS[0].url);
        setPhotoError('');
        setRecipe([]);
        setVariants([]);
        setActiveVariantRecipeIdx(0);
        setShowSecondaryNaming(false);
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

  const updatePackOption = (index: number, patch: Partial<PackOption>) => {
    setPackSizes((prev) => {
      if (index === 0 && prev.length === 0) {
        return [
          {
            id: generateId('pack'),
            label: 'Carton',
            unitsPerPack: 24,
            costKhr: 0,
            priceKhr: 0,
            sellableOnPos: sellByCarton,
            barcode: '',
            ...patch,
          },
        ];
      }
      return prev.map((pk, idx) => (idx === index ? { ...pk, ...patch } : pk));
    });
    setStepError('');
    setSaveError('');
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
      updatePackOption(scannerTarget.index, { barcode: code });
    } else if (scannerTarget.kind === 'variant') {
      updateVariant(scannerTarget.index, { barcode: code });
    }
    setScannerTarget(null);
  };

  const handleAutoGenerateSku = () => {
    const extraCodes = [
      barcode,
      ...packSizes.map((pk) => pk.barcode || ''),
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
          isKm
            ? 'រកមិនឃើញនៅលើ Open Food Facts — សូមបញ្ចូលព័ត៌មានផលិតផលដោយដៃខាងលើ។'
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
        isKm
          ? `បានបំពេញព័ត៌មាន "${prefill.name}" ពី Open Food Facts។ សូមបញ្ចូលតម្លៃលក់ KHR នៅជំហានទី ២។`
          : `Prefilled "${prefill.name}" from Open Food Facts. Enter your local KHR price in Step 2.`
      );
    } finally {
      setLookingUpExternal(false);
    }
  };

  const hasAnyLabelableCode = Boolean(
    barcode.trim() ||
      variants.some((v) => v.barcode?.trim()) ||
      packSizes.some((pk) => pk.barcode?.trim())
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
      shortLabel: isKm ? 'ព័ត៌មាន' : 'Basic Info',
      fullLabel: isKm ? 'ព័ត៌មាន និងរូបភាព' : 'Basic Info',
    },
    {
      step: 2,
      shortLabel: isKm ? 'តម្លៃ' : 'Pricing',
      fullLabel:
        productType === 'PACKAGED'
          ? isKm
            ? 'តម្លៃលក់'
            : 'Pricing'
          : isKm
            ? 'តម្លៃ និងទំហំ'
            : 'Pricing & Variants',
    },
    {
      step: 3,
      shortLabel:
        productType === 'PACKAGED'
          ? isKm
            ? 'ថ្លៃដើម/ស្តុក'
            : 'Cost & Stock'
          : isKm
            ? 'រូបមន្ត/ស្តុក'
            : 'Recipe & Stock',
      fullLabel:
        productType === 'PREPARED_TO_ORDER'
          ? isKm
            ? 'រូបមន្ត និងថ្លៃដើម'
            : 'Recipe & Stock'
          : isKm
            ? 'ថ្លៃដើម និងស្តុក'
            : 'Cost & Stock',
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
      <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-form-modal-title"
            className="w-full max-w-4xl bg-[#F6F7F5] dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl animate-modal"
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
                    label={isKm ? 'អំពីការបន្ថែមផលិតផល ៣ ជំហាន' : 'About 3-step product wizard'}
                    text={
                      isKm
                        ? isEditing
                          ? 'អ្នកអាចចុចលើជំហានណាមួយខាងក្រោមដើម្បីកែប្រែបានភ្លាមៗ។'
                          : 'បំពេញតាម ៣ ជំហាន៖ ព័ត៌មានមូលដ្ឋាន តម្លៃលក់ និងរូបមន្ត/ស្តុក។'
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
              aria-label={isKm ? 'ជំហានកំណត់ផលិតផល' : 'Product setup steps'}
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
            <div
              ref={scrollBodyRef}
              className={`flex-1 overflow-y-auto space-y-5 ${
                productType === 'PACKAGED' && (currentStep === 2 || currentStep === 3)
                  ? 'bg-white dark:bg-[#111A16] px-5 sm:px-7 py-6'
                  : 'p-4 sm:p-6'
              }`}
            >
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
                        (isKm
                          ? 'រកឃើញបាកូដស្ទួនដែលកំពុងប្រើប្រាស់'
                          : 'Duplicate active barcode detected')}
                    </p>
                    {!stepError &&
                      barcodeConflicts.map((c, idx) => (
                        <p key={`${c.code}-${idx}`} className="font-mono-num">
                          {c.isInternalDuplicate
                            ? isKm
                              ? `កូដ "${c.code}" ត្រូវបានបញ្ចូលស្ទួនលើផលិតផលនេះ។`
                              : `"${c.code}" is entered more than once on this product.`
                            : isKm
                              ? `កូដ "${c.code}" ត្រូវបានប្រើសម្រាប់ "${c.existingProductName}"${
                                  c.existingVariantName ? ` (${c.existingVariantName})` : ''
                                } រួចហើយ។`
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
                            ? isKm
                              ? 'បានបំពេញព័ត៌មានផលិតផលពី Open Food Facts'
                              : 'Product details prefilled from Open Food Facts'
                            : isKm
                              ? `ចុះឈ្មោះផលិតផលថ្មីសម្រាប់បាកូដ ${barcode}`
                              : `Registering new product for barcode ${barcode}`}
                        </p>
                        <p className="text-stone-600 dark:text-[#D5DFDA]">
                          {prefillBanner === 'off_prefill'
                            ? isKm
                              ? 'បានបំពេញតែឈ្មោះ ម៉ាក និងប្រភេទប៉ុណ្ណោះ។ សូមបញ្ចូលតម្លៃលក់ KHR នៅជំហានទី ២ និងស្តុកនៅជំហានទី ៣។'
                              : 'Only name, brand, and category were prefilled. Enter your selling price in Step 2 and stock in Step 3.'
                            : isKm
                              ? 'រកមិនឃើញក្នុងបញ្ជីខាងក្រៅ — សូមបញ្ចូលព័ត៌មានខាងក្រោម រួចកំណត់តម្លៃ និងស្តុកនៅជំហានបន្ទាប់។'
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
                        {isKm ? 'ព័ត៌មានមូលដ្ឋាន' : 'Basic Information'}
                      </legend>

                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                          <div className="sm:col-span-7">
                            <label
                              htmlFor="pf-name"
                              className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isKm ? 'ឈ្មោះផលិតផល' : 'Product Name'} *
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
                                isKm
                                  ? 'ឧ. ទឹកក្រូចស្រស់, Dasani 500ml'
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
                                  {getCategoryDisplayName(c, isKm)}
                                </option>
                              ))}
                              <option value={NEW_CATEGORY_SENTINEL}>
                                {isKm ? '+ បង្កើតប្រភេទថ្មី...' : '+ New Category...'}
                              </option>
                            </select>

                            {creatingCategory && (
                              <div className="animate-drawer-in mt-2 p-2.5 rounded-lg bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] space-y-2">
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
                                    placeholder={isKm ? 'ឈ្មោះប្រភេទថ្មី...' : 'New category name...'}
                                    autoFocus
                                    className="flex-1 min-w-0 h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3]"
                                  />
                                  <button
                                    type="button"
                                    disabled={!inlineCategoryName.trim() || inlineCategoryBusy}
                                    onClick={() => void handleCreateInlineCategory()}
                                    className="h-11 px-3 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] disabled:opacity-50 rounded-lg shrink-0"
                                  >
                                    {isKm ? 'បន្ថែម' : 'Add'}
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

                        {/* Live Duplicate Protection Warning Banner */}
                        {duplicateGuard && (
                          <div
                            role="alert"
                            className="p-3.5 rounded-xl border border-amber-300/90 dark:border-amber-500/45 bg-amber-50/90 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 space-y-2.5 animate-drawer-in"
                          >
                            <div className="flex items-start gap-2.5">
                              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <p className="text-xs sm:text-[13px] font-bold text-amber-950 dark:text-amber-100">
                                  {isKm
                                    ? `"${
                                        duplicateGuard.kind === 'product'
                                          ? displayLocalName(
                                              duplicateGuard.product.name,
                                              duplicateGuard.product.nameVi
                                            )
                                          : displayLocalName(
                                              duplicateGuard.ingredient.name,
                                              duplicateGuard.ingredient.nameVi
                                            )
                                      }" មានរួចហើយ`
                                    : `"${
                                        duplicateGuard.kind === 'product'
                                          ? duplicateGuard.product.name
                                          : duplicateGuard.ingredient.name
                                      }" already exists`}
                                </p>
                                <p className="text-[11px] text-amber-900/85 dark:text-amber-200/85 leading-relaxed">
                                  {duplicateGuard.kind === 'product' ? (
                                    duplicateGuard.reason === 'barcode' ? (
                                      isKm ? (
                                        `បាកូដ ${duplicateGuard.matchedCode} ត្រូវបានភ្ជាប់ទៅទំនិញនេះរួចហើយ។ សូមកែប្រែ ឬបញ្ចូលស្តុកបន្ថែមជំនួសការបង្កើតស្ទួន។`
                                      ) : (
                                        `Barcode ${duplicateGuard.matchedCode} is already assigned to this item. Edit or restock it instead of creating a duplicate.`
                                      )
                                    ) : duplicateGuard.product.productType === 'PREPARED_TO_ORDER' ? (
                                      isKm ? (
                                        `${t.productTypes[duplicateGuard.product.productType]}${
                                          duplicateGuard.product.variants.length > 0
                                            ? ` · ${duplicateGuard.product.variants.length} ទំហំ`
                                            : ''
                                        } — ចង់បន្ថែមទំហំថ្មី? សូមកែប្រែផលិតផលដែលមានស្រាប់ជំនួសការបង្កើតស្ទួន។`
                                      ) : (
                                        `${t.productTypes[duplicateGuard.product.productType]}${
                                          duplicateGuard.product.variants.length > 0
                                            ? ` · ${duplicateGuard.product.variants.length} size variants`
                                            : ''
                                        } — Adding a new size? Edit the existing item instead of duplicating.`
                                      )
                                    ) : isKm ? (
                                      `${t.productTypes[duplicateGuard.product.productType]} · ស្តុកបច្ចុប្បន្ន ${formatQty(
                                        duplicateGuard.product.stockQty,
                                        duplicateGuard.product.unit
                                      )} — កែប្រែ ឬបញ្ចូលស្តុកបន្ថែមដើម្បីកុំឱ្យបែកស្តុក។`
                                    ) : (
                                      `${t.productTypes[duplicateGuard.product.productType]} · Currently ${formatQty(
                                        duplicateGuard.product.stockQty,
                                        duplicateGuard.product.unit
                                      )} in stock — Edit or restock the existing record so stock stays unified.`
                                    )
                                  ) : duplicateGuard.reason === 'barcode' ? (
                                    isKm ? (
                                      `បាកូដ ${duplicateGuard.matchedCode} ត្រូវបានចុះបញ្ជីសម្រាប់វត្ថុធាតុដើមនេះរួចហើយ។ សូមកែប្រែ ឬបញ្ចូលស្តុកបន្ថែមជំនួសការបង្កើតស្ទួន។`
                                    ) : (
                                      `Barcode ${duplicateGuard.matchedCode} is already registered to this Raw Ingredient in inventory. Edit or restock it instead of creating a duplicate.`
                                    )
                                  ) : isKm ? (
                                    `វត្ថុធាតុដើមក្នុងស្តុក · បច្ចុប្បន្ន ${formatQty(
                                      duplicateGuard.ingredient.stockQty,
                                      duplicateGuard.ingredient.unit
                                    )} — កែប្រែ ឬបញ្ចូលស្តុកបន្ថែមជំនួសវិញ។`
                                  ) : (
                                    `Raw Ingredient in inventory · Currently ${formatQty(
                                      duplicateGuard.ingredient.stockQty,
                                      duplicateGuard.ingredient.unit
                                    )} — Edit or restock the existing record instead.`
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-6">
                              {(duplicateGuard.kind === 'product' || Boolean(onEditExistingIngredient)) && (
                                <button
                                  type="button"
                                  onClick={handleSwitchToEditExisting}
                                  className="h-10 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  {isKm ? 'កែប្រែទំនិញដែលមានស្រាប់' : 'Edit Existing Item'}
                                </button>
                              )}
                              {((duplicateGuard.kind === 'product' && Boolean(onRestockExisting)) ||
                                (duplicateGuard.kind === 'ingredient' &&
                                  Boolean(onRestockExistingIngredient))) && (
                                <button
                                  type="button"
                                  onClick={handleRestockExisting}
                                  className="h-10 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-950 dark:text-amber-100 bg-white dark:bg-[#18251F] border border-amber-300 dark:border-amber-500/50 hover:bg-amber-100/70 dark:hover:bg-[#1F3028] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                                >
                                  <PackagePlus className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                                  {isKm ? 'បញ្ចូលស្តុកបន្ថែម' : 'Restock Existing'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Item Type Selector */}
                        <div className="pt-1">
                          <div className="flex items-center gap-1 mb-2">
                            <span className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                              {isKm ? 'ប្រភេទទំនិញ' : 'Item Type'}
                            </span>
                            <InfoHint
                              compact
                              label={isKm ? 'អំពីប្រភេទទំនិញ' : 'About Item Type'}
                              text={
                                isKm
                                  ? 'កំណត់វិធីកាត់ស្តុកពេលលក់លើ POS៖ ធ្វើតាមការកុម្ម៉ង់ (កាត់វត្ថុធាតុដើមតាមរូបមន្ត) ឬ ទំនិញវេចខ្ចប់ស្រាប់ (កាត់ស្តុកចំនួនដប/កំប៉ុងដោយផ្ទាល់)។'
                                  : 'Controls how stock deducts on POS sales: Made-to-Order deducts Raw Ingredients via recipe, while Retail Packaged deducts unit stock directly.'
                              }
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(
                              ['PREPARED_TO_ORDER', 'PACKAGED'] as ProductType[]
                            ).map((pt) => {
                              const selected = productType === pt;
                              const isMadeToOrder = pt === 'PREPARED_TO_ORDER';
                              const IconComp = isMadeToOrder ? CupSoda : Package;
                              return (
                                <button
                                  key={pt}
                                  type="button"
                                  onClick={() => handleProductTypeChange(pt)}
                                  aria-pressed={selected}
                                  className={`min-h-[68px] px-3.5 py-3 rounded-xl border text-left transition-all duration-150 active:scale-[0.98] flex items-start gap-3 ${
                                    selected
                                      ? isMadeToOrder
                                        ? 'border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:text-emerald-300'
                                        : 'border-sky-600/60 bg-sky-500/10 text-sky-700 dark:border-sky-500/60 dark:bg-sky-500/15 dark:text-sky-300'
                                      : 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                                  }`}
                                >
                                  <span
                                    className={`w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 mt-0.5 ${
                                      isMadeToOrder
                                        ? 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400 dark:bg-emerald-500/15'
                                        : 'text-sky-600 bg-sky-500/10 dark:text-sky-400 dark:bg-sky-500/15'
                                    }`}
                                  >
                                    <IconComp className="w-4 h-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold truncate">
                                      {t.productTypes[pt]}
                                    </div>
                                    <div className="text-[11px] font-normal text-stone-500 dark:text-[#94A39B] mt-0.5 leading-snug">
                                      {isMadeToOrder
                                        ? isKm
                                          ? 'ឆុង ឬលាយថ្មីៗតាមការកុម្ម៉ង់ ដោយកាត់វត្ថុធាតុដើមតាមរូបមន្ត។'
                                          : 'Freshly prepared per order using linked Raw Ingredients.'
                                        : isKm
                                          ? 'ទំនិញទិញចូលវេចខ្ចប់ស្រាប់ ហើយលក់ចេញជាដប/កំប៉ុង (ភេសជ្ជៈ ទឹកសុទ្ធ អាហារសម្រន់)។'
                                          : 'Bought sealed from a supplier and sold as-is (e.g., canned drinks, water, snacks).'}
                                    </div>
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
                          isKm
                            ? 'ឈ្មោះភាសាខ្មែរ និងម៉ាក (ស្រេចចិត្ត)'
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
                                isKm
                                  ? 'ឈ្មោះបង្ហាញជាភាសាខ្មែរ (ស្រេចចិត្ត)'
                                  : 'Optional Khmer display name'
                              }
                              className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="pf-brand"
                              className="block text-xs font-medium text-stone-600 dark:text-[#D5DFDA] mb-1.5"
                            >
                              {isKm ? 'ម៉ាកផលិតផល' : 'Brand'}
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
                            {isKm ? 'រូបភាពលើ POS' : 'POS thumbnail'}
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
                            title={preset.label}
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
                      {isKm ? 'បាកូដ និងស្វែងរក' : 'Barcode & Lookup'}
                    </legend>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Barcode className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] mr-0.5 shrink-0" />
                        <label
                          htmlFor="pf-barcode"
                          className="text-xs font-semibold text-stone-800 dark:text-[#F1F5F3]"
                        >
                          {isKm ? 'បាកូដ / SKU (ស្រេចចិត្ត)' : 'Barcode / SKU (optional)'}
                        </label>
                        <InfoHint
                          compact
                          label={isKm ? 'អំពីការស្វែងរកបាកូដ' : 'About barcode lookup'}
                          text={
                            isKm
                              ? 'ស្កេន ឬវាយបញ្ចូលបាកូដ EAN-13, UPC ឬ Code 128។ ប្រើប៊ូតុងស្វែងរកដើម្បីទាញឈ្មោះ និងម៉ាកពី Open Food Facts ឬបង្កើត SKU ស្វ័យប្រវត្តិសម្រាប់បោះពុម្ពស្លាក។'
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
                        {isKm ? 'ស្កេន' : 'Scan'}
                      </button>
                      <button
                        type="button"
                        onClick={handleAutoGenerateSku}
                        className="h-11 px-3.5 text-xs font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                        title={
                          isKm ? 'បង្កើតកូដ SKU ស្វ័យប្រវត្តិ' : 'Automatically generate a unique SKU'
                        }
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {isKm ? 'បង្កើត SKU' : 'Auto-SKU'}
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
                            {isKm ? 'ស្វែងរក' : 'Lookup'}
                          </button>
                        )}
                      {hasAnyLabelableCode && (
                        <button
                          type="button"
                          onClick={() => setLabelModalOpen(true)}
                          className="h-11 px-3.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                          title={isKm ? 'បោះពុម្ពស្លាកបាកូដ / QR' : 'Print Code 128 / QR label'}
                        >
                          <Printer className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                          <span className="hidden sm:inline">{isKm ? 'ស្លាកបាកូដ' : 'Print Label'}</span>
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
                        {isKm ? 'បង្ហាញលើ POS' : 'Available on POS'}
                      </span>
                      <span className="block text-xs text-stone-500 dark:text-[#94A39B]">
                        {isKm
                          ? 'បើកដើម្បីឱ្យបុគ្គលិកគិតលុយអាចចុចលក់មុខទំនិញនេះបានភ្លាមៗ។'
                          : 'Enable so cashiers can tap and ring up this item at the register.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      onClick={() => setActive((prev) => !prev)}
                      className="min-h-[44px] min-w-[52px] inline-flex items-center justify-end shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] rounded-lg"
                      aria-label={isKm ? 'បង្ហាញលើ POS' : 'Available on POS'}
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
                  {productType === 'PACKAGED' ? (
                    /* ULTRA-MINIMALIST RETAIL PACKAGED PRICING (FLAT CANVAS + HAIRLINE DIVIDERS) */
                    <div className="space-y-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                          {isKm ? 'តម្លៃលក់' : 'Pricing'}
                        </h3>
                        <span className="font-mono-num text-xs text-slate-400 dark:text-slate-500">
                          {exchangeRate.toLocaleString('en-US')} ៛ / $1
                        </span>
                      </div>

                      {/* Row 1 — Sell Single Unit (1 pc) */}
                      <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50">
                        <div className="flex items-center justify-between gap-4">
                          <label
                            htmlFor="pf-toggle-single-unit"
                            className="text-sm font-medium text-slate-900 dark:text-slate-100 cursor-pointer select-none"
                          >
                            {isKm
                              ? `លក់រាយ (១ ${unitLabel})`
                              : `Sell Single Unit (1 ${unitLabel === 'pcs' ? 'pc' : unitLabel})`}
                          </label>
                          <button
                            id="pf-toggle-single-unit"
                            type="button"
                            role="switch"
                            aria-checked={allowSingleUnitSale}
                            onClick={handleToggleSellSingleUnit}
                            className="min-h-[44px] min-w-[52px] inline-flex items-center justify-end shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-emerald-500 rounded-lg"
                          >
                            <span
                              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-150 ${
                                allowSingleUnitSale
                                  ? 'bg-[#0F5C43] dark:bg-[#10B981]'
                                  : 'bg-slate-200 dark:bg-[#1E2E26]'
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform duration-150 ${
                                  allowSingleUnitSale ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </span>
                          </button>
                        </div>

                        <AccordionReveal open={allowSingleUnitSale}>
                          <div className="pt-3.5 pb-1 px-0.5 max-w-md">
                            <label
                              htmlFor="pf-price"
                              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                            >
                              {isKm ? 'តម្លៃលក់រាយ' : 'Unit Selling Price'}
                            </label>
                            <CurrencyInput
                              id="pf-price"
                              size="lg"
                              valueKhr={basePriceNum}
                              onChangeKhr={(nextKhr) => {
                                setManualPriceOverride(true);
                                setPriceKhr(nextKhr > 0 ? String(nextKhr) : '');
                                if (stepError) setStepError('');
                              }}
                              exchangeRate={exchangeRate}
                              placeholderKhr="0"
                              placeholderUsd="0.00"
                            />
                          </div>
                        </AccordionReveal>
                      </div>

                      {/* Row 2 — Sell by Carton / Pack */}
                      <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50">
                        <div className="flex items-center justify-between gap-4">
                          <label
                            htmlFor="pf-toggle-carton-sale"
                            className="text-sm font-medium text-slate-900 dark:text-slate-100 cursor-pointer select-none"
                          >
                            {isKm ? 'លក់ជាកេស / យួរ' : 'Sell by Carton / Pack'}
                          </label>
                          <button
                            id="pf-toggle-carton-sale"
                            type="button"
                            role="switch"
                            aria-checked={sellByCarton}
                            onClick={handleToggleSellByCarton}
                            className="min-h-[44px] min-w-[52px] inline-flex items-center justify-end shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:focus-visible:ring-emerald-500 rounded-lg"
                          >
                            <span
                              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-150 ${
                                sellByCarton
                                  ? 'bg-[#0F5C43] dark:bg-[#10B981]'
                                  : 'bg-slate-200 dark:bg-[#1E2E26]'
                              }`}
                            >
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform duration-150 ${
                                  sellByCarton ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </span>
                          </button>
                        </div>

                        <AccordionReveal open={sellByCarton}>
                          <div className="pt-3.5 pb-1 px-0.5 grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
                            {/* Pack Name */}
                            <div className="sm:col-span-7">
                              <label
                                htmlFor="pf-pack-name"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'ឈ្មោះកេស' : 'Pack Name'}
                              </label>
                              <input
                                id="pf-pack-name"
                                type="text"
                                maxLength={60}
                                value={cartonLabel}
                                onChange={(e) => updatePrimaryPack({ label: e.target.value })}
                                placeholder={isKm ? 'កេស' : 'Carton'}
                                className="w-full h-11 px-3.5 text-sm border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                              />
                            </div>

                            {/* Units / Carton */}
                            <div className="sm:col-span-5">
                              <label
                                htmlFor="pf-pack-units-step2"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'ចំនួន / កេស' : 'Units / Carton'}
                              </label>
                              <input
                                id="pf-pack-units-step2"
                                type="number"
                                min={1}
                                step={1}
                                value={cartonUnits}
                                onChange={(e) => handleCartonUnitsChange(e.target.value)}
                                placeholder="24"
                                className="w-full h-11 px-3.5 text-sm font-semibold tabular-nums border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                              />
                            </div>

                            {/* Carton Selling Price */}
                            <div className="sm:col-span-7">
                              <label
                                htmlFor="pf-carton-price"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'តម្លៃលក់កេស' : 'Carton Selling Price'}
                              </label>
                              <CurrencyInput
                                id="pf-carton-price"
                                valueKhr={cartonSellingPriceKhr}
                                onChangeKhr={(nextKhr) =>
                                  updatePrimaryPack({ priceKhr: nextKhr, sellableOnPos: true })
                                }
                                exchangeRate={exchangeRate}
                                placeholderKhr="0"
                                placeholderUsd="0.00"
                              />
                            </div>

                            {/* Carton Barcode (optional, inline scan icon inside right edge) */}
                            <div className="sm:col-span-5">
                              <label
                                htmlFor="pf-carton-barcode"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'បាកូដកេស' : 'Carton Barcode'}
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  id="pf-carton-barcode"
                                  type="text"
                                  maxLength={64}
                                  value={cartonBarcode}
                                  onChange={(e) => updatePrimaryPack({ barcode: e.target.value })}
                                  placeholder={isKm ? 'ស្រេចចិត្ត' : 'Optional'}
                                  className="w-full h-11 pl-3.5 pr-11 text-sm font-mono-num border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                                />
                                <button
                                  type="button"
                                  onClick={() => setScannerTarget({ kind: 'pack', index: 0 })}
                                  aria-label={isKm ? 'ស្កេនបាកូដកេស' : 'Scan carton barcode'}
                                  title={isKm ? 'ស្កេនបាកូដកេស' : 'Scan carton barcode'}
                                  className="absolute right-0.5 w-10 h-10 inline-flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors"
                                >
                                  <ScanBarcode className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </AccordionReveal>
                      </div>
                    </div>
                  ) : (
                    /* MADE-TO-ORDER BASE SELLING PRICE */
                    <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                      <legend className="sr-only">
                        {isKm ? 'តម្លៃលក់មូលដ្ឋាន' : 'Base Selling Price'}
                      </legend>
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-100 dark:border-[#1F3028]">
                        <div className="flex items-center gap-1">
                          <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {isKm ? 'តម្លៃលក់ (KHR)' : 'Base Selling Price'}
                          </h3>
                          <InfoHint
                            compact
                            label={isKm ? 'អំពីការបម្លែងប្រាក់ដុល្លារ' : 'About USD conversion'}
                            text={
                              isKm
                                ? `បង្ហាញតម្លៃដុល្លារប្រហាក់ប្រហែលតាមអត្រាប្ដូរប្រាក់ POS (${exchangeRate.toLocaleString('en-US')} ៛/$)។ តម្លៃវិក្កយបត្រនៅតែគិតជាប្រាក់រៀល។`
                                : `Shows live USD reference using your POS exchange rate (${exchangeRate.toLocaleString('en-US')} ៛/$). Register totals remain in KHR.`
                            }
                          />
                        </div>
                        <span className="font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                          {exchangeRate.toLocaleString('en-US')} ៛ / $1
                        </span>
                      </div>

                      <div>
                        <label
                          htmlFor="pf-price"
                          className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                        >
                          {t.products.sellingPrice} {!hasVariantsEnabled ? '*' : ''}
                        </label>
                        <CurrencyInput
                          id="pf-price"
                          size="lg"
                          valueKhr={basePriceNum}
                          onChangeKhr={(nextKhr) => {
                            setManualPriceOverride(true);
                            setPriceKhr(nextKhr > 0 ? String(nextKhr) : '');
                            if (stepError) setStepError('');
                          }}
                          exchangeRate={exchangeRate}
                          placeholderKhr="0"
                          placeholderUsd="0.00"
                        />
                      </div>

                      {hasVariantsEnabled && (
                        <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                          {isKm
                            ? 'កំពុងបើកទំហំច្រើនខាងក្រោម — បុគ្គលិក POS នឹងជ្រើសរើសតម្លៃតាមទំហំកែវនីមួយៗ។'
                            : 'Size variants are enabled below — POS cashiers will ring up each size at its variant price.'}
                        </p>
                      )}
                    </fieldset>
                  )}

                  {/* Size Variants Section for Made-to-Order Items */}
                  {productType === 'PREPARED_TO_ORDER' && (
                    <fieldset className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 space-y-4">
                      <legend className="sr-only">
                        {isKm ? 'ទំហំកែវ' : 'Size Variants'}
                      </legend>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                            <h3 className="font-display text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                              {isKm ? 'ទំហំកែវ (Small / Medium / Large)' : 'Size Variants'}
                            </h3>
                            <InfoHint
                              compact
                              label={isKm ? 'អំពីតម្លៃតាមទំហំ' : 'About size variant pricing'}
                              text={
                                isKm
                                  ? 'បើកនៅពេលភេសជ្ជៈមានច្រើនទំហំ (តូច កណ្តាល ធំ)។ ទំហំនីមួយៗមានតម្លៃលក់ បាកូដ និងរូបមន្តវត្ថុធាតុដើមផ្ទាល់ខ្លួននៅជំហានទី ៣។'
                                  : 'Enable when a drink comes in multiple cup sizes (Small, Medium, Large). Each size has its own selling price, optional barcode, and recipe in Step 3.'
                              }
                            />
                          </div>
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                            {isKm
                              ? 'ផ្តល់ជម្រើសច្រើនទំហំជាមួយតម្លៃ និងរូបមន្តផ្សេងៗគ្នា។'
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
                            <span>{hasVariantsEnabled ? (isKm ? 'បើក' : 'Enabled') : isKm ? 'បិទ' : 'Off'}</span>
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
                        <div className="animate-drawer-in space-y-3 pt-2 border-t border-stone-100 dark:border-[#1F3028]">
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
                                      {isKm ? 'ឈ្មោះទំហំ *' : 'Size Name *'}
                                    </label>
                                    <input
                                      type="text"
                                      value={variant.name}
                                      onChange={(e) =>
                                        updateVariant(vIdx, { name: e.target.value })
                                      }
                                      placeholder={isKm ? 'ឧ. Small / Medium / Large' : 'e.g. Small'}
                                      className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                    />
                                  </div>

                                  {/* Selling Price */}
                                  <div className="sm:col-span-4">
                                    <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                                      {isKm ? 'តម្លៃលក់ *' : 'Selling Price *'}
                                    </label>
                                    <CurrencyInput
                                      valueKhr={vPrice}
                                      onChangeKhr={(nextKhr) =>
                                        updateVariant(vIdx, {
                                          priceKhr: nextKhr,
                                        })
                                      }
                                      exchangeRate={exchangeRate}
                                      placeholderKhr="8000"
                                      placeholderUsd="2.00"
                                    />
                                  </div>

                                  {/* Optional Variant Barcode + Scan */}
                                  <div className="sm:col-span-3">
                                    <label className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1">
                                      {isKm ? 'បាកូដ (ស្រេចចិត្ត)' : 'Barcode (optional)'}
                                    </label>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        maxLength={64}
                                        value={variant.barcode || ''}
                                        onChange={(e) =>
                                          updateVariant(vIdx, { barcode: e.target.value })
                                        }
                                        placeholder={isKm ? 'បាកូដ' : 'Optional code'}
                                        className="w-full min-w-0 h-11 px-2.5 text-xs font-mono-num border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setScannerTarget({ kind: 'variant', index: vIdx })
                                        }
                                        className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg shrink-0"
                                        title={isKm ? 'ស្កេនបាកូដ' : 'Scan barcode'}
                                      >
                                        <ScanBarcode className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Live Gross Margin % + Delete */}
                                  <div className="sm:col-span-2 flex items-end justify-between gap-2 sm:pt-5">
                                    <div className="min-w-0">
                                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                                        {isKm ? 'អត្រាចំណេញដុល' : 'Gross Margin'}
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
                                          {isKm ? 'កំណត់រូបមន្តនៅជំហាន ៣' : 'Set recipe in Step 3'}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeVariant(vIdx)}
                                      className="w-11 h-11 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg shrink-0 transition-colors"
                                      aria-label={isKm ? 'លុបទំហំ' : 'Remove size variant'}
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
                              {isKm ? 'បន្ថែមទំហំ' : 'Add Size'}
                            </button>

                            {!variants.some((v) => v.name.toLowerCase() === 'large') && (
                              <button
                                type="button"
                                onClick={() => addVariant('Large', 'ធំ (L)', 4000)}
                                className="h-11 px-3 text-xs font-medium text-stone-600 dark:text-[#D5DFDA] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                              >
                                + {isKm ? 'បន្ថែមទំហំ Large' : 'Quick Add Large'}
                              </button>
                            )}
                          </div>
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
                              {isKm ? 'ថ្លៃដើមរូបមន្ត និងប្រាក់ចំណេញដុល' : 'Recipe Cost & Gross Margin'}
                              {activeVariant ? ` · ${activeVariant.name}` : ''}
                            </h3>
                            <InfoHint
                              compact
                              label={isKm ? 'អំពីការកាត់ស្តុកតាមរូបមន្ត' : 'About recipe stock deduction'}
                              text={
                                isKm
                                  ? 'សម្រាប់ភេសជ្ជៈធ្វើតាមការកុម្ម៉ង់ រាល់ការលក់លើ POS នឹងកាត់ស្តុកវត្ថុធាតុដើមតាមបរិមាណខាងក្រោម និងកត់ត្រា COGS ដោយស្វ័យប្រវត្តិ។'
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
                              {isKm ? 'តម្លៃលក់' : 'Selling Price'}
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
                              {isKm ? 'ថ្លៃដើមរូបមន្ត' : 'Calculated Recipe Cost'}
                            </span>
                            <span className="block font-mono-num text-base font-bold text-stone-900 dark:text-[#F1F5F3] mt-0.5">
                              {formatKhr(activeMtoCost)}
                            </span>
                            <span className="block text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {activeMtoRecipe.length}{' '}
                              {isKm ? 'វត្ថុធាតុដើម' : activeMtoRecipe.length === 1 ? 'ingredient' : 'ingredients'}
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
                              {isKm ? 'អត្រាចំណេញដុល %' : 'Gross Margin %'}
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
                                ? isKm
                                  ? 'គណនាតាមថ្លៃស្តុក'
                                  : 'Based on stock cost'
                                : isKm
                                  ? 'ភ្ជាប់រូបមន្តខាងក្រោម'
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
                                ? isKm
                                  ? 'រូបមន្តវត្ថុធាតុដើមតាមទំហំកែវ'
                                  : 'Ingredient Recipe per Size Variant'
                                : isKm
                                  ? 'រូបមន្តវត្ថុធាតុដើមសម្រាប់ ១ កែវ'
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
                                  {isKm
                                    ? `ចម្លងពី ${variants[0].name}`
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
                              {isKm
                                ? 'មិនទាន់មានវត្ថុធាតុដើមភ្ជាប់នឹងរូបមន្តនេះទេ'
                                : 'No ingredients linked to this recipe yet'}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] max-w-md mx-auto leading-relaxed">
                              {isKm
                                ? 'ការភ្ជាប់វត្ថុធាតុដើម (ដូចជា ផ្លែឈើស្រស់ ស្ករស កែវ) ជួយឱ្យប្រព័ន្ធកាត់ស្តុក និងគណនាប្រាក់ចំណេញដុលដោយស្វ័យប្រវត្តិលើរាល់ការលក់ POS។'
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
                                {isKm ? 'បន្ថែមវត្ថុធាតុដើមដំបូង' : 'Add First Ingredient'}
                              </button>
                            ) : (
                              <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                                {isKm
                                  ? 'សូមបន្ថែមវត្ថុធាតុដើមនៅក្នុងទំព័រស្តុកទំនិញជាមុនសិន រួចត្រឡប់មកភ្ជាប់នៅពេលណាក៏បាន។'
                                  : 'Add raw ingredients in Inventory first, then return here anytime to link them.'}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                              <span className="col-span-5">{isKm ? 'វត្ថុធាតុដើម' : 'Ingredient'}</span>
                              <span className="col-span-2">{isKm ? 'បរិមាណ/កែវ' : 'Qty / Cup'}</span>
                              <span className="col-span-2">{isKm ? 'ឯកតា' : 'Unit'}</span>
                              <span className="col-span-2 text-right">{isKm ? 'ថ្លៃដើម' : 'Cost'}</span>
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
                                        {displayLocalName(ing.name, ing.nameVi)} ({ing.unit})
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

                  {/* MODE B: RETAIL PACKAGED — ULTRA-MINIMALIST COST & STOCK */}
                  {productType === 'PACKAGED' && (
                    <div className="space-y-5">
                      {/* Top Bar: Buying Mode Segmented Control + Live Margin Readout */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div
                          role="tablist"
                          aria-label={isKm ? 'របៀបទិញចូល' : 'Buying mode'}
                          className="inline-flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-[#0B1712] border border-slate-200/60 dark:border-emerald-950/60"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={buyMode === 'carton'}
                            onClick={() => handleSelectBuyMode('carton')}
                            className={`h-10 px-4 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                              buyMode === 'carton'
                                ? 'bg-white dark:bg-[#162820] text-slate-900 dark:text-slate-100 shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                          >
                            {isKm ? 'ទិញជាកេស' : 'Buy by Carton'}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={buyMode === 'unit'}
                            onClick={() => handleSelectBuyMode('unit')}
                            className={`h-10 px-4 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                              buyMode === 'unit'
                                ? 'bg-white dark:bg-[#162820] text-slate-900 dark:text-slate-100 shadow-xs'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                          >
                            {isKm ? 'ទិញរាយ' : 'Buy by Single Unit'}
                          </button>
                        </div>

                        {/* Live Margin Readout (Bound Directly to unitCostKhr & cartonCostKhr) */}
                        <div className="flex items-center gap-2 text-xs font-mono-num">
                          {hasLiveUnitMargin && (
                            <span
                              className={`font-semibold ${
                                unitProfitKhr >= 0
                                  ? 'text-emerald-700 dark:text-[#34D399]'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {isKm ? `${unitMarginPct}% ចំណេញ` : `${unitMarginPct}% margin`}
                            </span>
                          )}
                          {hasLiveUnitMargin && hasLiveCartonMargin && (
                            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                              ·
                            </span>
                          )}
                          {hasLiveCartonMargin && (
                            <span
                              className={`font-semibold ${
                                cartonProfitKhr >= 0
                                  ? 'text-sky-700 dark:text-sky-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {isKm
                                ? `កេស ${cartonMarginPct}%`
                                : hasLiveUnitMargin
                                  ? `Carton ${cartonMarginPct}%`
                                  : `Carton ${cartonMarginPct}% margin`}
                            </span>
                          )}
                          {!hasLiveUnitMargin && !hasLiveCartonMargin && (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </div>
                      </div>

                      {buyMode === 'carton' ? (
                        <>
                          {/* Primary 3-Column Row: Units/Carton · Carton Cost · Stock Qty (Cartons | pcs) */}
                          <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                            {/* Units / Carton */}
                            <div className="md:col-span-2">
                              <label
                                htmlFor="pf-pack-units-step3"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'ចំនួន / កេស' : 'Units / Carton'}
                              </label>
                              <input
                                id="pf-pack-units-step3"
                                type="number"
                                min={1}
                                step={1}
                                value={cartonUnits}
                                onChange={(e) => handleCartonUnitsChange(e.target.value)}
                                placeholder="24"
                                className="w-full h-11 px-3.5 text-sm font-semibold tabular-nums border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                              />
                            </div>

                            {/* Carton Cost */}
                            <div className="md:col-span-5">
                              <label
                                htmlFor="pf-carton-cost"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'ថ្លៃដើមកេស' : 'Carton Cost'}
                              </label>
                              <CurrencyInput
                                id="pf-carton-cost"
                                valueKhr={cartonCostKhr}
                                onChangeKhr={(nextKhr) => updatePrimaryPack({ costKhr: nextKhr })}
                                exchangeRate={exchangeRate}
                                placeholderKhr="0"
                                placeholderUsd="0.00"
                              />
                            </div>

                            {/* Stock Qty with compact Cartons | pcs toggle */}
                            <div className="md:col-span-5">
                              <label
                                htmlFor="pf-stock"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'បរិមាណស្តុក' : 'Stock Qty'}
                              </label>
                              <div className="flex items-center h-11 w-full rounded-xl border border-slate-200/80 dark:border-emerald-950/70 hover:border-slate-300 dark:hover:border-emerald-900/80 bg-white dark:bg-[#0B1712] focus-within:border-emerald-600 dark:focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15 transition-colors">
                                <input
                                  id="pf-stock"
                                  type="text"
                                  inputMode="decimal"
                                  value={
                                    stockEntryMode === 'carton'
                                      ? stockCartonsInput
                                      : stockQty === '0'
                                        ? ''
                                        : stockQty
                                  }
                                  onChange={(e) => {
                                    if (stockEntryMode === 'carton') {
                                      handleStockCartonsChange(e.target.value);
                                    } else {
                                      const cleaned = e.target.value.replace(
                                        /[\u17E0-\u17E9]/g,
                                        (ch) => String(ch.charCodeAt(0) - 0x17e0)
                                      );
                                      if (!/^\d*\.?\d*$/.test(cleaned)) return;
                                      setStockQty(cleaned === '' ? '0' : cleaned);
                                    }
                                  }}
                                  placeholder="0"
                                  className="w-full min-w-0 h-full bg-transparent pl-3.5 pr-2 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none"
                                />
                                <div
                                  role="group"
                                  aria-label={isKm ? 'ឯកតាស្តុក' : 'Stock unit'}
                                  className="flex items-center p-0.5 mr-1.5 rounded-lg bg-slate-100/90 dark:bg-[#13221B] shrink-0"
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleStockEntryModeSwitch('carton')}
                                    className={`px-2 h-7 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                      stockEntryMode === 'carton'
                                        ? 'bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                  >
                                    {isKm ? 'កេស' : 'Cartons'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStockEntryModeSwitch('pcs')}
                                    className={`px-2 h-7 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                      stockEntryMode === 'pcs'
                                        ? 'bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                  >
                                    {unitLabel}
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                                {stockEntryMode === 'carton'
                                  ? `= ${formatQty(stockQtyNum, unitLabel)}`
                                  : stockQtyNum > 0 && cartonUnits > 1
                                    ? `= ${(Math.round((stockQtyNum / cartonUnits) * 100) / 100).toLocaleString('en-US')} ${isKm ? 'កេស' : 'cartons'}`
                                    : `${formatQty(stockQtyNum, unitLabel)}`}
                              </p>
                            </div>
                          </div>

                          {/* Conditional Single-Unit Cost (ONLY if Sell Single Unit is ON in Step 2) */}
                          {allowSingleUnitSale && (
                            <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50 max-w-md">
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                <label
                                  htmlFor="pf-cost"
                                  className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                                >
                                  {isKm ? 'ថ្លៃដើមរាយ' : 'Single-Unit Cost'}
                                </label>
                                {suggestedUnitCostKhr > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setCostPriceKhr(String(suggestedUnitCostKhr))}
                                    className="px-2.5 py-1 rounded-full text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/60 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    {formatKhr(suggestedUnitCostKhr)} (
                                    {cartonCostKhr.toLocaleString('en-US')} ÷ {cartonUnits})
                                  </button>
                                )}
                              </div>
                              <CurrencyInput
                                id="pf-cost"
                                valueKhr={unitCostKhr}
                                onChangeKhr={(nextKhr) => setCostPriceKhr(String(nextKhr))}
                                exchangeRate={exchangeRate}
                                placeholderKhr="0"
                                placeholderUsd="0.00"
                              />
                            </div>
                          )}

                          {/* Low-Stock Alert (pcs) & Supplier */}
                          <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50 grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
                            <div className="sm:col-span-5">
                              <label
                                htmlFor="pf-reorder"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm
                                  ? `ជូនដំណឹងស្តុកទាប (${unitLabel})`
                                  : `Low-Stock Alert (${unitLabel})`}
                              </label>
                              <input
                                id="pf-reorder"
                                type="number"
                                min={0}
                                step="any"
                                value={reorderLevel}
                                onChange={(e) => setReorderLevel(e.target.value)}
                                placeholder="12"
                                className="w-full h-11 px-3.5 text-sm font-semibold tabular-nums border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                              />
                            </div>

                            <div className="sm:col-span-7">
                              <label
                                htmlFor="pf-supplier"
                                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                              >
                                {isKm ? 'អ្នកផ្គត់ផ្គង់' : 'Supplier'}
                              </label>
                              <input
                                id="pf-supplier"
                                type="text"
                                maxLength={100}
                                value={supplier}
                                onChange={(e) => setSupplier(e.target.value)}
                                placeholder={isKm ? 'ស្រេចចិត្ត' : 'Optional'}
                                className="w-full h-11 px-3.5 text-sm border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        /* BUY BY SINGLE UNIT: ONE CLEAN ROW */
                        <div className="pt-5 border-t border-slate-200/60 dark:border-emerald-950/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-start">
                          <div className="sm:col-span-2 lg:col-span-4">
                            <label
                              htmlFor="pf-cost"
                              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                            >
                              {isKm ? 'ថ្លៃដើមរាយ' : 'Single-Unit Cost'}
                            </label>
                            <CurrencyInput
                              id="pf-cost"
                              valueKhr={unitCostKhr}
                              onChangeKhr={(nextKhr) => setCostPriceKhr(String(nextKhr))}
                              exchangeRate={exchangeRate}
                              placeholderKhr="0"
                              placeholderUsd="0.00"
                            />
                          </div>

                          <div className="lg:col-span-2">
                            <label
                              htmlFor="pf-stock"
                              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 whitespace-nowrap"
                            >
                              {isKm ? `ស្តុក (${unitLabel})` : `Stock Qty (${unitLabel})`}
                            </label>
                            <input
                              id="pf-stock"
                              type="number"
                              min={0}
                              step="any"
                              value={stockQty === '0' ? '' : stockQty}
                              onChange={(e) =>
                                setStockQty(e.target.value === '' ? '0' : e.target.value)
                              }
                              placeholder="0"
                              className="w-full h-11 px-3.5 text-sm font-semibold tabular-nums border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                            />
                          </div>

                          <div className="lg:col-span-3">
                            <label
                              htmlFor="pf-reorder"
                              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 whitespace-nowrap"
                            >
                              {isKm
                                ? `ជូនដំណឹងស្តុកទាប (${unitLabel})`
                                : `Low-Stock Alert (${unitLabel})`}
                            </label>
                            <input
                              id="pf-reorder"
                              type="number"
                              min={0}
                              step="any"
                              value={reorderLevel}
                              onChange={(e) => setReorderLevel(e.target.value)}
                              placeholder="12"
                              className="w-full h-11 px-3.5 text-sm font-semibold tabular-nums border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                            />
                          </div>

                          <div className="sm:col-span-2 lg:col-span-3">
                            <label
                              htmlFor="pf-supplier"
                              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                            >
                              {isKm ? 'អ្នកផ្គត់ផ្គង់' : 'Supplier'}
                            </label>
                            <input
                              id="pf-supplier"
                              type="text"
                              maxLength={100}
                              value={supplier}
                              onChange={(e) => setSupplier(e.target.value)}
                              placeholder={isKm ? 'ស្រេចចិត្ត' : 'Optional'}
                              className="w-full h-11 px-3.5 text-sm border border-slate-200/80 dark:border-emerald-950/70 rounded-xl bg-white dark:bg-[#0B1712] text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus-visible:outline-none focus-visible:border-emerald-600 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/15 transition-colors"
                            />
                          </div>
                        </div>
                      )}
                    </div>
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
                    className="h-12 px-4 text-sm font-semibold text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                  >
                    {t.common.cancel}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleBackStep}
                    className="h-12 px-4 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-700 dark:text-[#D5DFDA] bg-stone-100/80 dark:bg-[#18251F] hover:bg-stone-200/70 dark:hover:bg-[#1F3028] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {isKm ? 'ត្រឡប់ក្រោយ' : 'Back'}
                  </button>
                )}
              </div>

              {/* Center Quiet Progress Readout (desktop) */}
              <div className="hidden md:flex items-center gap-2 text-xs text-stone-500 dark:text-[#94A39B] whitespace-nowrap">
                <span className="font-mono-num">
                  {isKm ? `ជំហាន ${currentStep} / 3` : `Step ${currentStep} of 3`}
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
                    disabled={saving || barcodeConflicts.length > 0 || Boolean(duplicateGuard)}
                    onClick={() => void handleSaveProduct('close')}
                    className="h-12 px-4 text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                  >
                    {saving ? (isKm ? 'កំពុងរក្សាទុក...' : 'Saving...') : isKm ? 'រក្សាទុក' : 'Save'}
                  </button>
                )}

                {currentStep === 1 && (
                  <button
                    type="button"
                    disabled={Boolean(duplicateGuard)}
                    onClick={handleNextStep}
                    className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                  >
                    <span>{isKm ? 'បន្ទាប់៖ តម្លៃលក់' : 'Next: Pricing'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {currentStep === 2 && (
                  <button
                    type="button"
                    disabled={Boolean(duplicateGuard)}
                    onClick={handleNextStep}
                    className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 disabled:cursor-not-allowed rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                  >
                    <span>
                      {productType === 'PACKAGED'
                        ? isKm
                          ? 'បន្ទាប់៖ ថ្លៃដើម និងស្តុក'
                          : 'Next: Cost & Stock'
                        : isKm
                          ? 'បន្ទាប់៖ រូបមន្ត និងស្តុក'
                          : 'Next: Recipe & Stock'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {currentStep === 3 && (
                  <>
                    {!isEditing && (
                      <button
                        type="button"
                        disabled={saving || barcodeConflicts.length > 0 || Boolean(duplicateGuard)}
                        onClick={() => void handleSaveProduct('add_another')}
                        className="h-12 px-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/80 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4 shrink-0" />
                        <span>{isKm ? 'រក្សាទុក និងបន្ថែមទៀត' : 'Save & Add Another'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={saving || barcodeConflicts.length > 0 || Boolean(duplicateGuard)}
                      onClick={() => void handleSaveProduct('close')}
                      className="h-12 px-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                    >
                      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>
                        {isEditing
                          ? isKm
                            ? 'រក្សាទុកការកែប្រែ'
                            : 'Save Product'
                          : isKm
                            ? 'រក្សាទុក'
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
      </ModalPortal>

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
        title={isKm ? 'ស្កេនបាកូដផលិតផល' : 'Scan Product Barcode'}
        onDetected={handleBarcodeScanned}
        onClose={() => setScannerTarget(null)}
      />

      {/* Internal Code 128 & QR Label Studio */}
      <BarcodeLabelModal
        open={labelModalOpen}
        product={draftProductForLabels}
        initialCode={barcode.trim() || undefined}
        shopName={settings.name}
        isKm={isKm}
        onClose={() => setLabelModalOpen(false)}
      />
    </>
  );
};
