import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  CupSoda,
  HardDrive,
  Loader2,
  Package,
  PackageCheck,
  Plus,
  Sparkles,
  TrendingUp,
  User,
  Wheat,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type {
  AppTab,
  IngredientUnit,
  PaymentMethod,
  Product,
  StockClassification,
} from '../types';
import {
  BUSINESS_TIMEZONE,
  daysAgoIso,
  formatKhr,
  formatQty,
  formatUsdRef,
  todayIso,
} from '../utils/format';
import { computeFinancialReport } from '../utils/inventoryEngine';
import { getStockClassificationBadgeClass } from '../utils/categories';
import { InfoHint } from '../components/InfoHint';
import { ModalPortal } from '../components/ModalPortal';
import { useTheme } from '../hooks/useTheme';

export type DashboardQuickAction = 'add_expense' | 'add_product';

interface DashboardViewProps {
  onNavigate: (tab: AppTab, action?: DashboardQuickAction) => void;
}

type ChartTimeframe = 'today' | '7d' | '30d';

interface UnifiedLowStockItem {
  key: string;
  itemId: string;
  name: string;
  nameVi: string;
  classification: StockClassification;
  stockQty: number;
  reorderLevel: number;
  unit: IngredientUnit;
  unitCostKhr: number;
  supplier: string;
  progressPct: number;
  sourceProduct?: Product;
}

function getPhnomPenhHour(date: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    if (Number.isFinite(h)) return h % 24;
  } catch {
    // Fallback UTC+7
  }
  return (date.getUTCHours() + 7) % 24;
}

function formatReadableToday(isKm: boolean): string {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat(isKm ? 'km-KH' : 'en-US', {
      timeZone: BUSINESS_TIMEZONE,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(now);
  } catch {
    return todayIso();
  }
}

function getLocalizedItemName(name: string, nameVi: string | undefined, isKm: boolean): string {
  if (isKm && nameVi && /[\u1780-\u17FF]/.test(nameVi)) {
    return nameVi;
  }
  return name;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    settings,
    sales,
    expenses,
    purchases,
    products,
    ingredients,
    cloudSynced,
    syncing,
    recordStockPurchase,
    t,
  } = useStore();
  const { isDark } = useTheme();
  const isKm = settings.language === 'km';

  const [timeframe, setTimeframe] = useState<ChartTimeframe>('7d');
  const [feedbackBanner, setFeedbackBanner] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Inline Quick Restock modal state
  const [restockTarget, setRestockTarget] = useState<UnifiedLowStockItem | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [restockTotalCost, setRestockTotalCost] = useState('');
  const [restockPayment, setRestockPayment] = useState<PaymentMethod>('cash');
  const [restockSupplier, setRestockSupplier] = useState('');
  const [restockNote, setRestockNote] = useState('');
  const [restockSubmitting, setRestockSubmitting] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);

  const today = todayIso();
  const yesterday = daysAgoIso(1);
  const sevenDaysAgo = daysAgoIso(6);
  const thirtyDaysAgo = daysAgoIso(29);

  const currentHour = getPhnomPenhHour();
  const greeting = useMemo(() => {
    if (currentHour < 12) return isKm ? 'អរុណសួស្តី' : 'Good morning';
    if (currentHour < 18) return isKm ? 'ទិវាសួស្តី' : 'Good afternoon';
    return isKm ? 'សាយ័ណ្ហសួស្តី' : 'Good evening';
  }, [currentHour, isKm]);

  const readableDate = useMemo(() => formatReadableToday(isKm), [isKm]);

  const chartColors = useMemo(
    () => ({
      grid: isDark ? '#24352C' : '#E7E5E4',
      tick: isDark ? '#94A39B' : '#78716C',
      revenue: isDark ? '#10B981' : '#0F5C43',
      tooltipBg: isDark ? '#131D18' : '#FFFFFF',
      tooltipBorder: isDark ? '#24352C' : '#E7E5E4',
      tooltipText: isDark ? '#F1F5F3' : '#1C1917',
    }),
    [isDark]
  );

  // Core financial reports (reusing inventoryEngine calculations)
  const todayReport = useMemo(
    () =>
      computeFinancialReport({
        sales,
        expenses,
        purchases,
        products,
        ingredients,
        dateStart: today,
        dateEnd: today,
        grouping: 'daily',
      }),
    [sales, expenses, purchases, products, ingredients, today]
  );

  const yesterdayReport = useMemo(
    () =>
      computeFinancialReport({
        sales,
        expenses,
        purchases,
        products,
        ingredients,
        dateStart: yesterday,
        dateEnd: yesterday,
        grouping: 'daily',
      }),
    [sales, expenses, purchases, products, ingredients, yesterday]
  );

  const sevenDayReport = useMemo(
    () =>
      computeFinancialReport({
        sales,
        expenses,
        purchases,
        products,
        ingredients,
        dateStart: sevenDaysAgo,
        dateEnd: today,
        grouping: 'daily',
      }),
    [sales, expenses, purchases, products, ingredients, sevenDaysAgo, today]
  );

  const thirtyDayReport = useMemo(
    () =>
      computeFinancialReport({
        sales,
        expenses,
        purchases,
        products,
        ingredients,
        dateStart: thirtyDaysAgo,
        dateEnd: today,
        grouping: 'daily',
      }),
    [sales, expenses, purchases, products, ingredients, thirtyDaysAgo, today]
  );

  // Revenue % change vs yesterday
  const revenueDelta = useMemo(() => {
    const revToday = todayReport.netRevenueKhr;
    const revYest = yesterdayReport.netRevenueKhr;
    if (revYest <= 0) {
      if (revToday > 0) {
        return { kind: 'up' as const, label: isKm ? 'កើនពី 0 ៛ ថ្ងៃនេះ' : 'Up from 0 ៛' };
      }
      return { kind: 'flat' as const, label: isKm ? 'ដូចម្សិលមិញ' : 'Same as yesterday' };
    }
    const pct = Math.round(((revToday - revYest) / revYest) * 100);
    if (pct > 0) {
      return {
        kind: 'up' as const,
        label: `+${pct}% ${isKm ? 'ធៀបនឹងម្សិលមិញ' : 'vs yesterday'}`,
      };
    }
    if (pct < 0) {
      return {
        kind: 'down' as const,
        label: `${pct}% ${isKm ? 'ធៀបនឹងម្សិលមិញ' : 'vs yesterday'}`,
      };
    }
    return {
      kind: 'flat' as const,
      label: `0% ${isKm ? 'ធៀបនឹងម្សិលមិញ' : 'vs yesterday'}`,
    };
  }, [todayReport.netRevenueKhr, yesterdayReport.netRevenueKhr, isKm]);

  // Expenses & Net Cash Flow (matching DailySummary calculation)
  const todayExpensesTotalKhr =
    todayReport.operatingExpensesKhr + todayReport.inventoryPurchasesCashOutKhr;
  const todayNetCashFlowKhr = todayReport.netRevenueKhr - todayExpensesTotalKhr;

  // Unified Low / Out-of-Stock items across Raw Ingredients and Retail Packaged stock
  const lowStockList = useMemo<UnifiedLowStockItem[]>(() => {
    const alerts: UnifiedLowStockItem[] = [];

    for (const p of products) {
      if (!p.active) continue;
      if (p.productType === 'PACKAGED') {
        if (p.stockQty <= p.reorderLevel) {
          const denom = Math.max(p.reorderLevel * 2, 1);
          const pct =
            p.stockQty <= 0 ? 0 : Math.min(100, Math.max(6, Math.round((p.stockQty / denom) * 100)));
          alerts.push({
            key: `prod_${p.id}`,
            itemId: p.id,
            name: p.name,
            nameVi: p.nameVi || p.name,
            classification: 'packaged',
            stockQty: p.stockQty,
            reorderLevel: p.reorderLevel,
            unit: p.unit,
            unitCostKhr: p.costPriceKhr,
            supplier: p.supplier || '',
            progressPct: pct,
            sourceProduct: p,
          });
        }
      }
    }

    for (const ing of ingredients) {
      if (ing.stockQty <= ing.reorderLevel) {
        const denom = Math.max(ing.reorderLevel * 2, 1);
        const pct =
          ing.stockQty <= 0
            ? 0
            : Math.min(100, Math.max(6, Math.round((ing.stockQty / denom) * 100)));
        alerts.push({
          key: `ing_${ing.id}`,
          itemId: ing.id,
          name: ing.name,
          nameVi: ing.nameVi || ing.name,
          classification: 'ingredient',
          stockQty: ing.stockQty,
          reorderLevel: ing.reorderLevel,
          unit: ing.unit,
          unitCostKhr: ing.unitCostKhr,
          supplier: ing.supplier || '',
          progressPct: pct,
        });
      }
    }

    return alerts.sort((a, b) => {
      const aOut = a.stockQty <= 0 ? 0 : 1;
      const bOut = b.stockQty <= 0 ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      return a.stockQty - a.reorderLevel - (b.stockQty - b.reorderLevel);
    });
  }, [products, ingredients]);

  const outOfStockCount = useMemo(
    () => lowStockList.filter((i) => i.stockQty <= 0).length,
    [lowStockList]
  );
  const lowOnlyCount = lowStockList.length - outOfStockCount;

  // Top Selling Drinks Today (top 5 from todayReport.productProfitability)
  const topSellingToday = useMemo(
    () => todayReport.productProfitability.slice(0, 5),
    [todayReport.productProfitability]
  );
  const maxTopRevenue = useMemo(
    () => Math.max(...topSellingToday.map((p) => p.netRevenueKhr), 1),
    [topSellingToday]
  );

  // Plain-English / Khmer "Today at a Glance" dynamic sentences
  const insightCopy = useMemo(() => {
    const orders = todayReport.completedOrderCount;
    const rev = formatKhr(todayReport.netRevenueKhr);
    const margin = todayReport.grossMarginPct;

    if (isKm) {
      const stockPhrase =
        outOfStockCount > 0 && lowOnlyCount > 0
          ? `មាន ${outOfStockCount} មុខអស់ពីស្តុក និង ${lowOnlyCount} មុខជិតអស់ស្តុក`
          : outOfStockCount > 0
            ? `មាន ${outOfStockCount} មុខអស់ពីស្តុក`
            : lowOnlyCount > 0
              ? `មាន ${lowOnlyCount} មុខជិតអស់ស្តុក`
              : 'ស្តុកទំនិញទាំងអស់គ្រប់គ្រាន់ល្អ';

      if (orders === 0) {
        return {
          primary: `មិនទាន់មានការកុម្ម៉ង់ថ្ងៃនេះទេ — រួចរាល់ទទួលភ្ញៀវហើយ! បច្ចុប្បន្ន${stockPhrase}។`,
          secondary:
            todayExpensesTotalKhr > 0
              ? `អ្នកបានកត់ត្រាចំណាយ ${formatKhr(todayExpensesTotalKhr)} រួចហើយថ្ងៃនេះ។`
              : null,
        };
      }

      const topItem = topSellingToday[0];
      return {
        primary: `ថ្ងៃនេះលក់បាន ${orders} វិក្កយបត្រ សរុប ${rev} (ប្រាក់ចំណេញដុល ${margin}%) ហើយ${stockPhrase}។`,
        secondary: topItem
          ? `មុខលក់ដាច់បំផុតថ្ងៃនេះគឺ ${getLocalizedItemName(topItem.name, topItem.nameVi, true)} (${topItem.netQty} កែវ/មុខ)។`
          : null,
      };
    }

    const stockPhrase =
      outOfStockCount > 0 && lowOnlyCount > 0
        ? `with ${outOfStockCount} ${outOfStockCount === 1 ? 'item' : 'items'} out of stock and ${lowOnlyCount} running low`
        : outOfStockCount > 0
          ? `with ${outOfStockCount} ${outOfStockCount === 1 ? 'item' : 'items'} out of stock`
          : lowOnlyCount > 0
            ? `with ${lowOnlyCount} ${lowOnlyCount === 1 ? 'item' : 'items'} running low in stock`
            : 'and all stock levels are healthy';

    if (orders === 0) {
      return {
        primary: `No orders recorded yet today — ready for your first customer, ${stockPhrase}.`,
        secondary:
          todayExpensesTotalKhr > 0
            ? `You've logged ${formatKhr(todayExpensesTotalKhr)} in expenses so far today.`
            : null,
      };
    }

    const orderWord = orders === 1 ? 'order' : 'orders';
    const topItem = topSellingToday[0];
    return {
      primary: `You've made ${orders} ${orderWord} totaling ${rev} today (${margin}% gross margin), ${stockPhrase}.`,
      secondary: topItem
        ? `Top seller so far is ${topItem.name} (${topItem.netQty} sold).`
        : null,
    };
  }, [
    todayReport.completedOrderCount,
    todayReport.netRevenueKhr,
    todayReport.grossMarginPct,
    outOfStockCount,
    lowOnlyCount,
    todayExpensesTotalKhr,
    topSellingToday,
    isKm,
  ]);

  // Chart data for Today (hourly Phnom Penh buckets), 7 Days, and 30 Days
  const chartData = useMemo(() => {
    if (timeframe === 'today') {
      const hourTotals = new Map<number, { revenue: number; orders: number }>();
      let minHour = 8;
      let maxHour = Math.max(18, currentHour);

      for (const s of sales) {
        if (s.saleDate !== today) continue;
        if (s.status === 'voided' || s.status === 'refunded') continue;
        const dt = new Date(s.createdAt);
        const h = Number.isNaN(dt.getTime()) ? currentHour : getPhnomPenhHour(dt);
        if (h < minHour) minHour = h;
        if (h > maxHour) maxHour = h;
        const netSaleRev = Math.max(0, s.totalKhr - (s.refundedKhr || 0));
        const prev = hourTotals.get(h) || { revenue: 0, orders: 0 };
        hourTotals.set(h, { revenue: prev.revenue + netSaleRev, orders: prev.orders + 1 });
      }

      const points: { key: string; label: string; revenue: number; orders: number }[] = [];
      for (let h = minHour; h <= maxHour; h++) {
        const hh = `${String(h).padStart(2, '0')}:00`;
        const entry = hourTotals.get(h);
        points.push({
          key: hh,
          label: hh,
          revenue: entry ? entry.revenue : 0,
          orders: entry ? entry.orders : 0,
        });
      }
      return points;
    }

    const spanDays = timeframe === '7d' ? 7 : 30;
    const report = timeframe === '7d' ? sevenDayReport : thirtyDayReport;
    const byDate = new Map(report.series.map((b) => [b.periodKey, b]));
    const points: { key: string; label: string; revenue: number; orders: number }[] = [];

    for (let i = spanDays - 1; i >= 0; i--) {
      const iso = daysAgoIso(i);
      const b = byDate.get(iso);
      const [, mm, dd] = iso.split('-');
      points.push({
        key: iso,
        label: `${dd}/${mm}`,
        revenue: b ? b.netRevenueKhr : 0,
        orders: b ? b.orderCount : 0,
      });
    }
    return points;
  }, [timeframe, sales, today, currentHour, sevenDayReport, thirtyDayReport]);

  const activePeriodSummary = useMemo(() => {
    if (timeframe === 'today') {
      return {
        revenue: todayReport.netRevenueKhr,
        orders: todayReport.completedOrderCount,
      };
    }
    if (timeframe === '7d') {
      return {
        revenue: sevenDayReport.netRevenueKhr,
        orders: sevenDayReport.completedOrderCount,
      };
    }
    return {
      revenue: thirtyDayReport.netRevenueKhr,
      orders: thirtyDayReport.completedOrderCount,
    };
  }, [timeframe, todayReport, sevenDayReport, thirtyDayReport]);

  const getTierLabel = (c: StockClassification) => {
    if (c === 'packaged') return isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged';
    return isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients';
  };

  // Inline Quick Restock handlers
  const openInlineRestock = (item: UnifiedLowStockItem) => {
    const suggestedQty = Math.max(
      Math.ceil(item.reorderLevel * 2 - item.stockQty),
      item.reorderLevel > 0 ? Math.ceil(item.reorderLevel) : 10,
      1
    );
    setRestockTarget(item);
    setRestockQty(String(suggestedQty));
    setRestockTotalCost(String(Math.round(suggestedQty * Math.max(0, item.unitCostKhr))));
    setRestockPayment('cash');
    setRestockSupplier(item.supplier || '');
    setRestockNote('');
    setRestockError(null);
  };

  const handleSubmitInlineRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockTarget || restockSubmitting) return;

    const qty = Number(restockQty) || 0;
    if (qty <= 0) {
      setRestockError(
        isKm ? 'សូមបញ្ចូលបរិមាណធំជាង 0។' : 'Please enter a quantity greater than 0.'
      );
      return;
    }

    setRestockSubmitting(true);
    setRestockError(null);
    try {
      const res = await recordStockPurchase({
        itemId: restockTarget.itemId,
        itemClassification: restockTarget.classification,
        quantity: qty,
        totalCostKhr: Math.max(0, Number(restockTotalCost) || 0),
        paymentMethod: restockPayment,
        supplier: restockSupplier.trim(),
        note: restockNote.trim() || (isKm ? 'បញ្ចូលស្តុករហ័សពីផ្ទាំងគ្រប់គ្រង' : 'Quick restock from Dashboard'),
        purchaseDate: today,
      });
      if (!res.ok) {
        setRestockError(res.error || (isKm ? 'មិនអាចបញ្ចូលស្តុកបានទេ។' : 'Could not record restock.'));
        return;
      }
      const displayName = getLocalizedItemName(restockTarget.name, restockTarget.nameVi, isKm);
      setFeedbackBanner({
        kind: 'ok',
        text: isKm
          ? `បានបញ្ចូលស្តុក +${formatQty(qty, restockTarget.unit)} ${displayName}។`
          : `Restocked +${formatQty(qty, restockTarget.unit)} of ${displayName}.`,
      });
      setRestockTarget(null);
    } finally {
      setRestockSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ================================================================== */}
      {/* 1. HEADER & QUICK-ACTION BAR (ABOVE THE FOLD)                      */}
      {/* ================================================================== */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {greeting}
              {settings.activeOperator ? `, ${settings.activeOperator}` : ''}
            </h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{readableDate}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-xs">{today}</span>
            </p>
          </div>

          {/* Active Team Member + Sync Status Pills */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
              <User className="w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] shrink-0" />
              <span className="truncate max-w-[140px]">
                {settings.activeOperator || (isKm ? 'បុគ្គលិក' : 'Team Member')}
              </span>
            </span>

            <span
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-semibold ${
                syncing
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-200'
                  : cloudSynced
                    ? 'bg-emerald-50 dark:bg-[#064E3B]/60 border-emerald-200 dark:border-[#10B981]/40 text-emerald-800 dark:text-[#A7F3D0]'
                    : 'bg-stone-100 dark:bg-[#18251F] border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA]'
              }`}
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : cloudSynced ? (
                <Cloud className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <HardDrive className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {syncing
                  ? isKm
                    ? 'កំពុងធ្វើសមកាលកម្ម...'
                    : 'Syncing...'
                  : cloudSynced
                    ? isKm
                      ? 'បានភ្ជាប់ Cloud'
                      : 'Cloud Synced'
                    : isKm
                      ? 'រក្សាទុកក្នុងម៉ាស៊ីន'
                      : 'Saved Locally'}
              </span>
            </span>
          </div>
        </div>

        {/* 4 Quick-Action Shortcut Buttons (h-12 touch targets) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{isKm ? 'ការលក់ថ្មី' : 'New Sale'}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('expenses', 'add_expense')}
            className="h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 hover:border-stone-300 dark:hover:bg-[#18251F] dark:hover:border-[#344B3F] transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0 text-[#0F5C43] dark:text-[#34D399]" />
            <span>{isKm ? 'កត់ត្រាចំណាយ' : 'Log Expense'}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 hover:border-stone-300 dark:hover:bg-[#18251F] dark:hover:border-[#344B3F] transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0 text-[#0F5C43] dark:text-[#34D399]" />
            <span>{isKm ? 'បញ្ចូលស្តុក' : 'Restock Item'}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('products', 'add_product')}
            className="h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 hover:border-stone-300 dark:hover:bg-[#18251F] dark:hover:border-[#344B3F] transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0 text-[#0F5C43] dark:text-[#34D399]" />
            <span>{isKm ? 'បន្ថែមផលិតផល' : 'Add Product'}</span>
          </button>
        </div>
      </section>

      {/* Inline Action Feedback Toast */}
      {feedbackBanner && (
        <div
          role="status"
          className={`px-4 py-3 rounded-xl border text-sm font-medium flex items-center justify-between gap-3 ${
            feedbackBanner.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-[#064E3B] border-emerald-200 dark:border-[#10B981]/50 text-emerald-900 dark:text-[#D1FAE5]'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-500/40 text-red-900 dark:text-red-200'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {feedbackBanner.text}
          </span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            aria-label={t.common.close}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ================================================================== */}
      {/* 2. PLAIN-ENGLISH DAILY INSIGHT STRIP ("TODAY AT A GLANCE")         */}
      {/* ================================================================== */}
      <section
        aria-label={isKm ? 'សង្ខេបថ្ងៃនេះ' : 'Today at a Glance'}
        className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl px-4 sm:px-5 py-4 flex items-start gap-3.5"
      >
        <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-[#064E3B]/70 border border-emerald-200/80 dark:border-[#10B981]/30 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0F5C43] dark:text-[#34D399]">
            {isKm ? 'សង្ខេបថ្ងៃនេះ' : 'Today at a Glance'}
          </p>
          <p className="text-sm sm:text-[15px] leading-relaxed text-stone-800 dark:text-[#E7EFEA] font-medium">
            {insightCopy.primary}
            {insightCopy.secondary ? (
              <span className="text-stone-500 dark:text-[#94A39B] font-normal">
                {' '}
                {insightCopy.secondary}
              </span>
            ) : null}
          </p>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 3. 4 CLEAN PRIMARY KPI CARDS (WITH <InfoHint> TRIGGERS)            */}
      {/* ================================================================== */}
      <section aria-label={isKm ? 'តួលេខសំខាន់ថ្ងៃនេះ' : "Today's Key Metrics"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Today's Revenue */}
          <div className="pos-lift bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-xs font-semibold text-stone-500 dark:text-[#94A39B] truncate">
                  {isKm ? 'ចំណូលថ្ងៃនេះ' : "Today's Revenue"}
                </p>
                <InfoHint
                  compact
                  label={isKm ? 'អំពីចំណូលថ្ងៃនេះ' : "About Today's Revenue"}
                  text={
                    isKm
                      ? 'ចំណូលលក់សុទ្ធថ្ងៃនេះក្រោយកាត់វិក្កយបត្រលុប និងការបង្វិលសង ធៀបនឹងម្សិលមិញ។'
                      : 'Net sales revenue collected today after voids and refunds, compared against yesterday.'
                  }
                />
              </div>
              <span className="font-mono-num text-[11px] font-medium text-stone-400 dark:text-[#94A39B] whitespace-nowrap">
                {todayReport.completedOrderCount} {isKm ? 'វិក្កយបត្រ' : 'orders'}
              </span>
            </div>

            <div>
              <p className="font-mono-num text-2xl sm:text-[26px] font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
                {formatKhr(todayReport.netRevenueKhr)}
              </p>
              <p className="mt-1 font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                {formatUsdRef(todayReport.netRevenueKhr, settings.usdRate)}
              </p>
            </div>

            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] flex items-center gap-1.5 text-xs font-medium">
              {revenueDelta.kind === 'up' ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-[#34D399]">
                  <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                  {revenueDelta.label}
                </span>
              ) : revenueDelta.kind === 'down' ? (
                <span className="inline-flex items-center gap-1 text-red-600 dark:text-[#F87171]">
                  <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
                  {revenueDelta.label}
                </span>
              ) : (
                <span className="text-stone-500 dark:text-[#94A39B]">{revenueDelta.label}</span>
              )}
            </div>
          </div>

          {/* KPI 2: Est. Gross Profit */}
          <div className="pos-lift bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-xs font-semibold text-stone-500 dark:text-[#94A39B] truncate">
                  {isKm ? 'ប្រាក់ចំណេញដុលប៉ាន់ស្មាន' : 'Est. Gross Profit'}
                </p>
                <InfoHint
                  compact
                  label={isKm ? 'អំពីប្រាក់ចំណេញដុល' : 'About Estimated Gross Profit'}
                  text={
                    isKm
                      ? 'ចំណូលសុទ្ធថ្ងៃនេះដកថ្លៃដើមទំនិញលក់ (COGS)។ អត្រាចំណេញដុល = ប្រាក់ចំណេញដុល ÷ ចំណូល។'
                      : 'Today’s net revenue minus Cost of Goods Sold (recipe ingredients & unit costs). Gross Margin = Gross Profit ÷ Revenue.'
                  }
                />
              </div>
              <span
                className={`font-mono-num text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                  todayReport.grossMarginPct >= 50
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-[#064E3B]/70 dark:text-[#6EE7B7] dark:border-[#10B981]/35'
                    : todayReport.grossMarginPct > 0
                      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-500/35'
                      : 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C]'
                }`}
              >
                {todayReport.grossMarginPct}% {isKm ? 'អត្រា' : 'margin'}
              </span>
            </div>

            <div>
              <p
                className={`font-mono-num text-2xl sm:text-[26px] font-bold tracking-tight ${
                  todayReport.grossProfitKhr >= 0
                    ? 'text-emerald-700 dark:text-[#34D399]'
                    : 'text-red-700 dark:text-[#F87171]'
                }`}
              >
                {formatKhr(todayReport.grossProfitKhr)}
              </p>
              <p className="mt-1 font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                {formatUsdRef(todayReport.grossProfitKhr, settings.usdRate)}
              </p>
            </div>

            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-between text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              <span>{isKm ? 'ថ្លៃដើមទំនិញលក់' : 'Item COGS'}</span>
              <span className="font-medium text-stone-700 dark:text-[#D5DFDA]">
                {formatKhr(todayReport.netCogsKhr)}
              </span>
            </div>
          </div>

          {/* KPI 3: Today's Expenses */}
          <div className="pos-lift bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-xs font-semibold text-stone-500 dark:text-[#94A39B] truncate">
                  {isKm ? 'ចំណាយថ្ងៃនេះ' : "Today's Expenses"}
                </p>
                <InfoHint
                  compact
                  label={isKm ? 'អំពីចំណាយថ្ងៃនេះ' : "About Today's Expenses"}
                  text={
                    isKm
                      ? 'សាច់ប្រាក់ចំណាយសរុបថ្ងៃនេះ រួមទាំងចំណាយប្រតិបត្តិការ និងការទិញបញ្ចូលស្តុក។ លំហូរសាច់ប្រាក់សុទ្ធ = ចំណូលថ្ងៃនេះ − ចំណាយថ្ងៃនេះ។'
                      : 'Total cash spent today across operating expenses and stock restocks. Net cash flow = Today’s Revenue − Today’s Expenses.'
                  }
                />
              </div>
              <TrendingUp className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0" />
            </div>

            <div>
              <p className="font-mono-num text-2xl sm:text-[26px] font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
                {formatKhr(todayExpensesTotalKhr)}
              </p>
              <p className="mt-1 font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                {formatUsdRef(todayExpensesTotalKhr, settings.usdRate)}
              </p>
            </div>

            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-between gap-2 text-xs font-mono-num">
              <span className="text-stone-500 dark:text-[#94A39B]">
                {isKm ? 'សាច់ប្រាក់សុទ្ធ' : 'Net cash'}
              </span>
              <span
                className={`font-semibold ${
                  todayNetCashFlowKhr >= 0
                    ? 'text-emerald-700 dark:text-[#34D399]'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {todayNetCashFlowKhr >= 0 ? '+' : ''}
                {formatKhr(todayNetCashFlowKhr)}
              </span>
            </div>
          </div>

          {/* KPI 4: Low / Out of Stock (Clickable card -> Inventory) */}
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="pos-lift text-left bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] hover:border-stone-300 dark:hover:border-[#344B3F] rounded-xl p-5 flex flex-col justify-between gap-3 transition-colors group"
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <div
                className="flex items-center gap-1 min-w-0"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-xs font-semibold text-stone-500 dark:text-[#94A39B] truncate">
                  {isKm ? 'ស្តុកជិតអស់ / អស់ស្តុក' : 'Low / Out of Stock'}
                </p>
                <InfoHint
                  compact
                  label={isKm ? 'អំពីការជូនដំណឹងស្តុក' : 'About Stock Alerts'}
                  text={
                    isKm
                      ? 'វត្ថុធាតុដើម និងទំនិញវេចខ្ចប់ស្រាប់ដែលមានចំនួនស្មើ ឬទាបជាងកម្រិតបញ្ជាទិញឡើងវិញ។'
                      : 'Items across Raw Ingredients and Retail Packaged goods currently at or below their low-stock threshold.'
                  }
                />
              </div>
              {lowStockList.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <PackageCheck className="w-4 h-4 text-emerald-600 dark:text-[#34D399] shrink-0" />
              )}
            </div>

            <div>
              <p
                className={`font-mono-num text-2xl sm:text-[26px] font-bold tracking-tight ${
                  outOfStockCount > 0
                    ? 'text-red-700 dark:text-[#F87171]'
                    : lowStockList.length > 0
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-[#34D399]'
                }`}
              >
                {lowStockList.length}{' '}
                <span className="text-sm font-sans font-semibold">
                  {isKm ? 'មុខ' : lowStockList.length === 1 ? 'item' : 'items'}
                </span>
              </p>
              <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B]">
                {lowStockList.length === 0
                  ? isKm
                    ? 'ស្តុកទំនិញទាំងអស់គ្រប់គ្រាន់'
                    : 'All stock levels healthy'
                  : isKm
                    ? `${outOfStockCount} អស់ស្តុក · ${lowOnlyCount} ជិតអស់`
                    : `${outOfStockCount} out · ${lowOnlyCount} low`}
              </p>
            </div>

            <div className="pt-2 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-between text-xs font-semibold text-[#0F5C43] dark:text-[#34D399]">
              <span>{isKm ? 'មើលស្តុកទំនិញ' : 'View Inventory'}</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </button>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 4. SALES TREND CHART (TODAY / 7 DAYS / 30 DAYS)                    */}
      {/* ================================================================== */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {isKm ? 'និន្នាការលក់' : 'Sales Trend'}
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              <strong className="text-stone-800 dark:text-[#F1F5F3]">
                {formatKhr(activePeriodSummary.revenue)}
              </strong>{' '}
              · {activePeriodSummary.orders}{' '}
              {isKm ? 'វិក្កយបត្រ' : activePeriodSummary.orders === 1 ? 'order' : 'orders'}
            </p>
          </div>

          {/* Clean 3-Way Timeframe Switcher */}
          <div
            role="tablist"
            aria-label={isKm ? 'ចន្លោះពេលក្រាហ្វិក' : 'Chart timeframe'}
            className="inline-flex items-center p-1 rounded-xl bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] self-start sm:self-auto"
          >
            {(
              [
                { id: 'today', label: isKm ? 'ថ្ងៃនេះ' : 'Today' },
                { id: '7d', label: isKm ? '៧ ថ្ងៃ' : '7 Days' },
                { id: '30d', label: isKm ? '៣០ ថ្ងៃ' : '30 Days' },
              ] as const
            ).map((opt) => {
              const active = timeframe === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTimeframe(opt.id)}
                  className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#2C4035]'
                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] border border-transparent'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dashRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={chartColors.revenue}
                    stopOpacity={isDark ? 0.3 : 0.18}
                  />
                  <stop offset="95%" stopColor={chartColors.revenue} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={chartColors.grid}
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: chartColors.tick }}
                axisLine={{ stroke: chartColors.grid }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 11, fill: chartColors.tick }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v) => {
                  const n = Number(v) || 0;
                  if (n === 0) return '0';
                  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
                }}
              />
              <Tooltip
                formatter={(value, _name, item) => {
                  const orders = (item?.payload as { orders?: number } | undefined)?.orders ?? 0;
                  return [
                    `${formatKhr(Number(value ?? 0))} (${orders} ${isKm ? 'វិក្កយបត្រ' : 'orders'})`,
                    isKm ? 'ចំណូល' : 'Revenue',
                  ];
                }}
                contentStyle={{
                  borderRadius: '10px',
                  border: `1px solid ${chartColors.tooltipBorder}`,
                  backgroundColor: chartColors.tooltipBg,
                  color: chartColors.tooltipText,
                  boxShadow: 'none',
                  fontSize: '12px',
                }}
                labelStyle={{ color: chartColors.tooltipText, fontWeight: 600 }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name={isKm ? 'ចំណូល' : 'Revenue'}
                stroke={chartColors.revenue}
                strokeWidth={2.25}
                fill="url(#dashRevenueFill)"
                activeDot={{ r: 4.5, fill: chartColors.revenue }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 5. FOCUSED BOTTOM SPLIT: TOP SELLING DRINKS & NEEDS RESTOCK        */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Card A: Top Selling Drinks Today */}
        <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CupSoda className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                {isKm ? 'ភេសជ្ជៈលក់ដាច់បំផុតថ្ងៃនេះ' : 'Top Selling Drinks Today'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              {isKm ? 'របាយការណ៍' : 'Reports'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-5">
            {topSellingToday.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-sm font-medium text-stone-600 dark:text-[#94A39B]">
                  {isKm
                    ? 'មិនទាន់មានភេសជ្ជៈលក់បានថ្ងៃនេះទេ។'
                    : 'No drinks sold yet today.'}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('sales')}
                  className="h-10 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all duration-150 active:scale-[0.97]"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>{isKm ? 'កត់ត្រាការលក់ដំបូង' : 'Record First Sale'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {topSellingToday.map((item, idx) => {
                  const pct = Math.max(8, Math.round((item.netRevenueKhr / maxTopRevenue) * 100));
                  return (
                    <div key={item.productId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-mono-num text-xs font-semibold text-stone-400 dark:text-[#94A39B] w-5 shrink-0">
                            #{idx + 1}
                          </span>
                          <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                            {getLocalizedItemName(item.name, item.nameVi, isKm)}
                          </p>
                        </div>
                        <div className="flex items-baseline gap-2.5 shrink-0 font-mono-num">
                          <span className="text-xs text-stone-500 dark:text-[#94A39B]">
                            {item.netQty} {isKm ? 'កែវ' : 'sold'}
                          </span>
                          <span className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {formatKhr(item.netRevenueKhr)}
                          </span>
                        </div>
                      </div>
                      <div className="pl-7">
                        <div className="w-full h-1.5 rounded-full bg-stone-100 dark:bg-[#1F3028] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#0F5C43] dark:bg-[#10B981] transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Card B: Needs Restock (One-tap inline Restock without leaving Dashboard) */}
        <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  lowStockList.length > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-[#34D399]'
                }`}
              />
              <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                {isKm ? 'ត្រូវបញ្ចូលស្តុក' : 'Needs Restock'}
              </h2>
              {lowStockList.length > 0 && (
                <span className="font-mono-num text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200">
                  {lowStockList.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              {isKm ? 'មើលទាំងអស់' : 'View All'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-4 sm:p-5">
            {lowStockList.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 dark:bg-[#065F46] dark:text-[#D1FAE5]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-[#34D399]" />
                  {isKm ? 'ស្តុកទំនិញទាំងអស់គ្រប់គ្រាន់' : 'All Stock Levels Healthy'}
                </span>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {isKm
                    ? 'គ្មានវត្ថុធាតុដើម ឬទំនិញវេចខ្ចប់ស្រាប់ណាទាបជាងកម្រិតជូនដំណឹងទេ។'
                    : 'No Raw Ingredients or Retail Packaged items are below threshold.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {lowStockList.slice(0, 5).map((item) => {
                  const isOut = item.stockQty <= 0;
                  const barColor = isOut
                    ? 'bg-red-600 dark:bg-red-500'
                    : 'bg-amber-500 dark:bg-amber-400';

                  return (
                    <div
                      key={item.key}
                      className="p-4 rounded-xl border border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#0F1814] hover:border-stone-300 dark:hover:border-[#344B3F] transition-colors flex items-center justify-between gap-3.5"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                              isOut
                                ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-200 dark:border-red-500/40'
                                : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-500/40'
                            }`}
                          >
                            {isOut
                              ? isKm
                                ? 'អស់ពីស្តុក'
                                : 'Out of Stock'
                              : isKm
                                ? 'ស្តុកជិតអស់'
                                : 'Low Stock'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border whitespace-nowrap ${getStockClassificationBadgeClass(
                              item.classification
                            )}`}
                          >
                            {item.classification === 'ingredient' ? (
                              <Wheat className="w-3 h-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Package className="w-3 h-3 shrink-0" aria-hidden="true" />
                            )}
                            {getTierLabel(item.classification)}
                          </span>
                        </div>

                        <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                          {getLocalizedItemName(item.name, item.nameVi, isKm)}
                        </p>

                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2 font-mono-num text-xs">
                            <strong
                              className={
                                isOut
                                  ? 'text-red-700 dark:text-[#F87171]'
                                  : 'text-amber-700 dark:text-amber-300'
                              }
                            >
                              {formatQty(item.stockQty, item.unit)}
                            </strong>
                            <span className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                              {isKm ? 'អប្បបរមា' : 'min'}{' '}
                              {formatQty(item.reorderLevel, item.unit)}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-stone-100 dark:bg-[#1F3028] overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                              style={{ width: `${Math.max(item.progressPct, isOut ? 0 : 8)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openInlineRestock(item)}
                        className="h-10 px-3.5 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 shrink-0" />
                        <span>{isKm ? 'បញ្ចូលស្តុក' : 'Restock'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ================================================================== */}
      {/* INLINE QUICK RESTOCK MODAL (ACT WITHOUT LEAVING DASHBOARD)         */}
      {/* ================================================================== */}
      {restockTarget && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={() => !restockSubmitting && setRestockTarget(null)}
          >
            <div
              className="w-full max-w-md bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl overflow-hidden shadow-2xl animate-modal"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0F5C43] dark:text-[#34D399]">
                  {isKm ? 'បញ្ចូលស្តុករហ័ស' : 'Quick Restock'}
                </p>
                <h3 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {getLocalizedItemName(restockTarget.name, restockTarget.nameVi, isKm)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRestockTarget(null)}
                disabled={restockSubmitting}
                aria-label={t.common.close}
                className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitInlineRestock} className="p-5 space-y-4">
              <div className="px-3.5 py-2.5 rounded-xl bg-stone-50 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] flex items-center justify-between text-xs font-mono-num">
                <span className="text-stone-500 dark:text-[#94A39B]">
                  {isKm ? 'ស្តុកបច្ចុប្បន្ន / កម្រិតអប្បបរមា' : 'Current / Threshold'}
                </span>
                <span className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {formatQty(restockTarget.stockQty, restockTarget.unit)} /{' '}
                  {formatQty(restockTarget.reorderLevel, restockTarget.unit)}
                </span>
              </div>

              {restockError && (
                <div className="px-3.5 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-800 dark:text-red-200">
                  {restockError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {isKm ? `បរិមាណបន្ថែម (${restockTarget.unit})` : `Quantity to Add (${restockTarget.unit})`}
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={restockQty}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    setRestockQty(nextVal);
                    const n = Number(nextVal) || 0;
                    if (n > 0) {
                      setRestockTotalCost(String(Math.round(n * Math.max(0, restockTarget.unitCostKhr))));
                    }
                  }}
                  className="w-full h-11 px-3.5 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#0F1814] text-sm font-mono-num text-stone-900 dark:text-[#F1F5F3] focus:outline-none focus:ring-2 focus:ring-[#0F5C43] dark:focus:ring-[#10B981]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {isKm ? 'តម្លៃសរុប (KHR)' : 'Total Cost (KHR)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={restockTotalCost}
                    onChange={(e) => setRestockTotalCost(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#0F1814] text-sm font-mono-num text-stone-900 dark:text-[#F1F5F3] focus:outline-none focus:ring-2 focus:ring-[#0F5C43] dark:focus:ring-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                    {isKm ? 'ការទូទាត់' : 'Payment'}
                  </label>
                  <select
                    value={restockPayment}
                    onChange={(e) => setRestockPayment(e.target.value as PaymentMethod)}
                    className="w-full h-11 px-3 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#0F1814] text-sm text-stone-900 dark:text-[#F1F5F3] focus:outline-none focus:ring-2 focus:ring-[#0F5C43] dark:focus:ring-[#10B981]"
                  >
                    <option value="cash">{t.paymentMethods.cash}</option>
                    <option value="khqr">{t.paymentMethods.khqr}</option>
                    <option value="aba">{t.paymentMethods.aba}</option>
                    <option value="wing">{t.paymentMethods.wing}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {isKm ? 'អ្នកផ្គត់ផ្គង់ (ជម្រើស)' : 'Supplier (Optional)'}
                </label>
                <input
                  type="text"
                  value={restockSupplier}
                  onChange={(e) => setRestockSupplier(e.target.value)}
                  placeholder={isKm ? 'ឧ. ផ្សារអូរឫស្សី' : 'e.g. Local Market'}
                  className="w-full h-11 px-3.5 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#0F1814] text-sm text-stone-900 dark:text-[#F1F5F3] focus:outline-none focus:ring-2 focus:ring-[#0F5C43] dark:focus:ring-[#10B981]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                  {isKm ? 'កំណត់ចំណាំ (ជម្រើស)' : 'Note (Optional)'}
                </label>
                <input
                  type="text"
                  value={restockNote}
                  onChange={(e) => setRestockNote(e.target.value)}
                  placeholder={isKm ? 'កំណត់ចំណាំខ្លីៗ...' : 'Quick note...'}
                  className="w-full h-11 px-3.5 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#0F1814] text-sm text-stone-900 dark:text-[#F1F5F3] focus:outline-none focus:ring-2 focus:ring-[#0F5C43] dark:focus:ring-[#10B981]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRestockTarget(null)}
                  disabled={restockSubmitting}
                  className="h-11 px-4 rounded-lg border border-stone-300 dark:border-[#24352C] text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#1F3028] transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={restockSubmitting}
                  className="h-11 px-5 rounded-lg bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] text-sm font-semibold text-white inline-flex items-center gap-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-60"
                >
                  {restockSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{isKm ? 'បញ្ជាក់បញ្ចូលស្តុក' : 'Confirm Restock'}</span>
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
