export const DEFAULT_POS_EXCHANGE_RATE = 4000;

export interface CashTenderInput {
  totalKhr: number;
  usdReceived: number;
  khrReceived: number;
  exchangeRate: number;
}

export interface CashTenderResult {
  usdReceived: number;
  khrReceived: number;
  exchangeRate: number;
  usdEquivalentKhr: number;
  totalTenderedKhr: number;
  rawDifferenceKhr: number;
  roundedDifferenceKhr: number;
  isCovered: boolean;
  changeDueKhr: number;
  remainingDueKhr: number;
  isMixed: boolean;
  hasAnyInput: boolean;
}

export function roundKhrToNearest100(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount / 100) * 100;
}

export function parseNonNegativeNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

export function formatUsdClean(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const rounded = Math.round(safe * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded.toLocaleString('en-US')}` : `$${rounded.toFixed(2)}`;
}

export function computeExactRemainingKhr(
  totalKhr: number,
  usdReceived: number,
  exchangeRate: number
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
    Number.isFinite(input.exchangeRate) && input.exchangeRate > 0
      ? Math.round(input.exchangeRate)
      : DEFAULT_POS_EXCHANGE_RATE;

  const usdEquivalentKhr = Math.round(usdReceived * exchangeRate);
  const totalTenderedKhr = usdEquivalentKhr + khrReceived;
  const rawDifferenceKhr = totalTenderedKhr - totalKhr;
  const roundedDifferenceKhr = roundKhrToNearest100(rawDifferenceKhr);

  const isCovered = totalTenderedKhr >= totalKhr;
  const changeDueKhr = isCovered ? Math.max(0, roundedDifferenceKhr) : 0;
  const shortfallRaw = Math.max(0, totalKhr - totalTenderedKhr);
  const roundedShortfall = roundKhrToNearest100(shortfallRaw);
  const remainingDueKhr = isCovered
    ? 0
    : roundedShortfall > 0
      ? roundedShortfall
      : Math.ceil(shortfallRaw);

  return {
    usdReceived,
    khrReceived,
    exchangeRate,
    usdEquivalentKhr,
    totalTenderedKhr,
    rawDifferenceKhr,
    roundedDifferenceKhr,
    isCovered,
    changeDueKhr,
    remainingDueKhr,
    isMixed: usdReceived > 0 && khrReceived > 0,
    hasAnyInput: usdReceived > 0 || khrReceived > 0,
  };
}
