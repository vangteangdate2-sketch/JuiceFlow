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
import type { AppTab, IngredientUnit, StockClassification } from '../types';
import { daysAgoIso, formatKhr, formatQty, formatUsdRef, todayIso } from '../utils/format';
import { computeFinancialReport } from '../utils/inventoryEngine';

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
  const isVi = settings.language === 'vi';
  const today = todayIso();
  const sevenDaysAgo = daysAgoIso(6);

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
    const days: { date: string; label: string; revenue: number; costs: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const iso = daysAgoIso(i);
      const b = byDate.get(iso);
      days.push({
        date: iso,
        label: iso.slice(5),
        revenue: b ? b.netRevenueKhr : 0,
        costs: b ? b.cogsKhr + b.operatingExpensesKhr : 0,
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

      {/* 4-Column KPI Strip (reconciled with ReportsView Accrual P&L) */}
      <div className="bg-white border border-stone-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.revenueToday}</p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(todayReport.netRevenueKhr)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {todayReport.completedOrderCount} {t.dashboard.ordersCount} ·{' '}
            {formatUsdRef(todayReport.netRevenueKhr, settings.usdRate)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.revenuePeriod}</p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(periodReport.netRevenueKhr)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {periodReport.completedOrderCount} {t.dashboard.ordersCount} ·{' '}
            {formatUsdRef(periodReport.netRevenueKhr, settings.usdRate)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">
            {isVi ? 'COGS + Chi vận hành (7 ngày)' : 'COGS + OpEx (7 Days)'}
          </p>
          <p className="mt-2 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(periodReport.netCogsKhr + periodReport.operatingExpensesKhr)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            COGS {formatKhr(periodReport.netCogsKhr)} · OpEx{' '}
            {formatKhr(periodReport.operatingExpensesKhr)}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.dashboard.netProfitPeriod}</p>
          <p
            className={`mt-2 font-mono-num text-2xl font-semibold ${
              periodReport.netProfitKhr >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatKhr(periodReport.netProfitKhr)}
          </p>
          <p className="mt-1.5 text-xs text-stone-500 font-mono-num">
            {t.dashboard.margin}: {periodReport.netMarginPct}% ·{' '}
            {isVi ? 'Kho:' : 'Stock:'}{' '}
            {formatKhr(periodReport.inventoryValuation.totalInventoryValueKhr)}
          </p>
        </div>
      </div>

      {/* Main Analytics + 3-Tier Low Stock Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 7-Day Revenue vs P&L Cost Chart */}
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
                {isVi ? 'COGS + Vận hành' : 'COGS + OpEx'}
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
                  dataKey="costs"
                  name={isVi ? 'COGS + Vận hành' : 'COGS + OpEx'}
                  fill="#D9822B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Unified 3-Tier Low Stock Alerts Panel */}
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.dashboard.lowStockTitle}
              {lowStockList.length > 0 && (
                <span className="ml-2 font-mono-num text-xs font-semibold text-amber-700">
                  ({lowStockList.length})
                </span>
              )}
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
              {lowStockList.slice(0, 6).map((item) => {
                const isOut = item.stockQty <= 0;
                return (
                  <li key={item.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isOut ? 'text-red-600' : 'text-amber-600'
                          }`}
                        />
                        <p className="text-sm font-medium text-stone-900 truncate">{item.name}</p>
                      </div>
                      <p className="mt-0.5 text-xs text-stone-500 font-mono-num">
                        <span className="font-sans text-[11px] text-stone-400 mr-1.5">
                          {classificationLabel(item.classification)} ·
                        </span>
                        {formatQty(item.stockQty, item.unit)} / {t.inventory.reorderAt}:{' '}
                        {formatQty(item.reorderLevel, item.unit)}
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

      {/* Bottom Row: Recent Orders + Top Selling Items */}
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
                  {recentSales.map((sale) => {
                    const netKhr = sale.netTotalKhr ?? sale.totalKhr;
                    return (
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
                                  `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}${
                                    i.variantName ? ` (${i.variantName})` : ''
                                  }`
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
                              sale.status === 'voided' || sale.status === 'refunded'
                                ? 'line-through text-stone-400'
                                : 'font-semibold text-stone-900'
                            }
                          >
                            {formatKhr(sale.status === 'partially_returned' ? netKhr : sale.totalKhr)}
                          </span>
                          {sale.status === 'partially_returned' && (
                            <span className="block text-[11px] text-amber-700 font-sans">
                              {isVi ? 'Trả 1 phần' : 'Partial return'}
                            </span>
                          )}
                          {sale.status === 'refunded' && (
                            <span className="block text-[11px] text-amber-700 font-sans">
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
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-6">
          <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
            {t.dashboard.topDrinksTitle}
          </h2>

          {topProducts.length === 0 ? (
            <p className="text-sm text-stone-500 py-8 text-center">{t.common.noResults}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {topProducts.map((item, idx) => (
                <li key={item.productId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">
                      <span className="font-mono-num text-stone-400 mr-2">0{idx + 1}.</span>
                      {isVi ? item.nameVi || item.name : item.name}
                    </p>
                    <p className="text-xs text-stone-500 font-mono-num pl-7">
                      {item.netQty} {isVi ? 'đã bán' : 'sold'} · {item.marginPct}%
                    </p>
                  </div>
                  <span className="font-mono-num text-sm font-semibold text-stone-900 whitespace-nowrap shrink-0">
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
