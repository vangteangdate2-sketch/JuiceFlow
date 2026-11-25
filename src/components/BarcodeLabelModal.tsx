import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, Download, Printer, QrCode, X } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { Product } from '../types';
import { formatKhr } from '../utils/format';
import { detectBarcodeFormat, formatBarcodeTypeLabel } from '../utils/barcodeRegistry';

export type LabelFormat = 'CODE128' | 'QR';
export type LabelStickerSize = '40x30' | '50x30';

export interface LabelTargetOption {
  id: string;
  code: string;
  title: string;
  subtitle?: string;
  priceKhr: number;
}

export interface BarcodeLabelModalProps {
  open: boolean;
  product: Product | null;
  initialCode?: string;
  shopName?: string;
  isVi?: boolean;
  onClose: () => void;
}

/**
 * Pure helper to generate a crisp Code 128 or QR Code graphic data URL.
 */
export async function generateBarcodeGraphicDataUrl(
  code: string,
  format: LabelFormat
): Promise<string> {
  if (!code.trim()) return '';

  if (format === 'QR') {
    return QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }

  // Code 128 rendered onto an offscreen canvas
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, code, {
    format: 'CODE128',
    lineColor: '#000000',
    background: '#ffffff',
    width: 2.2,
    height: 76,
    displayValue: false,
    margin: 6,
  });
  return canvas.toDataURL('image/png');
}

/**
 * Render a full print-ready sticker PNG (300 DPI equivalent) with product name,
 * barcode/QR graphic, exact string code (preserving leading zeros), and optional KHR price.
 */
async function renderStickerPngDataUrl(params: {
  shopName: string;
  productName: string;
  subtitle?: string;
  code: string;
  priceKhr: number;
  showPrice: boolean;
  format: LabelFormat;
  size: LabelStickerSize;
  graphicDataUrl: string;
}): Promise<string> {
  const widthPx = params.size === '50x30' ? 600 : 480;
  const heightPx = 360;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return params.graphicDataUrl;

  // White background + hairline border
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';

  const pad = 24;
  const maxTextWidth = widthPx - pad * 2;

  // Header: Shop name (subtle) + Price (right aligned)
  ctx.font = '600 18px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillStyle = '#57534e';
  ctx.textAlign = 'left';
  ctx.fillText(params.shopName.slice(0, 28), pad, pad - 4, maxTextWidth * 0.6);

  if (params.showPrice && params.priceKhr > 0) {
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.fillText(formatKhr(params.priceKhr), widthPx - pad, pad - 6);
  }

  // Product title
  ctx.font = '700 24px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  const titleLine = params.subtitle
    ? `${params.productName} · ${params.subtitle}`
    : params.productName;
  ctx.fillText(titleLine.slice(0, 38), pad, pad + 26, maxTextWidth);

  // Load graphic image
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load barcode graphic'));
    img.src = params.graphicDataUrl;
  });

  if (params.format === 'QR') {
    const qrSize = 196;
    const qrX = pad;
    const qrY = pad + 68;
    ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

    // Code + metadata on right side of QR
    const infoX = qrX + qrSize + 20;
    const infoMaxW = widthPx - infoX - pad;
    ctx.font = '600 16px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = '#57534e';
    ctx.textAlign = 'left';
    ctx.fillText('SKU / BARCODE', infoX, qrY + 26, infoMaxW);

    ctx.font = '700 22px "JetBrains Mono", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(params.code, infoX, qrY + 54, infoMaxW);

    if (params.subtitle) {
      ctx.font = '500 18px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = '#44403c';
      ctx.fillText(params.subtitle, infoX, qrY + 96, infoMaxW);
    }
  } else {
    // Code 128 centered horizontally
    const barW = widthPx - pad * 2;
    const barH = 158;
    const barY = pad + 72;
    ctx.drawImage(img, pad, barY, barW, barH);

    // Exact human-readable string below bars (strictly preserving leading zeros)
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.fillText(params.code, widthPx / 2, barY + barH + 10, barW);
  }

  return canvas.toDataURL('image/png');
}

export const BarcodeLabelModal: React.FC<BarcodeLabelModalProps> = ({
  open,
  product,
  initialCode,
  shopName = 'JuiceFlow',
  isVi = false,
  onClose,
}) => {
  const options = useMemo<LabelTargetOption[]>(() => {
    if (!product) return [];
    const list: LabelTargetOption[] = [];
    const prodName = isVi ? product.nameVi || product.name : product.name;

    if (product.barcode?.trim()) {
      list.push({
        id: 'unit',
        code: product.barcode.trim(),
        title: prodName,
        subtitle: product.unit || 'Unit',
        priceKhr: product.priceKhr,
      });
    }

    for (const v of product.variants || []) {
      if (v.barcode?.trim()) {
        list.push({
          id: `var_${v.id}`,
          code: v.barcode.trim(),
          title: prodName,
          subtitle: isVi ? v.nameVi || v.name : v.name,
          priceKhr: v.priceKhr,
        });
      }
    }

    for (let i = 0; i < (product.packagingBarcodes || []).length; i += 1) {
      const pb = product.packagingBarcodes![i];
      if (pb.barcode?.trim()) {
        list.push({
          id: `pack_${i}`,
          code: pb.barcode.trim(),
          title: prodName,
          subtitle: `${pb.label} (×${pb.unitsPerPack})`,
          priceKhr: product.priceKhr * Math.max(1, pb.unitsPerPack),
        });
      }
    }

    if (initialCode?.trim() && !list.some((o) => o.code === initialCode.trim())) {
      list.unshift({
        id: 'initial',
        code: initialCode.trim(),
        title: prodName,
        subtitle: product.unit || 'Unit',
        priceKhr: product.priceKhr,
      });
    }

    return list;
  }, [product, initialCode, isVi]);

  const [selectedOptionId, setSelectedOptionId] = useState<string>('');
  const [labelFormat, setLabelFormat] = useState<LabelFormat>('CODE128');
  const [stickerSize, setStickerSize] = useState<LabelStickerSize>('50x30');
  const [copies, setCopies] = useState<number>(6);
  const [showPrice, setShowPrice] = useState<boolean>(true);
  const [graphicDataUrl, setGraphicDataUrl] = useState<string>('');
  const [renderError, setRenderError] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);

  useEffect(() => {
    if (!open || options.length === 0) return;
    if (initialCode) {
      const match = options.find((o) => o.code === initialCode.trim());
      if (match) {
        setSelectedOptionId(match.id);
        return;
      }
    }
    setSelectedOptionId(options[0].id);
  }, [open, options, initialCode]);

  const activeOption = useMemo(
    () => options.find((o) => o.id === selectedOptionId) || options[0] || null,
    [options, selectedOptionId]
  );

  useEffect(() => {
    if (!open || !activeOption?.code) {
      setGraphicDataUrl('');
      return;
    }
    let cancelled = false;
    setRenderError('');
    generateBarcodeGraphicDataUrl(activeOption.code, labelFormat)
      .then((url) => {
        if (!cancelled) setGraphicDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setRenderError(
            isVi
              ? 'Mã này chứa ký tự không hỗ trợ Code 128 — hãy chuyển sang QR Code.'
              : 'This code contains characters outside Code 128 — switch to QR Code.'
          );
          setGraphicDataUrl('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeOption?.code, labelFormat, isVi]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !product) return null;

  const handleDownloadPng = async () => {
    if (!activeOption || !graphicDataUrl || downloading) return;
    setDownloading(true);
    try {
      const pngUrl = await renderStickerPngDataUrl({
        shopName,
        productName: activeOption.title,
        subtitle: activeOption.subtitle,
        code: activeOption.code,
        priceKhr: activeOption.priceKhr,
        showPrice,
        format: labelFormat,
        size: stickerSize,
        graphicDataUrl,
      });
      const a = document.createElement('a');
      a.href = pngUrl;
      const safeSlug = activeOption.code.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `label-${safeSlug}-${labelFormat.toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrintSheet = () => {
    window.print();
  };

  const stickerWidthMm = stickerSize === '50x30' ? '50mm' : '40mm';
  const copyIndices = Array.from({ length: Math.min(40, Math.max(1, copies)) }, (_, i) => i);

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-label-modal-title"
        className="w-full max-w-3xl bg-[#F6F7F5] border border-stone-200 rounded-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-white border-b border-stone-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2
              id="barcode-label-modal-title"
              className="font-display text-lg font-bold text-stone-900 tracking-tight"
            >
              {isVi ? 'In tem mã vạch & Mã QR' : 'Internal Barcode & QR Label Studio'}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {isVi
                ? 'Tạo tem nhiệt 40×30mm / 50×30mm và tải ảnh PNG chất lượng cao.'
                : 'Generate 40×30mm or 50×30mm thermal sticker sheets plus high-DPI PNG downloads.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
            aria-label={isVi ? 'Đóng' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {options.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-xl p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-stone-900">
                {isVi ? 'Sản phẩm chưa có mã vạch hoặc SKU' : 'No barcode or internal SKU assigned yet'}
              </p>
              <p className="text-xs text-stone-500">
                {isVi
                  ? 'Mở chỉnh sửa sản phẩm và nhấn "Tạo mã SKU" để cấp mã nội bộ trước khi in tem.'
                  : 'Edit this product and click "Auto-Generate SKU" to assign an internal code first.'}
              </p>
            </div>
          ) : (
            <>
              {/* Controls Grid */}
              <div className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-12 gap-4">
                {/* Barcode Selector */}
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-stone-700 mb-1.5">
                    {isVi ? 'Mã cần in tem' : 'Barcode / SKU to Print'}
                  </label>
                  <select
                    value={activeOption?.id || ''}
                    onChange={(e) => setSelectedOptionId(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                  >
                    {options.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.code} — {opt.subtitle || 'Unit'}
                      </option>
                    ))}
                  </select>
                  {activeOption && (
                    <p className="text-[11px] text-stone-500 mt-1">
                      {isVi ? 'Định dạng gốc:' : 'Detected format:'}{' '}
                      <span className="font-mono-num font-semibold text-stone-700">
                        {formatBarcodeTypeLabel(detectBarcodeFormat(activeOption.code))}
                      </span>
                    </p>
                  )}
                </div>

                {/* Label Symbology */}
                <div className="sm:col-span-6">
                  <span className="block text-xs font-medium text-stone-700 mb-1.5">
                    {isVi ? 'Loại tem nhãn' : 'Label Symbology'}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setLabelFormat('CODE128')}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                        labelFormat === 'CODE128'
                          ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                          : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                      }`}
                    >
                      <Barcode className="w-3.5 h-3.5" />
                      Code 128
                    </button>
                    <button
                      type="button"
                      onClick={() => setLabelFormat('QR')}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                        labelFormat === 'QR'
                          ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                          : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                      }`}
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      QR Code
                    </button>
                  </div>
                </div>

                {/* Thermal Sticker Dimensions */}
                <div className="sm:col-span-5">
                  <span className="block text-xs font-medium text-stone-700 mb-1.5">
                    {isVi ? 'Khổ tem nhiệt' : 'Thermal Sticker Size'}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['40x30', '50x30'] as LabelStickerSize[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setStickerSize(sz)}
                        className={`px-3 py-2 text-xs font-mono-num font-semibold rounded-lg border transition-colors ${
                          stickerSize === sz
                            ? 'border-[#0F5C43] bg-emerald-50/70 text-[#0F5C43]'
                            : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                        }`}
                      >
                        {sz === '40x30' ? '40 × 30 mm' : '50 × 30 mm'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Copy Count */}
                <div className="sm:col-span-3">
                  <label
                    htmlFor="lbl-copies"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    {isVi ? 'Số lượng tem' : 'Sheet Copies'}
                  </label>
                  <input
                    id="lbl-copies"
                    type="number"
                    min={1}
                    max={40}
                    value={copies}
                    onChange={(e) => setCopies(Math.min(40, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-stone-200 rounded-lg bg-white"
                  />
                </div>

                {/* Include KHR Price */}
                <div className="sm:col-span-4 flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showPrice}
                      onChange={(e) => setShowPrice(e.target.checked)}
                      className="w-4 h-4 accent-[#0F5C43]"
                    />
                    {isVi ? 'Hiển thị giá bán (KHR)' : 'Show selling price (KHR)'}
                  </label>
                </div>
              </div>

              {renderError && (
                <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 font-medium">
                  {renderError}
                </div>
              )}

              {/* Live Thermal Sheet Preview (also serves as the print target #barcode-label-sheet) */}
              {activeOption && graphicDataUrl && (
                <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between text-xs text-stone-500">
                    <span className="font-semibold text-stone-800">
                      {isVi ? 'Xem trước trang in tem nhiệt' : 'Thermal Sticker Sheet Preview'}
                    </span>
                    <span className="font-mono-num">
                      {copyIndices.length} × {stickerSize === '50x30' ? '50×30mm' : '40×30mm'}
                    </span>
                  </div>

                  <div
                    id="barcode-label-sheet"
                    className="flex flex-wrap gap-2.5 justify-start bg-stone-50/70 border border-dashed border-stone-200 rounded-lg p-3 max-h-80 overflow-y-auto"
                  >
                    {copyIndices.map((idx) => (
                      <div
                        key={idx}
                        style={{ width: stickerWidthMm, minHeight: '30mm' }}
                        className="thermal-sticker-card bg-white border border-stone-300 rounded-md p-2 flex flex-col justify-between text-black"
                      >
                        <div className="flex items-baseline justify-between gap-1 text-[9px] leading-tight">
                          <span className="text-stone-500 truncate font-medium">
                            {shopName}
                          </span>
                          {showPrice && activeOption.priceKhr > 0 && (
                            <span className="font-mono-num font-bold text-[10px] shrink-0">
                              {formatKhr(activeOption.priceKhr)}
                            </span>
                          )}
                        </div>

                        <p className="text-[10px] font-bold text-stone-950 truncate leading-tight mt-0.5">
                          {activeOption.title}
                          {activeOption.subtitle ? ` · ${activeOption.subtitle}` : ''}
                        </p>

                        {labelFormat === 'QR' ? (
                          <div className="flex items-center gap-2 mt-1">
                            <img
                              src={graphicDataUrl}
                              alt={activeOption.code}
                              className="w-12 h-12 shrink-0 object-contain"
                            />
                            <div className="min-w-0">
                              <span className="block font-mono-num text-[9px] font-bold break-all leading-tight">
                                {activeOption.code}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-col items-center">
                            <img
                              src={graphicDataUrl}
                              alt={activeOption.code}
                              className="w-full h-9 object-contain"
                            />
                            <span className="font-mono-num text-[9px] font-bold tracking-wider leading-none mt-0.5">
                              {activeOption.code}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-white border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg"
          >
            {isVi ? 'Đóng' : 'Close'}
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!graphicDataUrl || downloading}
              onClick={handleDownloadPng}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#0F5C43]" />
              {isVi ? 'Tải ảnh PNG' : 'Download PNG'}
            </button>
            <button
              type="button"
              disabled={!graphicDataUrl}
              onClick={handlePrintSheet}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              {isVi ? 'In trang tem nhiệt' : 'Print Thermal Sheet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
