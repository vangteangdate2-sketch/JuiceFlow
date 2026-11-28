import type {
  CategoryColorKey,
  CategoryItem,
  CategoryScope,
  Ingredient,
  Product,
  ProductType,
  SaleItem,
  StockClassification,
} from '../types';

export const UNCATEGORIZED_ID = 'uncategorized';

export const CATEGORY_COLOR_OPTIONS: {
  key: CategoryColorKey;
  label: string;
  labelKm: string;
}[] = [
  { key: 'emerald', label: 'Fresh Emerald', labelKm: 'បៃតងត្បូងមរកត' },
  { key: 'amber', label: 'Mango Amber', labelKm: 'លឿងស្វាយទុំ' },
  { key: 'sky', label: 'Iced Blue', labelKm: 'ខៀវទឹកកក' },
  { key: 'teal', label: 'Mint Teal', labelKm: 'បៃតងជីអង្កាម' },
  { key: 'indigo', label: 'Berry Indigo', labelKm: 'ស្វាយប៊ឺរី' },
  { key: 'orange', label: 'Citrus Orange', labelKm: 'ទឹកក្រូចស្រស់' },
  { key: 'purple', label: 'Dragonfruit Purple', labelKm: 'ស្វាយស្រកានាគ' },
  { key: 'lime', label: 'Matcha Lime', labelKm: 'បៃតងម៉ាត់ឆា' },
  { key: 'rose', label: 'Hibiscus Rose', labelKm: 'ផ្កាឈូក' },
  { key: 'stone', label: 'Stone Neutral', labelKm: 'ប្រផេះធម្មជាតិ' },
];

export const DEFAULT_CATEGORY_KM_NAMES: Record<string, string> = {
  juice: 'ទឹកផ្លែឈើស្រស់',
  smoothie: 'ទឹកក្រឡុក',
  coffee: 'កាហ្វេ',
  tea: 'តែទឹកកក',
  packaged: 'ភេសជ្ជៈវេចខ្ចប់',
  snack: 'អាហារសម្រន់',
  specialty: 'ភេសជ្ជៈពិសេស',
  produce: 'ផ្លែឈើ និងវត្ថុធាតុដើម',
  packaging_supplies: 'កែវ និងសម្ភារៈវេចខ្ចប់',
  [UNCATEGORIZED_ID]: 'មិនទាន់ចាត់ប្រភេទ',
};

const VALID_COLORS = new Set<CategoryColorKey>(CATEGORY_COLOR_OPTIONS.map((c) => c.key));

const AUTO_ASSIGN_PALETTE: CategoryColorKey[] = [
  'emerald',
  'amber',
  'sky',
  'teal',
  'indigo',
  'orange',
  'purple',
  'lime',
  'rose',
];

const DEFAULT_CATEGORY_COLOR_BY_ID: Record<string, CategoryColorKey> = {
  juice: 'emerald',
  smoothie: 'amber',
  coffee: 'sky',
  tea: 'teal',
  packaged: 'indigo',
  snack: 'orange',
  specialty: 'purple',
  produce: 'lime',
  packaging_supplies: 'rose',
  [UNCATEGORIZED_ID]: 'stone',
};

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  {
    id: 'juice',
    name: 'Fresh Juice',
    nameVi: 'Nước ép tươi',
    scope: 'product',
    color: 'emerald',
    sortOrder: 10,
    isSystem: false,
  },
  {
    id: 'smoothie',
    name: 'Smoothie',
    nameVi: 'Sinh tố',
    scope: 'product',
    color: 'amber',
    sortOrder: 20,
    isSystem: false,
  },
  {
    id: 'coffee',
    name: 'Coffee',
    nameVi: 'Cà phê',
    scope: 'product',
    color: 'sky',
    sortOrder: 30,
    isSystem: false,
  },
  {
    id: 'tea',
    name: 'Iced Tea',
    nameVi: 'Trà đá',
    scope: 'product',
    color: 'teal',
    sortOrder: 40,
    isSystem: false,
  },
  {
    id: 'packaged',
    name: 'Packaged Drinks',
    nameVi: 'Nước đóng gói',
    scope: 'both',
    color: 'indigo',
    sortOrder: 50,
    isSystem: false,
  },
  {
    id: 'snack',
    name: 'Snacks & Food',
    nameVi: 'Đồ ăn vặt',
    scope: 'both',
    color: 'orange',
    sortOrder: 60,
    isSystem: false,
  },
  {
    id: 'specialty',
    name: 'Specialty',
    nameVi: 'Đặc biệt',
    scope: 'product',
    color: 'purple',
    sortOrder: 70,
    isSystem: false,
  },
  {
    id: 'produce',
    name: 'Fresh Produce',
    nameVi: 'Trái cây & Nguyên liệu',
    scope: 'inventory',
    color: 'lime',
    sortOrder: 80,
    isSystem: false,
  },
  {
    id: 'packaging_supplies',
    name: 'Cups & Packaging',
    nameVi: 'Ly & Bao bì',
    scope: 'inventory',
    color: 'rose',
    sortOrder: 90,
    isSystem: false,
  },
  {
    id: UNCATEGORIZED_ID,
    name: 'Uncategorized',
    nameVi: 'Chưa phân loại',
    scope: 'both',
    color: 'stone',
    sortOrder: 9999,
    isSystem: true,
  },
];

const VALID_SCOPES = new Set<CategoryScope>(['product', 'inventory', 'both']);

export function resolveCategoryColor(
  id: string,
  color?: string | null
): CategoryColorKey {
  if (color && VALID_COLORS.has(color as CategoryColorKey)) {
    return color as CategoryColorKey;
  }
  if (id in DEFAULT_CATEGORY_COLOR_BY_ID) {
    return DEFAULT_CATEGORY_COLOR_BY_ID[id];
  }
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AUTO_ASSIGN_PALETTE[hash % AUTO_ASSIGN_PALETTE.length];
}

export function pickNextCategoryColor(existing: CategoryItem[]): CategoryColorKey {
  const counts = new Map<CategoryColorKey, number>();
  AUTO_ASSIGN_PALETTE.forEach((k) => counts.set(k, 0));
  for (const cat of existing) {
    if (cat.id === UNCATEGORIZED_ID) continue;
    const c = resolveCategoryColor(cat.id, cat.color);
    if (counts.has(c)) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  let best: CategoryColorKey = AUTO_ASSIGN_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const key of AUTO_ASSIGN_PALETTE) {
    const cnt = counts.get(key) ?? 0;
    if (cnt < bestCount) {
      bestCount = cnt;
      best = key;
    }
  }
  return best;
}

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
  const color: CategoryColorKey = isUncategorized
    ? 'stone'
    : resolveCategoryColor(id, raw.color);
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
    color,
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

const KHMER_SCRIPT_REGEX = /[\u1780-\u17FF]/;

export function getCategoryDisplayName(
  category: CategoryItem | undefined | null,
  isKm = false
): string {
  if (!category) return isKm ? 'មិនទាន់ចាត់ប្រភេទ' : 'Uncategorized';
  if (isKm) {
    if (category.nameVi && KHMER_SCRIPT_REGEX.test(category.nameVi)) {
      return category.nameVi.trim();
    }
    if (DEFAULT_CATEGORY_KM_NAMES[category.id]) {
      return DEFAULT_CATEGORY_KM_NAMES[category.id];
    }
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
 * Canonical color-coded styling for item types across POS, Products, Inventory, and Reports:
 * - PREPARED_TO_ORDER (Made-to-Order): Emerald green (`text-emerald-600 bg-emerald-500/10`)
 * - PACKAGED (Retail Packaged): Sky blue (`text-sky-600 bg-sky-500/10`)
 * - ingredient (Raw Ingredients): Teal (`text-teal-600 bg-teal-500/10`)
 */
export function getProductTypeBadgeClass(productType: ProductType): string {
  if (productType === 'PREPARED_TO_ORDER') {
    return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30';
  }
  return 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30';
}

export function getProductTypeDotClass(productType: ProductType): string {
  if (productType === 'PREPARED_TO_ORDER') {
    return 'bg-emerald-600 dark:bg-emerald-400';
  }
  return 'bg-sky-600 dark:bg-sky-400';
}

export function getStockClassificationBadgeClass(classification: StockClassification): string {
  if (classification === 'ingredient') {
    return 'bg-teal-500/10 text-teal-600 border-teal-500/20 dark:bg-teal-500/15 dark:text-teal-400 dark:border-teal-500/30';
  }
  return 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30';
}

export function getStockClassificationDotClass(classification: StockClassification): string {
  if (classification === 'ingredient') {
    return 'bg-teal-600 dark:bg-teal-400';
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
    return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/40 font-semibold';
  }
  if (productType === 'PACKAGED') {
    return 'bg-sky-500/10 text-sky-600 border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/40 font-semibold';
  }
  return 'bg-[#E6F2ED] text-[#0D5C3E] border-[#0D5C3E]/30 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/45 font-semibold';
}

const CATEGORY_DOT_CLASSES: Record<CategoryColorKey, string> = {
  emerald: 'bg-emerald-600 dark:bg-[#10B981]',
  amber: 'bg-amber-500 dark:bg-amber-400',
  sky: 'bg-sky-600 dark:bg-sky-400',
  teal: 'bg-teal-600 dark:bg-teal-400',
  indigo: 'bg-indigo-600 dark:bg-indigo-400',
  orange: 'bg-orange-500 dark:bg-orange-400',
  purple: 'bg-purple-600 dark:bg-purple-400',
  lime: 'bg-lime-600 dark:bg-lime-400',
  rose: 'bg-rose-600 dark:bg-rose-400',
  stone: 'bg-stone-500 dark:bg-stone-400',
};

const CATEGORY_BADGE_CLASSES: Record<CategoryColorKey, string> = {
  emerald:
    'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-[#064E3B]/60 dark:text-[#6EE7B7] dark:border-[#10B981]/30',
  amber:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-500/35',
  sky: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-500/35',
  teal: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-500/35',
  indigo:
    'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-500/35',
  orange:
    'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-500/35',
  purple:
    'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-500/35',
  lime: 'bg-lime-50 text-lime-800 border-lime-200 dark:bg-lime-950/60 dark:text-lime-200 dark:border-lime-500/35',
  rose: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-500/35',
  stone:
    'bg-stone-100 text-stone-700 border-stone-200/80 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C]',
};

const CATEGORY_ACTIVE_PILL_CLASSES: Record<CategoryColorKey, string> = {
  emerald:
    'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/50 font-semibold',
  amber:
    'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/75 dark:text-amber-200 dark:border-amber-400/50 font-semibold',
  sky: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/75 dark:text-sky-200 dark:border-sky-400/50 font-semibold',
  teal: 'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/75 dark:text-teal-200 dark:border-teal-400/50 font-semibold',
  indigo:
    'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/75 dark:text-indigo-200 dark:border-indigo-400/50 font-semibold',
  orange:
    'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/75 dark:text-orange-200 dark:border-orange-400/50 font-semibold',
  purple:
    'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/75 dark:text-purple-200 dark:border-purple-400/50 font-semibold',
  lime: 'bg-lime-50 text-lime-800 border-lime-300 dark:bg-lime-950/75 dark:text-lime-200 dark:border-lime-400/50 font-semibold',
  rose: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/75 dark:text-rose-200 dark:border-rose-400/50 font-semibold',
  stone:
    'bg-stone-200/80 text-stone-900 border-stone-400/60 dark:bg-[#24352C] dark:text-[#F1F5F3] dark:border-[#344E41] font-semibold',
};

export function getCategoryDotClass(
  category?: Pick<CategoryItem, 'id' | 'color'> | CategoryColorKey | null
): string {
  if (!category) return CATEGORY_DOT_CLASSES.stone;
  if (typeof category === 'string') {
    return CATEGORY_DOT_CLASSES[VALID_COLORS.has(category) ? category : 'stone'];
  }
  return CATEGORY_DOT_CLASSES[resolveCategoryColor(category.id, category.color)];
}

export function getCategoryBadgeClass(
  category?: Pick<CategoryItem, 'id' | 'color'> | CategoryColorKey | null
): string {
  if (!category) return CATEGORY_BADGE_CLASSES.stone;
  if (typeof category === 'string') {
    return CATEGORY_BADGE_CLASSES[VALID_COLORS.has(category) ? category : 'stone'];
  }
  return CATEGORY_BADGE_CLASSES[resolveCategoryColor(category.id, category.color)];
}

export function getCategoryFilterPillClass(
  category: Pick<CategoryItem, 'id' | 'color'> | 'ALL',
  active: boolean
): string {
  if (!active) {
    return 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]';
  }
  if (category === 'ALL') {
    return 'bg-[#E6F2ED] text-[#0D5C3E] border-[#0D5C3E]/30 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/45 font-semibold';
  }
  const colorKey = resolveCategoryColor(category.id, category.color);
  return CATEGORY_ACTIVE_PILL_CLASSES[colorKey];
}
