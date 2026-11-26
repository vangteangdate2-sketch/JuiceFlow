import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Expense, ExpenseCategory, ExpenseScope, PaymentMethod } from '../types';
import { formatKhr, formatUsdRef, todayIso } from '../utils/format';
import { isLegacyInventoryPurchaseExpense } from '../utils/inventoryEngine';
import { InfoHint } from '../components/InfoHint';

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
  { id: 'ingredients', labelEn: 'Ingredients', labelVi: 'Nguyên liệu' },
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

const DEFAULT_REPEAT_PRESETS_EN: QuickRepeatPreset[] = [
  {
    key: 'preset_ice',
    title: 'Ice Delivery',
    scope: 'business',
    category: 'ingredients',
    amountKhr: 20000,
    paymentMethod: 'cash',
    vendor: 'Local Ice Supplier',
    count: 0,
  },
  {
    key: 'preset_fruit',
    title: 'Fresh Fruit Restock',
    scope: 'business',
    category: 'ingredients',
    amountKhr: 80000,
    paymentMethod: 'cash',
    vendor: 'Morning Market',
    count: 0,
  },
  {
    key: 'preset_cups',
    title: 'Cups & Straws',
    scope: 'business',
    category: 'packaging',
    amountKhr: 45000,
    paymentMethod: 'aba',
    vendor: 'Packaging Shop',
    count: 0,
  },
  {
    key: 'preset_utilities',
    title: 'Electricity & Water',
    scope: 'business',
    category: 'utilities',
    amountKhr: 120000,
    paymentMethod: 'aba',
    vendor: 'EDC / PPWSA',
    count: 0,
  },
];

const DEFAULT_REPEAT_PRESETS_VI: QuickRepeatPreset[] = [
  {
    key: 'preset_ice',
    title: 'Giao đá viên',
    scope: 'business',
    category: 'ingredients',
    amountKhr: 20000,
    paymentMethod: 'cash',
    vendor: 'Đại lý đá',
    count: 0,
  },
  {
    key: 'preset_fruit',
    title: 'Nhập trái cây tươi',
    scope: 'business',
    category: 'ingredients',
    amountKhr: 80000,
    paymentMethod: 'cash',
    vendor: 'Chợ sáng',
    count: 0,
  },
  {
    key: 'preset_cups',
    title: 'Ly & Ống hút',
    scope: 'business',
    category: 'packaging',
    amountKhr: 45000,
    paymentMethod: 'aba',
    vendor: 'Cửa hàng bao bì',
    count: 0,
  },
  {
    key: 'preset_utilities',
    title: 'Tiền điện & nước',
    scope: 'business',
    category: 'utilities',
    amountKhr: 120000,
    paymentMethod: 'aba',
    vendor: 'Điện nước',
    count: 0,
  },
];

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

  // Immediate Delete + 5-second Undo toast state
  const [undoToast, setUndoToast] = useState<{ expense: Expense; expiresAt: number } | null>(null);
  const [undoRemainingSec, setUndoRemainingSec] = useState(5);
  const undoTimeoutRef = useRef<number | null>(null);
  const undoIntervalRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const clearUndoTimers = () => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    if (undoIntervalRef.current !== null) {
      window.clearInterval(undoIntervalRef.current);
      undoIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearUndoTimers();
  }, []);

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

    const sorted = Array.from(grouped.entries())
      .map(([key, g]) => {
        const sortedAmts = [...g.amounts].sort((a, b) => a - b);
        const typicalAmount = sortedAmts[Math.floor(sortedAmts.length / 2)] || 0;
        return {
          key,
          title: g.title,
          scope: g.scope,
          category: g.category,
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

    if (sorted.length >= 4) {
      return sorted;
    }

    // Pad with helpful shop presets if history is still short
    const defaults = isVi ? DEFAULT_REPEAT_PRESETS_VI : DEFAULT_REPEAT_PRESETS_EN;
    const seenKeys = new Set(sorted.map((s) => s.key));
    const merged: QuickRepeatPreset[] = [...sorted];
    for (const preset of defaults) {
      if (merged.length >= 5) break;
      if (!seenKeys.has(preset.title.toLowerCase())) {
        merged.push(preset);
      }
    }
    return merged;
  }, [expenses, isVi]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await saveExpense({
        id: editing?.id,
        title: title.trim(),
        scope,
        category,
        isInventoryPurchase: scope === 'business' && category === 'ingredients',
        amountKhr: Math.max(0, computedAmountKhr),
        expenseDate,
        paymentMethod,
        vendor: vendor.trim(),
        note: note.trim(),
        linkedIngredientId: editing?.linkedIngredientId || '',
        recordedBy: editing?.recordedBy || settings.activeOperator,
      });
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

  const handleDeleteWithUndo = async (exp: Expense) => {
    clearUndoTimers();
    if (editing?.id === exp.id) {
      setEditing(null);
      setFormOpen(false);
    }
    await deleteExpense(exp.id);

    const expiresAt = Date.now() + 5000;
    setUndoToast({ expense: exp, expiresAt });
    setUndoRemainingSec(5);

    undoIntervalRef.current = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setUndoRemainingSec(rem);
    }, 250);

    undoTimeoutRef.current = window.setTimeout(() => {
      clearUndoTimers();
      setUndoToast(null);
    }, 5000);
  };

  const handleUndoDelete = async () => {
    if (!undoToast) return;
    const restored = undoToast.expense;
    clearUndoTimers();
    setUndoToast(null);

    await saveExpense({
      id: restored.id,
      title: restored.title,
      scope: restored.scope,
      category: restored.category,
      isInventoryPurchase: restored.isInventoryPurchase,
      amountKhr: restored.amountKhr,
      expenseDate: restored.expenseDate,
      paymentMethod: restored.paymentMethod,
      vendor: restored.vendor,
      note: restored.note,
      linkedIngredientId: restored.linkedIngredientId,
      recordedBy: restored.recordedBy,
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
        <button
          type="button"
          onClick={() => (formOpen && !editing ? setFormOpen(false) : openNew())}
          className="inline-flex items-center gap-2 h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>{t.expenses.addExpense}</span>
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
      {/* FAST DAILY EXPENSE LOGGER + "QUICK REPEAT RECENT" PILL STRIP       */}
      {/* ================================================================== */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        {/* Quick Repeat Recent Strip (always 1 tap away above the form) */}
        <div className="px-4 sm:px-5 py-3.5 bg-stone-50/75 dark:bg-[#16231C] border-b border-stone-200 dark:border-[#24352C] space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-[#D5DFDA]">
                {isVi ? 'Lặp nhanh chi phí thường gặp' : 'Quick Repeat Recent'}
              </span>
              <InfoHint
                compact
                label={isVi ? 'Lặp nhanh chi phí' : 'About Quick Repeat'}
                text={
                  isVi
                    ? 'Chạm một lần để điền sẵn mô tả, danh mục và số tiền thường chi cho các khoản lặp lại hàng ngày.'
                    : 'Tap any frequent expense to pre-fill description, category, and typical amount in one tap.'
                }
              />
            </div>

            <button
              type="button"
              onClick={() => (formOpen ? setFormOpen(false) : openNew())}
              aria-expanded={formOpen}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>
                {formOpen
                  ? isVi
                    ? 'Thu gọn biểu mẫu'
                    : 'Hide Form'
                  : isVi
                    ? 'Mở biểu mẫu'
                    : 'Open Form'}
              </span>
              {formOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
            {quickRepeatItems.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyQuickRepeat(preset)}
                className="h-11 px-3.5 inline-flex items-center gap-2 rounded-full bg-white dark:bg-[#0F1814] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] dark:hover:border-[#10B981] text-xs font-semibold text-stone-800 dark:text-[#F1F5F3] transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                <span>{preset.title}</span>
                {preset.amountKhr > 0 && (
                  <span className="font-mono-num text-[11px] font-medium text-stone-500 dark:text-[#94A39B]">
                    {formatKhr(preset.amountKhr)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Compact 2-Column Add / Edit Expense Form */}
        {formOpen && (
          <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3]">
                  {editing ? t.expenses.editExpense : t.expenses.addExpense}
                </h2>
                {editing && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-500/40">
                    {isVi ? 'Đang chỉnh sửa' : 'Editing'}
                  </span>
                )}
              </div>

              {/* Compact Scope Switch */}
              <div className="inline-flex items-center gap-1 p-1 bg-stone-100 dark:bg-[#0F1814] border border-stone-200/80 dark:border-[#24352C] rounded-xl">
                <button
                  type="button"
                  onClick={() => handleScopeChange('business')}
                  className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
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
                  className={`h-9 px-3.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    scope === 'household'
                      ? 'bg-white dark:bg-amber-500 text-stone-900 dark:text-stone-950 shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  {t.expenses.scopeHousehold}
                </button>
              </div>
            </div>

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
                      ? 'Danh mục "Nguyên liệu" được tính là Nhập kho (chỉ tính dòng tiền). Các danh mục vận hành khác được trừ trực tiếp vào Lãi/Lỗ.'
                      : '"Ingredients" is classified as an inventory purchase (Cash Flow only). Other business categories flow into Operating Expenses on P&L.'
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
                  placeholder={isVi ? 'VD: Giao đá viên, Ly & ống hút...' : 'e.g. Ice Delivery, Cups & Straws...'}
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

            <div className="pt-3 border-t border-stone-100 dark:border-[#1F3028] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(false);
                }}
                className="h-11 px-4 text-sm font-medium text-stone-700 dark:text-[#D5DFDA] hover:bg-stone-100 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim()}
                className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors disabled:opacity-50"
              >
                {editing ? t.common.save : isVi ? 'Lưu chi phí' : 'Save Expense'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ================================================================== */}
      {/* EXPENSES TABLE WITH INVENTORY-ALIGNED TOOLBAR                      */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-[#24352C] space-y-3">
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

          {/* Row 2: Search Bar + Labeled Category Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isVi ? 'Tìm mô tả, nhà cung cấp, ghi chú...' : 'Search description, vendor, note...'}
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

            <div className="flex items-center gap-2 shrink-0">
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
      {/* 5-SECOND UNDO TOAST NOTIFICATION ON EXPENSE DELETION               */}
      {/* ================================================================== */}
      {undoToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 left-5 sm:left-auto sm:min-w-[360px] z-50 bg-stone-900 dark:bg-[#18251F] text-white dark:text-[#F1F5F3] border border-stone-700 dark:border-[#344B3F] rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {isVi ? `Đã xóa "${undoToast.expense.title}"` : `Deleted "${undoToast.expense.title}"`}
            </p>
            <p className="text-xs text-stone-400 dark:text-[#94A39B] font-mono-num">
              {formatKhr(undoToast.expense.amountKhr)} ·{' '}
              {isVi ? `Hoàn tác trong ${undoRemainingSec}s` : `Undo available (${undoRemainingSec}s)`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleUndoDelete()}
              className="h-10 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#042419] text-xs font-bold transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>{isVi ? 'Hoàn tác' : 'Undo'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                clearUndoTimers();
                setUndoToast(null);
              }}
              aria-label={t.common.close}
              className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
