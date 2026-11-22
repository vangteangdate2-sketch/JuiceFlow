import type { Ingredient, Product } from '../types';

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

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function sanitizeString(value: string, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function clampNumber(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function calculateProductCogs(product: Product, ingredients: Ingredient[]): number {
  const ingMap = new Map(ingredients.map((ing) => [ing.id, ing]));
  return product.recipe.reduce((sum, item) => {
    const ing = ingMap.get(item.ingredientId);
    if (!ing) return sum;
    return sum + ing.unitCostKhr * item.quantity;
  }, 0);
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
