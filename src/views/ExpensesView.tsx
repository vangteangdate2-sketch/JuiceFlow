import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Edit2,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useUndoToast } from '../context/UndoToastContext';
import type { Expense, ExpenseCategory, ExpenseScope, PaymentMethod } from '../types';
import { formatKhr, formatUsdRef, todayIso } from '../utils/format';
import { isLegacyInventoryPurchaseExpense } from '../utils/inventoryEngine';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { InfoHint } from '../components/InfoHint';
import { ModalPortal } from '../components/ModalPortal';

const ALL_CATEGORIES: ExpenseCategory[] = [
  'ingredients',
  'packaging',
  'utilities',
  'equipment',
  'rent',
  'transport',
  'household',
  'travel',
  'other',
];

const BUSINESS_CATEGORY_PILLS: { id: ExpenseCategory; labelEn: string; labelVi: string }[] = [
  { id: 'packaging', labelEn: 'Packaging', labelVi: 'Bao bì' },
  { id: 'utilities', labelEn: 'Utilities', labelVi: 'Điện nước' },
  { id: 'equipment', labelEn: 'Equipment', labelVi: 'Thiết bị' },
  { id: 'rent', labelEn: 'Rent & Staff', labelVi: 'Mặt bằng & NV' },
  { id: 'transport', labelEn: 'Transport', labelVi: 'Vận chuyển' },
  { id: 'other', labelEn: 'Other', labelVi: 'Khác' },
];

const HOUSEHOLD_CATEGORY_PILLS: { id: ExpenseCategory; labelEn: string; labelVi: string }[] = [
  { id: 'household', labelEn: 'Household', labelVi: 'Gia đình' },
  { id: 'travel', labelEn: 'Travel', labelVi: 'Đi lại' },
  { id: 'other', labelEn: 'Other', labelVi: 'Khác' },
];

interface QuickRepeatPreset {
  key: string;
  title: string;
  scope: ExpenseScope;
  category: ExpenseCategory;
  amountKhr: number;
  paymentMethod: PaymentMethod;
  vendor: string;
  count: number;
}

interface ExpensesViewProps {
  autoOpenAdd?: boolean;
  onAutoOpenHandled?: () => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  autoOpenAdd = false,
  onAutoOpenHandled,
}) => {
  const { settings, expenses, purchases, saveExpense, deleteExpense, t } = useStore();
  const isVi = settings.language === 'vi';
  const usdRate = settings.usdRate > 0 ? settings.usdRate : 4000;

  const [scopeFilter, setScopeFilter] = useState<'all' | ExpenseScope>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [search, setSearch] = useState('');

  // Compact inline Add / Edit Expense form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ExpenseScope>('business');
  const [category, setCategory] = useState<ExpenseCategory>('packaging');
  const [currency, setCurrency] = useState<'KHR' | 'USD'>('KHR');
  const [amountInput, setAmountInput] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [vendor, setVendor] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { showUndoToast, showNoticeToast } = useUndoToast();
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const triggerHighlightExpense = (id: string) => {
    setHighlightedExpenseId(id);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedExpenseId((prev) => (prev === id ? null : prev));
      highlightTimerRef.current = null;
    }, 2800);
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setFormOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [formOpen]);

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

  const scopeCounts = useMemo(() => {
    let business = 0;
    let household = 0;
    for (const e of expenses) {
      if (e.scope === 'household') household += 1;
      else business += 1;
    }
    return { all: expenses.length, business, household };
  }, [expenses]);

  // 4-5 most frequent past expenses for the "Quick Repeat Recent" horizontal strip
  const quickRepeatItems = useMemo<QuickRepeatPreset[]>(() => {
    const grouped = new Map<
      string,
      {
        title: string;
        scope: ExpenseScope;
        category: ExpenseCategory;
        amounts: number[];
        paymentMethod: PaymentMethod;
        vendor: string;
        count: number;
        latestDate: string;
      }
    >();

    for (const e of expenses) {
      const norm = e.title.trim().toLowerCase();
      if (!norm) continue;
      const existing = grouped.get(norm);
      if (!existing) {
        grouped.set(norm, {
          title: e.title.trim(),
          scope: e.scope,
          category: e.category,
          amounts: [e.amountKhr],
          paymentMethod: e.paymentMethod,
          vendor: e.vendor,
          count: 1,
          latestDate: e.expenseDate,
        });
      } else {
        existing.count += 1;
        existing.amounts.push(e.amountKhr);
        if (e.expenseDate >= existing.latestDate) {
          existing.latestDate = e.expenseDate;
          existing.category = e.category;
          existing.scope = e.scope;
          existing.paymentMethod = e.paymentMethod;
          existing.vendor = e.vendor || existing.vendor;
        }
      }
    }

    return Array.from(grouped.entries())
      .map(([key, g]) => {
        const sortedAmts = [...g.amounts].sort((a, b) => a - b);
        const typicalAmount = sortedAmts[Math.floor(sortedAmts.length / 2)] || 0;
        return {
          key,
          title: g.title,
          scope: g.scope,
          category: g.category === 'ingredients' ? 'other' : g.category,
          amountKhr: typicalAmount,
          paymentMethod: g.paymentMethod,
          vendor: g.vendor,
          count: g.count,
          latestDate: g.latestDate,
        };
      })
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.latestDate.localeCompare(a.latestDate);
      })
      .slice(0, 5);
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

  const computedAmountKhr = useMemo(() => {
    const num = Number(amountInput);
    if (!Number.isFinite(num) || num < 0) return 0;
    return currency === 'USD' ? Math.round(num * usdRate) : Math.round(num);
  }, [amountInput, currency, usdRate]);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    const nextScope: ExpenseScope = scopeFilter === 'household' ? 'household' : 'business';
    setScope(nextScope);
    setCategory(nextScope === 'household' ? 'household' : 'packaging');
    setCurrency('KHR');
    setAmountInput('');
    setExpenseDate(todayIso());
    setPaymentMethod('cash');
    setVendor('');
    setNote('');
    setFormOpen(true);
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  useEffect(() => {
    if (!autoOpenAdd) return;
    setEditing(null);
    setTitle('');
    setScope('business');
    setCategory('packaging');
    setCurrency('KHR');
    setAmountInput('');
    setExpenseDate(todayIso());
    setPaymentMethod('cash');
    setVendor('');
    setNote('');
    setFormOpen(true);
    onAutoOpenHandled?.();
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [autoOpenAdd, onAutoOpenHandled]);

  const applyQuickRepeat = (preset: QuickRepeatPreset) => {
    setEditing(null);
    setTitle(preset.title);
    setScope(preset.scope);
    setCategory(preset.category);
    setCurrency('KHR');
    setAmountInput(preset.amountKhr > 0 ? String(preset.amountKhr) : '');
    setExpenseDate(todayIso());
    setPaymentMethod(preset.paymentMethod);
    setVendor(preset.vendor);
    setNote('');
    setFormOpen(true);
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setTitle(exp.title);
    setScope(exp.scope);
    setCategory(exp.category);
    setCurrency('KHR');
    setAmountInput(String(exp.amountKhr));
    setExpenseDate(exp.expenseDate);
    setPaymentMethod(exp.paymentMethod);
    setVendor(exp.vendor);
    setNote(exp.note);
    setFormOpen(true);
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  const handleScopeChange = (nextScope: ExpenseScope) => {
    setScope(nextScope);
    if (nextScope === 'household' && category !== 'household' && category !== 'travel' && category !== 'other') {
      setCategory('household');
    } else if (nextScope === 'business' && (category === 'household' || category === 'travel')) {
      setCategory('utilities');
    }
  };

  const handleToggleCurrency = (nextCurrency: 'KHR' | 'USD') => {
    if (nextCurrency === currency) return;
    const raw = Number(amountInput);
    if (Number.isFinite(raw) && raw > 0) {
      if (nextCurrency === 'USD') {
        setAmountInput((raw / usdRate).toFixed(2));
      } else {
        setAmountInput(String(Math.round(raw * usdRate)));
      }
    }
    setCurrency(nextCurrency);
  };

  const submitExpense = async (mode: 'close' | 'add_another' = 'close') => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || saving) return;
    setSaving(true);
    try {
      const amountToSave = Math.max(0, computedAmountKhr);
      const savedId = await saveExpense({
        id: editing?.id,
        title: trimmedTitle,
        scope,
        category,
        isInventoryPurchase: editing ? editing.isInventoryPurchase : false,
        amountKhr: amountToSave,
        expenseDate,
        paymentMethod,
        vendor: vendor.trim(),
        note: note.trim(),
        linkedIngredientId: editing?.linkedIngredientId || '',
        recordedBy: editing?.recordedBy || settings.activeOperator,
      });
      triggerHighlightExpense(savedId);

      if (mode === 'add_another' && !editing) {
        showNoticeToast({
          message: isVi ? `Đã lưu "${trimmedTitle}"` : `Saved "${trimmedTitle}"`,
          detail: `${formatKhr(amountToSave)} · ${
            isVi ? 'Sẵn sàng ghi chi phí tiếp theo' : 'Ready for next expense'
          }`,
        });
        // Reset per-entry fields while retaining smart defaults (scope, category, currency, paymentMethod, expenseDate)
        setTitle('');
        setAmountInput('');
        setVendor('');
        setNote('');
        window.requestAnimationFrame(() => titleInputRef.current?.focus());
        return;
      }

      setEditing(null);
      setTitle('');
      setAmountInput('');
      setVendor('');
      setNote('');
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitExpense('close');
  };

  const handleDeleteWithUndo = async (exp: Expense) => {
    if (editing?.id === exp.id) {
      setEditing(null);
      setFormOpen(false);
    }
    await deleteExpense(exp.id);

    showUndoToast({
      message: isVi ? `Đã xóa "${exp.title}"` : `Deleted "${exp.title}"`,
      detail: formatKhr(exp.amountKhr),
      onUndo: async () => {
        await saveExpense({
          id: exp.id,
          title: exp.title,
          scope: exp.scope,
          category: exp.category,
          isInventoryPurchase: exp.isInventoryPurchase,
          amountKhr: exp.amountKhr,
          expenseDate: exp.expenseDate,
          paymentMethod: exp.paymentMethod,
          vendor: exp.vendor,
          note: exp.note,
          linkedIngredientId: exp.linkedIngredientId,
          recordedBy: exp.recordedBy,
        });
      },
    });
  };

  const activeCategoryPills =
    scope === 'household' ? HOUSEHOLD_CATEGORY_PILLS : BUSINESS_CATEGORY_PILLS;

  return (
    <div className="space-y-6">
      {/* Page Header */}
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
            {formatUsdRef(totals.operating, usdRate)}
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
            {formatUsdRef(totals.stockPurchasesTotal, usdRate)}
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
            {formatUsdRef(totals.household, usdRate)}
          </p>
        </div>
      </div>

      {/* ================================================================== */}
      {/* STICKY SCOPE, SEARCH, CATEGORY & PRIMARY CTA TOOLBAR               */}
      {/* ================================================================== */}
      <div className="sticky top-16 z-20 bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-md border border-stone-200 dark:border-[#24352C] rounded-xl p-4 space-y-3 shadow-xs">
        {/* Row 1: Segmented Scope Tabs with Counts */}
        <div className="overflow-x-auto pb-0.5 -mx-1 px-1">
          <div
            role="tablist"
            aria-label={t.expenses.scopeLabel}
            className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl"
          >
            {(
              [
                { id: 'all', label: t.expenses.scopeAll, count: scopeCounts.all },
                { id: 'business', label: t.expenses.scopeBusiness, count: scopeCounts.business },
                {
                  id: 'household',
                  label: t.expenses.scopeHousehold,
                  count: scopeCounts.household,
                },
              ] as const
            ).map((tab) => {
              const active = scopeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScopeFilter(tab.id)}
                  className={`h-11 px-3.5 inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono-num text-[11px] font-bold ${
                      active ? 'opacity-80' : 'text-stone-400 dark:text-[#94A39B]'
                    }`}
                  >
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Search Bar + Labeled Category Filter + Sticky + Log Expense CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                isVi ? 'Tìm mô tả, nhà cung cấp, ghi chú...' : 'Search description, vendor, note...'
              }
              className="w-full h-11 pl-10 pr-9 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="w-9 h-9 inline-flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-[#F1F5F3] absolute right-1 top-1/2 -translate-y-1/2 rounded-md"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label
              htmlFor="expenses-category-filter"
              className="text-xs font-medium text-stone-500 dark:text-[#94A39B] whitespace-nowrap"
            >
              {t.expenses.categoryLabel}:
            </label>
            <select
              id="expenses-category-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExpenseCategory)}
              className="h-11 px-3.5 text-sm font-medium border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
            >
              <option value="all">{t.common.all}</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.expenseCategories[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center justify-center h-11 px-4 text-xs sm:text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {`+ ${t.expenses.addExpense}`}
            </button>
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* EXPENSES TABLE                                                     */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">

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
                  const isHighlighted = highlightedExpenseId === exp.id;
                  return (
                    <tr
                      key={exp.id}
                      className={`transition-colors ${
                        isHighlighted
                          ? 'bg-emerald-50/90 dark:bg-[#064E3B]/45 ring-2 ring-inset ring-[#10B981]/60'
                          : 'hover:bg-stone-50/60 dark:hover:bg-[#18251F]/70'
                      }`}
                    >
                      <td className="py-3.5 px-5 font-mono-num text-xs text-stone-600 dark:text-[#94A39B] whitespace-nowrap">
                        {exp.expenseDate}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="font-medium text-stone-900 dark:text-[#F1F5F3]">
                          {exp.title}
                        </p>
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
                      <td className="py-3.5 px-4 text-right font-mono-num whitespace-nowrap">
                        <span className="font-semibold text-stone-900 dark:text-[#F1F5F3] block">
                          {formatKhr(exp.amountKhr)}
                        </span>
                        <span className="text-[11px] text-stone-400 dark:text-[#94A39B]">
                          {formatUsdRef(exp.amountKhr, usdRate)}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(exp)}
                            className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                            aria-label={t.common.edit}
                            title={t.common.edit}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteWithUndo(exp)}
                            className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            aria-label={t.common.delete}
                            title={t.common.delete}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {/* ================================================================== */}
      {/* FOCUSED ADD / EDIT EXPENSE MODAL (Preserves Underlying Scroll)     */}
      {/* ================================================================== */}
      {formOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setEditing(null);
                setFormOpen(false);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="expense-modal-title"
              className="w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl animate-modal"
            >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-stone-200 dark:border-[#24352C] flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2
                  id="expense-modal-title"
                  className="font-display text-lg font-bold text-stone-900 dark:text-[#F1F5F3] truncate"
                >
                  {editing ? t.expenses.editExpense : t.expenses.addExpense}
                </h2>
                {editing && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-500/40 shrink-0">
                    {isVi ? 'Đang chỉnh sửa' : 'Editing'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Compact Scope Switch */}
                <div className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('business')}
                    className={`h-9 px-3 text-xs font-semibold rounded-lg transition-all duration-200 ease-out whitespace-nowrap ${
                      scope === 'business'
                        ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    {t.expenses.scopeBusiness}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('household')}
                    className={`h-9 px-3 text-xs font-semibold rounded-lg transition-all duration-200 ease-out whitespace-nowrap ${
                      scope === 'household'
                        ? 'bg-white dark:bg-amber-500 text-stone-900 dark:text-stone-950 shadow-xs'
                        : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    {t.expenses.scopeHousehold}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(false);
                  }}
                  aria-label={t.common.close}
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1">
                {/* Quick Repeat Recent Strip — only appears when adding and user has real past expenses */}
                {!editing && quickRepeatItems.length > 0 && (
                  <div className="px-5 py-3.5 bg-stone-50/75 dark:bg-[#16231C] border-b border-stone-200 dark:border-[#24352C] space-y-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-[#D5DFDA]">
                        {isVi ? 'Lặp nhanh chi phí gần đây' : 'Quick Repeat Recent'}
                      </span>
                      <InfoHint
                        compact
                        label={isVi ? 'Lặp nhanh chi phí' : 'About Quick Repeat'}
                        text={
                          isVi
                            ? 'Chạm một lần để điền sẵn mô tả, danh mục và số tiền từ các khoản chi bạn đã ghi trước đó.'
                            : 'Tap any past expense you recorded to pre-fill its description, category, and typical amount in one tap.'
                        }
                      />
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
                      {quickRepeatItems.map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => applyQuickRepeat(preset)}
                          className="h-11 px-3.5 inline-flex items-center gap-2 rounded-full bg-white dark:bg-[#0F1814] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] dark:hover:border-[#10B981] text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
                        >
                          <span>{`+ ${preset.title}`}</span>
                          {preset.amountKhr > 0 && (
                            <span className="font-mono-num text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                              {formatKhr(preset.amountKhr)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-5 space-y-4">
                  {/* Category Pills Row */}
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-1">
                      <span className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                        {t.expenses.categoryLabel}
                      </span>
                      <InfoHint
                        compact
                        label={t.expenses.categoryLabel}
                        text={
                          isVi
                            ? 'Chọn nhóm chi phí vận hành (bao bì, điện nước, thiết bị, mặt bằng, vận chuyển). Nhập kho nguyên liệu nên ghi ở mục Kho hàng.'
                            : 'Choose an operating expense category (packaging, utilities, equipment, rent, transport). Log ingredient restocks under Inventory.'
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {activeCategoryPills.map((pill) => {
                        const active = category === pill.id;
                        return (
                          <button
                            key={pill.id}
                            type="button"
                            onClick={() => setCategory(pill.id)}
                            className={`h-11 px-3.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-[#0F5C43] text-white border-[#0F5C43] dark:bg-[#10B981] dark:text-[#042419] dark:border-[#10B981]'
                                : 'bg-stone-50 dark:bg-[#0F1814] text-stone-700 dark:text-[#D5DFDA] border-stone-200 dark:border-[#24352C] hover:border-stone-300 dark:hover:border-[#344B3F]'
                            }`}
                          >
                            {isVi ? pill.labelVi : pill.labelEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Clean 2-Column Input Grid (h-11 touch-friendly inputs) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* Description / Title */}
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {t.expenses.titleLabel}
                      </label>
                      <input
                        ref={titleInputRef}
                        type="text"
                        required
                        maxLength={120}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={
                          isVi ? 'VD: Giao đá viên, Ly & ống hút...' : 'e.g. Ice Delivery, Cups & Straws...'
                        }
                        className="w-full h-11 px-3.5 text-sm bg-white dark:bg-[#0F1814] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]/70 border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      />
                    </div>

                    {/* Amount with KHR / USD Currency Toggle */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label className="text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                          {isVi ? `Số tiền (${currency})` : `Amount (${currency})`}
                        </label>
                        {computedAmountKhr > 0 && (
                          <span className="font-mono-num text-[11px] text-stone-500 dark:text-[#94A39B]">
                            {currency === 'USD'
                              ? `≈ ${formatKhr(computedAmountKhr)}`
                              : formatUsdRef(computedAmountKhr, usdRate)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          required
                          min={0}
                          step={currency === 'USD' ? '0.01' : '500'}
                          value={amountInput}
                          onChange={(e) => setAmountInput(e.target.value)}
                          placeholder={currency === 'USD' ? '0.00' : '0'}
                          className="flex-1 min-w-0 h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#0F1814] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                        />
                        <div
                          role="group"
                          aria-label={isVi ? 'Đơn vị tiền tệ' : 'Currency'}
                          className="inline-flex items-center p-1 h-11 bg-stone-100 dark:bg-[#0F1814] border border-stone-200 dark:border-[#24352C] rounded-lg shrink-0"
                        >
                          {(['KHR', 'USD'] as const).map((curr) => (
                            <button
                              key={curr}
                              type="button"
                              onClick={() => handleToggleCurrency(curr)}
                              className={`h-9 px-3 text-xs font-bold rounded-md transition-colors ${
                                currency === curr
                                  ? 'bg-white dark:bg-[#10B981] text-stone-900 dark:text-[#042419] shadow-xs'
                                  : 'text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                              }`}
                            >
                              {curr === 'KHR' ? '៛ KHR' : '$ USD'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Payment Method */}
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {t.common.payment}
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['cash', 'khqr', 'aba', 'wing'] as PaymentMethod[]).map((pm) => {
                          const active = paymentMethod === pm;
                          return (
                            <button
                              key={pm}
                              type="button"
                              onClick={() => setPaymentMethod(pm)}
                              className={`h-11 px-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-emerald-50 dark:bg-[#064E3B] border-[#0F5C43] dark:border-[#10B981] text-[#0F5C43] dark:text-[#D1FAE5]'
                                  : 'bg-white dark:bg-[#0F1814] border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-50 dark:hover:bg-[#18251F]'
                              }`}
                            >
                              {t.paymentMethods[pm]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {t.common.date}
                      </label>
                      <input
                        type="date"
                        value={expenseDate}
                        onChange={(e) => setExpenseDate(e.target.value)}
                        className="w-full h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#0F1814] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      />
                    </div>

                    {/* Vendor */}
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {t.expenses.vendorLabel}
                      </label>
                      <input
                        type="text"
                        maxLength={100}
                        value={vendor}
                        onChange={(e) => setVendor(e.target.value)}
                        placeholder={isVi ? 'Tên nhà cung cấp (tùy chọn)' : 'Vendor / shop (optional)'}
                        className="w-full h-11 px-3.5 text-sm bg-white dark:bg-[#0F1814] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]/70 border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      />
                    </div>

                    {/* Note */}
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5">
                        {t.common.note}
                      </label>
                      <input
                        type="text"
                        maxLength={200}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={isVi ? 'Ghi chú nhanh (tùy chọn)' : 'Quick note (optional)'}
                        className="w-full h-11 px-3.5 text-sm bg-white dark:bg-[#0F1814] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B]/70 border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Sticky Modal Footer */}
              <div className="px-5 py-3.5 border-t border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] flex flex-wrap items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(false);
                  }}
                  className="h-12 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap"
                >
                  {t.common.cancel}
                </button>
                {!editing && (
                  <button
                    type="button"
                    disabled={saving || !title.trim()}
                    onClick={() => void submitExpense('add_another')}
                    className="h-12 px-4 inline-flex items-center justify-center text-sm font-semibold text-[#0F5C43] dark:text-[#6EE7B7] bg-emerald-50/80 dark:bg-[#064E3B] border border-emerald-200 dark:border-[#10B981]/50 hover:bg-emerald-100/70 dark:hover:bg-[#065F46] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isVi ? '+ Lưu & Thêm tiếp' : '+ Save & Add Another'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving || !title.trim()}
                  className="h-12 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {editing ? t.common.save : isVi ? '+ Lưu chi phí' : '+ Save Expense'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Bottom-Right Floating Action Button + Scroll-to-Top Pill */}
      <FloatingActionBar
        label={t.expenses.addExpense}
        topLabel={isVi ? 'Lên đầu' : 'Top'}
        onAction={openNew}
        hidden={formOpen}
      />
    </div>
  );
};
