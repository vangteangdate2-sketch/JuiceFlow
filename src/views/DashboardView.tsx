import React, { useMemo } from 'react';
import {
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
import type { AppTab } from '../types';
import { daysAgoIso, formatKhr, formatQty, formatUsdRef, todayIso } from '../utils/format';

interface DashboardViewProps {
  onNavigate: (tab: AppTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { settings, sales, expenses, ingredients, t } = useStore();
  const isVi = settings.language === 'vi';
  const today = todayIso();
  const sevenDaysAgo = daysAgoIso(6);

  const metrics = useMemo(() => {
    const validSales = sales.filter((s) => s.status === 'completed');
    const todaySales = validSales.filter((s) => s.saleDate === today);
    const periodSales = validSales.filter((s) => s.saleDate >= sevenDaysAgo && s.saleDate <= today);
    const periodBizExpenses = expenses.filter(
      (e) => e.scope === 'business' && e.expenseDate >= sevenDaysAgo && e.expenseDate <= today
    );
    const periodHouseholdExpenses = expenses.filter(
      (e) => e.scope === 'household' && e.expenseDate >= sevenDaysAgo && e.expenseDate <= today
    );

    const todayRevenue = todaySales.reduce((sum, s) => sum + s.totalKhr, 0);
    const periodRevenue = periodSales.reduce((sum, s) => sum + s.totalKhr, 0);
    const periodExpenseTotal = periodBizExpenses.reduce((sum, e) => sum + e.amountKhr, 0);
    const netProfit = periodRevenue - periodExpenseTotal;
    const marginPct = periodRevenue > 0 ? Math.round((netProfit / periodRevenue) * 100) : 0;
    const householdTotal = periodHouseholdExpenses.reduce((sum, e) => sum + e.amountKhr, 0);

    return {
      todayRevenue,
      todayOrders: todaySales.length,
      periodRevenue,
      periodOrders: periodSales.length,
      periodExpenseTotal,
      netProfit,
      marginPct,
      householdTotal,
    };
  }, [sales, expenses, today, sevenDaysAgo]);

  const chartData = useMemo(() => {
    const days: { date: string; label: string; revenue: number; expenses: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const iso = daysAgoIso(i);
      const rev = sales
        .filter((s) => s.status === 'completed' && s.saleDate === iso)
        .reduce((sum, s) => sum + s.totalKhr, 0);
      const exp = expenses
        .filter((e) => e.scope === 'business' && e.expenseDate === iso)
        .reduce((sum, e) => sum + e.amountKhr, 0);
      days.push({
        date: iso,
        label: iso.slice(5),
        revenue: rev,
        expenses: exp,
      });
    }
    return days;
  }, [sales, expenses]);

  const lowStockList = useMemo(
    () =>
      ingredients
        .filter((i) => i.stockQty <= i.reorderLevel)
        .sort((a, b) => a.stockQty - a.reorderLevel - (b.stockQty - b.reorderLevel)),
    [ingredients]
  );

  const topDrinks = useMemo(() => {
    const map = new Map<string, { name: string; cups: number; revenue: number }>();
    for (const s of sales) {
      if (s.status !== 'completed') continue;
      for (const item of s.items) {
        const displayName = isVi ? item.productNameVi || item.productName : item.productName;
        const prev = map.get(item.productId) || { name: displayName, cups: 0, revenue: 0 };
        prev.cups += item.quantity;
        prev.revenue += item.lineTotalKhr;
        map.set(item.productId, prev);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [sales, isVi]);

  const recentSales = useMemo(() => sales.slice(0, 6), [sales]);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight text-balance">
            {t.dashboard.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.dashboard.subtitle}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('expenses')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Receipt className="w-4 h-4 shrink-0" />
            {t.dashboard.logExpense}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sales')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" />
            {t.dashboard.newSale}
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip (single elevation, hairline grid dividers) */}
      <div className="bg-white border border-stone-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.revenueToday}</p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(metrics.todayRevenue)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {metrics.todayOrders} {t.dashboard.ordersCount} · {formatUsdRef(metrics.todayRevenue, settings.usdRate)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.revenuePeriod}</p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(metrics.periodRevenue)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {metrics.periodOrders} {t.dashboard.ordersCount} · {formatUsdRef(metrics.periodRevenue, settings.usdRate)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.expensesPeriod}</p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(metrics.periodExpenseTotal)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {metrics.householdTotal > 0
              ? `${t.expenses.scopeHousehold}: ${formatKhr(metrics.householdTotal)}`
              : t.dashboard.householdNote}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.netProfitPeriod}</p>
          <p
            className={`mt-2 font-mono-num text-2xl font-semibold ${
              metrics.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatKhr(metrics.netProfit)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {t.dashboard.margin}: {metrics.marginPct}% · {formatUsdRef(metrics.netProfit, settings.usdRate)}
          </p>
        </div>
      </div>

      {/* Main Analytics + Low Stock Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 7-Day Cashflow Chart */}
        <div className="lg:col-span-8 bg-white border border-stone-200 rounded-xl p-6 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.dashboard.revenueVsExpense}
            </h2>
            <div className="flex items-center gap-4 text-xs text-stone-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#0F5C43]" />
                {t.dashboard.revenueSeries}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#D9822B]" />
                {t.dashboard.expenseSeries}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                  formatter={(value) => formatKhr(Number(value ?? 0))}
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
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expenses"
                  name={t.dashboard.expenseSeries}
                  fill="#D9822B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Low Stock Alerts Panel */}
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.dashboard.lowStockTitle}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-[#0F5C43] hover:underline whitespace-nowrap shrink-0"
            >
              {t.dashboard.viewAll}
            </button>
          </div>

          {lowStockList.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center py-8">
              <p className="text-sm text-stone-500 max-w-xs">{t.dashboard.lowStockEmpty}</p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 flex-1">
              {lowStockList.slice(0, 5).map((ing) => {
                const isOut = ing.stockQty <= 0;
                return (
                  <li key={ing.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isOut ? 'text-red-600' : 'text-amber-600'
                          }`}
                        />
                        <p className="text-sm font-medium text-stone-900 truncate">
                          {isVi ? ing.nameVi || ing.name : ing.name}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-stone-500 font-mono-num">
                        {formatQty(ing.stockQty, ing.unit)} / {t.inventory.reorderAt}:{' '}
                        {formatQty(ing.reorderLevel, ing.unit)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('inventory')}
                      className="text-xs font-medium text-[#0F5C43] hover:text-[#0B4734] whitespace-nowrap shrink-0"
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

      {/* Bottom Row: Recent Orders + Top Selling Beverages */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Recent Sales Table */}
        <div className="lg:col-span-8 bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.dashboard.recentSalesTitle}
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0F5C43] hover:underline whitespace-nowrap shrink-0"
            >
              {t.dashboard.viewAll}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentSales.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-stone-500 mb-4">{t.dashboard.noSalesYet}</p>
              <button
                type="button"
                onClick={() => onNavigate('sales')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F5C43] rounded-lg"
              >
                <Plus className="w-4 h-4" />
                {t.dashboard.newSale}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                    <th className="py-2.5 px-6 font-medium">Order</th>
                    <th className="py-2.5 px-4 font-medium">{t.sales.itemsSummary}</th>
                    <th className="py-2.5 px-4 font-medium">{t.common.payment}</th>
                    <th className="py-2.5 px-4 font-medium">{t.common.operator}</th>
                    <th className="py-2.5 px-6 font-medium text-right">{t.common.total}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {recentSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-stone-50/70 transition-colors">
                      <td className="py-3 px-6 whitespace-nowrap">
                        <span className="font-mono-num font-medium text-stone-900">
                          {sale.orderNumber}
                        </span>
                        <span className="block text-xs text-stone-500 font-mono-num">
                          {sale.saleDate}
                        </span>
                      </td>
                      <td className="py-3 px-4 max-w-[240px]">
                        <p className="text-stone-800 truncate">
                          {sale.items
                            .map(
                              (i) =>
                                `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}`
                            )
                            .join(', ')}
                        </p>
                        {sale.customerName && (
                          <p className="text-xs text-stone-500 truncate">{sale.customerName}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-600 whitespace-nowrap">
                        {t.paymentMethods[sale.paymentMethod]}
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-600 whitespace-nowrap">
                        {sale.recordedBy}
                      </td>
                      <td className="py-3 px-6 text-right font-mono-num whitespace-nowrap">
                        <span
                          className={
                            sale.status === 'voided'
                              ? 'line-through text-stone-400'
                              : 'font-semibold text-stone-900'
                          }
                        >
                          {formatKhr(sale.totalKhr)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Selling Beverages */}
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
            {t.dashboard.topDrinksTitle}
          </h2>

          {topDrinks.length === 0 ? (
            <p className="text-sm text-stone-500 py-8 text-center">{t.common.noResults}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {topDrinks.map((drink, idx) => (
                <li key={drink.name} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">
                      <span className="font-mono-num text-stone-400 mr-2">0{idx + 1}.</span>
                      {drink.name}
                    </p>
                    <p className="text-xs text-stone-500 font-mono-num pl-7">
                      {drink.cups} {t.dashboard.cupsSold}
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-semibold text-stone-900 whitespace-nowrap shrink-0">
                    {formatKhr(drink.revenue)}
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
