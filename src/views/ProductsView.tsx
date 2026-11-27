import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckSquare,
  ChevronDown,
  CupSoda,
  Edit2,
  Eye,
  EyeOff,
  FlaskConical,
  FolderInput,
  Layers,
  LayoutGrid,
  Loader2,
  Minus,
  Package,
  Plus,
  QrCode,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import type {
  ExternalBarcodePrefill,
  Product,
  ProductType,
} from '../types';
import {
  calculateProductCogs,
  calculateRecipeCogs,
  formatKhr,
  formatQty,
} from '../utils/format';
import { compressImageBlobToDataUrl } from '../utils/image';
import {
  getCategoriesForScope,
  getCategoryBadgeClass,
  getCategoryById,
  getCategoryDisplayName,
  getCategoryDotClass,
  getProductTypeBadgeClass,
  getProductTypeDotClass,
  resolveProductCategoryId,
  UNCATEGORIZED_ID,
} from '../utils/categories';
import { ProductPhoto } from '../components/ProductPhoto';
import { ProductFormModal } from '../components/ProductFormModal';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { BarcodeLabelModal } from '../components/BarcodeLabelModal';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { InfoHint } from '../components/InfoHint';
import { useFilterVisibility } from '../hooks/useFilterVisibility';

const VIEW_MODE_STORAGE_KEY = 'juiceflow_products_view_mode';

function hasLinkedRecipe(product: Product): boolean {
  if (product.variants && product.variants.length > 0) {
    return product.variants.some((v) => v.recipe.length > 0);
  }
  return product.recipe.length > 0;
}

interface ProductsViewProps {
  autoOpenAdd?: boolean;
  onAutoOpenHandled?: () => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  autoOpenAdd = false,
  onAutoOpenHandled,
}) => {
  const {
    settings,
    products,
    ingredients,
    categories,
    barcodeRegistry,
    saveProduct,
    deleteProduct,
    lookupBarcode,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';

  const productCategories = useMemo(
    () => getCategoriesForScope(categories, 'product'),
    [categories]
  );

  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const { filtersOpen, toggleFilters } = useFilterVisibility();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    if (typeof window === 'undefined') return 'grid';
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      return saved === 'table' ? 'table' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [initialFocusSection, setInitialFocusSection] = useState<'recipe' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Quick-action states (inline POS visibility toggle + inline photo upload)
  const [togglingActiveIds, setTogglingActiveIds] = useState<Record<string, boolean>>({});
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [photoTargetProduct, setPhotoTargetProduct] = useState<Product | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inlinePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const { showUndoToast } = useUndoToast();

  // Barcode Scan / Lookup & Label Studio state
  const [scanLookupOpen, setScanLookupOpen] = useState(false);
  const [scanLookingUp, setScanLookingUp] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [quickInitialBarcode, setQuickInitialBarcode] = useState<string | null>(null);
  const [quickInitialPrefill, setQuickInitialPrefill] = useState<ExternalBarcodePrefill | null>(
    null
  );
  const [quickNotFoundExternally, setQuickNotFoundExternally] = useState(false);
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);

  // Select Mode & Bulk Operations state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState<string>(
    () => productCategories[0]?.id || UNCATEGORIZED_ID
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkAction, setBulkAction] = useState<'category' | 'delete' | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  );
  const bulkProcessing = bulkAction !== null;

  // Keep selected category filter and bulk target category valid when categories change
  useEffect(() => {
    if (
      categoryFilter !== 'all' &&
      !productCategories.some((c) => c.id === categoryFilter)
    ) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, productCategories]);

  useEffect(() => {
    if (
      productCategories.length > 0 &&
      !productCategories.some((c) => c.id === bulkCategory)
    ) {
      setBulkCategory(productCategories[0].id);
    }
  }, [bulkCategory, productCategories]);

  const activeFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (typeFilter !== 'ALL' ? 1 : 0);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const handleSetViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage write errors
    }
  };

  const typeCounts = useMemo(() => {
    let madeToOrder = 0;
    let packaged = 0;
    let preparedStock = 0;
    for (const p of products) {
      if (p.productType === 'PREPARED_TO_ORDER') madeToOrder += 1;
      else if (p.productType === 'PACKAGED') packaged += 1;
      else if (p.productType === 'PREPARED_STOCK') preparedStock += 1;
    }
    return {
      ALL: products.length,
      PREPARED_TO_ORDER: madeToOrder,
      PACKAGED: packaged,
      PREPARED_STOCK: preparedStock,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (
        categoryFilter !== 'all' &&
        resolveProductCategoryId(p, categories) !== categoryFilter
      ) {
        return false;
      }
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
  }, [products, categories, typeFilter, categoryFilter, search]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const activeSelectedIds = useMemo(() => {
    const valid = new Set<string>();
    selectedIds.forEach((id) => {
      if (productById.has(id)) valid.add(id);
    });
    return valid;
  }, [selectedIds, productById]);

  const selectedCount = activeSelectedIds.size;
  const allFilteredSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => activeSelectedIds.has(p.id));
  const someFilteredSelected =
    filteredProducts.some((p) => activeSelectedIds.has(p.id)) && !allFilteredSelected;

  const toggleSelectMode = () => {
    setSelectMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        setBulkFeedback(null);
      } else {
        setConfirmDeleteId(null);
        setBulkFeedback(null);
      }
      return next;
    });
  };

  // Escape cancels bulk-delete confirmation or exits Select Mode when no modal is open
  useEffect(() => {
    if (!selectMode || modalOpen || scanLookupOpen || Boolean(labelProduct)) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmBulkDelete) {
        setConfirmBulkDelete(false);
      } else if (!bulkProcessing) {
        setSelectMode(false);
        setSelectedIds(new Set());
        setBulkFeedback(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectMode, modalOpen, scanLookupOpen, labelProduct, confirmBulkDelete, bulkProcessing]);

  const toggleSelectItem = (productId: string) => {
    setConfirmBulkDelete(false);
    setBulkFeedback(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setConfirmBulkDelete(false);
    setBulkFeedback(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredProducts.forEach((p) => next.delete(p.id));
      } else {
        filteredProducts.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  const handleBulkReassignCategory = async () => {
    if (selectedCount === 0 || bulkProcessing) return;
    setBulkAction('category');
    setActionError(null);
    setScanNotice(null);
    setBulkFeedback(null);

    const targets = Array.from(activeSelectedIds)
      .map((id) => productById.get(id))
      .filter((p): p is Product => Boolean(p));

    const succeededIds = new Set<string>();
    const errors: string[] = [];

    try {
      for (const prod of targets) {
        if (resolveProductCategoryId(prod, categories) === bulkCategory) {
          succeededIds.add(prod.id);
          continue;
        }
        const res = await saveProduct({
          ...prod,
          category: bulkCategory,
          categoryId: bulkCategory,
        });
        if (res && !res.ok && res.error) {
          errors.push(res.error);
        } else {
          succeededIds.add(prod.id);
        }
      }

      if (succeededIds.size > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          succeededIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      setConfirmBulkDelete(false);

      if (errors.length > 0) {
        setActionError(errors[0]);
        setBulkFeedback({ kind: 'error', text: errors[0] });
      } else if (succeededIds.size > 0) {
        const catLabel = getCategoryDisplayName(
          getCategoryById(bulkCategory, categories),
          isVi
        );
        const msg = isVi
          ? `Đã chuyển ${succeededIds.size} sản phẩm sang danh mục "${catLabel}".`
          : `Changed category to "${catLabel}" for ${succeededIds.size} ${
              succeededIds.size === 1 ? 'product' : 'products'
            }.`;
        setScanNotice(msg);
        setBulkFeedback({ kind: 'ok', text: msg });
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : isVi
            ? 'Không thể đổi danh mục hàng loạt.'
            : 'Could not reassign categories.';
      setActionError(msg);
      setBulkFeedback({ kind: 'error', text: msg });
    } finally {
      setBulkAction(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0 || bulkProcessing) return;
    setBulkAction('delete');
    setActionError(null);
    setScanNotice(null);
    setBulkFeedback(null);

    const idsToDelete = Array.from(activeSelectedIds);
    const deletedIds = new Set<string>();

    try {
      for (const id of idsToDelete) {
        await deleteProduct(id);
        deletedIds.add(id);
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setConfirmBulkDelete(false);

      const msg = isVi
        ? `Đã xóa ${deletedIds.size} sản phẩm khỏi danh mục.`
        : `Deleted ${deletedIds.size} ${deletedIds.size === 1 ? 'product' : 'products'} from the catalog.`;
      setScanNotice(msg);
      setBulkFeedback({ kind: 'ok', text: msg });
    } catch (err) {
      if (deletedIds.size > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          deletedIds.forEach((id) => next.delete(id));
          return next;
        });
      }
      const msg =
        err instanceof Error
          ? err.message
          : isVi
            ? 'Không thể xóa hàng loạt sản phẩm.'
            : 'Could not delete selected products.';
      setActionError(msg);
      setBulkFeedback({ kind: 'error', text: msg });
    } finally {
      setBulkAction(null);
    }
  };

  const resetQuickScanSeed = () => {
    setQuickInitialBarcode(null);
    setQuickInitialPrefill(null);
    setQuickNotFoundExternally(false);
  };

  const openNew = () => {
    resetQuickScanSeed();
    setEditingProduct(null);
    setInitialFocusSection(null);
    setModalOpen(true);
  };

  useEffect(() => {
    if (!autoOpenAdd) return;
    openNew();
    onAutoOpenHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAdd]);

  const openEdit = (product: Product, focusSection: 'recipe' | null = null) => {
    resetQuickScanSeed();
    setEditingProduct(product);
    setInitialFocusSection(focusSection);
    setModalOpen(true);
  };

  const handleTogglePosVisibility = async (product: Product) => {
    if (togglingActiveIds[product.id]) return;
    setActionError(null);
    setTogglingActiveIds((prev) => ({ ...prev, [product.id]: true }));
    const nextActive = !product.active;
    const displayName = isVi ? product.nameVi || product.name : product.name;
    try {
      const res = await saveProduct({
        ...product,
        active: nextActive,
      });
      if (res && !res.ok && res.error) {
        setActionError(res.error);
      } else {
        showUndoToast({
          message: nextActive
            ? isVi
              ? `Đã hiện "${displayName}" trên POS`
              : `Shown "${displayName}" on POS`
            : isVi
              ? `Đã ẩn "${displayName}" khỏi POS`
              : `Hidden "${displayName}" from POS`,
          onUndo: async () => {
            await saveProduct({
              ...product,
              active: product.active,
            });
          },
        });
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : isVi
            ? 'Không thể cập nhật trạng thái POS.'
            : 'Could not update POS visibility.'
      );
    } finally {
      setTogglingActiveIds((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
    }
  };

  const triggerInlinePhotoUpload = (product: Product) => {
    setActionError(null);
    setPhotoTargetProduct(product);
    if (inlinePhotoInputRef.current) {
      inlinePhotoInputRef.current.value = '';
      inlinePhotoInputRef.current.click();
    }
  };

  const handleInlinePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = photoTargetProduct;
    if (!file || !target) return;

    setUploadingPhotoId(target.id);
    setActionError(null);
    try {
      const dataUrl = await compressImageBlobToDataUrl(file);
      const res = await saveProduct({
        ...target,
        imageUrl: dataUrl,
      });
      if (res && !res.ok && res.error) {
        setActionError(res.error);
      }
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : isVi
            ? 'Không thể tải ảnh lên. Vui lòng thử ảnh khác.'
            : 'Failed to upload photo. Please try a different image.'
      );
    } finally {
      setUploadingPhotoId(null);
      setPhotoTargetProduct(null);
    }
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
        setInitialFocusSection(null);
        setModalOpen(true);
        const displayName = isVi ? res.product.nameVi || res.product.name : res.product.name;
        setScanNotice(
          isVi
            ? `Đã tìm thấy "${displayName}" (${res.code}) trong sổ mã vạch JuiceFlow.`
            : `Found "${displayName}" (${res.code}) in your JuiceFlow registry.`
        );
      } else {
        setEditingProduct(null);
        setInitialFocusSection(null);
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
      {/* Hidden shared file input for inline catalog photo uploads */}
      <input
        ref={inlinePhotoInputRef}
        type="file"
        accept="image/*"
        onChange={handleInlinePhotoSelected}
        className="hidden"
        aria-hidden="true"
      />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
            {t.products.title}
          </h1>
          <InfoHint
            label={isVi ? 'Thông tin quản lý sản phẩm' : 'About Products'}
            text={
              isVi
                ? 'Quản lý sản phẩm đóng gói, pha chế theo đơn (nhiều kích cỡ S/M/L) và hàng pha sẵn trữ lạnh.'
                : 'Manage packaged goods, made-to-order drinks with size variants, and prepared-stock items.'
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={toggleSelectMode}
            aria-pressed={selectMode}
            className={`inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold rounded-lg border transition-colors whitespace-nowrap ${
              selectMode
                ? 'bg-[#E6F2ED] border-[#0F5C43] text-[#0F5C43] dark:bg-[#064E3B] dark:border-[#10B981] dark:text-[#6EE7B7]'
                : 'text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
            }`}
          >
            <CheckSquare className="w-4 h-4 shrink-0" />
            {selectMode
              ? isVi
                ? 'Xong chọn'
                : 'Done Selecting'
              : isVi
                ? 'Chọn nhiều'
                : 'Select Mode'}
          </button>
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
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-emerald-700 dark:text-[#6EE7B7] hover:text-emerald-950 dark:hover:text-white"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/40 text-red-900 dark:text-red-200 px-4 py-3 rounded-lg text-xs font-medium flex items-center justify-between gap-3"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-red-700 dark:text-red-300 hover:text-red-950 dark:hover:text-white"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter, Category, Search & View Switcher Toolbar (aligned to match InventoryView) */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 space-y-3">
        {/* Row 1: Segmented Product-Type Tabs + Right-Aligned Grid/Table Switcher */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="overflow-x-auto pb-0.5 -mx-1 px-1">
            <div
              role="tablist"
              aria-label={isVi ? 'Phân loại sản phẩm' : 'Product types'}
              className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl"
            >
              {(
                [
                  {
                    id: 'ALL',
                    icon: Layers,
                    label: isVi ? 'Tất cả' : 'All Items',
                    count: typeCounts.ALL,
                  },
                  {
                    id: 'PREPARED_TO_ORDER',
                    icon: CupSoda,
                    label: t.productTypes.PREPARED_TO_ORDER,
                    count: typeCounts.PREPARED_TO_ORDER,
                  },
                  {
                    id: 'PACKAGED',
                    icon: Package,
                    label: t.productTypes.PACKAGED,
                    count: typeCounts.PACKAGED,
                  },
                  {
                    id: 'PREPARED_STOCK',
                    icon: FlaskConical,
                    label: t.productTypes.PREPARED_STOCK,
                    count: typeCounts.PREPARED_STOCK,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = typeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTypeFilter(tab.id)}
                    className={`h-11 px-3.5 inline-flex items-center gap-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono-num text-[11px] font-bold ${
                        active ? 'opacity-80' : 'text-stone-400 dark:text-[#94A39B]'
                      }`}
                    >
                      ({tab.count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid / Table View Toggle */}
          <div
            role="group"
            aria-label={isVi ? 'Chế độ hiển thị danh mục' : 'Catalog layout view'}
            className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl self-start xl:self-auto shrink-0"
          >
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title={isVi ? 'Xem dạng lưới' : 'Grid view'}
              className={`h-11 px-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              <span>{isVi ? 'Lưới' : 'Grid'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('table')}
              aria-pressed={viewMode === 'table'}
              title={isVi ? 'Xem dạng bảng' : 'Table view'}
              className={`h-11 px-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              <Table2 className="w-4 h-4 shrink-0" />
              <span>{isVi ? 'Bảng' : 'Table'}</span>
            </button>
          </div>
        </div>

        {/* Row 2: Search Bar + Collapsible Filter Toggle & Reset All (matches SalesView) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isVi ? 'Tìm tên, thương hiệu, mã vạch...' : 'Search name, brand, barcode...'}
              className="w-full h-11 pl-10 pr-9 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="w-9 h-9 inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] absolute right-1 top-1/2 -translate-y-1/2 rounded-md"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleFilters}
              aria-expanded={filtersOpen}
              aria-controls="products-catalog-filters"
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

            <button
              type="button"
              disabled={activeFilterCount === 0 && !search.trim()}
              onClick={() => {
                setCategoryFilter('all');
                setTypeFilter('ALL');
                setSearch('');
              }}
              className="inline-flex items-center justify-center h-11 px-3 text-xs font-semibold text-[#0D5C3E] dark:text-[#34D399] hover:underline disabled:text-stone-400 dark:disabled:text-[#94A39B]/40 disabled:no-underline disabled:cursor-default rounded-lg transition-colors whitespace-nowrap"
            >
              {isVi ? 'Đặt lại tất cả' : 'Reset All'}
            </button>
          </div>
        </div>

        {/* Collapsible Dynamic Category Filter Pills Drawer (matches SalesView) */}
        <div
          id="products-catalog-filters"
          className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
            filtersOpen
              ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-stone-100 dark:border-[#24352C]'
              : '!mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden">
            <CategoryFilterPills
              categories={productCategories}
              selectedCategoryId={categoryFilter}
              onSelect={setCategoryFilter}
              isVi={isVi}
              allLabel={t.common.all}
            />
          </div>
        </div>
      </div>

      {/* Empty State */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {t.products.emptyTitle}
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B] max-w-md mx-auto">
            {t.products.emptyDesc}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* COMPACT TABLE VIEW FOR BULK SCANNING */
        <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                  {selectMode && (
                    <th className="py-2 pl-3 pr-1 w-12">
                      <button
                        type="button"
                        onClick={toggleSelectAllFiltered}
                        aria-label={
                          allFilteredSelected
                            ? isVi
                              ? 'Bỏ chọn tất cả'
                              : 'Deselect all products'
                            : isVi
                              ? 'Chọn tất cả'
                              : 'Select all products'
                        }
                        className="w-10 h-10 inline-flex items-center justify-center rounded-lg hover:bg-stone-200/70 dark:hover:bg-[#1F3028] transition-colors"
                      >
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                            allFilteredSelected || someFilteredSelected
                              ? 'bg-[#0F5C43] border-[#0F5C43] text-white dark:bg-[#10B981] dark:border-[#10B981] dark:text-[#042419]'
                              : 'bg-white dark:bg-[#131D18] border-stone-300 dark:border-[#344E41]'
                          }`}
                        >
                          {allFilteredSelected ? (
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          ) : someFilteredSelected ? (
                            <Minus className="w-3.5 h-3.5 stroke-[3]" />
                          ) : null}
                        </span>
                      </button>
                    </th>
                  )}
                  <th className="py-3 px-4 font-medium">
                    {isVi ? 'Sản phẩm / SKU' : 'Product / SKU'}
                  </th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">
                    {isVi ? 'Phân loại' : 'Type · Category'}
                  </th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">
                    {isVi ? 'Hiển thị POS' : 'POS Status'}
                  </th>
                  <th className="py-3 px-3 font-medium whitespace-nowrap">
                    {isVi ? 'Kho / Công thức' : 'Stock / Recipe'}
                  </th>
                  <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                    {isVi ? 'Giá bán' : 'Price'}
                  </th>
                  <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                    {isVi ? 'Giá vốn' : 'Cost'}
                  </th>
                  <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                    {t.products.grossMargin}
                  </th>
                  <th className="py-3 px-4 font-medium text-right whitespace-nowrap">
                    {t.common.actions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                {filteredProducts.map((product) => {
                  const firstVariant = product.variants?.[0];
                  const cogs = Math.round(calculateProductCogs(product, ingredients, firstVariant));
                  const basePrice = firstVariant ? firstVariant.priceKhr : product.priceKhr;
                  const profit = basePrice - cogs;
                  const margin = basePrice > 0 ? Math.round((profit / basePrice) * 100) : 0;
                  const displayName = isVi ? product.nameVi || product.name : product.name;
                  const isDirectStock =
                    product.productType === 'PACKAGED' ||
                    product.productType === 'PREPARED_STOCK';
                  const isLowStock = isDirectStock && product.stockQty <= product.reorderLevel;
                  const isUnlinkedRecipe =
                    product.productType === 'PREPARED_TO_ORDER' && !hasLinkedRecipe(product);
                  const isToggling = Boolean(togglingActiveIds[product.id]);
                  const isUploading = uploadingPhotoId === product.id;
                  const isSelected = activeSelectedIds.has(product.id);

                  return (
                    <tr
                      key={product.id}
                      onClick={(e) => {
                        if (!selectMode) return;
                        if ((e.target as HTMLElement).closest('button, select, input, a')) return;
                        toggleSelectItem(product.id);
                      }}
                      className={`transition-colors ${
                        selectMode ? 'cursor-pointer' : ''
                      } ${
                        isSelected
                          ? 'bg-emerald-50/75 dark:bg-[#064E3B]/35'
                          : 'hover:bg-stone-50/70 dark:hover:bg-[#18251F]/70'
                      }`}
                    >
                      {selectMode && (
                        <td className="py-2 pl-3 pr-1 w-12">
                          <button
                            type="button"
                            onClick={() => toggleSelectItem(product.id)}
                            aria-pressed={isSelected}
                            aria-label={
                              isSelected
                                ? isVi
                                  ? `Bỏ chọn ${displayName}`
                                  : `Deselect ${displayName}`
                                : isVi
                                  ? `Chọn ${displayName}`
                                  : `Select ${displayName}`
                            }
                            className="w-10 h-10 inline-flex items-center justify-center rounded-lg hover:bg-stone-200/60 dark:hover:bg-[#1F3028] transition-colors"
                          >
                            <span
                              className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                isSelected
                                  ? 'bg-[#0F5C43] border-[#0F5C43] text-white dark:bg-[#10B981] dark:border-[#10B981] dark:text-[#042419]'
                                  : 'bg-white dark:bg-[#131D18] border-stone-300 dark:border-[#344E41]'
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </span>
                          </button>
                        </td>
                      )}
                      {/* Product Thumbnail + Name + SKU */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-stone-200/80 dark:border-[#24352C]">
                            <ProductPhoto
                              src={product.imageUrl}
                              alt={displayName}
                              category={product.category}
                              className="w-11 h-11"
                            />
                            {!product.imageUrl && (
                              <button
                                type="button"
                                disabled={isUploading}
                                onClick={() => triggerInlinePhotoUpload(product)}
                                title={isVi ? 'Thêm ảnh sản phẩm' : 'Add product photo'}
                                aria-label={isVi ? 'Thêm ảnh sản phẩm' : 'Add product photo'}
                                className="absolute inset-0 bg-black/25 hover:bg-black/45 flex items-center justify-center text-white transition-colors"
                              >
                                {isUploading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Camera className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-stone-900 dark:text-[#F1F5F3] truncate max-w-[220px]">
                              {displayName}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num truncate max-w-[220px]">
                              {[product.brand, product.barcode ? `SKU: ${product.barcode}` : '']
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Color-coded Type & Category badges (matching InventoryView) */}
                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${getProductTypeBadgeClass(
                              product.productType
                            )}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${getProductTypeDotClass(
                                product.productType
                              )}`}
                              aria-hidden="true"
                            />
                            {t.productTypes[product.productType]}
                          </span>
                          {(() => {
                            const catItem = getCategoryById(
                              resolveProductCategoryId(product, categories),
                              categories
                            );
                            return (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${getCategoryBadgeClass(
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
                        </div>
                      </td>

                      {/* Interactive POS Visibility Toggle Pill */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => handleTogglePosVisibility(product)}
                          aria-pressed={product.active}
                          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[11px] font-semibold transition-colors ${
                            product.active
                              ? 'bg-[#10B981] text-white dark:text-[#042419] hover:bg-[#059669]'
                              : 'bg-slate-600/90 text-slate-100 hover:bg-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                          }`}
                        >
                          {isToggling ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : product.active ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                          {product.active
                            ? isVi
                              ? 'Đang bán POS'
                              : 'POS Active'
                            : isVi
                              ? 'Ẩn khỏi POS'
                              : 'Hidden on POS'}
                        </button>
                      </td>

                      {/* Stock or Recipe Status */}
                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        {isDirectStock ? (
                          <span
                            className={`font-mono-num font-semibold ${
                              product.stockQty <= 0
                                ? 'text-red-700 dark:text-[#F87171]'
                                : isLowStock
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : 'text-emerald-700 dark:text-[#34D399]'
                            }`}
                          >
                            {formatQty(product.stockQty, product.unit)}
                          </span>
                        ) : isUnlinkedRecipe ? (
                          <button
                            type="button"
                            onClick={() => openEdit(product, 'recipe')}
                            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-500/40 dark:hover:bg-amber-950/80 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                          </button>
                        ) : product.variants && product.variants.length > 0 ? (
                          <span className="text-stone-700 dark:text-[#D5DFDA] font-medium">
                            {product.variants.length} {isVi ? 'kích cỡ' : 'sizes'}
                          </span>
                        ) : (
                          <span className="text-stone-700 dark:text-[#D5DFDA] font-medium">
                            {product.recipe.length} {isVi ? 'nguyên liệu' : 'ingredients'}
                          </span>
                        )}
                      </td>

                      {/* Selling Price */}
                      <td className="py-3 px-3 text-right font-mono-num font-bold text-[#0F5C43] dark:text-[#34D399] whitespace-nowrap">
                        {product.variants && product.variants.length > 1
                          ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                          : formatKhr(basePrice)}
                      </td>

                      {/* Cost */}
                      <td className="py-3 px-3 text-right font-mono-num text-xs text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                        {isUnlinkedRecipe ? '—' : formatKhr(cogs)}
                      </td>

                      {/* Gross Margin or Missing Recipe Warning */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {isUnlinkedRecipe ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-500/40">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            {isVi ? 'Chưa gắn công thức' : 'No Recipe Linked'}
                          </span>
                        ) : (
                          <span className="font-mono-num text-xs font-semibold text-emerald-700 dark:text-[#34D399]">
                            {formatKhr(profit)} ({margin}%)
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(product)}
                            className="h-10 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-stone-100/90 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            {t.common.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => setLabelProduct(product)}
                            className="h-10 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-full bg-stone-100/90 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            {isVi ? 'In nhãn' : 'Labels'}
                          </button>
                          {confirmDeleteId === product.id ? (
                            <div className="inline-flex items-center gap-1 ml-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteProduct(product.id);
                                  setConfirmDeleteId(null);
                                }}
                                aria-label={t.common.delete}
                                className="h-10 px-2.5 inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {t.common.delete}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                aria-label={t.common.cancel}
                                className="w-10 h-10 inline-flex items-center justify-center rounded-full text-stone-500 dark:text-[#94A39B] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(product.id)}
                              aria-label={t.common.delete}
                              title={t.common.delete}
                              className="w-10 h-10 ml-1 inline-flex items-center justify-center rounded-full text-stone-400 dark:text-[#94A39B] hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-[#F87171] transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* EQUAL-HEIGHT CARD GRID VIEW */
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
            const isUnlinkedRecipe =
              product.productType === 'PREPARED_TO_ORDER' && !hasLinkedRecipe(product);
            const isToggling = Boolean(togglingActiveIds[product.id]);
            const isUploading = uploadingPhotoId === product.id;
            const isSelected = activeSelectedIds.has(product.id);

            return (
              <div
                key={product.id}
                onClick={(e) => {
                  if (!selectMode) return;
                  if ((e.target as HTMLElement).closest('button, select, input, a')) return;
                  toggleSelectItem(product.id);
                }}
                className={`group bg-white dark:bg-[#131D18] rounded-xl overflow-hidden flex flex-col justify-between h-full transition-all ${
                  selectMode ? 'cursor-pointer' : ''
                } ${
                  isSelected
                    ? 'border-2 border-[#0F5C43] ring-2 ring-[#0F5C43]/20 dark:border-[#10B981] dark:ring-[#10B981]/25'
                    : 'border border-stone-200 dark:border-[#24352C]'
                }`}
              >
                <div>
                  {/* Image Container with Top-Left Interactive POS Toggle, Top-Right Select Checkbox & Inline Photo Upload */}
                  <div className="relative h-40 w-full overflow-hidden">
                    <ProductPhoto
                      src={product.imageUrl}
                      alt={displayName}
                      category={product.category}
                      className="w-full h-40"
                    />

                    {/* Interactive POS Visibility Status Pill (Top-Left) */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => handleTogglePosVisibility(product)}
                      aria-pressed={product.active}
                      title={
                        product.active
                          ? isVi
                            ? 'Bấm để ẩn khỏi màn hình bán hàng POS'
                            : 'Click to hide from POS screen'
                          : isVi
                            ? 'Bấm để hiện lại trên màn hình POS'
                            : 'Click to activate on POS screen'
                      }
                      className={`absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-full text-[11px] font-semibold shadow-sm backdrop-blur-xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                        product.active
                          ? 'bg-[#10B981] text-white dark:text-[#042419] hover:bg-[#059669]'
                          : 'bg-slate-600/90 text-slate-100 hover:bg-slate-700 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {isToggling ? (
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      ) : product.active ? (
                        <Eye className="w-3 h-3 shrink-0" />
                      ) : (
                        <EyeOff className="w-3 h-3 shrink-0" />
                      )}
                      <span>
                        {product.active
                          ? isVi
                            ? 'Đang bán POS'
                            : 'POS Active'
                          : isVi
                            ? 'Ẩn khỏi POS'
                            : 'Hidden on POS'}
                      </span>
                    </button>

                    {/* Bulk Selection Checkbox Overlay (Top-Right, visible in Select Mode) */}
                    {selectMode && (
                      <button
                        type="button"
                        onClick={() => toggleSelectItem(product.id)}
                        aria-pressed={isSelected}
                        aria-label={
                          isSelected
                            ? isVi
                              ? `Bỏ chọn ${displayName}`
                              : `Deselect ${displayName}`
                            : isVi
                              ? `Chọn ${displayName}`
                              : `Select ${displayName}`
                        }
                        className="absolute top-1.5 right-1.5 z-10 w-10 h-10 inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      >
                        <span
                          className={`w-6 h-6 rounded-md flex items-center justify-center border-2 shadow-sm transition-colors ${
                            isSelected
                              ? 'bg-[#0F5C43] border-[#0F5C43] text-white dark:bg-[#10B981] dark:border-[#10B981] dark:text-[#042419]'
                              : 'bg-white/95 dark:bg-[#131D18]/95 border-stone-300 dark:border-[#344E41] hover:border-[#0F5C43] dark:hover:border-[#10B981]'
                          }`}
                        >
                          {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                        </span>
                      </button>
                    )}

                    {/* Subtle Centered Inline Photo Upload Trigger when no photo is uploaded */}
                    {!product.imageUrl && (
                      <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() => triggerInlinePhotoUpload(product)}
                          className="pointer-events-auto inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/92 dark:bg-[#131D18]/92 text-stone-700 dark:text-[#F1F5F3] border border-stone-200/90 dark:border-[#24352C] shadow-xs hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] opacity-95 sm:opacity-85 sm:group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          {isUploading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0F5C43] dark:text-[#34D399]" />
                          ) : (
                            <Camera className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399]" />
                          )}
                          <span>
                            {isUploading
                              ? isVi
                                ? 'Đang tải...'
                                : 'Uploading...'
                              : isVi
                                ? '+ Thêm ảnh'
                                : '+ Add Photo'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Card Body */}
                  <div className="p-5 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Color-coded Item Type & Category badges (matching InventoryView) */}
                        <p className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${getProductTypeBadgeClass(
                              product.productType
                            )}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${getProductTypeDotClass(
                                product.productType
                              )}`}
                              aria-hidden="true"
                            />
                            {t.productTypes[product.productType]}
                          </span>
                          {(() => {
                            const catItem = getCategoryById(
                              resolveProductCategoryId(product, categories),
                              categories
                            );
                            return (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${getCategoryBadgeClass(
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

                    {/* Cost & Margin Row (with No Recipe Linked warning for unlinked Made-to-Order) */}
                    <div className="mt-4 pt-3 border-t border-stone-100 dark:border-[#1F3028] grid grid-cols-2 gap-3 text-xs items-center">
                      <div>
                        <span className="text-stone-500 dark:text-[#94A39B] block">
                          {product.productType === 'PACKAGED'
                            ? isVi
                              ? 'Giá vốn nhập'
                              : 'Unit Cost'
                            : t.products.recipeCost}
                        </span>
                        <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                          {isUnlinkedRecipe ? '—' : formatKhr(cogs)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-stone-500 dark:text-[#94A39B] block">
                          {t.products.grossMargin}
                        </span>
                        {isUnlinkedRecipe ? (
                          <span className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-500/40">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            {isVi ? 'Chưa gắn công thức' : 'No Recipe Linked'}
                          </span>
                        ) : (
                          <span className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399]">
                            {formatKhr(profit)} ({margin}%)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Variants / Packaging / Recipe Summary */}
                    <div className="mt-4 pt-3 border-t border-stone-100 dark:border-[#1F3028] space-y-2 text-xs">
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
                                <div
                                  key={idx}
                                  className="flex justify-between font-mono-num text-[11px]"
                                >
                                  <span className="text-stone-500 dark:text-[#94A39B]">
                                    {pb.label}
                                  </span>
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
                            {isVi ? 'Kích cỡ & Giá bán' : 'Size Variants'} ({product.variants.length}
                            )
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
                                      ({v.recipe.length > 0 ? formatKhr(vCogs) : '—'})
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          {isUnlinkedRecipe && (
                            <button
                              type="button"
                              onClick={() => openEdit(product, 'recipe')}
                              className="mt-2.5 w-full h-10 min-h-[40px] px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/45 dark:hover:bg-amber-950/75 dark:text-amber-200 dark:border-amber-500/40 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                            </button>
                          )}
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
                            isUnlinkedRecipe ? (
                              <button
                                type="button"
                                onClick={() => openEdit(product, 'recipe')}
                                className="mt-1 w-full h-10 min-h-[40px] px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/45 dark:hover:bg-amber-950/75 dark:text-amber-200 dark:border-amber-500/40 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                              </button>
                            ) : (
                              <p className="text-xs text-stone-400 dark:text-[#94A39B]/70">
                                {t.products.noRecipeYet}
                              </p>
                            )
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
                  </div>
                </div>

                {/* Touch-Friendly Footer Actions (40px-44px pill buttons left, isolated 40x40 trash icon far right) */}
                <div className="px-5 py-3.5 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="inline-flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-3.5 text-xs font-semibold rounded-full bg-stone-100/90 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {t.common.edit}
                    </button>

                    <button
                      type="button"
                      onClick={() => setLabelProduct(product)}
                      className="inline-flex items-center justify-center gap-1.5 h-10 min-h-[40px] px-3.5 text-xs font-semibold rounded-full bg-stone-100/90 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      {isVi ? 'In nhãn' : 'Labels'}
                    </button>
                  </div>

                  {confirmDeleteId === product.id ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteProduct(product.id);
                          setConfirmDeleteId(null);
                        }}
                        className="h-10 min-h-[40px] px-3 inline-flex items-center gap-1 text-xs font-semibold rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {t.common.delete}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        aria-label={t.common.cancel}
                        className="w-10 h-10 inline-flex items-center justify-center rounded-full text-stone-500 dark:text-[#94A39B] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(product.id)}
                      aria-label={t.common.delete}
                      title={t.common.delete}
                      className="w-10 h-10 inline-flex items-center justify-center rounded-full text-stone-400 dark:text-[#94A39B] hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-[#F87171] transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Bottom Bulk Action Bar (visible while Select Mode is active) */}
      {selectMode && (
        <div
          role="region"
          aria-label={isVi ? 'Thao tác hàng loạt' : 'Bulk selection actions'}
          className="sticky bottom-4 z-30 bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-md border-2 border-[#0F5C43]/40 dark:border-[#10B981]/50 rounded-xl px-4 py-3 shadow-lg space-y-2.5"
        >
          {bulkFeedback && (
            <div
              role={bulkFeedback.kind === 'error' ? 'alert' : 'status'}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2 ${
                bulkFeedback.kind === 'error'
                  ? 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-500/40'
                  : 'bg-emerald-50 dark:bg-[#064E3B] text-emerald-900 dark:text-[#D1FAE5] border border-emerald-200 dark:border-[#10B981]/40'
              }`}
            >
              <span>{bulkFeedback.text}</span>
              <button
                type="button"
                onClick={() => setBulkFeedback(null)}
                aria-label={t.common.close}
                className="w-7 h-7 inline-flex items-center justify-center rounded-md opacity-75 hover:opacity-100 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Left: Select All Filtered + Count + Clear */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={filteredProducts.length === 0 || bulkProcessing}
                onClick={toggleSelectAllFiltered}
                className="inline-flex items-center gap-2 h-11 min-h-[44px] px-3 text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] hover:bg-stone-200 dark:hover:bg-[#1F3028] border border-stone-200 dark:border-[#24352C] rounded-lg transition-colors disabled:opacity-50"
              >
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                    allFilteredSelected || someFilteredSelected
                      ? 'bg-[#0F5C43] border-[#0F5C43] text-white dark:bg-[#10B981] dark:border-[#10B981] dark:text-[#042419]'
                      : 'bg-white dark:bg-[#131D18] border-stone-300 dark:border-[#344E41]'
                  }`}
                >
                  {allFilteredSelected ? (
                    <Check className="w-3 h-3 stroke-[3]" />
                  ) : someFilteredSelected ? (
                    <Minus className="w-3 h-3 stroke-[3]" />
                  ) : null}
                </span>
                {allFilteredSelected
                  ? isVi
                    ? 'Bỏ chọn tất cả'
                    : 'Deselect All'
                  : isVi
                    ? `Chọn tất cả (${filteredProducts.length})`
                    : `Select All (${filteredProducts.length})`}
              </button>

              <span className="text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] font-mono-num">
                {selectedCount} {isVi ? 'đã chọn' : 'selected'}
              </span>

              {selectedCount > 0 && (
                <button
                  type="button"
                  disabled={bulkProcessing}
                  onClick={() => {
                    setSelectedIds(new Set());
                    setConfirmBulkDelete(false);
                    setBulkFeedback(null);
                  }}
                  className="h-10 px-2.5 text-xs font-medium text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg transition-colors"
                >
                  {isVi ? 'Bỏ chọn' : 'Clear'}
                </button>
              )}
            </div>

            {/* Right: Change Category + Delete Selected */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <select
                  value={bulkCategory}
                  disabled={bulkProcessing}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  aria-label={isVi ? 'Danh mục đích' : 'Target category'}
                  className="h-11 min-h-[44px] px-3 text-xs font-medium bg-white dark:bg-[#18251F] text-stone-800 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                >
                  {productCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {getCategoryDisplayName(cat, isVi)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={selectedCount === 0 || bulkProcessing}
                  onClick={handleBulkReassignCategory}
                  className="inline-flex items-center gap-1.5 h-11 min-h-[44px] px-4 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                >
                  {bulkAction === 'category' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderInput className="w-3.5 h-3.5" />
                  )}
                  {isVi ? 'Đổi danh mục' : 'Change Category'}
                </button>
              </div>

              <div
                className="h-6 w-px bg-stone-200 dark:bg-[#24352C] hidden sm:block"
                aria-hidden="true"
              />

              {confirmBulkDelete ? (
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={bulkProcessing}
                    onClick={handleBulkDelete}
                    className="inline-flex items-center gap-1.5 h-11 min-h-[44px] px-4 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {bulkAction === 'delete' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    {isVi ? `Xác nhận xóa (${selectedCount})` : `Confirm Delete (${selectedCount})`}
                  </button>
                  <button
                    type="button"
                    disabled={bulkProcessing}
                    onClick={() => setConfirmBulkDelete(false)}
                    className="h-11 min-h-[44px] px-3 text-xs font-medium text-stone-600 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={selectedCount === 0 || bulkProcessing}
                  onClick={() => setConfirmBulkDelete(true)}
                  className="inline-flex items-center gap-1.5 h-11 min-h-[44px] px-4 text-xs font-semibold text-red-700 dark:text-[#F87171] bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/70 border border-red-200 dark:border-red-500/40 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isVi
                    ? selectedCount > 0
                      ? `Xóa đã chọn (${selectedCount})`
                      : 'Xóa đã chọn'
                    : selectedCount > 0
                      ? `Delete Selected (${selectedCount})`
                      : 'Delete Selected'}
                </button>
              )}
            </div>
          </div>
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
        initialFocusSection={initialFocusSection}
        onSave={saveProduct}
        onClose={() => {
          setModalOpen(false);
          setInitialFocusSection(null);
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
