import React, { useMemo, useState } from 'react';
import { ArrowDownCircle, Edit2, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Ingredient, IngredientUnit, PaymentMethod } from '../types';
import { formatKhr, formatQty, todayIso } from '../utils/format';

export const InventoryView: React.FC = () => {
  const {
    settings,
    ingredients,
    stockMovements,
    saveIngredient,
    recordIngredientPurchase,
    adjustIngredientStock,
    t,
  } = useStore();
  const isVi = settings.language === 'vi';

  const [subTab, setSubTab] = useState<'stock' | 'movements'>('stock');
  const [search, setSearch] = useState('');

  // Ingredient CRUD modal
  const [ingModalOpen, setIngModalOpen] = useState(false);
  const [editingIng, setEditingIng] = useState<Ingredient | null>(null);
  const [ingName, setIngName] = useState('');
  const [ingNameVi, setIngNameVi] = useState('');
  const [ingUnit, setIngUnit] = useState<IngredientUnit>('g');
  const [ingStock, setIngStock] = useState('0');
  const [ingReorder, setIngReorder] = useState('500');
  const [ingCost, setIngCost] = useState('10');
  const [ingSupplier, setIngSupplier] = useState('');

  // Purchase modal
  const [purchaseTarget, setPurchaseTarget] = useState<Ingredient | null>(null);
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseCostKhr, setPurchaseCostKhr] = useState('');
  const [purchasePayment, setPurchasePayment] = useState<PaymentMethod>('cash');
  const [purchaseVendor, setPurchaseVendor] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [purchaseNote, setPurchaseNote] = useState('');

  // Adjust modal
  const [adjustTarget, setAdjustTarget] = useState<Ingredient | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const summary = useMemo(() => {
    const totalValue = ingredients.reduce(
      (sum, i) => sum + Math.max(0, i.stockQty) * i.unitCostKhr,
      0
    );
    const lowCount = ingredients.filter((i) => i.stockQty <= i.reorderLevel).length;
    return { totalValue, lowCount, totalItems: ingredients.length };
  }, [ingredients]);

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ingredients.filter(
      (i) =>
        !q ||
        i.name.toLowerCase().includes(q) ||
        i.nameVi.toLowerCase().includes(q) ||
        i.supplier.toLowerCase().includes(q)
    );
  }, [ingredients, search]);

  const openNewIngredient = () => {
    setEditingIng(null);
    setIngName('');
    setIngNameVi('');
    setIngUnit('g');
    setIngStock('0');
    setIngReorder(String(settings.lowStockDefault || 15));
    setIngCost('10');
    setIngSupplier('');
    setIngModalOpen(true);
  };

  const openEditIngredient = (ing: Ingredient) => {
    setEditingIng(ing);
    setIngName(ing.name);
    setIngNameVi(ing.nameVi);
    setIngUnit(ing.unit);
    setIngStock(String(ing.stockQty));
    setIngReorder(String(ing.reorderLevel));
    setIngCost(String(ing.unitCostKhr));
    setIngSupplier(ing.supplier);
    setIngModalOpen(true);
  };

  const handleSaveIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingName.trim()) return;
    await saveIngredient({
      id: editingIng?.id,
      name: ingName.trim(),
      nameVi: ingNameVi.trim() || ingName.trim(),
      unit: ingUnit,
      stockQty: Number(ingStock) || 0,
      reorderLevel: Math.max(0, Number(ingReorder) || 0),
      unitCostKhr: Math.max(0, Number(ingCost) || 0),
      supplier: ingSupplier.trim(),
    });
    setIngModalOpen(false);
  };

  const openPurchaseModal = (ing: Ingredient) => {
    setPurchaseTarget(ing);
    setPurchaseQty('');
    setPurchaseCostKhr('');
    setPurchasePayment('cash');
    setPurchaseVendor(ing.supplier || '');
    setPurchaseDate(todayIso());
    setPurchaseNote('');
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseTarget) return;
    const qty = Number(purchaseQty);
    const cost = Number(purchaseCostKhr);
    if (!Number.isFinite(qty) || qty <= 0) return;
    await recordIngredientPurchase({
      ingredientId: purchaseTarget.id,
      addedQty: qty,
      totalCostKhr: Math.max(0, cost || 0),
      paymentMethod: purchasePayment,
      vendor: purchaseVendor,
      note: purchaseNote,
      purchaseDate,
    });
    setPurchaseTarget(null);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const delta = Number(adjustDelta);
    if (!Number.isFinite(delta) || delta === 0) return;
    await adjustIngredientStock(adjustTarget.id, delta, adjustNote);
    setAdjustTarget(null);
    setAdjustDelta('');
    setAdjustNote('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.inventory.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.inventory.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={openNewIngredient}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {t.inventory.addIngredient}
        </button>
      </div>

      {/* KPI Strip */}
      <div className="bg-white border border-stone-200 rounded-xl grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-stone-200">
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.inventory.stockValue}</p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900">
            {formatKhr(summary.totalValue)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.inventory.lowStockItems}</p>
          <p
            className={`mt-1.5 font-mono-num text-2xl font-semibold ${
              summary.lowCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {summary.lowCount}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-stone-500">{t.inventory.totalIngredients}</p>
          <p className="mt-1.5 font-mono-num text-2xl font-semibold text-stone-900">
            {summary.totalItems}
          </p>
        </div>
      </div>

      {/* Sub-tabs & Search */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 bg-stone-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubTab('stock')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                subTab === 'stock'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t.inventory.tabStock}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('movements')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                subTab === 'movements'
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {t.inventory.tabMovements} ({stockMovements.length})
            </button>
          </div>

          {subTab === 'stock' && (
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.common.search}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />
            </div>
          )}
        </div>

        {subTab === 'stock' ? (
          filteredIngredients.length === 0 ? (
            <p className="p-10 text-center text-sm text-stone-500">{t.inventory.emptyStock}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                    <th className="py-3 px-5 font-medium">{t.inventory.ingredientName}</th>
                    <th className="py-3 px-4 font-medium">{t.common.status}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.inventory.inStock}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.inventory.reorderAt}</th>
                    <th className="py-3 px-4 font-medium text-right">{t.inventory.avgUnitCost}</th>
                    <th className="py-3 px-5 font-medium text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {filteredIngredients.map((ing) => {
                    const isOut = ing.stockQty <= 0;
                    const isLow = !isOut && ing.stockQty <= ing.reorderLevel;
                    return (
                      <tr key={ing.id} className="hover:bg-stone-50/60 transition-colors">
                        <td className="py-3.5 px-5">
                          <p className="font-medium text-stone-900">
                            {isVi ? ing.nameVi || ing.name : ing.name}
                          </p>
                          {ing.supplier && (
                            <p className="text-xs text-stone-500 mt-0.5">{ing.supplier}</p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                          {isOut ? (
                            <span className="text-red-700">{t.inventory.statusOut}</span>
                          ) : isLow ? (
                            <span className="text-amber-700">{t.inventory.statusLow}</span>
                          ) : (
                            <span className="text-emerald-700">{t.inventory.statusHealthy}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-stone-900 whitespace-nowrap">
                          {formatQty(ing.stockQty, ing.unit)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-500 whitespace-nowrap">
                          {formatQty(ing.reorderLevel, ing.unit)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num text-xs text-stone-700 whitespace-nowrap">
                          {formatKhr(ing.unitCostKhr)} / {ing.unit}
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openPurchaseModal(ing)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline"
                            >
                              <ArrowDownCircle className="w-3.5 h-3.5" />
                              {t.inventory.recordPurchase}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustTarget(ing);
                                setAdjustDelta('');
                                setAdjustNote('');
                              }}
                              className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900"
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              {t.inventory.adjustStock}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditIngredient(ing)}
                              className="p-1 text-stone-400 hover:text-stone-800"
                              aria-label={t.common.edit}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 text-xs text-stone-500 bg-stone-50/70">
                  <th className="py-3 px-5 font-medium">{t.common.date}</th>
                  <th className="py-3 px-4 font-medium">{t.inventory.ingredientName}</th>
                  <th className="py-3 px-4 font-medium">{t.inventory.movementType}</th>
                  <th className="py-3 px-4 font-medium text-right">{t.inventory.quantityChange}</th>
                  <th className="py-3 px-4 font-medium text-right">{t.inventory.costImpact}</th>
                  <th className="py-3 px-5 font-medium">{t.common.note}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-sm">
                {stockMovements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-stone-50/60">
                    <td className="py-3 px-5 font-mono-num text-xs text-stone-600 whitespace-nowrap">
                      {mov.movementDate}
                    </td>
                    <td className="py-3 px-4 font-medium text-stone-900 whitespace-nowrap">
                      {mov.ingredientName}
                    </td>
                    <td className="py-3 px-4 text-xs text-stone-600 whitespace-nowrap">
                      {t.movementTypes[mov.movementType]} · {mov.recordedBy}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                        mov.deltaQty >= 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {mov.deltaQty > 0 ? '+' : ''}
                      {formatQty(mov.deltaQty, mov.unit)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-xs text-stone-700 whitespace-nowrap">
                      {formatKhr(mov.totalCostKhr)}
                    </td>
                    <td className="py-3 px-5 text-xs text-stone-500 max-w-xs truncate">
                      {mov.note || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Ingredient Modal */}
      {ingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {editingIng ? t.inventory.editIngredient : t.inventory.addIngredient}
              </h2>
              <button
                type="button"
                onClick={() => setIngModalOpen(false)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveIngredient} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.inventory.ingredientName}
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={ingName}
                  onChange={(e) => setIngName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.inventory.ingredientNameVi}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={ingNameVi}
                  onChange={(e) => setIngNameVi(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.unit}
                  </label>
                  <select
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value as IngredientUnit)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white"
                  >
                    {(['g', 'kg', 'ml', 'L', 'pcs'] as IngredientUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.inStock}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={ingStock}
                    onChange={(e) => setIngStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.reorderAt}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={ingReorder}
                    onChange={(e) => setIngReorder(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.avgUnitCost} (KHR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={ingCost}
                    onChange={(e) => setIngCost(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.inventory.supplier}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={ingSupplier}
                  onChange={(e) => setIngSupplier(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIngModalOpen(false)}
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

      {/* Record Ingredient Purchase Modal */}
      {purchaseTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {t.inventory.recordPurchase}:{' '}
                {isVi ? purchaseTarget.nameVi || purchaseTarget.name : purchaseTarget.name}
              </h2>
              <button
                type="button"
                onClick={() => setPurchaseTarget(null)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePurchase} className="p-6 space-y-4">
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                {t.inventory.autoExpenseHint}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.purchaseQty} ({purchaseTarget.unit})
                  </label>
                  <input
                    type="number"
                    required
                    min={0.01}
                    step="any"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.inventory.totalPaidKhr}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={500}
                    value={purchaseCostKhr}
                    onChange={(e) => setPurchaseCostKhr(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.common.date}
                  </label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.common.payment}
                  </label>
                  <select
                    value={purchasePayment}
                    onChange={(e) => setPurchasePayment(e.target.value as PaymentMethod)}
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
                  {t.inventory.supplier}
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={purchaseVendor}
                  onChange={(e) => setPurchaseVendor(e.target.value)}
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
                  value={purchaseNote}
                  onChange={(e) => setPurchaseNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-stone-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPurchaseTarget(null)}
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

      {/* Manual Stock Adjustment Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-stone-900">
                {t.inventory.adjustStock}:{' '}
                {isVi ? adjustTarget.nameVi || adjustTarget.name : adjustTarget.name}
              </h2>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1.5 text-stone-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
              <p className="text-xs text-stone-500 font-mono-num">
                {t.inventory.inStock}: {formatQty(adjustTarget.stockQty, adjustTarget.unit)}
              </p>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.inventory.deltaQty} ({adjustTarget.unit})
                </label>
                <input
                  type="number"
                  required
                  step="any"
                  placeholder="-200 or +500"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  {t.inventory.adjustReason}
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
                />
              </div>
              <div className="pt-3 border-t border-stone-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
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
