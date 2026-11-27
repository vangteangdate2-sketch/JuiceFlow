import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Keyboard, ScanBarcode, X } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.QR_CODE,
];

async function safeStopAndClear(scanner: Html5Qrcode | null): Promise<void> {
  if (!scanner) return;
  try {
    if (scanner.isScanning) {
      await scanner.stop();
    }
  } catch {
    // Ignore errors when scanner is already stopped, paused, or failed to start
  }
  try {
    scanner.clear();
  } catch {
    // Ignore DOM cleanup errors if container was already unmounted
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  open,
  title = 'Scan Barcode',
  subtitle = 'Point camera at product or carton barcode, or type code manually below.',
  onDetected,
  onClose,
}) => {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const containerId = `jf_scanner_${reactId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectedOnceRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    if (!open) return;

    detectedOnceRef.current = false;
    setCameraError(null);
    setCameraActive(false);
    setManualCode('');

    let cancelled = false;

    const startCamera = async () => {
      if (cancelled) return;
      const mountEl = document.getElementById(containerId);
      if (!mountEl) return;

      let instance: Html5Qrcode | null = null;
      try {
        instance = new Html5Qrcode(containerId, {
          formatsToSupport: SUPPORTED_FORMATS,
          verbose: false,
        });
        scannerRef.current = instance;

        await instance.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 260, height: 140 },
            aspectRatio: 1.5,
          },
          (decodedText) => {
            if (cancelled || detectedOnceRef.current) return;
            const cleaned = decodedText.trim();
            if (!cleaned) return;
            detectedOnceRef.current = true;
            const toStop = scannerRef.current;
            scannerRef.current = null;
            void safeStopAndClear(toStop);
            onDetectedRef.current(cleaned);
            onCloseRef.current();
          },
          () => {
            // Ignore per-frame decode misses
          }
        );

        if (cancelled) {
          scannerRef.current = null;
          await safeStopAndClear(instance);
          return;
        }

        setCameraActive(true);
      } catch (err) {
        if (scannerRef.current === instance) {
          scannerRef.current = null;
        }
        await safeStopAndClear(instance);
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : 'Camera access unavailable on this device.';
          setCameraError(
            msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
              ? 'Camera permission denied. Use a USB/Bluetooth scanner or enter the barcode manually below.'
              : 'Camera unavailable in this browser. Enter the barcode manually below.'
          );
        }
      }
    };

    // Delay slightly to ensure DOM container is mounted
    const timer = window.setTimeout(() => {
      void startCamera();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const active = scannerRef.current;
      scannerRef.current = null;
      void safeStopAndClear(active);
    };
  }, [open, containerId]);

  if (!open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.trim();
    if (!cleaned) return;
    onDetectedRef.current(cleaned);
    onCloseRef.current();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 animate-backdrop">
      <div className="w-full max-w-md bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl shadow-xl overflow-hidden animate-modal">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-[#24352C]">
          <div className="flex items-center gap-2.5">
            <ScanBarcode className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399]" />
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-[#F1F5F3]">{title}</h3>
              <p className="text-xs text-stone-500 dark:text-[#94A39B]">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative rounded-lg overflow-hidden bg-stone-950 border border-stone-200 dark:border-[#24352C] min-h-[220px] flex items-center justify-center">
            <div id={containerId} className="w-full" />
            {!cameraActive && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-300 text-xs px-4 text-center">
                <Camera className="w-7 h-7 text-stone-400" />
                <span>Starting rear camera viewfinder…</span>
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-900/95 text-stone-200 text-xs px-6 text-center">
                <Camera className="w-7 h-7 text-amber-400" />
                <p className="leading-relaxed">{cameraError}</p>
              </div>
            )}
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-2.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
              <Keyboard className="w-3.5 h-3.5 text-stone-500 dark:text-[#94A39B]" />
              Manual Barcode / SKU Entry
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="e.g. 8851959132012"
                data-barcode-capture="true"
                autoFocus
                className="flex-1 h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-300 dark:border-[#24352C] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F5C43]/30 dark:focus:ring-[#10B981]/40 focus:border-[#0F5C43] dark:focus:border-[#10B981]"
              />
              <button
                type="submit"
                className="h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4633] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
              >
                Use Code
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
