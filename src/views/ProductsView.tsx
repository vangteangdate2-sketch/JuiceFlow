import React, { useState } from 'react';
import { Edit2, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Product, ProductCategory, RecipeItem } from '../types';
import { calculateProductCogs, formatKhr, formatQty } from '../utils/format';
import { DRINK_IMAGE_PRESETS } from '../utils/seedData';
import { ProductPhoto } from '../components/ProductPhoto';

export const ProductsView: React.FC = () => {
  const { settings, products, ingredients, saveProduct, deleteProduct, t } = useStore();
  const isVi = settings.language === 'vi';

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [category, setCategory] = useState<ProductCategory>('juice');
  const [priceKhr, setPriceKhr] = useState('8000');
  const [imageUrl, setImageUrl] = useState(DRINK_IMAGE_PRESETS[0].url);
  const [active, setActive] = useState(true);
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openNew = () => {
    setEditingId(null);
    setName('');
    setNameVi('');
    setCategory('juice');
    setPriceKhr('8000');
    setImageUrl(DRINK_IMAGE_PRESETS[0].url);
    setActive(true);
    setRecipe(
      ingredients.length > 0 ? [{ ingredientId: ingredients[0].id, quantity: 1 }] : []
    );
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingId(product.id);
    setName(product.name);
    setNameVi(product.nameVi);
    setCategory(product.category);
    setPriceKhr(String(product.priceKhr));
    setImageUrl(product.imageUrl || DRINK_IMAGE_PRESETS[0].url);
    setActive(product.active);
    setRecipe(product.recipe.map((r) => ({ ...r })));
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await saveProduct({
      id: editingId || undefined,
      name: name.trim(),
      nameVi: nameVi.trim() || name.trim(),
      category,
      priceKhr: Math.max(0, Number(priceKhr) || 0),
      imageUrl,
      active,
      recipe: recipe.filter((r) => r.ingredientId && r.quantity > 0),
    });
    setModalOpen(false);
  };

  const addRecipeRow = () => {
    if (ingredients.length === 0) return;
    setRecipe((prev) => [...prev, { ingredientId: ingredients[0].id, quantity: 1 }]);
  };

  const updateRecipeRow = (index: number, patch: Partial<RecipeItem>) => {
    setRecipe((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const removeRecipeRow = (index: number) => {
    setRecipe((prev) => prev.filter((_, idx) => idx !== index));
  };

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.products.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">{t.products.subtitle}</p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {t.products.addProduct}
        </button>
      </div>

      {products.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900">
            {t.products.emptyTitle}
          </h2>
          <p className="mt-1 text-sm text-stone-500 max-w-md mx-auto">{t.products.emptyDesc}</p>
          <button
            type="button"
            onClick={openNew}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] rounded-lg"
          >
            <Plus className="w-4 h-4" />
            {t.products.addProduct}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {products.map((product) => {
            const cogs = Math.round(calculateProductCogs(product, ingredients));
            const profit = product.priceKhr - cogs;
            const margin = product.priceKhr > 0 ? Math.round((profit / product.priceKhr) * 100) : 0;
            const displayName = isVi ? product.nameVi || product.name : product.name;

            return (
              <div
                key={product.id}
                className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col"
              >
                <ProductPhoto src={product.imageUrl} alt={displayName} className="w-full h-44" />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-stone-500">
                        {t.productCategories[product.category]} ·{' '}
                        <span className={product.active ? 'text-emerald-700 font-medium' : 'text-stone-400'}>
                          {product.active ? t.products.activeStatus : t.products.pausedStatus}
                        </span>
                      </p>
                      <h3 className="mt-1 font-display text-lg font-semibold text-stone-900 truncate">
                        {displayName}
                      </h3>
                    </div>
                    <p className="font-mono-num text-lg font-bold text-[#0F5C43] whitespace-nowrap shrink-0">
                      {formatKhr(product.priceKhr)}
                    </p>
                  </div>

                  {/* Cost & Margin Row */}
                  <div className="mt-4 pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-stone-500 block">{t.products.recipeCost}</span>
                      <span className="font-mono-num font-semibold text-stone-900">
                        {formatKhr(cogs)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-stone-500 block">{t.products.grossMargin}</span>
                      <span className="font-mono-num font-semibold text-emerald-700">
                        {formatKhr(profit)} ({margin}%)
                      </span>
                    </div>
                  </div>

                  {/* Recipe List */}
                  <div className="mt-4 pt-3 border-t border-stone-100 flex-1">
                    <p className="text-xs font-medium text-stone-500 mb-2">
                      {t.products.recipeSection}
                    </p>
                    {product.recipe.length === 0 ? (
                      <p className="text-xs text-stone-400">{t.products.noRecipeYet}</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-stone-700">
                        {product.recipe.map((row, idx) => {
                          const ing = ingMap.get(row.ingredientId);
                          if (!ing) return null;
                          return (
                            <li key={`${row.ingredientId}-${idx}`} className="flex justify-between gap-2">
                              <span className="truncate">
                                {isVi ? ing.nameVi || ing.name : ing.name}
                              </span>
                              <span className="font-mono-num text-stone-500 whitespace-nowrap shrink-0">
                                {formatQty(row.quantity, ing.unit)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-3 border-t border-stone-100 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 hover:text-[#0F5C43] transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {t.common.edit}
                    </button>

                    {confirmDeleteId === product.id ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteProduct(product.id);
                            setConfirmDeleteId(null);
                          }}
                          className="text-xs font-semibold text-red-700 hover:underline"
                        >
                          {t.common.delete}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-stone-500"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(product.id)}
                        className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-red-700 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t.common.delete}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white border border-stone-200 rounded-xl my-8 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {editingId ? t.products.editProduct : t.products.addProduct}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-stone-500 hover:text-stone-900 rounded-md"
                aria-label={t.common.close}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.products.nameEn}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.products.nameVi}
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={nameVi}
                    onChange={(e) => setNameVi(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.products.category}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white"
                  >
                    {(['juice', 'smoothie', 'tea', 'coffee', 'specialty'] as ProductCategory[]).map(
                      (c) => (
                        <option key={c} value={c}>
                          {t.productCategories[c]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    {t.products.sellingPrice}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    required
                    value={priceKhr}
                    onChange={(e) => setPriceKhr(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
                  />
                </div>

                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="w-4 h-4 accent-[#0F5C43]"
                    />
                    {t.products.activeStatus}
                  </label>
                </div>
              </div>

              {/* Studio Photo Picker */}
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-2">
                  {t.products.imagePreset}
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {DRINK_IMAGE_PRESETS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setImageUrl(preset.url)}
                      className={`rounded-lg overflow-hidden border-2 transition-colors ${
                        imageUrl === preset.url ? 'border-[#0F5C43]' : 'border-transparent'
                      }`}
                      title={isVi ? preset.labelVi : preset.label}
                    >
                      <ProductPhoto src={preset.url} alt={preset.label} className="w-full h-14" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipe Builder */}
              <div className="pt-3 border-t border-stone-200">
                <div className="flex items-center justify-between mb-2.5">
                  <label className="text-xs font-semibold text-stone-800">
                    {t.products.recipeSection}
                  </label>
                  <button
                    type="button"
                    onClick={addRecipeRow}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F5C43] hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t.products.addIngredientRow}
                  </button>
                </div>

                {recipe.length === 0 ? (
                  <p className="text-xs text-stone-400 py-2">{t.products.noRecipeYet}</p>
                ) : (
                  <div className="space-y-2">
                    {recipe.map((row, index) => {
                      const chosenIng = ingMap.get(row.ingredientId);
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <select
                            value={row.ingredientId}
                            onChange={(e) =>
                              updateRecipeRow(index, { ingredientId: e.target.value })
                            }
                            className="flex-1 px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white"
                          >
                            {ingredients.map((ing) => (
                              <option key={ing.id} value={ing.id}>
                                {isVi ? ing.nameVi || ing.name : ing.name} ({ing.unit})
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            value={row.quantity}
                            onChange={(e) =>
                              updateRecipeRow(index, {
                                quantity: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-24 px-3 py-2 text-xs font-mono-num border border-stone-200 rounded-lg"
                          />
                          <span className="text-xs text-stone-500 w-8">
                            {chosenIng?.unit || ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeRecipeRow(index)}
                            className="p-1.5 text-stone-400 hover:text-red-700"
                            aria-label="Remove ingredient"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-stone-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg"
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
