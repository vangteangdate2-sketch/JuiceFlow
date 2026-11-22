import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { ExpenseCategory } from '../types';
import { daysAgoIso, downloadCsv, formatKhr, formatUsdRef, todayIso } from '../utils/format';

type PeriodPreset = 'today' | '7d' | 'month' | 'lastMonth' | 'all' | 'custom';

function getMonthBounds(offsetMonths: number): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(first), end: fmt(last) };
}

export const ReportsView: React.FC = () => {
  const { settings, sales, expenses, t } = useStore();
  const isVi = settings.language === 'vi';

  const [preset, setPreset] = useState<PeriodPreset>('7d');
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
        return getMonthBounds(0);
      case 'lastMonth':
        return getMonthBounds(-1);
      case 'all':
        return { start: '2000-01-01', end: '2099-12-31' };
      case 'custom':
        return { start: customStart || '2000-01-01', end: customEnd || today };
    }
  }, [preset, customStart, customEnd]);

  const report = useMemo(() => {
    const validSales = sales.filter(
      (s) =>
        s.status === 'completed' &&
        s.saleDate >= dateRange.start &&
        s.saleDate <= dateRange.end
    );
    const periodExpenses = expenses.filter(
      (e) => e.expenseDate >= dateRange.start && e.expenseDate <= dateRange.end
    );
    const bizExpenses = periodExpenses.filter((e) => e.scope === 'business');
    const householdExpenses = periodExpenses.filter((e) => e.scope === 'household');

    const grossRevenue = validSales.reduce((sum, s) => sum + s.totalKhr, 0);
    const recipeCogs = validSales.reduce((sum, s) => sum + s.cogsKhr, 0);
    const grossProfit = grossRevenue - recipeCogs;

    const ingredientPurchases = bizExpenses
      .filter((e) => e.category === 'ingredients')
      .reduce((sum, e) => sum + e.amountKhr, 0);
    const operatingExpenses = bizExpenses
      .filter((e) => e.category !== 'ingredients')
      .reduce((sum, e) => sum + e.amountKhr, 0);
    const totalBusinessExpenses = ingredientPurchases + operatingExpenses;
    const netProfitCash = grossRevenue - totalBusinessExpenses;
    const netMarginPct = grossRevenue > 0 ? Math.round((netProfitCash / grossRevenue) * 100) : 0;
    const householdTotal = householdExpenses.reduce((sum, e) => sum + e.amountKhr, 0);

    // Daily trend
    const dailyMap = new Map<string, { date: string; revenue: number; expenses: number; profit: number }>();
    for (const s of validSales) {
      const entry = dailyMap.get(s.saleDate) || {
        date: s.saleDate,
        revenue: 0,
        expenses: 0,
        profit: 0,
      };
      entry.revenue += s.totalKhr;
      dailyMap.set(s.saleDate, entry);
    }
    for (const e of bizExpenses) {
      const entry = dailyMap.get(e.expenseDate) || {
        date: e.expenseDate,
        revenue: 0,
        expenses: 0,
        profit: 0,
      };
      entry.expenses += e.amountKhr;
      dailyMap.set(e.expenseDate, entry);
    }
    const dailySeries = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        label: row.date.slice(5),
        profit: row.revenue - row.expenses,
      }));

    // Expense breakdown by category
    const catMap = new Map<ExpenseCategory, number>();
    for (const e of bizExpenses) {
      catMap.set(e.category, (catMap.get(e.category) || 0) + e.amountKhr);
    }
    const categorySeries = Array.from(catMap.entries())
      .map(([cat, amount]) => ({
        category: t.expenseCategories[cat],
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Product profitability
    const prodMap = new Map<
      string,
      { name: string; units: number; revenue: number; cost: number; profit: number }
    >();
    for (const s of validSales) {
      for (const item of s.items) {
        const displayName = isVi ? item.productNameVi || item.productName : item.productName;
        const entry = prodMap.get(item.productId) || {
          name: displayName,
          units: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
        entry.units += item.quantity;
        entry.revenue += item.lineTotalKhr;
        entry.cost += item.unitCogsKhr * item.quantity;
        entry.profit = entry.revenue - entry.cost;
        prodMap.set(item.productId, entry);
      }
    }
    const productRows = Array.from(prodMap.values()).sort((a, b) => b.revenue - a.revenue);

    return {
      orderCount: validSales.length,
      grossRevenue,
      recipeCogs,
      grossProfit,
      ingredientPurchases,
      operatingExpenses,
      totalBusinessExpenses,
      netProfitCash,
      netMarginPct,
      householdTotal,
      dailySeries,
      categorySeries,
      productRows,
      validSales,
      periodExpenses,
    };
  }, [sales, expenses, dateRange, t, isVi]);

  const handleExportCsv = () => {
    const rows: (string | number)[][] = [
      ['JuiceFlow Financial Report', settings.name],
      ['Period', `${dateRange.start} to ${dateRange.end}`],
      ['Currency', 'KHR'],
      [],
      ['PROFIT & LOSS SUMMARY', 'Amount (KHR)'],
      [t.reports.grossRevenue, report.grossRevenue],
      [t.reports.recipeCogs, report.recipeCogs],
      [t.reports.grossProfit, report.grossProfit],
      [t.reports.ingredientPurchases, report.ingredientPurchases],
      [t.reports.operatingExpenses, report.operatingExpenses],
      [t.reports.totalBusinessExpenses, report.totalBusinessExpenses],
      [t.reports.netProfitCash, report.netProfitCash],
      [t.reports.householdSummary, report.householdTotal],
      [],
      ['SALES LEDGER', 'Date', 'Order #', 'Payment', 'Recorded By', 'COGS (KHR)', 'Total (KHR)'],
      ...report.validSales.map((s) => [
        'SALE',
        s.saleDate,
        s.orderNumber,
        s.paymentMethod,
        s.recordedBy,
        s.cogsKhr,
        s.totalKhr,
      ]),
      [],
      ['EXPENSES', 'Date', 'Title', 'Scope', 'Category', 'Recorded By', 'Amount (KHR)'],
      ...report.periodExpenses.map((e) => [
        'EXPENSE',
        e.expenseDate,
        e.title,
        e.scope,
        e.category,
        e.recordedBy,
        e.amountKhr,
      ]),
    ];

    downloadCsv(`juiceflow-report-${dateRange.start}-to-${dateRange.end}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.reports.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.reports.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          {t.reports.exportCsv}
        </button>
      </div>

      {/* Period Filter Bar */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['today', t.common.today],
              ['7d', t.common.last7Days],
              ['month', t.common.thisMonth],
              ['lastMonth', t.common.lastMonth],
              ['all', t.common.allTime],
              ['custom', t.common.customRange],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                preset === key
                  ? 'bg-[#0F5C43] text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="text-stone-500">{t.reports.from}</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 font-mono-num border border-stone-200 rounded-lg"
            />
            <label className="text-stone-500">{t.reports.to}</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 font-mono-num border border-stone-200 rounded-lg"
            />
          </div>
        )}
      </div>

      {/* P&L Statement + Daily Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Structured P&L Ledger */}
        <div className="lg:col-span-5 bg-white border border-stone-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between gap-2 pb-4 border-b border-stone-200">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {t.reports.pnlStatement}
              </h2>
              <span className="text-xs font-mono-num text-stone-500">
                {report.orderCount} {t.dashboard.ordersCount}
              </span>
            </div>

            <dl className="divide-y divide-stone-100 text-sm mt-2">
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 font-medium">{t.reports.grossRevenue}</dt>
                <dd className="font-mono-num font-semibold text-stone-900 whitespace-nowrap">
                  {formatKhr(report.grossRevenue)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 pl-3">{t.reports.recipeCogs}</dt>
                <dd className="font-mono-num text-stone-600 whitespace-nowrap">
                  -{formatKhr(report.recipeCogs)}
                </dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 font-medium">{t.reports.grossProfit}</dt>
                <dd className="font-mono-num font-semibold text-emerald-700 whitespace-nowrap">
                  {formatKhr(report.grossProfit)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 pl-3">{t.reports.ingredientPurchases}</dt>
                <dd className="font-mono-num text-stone-600 whitespace-nowrap">
                  -{formatKhr(report.ingredientPurchases)}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4 text-xs">
                <dt className="text-stone-500 pl-3">{t.reports.operatingExpenses}</dt>
                <dd className="font-mono-num text-stone-600 whitespace-nowrap">
                  -{formatKhr(report.operatingExpenses)}
                </dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-stone-700 font-medium">{t.reports.totalBusinessExpenses}</dt>
                <dd className="font-mono-num font-semibold text-stone-900 whitespace-nowrap">
                  -{formatKhr(report.totalBusinessExpenses)}
                </dd>
              </div>
              <div className="py-4 flex justify-between items-baseline gap-4 border-t-2 border-stone-200">
                <div>
                  <dt className="font-display text-base font-bold text-stone-900">
                    {t.reports.netProfitCash}
                  </dt>
                  <span className="text-xs text-stone-500 font-mono-num">
                    {t.reports.netMargin}: {report.netMarginPct}%
                  </span>
                </div>
                <div className="text-right">
                  <dd
                    className={`font-mono-num text-xl font-bold whitespace-nowrap ${
                      report.netProfitCash >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatKhr(report.netProfitCash)}
                  </dd>
                  <span className="text-xs font-mono-num text-stone-400">
                    {formatUsdRef(report.netProfitCash, settings.usdRate)}
                  </span>
                </div>
              </div>
            </dl>
          </div>

          <div className="mt-4 pt-4 border-t border-stone-200 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-amber-800 font-medium">{t.reports.householdSummary}</span>
              <span className="font-mono-num font-semibold text-amber-800">
                {formatKhr(report.householdTotal)}
              </span>
            </div>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              {t.reports.basisExplanation}
            </p>
          </div>
        </div>

        {/* Daily Trend Chart */}
        <div className="lg:col-span-7 bg-white border border-stone-200 rounded-xl p-6 flex flex-col">
          <h2 className="font-display text-lg font-semibold text-stone-900 mb-5">
            {t.reports.dailyTrend}
          </h2>
          {report.dailySeries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-stone-500 py-12">
              {t.common.noResults}
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={report.dailySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: '#78716C' }}
                    axisLine={{ stroke: '#E7E5E4' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#78716C' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(val) => formatKhr(Number(val ?? 0))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E7E5E4',
                      boxShadow: 'none',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="revenue"
                    name={t.dashboard.revenueSeries}
                    fill="#0F5C43"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="expenses"
                    name={t.dashboard.expenseSeries}
                    fill="#D9822B"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Line
                    type="monotone"
                    dataKey="profit"
                    name={t.reports.netProfitCash}
                    stroke="#1C1917"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Product Profitability + Expense Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200">
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.reports.productPerformance}
            </h2>
          </div>
          {report.productRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-stone-500">{t.common.noResults}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                    <th className="py-3 px-6 font-medium">{t.nav.products}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.reports.unitsSold}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.reports.revenue}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.reports.estCost}</th>
                    <th className="py-3 px-6 font-medium text-right">{t.reports.profit}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {report.productRows.map((row) => (
                    <tr key={row.name}>
                      <td className="py-3 px-6 font-medium text-stone-900">{row.name}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-stone-700">
                        {row.units}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-medium text-stone-900">
                        {formatKhr(row.revenue)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-xs text-stone-500">
                        {formatKhr(row.cost)}
                      </td>
                      <td className="py-3 px-6 text-right font-mono-num font-semibold text-emerald-700">
                        {formatKhr(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-stone-200 rounded-xl p-6 flex flex-col">
          <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
            {t.reports.expenseBreakdown}
          </h2>
          {report.categorySeries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-stone-500 py-8">
              {t.common.noResults}
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={report.categorySeries}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: '#78716C' }}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={110}
                    tick={{ fontSize: 12, fill: '#44403C' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val) => formatKhr(Number(val ?? 0))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E7E5E4',
                      boxShadow: 'none',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="amount" fill="#D9822B" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
