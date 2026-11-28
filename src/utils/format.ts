import type { Ingredient, IngredientUnit, NetSizeUnit, Product, ProductVariant, RecipeItem } from '../types';

export const BUSINESS_TIMEZONE = 'Asia/Phnom_Penh';

export function formatKhr(amount: number): string {
  const rounded = Math.round(Number.isFinite(amount) ? amount : 0);
  const absFormatted = Math.abs(rounded).toLocaleString('en-US');
  return `${rounded < 0 ? '-' : ''}${absFormatted} ៛`;
}

export function formatUsdRef(amountKhr: number, usdRate: number): string {
  if (!usdRate || usdRate <= 0) return '';
  const usd = amountKhr / usdRate;
  return `≈ $${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatQty(qty: number, unit: string): string {
  const safe = Number.isFinite(qty) ? qty : 0;
  const formatted = Number.isInteger(safe)
    ? safe.toLocaleString('en-US')
    : safe.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${formatted} ${unit}`;
}

/**
 * Formats a Date into YYYY-MM-DD in Asia/Phnom_Penh (UTC+7) business timezone.
 */
export function formatDateInPhnomPenh(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback to UTC+7 math if Intl timezone data unavailable
  }
  const utcMs = date.getTime() + 7 * 60 * 60 * 1000;
  const shifted = new Date(utcMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateTimeInPhnomPenh(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return `${formatDateInPhnomPenh(d)} ${d.toISOString().slice(11, 16)}`;
  }
}

export function todayIso(): string {
  return formatDateInPhnomPenh(new Date());
}

export function daysAgoIso(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return formatDateInPhnomPenh(new Date(ms));
}

export function getPhnomPenhMonthBounds(offsetMonths: number): { start: string; end: string } {
  const today = todayIso();
  const [yStr, mStr] = today.split('-');
  const baseYear = Number(yStr);
  const baseMonthIndex = Number(mStr) - 1 + offsetMonths;
  const first = new Date(Date.UTC(baseYear, baseMonthIndex, 1));
  const last = new Date(Date.UTC(baseYear, baseMonthIndex + 1, 0));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { start: fmt(first), end: fmt(last) };
}

export function getPhnomPenhYearBounds(offsetYears = 0): { start: string; end: string } {
  const today = todayIso();
  const year = Number(today.slice(0, 4)) + offsetYears;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function generateId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'id';
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${cleanPrefix}_${ts}_${rand}`;
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'JF';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function sanitizeString(value: string, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

/**
 * Canonical item name normalization for duplicate protection:
 * trims surrounding whitespace, collapses internal whitespace runs to a single space,
 * and lowercases so "  Coca-Cola   Can 330ml " and "coca-cola can 330ml" match identically.
 */
export function normalizeName(name: string): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export const NET_SIZE_UNITS: readonly NetSizeUnit[] = ['ml', 'L', 'g', 'kg'] as const;

const VALID_NET_SIZE_UNIT_SET = new Set<string>(NET_SIZE_UNITS);

function escapeRegexLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes a numeric net-size string (e.g., "500", "1.5", Khmer digits -> ASCII)
 * and strips invalid/zero-only values.
 */
export function sanitizeNetSizeValue(raw?: string): string {
  if (!raw) return '';
  const ascii = String(raw)
    .replace(/[\u17E0-\u17E9]/g, (ch) => String(ch.charCodeAt(0) - 0x17e0))
    .replace(/\s+/g, '')
    .trim();
  if (!ascii) return '';
  const match = ascii.match(/^\d*\.?\d*/);
  let clean = match ? match[0] : '';
  if (!clean || clean === '.') return '';
  if (clean.startsWith('.')) clean = `0${clean}`;
  if (clean.endsWith('.')) clean = clean.slice(0, -1);
  const num = parseFloat(clean);
  if (!Number.isFinite(num) || num <= 0) return '';
  return clean.slice(0, 16);
}

/**
 * Formats a canonical retail packaged product display name with optional net size
 * (e.g., "Vital Water" + "500" + "ml" -> "Vital Water (500ml)").
 * Skips appending if the name already ends with that exact size.
 */
export function formatCanonicalProductName(
  baseName: string,
  netSizeValue?: string,
  netSizeUnit?: NetSizeUnit
): string {
  const cleanBase = String(baseName ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleanBase) return '';

  const cleanVal = sanitizeNetSizeValue(netSizeValue);
  if (!cleanVal || !netSizeUnit || !VALID_NET_SIZE_UNIT_SET.has(netSizeUnit)) {
    return cleanBase.slice(0, 100);
  }

  const valRe = escapeRegexLiteral(cleanVal);
  const unitRe = escapeRegexLiteral(netSizeUnit);
  const alreadyEndsWithSizeRe = new RegExp(
    `(?:\\(\\s*${valRe}\\s*${unitRe}\\s*\\)|\\b${valRe}\\s*${unitRe})$`,
    'i'
  );
  if (alreadyEndsWithSizeRe.test(cleanBase)) {
    return cleanBase.slice(0, 100);
  }

  const suffix = ` (${cleanVal}${netSizeUnit})`;
  const maxBaseLen = Math.max(1, 100 - suffix.length);
  return `${cleanBase.slice(0, maxBaseLen).trimEnd()}${suffix}`;
}

/**
 * Strips the auto-appended trailing " (<val><unit>)" suffix when loading an existing
 * packaged product into the edit form so editing the size does not double-append.
 */
export function stripNetSizeFromName(
  fullName: string,
  netSizeValue?: string,
  netSizeUnit?: NetSizeUnit
): string {
  const cleanFull = String(fullName ?? '').trim();
  const cleanVal = sanitizeNetSizeValue(netSizeValue);
  if (!cleanFull || !cleanVal || !netSizeUnit || !VALID_NET_SIZE_UNIT_SET.has(netSizeUnit)) {
    return cleanFull;
  }
  const valRe = escapeRegexLiteral(cleanVal);
  const unitRe = escapeRegexLiteral(netSizeUnit);
  const trailingParenRe = new RegExp(`\\s*\\(\\s*${valRe}\\s*${unitRe}\\s*\\)$`, 'i');
  return cleanFull.replace(trailingParenRe, '').trim();
}

export function clampNumber(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Converts a quantity between compatible units (g <-> kg, ml <-> L).
 * If units are identical or incompatible (e.g., pcs -> g), returns qty unchanged.
 */
export function convertUnitQty(
  qty: number,
  fromUnit: IngredientUnit | undefined,
  toUnit: IngredientUnit
): number {
  if (!fromUnit || fromUnit === toUnit) return qty;
  if (fromUnit === 'kg' && toUnit === 'g') return qty * 1000;
  if (fromUnit === 'g' && toUnit === 'kg') return qty / 1000;
  if (fromUnit === 'L' && toUnit === 'ml') return qty * 1000;
  if (fromUnit === 'ml' && toUnit === 'L') return qty / 1000;
  return qty;
}

export function getCompatibleUnits(baseUnit: IngredientUnit): IngredientUnit[] {
  if (baseUnit === 'g' || baseUnit === 'kg') return ['g', 'kg'];
  if (baseUnit === 'ml' || baseUnit === 'L') return ['ml', 'L'];
  return ['pcs'];
}

export function calculateRecipeCogs(recipe: RecipeItem[], ingredients: Ingredient[]): number {
  if (!Array.isArray(recipe) || recipe.length === 0) return 0;
  const safeIngredients = Array.isArray(ingredients) ? ingredients : [];
  const ingMap = new Map(safeIngredients.filter((ing) => ing && ing.id).map((ing) => [ing.id, ing]));
  return recipe.reduce((sum, item) => {
    if (!item || !item.ingredientId) return sum;
    const ing = ingMap.get(item.ingredientId);
    if (!ing) return sum;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return sum;
    const qtyInStockUnit = convertUnitQty(qty, item.unit ?? ing.unit, ing.unit);
    return sum + (Number(ing.unitCostKhr) || 0) * qtyInStockUnit;
  }, 0);
}

export function calculateProductCogs(
  product: Product,
  ingredients: Ingredient[],
  variant?: ProductVariant
): number {
  if (!product) return 0;
  if (product.productType === 'PACKAGED') {
    return Math.max(0, Number(variant?.costPriceKhr ?? product.costPriceKhr) || 0);
  }
  const activeRecipe = Array.isArray(variant?.recipe)
    ? variant.recipe
    : Array.isArray(product.recipe)
      ? product.recipe
      : [];
  return calculateRecipeCogs(activeRecipe, ingredients);
}

export function computePriceFromMarkup(costPriceKhr: number, markupPercent: number): number {
  const cost = Math.max(0, Number(costPriceKhr) || 0);
  const markup = Math.max(0, Number(markupPercent) || 0);
  const raw = cost * (1 + markup / 100);
  // Round neatly to nearest 100 KHR for Cambodian Riel retail pricing
  return Math.round(raw / 100) * 100;
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const escapeCell = (cell: string | number): string => {
    const s = String(cell ?? '');
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csvContent = '\uFEFF' + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
