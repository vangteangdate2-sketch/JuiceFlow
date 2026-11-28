import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Keyboard, RefreshCw, ScanBarcode, SwitchCamera, X } from 'lucide-react';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from 'html5-qrcode';
import { ModalPortal } from './ModalPortal';
import { useLanguage } from '../context/LanguageContext';

interface BarcodeScannerModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.QR_CODE,
];

function pickPreferredCameraIndex(cameras: CameraDevice[]): number {
  if (cameras.length <= 1) return 0;
  const rearIdx = cameras.findIndex((cam) =>
    /back|rear|environment|world|tr sau/i.test(cam.label || '')
  );
  return rearIdx >= 0 ? rearIdx : 0;
}

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
  title,
  subtitle,
  onDetected,
  onClose,
}) => {
  const { isKm } = useLanguage();
  const resolvedTitle = title ?? (isKm ? 'ស្កេនបាកូដ' : 'Scan Barcode');
  const resolvedSubtitle =
    subtitle ??
    (isKm
      ? 'តម្រង់កាមេរ៉ាទៅលើបាកូដ EAN-13, UPC-A ឬ SKU ឬវាយបញ្ចូលខាងក្រោម។'
      : 'Point camera at an EAN-13, UPC-A, or SKU barcode, or enter it manually below.');
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const containerId = `jf_scanner_${reactId}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectedOnceRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraIdx, setSelectedCameraIdx] = useState<number>(0);
  const [cameraRetryTick, setCameraRetryTick] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Reset camera list when modal opens
  useEffect(() => {
    if (!open) return;
    setManualCode('');
    setCameras([]);
    setSelectedCameraIdx(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    detectedOnceRef.current = false;
    setCameraError(null);
    setCameraActive(false);

    let cancelled = false;

    const startCamera = async () => {
      if (cancelled) return;
      const mountEl = document.getElementById(containerId);
      if (!mountEl) return;

      let instance: Html5Qrcode | null = null;
      try {
        instance = new Html5Qrcode(containerId, {
          formatsToSupport: SUPPORTED_FORMATS,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
          verbose: false,
        });
        scannerRef.current = instance;

        const scanConfig = {
          fps: 12,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const width = Math.max(180, Math.min(300, Math.round(viewfinderWidth * 0.82)));
            const height = Math.max(96, Math.min(150, Math.round(viewfinderHeight * 0.52)));
            return { width, height };
          },
          aspectRatio: 1.5,
        };

        const handleSuccess = (decodedText: string) => {
          if (cancelled || detectedOnceRef.current) return;
          const cleaned = decodedText.trim();
          if (!cleaned) return;
          detectedOnceRef.current = true;
          try {
            navigator.vibrate?.(60);
          } catch {
            // Ignore vibration unsupported
          }
          const toStop = scannerRef.current;
          scannerRef.current = null;
          void safeStopAndClear(toStop);
          onDetectedRef.current(cleaned);
          onCloseRef.current();
        };

        const handleFrameMiss = () => {
          // Ignore per-frame decode misses
        };

        // Determine available cameras so we can support rear preference, desktop webcams, and switching
        let availableCameras = cameras;
        if (availableCameras.length === 0) {
          try {
            availableCameras = await Html5Qrcode.getCameras();
            if (!cancelled && availableCameras.length > 0) {
              setCameras(availableCameras);
            }
          } catch {
            availableCameras = [];
          }
        }

        if (cancelled) {
          scannerRef.current = null;
          await safeStopAndClear(instance);
          return;
        }

        let started = false;
        const explicitCam =
          availableCameras.length > 0
            ? availableCameras[selectedCameraIdx % availableCameras.length]
            : null;

        // If user explicitly switched cameras or we found a specific camera device, try it directly
        if (explicitCam && cameras.length > 0) {
          try {
            await instance.start(explicitCam.id, scanConfig, handleSuccess, handleFrameMiss);
            started = true;
          } catch {
            started = false;
          }
        }

        // First open: prefer environment (rear) camera, then gracefully fall back to any available camera
        if (!started) {
          try {
            await instance.start(
              { facingMode: 'environment' },
              scanConfig,
              handleSuccess,
              handleFrameMiss
            );
            started = true;
          } catch {
            if (availableCameras.length > 0) {
              const preferredIdx = pickPreferredCameraIndex(availableCameras);
              const fallbackCam = availableCameras[preferredIdx];
              if (!cancelled) {
                setSelectedCameraIdx(preferredIdx);
              }
              await instance.start(fallbackCam.id, scanConfig, handleSuccess, handleFrameMiss);
              started = true;
            } else {
              // Last fallback: default user-facing camera
              await instance.start(
                { facingMode: 'user' },
                scanConfig,
                handleSuccess,
                handleFrameMiss
              );
              started = true;
            }
          }
        }

        if (cancelled) {
          scannerRef.current = null;
          await safeStopAndClear(instance);
          return;
        }

        if (started) {
          setCameraActive(true);
        }
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
              ? isKm
                ? 'មិនទាន់អនុញ្ញាតកាមេរ៉ា។ សូមអនុញ្ញាតកាមេរ៉ាក្នុងកម្មវិធីរុករក ឬវាយបញ្ចូលបាកូដខាងក្រោម។'
                : 'Camera permission denied. Allow camera access in your browser or enter the barcode manually below.'
              : isKm
                ? 'មិនអាចបើកកាមេរ៉ានៅលើឧបករណ៍នេះទេ។ អ្នកអាចវាយបញ្ចូលកូដ EAN-13 / UPC-A ខាងក្រោមបាន។'
                : 'Camera unavailable on this device or browser. You can enter the EAN-13 / UPC-A code manually below.'
          );
        }
      }
    };

    // Delay slightly to ensure DOM container is mounted inside ModalPortal
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, containerId, selectedCameraIdx, cameraRetryTick]);

  if (!open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.trim();
    if (!cleaned) return;
    onDetectedRef.current(cleaned);
    onCloseRef.current();
  };

  const handleSwitchCamera = () => {
    if (cameras.length < 2) return;
    setSelectedCameraIdx((prev) => (prev + 1) % cameras.length);
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-md bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 rounded-2xl shadow-2xl overflow-hidden animate-modal">
          <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-[#24352C]">
            <div className="flex items-center gap-2.5 min-w-0">
              <ScanBarcode className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="min-w-0">
                <h3 className="text-base font-bold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {resolvedTitle}
                </h3>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">{resolvedSubtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] transition-colors shrink-0"
              aria-label={isKm ? 'បិទម៉ាស៊ីនស្កេន' : 'Close scanner'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-stone-950 border border-stone-200 dark:border-[#24352C] min-h-[240px] flex items-center justify-center">
              <div id={containerId} className="w-full" />

              {cameraActive && (
                <>
                  <div className="pointer-events-none absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/65 backdrop-blur-xs text-[11px] font-semibold text-emerald-300 border border-emerald-400/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    EAN-13 · UPC-A · SKU
                  </div>
                  {cameras.length > 1 && (
                    <button
                      type="button"
                      onClick={handleSwitchCamera}
                      className="absolute top-2.5 right-2.5 h-9 px-2.5 inline-flex items-center gap-1.5 rounded-lg bg-black/65 hover:bg-black/80 backdrop-blur-xs text-xs font-medium text-white border border-white/15 transition-colors"
                      title={isKm ? 'ប្ដូរកាមេរ៉ា' : 'Switch camera'}
                    >
                      <SwitchCamera className="w-3.5 h-3.5" />
                      <span>{isKm ? 'ប្ដូរ' : 'Switch'}</span>
                    </button>
                  )}
                </>
              )}

              {!cameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-300 text-xs px-4 text-center">
                  <Camera className="w-7 h-7 text-stone-400 animate-pulse" />
                  <span>{isKm ? 'កំពុងបើកកាមេរ៉ា...' : 'Starting camera viewfinder…'}</span>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-900/95 text-stone-200 text-xs px-6 text-center">
                  <Camera className="w-7 h-7 text-amber-400" />
                  <p className="leading-relaxed">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => setCameraRetryTick((n) => n + 1)}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {isKm ? 'ព្យាយាមម្ដងទៀត' : 'Retry Camera'}
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-2.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA]">
                <Keyboard className="w-3.5 h-3.5 text-stone-500 dark:text-[#94A39B]" />
                {isKm ? 'វាយបញ្ចូលកូដ EAN-13 / UPC-A / SKU' : 'Manual EAN-13 / UPC-A / SKU Entry'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="e.g. 8851959132012 or 049000042566"
                  data-barcode-capture="true"
                  className="flex-1 h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-300 dark:border-[#24352C] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F5C43]/30 dark:focus:ring-[#10B981]/40 focus:border-[#0F5C43] dark:focus:border-[#10B981]"
                />
                <button
                  type="submit"
                  className="h-11 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4633] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                >
                  {isKm ? 'ស្វែងរក' : 'Search'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
