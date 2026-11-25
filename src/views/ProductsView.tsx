import React, { useMemo, useState } from 'react';
import {
  Edit2,
  Layers,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { Product, ProductType } from '../types';
import {
  calculateProductCogs,
  calculateRecipeCogs,
  formatKhr,
  formatQty,
} from '../utils/format';
import { ProductPhoto } from '../components/ProductPhoto';
import { ProductFormModal } from '../components/ProductFormModal';

export const ProductsView: React.FC = () => {
  const { settings, products, ingredients, saveProduct, deleteProduct, t } = useStore();
  const isVi = settings.language === 'vi';

  const [typeFilter, setTypeFilter] = useState<'ALL' | ProductType>('ALL');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'ALL' && p.productType !== typeFilter) return false;
      if (!q) return true;
      const packCodes = (p.packagingBarcodes || []).map((pb) => pb.barcode).join(' ');
      return (
        p.name.toLowerCase().includes(q) ||
        p.nameVi.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        packCodes.toLowerCase().includes(q)
      );
    });
  }, [products, typeFilter, search]);

  const openNew = () => {
    setEditingProduct(null);
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {t.products.title}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {isVi
              ? 'Quản lý sản phẩm đóng gói, pha chế theo đơn (nhiều kích cỡ S/M/L) và hàng pha sẵn trữ lạnh.'
              : 'Manage packaged goods, made-to-order drinks with size variants, and prepared-stock items.'}
          </p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          {isVi ? 'Thêm sản phẩm' : 'Add Product'}
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'PREPARED_TO_ORDER', 'PACKAGED', 'PREPARED_STOCK'] as const).map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setTypeFilter(pt)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                typeFilter === pt
                  ? 'bg-[#0F5C43] text-white'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {pt === 'ALL' ? `${t.common.all} (${products.length})` : t.productTypes[pt]}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isVi ? 'Tìm tên, thương hiệu, mã vạch...' : 'Search name, brand, barcode...'}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
          />
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center">
          <h2 className="font-display text-lg font-semibold text-stone-900">
            {t.products.emptyTitle}
          </h2>
          <p className="mt-1 text-sm text-stone-500 max-w-md mx-auto">{t.products.emptyDesc}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredProducts.map((product) => {
            const firstVariant = product.variants?.[0];
            const cogs = Math.round(calculateProductCogs(product, ingredients, firstVariant));
            const basePrice = firstVariant ? firstVariant.priceKhr : product.priceKhr;
            const profit = basePrice - cogs;
            const margin = basePrice > 0 ? Math.round((profit / basePrice) * 100) : 0;
            const displayName = isVi ? product.nameVi || product.name : product.name;
            const isDirectStock =
              product.productType === 'PACKAGED' || product.productType === 'PREPARED_STOCK';
            const isLowStock = isDirectStock && product.stockQty <= product.reorderLevel;

            return (
              <div
                key={product.id}
                className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col"
              >
                <ProductPhoto src={product.imageUrl} alt={displayName} className="w-full h-40" />

                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-stone-500">
                        <span className="font-semibold text-stone-700">
                          {t.productTypes[product.productType]}
                        </span>{' '}
                        · {t.productCategories[product.category]} ·{' '}
                        <span
                          className={
                            product.active ? 'text-emerald-700 font-medium' : 'text-stone-400'
                          }
                        >
                          {product.active ? t.products.activeStatus : t.products.pausedStatus}
                        </span>
                      </p>
                      <h3 className="mt-1 font-display text-lg font-semibold text-stone-900 truncate">
                        {displayName}
                      </h3>
                      {(product.brand || product.barcode) && (
                        <p className="text-xs text-stone-500 mt-0.5 font-mono-num truncate">
                          {[product.brand, product.barcode ? `SKU: ${product.barcode}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-num text-lg font-bold text-[#0F5C43] whitespace-nowrap">
                        {product.variants && product.variants.length > 1
                          ? `${formatKhr(Math.min(...product.variants.map((v) => v.priceKhr)))}+`
                          : formatKhr(basePrice)}
                      </p>
                      {isDirectStock && (
                        <p
                          className={`text-xs font-mono-num font-semibold mt-0.5 ${
                            product.stockQty <= 0
                              ? 'text-red-700'
                              : isLowStock
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatQty(product.stockQty, product.unit)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Cost & Margin Row */}
                  <div className="mt-4 pt-3 border-t border-stone-100 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-stone-500 block">
                        {product.productType === 'PACKAGED'
                          ? isVi
                            ? 'Giá vốn nhập'
                            : 'Unit Cost'
                          : t.products.recipeCost}
                      </span>
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

                  {/* Variants / Packaging / Recipe Summary */}
                  <div className="mt-4 pt-3 border-t border-stone-100 flex-1 space-y-2 text-xs">
                    {product.productType === 'PACKAGED' ? (
                      <div className="space-y-1 text-stone-600">
                        <div className="flex justify-between">
                          <span className="text-stone-500">{t.inventory.supplier}</span>
                          <span className="font-medium text-stone-800">
                            {product.supplier || '—'}
                          </span>
                        </div>
                        {product.packagingBarcodes && product.packagingBarcodes.length > 0 && (
                          <div className="pt-1 space-y-0.5">
                            {product.packagingBarcodes.map((pb, idx) => (
                              <div key={idx} className="flex justify-between font-mono-num text-[11px]">
                                <span className="text-stone-500">{pb.label}</span>
                                <span className="text-stone-700">
                                  {pb.barcode} (×{pb.unitsPerPack})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : product.variants && product.variants.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-stone-500 mb-1.5 flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5" />
                          {isVi ? 'Kích cỡ & Giá bán' : 'Size Variants'} ({product.variants.length})
                        </p>
                        <ul className="space-y-1">
                          {product.variants.map((v) => {
                            const vCogs = Math.round(calculateRecipeCogs(v.recipe, ingredients));
                            return (
                              <li key={v.id} className="flex justify-between text-stone-700">
                                <span className="font-medium">
                                  {isVi ? v.nameVi || v.name : v.name}
                                </span>
                                <span className="font-mono-num">
                                  {formatKhr(v.priceKhr)}{' '}
                                  <span className="text-stone-400">({formatKhr(vCogs)})</span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-medium text-stone-500 mb-1.5">
                          {product.productType === 'PREPARED_STOCK'
                            ? isVi
                              ? 'Công thức pha mẻ (cho 1 đơn vị thành phẩm)'
                              : 'Batch Prep Recipe (per 1 finished unit)'
                            : t.products.recipeSection}
                        </p>
                        {product.recipe.length === 0 ? (
                          <p className="text-xs text-stone-400">{t.products.noRecipeYet}</p>
                        ) : (
                          <ul className="space-y-1 text-stone-700">
                            {product.recipe.slice(0, 5).map((row, idx) => {
                              const ing = ingMap.get(row.ingredientId);
                              if (!ing) return null;
                              return (
                                <li
                                  key={`${row.ingredientId}-${idx}`}
                                  className="flex justify-between gap-2"
                                >
                                  <span className="truncate">
                                    {isVi ? ing.nameVi || ing.name : ing.name}
                                  </span>
                                  <span className="font-mono-num text-stone-500 whitespace-nowrap shrink-0">
                                    {formatQty(row.quantity, row.unit || ing.unit)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
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
      <ProductFormModal
        open={modalOpen}
        editingProduct={editingProduct}
        existingProducts={products}
        ingredients={ingredients}
        settings={settings}
        t={t}
        onSave={saveProduct}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
};
