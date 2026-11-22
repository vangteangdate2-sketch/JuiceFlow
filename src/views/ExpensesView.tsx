import React, { useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Expense, ExpenseCategory, ExpenseScope, PaymentMethod } from '../types';
import { formatKhr, formatUsdRef, todayIso } from '../utils/format';

const ALL_CATEGORIES: ExpenseCategory[] = [
  'ingredients',
  'packaging',
  'utilities',
  'rent',
  'equipment',
  'transport',
  'household',
  'travel',
  'other',
];

export const ExpensesView: React.FC = () => {
  const { settings, expenses, saveExpense, deleteExpense, t } = useStore();

  const [scopeFilter, setScopeFilter] = useState<'all' | ExpenseScope>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Add / Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ExpenseScope>('business');
  const [category, setCategory] = useState<ExpenseCategory>('ingredients');
  const [amountKhr, setAmountKhr] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [vendor, setVendor] = useState('');
  const [note, setNote] = useState('');

  const totals = useMemo(() => {
    const biz = expenses
      .filter((e) => e.scope === 'business')
      .reduce((sum, e) => sum + e.amountKhr, 0);
    const household = expenses
      .filter((e) => e.scope === 'household')
      .reduce((sum, e) => sum + e.amountKhr, 0);
    return { biz, household, combined: biz + household };
  }, [expenses]);

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
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.expenses.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.expenses.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {t.expenses.addExpense}
        </button>
      </div>

      {/* 3-Column Summary Strip */}
      <div className="bg-white border border-stone-200 rounded-xl grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.expenses.businessTotal}</p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(totals.biz)}
          </p>
          <p className="mt-1 text-xs text-stone-400 font-mono-num">
            {formatUsdRef(totals.biz, settings.usdRate)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.expenses.householdTotal}</p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(totals.household)}
          </p>
          <p className="mt-1 text-xs text-stone-400 font-mono-num">
            {formatUsdRef(totals.household, settings.usdRate)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.expenses.combinedTotal}</p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(totals.combined)}
          </p>
          <p className="mt-1 text-xs text-stone-400 font-mono-num">
            {formatUsdRef(totals.combined, settings.usdRate)}
          </p>
        </div>
      </div>

      {/* Filters & Table */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 bg-stone-100 rounded-lg self-start">
            {(['all', 'business', 'household'] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setScopeFilter(sc)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  scopeFilter === sc
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
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
              className="px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white text-stone-700"
            >
              <option value="all">{t.common.all}</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.expenseCategories[c]}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.common.search}
                className="w-full sm:w-56 pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-stone-500">{t.expenses.emptyExpenses}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                  <th className="py-3 px-5 font-medium">{t.common.date}</th>
                  <th className="py-3 px-4 font-medium">{t.expenses.titleLabel}</th>
                  <th className="py-3 px-4 font-medium">{t.expenses.categoryLabel}</th>
                  <th className="py-3 px-4 font-medium">{t.common.payment}</th>
                  <th className="py-3 px-4 font-medium">{t.common.operator}</th>
                  <th className="py-3 px-4 font-medium text-right">{t.common.amountKhr}</th>
                  <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-sm">
                {filtered.map((exp) => (
                  <tr key={exp.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3.5 px-5 font-mono-num text-xs text-stone-600 whitespace-nowrap">
                      {exp.expenseDate}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="font-medium text-stone-900">{exp.title}</p>
                      <p className="text-xs text-stone-500 truncate mt-0.5">
                        {[
                          exp.vendor,
                          exp.note,
                          exp.linkedIngredientId ? t.expenses.linkedPurchase : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                      <span className="text-stone-800">{t.expenseCategories[exp.category]}</span>
                      <span className="text-stone-400"> · </span>
                      <span
                        className={
                          exp.scope === 'household' ? 'text-amber-700 font-medium' : 'text-stone-500'
                        }
                      >
                        {exp.scope === 'household'
                          ? t.expenses.scopeHousehold
                          : t.expenses.scopeBusiness}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-stone-600 whitespace-nowrap">
                      {t.paymentMethods[exp.paymentMethod]}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-stone-600 whitespace-nowrap">
                      {exp.recordedBy}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 whitespace-nowrap">
                      {formatKhr(exp.amountKhr)}
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(exp)}
                          className="p-1 text-stone-400 hover:text-stone-900"
                          aria-label={t.common.edit}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteId === exp.id ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteExpense(exp.id);
                                setConfirmDeleteId(null);
                              }}
                              className="font-semibold text-red-700 hover:underline"
                            >
                              {t.common.delete}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-stone-500"
                            >
                              {t.common.cancel}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(exp.id)}
                            className="p-1 text-stone-400 hover:text-red-700"
                            aria-label={t.common.delete}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {editing ? t.expenses.editExpense : t.expenses.addExpense}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  {t.expenses.scopeLabel}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('business')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      scope === 'business'
                        ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                        : 'border-stone-200 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {t.expenses.scopeBusiness}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('household')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      scope === 'household'
                        ? 'border-amber-700 bg-amber-50 text-amber-800'
                        : 'border-stone-200 text-stone-700 hover:bg-stone-50'
                    }`}
                  >
                    {t.expenses.scopeHousehold}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.expenses.titleLabel}
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.common.amountKhr}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={500}
                    value={amountKhr}
                    onChange={(e) => setAmountKhr(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.expenses.categoryLabel}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white"
                  >
                    {ALL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t.expenseCategories[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.common.payment}
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white"
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
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.expenses.vendorLabel}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.common.note}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 rounded-lg"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg"
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
