export type AppLanguage = 'en' | 'vi';

export type AppTab =
  | 'dashboard'
  | 'sales'
  | 'products'
  | 'inventory'
  | 'expenses'
  | 'reports'
  | 'settings';

export type PaymentMethod = 'cash' | 'khqr' | 'aba' | 'wing';

export type IngredientUnit = 'g' | 'kg' | 'ml' | 'L' | 'pcs';

export type ProductType = 'PACKAGED' | 'PREPARED_TO_ORDER' | 'PREPARED_STOCK';

export type StockClassification = 'packaged' | 'ingredient' | 'prepared_stock';

export type DefaultProductCategory =
  | 'juice'
  | 'smoothie'
  | 'tea'
  | 'coffee'
  | 'specialty'
  | 'packaged'
  | 'snack';

export type ProductCategory = string;

export type CategoryScope = 'product' | 'inventory' | 'both';

export type CategoryColorKey =
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'teal'
  | 'indigo'
  | 'purple'
  | 'orange'
  | 'rose'
  | 'lime'
  | 'stone';

export interface CategoryItem {
  id: string;
  name: string;
  nameVi?: string;
  scope: CategoryScope;
  color?: CategoryColorKey;
  sortOrder: number;
  isSystem?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ExpenseCategory =
  | 'ingredients'
  | 'packaging'
  | 'utilities'
  | 'rent'
  | 'equipment'
  | 'transport'
  | 'household'
  | 'travel'
  | 'other';

export type ExpenseScope = 'business' | 'household';

export type MovementType =
  | 'opening_stock'
  | 'purchase'
  | 'sale_consumption'
  | 'batch_prep_in'
  | 'batch_prep_consume'
  | 'void_restore'
  | 'return_restore'
  | 'stock_count'
  | 'adjustment'
  | 'damaged'
  | 'expired';

export interface RecipeItem {
  ingredientId: string;
  quantity: number;
  unit?: IngredientUnit; // Optional display/entry unit; converted to ingredient's base unit on deduction
}

export interface PackagingBarcode {
  barcode: string;
  label: string; // e.g., "Carton (24 bottles)", "6-Pack"
  unitsPerPack: number; // e.g., 24, 6
}

export interface ProductVariant {
  id: string;
  name: string; // e.g., "Small", "Medium", "Large", "Standard"
  nameVi: string;
  priceKhr: number;
  costPriceKhr?: number;
  barcode?: string;
  recipe: RecipeItem[];
  recipeVersion: number;
}

export interface Product {
  id: string;
  name: string;
  nameVi: string;
  brand?: string;
  category: ProductCategory;
  categoryId?: string;
  productType: ProductType;
  priceKhr: number;
  costPriceKhr: number;
  markupPercent?: number;
  manualPriceOverride?: boolean;
  imageUrl: string;
  active: boolean;
  // Barcode & packaging identifiers (primarily for PACKAGED & PREPARED_STOCK)
  barcode?: string;
  packagingBarcodes?: PackagingBarcode[];
  // Direct stock balance for PACKAGED and PREPARED_STOCK items
  stockQty: number;
  reorderLevel: number;
  unit: IngredientUnit;
  supplier: string;
  // Default / batch recipe (for legacy single-variant or PREPARED_STOCK batch preparation)
  recipe: RecipeItem[];
  recipeVersion: number;
  // Multi-variant definitions (Small / Medium / Large or single Standard variant)
  variants: ProductVariant[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  nameVi: string;
  categoryId?: string;
  barcode?: string;
  unit: IngredientUnit;
  stockQty: number;
  reorderLevel: number;
  unitCostKhr: number;
  supplier: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaleDeductionSnapshot {
  itemId: string;
  itemName: string;
  itemClassification: StockClassification;
  unit: IngredientUnit;
  qtyPerSaleUnit: number; // Exact stock deducted per 1 unit of this SaleItem
  totalDeductedQty: number;
  unitCostKhr: number;
}

export interface SaleItem {
  lineId?: string;
  productId: string;
  categoryId?: string;
  variantId?: string;
  variantName?: string;
  variantNameVi?: string;
  productType?: ProductType;
  recipeVersion?: number;
  productName: string;
  productNameVi: string;
  quantity: number;
  returnedQty?: number;
  unitPriceKhr: number;
  unitCogsKhr: number;
  lineTotalKhr: number;
  deductions?: SaleDeductionSnapshot[];
}

export interface SaleReturnItem {
  lineId: string;
  productId: string;
  variantId?: string;
  productName: string;
  quantity: number;
  refundAmountKhr: number;
  restoredCogsKhr: number;
}

export interface SaleReturnRecord {
  id: string;
  returnDate: string; // YYYY-MM-DD (Asia/Phnom_Penh)
  createdAt: string;
  recordedBy: string;
  reason: string;
  refundTotalKhr: number;
  restoredCogsKhr: number;
  items: SaleReturnItem[];
}

export type SaleStatus = 'completed' | 'partially_returned' | 'refunded' | 'voided';

export interface Sale {
  id: string;
  clientTxId?: string;
  orderNumber: string;
  saleDate: string; // YYYY-MM-DD (Asia/Phnom_Penh)
  items: SaleItem[];
  subtotalKhr?: number;
  totalKhr: number;
  refundedKhr?: number;
  netTotalKhr?: number;
  cogsKhr: number;
  refundedCogsKhr?: number;
  paymentMethod: PaymentMethod;
  cash_received_usd?: number | null;
  cash_received_khr?: number | null;
  exchange_rate_used?: number | null;
  change_given_khr?: number | null;
  customerName: string;
  note: string;
  recordedBy: string;
  status: SaleStatus;
  returns?: SaleReturnRecord[];
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  expenseDate: string; // YYYY-MM-DD (Asia/Phnom_Penh)
  title: string;
  category: ExpenseCategory;
  scope: ExpenseScope;
  amountKhr: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  note: string;
  linkedIngredientId: string;
  isInventoryPurchase?: boolean; // True for legacy linked ingredient purchases so reports never double-count with COGS
  recordedBy: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  itemId?: string; // Unified item ID (product.id or ingredient.id); mirrors ingredientId for backward compat
  itemName?: string;
  itemClassification?: StockClassification;
  ingredientId: string; // Preserved for backward compatibility with legacy Firestore docs
  ingredientName: string;
  movementType: MovementType;
  deltaQty: number;
  unit: IngredientUnit;
  unitCostKhr?: number;
  totalCostKhr: number;
  referenceId: string;
  movementDate: string; // YYYY-MM-DD (Asia/Phnom_Penh)
  note: string;
  recordedBy: string;
  createdAt: string;
}

export interface PurchaseRecord {
  id: string;
  purchaseDate: string; // YYYY-MM-DD (Asia/Phnom_Penh)
  itemId: string;
  itemName: string;
  itemClassification: StockClassification;
  quantity: number; // Base units added to inventory
  packCount?: number;
  unitsPerPack?: number;
  unit: IngredientUnit;
  totalCostKhr: number;
  unitCostKhr: number;
  paymentMethod: PaymentMethod;
  supplier: string;
  barcodeScanned?: string;
  note: string;
  recordedBy: string;
  createdAt: string;
}

export type BarcodeFormat =
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_128'
  | 'QR_CODE'
  | 'INTERNAL';

export type BarcodePackagingType = 'unit' | 'pack' | 'carton' | 'variant';

export type BarcodeSource = 'manufacturer' | 'internal' | 'open_food_facts';

export type BarcodeRegistryItemType = 'product' | 'ingredient';

export interface BarcodeRegistryRecord {
  id: string; // Deterministic doc ID (bc_<hex>) strictly preserving leading zeros
  code: string; // Exact trimmed string identifier (never coerced to number)
  format: BarcodeFormat;
  itemType?: BarcodeRegistryItemType;
  productId?: string;
  ingredientId?: string;
  variantId?: string;
  packagingType: BarcodePackagingType;
  label: string;
  unitsPerScan: number; // >= 1 (e.g., 1 for single unit, 6 for 6-pack, 24 for carton)
  active: boolean;
  source: BarcodeSource;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExternalBarcodePrefill {
  barcode: string;
  source: 'open_food_facts';
  name: string;
  nameVi?: string;
  brand?: string;
  suggestedCategory?: ProductCategory;
  packQuantityText?: string;
  imageUrl?: string;
}

export interface BarcodeResolutionResult {
  found: boolean;
  code: string;
  format: BarcodeFormat;
  source: 'firestore_registry' | 'local_registry' | 'open_food_facts' | 'not_found';
  itemType?: BarcodeRegistryItemType;
  product?: Product;
  ingredient?: Ingredient;
  variant?: ProductVariant;
  registryRecord?: BarcodeRegistryRecord;
  unitsPerScan: number;
  packagingType?: BarcodePackagingType;
  packLabel?: string;
  externalPrefill?: ExternalBarcodePrefill | null;
  lookedUpExternally: boolean;
}

export interface WorkspaceSettings {
  workspaceId: string;
  inviteCode: string;
  name: string;
  location: string;
  currency: 'KHR';
  usdRate: number;
  posExchangeRate?: number;
  language: AppLanguage;
  familyMembers: string[];
  activeOperator: string;
  lowStockDefault: number;
  allowNegativeStock?: boolean;
  enableOpenFoodFactsLookup?: boolean;
  timezone?: string; // 'Asia/Phnom_Penh'
}

export interface BiometricSecurityConfig {
  enabled: boolean;
  biometricEnrolled: boolean;
  credentialId: string | null;
  pinHash: string | null;
  pinSalt: string | null;
  lockOnBackground: boolean;
}
