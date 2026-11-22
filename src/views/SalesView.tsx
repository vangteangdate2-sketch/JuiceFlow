import React, { useMemo, useState } from 'react';
import { Check, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { PaymentMethod } from '../types';
import { calculateProductCogs, formatKhr, formatUsdRef, todayIso } from '../utils/format';
import { ProductPhoto } from '../components/ProductPhoto';

export const SalesView: React.FC = () => {
  const { settings, products, ingredients, sales, recordSale, voidSale, t } = useStore();
  const isVi = settings.language === 'vi';

  const [subTab, setSubTab] = useState<'pos' | 'ledger'>('pos');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [saleDate, setSaleDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Ledger filters
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);

  const activeProducts = useMemo(
    () =>
      products.filter(
        (p) => p.active && (categoryFilter === 'all' || p.category === categoryFilter)
      ),
    [products, categoryFilter]
  );

  const cartLines = useMemo(() => {
    const prodMap = new Map(products.map((p) => [p.id, p]));
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const product = prodMap.get(productId);
        if (!product) return null;
        const unitCogs = Math.round(calculateProductCogs(product, ingredients));
        return {
          product,
          quantity,
          lineTotal: product.priceKhr * quantity,
          lineCogs: unitCogs * quantity,
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
  }, [cart, products, ingredients]);

  const cartTotal = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines]);
  const cartCogs = useMemo(() => cartLines.reduce((s, l) => s + l.lineCogs, 0), [cartLines]);

  const addToCart = (productId: string) => {
    setCart((prev) => ({ ...prev, [productId]: (prev[productId] || 0) + 1 }));
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) => {
      const next = (prev[productId] || 0) + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartLines.length === 0) return;
    setSubmitting(true);
    try {
      await recordSale({
        items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        paymentMethod,
        customerName,
        note,
        saleDate,
      });
      setCart({});
      setCustomerName('');
      setNote('');
      setSaleDate(todayIso());
      setToastMessage(t.sales.saleRecorded);
      window.setTimeout(() => setToastMessage(''), 3500);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (paymentFilter !== 'all' && s.paymentMethod !== paymentFilter) return false;
      if (!q) return true;
      const itemsText = s.items.map((i) => `${i.productName} ${i.productNameVi}`).join(' ').toLowerCase();
      return (
        s.orderNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q) ||
        s.recordedBy.toLowerCase().includes(q) ||
        itemsText.includes(q)
      );
    });
  }, [sales, search, paymentFilter]);

  return (
    <div className="space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.sales.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.sales.subtitle}</p>
        </div>

        <div className="inline-flex items-center p-1 bg-stone-200/70 rounded-lg self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'pos'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {t.sales.tabPos}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ledger'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {t.sales.tabLedger} ({sales.length})
          </button>
        </div>
      </div>

      {toastMessage && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Check className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {subTab === 'pos' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Beverage Menu Grid */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'juice', 'smoothie', 'coffee', 'tea', 'specialty'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === cat
                      ? 'bg-[#0F5C43] text-white'
                      : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {cat === 'all' ? t.common.all : t.productCategories[cat]}
                </button>
              ))}
            </div>

            {activeProducts.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-sm text-stone-500">
                {t.common.noResults}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeProducts.map((product) => {
                  const qtyInCart = cart[product.id] || 0;
                  const cogs = Math.round(calculateProductCogs(product, ingredients));
                  const displayName = isVi ? product.nameVi || product.name : product.name;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product.id)}
                      className={`group text-left bg-white border rounded-xl overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] ${
                        qtyInCart > 0 ? 'border-[#0F5C43]' : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="relative">
                        <ProductPhoto
                          src={product.imageUrl}
                          alt={displayName}
                          className="w-full h-36"
                        />
                        {qtyInCart > 0 && (
                          <span className="absolute top-2.5 right-2.5 bg-[#0F5C43] text-white font-mono-num text-xs font-semibold px-2.5 py-1 rounded-md">
                            ×{qtyInCart}
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-xs text-stone-500">
                          {t.productCategories[product.category]} · {t.products.recipeCost}{' '}
                          <span className="font-mono-num">{formatKhr(cogs)}</span>
                        </p>
                        <h3 className="mt-1 font-display text-base font-semibold text-stone-900 truncate">
                          {displayName}
                        </h3>
                        <div className="mt-2 flex items-baseline justify-between gap-2">
                          <span className="font-mono-num text-base font-semibold text-[#0F5C43]">
                            {formatKhr(product.priceKhr)}
                          </span>
                          <span className="text-xs text-stone-400 font-mono-num">
                            {formatUsdRef(product.priceKhr, settings.usdRate)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Order Cart Panel */}
          <form
            onSubmit={handleCheckout}
            className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-5 space-y-5 lg:sticky lg:top-20"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#0F5C43]" />
                <h2 className="font-display text-base font-semibold text-stone-900">
                  {t.sales.cartTitle}
                </h2>
              </div>
              {cartLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart({})}
                  className="text-xs text-stone-500 hover:text-red-700 transition-colors"
                >
                  {t.common.cancel}
                </button>
              )}
            </div>

            {cartLines.length === 0 ? (
              <p className="py-10 text-center text-sm text-stone-500">{t.sales.emptyCart}</p>
            ) : (
              <ul className="divide-y divide-stone-100 max-h-72 overflow-y-auto pr-1">
                {cartLines.map(({ product, quantity, lineTotal }) => (
                  <li key={product.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        {isVi ? product.nameVi || product.name : product.name}
                      </p>
                      <p className="text-xs text-stone-500 font-mono-num">
                        {formatKhr(product.priceKhr)} × {quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center border border-stone-200 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateCartQty(product.id, -1)}
                          aria-label="Decrease quantity"
                          className="p-1.5 text-stone-600 hover:text-stone-900"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2 font-mono-num text-xs font-semibold text-stone-900">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(product.id, 1)}
                          aria-label="Increase quantity"
                          className="p-1.5 text-stone-600 hover:text-stone-900"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono-num text-xs font-semibold text-stone-900 w-20 text-right">
                        {formatKhr(lineTotal)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Payment & Order Metadata */}
            <div className="space-y-3 pt-3 border-t border-stone-200">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">
                  {t.common.payment}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPaymentMethod(pm)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                        paymentMethod === pm
                          ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                          : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                      }`}
                    >
                      {t.paymentMethods[pm]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    {t.common.operator}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={settings.activeOperator}
                    className="w-full px-3 py-2 text-xs border border-stone-200 rounded-lg bg-stone-50 text-stone-700"
                  />
                </div>
              </div>

              <input
                type="text"
                maxLength={80}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder={t.sales.customerPlaceholder}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />

              <input
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.sales.notePlaceholder}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />
            </div>

            {/* Order Totals */}
            <div className="pt-3 border-t border-stone-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-stone-500">
                <span>{t.sales.estimatedCogs}</span>
                <span className="font-mono-num">{formatKhr(cartCogs)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-medium">
                <span>{t.sales.estProfit}</span>
                <span className="font-mono-num">{formatKhr(cartTotal - cartCogs)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-2 border-t border-stone-100">
                <span className="text-sm font-semibold text-stone-900">{t.common.total}</span>
                <div className="text-right">
                  <span className="font-mono-num text-xl font-bold text-stone-900">
                    {formatKhr(cartTotal)}
                  </span>
                  <span className="block font-mono-num text-xs text-stone-400">
                    {formatUsdRef(cartTotal, settings.usdRate)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={cartLines.length === 0 || submitting}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
            >
              {t.sales.completeSale}
            </button>
            <p className="text-[11px] text-stone-500 text-center">
              {t.sales.ingredientsAutoDeducted}
            </p>
          </form>
        </div>
      ) : (
        /* Sales Ledger Tab */
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.sales.searchOrders}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'cash', 'khqr', 'aba', 'wing'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPaymentFilter(pm)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    paymentFilter === pm
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {pm === 'all' ? t.common.all : t.paymentMethods[pm]}
                </button>
              ))}
            </div>
          </div>

          {filteredSales.length === 0 ? (
            <p className="p-10 text-center text-sm text-stone-500">{t.common.noResults}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                    <th className="py-3 px-5 font-medium">Order / {t.common.date}</th>
                    <th className="py-3 px-4 font-medium">{t.sales.itemsSummary}</th>
                    <th className="py-3 px-4 font-medium">{t.common.payment}</th>
                    <th className="py-3 px-4 font-medium">{t.common.operator}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.sales.cogs}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.common.total}</th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {filteredSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <p className="font-mono-num font-semibold text-stone-900">
                          {sale.orderNumber}
                        </p>
                        <p className="text-xs text-stone-500 font-mono-num">
                          {sale.saleDate} ·{' '}
                          <span
                            className={
                              sale.status === 'voided' ? 'text-red-700 font-medium' : 'text-emerald-700'
                            }
                          >
                            {sale.status === 'voided' ? t.sales.voided : t.sales.completed}
                          </span>
                        </p>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-stone-900">
                          {sale.items
                            .map(
                              (i) =>
                                `${i.quantity}× ${isVi ? i.productNameVi || i.productName : i.productName}`
                            )
                            .join(', ')}
                        </p>
                        {(sale.customerName || sale.note) && (
                          <p className="text-xs text-stone-500 truncate mt-0.5">
                            {[sale.customerName, sale.note].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-stone-600 whitespace-nowrap">
                        {t.paymentMethods[sale.paymentMethod]}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-stone-600 whitespace-nowrap">
                        {sale.recordedBy}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-600 whitespace-nowrap">
                        {formatKhr(sale.cogsKhr)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-num whitespace-nowrap">
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
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        {sale.status === 'completed' ? (
                          confirmVoidId === sale.id ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  await voidSale(sale.id);
                                  setConfirmVoidId(null);
                                }}
                                className="text-xs font-semibold text-red-700 hover:underline"
                              >
                                {t.sales.voidOrder}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmVoidId(null)}
                                className="text-xs text-stone-500 hover:text-stone-800"
                              >
                                {t.common.cancel}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmVoidId(sale.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              {t.sales.voidOrder}
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
