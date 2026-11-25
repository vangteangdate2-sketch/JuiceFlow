import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, Plus, Receipt } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { AppTab, IngredientUnit, StockClassification } from '../types';
import { daysAgoIso, formatKhr, formatQty, formatUsdRef, todayIso } from '../utils/format';
import { computeFinancialReport } from '../utils/inventoryEngine';
import { DailySummary } from '../components/DailySummary';
import { useTheme } from '../hooks/useTheme';

interface DashboardViewProps {
  onNavigate: (tab: AppTab) => void;
}

interface UnifiedLowStockItem {
  id: string;
  name: string;
  classification: StockClassification;
  stockQty: number;
  reorderLevel: number;
  unit: IngredientUnit;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { settings, sales, expenses, purchases, products, ingredients, t } = useStore();
  const { isDark } = useTheme();
  const isVi = settings.language === 'vi';
  const [chartMode, setChartMode] = useState<'revenue_costs' | 'profit'>('revenue_costs');
  const today = todayIso();
  const sevenDaysAgo = daysAgoIso(6);

  const chartColors = useMemo(
    () => ({
      grid: isDark ? '#24352C' : '#E7E5E4',
      tick: isDark ? '#94A39B' : '#78716C',
      revenue: isDark ? '#10B981' : '#0F5C43',
      costs: isDark ? '#F59E0B' : '#D9822B',
      tooltipBg: isDark ? '#131D18' : '#FFFFFF',
      tooltipBorder: isDark ? '#24352C' : '#E7E5E4',
      tooltipText: isDark ? '#F1F5F3' : '#1C1917',
    }),
    [isDark]
  );

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

  const periodReport = useMemo(
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

  const chartData = useMemo(() => {
    const byDate = new Map(periodReport.series.map((b) => [b.periodKey, b]));
    const days: { date: string; label: string; revenue: number; costs: number; profit: number }[] =
      [];
    for (let i = 6; i >= 0; i--) {
      const iso = daysAgoIso(i);
      const b = byDate.get(iso);
      const rev = b ? b.netRevenueKhr : 0;
      const costs = b ? b.cogsKhr + b.operatingExpensesKhr : 0;
      days.push({
        date: iso,
        label: iso.slice(5),
        revenue: rev,
        costs,
        profit: rev - costs,
      });
    }
    return days;
  }, [periodReport]);

  // Unified Low Stock Alerts across ALL 3 inventory classifications
  const lowStockList = useMemo<UnifiedLowStockItem[]>(() => {
    const alerts: UnifiedLowStockItem[] = [];

    for (const p of products) {
      if (!p.active) continue;
      if (p.productType === 'PACKAGED' || p.productType === 'PREPARED_STOCK') {
        if (p.stockQty <= p.reorderLevel) {
          alerts.push({
            id: `prod_${p.id}`,
            name: isVi ? p.nameVi || p.name : p.name,
            classification: p.productType === 'PACKAGED' ? 'packaged' : 'prepared_stock',
            stockQty: p.stockQty,
            reorderLevel: p.reorderLevel,
            unit: p.unit,
          });
        }
      }
    }

    for (const ing of ingredients) {
      if (ing.stockQty <= ing.reorderLevel) {
        alerts.push({
          id: `ing_${ing.id}`,
          name: isVi ? ing.nameVi || ing.name : ing.name,
          classification: 'ingredient',
          stockQty: ing.stockQty,
          reorderLevel: ing.reorderLevel,
          unit: ing.unit,
        });
      }
    }

    return alerts.sort((a, b) => {
      const aOut = a.stockQty <= 0 ? 0 : 1;
      const bOut = b.stockQty <= 0 ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      return a.stockQty - a.reorderLevel - (b.stockQty - b.reorderLevel);
    });
  }, [products, ingredients, isVi]);

  const activeDirectProductsCount = useMemo(
    () =>
      products.filter(
        (p) => p.active && (p.productType === 'PACKAGED' || p.productType === 'PREPARED_STOCK')
      ).length,
    [products]
  );

  const activeInventoryCount = activeDirectProductsCount + ingredients.length;

  const todayExpensesTotalKhr =
    todayReport.operatingExpensesKhr + todayReport.inventoryPurchasesCashOutKhr;

  const todayExpenseEntriesCount = useMemo(() => {
    const expCount = expenses.filter(
      (e) => e.expenseDate === today && e.scope === 'business'
    ).length;
    const purCount = purchases.filter((p) => p.purchaseDate === today).length;
    return expCount + purCount;
  }, [expenses, purchases, today]);

  const topProducts = useMemo(
    () => periodReport.productProfitability.slice(0, 5),
    [periodReport.productProfitability]
  );

  const recentSales = useMemo(() => sales.slice(0, 6), [sales]);

  const classificationLabel = (c: StockClassification) => {
    if (c === 'packaged') return isVi ? 'Đóng gói' : 'Packaged';
    if (c === 'prepared_stock') return isVi ? 'Pha sẵn' : 'Prepared';
    return isVi ? 'Nguyên liệu' : 'Ingredient';
  };

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight text-balance">
            {t.dashboard.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B]">{t.dashboard.subtitle}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('expenses')}
            className="inline-flex items-center gap-2 h-11 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Receipt className="w-4 h-4 shrink-0" />
            {t.dashboard.logExpense}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            {t.dashboard.newSale}
          </button>
        </div>
      </div>

      {/* Daily Summary KPI Cards (Today) */}
      <DailySummary
        dateLabel={today}
        isVi={isVi}
        usdRate={settings.usdRate}
        todaySalesKhr={todayReport.netRevenueKhr}
        todayOrderCount={todayReport.completedOrderCount}
        todayUnitsSold={todayReport.unitsSoldNet}
        activeInventoryCount={activeInventoryCount}
        activeDirectProductsCount={activeDirectProductsCount}
        activeIngredientsCount={ingredients.length}
        lowStockCount={lowStockList.length}
        todayExpensesKhr={todayExpensesTotalKhr}
        todayOperatingExpensesKhr={todayReport.operatingExpensesKhr}
        todayStockPurchasesKhr={todayReport.inventoryPurchasesCashOutKhr}
        todayExpenseEntriesCount={todayExpenseEntriesCount}
        onNavigate={onNavigate}
      />

      {/* 7-Day Performance & Stock Strip (Distinct from Today's Daily Summary above) */}
      <section aria-labelledby="period-performance-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="period-performance-heading"
            className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] tracking-tight"
          >
            {isVi ? 'Hiệu suất 7 ngày & Giá trị kho' : '7-Day Performance & Stock Value'}
          </h2>
          <span className="text-xs font-mono-num text-stone-500 dark:text-[#94A39B]">
            {sevenDaysAgo} – {today}
          </span>
        </div>

        <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-stone-200 dark:divide-[#24352C]">
          <div className="p-5">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {t.dashboard.revenuePeriod}
            </p>
            <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(periodReport.netRevenueKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              {periodReport.completedOrderCount} {t.dashboard.ordersCount} ·{' '}
              {formatUsdRef(periodReport.netRevenueKhr, settings.usdRate)}
            </p>
          </div>

          <div className="p-5">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'COGS + Chi vận hành (7 ngày)' : 'COGS + OpEx (7 Days)'}
            </p>
            <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(periodReport.netCogsKhr + periodReport.operatingExpensesKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              COGS {formatKhr(periodReport.netCogsKhr)} · OpEx{' '}
              {formatKhr(periodReport.operatingExpensesKhr)}
            </p>
          </div>

          <div className="p-5">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {t.dashboard.netProfitPeriod}
            </p>
            <p
              className={`mt-2 font-mono-num text-2xl font-semibold ${
                periodReport.netProfitKhr >= 0
                  ? 'text-emerald-700 dark:text-[#34D399]'
                  : 'text-red-700 dark:text-[#F87171]'
              }`}
            >
              {formatKhr(periodReport.netProfitKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              {t.dashboard.margin}: {periodReport.netMarginPct}% ·{' '}
              {isVi ? 'Lãi gộp:' : 'Gross:'} {periodReport.grossMarginPct}%
            </p>
          </div>

          <div className="p-5">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Tổng giá trị tồn kho' : 'Total Inventory Value'}
            </p>
            <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {formatKhr(periodReport.inventoryValuation.totalInventoryValueKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              {isVi ? 'Sản phẩm:' : 'Goods:'}{' '}
              {formatKhr(
                periodReport.inventoryValuation.packagedValueKhr +
                  periodReport.inventoryValuation.preparedStockValueKhr
              )}{' '}
              · {isVi ? 'NL:' : 'Ing:'}{' '}
              {formatKhr(periodReport.inventoryValuation.ingredientsValueKhr)}
            </p>
          </div>
        </div>
      </section>

      {/* Main Analytics + 3-Tier Low Stock Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 7-Day Revenue vs Costs / Net Profit Trend Chart */}
        <div className="lg:col-span-8 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {chartMode === 'revenue_costs'
                  ? t.dashboard.revenueVsExpense
                  : isVi
                    ? 'Xu hướng lợi nhuận ròng (7 ngày)'
                    : 'Net Profit Trend (7 Days)'}
              </h2>
              {chartMode === 'revenue_costs' ? (
                <div className="flex items-center gap-3 text-xs text-stone-600 dark:text-[#94A39B]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#0F5C43] dark:bg-[#10B981]" />
                    {t.dashboard.revenueSeries}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#D9822B] dark:bg-[#F59E0B]" />
                    {isVi ? 'COGS + Vận hành' : 'COGS + OpEx'}
                  </span>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-stone-600 dark:text-[#94A39B]">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#0F5C43] dark:bg-[#10B981]" />
                  {isVi ? 'Lợi nhuận ròng hàng ngày' : 'Daily Net Profit'}
                </span>
              )}
            </div>

            <div className="inline-flex items-center rounded-lg border border-stone-200 dark:border-[#24352C] bg-stone-50 dark:bg-[#18251F] p-1 text-xs">
              <button
                type="button"
                onClick={() => setChartMode('revenue_costs')}
                className={`h-9 px-3 rounded-md font-medium transition-colors whitespace-nowrap ${
                  chartMode === 'revenue_costs'
                    ? 'bg-white dark:bg-[#064E3B] text-stone-900 dark:text-[#D1FAE5] border border-stone-200 dark:border-[#10B981]/40'
                    : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                {isVi ? 'Doanh thu / Chi phí' : 'Revenue vs Costs'}
              </button>
              <button
                type="button"
                onClick={() => setChartMode('profit')}
                className={`h-9 px-3 rounded-md font-medium transition-colors whitespace-nowrap ${
                  chartMode === 'profit'
                    ? 'bg-white dark:bg-[#064E3B] text-stone-900 dark:text-[#D1FAE5] border border-stone-200 dark:border-[#10B981]/40'
                    : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                {isVi ? 'Lợi nhuận' : 'Net Profit'}
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'revenue_costs' ? (
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                    formatter={(value) => formatKhr(Number(value ?? 0))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: `1px solid ${chartColors.tooltipBorder}`,
                      backgroundColor: chartColors.tooltipBg,
                      color: chartColors.tooltipText,
                      boxShadow: 'none',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: chartColors.tooltipText, fontWeight: 600 }}
                  />
                  <Bar
                    dataKey="revenue"
                    name={t.dashboard.revenueSeries}
                    fill={chartColors.revenue}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="costs"
                    name={isVi ? 'COGS + Vận hành' : 'COGS + OpEx'}
                    fill={chartColors.costs}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColors.revenue} stopOpacity={isDark ? 0.32 : 0.22} />
                      <stop offset="95%" stopColor={chartColors.revenue} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
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
                    formatter={(value) => formatKhr(Number(value ?? 0))}
                    contentStyle={{
                      borderRadius: '8px',
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
                    dataKey="profit"
                    name={isVi ? 'Lợi nhuận ròng' : 'Net Profit'}
                    stroke={chartColors.revenue}
                    strokeWidth={2}
                    fill="url(#profitFill)"
                    activeDot={{ r: 4, fill: chartColors.revenue }}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Unified 3-Tier Low Stock Alerts Panel */}
        <div className="lg:col-span-4 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.dashboard.lowStockTitle}
              {lowStockList.length > 0 && (
                <span className="ml-2 font-mono-num text-xs font-semibold text-amber-700 dark:text-amber-300">
                  ({lowStockList.length})
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-[#0F5C43] dark:text-[#34D399] hover:underline whitespace-nowrap shrink-0"
            >
              {t.dashboard.viewAll}
            </button>
          </div>

          {lowStockList.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-8">
              <p className="text-sm text-stone-500 dark:text-[#94A39B] max-w-xs">
                {t.dashboard.lowStockEmpty}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-[#1F3028] flex-1">
              {lowStockList.slice(0, 6).map((item) => {
                const isOut = item.stockQty <= 0;
                return (
                  <li key={item.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isOut
                              ? 'text-red-600 dark:text-[#F87171]'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        />
                        <p className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3] truncate">
                          {item.name}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                        <span className="font-sans text-[11px] text-stone-400 dark:text-[#94A39B]/80 mr-1.5">
                          {classificationLabel(item.classification)} ·
                        </span>
                        {formatQty(item.stockQty, item.unit)} / {t.inventory.reorderAt}:{' '}
                        {formatQty(item.reorderLevel, item.unit)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('inventory')}
                      className="text-xs font-medium text-[#0F5C43] dark:text-[#34D399] hover:text-[#0B4734] dark:hover:text-[#6EE7B7] whitespace-nowrap shrink-0"
                    >
                      {t.dashboard.restockNow}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Orders + Top Selling Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Recent Sales Table */}
        <div className="lg:col-span-8 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.dashboard.recentSalesTitle}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0F5C43] dark:text-[#34D399] hover:underline whitespace-nowrap shrink-0"
            >
              {t.dashboard.viewAll}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentSales.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-stone-500 dark:text-[#94A39B] mb-4">
                {t.dashboard.noSalesYet}
              </p>
              <button
                type="button"
                onClick={() => onNavigate('sales')}
                className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] dark:bg-[#10B981] dark:text-[#042419] rounded-lg"
              >
                <Plus className="w-4 h-4" />
                {t.dashboard.newSale}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                    <th className="py-2.5 px-6 font-medium">Order</th>
                    <th className="py-2.5 px-4 font-medium">{t.sales.itemsSummary}</th>
                    <th className="py-2.5 px-4 font-medium">{t.common.payment}</th>
                    <th className="py-2.5 px-4 font-medium">{t.common.operator}</th>
                    <th className="py-2.5 px-6 font-medium text-right">{t.common.total}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                  {recentSales.map((sale) => {
                    const netKhr = sale.netTotalKhr ?? sale.totalKhr;
                    return (
                      <tr
                        key={sale.id}
                        className="hover:bg-stone-50/70 dark:hover:bg-[#18251F]/70 transition-colors"
                      >
                        <td className="py-3 px-6 whitespace-nowrap">
                          <span className="font-mono-num font-medium text-stone-900 dark:text-[#F1F5F3]">
                            {sale.orderNumber}
                          </span>
                          <span className="block text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                            {sale.saleDate}
                          </span>
                        </td>
                        <td className="py-3 px-4 max-w-[240px]">
                          <p className="text-stone-800 dark:text-[#F1F5F3] truncate">
                            {sale.items
                              .map(
                                (i) =>
                                  `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}${
                                    i.variantName ? ` (${i.variantName})` : ''
                                  }`
                              )
                              .join(', ')}
                          </p>
                          {sale.customerName && (
                            <p className="text-xs text-stone-500 dark:text-[#94A39B] truncate">
                              {sale.customerName}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                          {t.paymentMethods[sale.paymentMethod]}
                        </td>
                        <td className="py-3 px-4 text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                          {sale.recordedBy}
                        </td>
                        <td className="py-3 px-6 text-right font-mono-num whitespace-nowrap">
                          <span
                            className={
                              sale.status === 'voided' || sale.status === 'refunded'
                                ? 'line-through text-stone-400 dark:text-[#94A39B]/60'
                                : 'font-semibold text-stone-900 dark:text-[#F1F5F3]'
                            }
                          >
                            {formatKhr(sale.status === 'partially_returned' ? netKhr : sale.totalKhr)}
                          </span>
                          {sale.status === 'partially_returned' && (
                            <span className="block text-[11px] text-amber-700 dark:text-amber-300 font-sans">
                              {isVi ? 'Trả 1 phần' : 'Partial return'}
                            </span>
                          )}
                          {sale.status === 'refunded' && (
                            <span className="block text-[11px] text-amber-700 dark:text-amber-300 font-sans">
                              {isVi ? 'Đã hoàn tiền' : 'Refunded'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Selling Items (Net of Returns, 7 Days) */}
        <div className="lg:col-span-4 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] mb-4">
            {t.dashboard.topDrinksTitle}
          </h2>

          {topProducts.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-[#94A39B] py-8 text-center">
              {t.common.noResults}
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-[#1F3028]">
              {topProducts.map((item, idx) => (
                <li key={item.productId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3] truncate">
                      <span className="font-mono-num text-stone-400 dark:text-[#94A39B]/70 mr-2">
                        0{idx + 1}.
                      </span>
                      {isVi ? item.nameVi || item.name : item.name}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num pl-7">
                      {item.netQty} {isVi ? 'đã bán' : 'sold'} · {item.marginPct}%
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap shrink-0">
                    {formatKhr(item.netRevenueKhr)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
