import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Expense, ExpenseCategory, ExpenseScope, PaymentMethod } from '../types';
import { formatKhr, formatUsdRef, todayIso } from '../utils/format';
import { isLegacyInventoryPurchaseExpense } from '../utils/inventoryEngine';
import { InfoHint } from '../components/InfoHint';

const ALL_CATEGORIES: ExpenseCategory[] = [
  'utilities',
  'rent',
  'packaging',
  'equipment',
  'transport',
  'ingredients',
  'household',
  'travel',
  'other',
];

interface ExpensesViewProps {
  autoOpenAdd?: boolean;
  onAutoOpenHandled?: () => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  autoOpenAdd,
  onAutoOpenHandled,
}) => {
  const { settings, expenses, purchases, saveExpense, deleteExpense, t } = useStore();
  const isVi = settings.language === 'vi';

  const [scopeFilter, setScopeFilter] = useState<'all' | ExpenseScope>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ExpenseScope>('business');
  const [category, setCategory] = useState<ExpenseCategory>('utilities');
  const [amountKhr, setAmountKhr] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [vendor, setVendor] = useState('');
  const [note, setNote] = useState('');

  const totals = useMemo(() => {
    const operating = expenses
      .filter((e) => e.scope === 'business' && !isLegacyInventoryPurchaseExpense(e))
      .reduce((sum, e) => sum + e.amountKhr, 0);
    const legacyStockPurchases = expenses
      .filter((e) => e.scope === 'business' && isLegacyInventoryPurchaseExpense(e))
      .reduce((sum, e) => sum + e.amountKhr, 0);
    const stockPurchasesTotal =
      legacyStockPurchases + purchases.reduce((sum, p) => sum + p.totalCostKhr, 0);
    const household = expenses
      .filter((e) => e.scope === 'household')
      .reduce((sum, e) => sum + e.amountKhr, 0);
    return { operating, stockPurchasesTotal, household };
  }, [expenses, purchases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter((e) => {
      if (scopeFilter !== 'all' && e.scope !== scopeFilter) return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.vendor.toLowerCase().includes(q) ||
        e.note.toLowerCase().includes(q) ||
        e.recordedBy.toLowerCase().includes(q)
      );
    });
  }, [expenses, scopeFilter, categoryFilter, search]);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setScope(scopeFilter === 'household' ? 'household' : 'business');
    setCategory(scopeFilter === 'household' ? 'household' : 'utilities');
    setAmountKhr('');
    setExpenseDate(todayIso());
    setPaymentMethod('cash');
    setVendor('');
    setNote('');
    setModalOpen(true);
  };

  useEffect(() => {
    if (!autoOpenAdd) return;
    setEditing(null);
    setTitle('');
    setScope('business');
    setCategory('utilities');
    setAmountKhr('');
    setExpenseDate(todayIso());
    setPaymentMethod('cash');
    setVendor('');
    setNote('');
    setModalOpen(true);
    onAutoOpenHandled?.();
  }, [autoOpenAdd, onAutoOpenHandled]);

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setTitle(exp.title);
    setScope(exp.scope);
    setCategory(exp.category);
    setAmountKhr(String(exp.amountKhr));
    setExpenseDate(exp.expenseDate);
    setPaymentMethod(exp.paymentMethod);
    setVendor(exp.vendor);
    setNote(exp.note);
    setModalOpen(true);
  };

  const handleScopeChange = (nextScope: ExpenseScope) => {
    setScope(nextScope);
    if (nextScope === 'household' && category !== 'household' && category !== 'travel') {
      setCategory('household');
    } else if (nextScope === 'business' && (category === 'household' || category === 'travel')) {
      setCategory('utilities');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await saveExpense({
      id: editing?.id,
      title: title.trim(),
      scope,
      category,
      isInventoryPurchase: scope === 'business' && category === 'ingredients',
      amountKhr: Math.max(0, Number(amountKhr) || 0),
      expenseDate,
      paymentMethod,
      vendor: vendor.trim(),
      note: note.trim(),
      linkedIngredientId: editing?.linkedIngredientId || '',
      recordedBy: editing?.recordedBy || settings.activeOperator,
    });
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
            {t.expenses.title}
          </h1>
          <InfoHint
            label={isVi ? 'Thông tin quản lý chi phí' : 'About Expenses'}
            text={
              isVi
                ? `${t.expenses.subtitle} Ghi nhận chi phí vận hành (điện, thuê mặt bằng, vận chuyển, gia đình) tại đây; nhập hàng tồn kho ở mục Kho hàng để tránh tính trùng với giá vốn (COGS).`
                : `${t.expenses.subtitle} Record operating costs (rent, utilities, transport, household) here; log stock & ingredient restocks in Inventory so quantities update automatically without double-counting COGS.`
            }
          />
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {t.expenses.addExpense}
        </button>
      </div>

      {/* 3-Column Summary Strip */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200 dark:divide-[#24352C]">
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Chi phí vận hành (P&L)' : 'Operating Expenses (P&L)'}
            </p>
            <InfoHint
              compact
              label={isVi ? 'Chi phí vận hành (P&L)' : 'Operating Expenses (P&L)'}
              text={
                isVi
                  ? 'Chi phí kinh doanh thường kỳ (thuê mặt bằng, điện nước, bao bì, vận chuyển) — được trừ trực tiếp vào Báo cáo Lãi/Lỗ.'
                  : 'Recurring shop overhead (rent, utilities, packaging, transport) deducted directly on the Accrual P&L.'
              }
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(totals.operating)}
          </p>
          <p className="mt-1 text-xs text-stone-400 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(totals.operating, settings.usdRate)}
          </p>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {isVi ? 'Nhập kho (Chỉ tính dòng tiền)' : 'Inventory Purchases (Cash Flow Only)'}
            </p>
            <InfoHint
              compact
              label={
                isVi ? 'Nhập kho (Chỉ tính dòng tiền)' : 'Inventory Purchases (Cash Flow Only)'
              }
              text={
                isVi
                  ? 'Tiền chi mua hàng tồn kho & nguyên liệu. Tính vào Dòng tiền chi ra nhưng KHÔNG cộng vào Chi phí vận hành để tránh tính trùng với giá vốn (COGS).'
                  : 'Cash spent restocking packaged goods and raw ingredients. Tracked in Cash Flow only so it never double-counts against COGS.'
              }
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(totals.stockPurchasesTotal)}
          </p>
          <p className="mt-1 text-xs text-stone-400 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(totals.stockPurchasesTotal, settings.usdRate)}
          </p>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-1">
            <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
              {t.expenses.householdTotal}
            </p>
            <InfoHint
              compact
              label={t.expenses.householdTotal}
              text={
                isVi
                  ? 'Chi tiêu cá nhân / gia đình được tách riêng hoàn toàn khỏi lợi nhuận kinh doanh của quán.'
                  : 'Personal and family spending tracked separately so it never distorts shop profitability.'
              }
            />
          </div>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900 dark:text-[#F1F5F3]">
            {formatKhr(totals.household)}
          </p>
          <p className="mt-1 text-xs text-stone-400 dark:text-[#94A39B] font-mono-num">
            {formatUsdRef(totals.household, settings.usdRate)}
          </p>
        </div>
      </div>

      {/* Filters & Table */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-[#24352C] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] rounded-lg self-start">
            {(['all', 'business', 'household'] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setScopeFilter(sc)}
                className={`h-9 px-3.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  scopeFilter === sc
                    ? 'bg-white dark:bg-[#064E3B] text-stone-900 dark:text-[#D1FAE5] shadow-xs'
                    : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                }`}
              >
                {sc === 'all'
                  ? t.expenses.scopeAll
                  : sc === 'business'
                    ? t.expenses.scopeBusiness
                    : t.expenses.scopeHousehold}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExpenseCategory)}
              className="h-11 px-3 text-xs border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3]"
            >
              <option value="all">{t.common.all}</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.expenseCategories[c]}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.common.search}
                className="w-full sm:w-56 h-11 pl-9 pr-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]/70 border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-stone-500 dark:text-[#94A39B]">
            {t.expenses.emptyExpenses}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 dark:border-[#24352C] text-xs text-stone-500 dark:text-[#94A39B] bg-stone-50/70 dark:bg-[#18251F]/80">
                  <th className="py-3 px-5 font-medium">{t.common.date}</th>
                  <th className="py-3 px-4 font-medium">{t.expenses.titleLabel}</th>
                  <th className="py-3 px-4 font-medium">{t.expenses.categoryLabel}</th>
                  <th className="py-3 px-4 font-medium">{t.common.payment}</th>
                  <th className="py-3 px-4 font-medium">{t.common.operator}</th>
                  <th className="py-3 px-4 font-medium text-right">{t.common.amountKhr}</th>
                  <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-[#1F3028] text-sm">
                {filtered.map((exp) => {
                  const isInvPurchase = isLegacyInventoryPurchaseExpense(exp);
                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70 transition-colors"
                    >
                      <td className="py-3.5 px-5 font-mono-num text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                        {exp.expenseDate}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">{exp.title}</p>
                        <p className="text-xs text-stone-500 dark:text-[#94A39B] truncate mt-0.5">
                          {[
                            exp.vendor,
                            exp.note,
                            isInvPurchase
                              ? isVi
                                ? 'Nhập kho (chỉ tính dòng tiền)'
                                : 'Inventory purchase (cash flow only)'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                        <span className="text-stone-800 dark:text-[#F1F5F3]">
                          {t.expenseCategories[exp.category]}
                        </span>
                        <span className="text-stone-400 dark:text-[#94A39B]"> · </span>
                        <span
                          className={
                            exp.scope === 'household'
                              ? 'text-amber-700 dark:text-amber-300 font-medium'
                              : isInvPurchase
                                ? 'text-emerald-700 dark:text-[#34D399] font-medium'
                                : 'text-stone-500 dark:text-[#94A39B]'
                          }
                        >
                          {exp.scope === 'household'
                            ? t.expenses.scopeHousehold
                            : isInvPurchase
                              ? isVi
                                ? 'Nhập kho'
                                : 'Stock Purchase'
                              : t.expenses.scopeBusiness}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                        {t.paymentMethods[exp.paymentMethod]}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                        {exp.recordedBy}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 dark:text-[#F1F5F3] whitespace-nowrap">
                        {formatKhr(exp.amountKhr)}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(exp)}
                            className="p-1.5 text-stone-400 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]"
                            aria-label={t.common.edit}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {confirmDeleteId === exp.id ? (
                            <span className="inline-flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteExpense(exp.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="font-semibold text-red-700 dark:text-[#F87171] hover:underline"
                              >
                                {t.common.delete}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-stone-500 dark:text-[#94A39B]"
                              >
                                {t.common.cancel}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(exp.id)}
                              className="p-1.5 text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171]"
                              aria-label={t.common.delete}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {editing ? t.expenses.editExpense : t.expenses.addExpense}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-9 h-9 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-x-1 mb-1.5">
                  <label className="text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
                    {t.expenses.scopeLabel}
                  </label>
                  <InfoHint
                    compact
                    label={t.expenses.scopeLabel}
                    text={
                      isVi
                        ? 'Chọn "Kinh doanh" cho chi phí cửa hàng (tính vào Báo cáo Tài chính) hoặc "Gia đình" để tách riêng chi tiêu cá nhân.'
                        : 'Choose "Business" for shop costs included in Financial Reports, or "Household" to keep personal spending separate.'
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('business')}
                    className={`h-11 text-xs font-semibold rounded-lg border transition-colors ${
                      scope === 'business'
                        ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43] dark:border-[#10B981]/50 dark:bg-[#064E3B] dark:text-[#6EE7B7]'
                        : 'border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA] dark:bg-[#18251F] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                    }`}
                  >
                    {t.expenses.scopeBusiness}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('household')}
                    className={`h-11 text-xs font-semibold rounded-lg border transition-colors ${
                      scope === 'household'
                        ? 'border-amber-700 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-950/50 dark:text-amber-300'
                        : 'border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA] dark:bg-[#18251F] hover:bg-stone-50 dark:hover:bg-[#1F3028]'
                    }`}
                  >
                    {t.expenses.scopeHousehold}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                  {t.expenses.titleLabel}
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                    {t.common.amountKhr}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={500}
                    value={amountKhr}
                    onChange={(e) => setAmountKhr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-x-1 mb-1">
                    <label className="text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
                      {t.expenses.categoryLabel}
                    </label>
                    <InfoHint
                      compact
                      label={t.expenses.categoryLabel}
                      text={
                        isVi
                          ? 'Danh mục "Nguyên liệu" được tính là Nhập kho (chỉ tính dòng tiền). Các danh mục vận hành khác được trừ trực tiếp vào Lãi/Lỗ.'
                          : '"Ingredients" is classified as an inventory purchase (Cash Flow only). Other business categories flow into Operating Expenses on P&L.'
                      }
                    />
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  >
                    {ALL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t.expenseCategories[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                    {t.common.payment}
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                  >
                    {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => (
                      <option key={pm} value={pm}>
                        {t.paymentMethods[pm]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                  {t.expenses.vendorLabel}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 dark:border-[#24352C] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-11 px-4 text-sm text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg"
                >
                  {t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
