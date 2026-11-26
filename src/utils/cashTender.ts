export const DEFAULT_POS_EXCHANGE_RATE = 4000;
export const DEFAULT_CASH_PRESETS: readonly number[] = [5000, 10000, 20000, 50000];
export const MAX_CASH_PRESETS = 12;
export const MAX_CASH_PRESET_AMOUNT = 100_000_000;

export interface CashTenderInput {
  totalKhr: number;
  usdReceived?: number;
  khrReceived: number;
  exchangeRate?: number;
}

export interface CashTenderResult {
  totalKhr: number;
  usdReceived: number;
  khrReceived: number;
  exchangeRate: number;
  usdEquivalentKhr: number;
  totalTenderedKhr: number;
  rawDifferenceKhr: number;
  roundedDifferenceKhr: number;
  isCovered: boolean;
  isShortfall: boolean;
  changeDueKhr: number;
  remainingDueKhr: number;
  isMixed: boolean;
  hasAnyInput: boolean;
}

export interface CashPresetMutationResult {
  ok: boolean;
  presets: number[];
  error?: string;
}

export function roundKhrToNearest100(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount / 100) * 100;
}

export function parseNonNegativeNumber(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw;
  }
  const cleaned = String(raw ?? '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

export function parsePositiveKhrInteger(raw: string | number): number | null {
  const cleaned =
    typeof raw === 'number'
      ? String(raw)
      : String(raw ?? '')
          .replace(/[,\s៛]/g, '')
          .trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded <= 0 || rounded > MAX_CASH_PRESET_AMOUNT) return null;
  return rounded;
}

export function formatUsdClean(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const rounded = Math.round(safe * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded.toLocaleString('en-US')}` : `$${rounded.toFixed(2)}`;
}

export function computeExactRemainingKhr(
  totalKhr: number,
  usdReceived = 0,
  exchangeRate = DEFAULT_POS_EXCHANGE_RATE
): number {
  const safeTotal = Math.max(0, Math.round(Number(totalKhr) || 0));
  const safeUsd = Math.max(0, Number(usdReceived) || 0);
  const safeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : DEFAULT_POS_EXCHANGE_RATE;
  const remaining = safeTotal - safeUsd * safeRate;
  if (remaining <= 0) return 0;
  return Math.round(remaining);
}

export function calculateCashTender(input: CashTenderInput): CashTenderResult {
  const totalKhr = Math.max(0, Math.round(Number(input.totalKhr) || 0));
  const usdReceived = Math.max(0, Math.round((Number(input.usdReceived) || 0) * 100) / 100);
  const khrReceived = Math.max(0, Math.round(Number(input.khrReceived) || 0));
  const exchangeRate =
    Number.isFinite(input.exchangeRate) && Number(input.exchangeRate) > 0
      ? Math.round(Number(input.exchangeRate))
      : DEFAULT_POS_EXCHANGE_RATE;

  const usdEquivalentKhr = Math.round(usdReceived * exchangeRate);
  const totalTenderedKhr = usdEquivalentKhr + khrReceived;
  const rawDifferenceKhr = totalTenderedKhr - totalKhr;
  const roundedDifferenceKhr = roundKhrToNearest100(rawDifferenceKhr);

  const isCovered = totalTenderedKhr >= totalKhr;
  const isShortfall = totalKhr > 0 && !isCovered;

  // For pure KHR cash entry, preserve exact KHR difference so arbitrary typed amounts
  // (e.g. 12,550 KHR on a 12,000 KHR bill) calculate exact Change Due (550 KHR) and exact Shortfall.
  // When USD bills are involved, round KHR change to the nearest 100 KHR for physical Riel payout.
  const usesUsd = usdReceived > 0;
  const changeDueKhr = isCovered
    ? Math.max(0, usesUsd ? roundedDifferenceKhr : rawDifferenceKhr)
    : 0;

  const shortfallRaw = Math.max(0, totalKhr - totalTenderedKhr);
  const roundedShortfall = roundKhrToNearest100(shortfallRaw);
  const remainingDueKhr = isCovered
    ? 0
    : usesUsd
      ? roundedShortfall > 0
        ? roundedShortfall
        : Math.ceil(shortfallRaw)
      : shortfallRaw;

  return {
    totalKhr,
    usdReceived,
    khrReceived,
    exchangeRate,
    usdEquivalentKhr,
    totalTenderedKhr,
    rawDifferenceKhr,
    roundedDifferenceKhr,
    isCovered,
    isShortfall,
    changeDueKhr,
    remainingDueKhr,
    isMixed: usdReceived > 0 && khrReceived > 0,
    hasAnyInput: usdReceived > 0 || khrReceived > 0,
  };
}

export function sanitizeCashPresets(
  raw: unknown,
  fallback: readonly number[] = DEFAULT_CASH_PRESETS
): number[] {
  if (!Array.isArray(raw)) {
    return [...fallback];
  }
  const unique = new Set<number>();
  for (const item of raw) {
    const parsed = parsePositiveKhrInteger(item as string | number);
    if (parsed !== null) {
      unique.add(parsed);
    }
  }
  return Array.from(unique)
    .sort((a, b) => a - b)
    .slice(0, MAX_CASH_PRESETS);
}

export function addCashPreset(
  presets: readonly number[],
  rawAmount: string | number
): CashPresetMutationResult {
  const current = sanitizeCashPresets([...presets], []);
  if (current.length >= MAX_CASH_PRESETS) {
    return {
      ok: false,
      presets: current,
      error: `Maximum ${MAX_CASH_PRESETS} quick-cash presets allowed.`,
    };
  }
  const parsed = parsePositiveKhrInteger(rawAmount);
  if (parsed === null) {
    return {
      ok: false,
      presets: current,
      error: 'Enter a valid KHR amount greater than 0.',
    };
  }
  if (current.includes(parsed)) {
    return {
      ok: false,
      presets: current,
      error: 'That preset amount already exists.',
    };
  }
  return {
    ok: true,
    presets: [...current, parsed].sort((a, b) => a - b),
  };
}

export function updateCashPreset(
  presets: readonly number[],
  oldAmount: number,
  rawNewAmount: string | number
): CashPresetMutationResult {
  const current = sanitizeCashPresets([...presets], []);
  if (!current.includes(oldAmount)) {
    return {
      ok: false,
      presets: current,
      error: 'Preset not found.',
    };
  }
  const parsed = parsePositiveKhrInteger(rawNewAmount);
  if (parsed === null) {
    return {
      ok: false,
      presets: current,
      error: 'Enter a valid KHR amount greater than 0.',
    };
  }
  if (parsed !== oldAmount && current.includes(parsed)) {
    return {
      ok: false,
      presets: current,
      error: 'That preset amount already exists.',
    };
  }
  return {
    ok: true,
    presets: current.map((v) => (v === oldAmount ? parsed : v)).sort((a, b) => a - b),
  };
}

export function removeCashPreset(presets: readonly number[], amountToRemove: number): number[] {
  return sanitizeCashPresets([...presets], []).filter((v) => v !== amountToRemove);
}
