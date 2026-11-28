import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';

export type CurrencyMode = 'KHR' | 'USD';

export interface CurrencyInputProps {
  /** Canonical stored amount in KHR (Riel). */
  valueKhr: number;
  /** Called whenever the user edits the value, passing the updated canonical KHR value. */
  onChangeKhr: (khr: number) => void;
  /** Store exchange rate (KHR per $1 USD, e.g. 4000). */
  exchangeRate: number;
  /** Optional initial display currency (defaults to 'KHR'). */
  defaultCurrency?: CurrencyMode;
  /** Controlled currency mode (optional — if provided with onCurrencyChange, overrides internal currency state). */
  currency?: CurrencyMode;
  onCurrencyChange?: (mode: CurrencyMode) => void;
  /** Allow decimals when entering KHR (useful for per-gram raw ingredient costs, e.g. 8.5 ៛/g). */
  allowDecimalsKhr?: boolean;
  /** Optional placeholder when value is 0 / empty. */
  placeholderKhr?: string;
  placeholderUsd?: string;
  /** Optional input id / htmlFor binding. */
  id?: string;
  /** Optional autoFocus. */
  autoFocus?: boolean;
  /** Optional disabled state. */
  disabled?: boolean;
  /** Optional error visual styling. */
  hasError?: boolean;
  /** Optional extra inline helper text appended next to the live equivalent readout. */
  helperExtra?: React.ReactNode;
  /** Hide the live equivalent readout below the input. */
  hideEquivalent?: boolean;
  /** Size variant: 'md' (44px, default) or 'lg' (48px). */
  size?: 'md' | 'lg';
  /** Extra classes on outer wrapper. */
  className?: string;
}

function roundKhrValue(val: number, allowDecimalsKhr: boolean): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (allowDecimalsKhr) {
    return Math.round(val * 100) / 100;
  }
  return Math.round(val);
}

function formatInputBuffer(khr: number, mode: CurrencyMode, rate: number, allowDecimalsKhr: boolean): string {
  if (!Number.isFinite(khr) || khr <= 0) return '';
  if (mode === 'KHR') {
    const clean = roundKhrValue(khr, allowDecimalsKhr);
    return String(clean);
  }
  const usd = khr / Math.max(1, rate);
  const rounded = Math.round(usd * 100) / 100;
  if (rounded <= 0) return '';
  // Trim trailing zeros only if integer, otherwise keep up to 2 decimals neatly
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  valueKhr,
  onChangeKhr,
  exchangeRate,
  defaultCurrency = 'KHR',
  currency: controlledCurrency,
  onCurrencyChange,
  allowDecimalsKhr = false,
  placeholderKhr = '0',
  placeholderUsd = '0.00',
  id,
  autoFocus,
  disabled = false,
  hasError = false,
  helperExtra,
  hideEquivalent = false,
  size = 'md',
  className = '',
}) => {
  const { isKm } = useLanguage();
  const safeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 4000;

  const [internalCurrency, setInternalCurrency] = useState<CurrencyMode>(defaultCurrency);
  const activeCurrency: CurrencyMode = controlledCurrency ?? internalCurrency;

  const [rawText, setRawText] = useState<string>(() =>
    formatInputBuffer(valueKhr, activeCurrency, safeRate, allowDecimalsKhr)
  );
  const isFocusedRef = useRef(false);
  const lastEmittedKhrRef = useRef<number>(roundKhrValue(valueKhr, allowDecimalsKhr));

  // Sync external programmatic value changes (e.g., reset, edit modal switch, quick preset)
  // without clobbering the user's in-progress typing buffer (e.g. "6." or "6.50").
  useEffect(() => {
    const normalizedExternal = roundKhrValue(valueKhr, allowDecimalsKhr);
    if (isFocusedRef.current && Math.abs(normalizedExternal - lastEmittedKhrRef.current) < 0.001) {
      return;
    }
    lastEmittedKhrRef.current = normalizedExternal;
    setRawText(formatInputBuffer(normalizedExternal, activeCurrency, safeRate, allowDecimalsKhr));
  }, [valueKhr, activeCurrency, safeRate, allowDecimalsKhr]);

  const handleModeSwitch = (nextMode: CurrencyMode) => {
    if (disabled || nextMode === activeCurrency) return;
    if (onCurrencyChange) {
      onCurrencyChange(nextMode);
    } else {
      setInternalCurrency(nextMode);
    }
    const normalized = roundKhrValue(valueKhr, allowDecimalsKhr);
    lastEmittedKhrRef.current = normalized;
    setRawText(formatInputBuffer(normalized, nextMode, safeRate, allowDecimalsKhr));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    // Allow digits and at most one decimal point when USD or allowDecimalsKhr
    const allowDecimal = activeCurrency === 'USD' || allowDecimalsKhr;
    const pattern = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
    if (!pattern.test(next)) return;

    setRawText(next);
    const parsed = parseFloat(next);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      lastEmittedKhrRef.current = 0;
      onChangeKhr(0);
      return;
    }

    const nextKhr =
      activeCurrency === 'USD'
        ? roundKhrValue(parsed * safeRate, allowDecimalsKhr)
        : roundKhrValue(parsed, allowDecimalsKhr);

    lastEmittedKhrRef.current = nextKhr;
    onChangeKhr(nextKhr);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    const normalized = roundKhrValue(valueKhr, allowDecimalsKhr);
    lastEmittedKhrRef.current = normalized;
    setRawText(formatInputBuffer(normalized, activeCurrency, safeRate, allowDecimalsKhr));
  };

  const safeKhr = Number.isFinite(valueKhr) && valueKhr > 0 ? valueKhr : 0;
  const usdEquivalent = safeKhr / safeRate;
  const formattedKhrEquiv = allowDecimalsKhr && !Number.isInteger(safeKhr)
    ? `${safeKhr.toLocaleString('en-US', { maximumFractionDigits: 2 })} ៛`
    : `${Math.round(safeKhr).toLocaleString('en-US')} ៛`;
  const formattedUsdEquiv = `$${usdEquivalent.toFixed(2)}`;

  const heightCls = size === 'lg' ? 'h-12' : 'h-11';

  return (
    <div className={className}>
      <div
        className={`flex items-center ${heightCls} w-full rounded-xl border transition-colors ${
          disabled
            ? 'bg-slate-100/80 dark:bg-emerald-950/30 border-slate-200/70 dark:border-emerald-900/50 opacity-65 cursor-not-allowed'
            : hasError
            ? 'bg-white dark:bg-[#0B1712] border-rose-400 dark:border-rose-500/70 focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20'
            : 'bg-white dark:bg-[#0B1712] border-slate-200 dark:border-emerald-900/60 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20'
        }`}
      >
        <span
          aria-hidden="true"
          className="pl-3.5 pr-1.5 text-sm font-semibold text-slate-400 dark:text-slate-500 select-none shrink-0"
        >
          {activeCurrency === 'KHR' ? '៛' : '$'}
        </span>
        <input
          id={id}
          type="text"
          inputMode={activeCurrency === 'USD' || allowDecimalsKhr ? 'decimal' : 'numeric'}
          autoFocus={autoFocus}
          disabled={disabled}
          value={rawText}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={activeCurrency === 'KHR' ? placeholderKhr : placeholderUsd}
          className="w-full min-w-0 h-full bg-transparent text-sm font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 tabular-nums focus:outline-none pr-2"
        />
        <div
          role="group"
          aria-label={isKm ? 'ជ្រើសរើសរូបិយប័ណ្ណ' : 'Select currency'}
          className="flex items-center p-1 mr-1 rounded-lg bg-slate-100 dark:bg-[#12241C] border border-slate-200/70 dark:border-emerald-900/50 shrink-0"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleModeSwitch('KHR')}
            className={`px-2 h-7 rounded-md text-[11px] font-bold tracking-tight transition-colors whitespace-nowrap ${
              activeCurrency === 'KHR'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            ៛ KHR
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleModeSwitch('USD')}
            className={`px-2 h-7 rounded-md text-[11px] font-bold tracking-tight transition-colors whitespace-nowrap ${
              activeCurrency === 'USD'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            $ USD
          </button>
        </div>
      </div>

      {!hideEquivalent && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <span>
            {activeCurrency === 'KHR'
              ? `≈ ${formattedUsdEquiv}`
              : `≈ ${formattedKhrEquiv}`}
          </span>
          {helperExtra && <span className="text-right">{helperExtra}</span>}
        </div>
      )}
    </div>
  );
};
