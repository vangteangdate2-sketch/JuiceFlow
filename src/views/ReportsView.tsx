import React, { useMemo, useState } from 'react';
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
import { Download } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { ExpenseCategory, PaymentMethod } from '../types';
import {
  BUSINESS_TIMEZONE,
  daysAgoIso,
  downloadCsv,
  formatKhr,
  formatUsdRef,
  getPhnomPenhMonthBounds,
  getPhnomPenhYearBounds,
  todayIso,
} from '../utils/format';
import {
  computeFinancialReport,
  isLegacyInventoryPurchaseExpense,
  type ReportGrouping,
} from '../utils/inventoryEngine';
import { useTheme } from '../hooks/useTheme';

type PeriodPreset = 'today' | '7d' | 'month' | 'lastMonth' | 'year' | 'all' | 'custom';

export const ReportsView: React.FC = () => {
  const { settings, sales, expenses, purchases, products, ingredients, t } = useStore();
  const { isDark } = useTheme();
  const isVi = settings.language === 'vi';

  const chartColors = useMemo(
    () => ({
      grid: isDark ? '#24352C' : '#E7E5E4',
      tick: isDark ? '#94A39B' : '#78716C',
      yLabel: isDark ? '#D5DFDA' : '#44403C',
      revenue: isDark ? '#10B981' : '#0F5C43',
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

  const dateRange = useMemo(() => {
    const today = todayIso();
    switch (preset) {
      case 'today':
        return { start: today, end: today };
      case '7d':
        return { start: daysAgoIso(6), end: today };
      case 'month':
        return getPhnomPenhMonthBounds(0);
      case 'lastMonth':
        return getPhnomPenhMonthBounds(-1);
      case 'year':
        return getPhnomPenhYearBounds(0);
      case 'all':
        return { start: '2000-01-01', end: '2099-12-31' };
      case 'custom':
        return { start: customStart || '2000-01-01', end: customEnd || today };
    }
  }, [preset, customStart, customEnd]);

  const handlePresetChange = (next: PeriodPreset) => {
    setPreset(next);
    if (next === 'year') {
      setGrouping('monthly');
    } else if (next === 'all') {
      setGrouping('monthly');
    } else if (grouping === 'yearly') {
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
        dateStart: dateRange.start,
        dateEnd: dateRange.end,
        grouping,
      }),
    [sales, expenses, purchases, products, ingredients, dateRange, grouping]
  );

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

  const chartSeries = useMemo(
    () =>
      report.series.map((bucket) => ({
        ...bucket,
        label:
          grouping === 'daily'
            ? bucket.periodKey.slice(5)
            : bucket.periodKey,
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
      ['Net Profit (Accrual)', report.netProfitKhr],
      ['Net Margin %', `${report.netMarginPct}%`],
      ['Voided Orders (Excluded)', report.voidedOrdersCount],
      [],
      ['CASH FLOW STATEMENT', 'Amount (KHR)'],
      ['Sales Cash Inflows (Net)', report.cashInflowsKhr],
      ['  Cash', report.cashInflowsByMethod.cash],
      ['  KHQR', report.cashInflowsByMethod.khqr],
      ['  ABA', report.cashInflowsByMethod.aba],
      ['  Wing', report.cashInflowsByMethod.wing],
      ['Inventory Purchases Cash Outflow', -report.inventoryPurchasesCashOutKhr],
      ['Operating Expenses Cash Outflow', -report.operatingExpensesCashOutKhr],
      ['Business Net Cash Flow', report.businessNetCashFlowKhr],
      ['Household / Personal Outflows (Tracked Separately)', -report.householdExpensesCashOutKhr],
      [],
      ['CURRENT INVENTORY VALUATION (ASSET BALANCE)', 'Amount (KHR)'],
      ['Packaged Products Valuation', report.inventoryValuation.packagedValueKhr],
      ['Raw Ingredients Valuation', report.inventoryValuation.ingredientsValueKhr],
      ['Prepared Stock Valuation', report.inventoryValuation.preparedStockValueKhr],
      ['Total Inventory Valuation', report.inventoryValuation.totalInventoryValueKhr],
      [],
      ['SALES LEDGER', 'Date', 'Order #', 'Status', 'Payment', 'Gross (KHR)', 'Refunded (KHR)', 'Net (KHR)', 'Net COGS (KHR)'],
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
      ['INVENTORY PURCHASES', 'Date', 'Item', 'Classification', 'Qty', 'Unit', 'Supplier', 'Payment', 'Total Cost (KHR)'],
      ...periodPurchases.map((p) => [
        'PURCHASE',
        p.purchaseDate,
        p.itemName,
        p.itemClassification,
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
            {t.reports.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B]">
            {isVi
              ? `Báo cáo Lãi/Lỗ dồn tích, Dòng tiền & Giá trị tồn kho · Múi giờ ${BUSINESS_TIMEZONE}`
              : `Accrual P&L, Cash Flow & 3-Tier Inventory Valuation · ${BUSINESS_TIMEZONE}`}
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          {t.reports.exportCsv}
        </button>
      </div>

      {/* Period & Grouping Filter Bar */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['today', t.common.today],
                ['7d', t.common.last7Days],
                ['month', t.common.thisMonth],
                ['lastMonth', t.common.lastMonth],
                ['year', isVi ? 'Năm nay' : 'This Year'],
                ['all', t.common.allTime],
                ['custom', t.common.customRange],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePresetChange(key)}
                className={`h-11 px-3.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  preset === key
                    ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                    : 'bg-stone-100 dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-200 dark:hover:bg-[#1F3028] border border-transparent dark:border-[#24352C]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 self-start lg:self-auto">
            <span className="text-xs text-stone-500 dark:text-[#94A39B] whitespace-nowrap">
              {isVi ? 'Nhóm theo:' : 'Group by:'}
            </span>
            <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] rounded-lg">
              {(
                [
                  ['daily', isVi ? 'Ngày' : 'Daily'],
                  ['monthly', isVi ? 'Tháng' : 'Monthly'],
                  ['yearly', isVi ? 'Năm' : 'Yearly'],
                ] as const
              ).map(([grp, lbl]) => (
                <button
                  key={grp}
                  type="button"
                  onClick={() => setGrouping(grp)}
                  className={`h-9 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    grouping === grp
                      ? 'bg-white dark:bg-[#064E3B] text-stone-900 dark:text-[#D1FAE5] shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-xs pt-2 border-t border-stone-100 dark:border-[#1F3028]">
            <label className="text-stone-500 dark:text-[#94A39B]">{t.reports.from}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-11 px-3 font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
            />
            <label className="text-stone-500 dark:text-[#94A39B]">{t.reports.to}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-11 px-3 font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
            />
          </div>
        )}
      </div>

      {/* 4-Column Executive Reconciliation Strip */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-stone-200 dark:divide-[#24352C]">
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
            {isVi ? 'Doanh thu thuần' : 'Net Revenue'}
          </p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(report.netRevenueKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {report.completedOrderCount} {t.dashboard.ordersCount} · {report.unitsSoldNet}{' '}
            {isVi ? 'SP thuần' : 'net units'}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
            {isVi ? 'Lãi ròng (Dồn tích P&L)' : 'Accrual Net Profit'}
          </p>
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
            {t.reports.netMargin}: {report.netMarginPct}% ·{' '}
            {formatUsdRef(report.netProfitKhr, settings.usdRate)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
            {isVi ? 'Dòng tiền thuần kinh doanh' : 'Business Net Cash Flow'}
          </p>
          <p
            className={`mt-1.5 font-mono-num text-2xl font-semibold ${
              report.businessNetCashFlowKhr >= 0
                ? 'text-stone-900 dark:text-[#F1F5F3]'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {formatKhr(report.businessNetCashFlowKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {isVi ? 'Nhập kho:' : 'Stock-in:'} -{formatKhr(report.inventoryPurchasesCashOutKhr)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
            {isVi ? 'Giá trị tồn kho hiện tại' : 'Current Inventory Valuation'}
          </p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-[#0F5C43] dark:text-[#34D399]">
            {formatKhr(report.inventoryValuation.totalInventoryValueKhr)}
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(report.inventoryValuation.totalInventoryValueKhr, settings.usdRate)} ·{' '}
            {isVi ? 'Tài sản (không phải chi phí)' : 'Asset balance'}
          </p>
        </div>
      </div>

      {/* Section 1 & 2: Accrual P&L Statement + Cash Flow Statement Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Accrual P&L Ledger */}
        <div className="lg:col-span-6 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-stone-200 dark:border-[#24352C]">
              <div>
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {isVi ? '1. Báo cáo Lãi / Lỗ (Cơ sở dồn tích)' : '1. Accrual Profit & Loss Statement'}
                </h2>
                <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                  {isVi
                    ? 'Chỉ tính Giá vốn hàng đã bán (COGS) & Chi phí vận hành — không tính trùng tiền nhập kho'
                    : 'Matches COGS of sold items against operating expenses — zero double-counting of stock purchases'}
                </p>
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
                  {isVi ? 'Trả hàng & Hoàn tiền' : 'Less: Returns & Refunds'}
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.returnsRefundsKhr)}
                </dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-800 dark:text-[#F1F5F3] font-semibold">
                  {isVi ? 'Doanh thu thuần' : 'Net Revenue'}
                </dt>
                <dd className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  {formatKhr(report.netRevenueKhr)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 dark:text-[#94A39B] pl-3">
                  {isVi ? 'Giá vốn hàng bán thuần (COGS)' : 'Less: Cost of Goods Sold (Net COGS)'}
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.netCogsKhr)}
                </dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <div>
                  <dt className="text-stone-800 dark:text-[#F1F5F3] font-medium">
                    {t.reports.grossProfit}
                  </dt>
                  <span className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B]">
                    {isVi ? 'Biên gộp' : 'Gross margin'}: {report.grossMarginPct}%
                  </span>
                </div>
                <dd className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399] whitespace-nowrap">
                  {formatKhr(report.grossProfitKhr)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 dark:text-[#94A39B] pl-3">
                  {isVi
                    ? 'Chi phí vận hành (không gồm nhập kho)'
                    : 'Less: Operating Expenses (excl. stock purchases)'}
                </dt>
                <dd className="font-mono-num text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                  -{formatKhr(report.operatingExpensesKhr)}
                </dd>
              </div>
              <div className="py-4 flex justify-between items-baseline gap-4 border-t-2 border-stone-200 dark:border-[#24352C]">
                <div>
                  <dt className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3]">
                    {isVi ? 'Lợi nhuận ròng (P&L)' : 'Net Profit (Accrual)'}
                  </dt>
                  <span className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                    {t.reports.netMargin}: {report.netMarginPct}%
                  </span>
                </div>
                <div className="text-right">
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
                    {formatUsdRef(report.netProfitKhr, settings.usdRate)}
                  </span>
                </div>
              </div>
            </dl>
          </div>

          {report.voidedOrdersCount > 0 && (
            <p className="mt-3 pt-3 border-t border-stone-100 dark:border-[#1F3028] text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              {isVi
                ? `Đã loại trừ ${report.voidedOrdersCount} đơn hủy (${formatKhr(report.voidedTotalKhr)}).`
                : `Excluded ${report.voidedOrdersCount} voided order(s) totaling ${formatKhr(report.voidedTotalKhr)}.`}
            </p>
          )}
        </div>

        {/* Cash Flow Statement + Payment Method Breakdown */}
        <div className="lg:col-span-6 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="pb-4 border-b border-stone-200 dark:border-[#24352C]">
              <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {isVi ? '2. Báo cáo Dòng tiền (Tiền thực thu / thực chi)' : '2. Cash Flow Statement'}
              </h2>
              <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                {isVi
                  ? 'Theo dõi tiền vào từ bán hàng và tiền ra cho nhập hàng + vận hành trong kỳ'
                  : 'Tracks actual cash collected from sales minus cash paid for stock restocks and operating expenses'}
              </p>
            </div>

            <dl className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm mt-2">
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-800 dark:text-[#F1F5F3] font-medium">
                  {isVi ? 'Tiền thu bán hàng (sau hoàn tiền)' : 'Sales Cash Inflows (Net)'}
                </dt>
                <dd className="font-mono-num font-semibold text-emerald-700 dark:text-[#34D399] whitespace-nowrap">
                  +{formatKhr(report.cashInflowsKhr)}
                </dd>
              </div>

              <div className="py-2.5 pl-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => (
                  <div
                    key={pm}
                    className="bg-stone-50 dark:bg-[#18251F] border border-stone-200/70 dark:border-[#24352C] rounded-lg px-2.5 py-1.5"
                  >
                    <span className="block text-[11px] text-stone-500 dark:text-[#94A39B]">
                      {t.paymentMethods[pm]}
                    </span>
                    <span className="font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3]">
                      {formatKhr(report.cashInflowsByMethod[pm])}
                    </span>
                  </div>
                ))}
              </div>

              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 dark:text-[#D5DFDA]">
                  {isVi ? 'Tiền chi nhập kho (Hàng hóa & Nguyên liệu)' : 'Inventory Purchases Paid'}
                </dt>
                <dd className="font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  -{formatKhr(report.inventoryPurchasesCashOutKhr)}
                </dd>
              </div>

              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 dark:text-[#D5DFDA]">
                  {isVi ? 'Tiền chi vận hành (Điện, thuê, đóng gói...)' : 'Operating Expenses Paid'}
                </dt>
                <dd className="font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                  -{formatKhr(report.operatingExpensesCashOutKhr)}
                </dd>
              </div>

              <div className="py-4 flex justify-between items-baseline gap-4 border-t-2 border-stone-200 dark:border-[#24352C]">
                <div>
                  <dt className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3]">
                    {isVi ? 'Dòng tiền thuần kinh doanh' : 'Business Net Cash Flow'}
                  </dt>
                  <span className="text-xs text-stone-500 dark:text-[#94A39B]">
                    {isVi ? 'Thu bán hàng − Nhập kho − Chi vận hành' : 'Sales In − Stock Purchases − OpEx'}
                  </span>
                </div>
                <div className="text-right">
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
                    {formatUsdRef(report.businessNetCashFlowKhr, settings.usdRate)}
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

      {/* Section 3: 3-Tier Inventory Valuation */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pb-4 border-b border-stone-200 dark:border-[#24352C]">
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {isVi ? '3. Định giá Tồn kho hiện tại (3 nhóm hàng)' : '3. Current Inventory Valuation (3 Tiers)'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
              {isVi
                ? 'Tồn kho đầu kỳ (Opening Stock) và hàng chưa bán được ghi nhận tại đây như tài sản, không tính là chi phí.'
                : 'Opening stock balances and unsold inventory are valued here as assets — never counted as operating expenses.'}
            </p>
          </div>
          <span className="font-mono-num text-base font-bold text-[#0F5C43] dark:text-[#34D399] whitespace-nowrap">
            {formatKhr(report.inventoryValuation.totalInventoryValueKhr)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div className="bg-stone-50/40 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-4">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Sản phẩm đóng gói' : 'Packaged Products'}
            </p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(report.inventoryValuation.packagedValueKhr)}
            </p>
            <p className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B] mt-0.5">
              {formatUsdRef(report.inventoryValuation.packagedValueKhr, settings.usdRate)}
            </p>
          </div>

          <div className="bg-stone-50/40 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-4">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Nguyên liệu thô' : 'Ingredients / Raw Materials'}
            </p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(report.inventoryValuation.ingredientsValueKhr)}
            </p>
            <p className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B] mt-0.5">
              {formatUsdRef(report.inventoryValuation.ingredientsValueKhr, settings.usdRate)}
            </p>
          </div>

          <div className="bg-stone-50/40 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-4">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Hàng pha chế sẵn (Thành phẩm)' : 'Prepared Stock / Finished Goods'}
            </p>
            <p className="mt-1.5 font-mono-num text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(report.inventoryValuation.preparedStockValueKhr)}
            </p>
            <p className="text-[11px] font-mono-num text-stone-400 dark:text-[#94A39B] mt-0.5">
              {formatUsdRef(report.inventoryValuation.preparedStockValueKhr, settings.usdRate)}
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
                ? isVi
                  ? 'Xu hướng Doanh thu, Chi phí & Lãi ròng (P&L)'
                  : 'Accrual Revenue, Costs & Net Profit Trend'
                : isVi
                  ? 'Xu hướng Dòng tiền vào & ra'
                  : 'Cash Inflows vs Cash Outflows Trend'}
            </h2>
          </div>

          <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setChartView('pnl')}
              className={`h-9 px-3.5 text-xs font-semibold rounded-md transition-colors ${
                chartView === 'pnl'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              {isVi ? 'Lãi / Lỗ (P&L)' : 'Accrual P&L'}
            </button>
            <button
              type="button"
              onClick={() => setChartView('cashflow')}
              className={`h-9 px-3.5 text-xs font-semibold rounded-md transition-colors ${
                chartView === 'cashflow'
                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                  : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              {isVi ? 'Dòng tiền' : 'Cash Flow'}
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
                    borderRadius: '8px',
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
                  name={isVi ? 'Doanh thu thuần' : 'Net Revenue'}
                  fill={chartColors.revenue}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey={chartView === 'pnl' ? 'totalPnlCostKhr' : 'cashOutflowsKhr'}
                  name={
                    chartView === 'pnl'
                      ? isVi
                        ? 'COGS + Chi phí vận hành'
                        : 'COGS + Operating Expenses'
                      : isVi
                        ? 'Nhập kho + Chi vận hành'
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
                      ? isVi
                        ? 'Lãi ròng P&L'
                        : 'Net Profit'
                      : isVi
                        ? 'Dòng tiền thuần'
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

      {/* Product Profitability + Operating Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C]">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.reports.productPerformance}
            </h2>
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
                    <th className="py-3 px-3 font-medium text-right">COGS</th>
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
                          {isVi ? row.nameVi || row.name : row.name}
                        </p>
                        <p className="text-[11px] text-stone-500 dark:text-[#94A39B]">
                          {t.productTypes[row.productType]}
                          {row.returnedQty > 0
                            ? ` · ${row.returnedQty} ${isVi ? 'đã trả' : 'returned'}`
                            : ''}
                        </p>
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
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {isVi ? 'Phân bổ Chi phí vận hành' : 'Operating Expense Breakdown'}
            </h2>
            <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
              {isVi
                ? 'Không bao gồm nhập hàng tồn kho'
                : 'Excludes inventory purchases (tracked in Cash Flow)'}
            </p>
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
                      borderRadius: '8px',
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
