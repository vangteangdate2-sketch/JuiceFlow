import type {
  CategoryItem,
  CategoryScope,
  Ingredient,
  Product,
  ProductType,
  SaleItem,
} from '../types';

export const UNCATEGORIZED_ID = 'uncategorized';

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  {
    id: 'juice',
    name: 'Fresh Juice',
    nameVi: 'Nước ép tươi',
    scope: 'product',
    sortOrder: 10,
    isSystem: false,
  },
  {
    id: 'smoothie',
    name: 'Smoothie',
    nameVi: 'Sinh tố',
    scope: 'product',
    sortOrder: 20,
    isSystem: false,
  },
  {
    id: 'coffee',
    name: 'Coffee',
    nameVi: 'Cà phê',
    scope: 'product',
    sortOrder: 30,
    isSystem: false,
  },
  {
    id: 'tea',
    name: 'Iced Tea',
    nameVi: 'Trà đá',
    scope: 'product',
    sortOrder: 40,
    isSystem: false,
  },
  {
    id: 'packaged',
    name: 'Packaged Drinks',
    nameVi: 'Nước đóng gói',
    scope: 'both',
    sortOrder: 50,
    isSystem: false,
  },
  {
    id: 'snack',
    name: 'Snacks & Food',
    nameVi: 'Đồ ăn vặt',
    scope: 'both',
    sortOrder: 60,
    isSystem: false,
  },
  {
    id: 'specialty',
    name: 'Specialty',
    nameVi: 'Đặc biệt',
    scope: 'product',
    sortOrder: 70,
    isSystem: false,
  },
  {
    id: 'produce',
    name: 'Fresh Produce',
    nameVi: 'Trái cây & Nguyên liệu',
    scope: 'inventory',
    sortOrder: 80,
    isSystem: false,
  },
  {
    id: 'packaging_supplies',
    name: 'Cups & Packaging',
    nameVi: 'Ly & Bao bì',
    scope: 'inventory',
    sortOrder: 90,
    isSystem: false,
  },
  {
    id: UNCATEGORIZED_ID,
    name: 'Uncategorized',
    nameVi: 'Chưa phân loại',
    scope: 'both',
    sortOrder: 9999,
    isSystem: true,
  },
];

const VALID_SCOPES = new Set<CategoryScope>(['product', 'inventory', 'both']);

export function normalizeCategoryItem(
  raw: Partial<CategoryItem> & { id: string },
  fallbackSortOrder = 100
): CategoryItem {
  const id = String(raw.id || '').trim() || UNCATEGORIZED_ID;
  const isUncategorized = id === UNCATEGORIZED_ID;
  const name =
    String(raw.name || (isUncategorized ? 'Uncategorized' : 'Unnamed Category')).trim() ||
    (isUncategorized ? 'Uncategorized' : 'Unnamed Category');
  const nameVi = String(raw.nameVi || name).trim() || name;
  const scope: CategoryScope = isUncategorized
    ? 'both'
    : raw.scope && VALID_SCOPES.has(raw.scope)
      ? raw.scope
      : 'product';
  const sortOrder = isUncategorized
    ? 9999
    : Number.isFinite(Number(raw.sortOrder))
      ? Math.max(0, Math.round(Number(raw.sortOrder)))
      : fallbackSortOrder;

  return {
    id,
    name,
    nameVi,
    scope,
    sortOrder,
    isSystem: isUncategorized ? true : Boolean(raw.isSystem),
    ...(raw.createdAt ? { createdAt: String(raw.createdAt) } : {}),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {}),
  };
}

export function sortCategories(list: CategoryItem[]): CategoryItem[] {
  return [...list].sort((a, b) => {
    if (a.id === UNCATEGORIZED_ID && b.id !== UNCATEGORIZED_ID) return 1;
    if (b.id === UNCATEGORIZED_ID && a.id !== UNCATEGORIZED_ID) return -1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Ensures the category collection is valid, deduplicated, sorted, and always
 * includes the protected `uncategorized` fallback. If the incoming list is empty,
 * seeds JuiceFlow's default categories.
 */
export function ensureCategoriesList(rawList?: CategoryItem[] | null): CategoryItem[] {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return sortCategories(DEFAULT_CATEGORIES.map((c) => ({ ...c })));
  }

  const map = new Map<string, CategoryItem>();
  rawList.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object' || !raw.id) return;
    const normalized = normalizeCategoryItem(raw, (idx + 1) * 10);
    map.set(normalized.id, normalized);
  });

  if (!map.has(UNCATEGORIZED_ID)) {
    const defaultUncat = DEFAULT_CATEGORIES.find((c) => c.id === UNCATEGORIZED_ID)!;
    map.set(UNCATEGORIZED_ID, { ...defaultUncat });
  }

  return sortCategories(Array.from(map.values()));
}

export function getCategoriesForScope(
  categories: CategoryItem[],
  target: 'product' | 'inventory'
): CategoryItem[] {
  const safe = ensureCategoriesList(categories);
  return safe.filter((c) => c.scope === target || c.scope === 'both');
}

export function getCategoryDisplayName(
  category: CategoryItem | undefined | null,
  isVi = false
): string {
  if (!category) return isVi ? 'Chưa phân loại' : 'Uncategorized';
  if (isVi && category.nameVi && category.nameVi.trim()) {
    return category.nameVi;
  }
  return category.name;
}

export function getCategoryById(
  categoryId: string | undefined | null,
  categories: CategoryItem[]
): CategoryItem {
  const safe = ensureCategoriesList(categories);
  const found = categoryId ? safe.find((c) => c.id === categoryId) : undefined;
  if (found) return found;
  return (
    safe.find((c) => c.id === UNCATEGORIZED_ID) ||
    DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]
  );
}

/**
 * Resolves a category ID with backward compatibility:
 * 1. Exact `categoryId` match in categories
 * 2. Legacy `category` string matching an ID, or case-insensitive `name` / `nameVi`
 * 3. Falls back to `uncategorized`
 */
export function resolveCategoryIdByRef(
  categoryId: string | undefined | null,
  legacyCategory: string | undefined | null,
  categories: CategoryItem[]
): string {
  const safe = ensureCategoriesList(categories);
  const idSet = new Set(safe.map((c) => c.id));

  if (categoryId && idSet.has(categoryId)) {
    return categoryId;
  }

  const trimmedLegacy = String(legacyCategory || '').trim();
  if (trimmedLegacy) {
    if (idSet.has(trimmedLegacy)) {
      return trimmedLegacy;
    }
    const lower = trimmedLegacy.toLowerCase();
    const byName = safe.find(
      (c) =>
        c.name.toLowerCase() === lower ||
        (c.nameVi && c.nameVi.toLowerCase() === lower)
    );
    if (byName) return byName.id;
  }

  return UNCATEGORIZED_ID;
}

export function resolveProductCategoryId(
  product: Pick<Product, 'categoryId' | 'category'> | undefined | null,
  categories: CategoryItem[]
): string {
  if (!product) return UNCATEGORIZED_ID;
  return resolveCategoryIdByRef(product.categoryId, product.category, categories);
}

export function resolveIngredientCategoryId(
  ingredient: Pick<Ingredient, 'categoryId' | 'name'> | undefined | null,
  categories: CategoryItem[]
): string {
  if (!ingredient) return UNCATEGORIZED_ID;
  if (ingredient.categoryId) {
    return resolveCategoryIdByRef(ingredient.categoryId, undefined, categories);
  }
  return UNCATEGORIZED_ID;
}

export function resolveSaleItemCategoryId(
  item: Pick<SaleItem, 'categoryId' | 'productId'>,
  prodLookup: Map<string, Product>,
  categories: CategoryItem[]
): string {
  const safe = ensureCategoriesList(categories);
  const idSet = new Set(safe.map((c) => c.id));

  // Prefer live product category first so re-categorizing/renaming stays synced,
  // falling back to historical SaleItem.categoryId if the product was deleted.
  const liveProd = prodLookup.get(item.productId);
  if (liveProd) {
    return resolveProductCategoryId(liveProd, safe);
  }
  if (item.categoryId && idSet.has(item.categoryId)) {
    return item.categoryId;
  }
  return UNCATEGORIZED_ID;
}

/**
 * Unified color-coded pill styling for ProductType across POS, Products, Inventory, and Reports:
 * - PREPARED_TO_ORDER (Made-to-Order): Emerald
 * - PACKAGED (Packaged Goods): Sky Blue
 * - PREPARED_STOCK (Prepared Stock / Batch): Purple
 */
export function getProductTypeBadgeClass(productType: ProductType): string {
  if (productType === 'PREPARED_TO_ORDER') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-[#064E3B]/60 dark:text-[#6EE7B7] dark:border-[#10B981]/30';
  }
  if (productType === 'PREPARED_STOCK') {
    return 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-500/35';
  }
  return 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-500/35';
}

export function getProductTypeDotClass(productType: ProductType): string {
  if (productType === 'PREPARED_TO_ORDER') {
    return 'bg-emerald-600 dark:bg-[#10B981]';
  }
  if (productType === 'PREPARED_STOCK') {
    return 'bg-purple-600 dark:bg-purple-400';
  }
  return 'bg-sky-600 dark:bg-sky-400';
}

export function getProductTypeFilterPillClass(
  productType: 'ALL' | ProductType,
  active: boolean
): string {
  if (!active) {
    return 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]';
  }
  if (productType === 'PREPARED_TO_ORDER') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/50 font-semibold';
  }
  if (productType === 'PREPARED_STOCK') {
    return 'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/75 dark:text-purple-200 dark:border-purple-400/50 font-semibold';
  }
  if (productType === 'PACKAGED') {
    return 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/75 dark:text-sky-200 dark:border-sky-400/50 font-semibold';
  }
  return 'bg-[#E6F2ED] text-[#0D5C3E] border-[#0D5C3E]/30 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/45 font-semibold';
}
