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
  FolderInput,
  Layers,
  LayoutGrid,
  Loader2,
  Minus,
  MoreVertical,
  Package,
  PackagePlus,
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
  BarcodeFormat,
  ExternalBarcodePrefill,
  Ingredient,
  Product,
  ProductType,
} from '../types';
import { formatBarcodeTypeLabel, matchesBarcodeSearch } from '../utils/barcodeRegistry';
import {
  calculateProductCogs,
  calculateRecipeCogs,
  formatKhr,
  formatQty,
} from '../utils/format';
import { compressImageBlobToDataUrl } from '../utils/image';
import {
  getCategoriesForScope,
  getCategoryById,
  getCategoryDisplayName,
  getProductTypeBadgeClass,
  resolveProductCategoryId,
  UNCATEGORIZED_ID,
} from '../utils/categories';
import { ProductPhoto } from '../components/ProductPhoto';
import { ProductFormModal } from '../components/ProductFormModal';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { BarcodeLabelModal } from '../components/BarcodeLabelModal';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { InfoHint } from '../components/InfoHint';
import { FloatingActionBar } from '../components/FloatingActionBar';
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
  onRestockExistingProduct?: (product: Product) => void;
  onEditExistingIngredient?: (ingredient: Ingredient) => void;
  onRestockExistingIngredient?: (ingredient: Ingredient) => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  autoOpenAdd = false,
  onAutoOpenHandled,
  onRestockExistingProduct,
  onEditExistingIngredient,
  onRestockExistingIngredient,
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
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(() => new Set());

  // Floating row action popover state (Table View)
  const [openMenuProductId, setOpenMenuProductId] = useState<string | null>(null);
  const [menuCoords, setMenuCoords] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    placement: 'down' | 'up';
  } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const closeRowActionMenu = () => {
    setOpenMenuProductId(null);
    setMenuCoords(null);
  };

  const toggleRowActionMenu = (productId: string, triggerEl: HTMLButtonElement) => {
    if (openMenuProductId === productId) {
      closeRowActionMenu();
      return;
    }
    const rect = triggerEl.getBoundingClientRect();
    const estimatedMenuHeight = 164;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: 'down' | 'up' =
      spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight ? 'up' : 'down';
    const right = Math.max(12, window.innerWidth - rect.right);

    setOpenMenuProductId(productId);
    setMenuCoords(
      placement === 'down'
        ? { top: rect.bottom + 6, right, placement }
        : { bottom: window.innerHeight - rect.top + 6, right, placement }
    );
  };

  const activeMenuProduct = useMemo(
    () => (openMenuProductId ? products.find((p) => p.id === openMenuProductId) || null : null),
    [openMenuProductId, products]
  );

  useEffect(() => {
    if (!openMenuProductId) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (actionMenuRef.current?.contains(target)) return;
      if (target.closest('[data-row-menu-trigger="true"]')) return;
      closeRowActionMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRowActionMenu();
      }
    };

    const handleScrollOrResize = () => {
      closeRowActionMenu();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [openMenuProductId]);

  useEffect(() => {
    closeRowActionMenu();
  }, [viewMode]);

  const handleMenuDeleteProduct = async (product: Product) => {
    closeRowActionMenu();
    const displayName = isVi ? product.nameVi || product.name : product.name;
    await deleteProduct(product.id);
    showUndoToast({
      message: isVi ? `Đã xóa "${displayName}"` : `Deleted "${displayName}"`,
      detail: isVi ? 'Sản phẩm đã xóa khỏi danh mục' : 'Removed from product catalog',
      onUndo: async () => {
        await saveProduct(product);
        triggerHighlightProduct(product.id);
      },
    });
  };

  const toggleCardDetails = (productId: string) => {
    setExpandedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Quick-action states (inline POS visibility toggle + inline photo upload)
  const [togglingActiveIds, setTogglingActiveIds] = useState<Record<string, boolean>>({});
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [photoTargetProduct, setPhotoTargetProduct] = useState<Product | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const inlinePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const { showUndoToast } = useUndoToast();

  // Brief highlight for newly saved product without disturbing scroll position
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const triggerHighlightProduct = (productId: string) => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    setHighlightedProductId(productId);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedProductId((prev) => (prev === productId ? null : prev));
      highlightTimerRef.current = null;
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Barcode Scan / Lookup & Label Studio state
  const [scanLookupOpen, setScanLookupOpen] = useState(false);
  const [scanLookingUp, setScanLookingUp] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scannedMatch, setScannedMatch] = useState<{
    code: string;
    format: BarcodeFormat;
    product: Product | null;
    ingredient: Ingredient | null;
    prefill: ExternalBarcodePrefill | null;
  } | null>(null);
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

  const drawerFilterCount = categoryFilter !== 'all' ? 1 : 0;
  const hasActiveFilters =
    categoryFilter !== 'all' || typeFilter !== 'ALL' || search.trim().length > 0;

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
    let activeOnPos = 0;
    for (const p of products) {
      if (p.productType === 'PREPARED_TO_ORDER') madeToOrder += 1;
      else if (p.productType === 'PACKAGED') packaged += 1;
      if (p.active !== false) activeOnPos += 1;
    }
    return {
      ALL: products.length,
      PREPARED_TO_ORDER: madeToOrder,
      PACKAGED: packaged,
      activeOnPos,
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
      const productBarcodes = [
        p.barcode,
        ...(p.packagingBarcodes || []).map((pb) => pb.barcode),
        ...(p.variants || []).map((v) => v.barcode),
      ];
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameVi.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        matchesBarcodeSearch(productBarcodes, search)
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
    setScannedMatch(null);
    try {
      const res = await lookupBarcode(cleaned);
      const effectiveCode = res.code || cleaned;

      if (res.found && res.product) {
        // Automatically search the product catalog for the matched product barcode
        setTypeFilter('ALL');
        setCategoryFilter('all');
        setSearch(effectiveCode);
        resetQuickScanSeed();
        triggerHighlightProduct(res.product.id);
        setScannedMatch({
          code: effectiveCode,
          format: res.format,
          product: res.product,
          ingredient: null,
          prefill: null,
        });
      } else if (res.found && res.ingredient) {
        // Cross-item match from Firestore barcodeRegistry (raw ingredient)
        resetQuickScanSeed();
        setScannedMatch({
          code: effectiveCode,
          format: res.format,
          product: null,
          ingredient: res.ingredient,
          prefill: null,
        });
      } else {
        setTypeFilter('ALL');
        setCategoryFilter('all');
        setSearch(effectiveCode);
        setScannedMatch({
          code: effectiveCode,
          format: res.format,
          product: null,
          ingredient: null,
          prefill: res.externalPrefill || null,
        });
      }
    } finally {
      setScanLookingUp(false);
    }
  };

  const openRegisterFromScan = () => {
    if (!scannedMatch) return;
    setEditingProduct(null);
    setInitialFocusSection(null);
    setQuickInitialBarcode(scannedMatch.code);
    setQuickInitialPrefill(scannedMatch.prefill);
    setQuickNotFoundExternally(!scannedMatch.prefill);
    setModalOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Hidden shared file input for inline catalog photo uploads */}
      <input
        ref={inlinePhotoInputRef}
        type="file"
        accept="image/*"
        onChange={handleInlinePhotoSelected}
        className="hidden"
        aria-hidden="true"
      />

      {/* Row 1: Minimalist Page Header — Title, Single Subtitle Line & Strictly 2 Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/60 dark:border-emerald-950/50">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="font-display text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
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
          <p className="mt-1 text-xs sm:text-sm text-stone-500 dark:text-[#94A39B] font-mono-num flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>
              {typeCounts.ALL}{' '}
              {isVi ? 'sản phẩm' : typeCounts.ALL === 1 ? 'item' : 'items'}
            </span>
            <span className="text-stone-300 dark:text-[#2F463A]" aria-hidden="true">
              ·
            </span>
            <span>
              {typeCounts.activeOnPos}{' '}
              {isVi ? 'đang bán tại POS' : 'active on POS'}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={toggleSelectMode}
            aria-pressed={selectMode}
            className={`inline-flex items-center justify-center gap-1.5 h-11 px-3.5 text-sm font-medium rounded-lg border transition-all duration-150 ease-out whitespace-nowrap ${
              selectMode
                ? 'bg-emerald-50/80 border-emerald-500/40 text-[#0F5C43] dark:bg-[#064E3B]/70 dark:border-[#10B981]/50 dark:text-[#6EE7B7]'
                : 'text-stone-600 dark:text-[#A8B8B0] bg-transparent border-slate-200/80 dark:border-emerald-950/80 hover:bg-stone-100/80 dark:hover:bg-[#18251F] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
            }`}
          >
            <CheckSquare className="w-4 h-4 shrink-0" />
            <span>
              {selectMode
                ? isVi
                  ? 'Xong'
                  : 'Done'
                : isVi
                  ? 'Chọn'
                  : 'Select'}
            </span>
          </button>

          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg shadow-2xs transition-all duration-150 ease-out active:scale-[0.98] whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{isVi ? 'Thêm sản phẩm' : 'Add Product'}</span>
          </button>
        </div>
      </div>

      {scannedMatch && (
        <div
          role="status"
          className={`px-4 py-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            scannedMatch.product || scannedMatch.ingredient
              ? 'bg-emerald-50 dark:bg-[#064E3B]/75 border-emerald-200 dark:border-[#10B981]/45 text-emerald-950 dark:text-[#D1FAE5]'
              : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-600/50 text-amber-950 dark:text-amber-100'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ScanBarcode
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                scannedMatch.product || scannedMatch.ingredient
                  ? 'text-[#0F5C43] dark:text-[#34D399]'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <div className="min-w-0">
              {scannedMatch.product ? (
                <>
                  <p className="text-sm font-semibold truncate">
                    {isVi ? 'Đã tìm thấy' : 'Matched'}:{' '}
                    {isVi
                      ? scannedMatch.product.nameVi || scannedMatch.product.name
                      : scannedMatch.product.name}
                  </p>
                  <p className="text-xs opacity-85 font-mono-num mt-0.5">
                    {formatBarcodeTypeLabel(scannedMatch.format)} · {scannedMatch.code}
                  </p>
                </>
              ) : scannedMatch.ingredient ? (
                <>
                  <p className="text-sm font-semibold truncate">
                    {isVi ? 'Đã tìm thấy nguyên liệu trong kho' : 'Matched Raw Ingredient'}:{' '}
                    {isVi
                      ? scannedMatch.ingredient.nameVi || scannedMatch.ingredient.name
                      : scannedMatch.ingredient.name}
                  </p>
                  <p className="text-xs opacity-85 font-mono-num mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    <span>
                      {formatBarcodeTypeLabel(scannedMatch.format)} · {scannedMatch.code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {isVi ? 'Tồn kho' : 'In stock'}:{' '}
                      {formatQty(scannedMatch.ingredient.stockQty, scannedMatch.ingredient.unit)}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">
                    {isVi ? 'Không tìm thấy sản phẩm cho mã' : 'No catalog item matches'}{' '}
                    <span className="font-mono-num">{scannedMatch.code}</span>{' '}
                    <span className="text-xs font-normal opacity-80">
                      ({formatBarcodeTypeLabel(scannedMatch.format)})
                    </span>
                  </p>
                  <p className="text-xs opacity-85 mt-0.5 truncate">
                    {scannedMatch.prefill
                      ? isVi
                        ? `Gợi ý từ Open Food Facts: ${scannedMatch.prefill.name}${scannedMatch.prefill.brand ? ` · ${scannedMatch.prefill.brand}` : ''}`
                        : `Found externally: ${scannedMatch.prefill.name}${scannedMatch.prefill.brand ? ` · ${scannedMatch.prefill.brand}` : ''}`
                      : isVi
                        ? 'Bạn có thể đăng ký nhanh sản phẩm mới với mã vạch này.'
                        : 'Register a new product with this barcode to add it to your catalog.'}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {scannedMatch.product ? (
              <>
                <button
                  type="button"
                  onClick={() => openEdit(scannedMatch.product!)}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {isVi ? 'Sửa sản phẩm' : 'Edit Product'}
                </button>
                <button
                  type="button"
                  onClick={() => setLabelProduct(scannedMatch.product!)}
                  className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-[#D1FAE5] bg-white/90 dark:bg-[#131D18] border border-emerald-300 dark:border-[#10B981]/40 hover:bg-white dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  {isVi ? 'In nhãn' : 'Label'}
                </button>
              </>
            ) : scannedMatch.ingredient ? (
              <>
                {onRestockExistingIngredient && (
                  <button
                    type="button"
                    onClick={() => onRestockExistingIngredient(scannedMatch.ingredient!)}
                    className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    {isVi ? '+ Nhập kho' : '+ Restock'}
                  </button>
                )}
                {onEditExistingIngredient && (
                  <button
                    type="button"
                    onClick={() => onEditExistingIngredient(scannedMatch.ingredient!)}
                    className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 dark:text-[#D1FAE5] bg-white/90 dark:bg-[#131D18] border border-emerald-300 dark:border-[#10B981]/40 hover:bg-white dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    {isVi ? 'Mở trong Kho' : 'Edit in Inventory'}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={openRegisterFromScan}
                className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
              >
                {isVi ? '+ Đăng ký sản phẩm' : '+ Register Product'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setScannedMatch(null);
                setSearch('');
              }}
              className="h-9 px-2.5 inline-flex items-center justify-center text-xs font-semibold rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              {isVi ? 'Xóa tìm' : 'Clear'}
            </button>
          </div>
        </div>
      )}

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

      {/* Row 2: Unboxed Single-Strip Toolbar (Search & Filters Left → Segmented Tabs & View Switcher Right) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Side: Search (with integrated barcode icon), Filters toggle & conditional Reset */}
          <div className="flex items-center gap-2.5 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md min-w-[160px]">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#6E8278] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (scannedMatch) setScannedMatch(null);
                }}
                placeholder={isVi ? 'Tìm kiếm' : 'Search'}
                className={`w-full h-11 pl-9 ${search ? 'pr-20' : 'pr-11'} text-sm bg-white/80 dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#6E8278] border border-slate-200/80 dark:border-emerald-950/80 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]/30 dark:focus-visible:ring-[#10B981]/40 focus-visible:border-[#0F5C43] dark:focus-visible:border-[#10B981] transition-all duration-150`}
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setScannedMatch(null);
                    }}
                    className="w-9 h-9 inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-md transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={scanLookingUp}
                  onClick={() => setScanLookupOpen(true)}
                  title={isVi ? 'Quét mã vạch (EAN-13 / UPC-A)' : 'Scan Barcode (EAN-13 / UPC-A)'}
                  aria-label={isVi ? 'Quét mã vạch' : 'Scan Barcode'}
                  className="w-9 h-9 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#34D399] hover:bg-emerald-50/70 dark:hover:bg-[#064E3B]/50 rounded-md transition-colors"
                >
                  {scanLookingUp ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#0F5C43] dark:text-[#34D399]" />
                  ) : (
                    <ScanBarcode className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleFilters}
              aria-expanded={filtersOpen}
              aria-controls="products-catalog-filters"
              className={`inline-flex items-center gap-1.5 h-11 px-3 text-xs sm:text-sm font-medium rounded-lg border transition-all duration-150 whitespace-nowrap shrink-0 ${
                filtersOpen || drawerFilterCount > 0
                  ? 'bg-stone-100/90 dark:bg-[#18251F] border-slate-300/90 dark:border-emerald-800/60 text-stone-900 dark:text-[#F1F5F3]'
                  : 'bg-transparent border-slate-200/80 dark:border-emerald-950/80 text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100/70 dark:hover:bg-[#18251F]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <span>{isVi ? 'Bộ lọc' : 'Filters'}</span>
              {drawerFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-mono-num font-semibold bg-[#0F5C43]/12 text-[#0F5C43] dark:bg-[#10B981]/20 dark:text-[#6EE7B7]">
                  {drawerFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] transition-transform duration-150 motion-reduce:transition-none ${
                  filtersOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Reset Link — Only Visible When a Filter or Search Is Active */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setTypeFilter('ALL');
                  setSearch('');
                  setScannedMatch(null);
                }}
                className="inline-flex items-center justify-center h-11 px-2 text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-[#94A39B] dark:hover:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
              >
                {isVi ? 'Đặt lại' : 'Reset'}
              </button>
            )}
          </div>

          {/* Right Side: Segmented Item-Type Tabs & Compact Grid / Table Switcher */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="min-w-0 max-w-full overflow-x-auto">
              <div
                role="tablist"
                aria-label={isVi ? 'Phân loại sản phẩm' : 'Product types'}
                className="inline-flex items-center gap-0.5 h-11 p-1 bg-stone-100/90 dark:bg-[#131D18] border border-slate-200/60 dark:border-emerald-950/60 rounded-xl"
              >
                {(
                  [
                    {
                      id: 'ALL',
                      label: isVi ? 'Tất cả' : 'All',
                      count: typeCounts.ALL,
                      icon: null,
                      iconClass: '',
                    },
                    {
                      id: 'PREPARED_TO_ORDER',
                      label: t.productTypes.PREPARED_TO_ORDER,
                      count: typeCounts.PREPARED_TO_ORDER,
                      icon: CupSoda,
                      iconClass: 'text-emerald-600 dark:text-emerald-400',
                    },
                    {
                      id: 'PACKAGED',
                      label: t.productTypes.PACKAGED,
                      count: typeCounts.PACKAGED,
                      icon: Package,
                      iconClass: 'text-sky-600 dark:text-sky-400',
                    },
                  ] as const
                ).map((tab) => {
                  const active = typeFilter === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTypeFilter(tab.id)}
                      className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs sm:text-sm rounded-lg transition-all duration-150 ease-out whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-white dark:bg-[#1F3028] text-stone-900 dark:text-[#F1F5F3] font-semibold shadow-2xs'
                          : 'text-stone-500 dark:text-[#94A39B] font-medium hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                      }`}
                    >
                      {TabIcon && <TabIcon className={`w-3.5 h-3.5 shrink-0 ${tab.iconClass}`} />}
                      <span>{tab.label}</span>
                      <span className="font-mono-num text-[11px] opacity-65">
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Compact Grid / Table Icon Switcher */}
            <div
              role="group"
              aria-label={isVi ? 'Chế độ hiển thị danh mục' : 'Catalog layout view'}
              className="inline-flex items-center gap-0.5 h-11 p-1 bg-stone-100/90 dark:bg-[#131D18] border border-slate-200/60 dark:border-emerald-950/60 rounded-lg shrink-0"
            >
              <button
                type="button"
                onClick={() => handleSetViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                aria-label={isVi ? 'Xem dạng lưới' : 'Grid view'}
                title={isVi ? 'Xem dạng lưới' : 'Grid view'}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md transition-all duration-150 ease-out ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-[#1F3028] text-stone-900 dark:text-[#F1F5F3] shadow-2xs'
                    : 'text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                aria-pressed={viewMode === 'table'}
                aria-label={isVi ? 'Xem dạng bảng' : 'Table view'}
                title={isVi ? 'Xem dạng bảng' : 'Table view'}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-md transition-all duration-150 ease-out ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-[#1F3028] text-stone-900 dark:text-[#F1F5F3] shadow-2xs'
                    : 'text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                <Table2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Category Filter Drawer (Unboxed, Hairline Top Divider) */}
        <div
          id="products-catalog-filters"
          className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
            filtersOpen
              ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-slate-200/60 dark:border-emerald-950/50'
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
        /* 5-COLUMN ALIGNED TABLE VIEW WITH COMPACT FLOATING ROW MENU */
        <div className="w-full max-w-full bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50 dark:bg-[#18251F]">
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
                  <th className="px-2.5 py-3 pl-3.5 font-medium">
                    {isVi ? 'Sản phẩm / SKU' : 'Product / SKU'}
                  </th>
                  <th className="px-2.5 py-3 font-medium whitespace-nowrap">
                    {isVi ? 'Loại · Danh mục' : 'Type · Category'}
                  </th>
                  <th className="px-2.5 py-3 font-medium whitespace-nowrap">
                    {isVi ? 'POS · Kho / Công thức' : 'Status · Stock'}
                  </th>
                  <th className="px-2.5 py-3 font-medium text-right whitespace-nowrap">
                    {isVi ? 'Giá & Biên lãi' : 'Price & Margin'}
                  </th>
                  <th className="w-14 px-2.5 py-3 pr-3.5 font-medium text-right whitespace-nowrap">
                    <span className="sr-only">{t.common.actions}</span>
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
                  const isDirectStock = product.productType === 'PACKAGED';
                  const isLowStock = isDirectStock && product.stockQty <= product.reorderLevel;
                  const isUnlinkedRecipe =
                    product.productType === 'PREPARED_TO_ORDER' && !hasLinkedRecipe(product);
                  const isNegativeMargin = !isUnlinkedRecipe && profit < 0;
                  const isZeroCost = !isUnlinkedRecipe && cogs <= 0;
                  const isToggling = Boolean(togglingActiveIds[product.id]);
                  const isUploading = uploadingPhotoId === product.id;
                  const isSelected = activeSelectedIds.has(product.id);
                  const isHighlighted = highlightedProductId === product.id;
                  const isMenuOpen = openMenuProductId === product.id;
                  const catItem = getCategoryById(
                    resolveProductCategoryId(product, categories),
                    categories
                  );

                  return (
                    <tr
                      key={product.id}
                      onClick={(e) => {
                        if (!selectMode) return;
                        if ((e.target as HTMLElement).closest('button, select, input, a')) return;
                        toggleSelectItem(product.id);
                      }}
                      className={`group/row transition-colors ${
                        selectMode ? 'cursor-pointer' : ''
                      } ${
                        isHighlighted
                          ? 'bg-emerald-50 dark:bg-[#0D382B] ring-2 ring-inset ring-[#10B981]/60'
                          : isSelected
                            ? 'bg-emerald-50 dark:bg-[#0B2E23]'
                            : isMenuOpen
                              ? 'bg-stone-50 dark:bg-[#18251F]'
                              : 'bg-white dark:bg-[#131D18] hover:bg-stone-50 dark:hover:bg-[#18251F]'
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

                      {/* Col 1: Product Thumbnail + Name + SKU */}
                      <td className="px-2.5 py-3 pl-3.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-stone-200/80 dark:border-[#24352C]">
                            <ProductPhoto
                              src={product.imageUrl}
                              alt={displayName}
                              category={product.category}
                              className="w-10 h-10"
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
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Camera className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p
                              className="font-semibold text-stone-900 dark:text-[#F1F5F3] truncate max-w-[165px] sm:max-w-[200px] xl:max-w-[240px]"
                              title={displayName}
                            >
                              {displayName}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num truncate max-w-[165px] sm:max-w-[200px] xl:max-w-[240px]">
                              {[product.brand, product.barcode ? `SKU ${product.barcode}` : '']
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Col 2: Canonical Type Badge · Category */}
                      <td className="px-2.5 py-3 text-xs">
                        <div className="inline-flex items-center gap-1.5 text-stone-600 dark:text-[#94A39B] max-w-[230px] xl:max-w-none">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium shrink-0 ${getProductTypeBadgeClass(
                              product.productType
                            )}`}
                          >
                            {product.productType === 'PACKAGED' ? (
                              <Package className="w-3 h-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <CupSoda className="w-3 h-3 shrink-0" aria-hidden="true" />
                            )}
                            <span>{t.productTypes[product.productType]}</span>
                          </span>
                          <span className="text-stone-300 dark:text-[#344E41] shrink-0" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-stone-500 dark:text-[#94A39B] truncate">
                            {getCategoryDisplayName(catItem, isVi)}
                          </span>
                        </div>
                      </td>

                      {/* Col 3: POS Visibility Toggle + Stock / Recipe Status */}
                      <td className="px-2.5 py-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={() => handleTogglePosVisibility(product)}
                            aria-pressed={product.active}
                            className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold transition-colors ${
                              product.active
                                ? 'bg-[#10B981]/15 text-[#0F5C43] border border-[#10B981]/35 hover:bg-[#10B981]/25 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/40'
                                : 'bg-stone-100 text-stone-600 border border-stone-200 hover:bg-stone-200/80 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C]'
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
                                ? 'Đang ẩn'
                                : 'Hidden'}
                          </button>

                          <div className="text-xs leading-tight">
                            {isDirectStock ? (
                              <span
                                className={`font-mono-num font-semibold ${
                                  product.stockQty <= 0
                                    ? 'text-red-600 dark:text-[#F87171]'
                                    : isLowStock
                                      ? 'text-amber-700 dark:text-amber-300'
                                      : 'text-emerald-700 dark:text-[#34D399]'
                                }`}
                              >
                                {formatQty(product.stockQty, product.unit)}{' '}
                                <span className="font-sans font-normal text-stone-500 dark:text-[#94A39B]">
                                  {isVi ? 'tồn kho' : 'in stock'}
                                </span>
                              </span>
                            ) : isUnlinkedRecipe ? (
                              <button
                                type="button"
                                onClick={() => openEdit(product, 'recipe')}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                              >
                                <Plus className="w-3 h-3 shrink-0" />
                                {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                              </button>
                            ) : product.variants && product.variants.length > 0 ? (
                              <span className="text-stone-600 dark:text-[#94A39B] font-medium">
                                {product.variants.length} {isVi ? 'kích cỡ' : 'sizes'}
                              </span>
                            ) : (
                              <span className="text-stone-600 dark:text-[#94A39B] font-medium">
                                {product.recipe.length} {isVi ? 'nguyên liệu' : 'ingredients'}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Col 4: Merged Price & Margin Column (Fully Unblocked) */}
                      <td className="px-2.5 py-3 text-right whitespace-nowrap">
                        <div className="font-mono-num text-sm font-bold text-[#0F5C43] dark:text-[#34D399]">
                          {product.variants && product.variants.length > 1
                            ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                            : formatKhr(basePrice)}
                        </div>
                        <div className="mt-0.5 text-xs font-mono-num flex items-center justify-end gap-1">
                          {isUnlinkedRecipe ? (
                            <span className="inline-flex items-center gap-1 font-sans font-semibold text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              {isVi ? 'Chưa gắn công thức' : 'No Recipe Linked'}
                            </span>
                          ) : isNegativeMargin ? (
                            <span className="font-semibold text-red-600 dark:text-[#F87171]">
                              {isVi ? 'Vốn' : 'Cost'} {formatKhr(cogs)} · {margin}%
                            </span>
                          ) : isZeroCost ? (
                            <>
                              <span className="font-semibold text-amber-700 dark:text-amber-300">
                                {isVi ? 'Vốn' : 'Cost'} {formatKhr(0)}
                              </span>
                              <span className="text-stone-300 dark:text-[#344E41]" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-stone-500 dark:text-[#94A39B]">{margin}%</span>
                            </>
                          ) : (
                            <>
                              <span className="text-stone-500 dark:text-[#94A39B]">
                                {isVi ? 'Vốn' : 'Cost'} {formatKhr(cogs)}
                              </span>
                              <span className="text-stone-300 dark:text-[#344E41]" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-semibold text-emerald-700 dark:text-[#34D399]">
                                {margin}%
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Col 5: Single Compact 40x40 MoreVertical Menu Trigger */}
                      <td className="w-14 px-2.5 py-3 pr-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          data-row-menu-trigger="true"
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          aria-label={
                            isVi
                              ? `Thao tác cho ${displayName}`
                              : `Actions for ${displayName}`
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRowActionMenu(product.id, e.currentTarget);
                          }}
                          className={`w-10 h-10 inline-flex items-center justify-center rounded-xl border transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] ${
                            isMenuOpen
                              ? 'bg-[#E6F2ED] border-[#0F5C43]/40 text-[#0F5C43] dark:bg-[#064E3B] dark:border-[#10B981]/50 dark:text-[#6EE7B7]'
                              : 'bg-white dark:bg-[#18251F] border-stone-200 dark:border-[#24352C] text-stone-600 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:border-stone-300 dark:hover:border-[#344E41]'
                          }`}
                        >
                          <MoreVertical className="w-4 h-4 shrink-0" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CLEAN & CONCISE DETAILS / GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
          {filteredProducts.map((product) => {
            const firstVariant = product.variants?.[0];
            const cogs = Math.round(calculateProductCogs(product, ingredients, firstVariant));
            const basePrice = firstVariant ? firstVariant.priceKhr : product.priceKhr;
            const profit = basePrice - cogs;
            const margin = basePrice > 0 ? Math.round((profit / basePrice) * 100) : 0;
            const displayName = isVi ? product.nameVi || product.name : product.name;
            const isDirectStock = product.productType === 'PACKAGED';
            const isLowStock = isDirectStock && product.stockQty <= product.reorderLevel;
            const isUnlinkedRecipe =
              product.productType === 'PREPARED_TO_ORDER' && !hasLinkedRecipe(product);
            const isNegativeMargin = !isUnlinkedRecipe && profit < 0;
            const isZeroCost = !isUnlinkedRecipe && cogs <= 0;
            const isToggling = Boolean(togglingActiveIds[product.id]);
            const isUploading = uploadingPhotoId === product.id;
            const isSelected = activeSelectedIds.has(product.id);
            const isHighlighted = highlightedProductId === product.id;
            const isExpanded = expandedCardIds.has(product.id);
            const catItem = getCategoryById(
              resolveProductCategoryId(product, categories),
              categories
            );

            return (
              <div
                key={product.id}
                onClick={(e) => {
                  if (!selectMode) return;
                  if ((e.target as HTMLElement).closest('button, select, input, a')) return;
                  toggleSelectItem(product.id);
                }}
                className={`group rounded-xl overflow-hidden flex flex-col transition-all duration-150 ease-out pos-lift ${
                  selectMode ? 'cursor-pointer' : ''
                } ${
                  isHighlighted
                    ? 'bg-emerald-50/50 dark:bg-[#064E3B]/30 border-2 border-[#10B981] ring-2 ring-[#10B981]/35'
                    : isSelected
                      ? 'bg-white dark:bg-[#131D18] border-2 border-[#0F5C43] ring-2 ring-[#0F5C43]/20 dark:border-[#10B981] dark:ring-[#10B981]/25'
                      : 'bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:border-stone-300 dark:hover:border-[#344E41] hover:shadow-xs'
                }`}
              >
                {/* Part 1: Top Visual & Top-Right Interactive POS Status Badge */}
                <div className="relative h-36 sm:h-40 w-full overflow-hidden shrink-0">
                  <ProductPhoto
                    src={product.imageUrl}
                    alt={displayName}
                    category={product.category}
                    className="w-full h-36 sm:h-40"
                  />

                  {/* Bulk Selection Checkbox Overlay (Top-Left, visible in Select Mode) */}
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
                      className="absolute top-1.5 left-1.5 z-10 w-10 h-10 inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
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

                  {/* Compact Interactive POS Status Badge (Top-Right) */}
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
                    className={`absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold shadow-sm backdrop-blur-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      product.active
                        ? 'bg-[#10B981] text-white dark:text-[#042419] hover:bg-[#059669]'
                        : 'bg-stone-800/85 text-stone-100 hover:bg-stone-900 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800'
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
                          ? 'Đang ẩn'
                          : 'Hidden'}
                    </span>
                  </button>

                  {/* Subtle Bottom-Center Inline Photo Upload Trigger when no photo is uploaded */}
                  {!product.imageUrl && (
                    <div className="absolute inset-0 flex items-end justify-center pb-2.5 pointer-events-none">
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => triggerInlinePhotoUpload(product)}
                        className="pointer-events-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold bg-white/92 dark:bg-[#131D18]/92 text-stone-700 dark:text-[#F1F5F3] border border-stone-200/90 dark:border-[#24352C] shadow-xs hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] opacity-95 sm:opacity-85 sm:group-hover:opacity-100 transition-all cursor-pointer"
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

                {/* Part 2: Concise Body */}
                <div className="p-4 flex flex-col gap-3">
                  {/* Single-line Product Name + Clean Type · Category subtitle */}
                  <div className="min-w-0">
                    <h3
                      className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] truncate"
                      title={displayName}
                    >
                      {displayName}
                    </h3>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500 dark:text-[#94A39B] min-w-0">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-medium shrink-0 ${getProductTypeBadgeClass(
                          product.productType
                        )}`}
                      >
                        {product.productType === 'PACKAGED' ? (
                          <Package className="w-3 h-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <CupSoda className="w-3 h-3 shrink-0" aria-hidden="true" />
                        )}
                        <span>{t.productTypes[product.productType]}</span>
                      </span>
                      <span className="text-stone-300 dark:text-[#344E41] shrink-0" aria-hidden="true">
                        ·
                      </span>
                      <span className="truncate">{getCategoryDisplayName(catItem, isVi)}</span>
                    </div>
                  </div>

                  {/* Clean 2-Column Metric Row: Price | Margin / Stock */}
                  <div className="pt-3 border-t border-stone-100 dark:border-[#1F3028] grid grid-cols-[auto_1fr] gap-3 items-end">
                    <div>
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isVi ? 'Giá bán' : 'Price'}
                      </span>
                      <span className="font-mono-num text-base font-bold text-[#0F5C43] dark:text-[#34D399] whitespace-nowrap">
                        {product.variants && product.variants.length > 1
                          ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                          : formatKhr(basePrice)}
                      </span>
                    </div>

                    <div className="text-right min-w-0">
                      <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                        {isDirectStock
                          ? isVi
                            ? 'Tồn kho'
                            : 'Stock'
                          : isVi
                            ? 'Biên lãi / Công thức'
                            : 'Margin / Sizes'}
                      </span>
                      {isDirectStock ? (
                        <span
                          className={`block font-mono-num text-xs font-semibold truncate ${
                            product.stockQty <= 0
                              ? 'text-red-600 dark:text-[#F87171]'
                              : isLowStock
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-emerald-700 dark:text-[#34D399]'
                          }`}
                        >
                          {formatQty(product.stockQty, product.unit)}{' '}
                          <span className="font-sans font-normal text-stone-500 dark:text-[#94A39B]">
                            {isVi ? 'tồn kho' : 'in stock'}
                          </span>
                        </span>
                      ) : isUnlinkedRecipe ? (
                        <button
                          type="button"
                          onClick={() => openEdit(product, 'recipe')}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline truncate"
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>{isVi ? 'Chưa gắn công thức' : 'No recipe linked'}</span>
                        </button>
                      ) : (
                        <span
                          className={`block font-mono-num text-xs font-semibold truncate ${
                            isNegativeMargin
                              ? 'text-red-600 dark:text-[#F87171]'
                              : isZeroCost
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-emerald-700 dark:text-[#34D399]'
                          }`}
                        >
                          {margin}% {isVi ? 'lãi' : 'margin'}
                          <span className="font-sans font-normal text-stone-500 dark:text-[#94A39B]">
                            {' · '}
                            {product.variants && product.variants.length > 0
                              ? `${product.variants.length} ${isVi ? 'cỡ' : 'sizes'}`
                              : `${product.recipe.length} ${isVi ? 'nguyên liệu' : 'ingr.'}`}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Part 3: Collapsible Secondary Details Toggle & Drawer */}
                  <div className="pt-2.5 border-t border-stone-100 dark:border-[#1F3028]">
                    <button
                      type="button"
                      onClick={() => toggleCardDetails(product.id)}
                      aria-expanded={isExpanded}
                      className="w-full h-8 flex items-center justify-between gap-2 text-xs font-medium text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] transition-colors"
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                        <span>{isVi ? 'Chi tiết' : 'Details'}</span>
                        {!isExpanded && (
                          <span className="font-mono-num text-[11px] text-stone-400 dark:text-[#94A39B]/80 truncate">
                            {isUnlinkedRecipe
                              ? ''
                              : isZeroCost
                                ? `· ${isVi ? 'Vốn' : 'Cost'} ${formatKhr(0)}`
                                : `· ${isVi ? 'Vốn' : 'Cost'} ${formatKhr(cogs)}`}
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 text-stone-400 dark:text-[#94A39B] transition-transform duration-200 motion-reduce:transition-none ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="mt-2.5 pt-2.5 border-t border-stone-100 dark:border-[#1F3028] space-y-2.5 text-xs animate-drawer-in">
                        {/* Cost, Margin & SKU/Brand Breakdown */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-stone-500 dark:text-[#94A39B]">
                              {product.productType === 'PACKAGED'
                                ? isVi
                                  ? 'Giá vốn nhập'
                                  : 'Unit Cost'
                                : t.products.recipeCost}
                            </span>
                            <span
                              className={`font-mono-num font-semibold ${
                                isZeroCost
                                  ? 'text-amber-700 dark:text-amber-300'
                                  : 'text-stone-900 dark:text-[#F1F5F3]'
                              }`}
                            >
                              {isUnlinkedRecipe ? '—' : formatKhr(cogs)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-stone-500 dark:text-[#94A39B]">
                              {t.products.grossMargin}
                            </span>
                            {isUnlinkedRecipe ? (
                              <span className="font-semibold text-amber-700 dark:text-amber-300">
                                {isVi ? 'Chưa gắn công thức' : 'No Recipe Linked'}
                              </span>
                            ) : (
                              <span
                                className={`font-mono-num font-semibold ${
                                  isNegativeMargin
                                    ? 'text-red-600 dark:text-[#F87171]'
                                    : 'text-emerald-700 dark:text-[#34D399]'
                                }`}
                              >
                                {formatKhr(profit)} ({margin}%)
                              </span>
                            )}
                          </div>

                          <div className="flex items-start justify-between gap-2">
                            <span className="text-stone-500 dark:text-[#94A39B] shrink-0">
                              SKU / Barcode
                            </span>
                            <span className="font-mono-num text-right text-stone-800 dark:text-[#D5DFDA] break-all">
                              {product.barcode || '—'}
                            </span>
                          </div>

                          {product.brand && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-stone-500 dark:text-[#94A39B]">
                                {isVi ? 'Thương hiệu' : 'Brand'}
                              </span>
                              <span className="font-medium text-stone-800 dark:text-[#D5DFDA] truncate">
                                {product.brand}
                              </span>
                            </div>
                          )}

                          {product.productType === 'PACKAGED' && product.supplier && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-stone-500 dark:text-[#94A39B]">
                                {t.inventory.supplier}
                              </span>
                              <span className="font-medium text-stone-800 dark:text-[#D5DFDA] truncate">
                                {product.supplier}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Pack / Case Barcodes (Packaged Goods) */}
                        {product.productType === 'PACKAGED' &&
                          product.packagingBarcodes &&
                          product.packagingBarcodes.length > 0 && (
                            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] space-y-1">
                              <p className="font-medium text-stone-500 dark:text-[#94A39B]">
                                {isVi ? 'Mã đóng gói / Thùng' : 'Pack / Case Barcodes'}
                              </p>
                              {product.packagingBarcodes.map((pb, idx) => (
                                <div
                                  key={idx}
                                  className="flex justify-between gap-2 font-mono-num text-[11px]"
                                >
                                  <span className="text-stone-600 dark:text-[#94A39B]">
                                    {pb.label}
                                  </span>
                                  <span className="text-stone-800 dark:text-[#D5DFDA] break-all text-right">
                                    {pb.barcode} (×{pb.unitsPerPack})
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                        {/* Size Variant Breakdown */}
                        {product.productType !== 'PACKAGED' &&
                          product.variants &&
                          product.variants.length > 0 && (
                            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] space-y-1.5">
                              <p className="font-medium text-stone-500 dark:text-[#94A39B] flex items-center gap-1">
                                <Layers className="w-3.5 h-3.5" />
                                {isVi ? 'Kích cỡ & Giá bán' : 'Size Variants'} (
                                {product.variants.length})
                              </p>
                              <ul className="space-y-1">
                                {product.variants.map((v) => {
                                  const vCogs = Math.round(
                                    calculateRecipeCogs(v.recipe, ingredients)
                                  );
                                  return (
                                    <li
                                      key={v.id}
                                      className="flex justify-between gap-2 text-stone-700 dark:text-[#D5DFDA]"
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
                                  className="mt-1.5 w-full h-9 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/45 dark:hover:bg-amber-950/75 dark:text-amber-200 dark:border-amber-500/40 transition-colors"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                                </button>
                              )}
                            </div>
                          )}

                        {/* Linked Ingredient Recipe List */}
                        {product.productType !== 'PACKAGED' &&
                          (!product.variants || product.variants.length === 0) && (
                            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] space-y-1.5">
                              <p className="font-medium text-stone-500 dark:text-[#94A39B]">
                                {t.products.recipeSection}
                              </p>
                              {product.recipe.length === 0 ? (
                                isUnlinkedRecipe ? (
                                  <button
                                    type="button"
                                    onClick={() => openEdit(product, 'recipe')}
                                    className="w-full h-9 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/45 dark:hover:bg-amber-950/75 dark:text-amber-200 dark:border-amber-500/40 transition-colors"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    {isVi ? 'Gắn nguyên liệu' : 'Link Ingredients'}
                                  </button>
                                ) : (
                                  <p className="text-stone-400 dark:text-[#94A39B]/70">
                                    {t.products.noRecipeYet}
                                  </p>
                                )
                              ) : (
                                <ul className="space-y-1 text-stone-700 dark:text-[#D5DFDA]">
                                  {product.recipe.map((row, idx) => {
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
                    )}
                  </div>
                </div>

                {/* Card Footer Actions: Evenly aligned Edit, Label, Delete (h-9) */}
                <div className="px-4 py-3 border-t border-stone-100 dark:border-[#1F3028] bg-stone-50/40 dark:bg-[#0F1814]/40">
                  {confirmDeleteId === product.id ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-red-700 dark:text-[#F87171] truncate">
                        {isVi ? 'Xóa sản phẩm này?' : 'Delete this product?'}
                      </span>
                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteProduct(product.id);
                            setConfirmDeleteId(null);
                          }}
                          className="h-9 px-3 inline-flex items-center gap-1 text-xs font-medium rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5 shrink-0" />
                          <span>{t.common.delete}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          aria-label={t.common.cancel}
                          className="h-9 px-2.5 inline-flex items-center justify-center text-xs font-medium rounded-lg text-stone-600 dark:text-[#94A39B] hover:bg-stone-200/70 dark:hover:bg-[#1F3028] transition-colors"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="h-9 px-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors whitespace-nowrap"
                      >
                        <Edit2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{t.common.edit}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setLabelProduct(product)}
                        className="h-9 px-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] hover:text-[#0F5C43] dark:hover:border-[#10B981] dark:hover:text-[#34D399] transition-colors whitespace-nowrap"
                      >
                        <QrCode className="w-3.5 h-3.5 shrink-0" />
                        <span>{isVi ? 'Nhãn' : 'Label'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(product.id)}
                        className="h-9 px-2.5 text-xs font-medium inline-flex items-center justify-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-[#F87171] border border-red-200/80 dark:border-red-500/30 hover:bg-red-100 dark:hover:bg-red-950/70 transition-colors whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{t.common.delete}</span>
                      </button>
                    </div>
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
        onSaved={(savedProd) => triggerHighlightProduct(savedProd.id)}
        onEditExisting={(prod) => {
          setEditingProduct(prod);
          setInitialFocusSection(null);
          resetQuickScanSeed();
        }}
        onRestockExisting={(prod) => {
          setModalOpen(false);
          setInitialFocusSection(null);
          resetQuickScanSeed();
          onRestockExistingProduct?.(prod);
        }}
        onEditExistingIngredient={(ing) => {
          setModalOpen(false);
          setInitialFocusSection(null);
          resetQuickScanSeed();
          onEditExistingIngredient?.(ing);
        }}
        onRestockExistingIngredient={(ing) => {
          setModalOpen(false);
          setInitialFocusSection(null);
          resetQuickScanSeed();
          onRestockExistingIngredient?.(ing);
        }}
        onClose={() => {
          setModalOpen(false);
          setInitialFocusSection(null);
          resetQuickScanSeed();
        }}
      />

      {/* Camera Barcode Scan & Lookup Modal */}
      <BarcodeScannerModal
        open={scanLookupOpen}
        title={isVi ? 'Quét mã vạch sản phẩm' : 'Scan Barcode'}
        subtitle={
          isVi
            ? 'Đưa camera vào mã EAN-13 / UPC-A để tự động tìm kiếm trong danh mục sản phẩm.'
            : 'Point camera at an EAN-13 or UPC-A barcode to automatically search your product catalog.'
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

      {/* Floating Row Action Menu Popover (Viewport-Aware, Never Clipped) */}
      {activeMenuProduct && menuCoords && (
        <div
          ref={actionMenuRef}
          key={activeMenuProduct.id}
          role="menu"
          aria-label={
            isVi
              ? `Thao tác cho ${activeMenuProduct.nameVi || activeMenuProduct.name}`
              : `Actions for ${activeMenuProduct.name}`
          }
          style={{
            top: menuCoords.top,
            bottom: menuCoords.bottom,
            right: menuCoords.right,
          }}
          className={`fixed z-50 min-w-[168px] p-1.5 rounded-xl bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-md border border-stone-200/90 dark:border-[#24352C] shadow-xl animate-popover ${
            menuCoords.placement === 'up' ? 'origin-bottom-right' : 'origin-top-right'
          }`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = activeMenuProduct;
              closeRowActionMenu();
              openEdit(target);
            }}
            className="w-full h-11 px-3.5 inline-flex items-center gap-2.5 rounded-lg text-sm font-medium text-stone-700 dark:text-[#E2ECE7] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-950 dark:hover:text-white transition-colors"
          >
            <Edit2 className="w-4 h-4 text-stone-500 dark:text-[#94A39B] shrink-0" />
            <span>{t.common.edit}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = activeMenuProduct;
              closeRowActionMenu();
              setLabelProduct(target);
            }}
            className="w-full h-11 px-3.5 inline-flex items-center gap-2.5 rounded-lg text-sm font-medium text-stone-700 dark:text-[#E2ECE7] hover:bg-stone-100 dark:hover:bg-[#1F3028] hover:text-stone-950 dark:hover:text-white transition-colors"
          >
            <QrCode className="w-4 h-4 text-stone-500 dark:text-[#94A39B] shrink-0" />
            <span>{isVi ? 'Nhãn' : 'Label'}</span>
          </button>

          <div
            role="separator"
            className="my-1 border-t border-stone-100 dark:border-[#1F3028]"
          />

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleMenuDeleteProduct(activeMenuProduct)}
            className="w-full h-11 px-3.5 inline-flex items-center gap-2.5 rounded-lg text-sm font-medium text-red-700 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>{t.common.delete}</span>
          </button>
        </div>
      )}

      {/* Floating Add Product FAB + Scroll-to-Top Pill */}
      <FloatingActionBar
        label={isVi ? 'Thêm sản phẩm' : 'Add Product'}
        topLabel={isVi ? 'Lên đầu' : 'Top'}
        onAction={openNew}
        hidden={modalOpen || scanLookupOpen || Boolean(labelProduct) || selectMode}
      />
    </div>
  );
};
