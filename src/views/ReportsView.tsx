import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Banknote,
  Building2,
  Calendar,
  ChevronDown,
  CupSoda,
  Download,
  Layers,
  Package,
  QrCode,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Wallet,
  Wheat,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { ExpenseCategory, PaymentMethod } from '../types';
import {
  BUSINESS_TIMEZONE,
  daysAgoIso,
  downloadCsv,
  formatKhr,
  formatUsdRef,
  getPhnomPenhMonthBounds,
  todayIso,
} from '../utils/format';
import {
  computeFinancialReport,
  isLegacyInventoryPurchaseExpense,
  type ReportGrouping,
} from '../utils/inventoryEngine';
import {
  getCategoriesForScope,
  getCategoryById,
  getCategoryDisplayName,
  getCategoryDotClass,
  getProductTypeBadgeClass,
} from '../utils/categories';
import { useTheme } from '../hooks/useTheme';
import { useFilterVisibility } from '../hooks/useFilterVisibility';
import { CategoryFilterPills } from '../components/CategoryFilterPills';
import { InfoHint } from '../components/InfoHint';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

function getStartOfWeekIso(referenceIso: string): string {
  const [y, m, d] = referenceIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMonday = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - diffToMonday);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export const ReportsView: React.FC = () => {
  const { settings, sales, expenses, purchases, products, ingredients, categories, t } = useStore();
  const { isDark } = useTheme();
  const isKm = settings.language === 'km';
  const getLocalizedName = (name: string, nameVi?: string) =>
    isKm && nameVi && /[\u1780-\u17FF]/.test(nameVi) ? nameVi : name;
  const usdRate = settings.usdRate > 0 ? settings.usdRate : 4000;

  const reportCategories = useMemo(
    () => getCategoriesForScope(categories, 'product'),
    [categories]
  );

  const chartColors = useMemo(
    () => ({
      grid: isDark ? '#24352C' : '#E7E5E4',
      tick: isDark ? '#94A39B' : '#78716C',
      yLabel: isDark ? '#D5DFDA' : '#44403C',
      revenue: isDark ? '#10B981' : '#0F5C43',
      grossProfit: isDark ? '#6EE7B7' : '#34A87F',
      cost: isDark ? '#F59E0B' : '#D9822B',
      line: isDark ? '#F1F5F3' : '#1C1917',
      tooltipBg: isDark ? '#131D18' : '#FFFFFF',
      tooltipBorder: isDark ? '#24352C' : '#E7E5E4',
      tooltipText: isDark ? '#F1F5F3' : '#1C1917',
    }),
    [isDark]
  );

  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [grouping, setGrouping] = useState<ReportGrouping>('daily');
  const [chartView, setChartView] = useState<'pnl' | 'cashflow'>('pnl');
  const [customStart, setCustomStart] = useState(daysAgoIso(29));
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const { filtersOpen, toggleFilters } = useFilterVisibility();

  useEffect(() => {
    if (
      categoryFilter !== 'all' &&
      !reportCategories.some((c) => c.id === categoryFilter)
    ) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, reportCategories]);

  const activeFilterCount = categoryFilter !== 'all' ? 1 : 0;
  const activeCategoryName = useMemo(() => {
    if (categoryFilter === 'all') return null;
    return getCategoryDisplayName(getCategoryById(categoryFilter, categories), isKm);
  }, [categoryFilter, categories, isKm]);

  const dateRange = useMemo(() => {
    const today = todayIso();
    switch (preset) {
      case 'today':
        return { start: today, end: today };
      case 'week':
        return { start: getStartOfWeekIso(today), end: today };
      case 'month':
        return getPhnomPenhMonthBounds(0);
      case 'custom':
        return { start: customStart || '2000-01-01', end: customEnd || today };
    }
  }, [preset, customStart, customEnd]);

  const periodLabel = useMemo(() => {
    if (preset === 'today') return isKm ? 'ថ្ងៃនេះ' : 'Today';
    if (preset === 'week') return isKm ? 'សប្តាហ៍នេះ' : 'This Week';
    if (preset === 'month') return isKm ? 'ខែនេះ' : 'This Month';
    return `${dateRange.start} – ${dateRange.end}`;
  }, [preset, dateRange, isKm]);

  const handlePresetChange = (next: PeriodPreset) => {
    setPreset(next);
    if (grouping === 'yearly') {
      setGrouping('daily');
    }
  };

  const report = useMemo(
    () =>
      computeFinancialReport({
        sales,
        expenses,
        purchases,
        products,
        ingredients,
        categories,
        categoryFilterId: categoryFilter,
        dateStart: dateRange.start,
        dateEnd: dateRange.end,
        grouping,
      }),
    [sales, expenses, purchases, products, ingredients, categories, categoryFilter, dateRange, grouping]
  );

  // Payment Method Breakdown with transaction counts & exact reconciliation totals
  const paymentReconciliation = useMemo(() => {
    const methods: PaymentMethod[] = ['cash', 'khqr', 'aba', 'wing'];
    const txCounts = report.paymentOrderCountsByMethod;
    const cashOutByMethod: Record<PaymentMethod, number> = { cash: 0, khqr: 0, aba: 0, wing: 0 };

    for (const p of purchases) {
      if (p.purchaseDate < dateRange.start || p.purchaseDate > dateRange.end) continue;
      const pm = methods.includes(p.paymentMethod) ? p.paymentMethod : 'cash';
      cashOutByMethod[pm] += p.totalCostKhr;
    }

    for (const e of expenses) {
      if (e.expenseDate < dateRange.start || e.expenseDate > dateRange.end) continue;
      if (e.scope !== 'business') continue;
      const pm = methods.includes(e.paymentMethod) ? e.paymentMethod : 'cash';
      cashOutByMethod[pm] += e.amountKhr;
    }

    const totalInflows = Math.max(report.cashInflowsKhr, 0);
    const rows = methods.map((pm) => {
      const totalKhr = report.cashInflowsByMethod[pm] || 0;
      const sharePct = totalInflows > 0 ? Math.round((totalKhr / totalInflows) * 100) : 0;
      return {
        method: pm,
        txCount: txCounts[pm] || 0,
        totalKhr,
        outflowKhr: cashOutByMethod[pm],
        sharePct,
      };
    });

    const cashRow = rows.find((r) => r.method === 'cash')!;
    const digitalRows = rows.filter((r) => r.method !== 'cash');
    const digitalTotalKhr = digitalRows.reduce((sum, r) => sum + r.totalKhr, 0);
    const digitalTxCount = digitalRows.reduce((sum, r) => sum + r.txCount, 0);

    return {
      rows,
      cashInKhr: cashRow.totalKhr,
      cashOutKhr: cashRow.outflowKhr,
      cashNetDrawerKhr: cashRow.totalKhr - cashRow.outflowKhr,
      cashTxCount: cashRow.txCount,
      digitalTotalKhr,
      digitalTxCount,
      totalTxCount: cashRow.txCount + digitalTxCount,
    };
  }, [
    purchases,
    expenses,
    dateRange,
    report.cashInflowsByMethod,
    report.cashInflowsKhr,
    report.paymentOrderCountsByMethod,
  ]);

  // Plain-English Financial Takeaway Banner
  const financialTakeaway = useMemo(() => {
    const revKhr = formatKhr(report.netRevenueKhr);
    const revUsd = formatUsdRef(report.netRevenueKhr, usdRate);
    const cogsKhr = formatKhr(report.netCogsKhr);
    const gpKhr = formatKhr(report.grossProfitKhr);
    const gpUsd = formatUsdRef(report.grossProfitKhr, usdRate);
    const opExKhr = formatKhr(report.operatingExpensesKhr);
    const netKhr = formatKhr(report.netProfitKhr);
    const netUsd = formatUsdRef(report.netProfitKhr, usdRate);

    if (activeCategoryName) {
      if (isKm) {
        if (report.completedOrderCount === 0) {
          return {
            headline: `មិនមានការកុម្ម៉ង់សម្រាប់ប្រភេទ "${activeCategoryName}" ក្នុងអំឡុងពេល ${periodLabel} ទេ។`,
            detail: 'សូមជ្រើសរើសប្រភេទផ្សេង ឬចុច កំណត់ឡើងវិញ ដើម្បីមើលទិន្នន័យសរុបទាំងហាង។',
          };
        }
        return {
          headline: `ក្នុងអំឡុងពេល ${periodLabel} ប្រភេទ "${activeCategoryName}" រកបានចំណូលសុទ្ធ ${revKhr} (${revUsd}) ពី ${report.unitsSoldNet} មុខ (${report.completedOrderCount} វិក្កយបត្រ)។`,
          detail: `ថ្លៃដើមទំនិញលក់ (COGS) សរុប ${cogsKhr} ប្រាក់ចំណេញដុល ${gpKhr} (${gpUsd}, អត្រាចំណេញដុល ${report.grossMarginPct}%)។ ចំណាយប្រតិបត្តិការទូទាំងហាង (${opExKhr}) ត្រូវបានបង្ហាញដាច់ដោយឡែក។`,
        };
      }
      if (report.completedOrderCount === 0) {
        return {
          headline: `No completed orders found in "${activeCategoryName}" for ${periodLabel}.`,
          detail: 'Pick another category above or tap Reset to view shop-wide totals.',
        };
      }
      return {
        headline: `For ${periodLabel}, "${activeCategoryName}" earned ${revKhr} (${revUsd}) across ${report.unitsSoldNet} ${
          report.unitsSoldNet === 1 ? 'unit' : 'units'
        } (${report.completedOrderCount} ${report.completedOrderCount === 1 ? 'order' : 'orders'}).`,
        detail: `Ingredient & unit COGS totaled ${cogsKhr}, leaving ${gpKhr} (${gpUsd}, ${report.grossMarginPct}% gross margin). Shop-wide operating expenses (${opExKhr}) are shown separately.`,
      };
    }

    if (isKm) {
      if (report.completedOrderCount === 0 && report.operatingExpensesKhr === 0) {
        return {
          headline: `មិនទាន់មានទិន្នន័យលក់ ឬចំណាយប្រតិបត្តិការសម្រាប់ ${periodLabel} ទេ។`,
          detail: 'សូមជ្រើសរើសកាលបរិច្ឆេទផ្សេង ឬកត់ត្រាការលក់ថ្មីលើ POS ដើម្បីមើលរបាយការណ៍ចំណេញ-ខាត។',
        };
      }
      return {
        headline: `ក្នុងអំឡុងពេល ${periodLabel} ហាងរកបានចំណូលសុទ្ធ ${revKhr} (${revUsd}) ពី ${report.completedOrderCount} វិក្កយបត្រ។`,
        detail: `បន្ទាប់ពីដកថ្លៃដើមទំនិញលក់ ${cogsKhr} និងចំណាយប្រតិបត្តិការ ${opExKhr} ប្រាក់ចំណេញសុទ្ធគឺ ${netKhr} (${netUsd}, អត្រាចំណេញសុទ្ធ ${report.netMarginPct}%)។`,
      };
    }

    if (report.completedOrderCount === 0 && report.operatingExpensesKhr === 0) {
      return {
        headline: `No sales or operating expenses recorded for ${periodLabel}.`,
        detail: 'Switch periods above or log new POS sales to see your live revenue, COGS, and net income takeaway.',
      };
    }

    return {
      headline: `For ${periodLabel}, your shop earned ${revKhr} (${revUsd}) across ${report.completedOrderCount} ${
        report.completedOrderCount === 1 ? 'order' : 'orders'
      }.`,
      detail: `After ${cogsKhr} in ingredient & unit COGS and ${opExKhr} in operating expenses, net income is ${netKhr} (${netUsd}, ${report.netMarginPct}% net margin).`,
    };
  }, [
    activeCategoryName,
    report.netRevenueKhr,
    report.netCogsKhr,
    report.grossProfitKhr,
    report.grossMarginPct,
    report.operatingExpensesKhr,
    report.netProfitKhr,
    report.netMarginPct,
    report.completedOrderCount,
    report.unitsSoldNet,
    usdRate,
    periodLabel,
    isKm,
  ]);

  const operatingCategorySeries = useMemo(() => {
    const catMap = new Map<ExpenseCategory, number>();
    for (const e of expenses) {
      if (e.expenseDate < dateRange.start || e.expenseDate > dateRange.end) continue;
      if (e.scope !== 'business' || isLegacyInventoryPurchaseExpense(e)) continue;
      catMap.set(e.category, (catMap.get(e.category) || 0) + e.amountKhr);
    }
    return Array.from(catMap.entries())
      .map(([cat, amount]) => ({
        category: t.expenseCategories[cat],
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, dateRange, t]);

  const categoryChartSeries = useMemo(
    () =>
      report.categoryBreakdown.map((row) => ({
        categoryId: row.categoryId,
        name: getCategoryDisplayName(getCategoryById(row.categoryId, categories), isKm),
        netRevenueKhr: row.netRevenueKhr,
        grossProfitKhr: row.grossProfitKhr,
      })),
    [report.categoryBreakdown, categories, isKm]
  );

  const chartSeries = useMemo(
    () =>
      report.series.map((bucket) => ({
        ...bucket,
        label: grouping === 'daily' ? bucket.periodKey.slice(5) : bucket.periodKey,
        cashOutflowsKhr: bucket.inventoryPurchasesKhr + bucket.operatingExpensesKhr,
        totalPnlCostKhr: bucket.cogsKhr + bucket.operatingExpensesKhr,
      })),
    [report.series, grouping]
  );

  const handleExportCsv = () => {
    const inRange = (d: string) => d >= dateRange.start && d <= dateRange.end;
    const periodSales = sales.filter((s) => inRange(s.saleDate));
    const periodPurchases = purchases.filter((p) => inRange(p.purchaseDate));
    const periodExpenses = expenses.filter((e) => inRange(e.expenseDate));

    const rows: (string | number)[][] = [
      ['JuiceFlow Financial Report', settings.name],
      ['Period', `${dateRange.start} to ${dateRange.end}`],
      ['Category Filter', activeCategoryName || 'All Categories'],
      ['Grouping', grouping],
      ['Timezone', BUSINESS_TIMEZONE],
      ['Currency', 'KHR'],
      [],
      ['ACCRUAL PROFIT & LOSS STATEMENT (NO DOUBLE-COUNTING)', 'Amount (KHR)'],
      ['Gross Sales', report.grossSalesKhr],
      ['Returns & Refunds', -report.returnsRefundsKhr],
      ['Net Revenue', report.netRevenueKhr],
      ['Cost of Goods Sold (Net of Returns)', -report.netCogsKhr],
      ['Gross Profit', report.grossProfitKhr],
      ['Gross Margin %', `${report.grossMarginPct}%`],
      ['Operating Expenses (Excl. Inventory Purchases)', -report.operatingExpensesKhr],
      ['Net Income (Accrual)', report.netProfitKhr],
      ['Net Margin %', `${report.netMarginPct}%`],
      ['Voided Orders (Excluded)', report.voidedOrdersCount],
      [],
      [
        'REVENUE & GROSS PROFIT BY CATEGORY',
        'Units Sold',
        'Orders',
        'Net Revenue (KHR)',
        'COGS (KHR)',
        'Gross Profit (KHR)',
        'Gross Margin %',
      ],
      ...report.categoryBreakdown.map((cat) => [
        getCategoryDisplayName(getCategoryById(cat.categoryId, categories), isKm),
        cat.netQty,
        cat.orderCount,
        cat.netRevenueKhr,
        cat.netCogsKhr,
        cat.grossProfitKhr,
        `${cat.marginPct}%`,
      ]),
      [],
      ['CASH FLOW & PAYMENT RECONCILIATION', 'Amount (KHR)', 'Transactions'],
      ['Sales Cash Inflows (Net)', report.cashInflowsKhr, paymentReconciliation.totalTxCount],
      ['  Cash', report.cashInflowsByMethod.cash, paymentReconciliation.cashTxCount],
      [
        '  KHQR',
        report.cashInflowsByMethod.khqr,
        paymentReconciliation.rows.find((r) => r.method === 'khqr')?.txCount ?? 0,
      ],
      [
        '  ABA Pay',
        report.cashInflowsByMethod.aba,
        paymentReconciliation.rows.find((r) => r.method === 'aba')?.txCount ?? 0,
      ],
      [
        '  Wing',
        report.cashInflowsByMethod.wing,
        paymentReconciliation.rows.find((r) => r.method === 'wing')?.txCount ?? 0,
      ],
      ['Inventory Purchases Cash Outflow', -report.inventoryPurchasesCashOutKhr, ''],
      ['Operating Expenses Cash Outflow', -report.operatingExpensesCashOutKhr, ''],
      ['Business Net Cash Flow', report.businessNetCashFlowKhr, ''],
      ['Household / Personal Outflows (Tracked Separately)', -report.householdExpensesCashOutKhr, ''],
      [],
      ['CURRENT INVENTORY VALUATION (ASSET BALANCE)', 'Amount (KHR)'],
      ['Retail Packaged Valuation', report.inventoryValuation.packagedValueKhr],
      ['Raw Ingredients Valuation', report.inventoryValuation.ingredientsValueKhr],
      ['Total Inventory Valuation', report.inventoryValuation.totalInventoryValueKhr],
      [],
      [
        'SALES LEDGER',
        'Date',
        'Order #',
        'Status',
        'Payment',
        'Gross (KHR)',
        'Refunded (KHR)',
        'Net (KHR)',
        'Net COGS (KHR)',
      ],
      ...periodSales.map((s) => [
        'SALE',
        s.saleDate,
        s.orderNumber,
        s.status,
        s.paymentMethod,
        s.totalKhr,
        s.refundedKhr ?? 0,
        s.netTotalKhr ?? s.totalKhr,
        Math.max(0, s.cogsKhr - (s.refundedCogsKhr ?? 0)),
      ]),
      [],
      [
        'INVENTORY PURCHASES',
        'Date',
        'Item',
        'Classification',
        'Qty',
        'Unit',
        'Supplier',
        'Payment',
        'Total Cost (KHR)',
      ],
      ...periodPurchases.map((p) => [
        'PURCHASE',
        p.purchaseDate,
        p.itemName,
        p.itemClassification === 'ingredient' ? 'Raw Ingredients' : 'Retail Packaged',
        p.quantity,
        p.unit,
        p.supplier,
        p.paymentMethod,
        p.totalCostKhr,
      ]),
      [],
      ['EXPENSES', 'Date', 'Title', 'Scope', 'Category', 'Inventory Purchase?', 'Amount (KHR)'],
      ...periodExpenses.map((e) => [
        'EXPENSE',
        e.expenseDate,
        e.title,
        e.scope,
        e.category,
        isLegacyInventoryPurchaseExpense(e) ? 'YES (Cash Flow Only)' : 'NO (Operating)',
        e.amountKhr,
      ]),
    ];

    downloadCsv(`juiceflow-financials-${dateRange.start}-to-${dateRange.end}.csv`, rows);
  };

  const getPaymentMeta = (pm: PaymentMethod) => {
    if (pm === 'cash') {
      return {
        label: isKm ? 'សាច់ប្រាក់' : 'Cash',
        sub: isKm ? 'ថតដាក់ប្រាក់ផ្ទាល់' : 'Physical cash drawer',
        icon: Banknote,
        accent:
          'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-[#064E3B]/70 dark:text-[#6EE7B7] dark:border-[#10B981]/35',
        barColor: 'bg-[#0F5C43] dark:bg-[#10B981]',
      };
    }
    if (pm === 'khqr') {
      return {
        label: 'KHQR',
        sub: isKm ? 'ស្កេនកូដបាគង KHQR' : 'Bakong QR transfer',
        icon: QrCode,
        accent:
          'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-500/35',
        barColor: 'bg-sky-600 dark:bg-sky-400',
      };
    }
    if (pm === 'aba') {
      return {
        label: 'ABA Pay',
        sub: isKm ? 'ផ្ទេរប្រាក់ ABA' : 'ABA digital transfer',
        icon: Building2,
        accent:
          'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-500/35',
        barColor: 'bg-indigo-600 dark:bg-indigo-400',
      };
    }
    return {
      label: 'Wing',
      sub: isKm ? 'កាបូបលុយអេឡិចត្រូនិក Wing' : 'Wing mobile wallet',
      icon: Smartphone,
      accent:
        'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-500/35',
      barColor: 'bg-amber-500 dark:bg-amber-400',
    };
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {t.reports.title}
            </h1>
            <InfoHint
              text={
                isKm
                  ? `របាយការណ៍ចំណេញ-ខាត ការផ្ទៀងផ្ទាត់ការទូទាត់ និងការវាយតម្លៃស្តុក (${BUSINESS_TIMEZONE})។`
                  : `Plain-English P&L statements, payment reconciliation, and live inventory valuation (${BUSINESS_TIMEZONE}).`
              }
              label={t.reports.title}
              textClassName="text-sm"
            />
          </div>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {dateRange.start} – {dateRange.end}
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all active:scale-[0.97] whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>{t.reports.exportCsv}</span>
        </button>
      </div>

      {/* ================================================================== */}
      {/* 1. CLEAN PERIOD SELECTOR (TODAY / THIS WEEK / THIS MONTH / CUSTOM) */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="overflow-x-auto pb-0.5 -mx-1 px-1">
            <div
              role="tablist"
              aria-label={isKm ? 'ជ្រើសរើសរយៈពេលរបាយការណ៍' : 'Report period'}
              className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl"
            >
              {(
                [
                  ['today', isKm ? 'ថ្ងៃនេះ' : 'Today'],
                  ['week', isKm ? 'សប្តាហ៍នេះ' : 'This Week'],
                  ['month', isKm ? 'ខែនេះ' : 'This Month'],
                  ['custom', isKm ? 'កំណត់ផ្ទាល់ខ្លួន' : 'Custom Range'],
                ] as const
              ).map(([key, label]) => {
                const active = preset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handlePresetChange(key)}
                    className={`h-11 px-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    {key === 'custom' && <Calendar className="w-3.5 h-3.5 shrink-0" />}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto shrink-0">
            <span className="text-xs font-medium text-stone-500 dark:text-[#94A39B] whitespace-nowrap">
              {isKm ? 'បែងចែកតាម៖' : 'Group by:'}
            </span>
            <div className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl">
              {(
                [
                  ['daily', isKm ? 'ប្រចាំថ្ងៃ' : 'Daily'],
                  ['monthly', isKm ? 'ប្រចាំខែ' : 'Monthly'],
                  ['yearly', isKm ? 'ប្រចាំឆ្នាំ' : 'Yearly'],
                ] as const
              ).map(([grp, lbl]) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setGrouping(grp)}
                  className={`h-9 px-3 text-xs font-semibold rounded-lg transition-all duration-150 ease-out active:scale-[0.97] whitespace-nowrap ${
                    grouping === grp
                      ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleFilters}
              aria-expanded={filtersOpen}
              aria-controls="reports-category-filters"
              className={`inline-flex items-center gap-1.5 h-11 px-3.5 text-xs font-semibold rounded-[10px] transition-all active:scale-[0.97] whitespace-nowrap border ${
                filtersOpen || activeFilterCount > 0
                  ? 'bg-stone-100 dark:bg-[#18251F] border-transparent dark:border-[#24352C] text-stone-900 dark:text-[#F1F5F3] hover:bg-stone-200/70 dark:hover:bg-[#1F3028]'
                  : 'bg-transparent border-transparent text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#0D5C3E] dark:text-[#10B981] shrink-0" />
              <span>{isKm ? 'តម្រង' : 'Filters'}</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-mono-num font-semibold bg-[#0D5C3E]/12 text-[#0D5C3E] dark:bg-[#10B981]/20 dark:text-[#6EE7B7]">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-stone-400 dark:text-[#94A39B] transition-transform duration-200 motion-reduce:transition-none ${
                  filtersOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <button
              type="button"
              disabled={activeFilterCount === 0}
              onClick={() => setCategoryFilter('all')}
              className="inline-flex items-center justify-center h-11 px-3 text-xs font-semibold text-[#0D5C3E] dark:text-[#34D399] hover:underline disabled:text-stone-400 dark:disabled:text-[#94A39B]/40 disabled:no-underline disabled:cursor-default rounded-lg transition-colors active:scale-[0.97] whitespace-nowrap"
            >
              {isKm ? 'កំណត់ឡើងវិញ' : 'Reset'}
            </button>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2.5 text-xs pt-3 border-t border-stone-100 dark:border-[#1F3028] animate-drawer-in">
            <label
              htmlFor="report-from"
              className="font-medium text-stone-500 dark:text-[#94A39B]"
            >
              {t.reports.from}
            </label>
            <input
              id="report-from"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-11 px-3 font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
            />
            <label htmlFor="report-to" className="font-medium text-stone-500 dark:text-[#94A39B]">
              {t.reports.to}
            </label>
            <input
              id="report-to"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-11 px-3 font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
            />
          </div>
        )}

        {/* Collapsible Dynamic Category Filter Pills Drawer (matches SalesView) */}
        <div
          id="reports-category-filters"
          className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
            filtersOpen
              ? 'grid-rows-[1fr] opacity-100 pt-3 border-t border-stone-100 dark:border-[#24352C]'
              : '!mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden">
            <CategoryFilterPills
              categories={reportCategories}
              selectedCategoryId={categoryFilter}
              onSelect={setCategoryFilter}
              isKm={isKm}
              allLabel={t.common.all}
            />
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 2. PLAIN-ENGLISH FINANCIAL TAKEAWAY BANNER                         */}
      {/* ================================================================== */}
      <section
        aria-label={isKm ? 'សង្ខេបហិរញ្ញវត្ថុ' : 'Financial Takeaway'}
        className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl px-4 sm:px-5 py-4 flex items-start gap-3.5"
      >
        <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-[#064E3B]/70 border border-emerald-200/80 dark:border-[#10B981]/30 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#0F5C43] dark:text-[#34D399]">
            {isKm ? 'សង្ខេបហិរញ្ញវត្ថុ' : 'Financial Takeaway'}
          </p>
          <p className="text-sm sm:text-[15px] leading-relaxed text-stone-900 dark:text-[#F1F5F3] font-medium">
            {financialTakeaway.headline}{' '}
            <span className="text-stone-600 dark:text-[#94A39B] font-normal">
              {financialTakeaway.detail}
            </span>
          </p>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 3. 4-COLUMN EXECUTIVE KPI STRIP (WITH <InfoHint> TRIGGERS)         */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-stone-200 dark:divide-[#24352C]">
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isKm ? 'ចំណូលសុទ្ធ' : 'Net Revenue'}
            </p>
            <InfoHint
              compact
              text={
                isKm
                  ? 'ចំណូលដុលពីការលក់ដែលបានបញ្ចប់ ដកនឹងការសងប្រាក់វិញក្នុងរយៈពេលដែលបានជ្រើស។'
                  : 'Gross sales from completed orders minus returns and refunds in the selected period.'
              }
              label={isKm ? 'អំពីចំណូលសុទ្ធ' : 'About Net Revenue'}
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(report.netRevenueKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(report.netRevenueKhr, usdRate)} · {report.completedOrderCount}{' '}
            {t.dashboard.ordersCount}
          </p>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isKm ? 'ថ្លៃដើមទំនិញលក់ & អត្រាចំណេញដុល' : 'COGS & Gross Margin %'}
            </p>
            <InfoHint
              compact
              text={
                isKm
                  ? 'ថ្លៃដើមទំនិញលក់ (COGS) គឺជាថ្លៃវត្ថុធាតុដើម ឬថ្លៃដើមទំនិញពិតប្រាកដដែលបានលក់។ អត្រាចំណេញដុល = (ចំណូលសុទ្ធ − COGS) ÷ ចំណូលសុទ្ធ។'
                  : 'COGS is the exact ingredient and unit cost of items sold. Gross Margin % = (Net Revenue − COGS) ÷ Net Revenue.'
              }
              label={isKm ? 'អំពីថ្លៃដើមទំនិញលក់' : 'About COGS & Gross Margin %'}
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(report.netCogsKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {isKm ? 'អត្រាចំណេញដុល' : 'Gross Margin'}:{' '}
            <strong className="text-emerald-700 dark:text-[#34D399]">
              {report.grossMarginPct}%
            </strong>{' '}
            · {formatUsdRef(report.netCogsKhr, usdRate)}
          </p>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isKm ? 'ចំណាយប្រតិបត្តិការ' : 'Operating Expenses'}
            </p>
            <InfoHint
              compact
              text={
                isKm
                  ? 'ចំណាយប្រចាំថ្ងៃរបស់ហាង (ថ្លៃជួល ទឹកភ្លើង សម្ភារៈវេចខ្ចប់) — មិនរាប់បញ្ចូលការទិញស្តុកដើម្បីជៀសវាងការគិតជាន់គ្នាជាមួយ COGS។'
                  : 'Day-to-day shop overheads (rent, utilities, packaging, equipment) — excludes stock restocks so COGS is never double-counted.'
              }
              label={isKm ? 'អំពីចំណាយប្រតិបត្តិការ' : 'About Operating Expenses'}
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(report.operatingExpensesKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(report.operatingExpensesKhr, usdRate)}
            {activeCategoryName && (
              <span className="font-sans"> · {isKm ? 'ទូទាំងហាង' : 'shop-wide'}</span>
            )}
          </p>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isKm ? 'ប្រាក់ចំណេញសុទ្ធ' : 'Net Income'}
            </p>
            <InfoHint
              compact
              text={
                isKm
                  ? 'ប្រាក់ចំណេញសុទ្ធ = ចំណូលសុទ្ធ − ថ្លៃដើមទំនិញលក់ (COGS) − ចំណាយប្រតិបត្តិការ។ បង្ហាញពីប្រាក់ចំណេញពិតប្រាកដរបស់ហាង។'
                  : 'Net Income = Net Revenue − COGS − Operating Expenses. Shows your true shop profitability before personal drawings.'
              }
              label={isKm ? 'អំពីប្រាក់ចំណេញសុទ្ធ' : 'About Net Income'}
            />
          </div>
          <p
            className={`mt-1.5 font-mono-num text-2xl font-semibold ${
              report.netProfitKhr >= 0
                ? 'text-emerald-700 dark:text-[#34D399]'
                : 'text-red-700 dark:text-[#F87171]'
            }`}
          >
            {formatKhr(report.netProfitKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {t.reports.netMargin}: {report.netMarginPct}% · {formatUsdRef(report.netProfitKhr, usdRate)}
          </p>
        </div>
      </div>

      {/* ================================================================== */}
      {/* 4. DEDICATED PAYMENT METHOD BREAKDOWN (CASH vs DIGITAL RECONCILE)  */}
      {/* ================================================================== */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
            <h2 className="font-display text-base sm:text-lg font-bold text-stone-900 dark:text-[#F1F5F3]">
              {isKm ? 'ការបែងចែកតាមវិធីទូទាត់' : 'Payment Method Breakdown'}
            </h2>
            <InfoHint
              compact
              label={isKm ? 'អំពីការផ្ទៀងផ្ទាត់វិធីទូទាត់' : 'About Payment Method Breakdown'}
              text={
                isKm
                  ? 'ផ្ទៀងផ្ទាត់សាច់ប្រាក់ក្នុងថតជាមួយការផ្ទេរប្រាក់តាមធនាគារ (KHQR, ABA Pay, Wing) ព្រមទាំងចំនួនប្រតិបត្តិការជាក់លាក់។'
                  : 'Reconcile your physical cash drawer against digital bank transfers (KHQR, ABA Pay, Wing) with exact transaction counts and net totals.'
              }
            />
          </div>

          {/* Drawer vs Digital Summary Pill */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono-num">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-[#064E3B]/60 border border-emerald-200 dark:border-[#10B981]/35 text-emerald-900 dark:text-[#A7F3D0] font-semibold">
              <Banknote className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isKm ? 'សាច់ប្រាក់' : 'Cash Drawer'}: {formatKhr(paymentReconciliation.cashInKhr)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] text-stone-800 dark:text-[#D5DFDA] font-semibold">
              <Building2 className="w-3.5 h-3.5 shrink-0 text-stone-500 dark:text-[#94A39B]" />
              <span>
                {isKm ? 'ផ្ទេរតាមធនាគារ' : 'Digital Bank'}:{' '}
                {formatKhr(paymentReconciliation.digitalTotalKhr)} (
                {paymentReconciliation.digitalTxCount}{' '}
                {isKm ? 'ដង' : 'tx'})
              </span>
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {paymentReconciliation.rows.map((row) => {
              const meta = getPaymentMeta(row.method);
              const Icon = meta.icon;
              return (
                <div
                  key={row.method}
                  className="p-4 rounded-xl border border-stone-200 dark:border-[#24352C] bg-stone-50/50 dark:bg-[#0F1814] flex flex-col justify-between gap-3 pos-lift"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-9 h-9 rounded-lg border inline-flex items-center justify-center shrink-0 ${meta.accent}`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                          {meta.label}
                        </p>
                        <p className="text-[11px] text-stone-500 dark:text-[#94A39B] truncate">
                          {meta.sub}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono-num text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA] whitespace-nowrap">
                      {row.txCount} {isKm ? 'ដង' : 'tx'}
                    </span>
                  </div>

                  <div>
                    <p className="font-mono-num text-xl font-bold text-stone-900 dark:text-[#F1F5F3]">
                      {formatKhr(row.totalKhr)}
                    </p>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] font-mono-num text-stone-500 dark:text-[#94A39B]">
                      <span>{formatUsdRef(row.totalKhr, usdRate)}</span>
                      <span>{row.sharePct}%</span>
                    </div>
                    <div className="mt-2 w-full h-1.5 rounded-full bg-stone-200/70 dark:bg-[#1F3028] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${meta.barColor}`}
                        style={{ width: `${row.totalKhr > 0 ? Math.max(row.sharePct, 4) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Physical Cash Drawer Check Bar */}
          <div className="px-4 py-3 rounded-xl bg-stone-50 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num">
            <span className="font-sans font-medium text-stone-600 dark:text-[#94A39B]">
              {isKm
                ? 'ផ្ទៀងផ្ទាត់ថតសាច់ប្រាក់ (លក់ជាសាច់ប្រាក់ − ចំណាយជាសាច់ប្រាក់)៖'
                : 'Cash Drawer Check (Cash Sales − Cash Paid Out):'}
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-emerald-700 dark:text-[#34D399]">
                +{formatKhr(paymentReconciliation.cashInKhr)}
              </span>
              <span className="text-stone-400">−</span>
              <span className="text-stone-700 dark:text-[#D5DFDA]">
                {formatKhr(paymentReconciliation.cashOutKhr)}
              </span>
              <span className="text-stone-400">=</span>
              <strong
                className={
                  paymentReconciliation.cashNetDrawerKhr >= 0
                    ? 'text-stone-900 dark:text-[#F1F5F3]'
                    : 'text-amber-700 dark:text-amber-300'
                }
              >
                {formatKhr(paymentReconciliation.cashNetDrawerKhr)} (
                {formatUsdRef(paymentReconciliation.cashNetDrawerKhr, usdRate)})
              </strong>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 5. ACCRUAL P&L STATEMENT + CASH FLOW STATEMENT SIDE-BY-SIDE        */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Accrual P&L Ledger */}
        <div className="lg:col-span-6 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-stone-200 dark:border-[#24352C]">
              <div className="flex flex-wrap items-center gap-x-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {isKm ? '១. របាយការណ៍ចំណេញ និងខាត (P&L)' : '1. Profit & Loss Statement'}
                </h2>
                <InfoHint
                  text={
                    isKm
                      ? 'ផ្ទៀងផ្ទាត់ថ្លៃដើមទំនិញលក់ (COGS) ជាមួយចំណាយប្រតិបត្តិការ — គ្មានការគិតជាន់គ្នានៃការទិញស្តុកឡើយ។'
                      : 'Matches COGS of sold items against operating expenses — zero double-counting of stock purchases.'
                  }
                  label={isKm ? 'អំពីរបាយការណ៍ចំណេញ-ខាត' : 'About Profit & Loss Statement'}
                />
              </div>
            </div>

            <dl className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm mt-2">
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 dark:text-[#D5DFDA] font-medium">
                  {t.reports.grossRevenue}
                </dt>
                <dd className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  {formatKhr(report.grossSalesKhr)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 dark:text-[#94A39B] pl-3">
                  {isKm ? 'ដក៖ ការបង្វិលសង និងសងប្រាក់វិញ' : 'Less: Returns & Refunds'}
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.returnsRefundsKhr)}
                </dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-800 dark:text-[#F1F5F3] font-semibold">
                  {isKm ? 'ចំណូលសុទ្ធ' : 'Net Revenue'}
                </dt>
                <dd className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  {formatKhr(report.netRevenueKhr)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between items-start gap-4 text-xs">
                <dt className="text-stone-500 dark:text-[#94A39B] pl-3 flex flex-wrap items-center gap-x-1 min-w-0">
                  <span>{isKm ? 'ដក៖ ថ្លៃដើមទំនិញលក់ (COGS)' : 'Less: COGS'}</span>
                  <InfoHint
                    compact
                    text={
                      isKm
                        ? 'ថ្លៃដើមទំនិញលក់ — ថ្លៃវត្ថុធាតុដើមតាមរូបមន្ត ឬថ្លៃដើមមធ្យមនៃទំនិញដែលបានលក់ក្នុងរយៈពេលនេះ ដកថ្លៃដើមនៃទំនិញដែលបានបង្វិលសង។'
                        : 'Cost of Goods Sold — actual recipe ingredient cost or weighted-average unit cost for items sold in this period, minus COGS restored from returns.'
                    }
                    label={isKm ? 'អំពីថ្លៃដើមទំនិញលក់' : 'About COGS'}
                  />
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.netCogsKhr)}
                </dd>
              </div>
              <div className="py-3 flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <dt className="text-stone-800 dark:text-[#F1F5F3] font-medium flex flex-wrap items-center gap-x-1">
                    <span>{t.reports.grossProfit}</span>
                    <InfoHint
                      compact
                      text={
                        isKm
                          ? 'ប្រាក់ចំណេញដុល = ចំណូលសុទ្ធ − COGS។ អត្រាចំណេញដុល % = ប្រាក់ចំណេញដុល ÷ ចំណូលសុទ្ធ។'
                          : 'Gross Profit = Net Revenue − COGS. Gross Margin % = Gross Profit ÷ Net Revenue.'
                      }
                      label={isKm ? 'អំពីអត្រាចំណេញដុល' : 'About Gross Margin %'}
                    />
                  </dt>
                  <span className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B]">
                    {isKm ? 'អត្រាចំណេញដុល %' : 'Gross Margin %'}: {report.grossMarginPct}%
                  </span>
                </div>
                <dd className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399] whitespace-nowrap">
                  {formatKhr(report.grossProfitKhr)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between items-start gap-4 text-xs">
                <dt className="text-stone-500 dark:text-[#94A39B] pl-3 flex flex-wrap items-center gap-x-1 min-w-0">
                  <span>{isKm ? 'ដក៖ ចំណាយប្រតិបត្តិការ' : 'Less: Operating Expenses'}</span>
                  <InfoHint
                    compact
                    text={
                      isKm
                        ? 'ចំណាយប្រតិបត្តិការហាង (ថ្លៃជួល ទឹកភ្លើង សម្ភារៈវេចខ្ចប់) — មិនរាប់បញ្ចូលការទិញស្តុកដើម្បីជៀសវាងការគិតជាន់គ្នាជាមួយ COGS។'
                        : 'Business overheads (rent, utilities, packaging, equipment) — excludes inventory purchases so stock is never double-counted with COGS.'
                    }
                    label={isKm ? 'អំពីចំណាយប្រតិបត្តិការ' : 'About Operating Expenses'}
                  />
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.operatingExpensesKhr)}
                </dd>
              </div>
              <div className="py-4 flex justify-between items-baseline gap-4 border-t-2 border-stone-200 dark:border-[#24352C]">
                <div className="min-w-0">
                  <dt className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] flex flex-wrap items-center gap-x-1">
                    <span>{isKm ? 'ប្រាក់ចំណេញសុទ្ធ' : 'Net Income'}</span>
                    <InfoHint
                      compact
                      text={
                        isKm
                          ? 'ប្រាក់ចំណេញសុទ្ធ = ប្រាក់ចំណេញដុល − ចំណាយប្រតិបត្តិការ (ចំណាយគ្រួសារត្រូវបានតាមដានដាច់ដោយឡែក)។'
                          : 'Net Income = Gross Profit − Operating Expenses (household/personal spending is tracked separately).'
                      }
                      label={isKm ? 'អំពីប្រាក់ចំណេញសុទ្ធ' : 'About Net Income'}
                    />
                  </dt>
                  <span className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                    {t.reports.netMargin}: {report.netMarginPct}%
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <dd
                    className={`font-mono-num text-xl font-bold whitespace-nowrap ${
                      report.netProfitKhr >= 0
                        ? 'text-emerald-700 dark:text-[#34D399]'
                        : 'text-red-700 dark:text-[#F87171]'
                    }`}
                  >
                    {formatKhr(report.netProfitKhr)}
                  </dd>
                  <span className="text-xs font-mono-num text-stone-400 dark:text-[#94A39B]">
                    {formatUsdRef(report.netProfitKhr, usdRate)}
                  </span>
                </div>
              </div>
            </dl>
          </div>

          {report.voidedOrdersCount > 0 && (
            <p className="mt-3 pt-3 border-t border-stone-100 dark:border-[#1F3028] text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              {isKm
                ? `មិនរាប់បញ្ចូលវិក្កយបត្រដែលបានលុបចោល ${report.voidedOrdersCount} (${formatKhr(report.voidedTotalKhr)})។`
                : `Excluded ${report.voidedOrdersCount} voided order(s) totaling ${formatKhr(report.voidedTotalKhr)}.`}
            </p>
          )}
        </div>

        {/* Cash Flow Statement */}
        <div className="lg:col-span-6 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-stone-200 dark:border-[#24352C]">
              <div className="flex flex-wrap items-center gap-x-1">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {isKm ? '២. របាយការណ៍លំហូរសាច់ប្រាក់' : '2. Cash Flow Statement'}
                </h2>
                <InfoHint
                  text={
                    isKm
                      ? 'តាមដានសាច់ប្រាក់ដែលទទួលបានពិតប្រាកដពីការលក់ ដកនឹងប្រាក់ដែលបានចំណាយលើការបញ្ចូលស្តុក និងចំណាយប្រតិបត្តិការ។'
                      : 'Tracks actual cash collected from sales minus cash paid for stock restocks and operating expenses.'
                  }
                  label={isKm ? 'អំពីរបាយការណ៍លំហូរសាច់ប្រាក់' : 'About Cash Flow Statement'}
                />
              </div>
            </div>

            <dl className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm mt-2">
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-800 dark:text-[#F1F5F3] font-medium">
                  {isKm ? 'សាច់ប្រាក់ចូលពីការលក់ (សុទ្ធ)' : 'Sales Cash Inflows (Net)'}
                </dt>
                <dd className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399] whitespace-nowrap">
                  +{formatKhr(report.cashInflowsKhr)}
                </dd>
              </div>

              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 dark:text-[#D5DFDA]">
                  {isKm ? 'ការចំណាយលើការទិញស្តុក' : 'Inventory Purchases Paid'}
                </dt>
                <dd className="font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  -{formatKhr(report.inventoryPurchasesCashOutKhr)}
                </dd>
              </div>

              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 dark:text-[#D5DFDA]">
                  {isKm ? 'ចំណាយប្រតិបត្តិការដែលបានបង់' : 'Operating Expenses Paid'}
                </dt>
                <dd className="font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  -{formatKhr(report.operatingExpensesCashOutKhr)}
                </dd>
              </div>

              <div className="py-4 flex justify-between items-baseline gap-4 border-t-2 border-stone-200 dark:border-[#24352C]">
                <div className="min-w-0">
                  <dt className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3] flex flex-wrap items-center gap-x-1">
                    <span>{isKm ? 'លំហូរសាច់ប្រាក់សុទ្ធអាជីវកម្ម' : 'Business Net Cash Flow'}</span>
                    <InfoHint
                      compact
                      text={
                        isKm
                          ? 'សាច់ប្រាក់ចូលពីការលក់ − ការទិញស្តុក − ចំណាយប្រតិបត្តិការ'
                          : 'Sales Cash Inflows − Stock Purchases Paid − Operating Expenses Paid'
                      }
                      label={isKm ? 'រូបមន្តលំហូរសាច់ប្រាក់សុទ្ធ' : 'Net Cash Flow formula'}
                    />
                  </dt>
                </div>
                <div className="text-right shrink-0">
                  <dd
                    className={`font-mono-num text-xl font-bold whitespace-nowrap ${
                      report.businessNetCashFlowKhr >= 0
                        ? 'text-emerald-700 dark:text-[#34D399]'
                        : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {formatKhr(report.businessNetCashFlowKhr)}
                  </dd>
                  <span className="text-xs font-mono-num text-stone-400 dark:text-[#94A39B]">
                    {formatUsdRef(report.businessNetCashFlowKhr, usdRate)}
                  </span>
                </div>
              </div>
            </dl>
          </div>

          <div className="mt-4 pt-3 border-t border-stone-200 dark:border-[#24352C] flex items-center justify-between text-xs">
            <span className="text-amber-800 dark:text-amber-300 font-medium">
              {t.reports.householdSummary}
            </span>
            <span className="font-mono-num font-semibold text-amber-800 dark:text-amber-300">
              {formatKhr(report.householdExpensesCashOutKhr)}
            </span>
          </div>
        </div>
      </div>

      {/* Section 3: Inventory Valuation */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-4 border-b border-stone-200 dark:border-[#24352C]">
          <div className="flex flex-wrap items-center gap-x-1 min-w-0">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {isKm ? '៣. ការវាយតម្លៃស្តុកបច្ចុប្បន្ន' : '3. Current Inventory Valuation'}
            </h2>
            <InfoHint
              text={
                isKm
                  ? 'ស្តុកដើមគ្រា និងទំនិញមិនទាន់លក់ត្រូវបានវាយតម្លៃជាទ្រព្យសម្បត្តិនៅទីនេះ — មិនរាប់បញ្ចូលជាចំណាយប្រតិបត្តិការទេ។'
                  : 'Opening stock balances and unsold inventory are valued here as assets — never counted as operating expenses.'
              }
              label={isKm ? 'អំពីការវាយតម្លៃស្តុក' : 'About Inventory Valuation'}
            />
          </div>
          <span className="font-mono-num text-base font-bold text-[#0F5C43] dark:text-[#34D399] whitespace-nowrap shrink-0">
            {formatKhr(report.inventoryValuation.totalInventoryValueKhr)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="bg-stone-50/40 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-400">
              <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{isKm ? 'ទំនិញវេចខ្ចប់ស្រាប់' : 'Retail Packaged'}</span>
            </p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(report.inventoryValuation.packagedValueKhr)}
            </p>
            <p className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B] mt-0.5">
              {formatUsdRef(report.inventoryValuation.packagedValueKhr, usdRate)}
            </p>
          </div>

          <div className="bg-stone-50/40 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400">
              <Wheat className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{isKm ? 'វត្ថុធាតុដើម' : 'Raw Ingredients'}</span>
            </p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(report.inventoryValuation.ingredientsValueKhr)}
            </p>
            <p className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B] mt-0.5">
              {formatUsdRef(report.inventoryValuation.ingredientsValueKhr, usdRate)}
            </p>
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {chartView === 'pnl'
                ? isKm
                  ? 'និន្នាការចំណូល ថ្លៃដើម និងប្រាក់ចំណេញសុទ្ធ'
                  : 'Revenue, Costs & Net Income Trend'
                : isKm
                  ? 'និន្នាការសាច់ប្រាក់ចូល និងចេញ'
                  : 'Cash Inflows vs Cash Outflows Trend'}
            </h2>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setChartView('pnl')}
              className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-all active:scale-[0.97] ${
                chartView === 'pnl'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              {isKm ? 'ចំណេញ / ខាត (P&L)' : 'Accrual P&L'}
            </button>
            <button
              type="button"
              onClick={() => setChartView('cashflow')}
              className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-all active:scale-[0.97] ${
                chartView === 'cashflow'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              {isKm ? 'លំហូរសាច់ប្រាក់' : 'Cash Flow'}
            </button>
          </div>
        </div>

        {chartSeries.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500 dark:text-[#94A39B]">
            {t.common.noResults}
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chartColors.tick }}
                  axisLine={{ stroke: chartColors.grid }}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartColors.tick }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  formatter={(val) => formatKhr(Number(val ?? 0))}
                  contentStyle={{
                    borderRadius: '10px',
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    backgroundColor: chartColors.tooltipBg,
                    color: chartColors.tooltipText,
                    boxShadow: 'none',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: chartColors.tooltipText, fontWeight: 600 }}
                  itemStyle={{ color: chartColors.tooltipText }}
                />
                <Bar
                  dataKey="netRevenueKhr"
                  name={isKm ? 'ចំណូលសុទ្ធ' : 'Net Revenue'}
                  fill={chartColors.revenue}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey={chartView === 'pnl' ? 'totalPnlCostKhr' : 'cashOutflowsKhr'}
                  name={
                    chartView === 'pnl'
                      ? isKm
                        ? 'COGS + ចំណាយប្រតិបត្តិការ'
                        : 'COGS + Operating Expenses'
                      : isKm
                        ? 'ទិញស្តុក + ចំណាយប្រតិបត្តិការ'
                        : 'Stock Purchases + OpEx'
                  }
                  fill={chartColors.cost}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  type="monotone"
                  dataKey={chartView === 'pnl' ? 'netProfitKhr' : 'businessNetCashFlowKhr'}
                  name={
                    chartView === 'pnl'
                      ? isKm
                        ? 'ប្រាក់ចំណេញសុទ្ធ'
                        : 'Net Income'
                      : isKm
                        ? 'លំហូរសាច់ប្រាក់សុទ្ធ'
                        : 'Net Cash Flow'
                  }
                  stroke={chartColors.line}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Revenue & Gross Profit by Category Breakdown */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
            <h2 className="font-display text-base sm:text-lg font-bold text-stone-900 dark:text-[#F1F5F3]">
              {isKm
                ? 'ចំណូល និងប្រាក់ចំណេញដុលតាមប្រភេទ'
                : 'Revenue & Gross Profit by Category'}
            </h2>
            <InfoHint
              compact
              label={isKm ? 'អំពីការបែងចែកតាមប្រភេទ' : 'About Category Breakdown'}
              text={
                isKm
                  ? 'ប្រៀបធៀបចំណូលសុទ្ធ ថ្លៃដើមទំនិញលក់ និងអត្រាចំណេញដុលតាមប្រភេទផលិតផល។ ចុចលើជួរណាមួយដើម្បីច្រោះរបាយការណ៍ទាំងមូល។'
                  : 'Compare net revenue, COGS, and gross margin across product categories. Tap any category row to filter the entire report.'
              }
            />
          </div>

          {activeCategoryName && (
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-semibold bg-emerald-50 text-[#0D5C3E] border border-[#0D5C3E]/30 hover:bg-emerald-100 dark:bg-[#064E3B] dark:text-[#6EE7B7] dark:border-[#10B981]/40 transition-all active:scale-[0.97]"
            >
              <span>
                {isKm ? `កំពុងច្រោះ៖ ${activeCategoryName}` : `Filtered: ${activeCategoryName}`}
              </span>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>

        {report.categoryBreakdown.length === 0 ? (
          <p className="p-8 text-center text-sm text-stone-500 dark:text-[#94A39B]">
            {t.common.noResults}
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-stone-200 dark:divide-[#24352C]">
            {/* Horizontal Bar Chart comparing Net Revenue & Gross Profit */}
            <div className="xl:col-span-5 p-5 flex flex-col justify-center">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categoryChartSeries}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={chartColors.grid}
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: chartColors.tick }}
                      tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 12, fill: chartColors.yLabel }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val) => formatKhr(Number(val ?? 0))}
                      contentStyle={{
                        borderRadius: '10px',
                        border: `1px solid ${chartColors.tooltipBorder}`,
                        backgroundColor: chartColors.tooltipBg,
                        color: chartColors.tooltipText,
                        boxShadow: 'none',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: chartColors.tooltipText, fontWeight: 600 }}
                      itemStyle={{ color: chartColors.tooltipText }}
                    />
                    <Bar
                      dataKey="netRevenueKhr"
                      name={isKm ? 'ចំណូលសុទ្ធ' : 'Net Revenue'}
                      fill={chartColors.revenue}
                      radius={[0, 4, 4, 0]}
                      maxBarSize={14}
                    />
                    <Bar
                      dataKey="grossProfitKhr"
                      name={isKm ? 'ប្រាក់ចំណេញដុល' : 'Gross Profit'}
                      fill={chartColors.grossProfit}
                      radius={[0, 4, 4, 0]}
                      maxBarSize={14}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-stone-500 dark:text-[#94A39B]">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs"
                    style={{ backgroundColor: chartColors.revenue }}
                  />
                  {isKm ? 'ចំណូលសុទ្ធ' : 'Net Revenue'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs"
                    style={{ backgroundColor: chartColors.grossProfit }}
                  />
                  {isKm ? 'ប្រាក់ចំណេញដុល' : 'Gross Profit'}
                </span>
              </div>
            </div>

            {/* Interactive Category Breakdown Table */}
            <div className="xl:col-span-7 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-5 font-medium">{isKm ? 'ប្រភេទ' : 'Category'}</th>
                    <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                      {t.reports.unitsSold}
                    </th>
                    <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                      {isKm ? 'វិក្កយបត្រ' : 'Orders'}
                    </th>
                    <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                      {t.reports.revenue}
                    </th>
                    <th className="py-3 px-3 font-medium text-right whitespace-nowrap">
                      {isKm ? 'ថ្លៃដើម' : 'COGS'}
                    </th>
                    <th className="py-3 px-5 font-medium text-right whitespace-nowrap">
                      {isKm ? 'ចំណេញដុល' : 'Gross Profit'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {report.categoryBreakdown.map((row) => {
                    const isActiveRow = categoryFilter === row.categoryId;
                    const label = getCategoryDisplayName(
                      getCategoryById(row.categoryId, categories),
                      isKm
                    );
                    return (
                      <tr
                        key={row.categoryId}
                        onClick={() =>
                          setCategoryFilter((prev) =>
                            prev === row.categoryId ? 'all' : row.categoryId
                          )
                        }
                        className={`cursor-pointer transition-colors ${
                          isActiveRow
                            ? 'bg-emerald-50/80 dark:bg-[#064E3B]/45'
                            : 'hover:bg-stone-50/70 dark:hover:bg-[#18251F]/70'
                        }`}
                      >
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${getCategoryDotClass(
                                getCategoryById(row.categoryId, categories)
                              )}`}
                              aria-hidden="true"
                            />
                            <span
                              className={`font-semibold ${
                                isActiveRow
                                  ? 'text-[#0D5C3E] dark:text-[#34D399]'
                                  : 'text-stone-900 dark:text-[#F1F5F3]'
                              }`}
                            >
                              {label}
                            </span>
                            {isActiveRow && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#0D5C3E] text-white dark:bg-[#10B981] dark:text-[#042419]">
                                {isKm ? 'កំពុងច្រោះ' : 'Active'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-stone-700 dark:text-[#D5DFDA]">
                          {row.netQty}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-stone-500 dark:text-[#94A39B]">
                          {row.orderCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3]">
                          {formatKhr(row.netRevenueKhr)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                          {formatKhr(row.netCogsKhr)}
                        </td>
                        <td className="py-3 px-5 text-right font-mono-num">
                          <span className="font-semibold text-emerald-700 dark:text-[#34D399] block">
                            {formatKhr(row.grossProfitKhr)}
                          </span>
                          <span className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                            {row.marginPct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Product Profitability + Operating Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.reports.productPerformance}
            </h2>
            {activeCategoryName && (
              <span className="text-xs font-medium text-[#0D5C3E] dark:text-[#34D399]">
                {activeCategoryName}
              </span>
            )}
          </div>
          {report.productProfitability.length === 0 ? (
            <p className="p-8 text-center text-sm text-stone-500 dark:text-[#94A39B]">
              {t.common.noResults}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-3 px-6 font-medium">{t.nav.products}</th>
                    <th className="py-3 px-3 font-medium text-right">{t.reports.unitsSold}</th>
                    <th className="py-3 px-3 font-medium text-right">{t.reports.revenue}</th>
                    <th className="py-3 px-3 font-medium text-right">
                      {isKm ? 'ថ្លៃដើម' : 'COGS'}
                    </th>
                    <th className="py-3 px-6 font-medium text-right">{t.reports.profit}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {report.productProfitability.map((row) => (
                    <tr
                      key={row.productId}
                      className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                    >
                      <td className="py-3 px-6">
                        <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                          {getLocalizedName(row.name, row.nameVi)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500 dark:text-[#94A39B]">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border whitespace-nowrap ${getProductTypeBadgeClass(
                              row.productType
                            )}`}
                          >
                            {row.productType === 'PREPARED_TO_ORDER' ? (
                              <CupSoda className="w-3 h-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Package className="w-3 h-3 shrink-0" aria-hidden="true" />
                            )}
                            {t.productTypes[row.productType]}
                          </span>
                          {(() => {
                            const catItem = getCategoryById(row.categoryId, categories);
                            return (
                              <span className="truncate">
                                · {getCategoryDisplayName(catItem, isKm)}
                              </span>
                            );
                          })()}
                          {row.returnedQty > 0 && (
                            <span>
                              · {row.returnedQty} {isKm ? 'បានបង្វិលសង' : 'returned'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-stone-700 dark:text-[#D5DFDA]">
                        {row.netQty}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3]">
                        {formatKhr(row.netRevenueKhr)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-xs text-stone-500 dark:text-[#94A39B]">
                        {formatKhr(row.netCogsKhr)}
                      </td>
                      <td className="py-3 px-6 text-right font-mono-num">
                        <span className="font-semibold text-emerald-700 dark:text-[#34D399] block">
                          {formatKhr(row.grossProfitKhr)}
                        </span>
                        <span className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                          {row.marginPct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-x-1">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {isKm ? 'ការបែងចែកចំណាយប្រតិបត្តិការ' : 'Operating Expense Breakdown'}
            </h2>
            <InfoHint
              text={
                isKm
                  ? 'មិនរាប់បញ្ចូលការទិញស្តុក (ត្រូវបានតាមដានក្នុងលំហូរសាច់ប្រាក់)'
                  : 'Excludes inventory purchases (tracked in Cash Flow)'
              }
              label={
                isKm ? 'អំពីការបែងចែកចំណាយប្រតិបត្តិការ' : 'About Operating Expense Breakdown'
              }
            />
          </div>
          {operatingCategorySeries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-stone-500 dark:text-[#94A39B] py-8">
              {t.common.noResults}
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={operatingCategorySeries}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: chartColors.tick }}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={110}
                    tick={{ fontSize: 12, fill: chartColors.yLabel }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val) => formatKhr(Number(val ?? 0))}
                    contentStyle={{
                      borderRadius: '10px',
                      border: `1px solid ${chartColors.tooltipBorder}`,
                      backgroundColor: chartColors.tooltipBg,
                      color: chartColors.tooltipText,
                      boxShadow: 'none',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: chartColors.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: chartColors.tooltipText }}
                  />
                  <Bar
                    dataKey="amount"
                    fill={chartColors.cost}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
