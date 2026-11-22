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

export type ProductCategory = 'juice' | 'smoothie' | 'tea' | 'coffee' | 'specialty';

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

export type MovementType = 'purchase' | 'sale_consumption' | 'void_restore' | 'adjustment';

export interface RecipeItem {
  ingredientId: string;
  quantity: number;
}

export interface Product {
  id: string;
  name: string;
  nameVi: string;
  category: ProductCategory;
  priceKhr: number;
  imageUrl: string;
  active: boolean;
  recipe: RecipeItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  nameVi: string;
  unit: IngredientUnit;
  stockQty: number;
  reorderLevel: number;
  unitCostKhr: number;
  supplier: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  productNameVi: string;
  quantity: number;
  unitPriceKhr: number;
  unitCogsKhr: number;
  lineTotalKhr: number;
}

export interface Sale {
  id: string;
  orderNumber: string;
  saleDate: string; // YYYY-MM-DD
  items: SaleItem[];
  totalKhr: number;
  cogsKhr: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  note: string;
  recordedBy: string;
  status: 'completed' | 'voided';
  createdAt: string;
}

export interface Expense {
  id: string;
  expenseDate: string; // YYYY-MM-DD
  title: string;
  category: ExpenseCategory;
  scope: ExpenseScope;
  amountKhr: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  note: string;
  linkedIngredientId: string;
  recordedBy: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  movementType: MovementType;
  deltaQty: number;
  unit: IngredientUnit;
  totalCostKhr: number;
  referenceId: string;
  movementDate: string; // YYYY-MM-DD
  note: string;
  recordedBy: string;
  createdAt: string;
}

export interface WorkspaceSettings {
  workspaceId: string;
  inviteCode: string;
  name: string;
  location: string;
  currency: 'KHR';
  usdRate: number;
  language: AppLanguage;
  familyMembers: string[];
  activeOperator: string;
  lowStockDefault: number;
}

export interface BiometricSecurityConfig {
  enabled: boolean;
  biometricEnrolled: boolean;
  credentialId: string | null;
  pinHash: string | null;
  pinSalt: string | null;
  lockOnBackground: boolean;
}
