import React, { useState } from 'react';
import { Check, Copy, Printer, X } from 'lucide-react';
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
  const lines: string[] = [
    settings.name.toUpperCase(),
    settings.location || 'Phnom Penh, Cambodia',
    divider,
    `Order: ${sale.orderNumber}`,
    `Date:  ${formatDateTimeInPhnomPenh(sale.createdAt)} (ICT)`,
    `Staff: ${sale.recordedBy}`,
    `Pay:   ${sale.paymentMethod.toUpperCase()}`,
  ];
  if (sale.customerName && sale.customerName !== 'Walk-in') {
    lines.push(`Cust:  ${sale.customerName}`);
  }
  lines.push(divider);

  for (const item of sale.items) {
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
  if (settings.usdRate > 0) {
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
    const rate = sale.exchange_rate_used ?? settings.posExchangeRate ?? 4000;
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
  if (sale.status !== 'completed') {
    lines.push(`STATUS:   ${sale.status.toUpperCase()}`);
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

  const netAmount =
    sale.status === 'voided'
      ? 0
      : sale.netTotalKhr ?? Math.max(0, sale.totalKhr - (sale.refundedKhr ?? 0));

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 print:bg-white print:p-0 print:static">
      <div className="w-full max-w-md bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden print:border-0 print:shadow-none print:max-w-none">
        {/* Modal Header (hidden on print) */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 print:hidden">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-stone-900">Receipt {sale.orderNumber}</h3>
            <div className="flex border border-stone-200 rounded-lg overflow-hidden text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 transition-colors ${
                  paperWidth === '58mm'
                    ? 'bg-[#0F5C43] text-white'
                    : 'bg-stone-50 text-stone-600 hover:bg-stone-100'
                }`}
              >
                58mm
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 transition-colors ${
                  paperWidth === '80mm'
                    ? 'bg-[#0F5C43] text-white'
                    : 'bg-stone-50 text-stone-600 hover:bg-stone-100'
                }`}
              >
                80mm
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100"
            aria-label="Close receipt"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Thermal Receipt Preview */}
        <div className="p-5 bg-stone-50 flex justify-center max-h-[65vh] overflow-y-auto print:p-0 print:bg-white print:max-h-none print:overflow-visible">
          <div
            id="thermal-receipt-sheet"
            className={`bg-white border border-stone-200 rounded-lg p-4 text-stone-900 font-mono-num text-xs leading-relaxed print:border-0 print:rounded-none print:p-0 ${
              paperWidth === '58mm' ? 'w-[220px] thermal-58mm' : 'w-[302px] thermal-80mm'
            }`}
          >
            <div className="text-center pb-2.5 border-b border-dashed border-stone-300">
              <div className="text-sm font-bold tracking-tight uppercase">{settings.name}</div>
              {settings.location && (
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
                <span className="uppercase font-semibold">{sale.paymentMethod}</span>
              </div>
              {sale.customerName && sale.customerName !== 'Walk-in' && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Customer</span>
                  <span>{sale.customerName}</span>
                </div>
              )}
              {sale.status !== 'completed' && (
                <div className="flex justify-between text-rose-700 font-bold">
                  <span>Status</span>
                  <span className="uppercase">{sale.status.replace('_', ' ')}</span>
                </div>
              )}
            </div>

            <div className="py-2.5 space-y-2 border-b border-dashed border-stone-300">
              {sale.items.map((item, i) => (
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
              {settings.usdRate > 0 && (
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
                          {(sale.exchange_rate_used ?? settings.posExchangeRate ?? 4000).toLocaleString(
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
              Thank you for supporting {settings.name}!
            </div>
          </div>
        </div>

        {/* Footer Actions (hidden on print) */}
        <div className="px-5 py-3.5 border-t border-stone-200 flex items-center justify-end gap-2.5 print:hidden">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-[#0F5C43]" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy Summary'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4633] rounded-lg transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Thermal ({paperWidth})
          </button>
        </div>
      </div>
    </div>
  );
};
