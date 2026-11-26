import React, { useState } from 'react';
import { Banknote, Check, Copy, Printer, X } from 'lucide-react';
import type { Sale, WorkspaceSettings } from '../types';
import { formatDateTimeInPhnomPenh, formatKhr, formatUsdRef } from '../utils/format';
import { formatUsdClean } from '../utils/cashTender';

interface ReceiptModalProps {
  sale: Sale | null;
  settings: WorkspaceSettings;
  onClose: () => void;
}

export function buildReceiptPlainText(sale: Sale, settings: WorkspaceSettings): string {
  const divider = '--------------------------------';
  const shopName = settings?.name || 'JuiceFlow';
  const paymentLabel = String(sale.paymentMethod || 'cash').toUpperCase();
  const statusValue = sale.status || 'completed';
  const saleItems = Array.isArray(sale.items) ? sale.items : [];
  const lines: string[] = [
    shopName.toUpperCase(),
    settings?.location || 'Phnom Penh, Cambodia',
    divider,
    `Order: ${sale.orderNumber || ''}`,
    `Date:  ${formatDateTimeInPhnomPenh(sale.createdAt)} (ICT)`,
    `Staff: ${sale.recordedBy || ''}`,
    `Pay:   ${paymentLabel}`,
  ];
  if (sale.customerName && sale.customerName !== 'Walk-in') {
    lines.push(`Cust:  ${sale.customerName}`);
  }
  lines.push(divider);

  for (const item of saleItems) {
    const label = item.variantName
      ? `${item.productName} (${item.variantName})`
      : item.productName;
    lines.push(`${item.quantity}x ${label}`);
    lines.push(`   ${formatKhr(item.unitPriceKhr)} ea -> ${formatKhr(item.lineTotalKhr)}`);
    if (item.returnedQty && item.returnedQty > 0) {
      lines.push(`   [Returned: -${item.returnedQty}]`);
    }
  }

  lines.push(divider);
  lines.push(`SUBTOTAL: ${formatKhr(sale.subtotalKhr ?? sale.totalKhr)}`);
  if (sale.refundedKhr && sale.refundedKhr > 0) {
    lines.push(`REFUNDED: -${formatKhr(sale.refundedKhr)}`);
    lines.push(`NET PAID: ${formatKhr(sale.netTotalKhr ?? Math.max(0, sale.totalKhr - sale.refundedKhr))}`);
  } else {
    lines.push(`TOTAL:    ${formatKhr(sale.totalKhr)}`);
  }
  if ((settings?.usdRate ?? 0) > 0) {
    const net = sale.netTotalKhr ?? sale.totalKhr;
    lines.push(`USD REF:  ${formatUsdRef(net, settings.usdRate)}`);
  }
  if (
    sale.paymentMethod === 'cash' &&
    (sale.cash_received_usd !== null || sale.cash_received_khr !== null) &&
    (sale.cash_received_usd !== undefined || sale.cash_received_khr !== undefined)
  ) {
    const usd = sale.cash_received_usd ?? 0;
    const khr = sale.cash_received_khr ?? 0;
    const rate = sale.exchange_rate_used ?? settings?.posExchangeRate ?? 4000;
    const parts: string[] = [];
    if (usd > 0) parts.push(`${formatUsdClean(usd)} (${formatKhr(Math.round(usd * rate))})`);
    if (khr > 0) parts.push(formatKhr(khr));
    if (parts.length > 0) {
      lines.push(`TENDERED: ${parts.join(' + ')}`);
    }
    if (sale.change_given_khr !== null && sale.change_given_khr !== undefined) {
      lines.push(`CHANGE:   ${formatKhr(sale.change_given_khr)}`);
    }
  }
  if (statusValue !== 'completed') {
    lines.push(`STATUS:   ${String(statusValue).toUpperCase()}`);
  }
  if (sale.note) {
    lines.push(`Note: ${sale.note}`);
  }
  lines.push(divider);
  lines.push('Thank you! Visit us again.');
  return lines.join('\n');
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, settings, onClose }) => {
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('80mm');
  const [copied, setCopied] = useState(false);

  if (!sale) return null;

  const isVi = settings?.language === 'vi';
  const netAmount =
    sale.status === 'voided'
      ? 0
      : sale.netTotalKhr ?? Math.max(0, sale.totalKhr - (sale.refundedKhr ?? 0));

  const changeDueKhr =
    sale.paymentMethod === 'cash' &&
    sale.status !== 'voided' &&
    typeof sale.change_given_khr === 'number' &&
    sale.change_given_khr > 0
      ? sale.change_given_khr
      : 0;

  const changeExchangeRate =
    (sale.exchange_rate_used && sale.exchange_rate_used > 0 ? sale.exchange_rate_used : null) ??
    (settings?.posExchangeRate && settings.posExchangeRate > 0 ? settings.posExchangeRate : null) ??
    (settings?.usdRate && settings.usdRate > 0 ? settings.usdRate : 4000);

  const changeDueUsd = changeDueKhr > 0 ? changeDueKhr / changeExchangeRate : 0;

  const handleCopy = async () => {
    const text = buildReceiptPlainText(sale, settings);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback textarea copy
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 print:bg-white print:p-0 print:static">
      <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-2xl shadow-xl overflow-hidden print:border-0 print:shadow-none print:max-w-none print:bg-white print:rounded-none">
        {/* High-Contrast Change Banner at the Very Top (Cash orders with Change Due > 0) */}
        {changeDueKhr > 0 && (
          <div
            role="status"
            className="bg-[#0F5C43] dark:bg-[#10B981] text-white dark:text-[#042419] px-5 py-4 flex items-center justify-between gap-3 print:hidden"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-white/15 dark:bg-[#042419]/15 inline-flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider opacity-90">
                  {isVi ? 'Tiền thối cho khách' : 'Change to Return'}
                </p>
                <p className="font-mono-num text-lg sm:text-xl font-extrabold tracking-tight leading-tight">
                  {formatKhr(changeDueKhr)}{' '}
                  <span className="text-sm sm:text-base font-bold opacity-90">
                    ({formatUsdClean(changeDueUsd)})
                  </span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Modal Header (hidden on print) */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 dark:border-[#24352C] print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
              {isVi ? `Hóa đơn ${sale.orderNumber}` : `Receipt ${sale.orderNumber}`}
            </h3>
            <div className="flex border border-stone-200 dark:border-[#24352C] rounded-lg overflow-hidden text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`h-10 px-3 transition-colors ${
                  paperWidth === '58mm'
                    ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                    : 'bg-stone-50 dark:bg-[#18251F] text-stone-600 dark:text-[#94A39B] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
                }`}
              >
                58mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`h-10 px-3 transition-colors ${
                  paperWidth === '80mm'
                    ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                    : 'bg-stone-50 dark:bg-[#18251F] text-stone-600 dark:text-[#94A39B] hover:bg-stone-100 dark:hover:bg-[#1F3028]'
                }`}
              >
                80mm
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] shrink-0"
            aria-label="Close receipt"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Thermal Receipt Preview (paper stays crisp white for authentic print preview) */}
        <div className="p-5 bg-stone-50 dark:bg-[#0B110E] flex justify-center max-h-[60vh] overflow-y-auto print:p-0 print:bg-white print:max-h-none print:overflow-visible">
          <div
            id="thermal-receipt-sheet"
            className={`bg-white border border-stone-200 rounded-lg p-4 text-stone-900 font-mono-num text-xs leading-relaxed print:border-0 print:rounded-none print:p-0 ${
              paperWidth === '58mm' ? 'w-[220px] thermal-58mm' : 'w-[302px] thermal-80mm'
            }`}
          >
            <div className="text-center pb-2.5 border-b border-dashed border-stone-300">
              <div className="text-sm font-bold tracking-tight uppercase">{settings?.name || 'JuiceFlow'}</div>
              {settings?.location && (
                <div className="text-[11px] text-stone-600 mt-0.5">{settings.location}</div>
              )}
            </div>

            <div className="py-2.5 space-y-0.5 border-b border-dashed border-stone-300 text-[11px]">
              <div className="flex justify-between">
                <span className="text-stone-500">Order</span>
                <span className="font-semibold">{sale.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Time (ICT)</span>
                <span>{formatDateTimeInPhnomPenh(sale.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Cashier</span>
                <span>{sale.recordedBy}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Payment</span>
                <span className="uppercase font-semibold">{sale.paymentMethod || 'cash'}</span>
              </div>
              {sale.customerName && sale.customerName !== 'Walk-in' && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Customer</span>
                  <span>{sale.customerName}</span>
                </div>
              )}
              {sale.status && sale.status !== 'completed' && (
                <div className="flex justify-between text-rose-700 font-bold">
                  <span>Status</span>
                  <span className="uppercase">{String(sale.status).replace('_', ' ')}</span>
                </div>
              )}
            </div>

            <div className="py-2.5 space-y-2 border-b border-dashed border-stone-300">
              {(Array.isArray(sale.items) ? sale.items : []).map((item, i) => (
                <div key={item.lineId || `${item.productId}_${i}`}>
                  <div className="flex justify-between gap-2 font-medium">
                    <span className="truncate">
                      {item.quantity}x {item.productName}
                      {item.variantName ? ` (${item.variantName})` : ''}
                    </span>
                    <span className="shrink-0">{formatKhr(item.lineTotalKhr)}</span>
                  </div>
                  <div className="text-[10px] text-stone-500">
                    @ {formatKhr(item.unitPriceKhr)}
                    {item.returnedQty && item.returnedQty > 0 ? ` • Returned: -${item.returnedQty}` : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="py-2.5 space-y-1 border-b border-dashed border-stone-300">
              <div className="flex justify-between">
                <span className="text-stone-600">Subtotal</span>
                <span>{formatKhr(sale.subtotalKhr ?? sale.totalKhr)}</span>
              </div>
              {sale.refundedKhr && sale.refundedKhr > 0 ? (
                <div className="flex justify-between text-rose-700">
                  <span>Refunded</span>
                  <span>-{formatKhr(sale.refundedKhr)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-sm font-bold pt-1">
                <span>TOTAL</span>
                <span>{formatKhr(netAmount)}</span>
              </div>
              {(settings?.usdRate ?? 0) > 0 && (
                <div className="flex justify-between text-[11px] text-stone-500">
                  <span>USD Equivalent</span>
                  <span>{formatUsdRef(netAmount, settings.usdRate)}</span>
                </div>
              )}
              {sale.paymentMethod === 'cash' &&
                ((sale.cash_received_usd !== null && sale.cash_received_usd !== undefined) ||
                  (sale.cash_received_khr !== null && sale.cash_received_khr !== undefined)) && (
                  <div className="pt-1.5 mt-1.5 border-t border-dashed border-stone-200 space-y-0.5 text-[11px]">
                    {(sale.cash_received_usd ?? 0) > 0 && (
                      <div className="flex justify-between text-stone-600">
                        <span>Cash (USD)</span>
                        <span>
                          {formatUsdClean(sale.cash_received_usd ?? 0)} @{' '}
                          {(sale.exchange_rate_used ?? settings?.posExchangeRate ?? 4000).toLocaleString(
                            'en-US'
                          )}{' '}
                          ៛
                        </span>
                      </div>
                    )}
                    {(sale.cash_received_khr ?? 0) > 0 && (
                      <div className="flex justify-between text-stone-600">
                        <span>Cash (KHR)</span>
                        <span>{formatKhr(sale.cash_received_khr ?? 0)}</span>
                      </div>
                    )}
                    {sale.change_given_khr !== null && sale.change_given_khr !== undefined && (
                      <div className="flex justify-between font-semibold text-stone-900">
                        <span>Change (KHR)</span>
                        <span>{formatKhr(sale.change_given_khr)}</span>
                      </div>
                    )}
                  </div>
                )}
            </div>

            {sale.note && (
              <div className="py-2 text-[11px] text-stone-600 border-b border-dashed border-stone-300">
                Note: {sale.note}
              </div>
            )}

            <div className="pt-2.5 text-center text-[11px] text-stone-500">
              Thank you for supporting {settings?.name || 'JuiceFlow'}!
            </div>
          </div>
        </div>

        {/* Footer Actions (hidden on print, 44px-48px touch targets) */}
        <div className="px-5 py-3.5 border-t border-stone-200 dark:border-[#24352C] flex items-center justify-end gap-2.5 print:hidden">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 h-12 px-4 text-sm font-semibold text-stone-700 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-xl transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399]" /> : <Copy className="w-4 h-4" />}
            {copied ? (isVi ? 'Đã sao chép!' : 'Copied!') : isVi ? 'Sao chép' : 'Copy Summary'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 h-12 px-4 text-sm font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4633] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-xl transition-colors"
          >
            <Printer className="w-4 h-4" />
            {isVi ? `In nhiệt (${paperWidth})` : `Print Thermal (${paperWidth})`}
          </button>
        </div>
      </div>
    </div>
  );
};
