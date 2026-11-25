import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Keyboard,
  RefreshCw,
  ScanBarcode,
  Search,
  Usb,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

export type BarcodeScanSource = 'hardware' | 'camera' | 'manual';

export interface BarcodeScanResult {
  ok: boolean;
  code: string;
  message: string;
  source: BarcodeScanSource;
  timestamp: number;
}

export interface BarcodeScannerProps {
  /** Whether global USB/Bluetooth HID keyboard-wedge capture is allowed (e.g. disabled while modals are open) */
  enabled: boolean;
  isVi?: boolean;
  /** Controlled product search text shared with the POS catalog filter */
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Called whenever a barcode is captured from USB/BT scanner, camera, or manual Enter */
  onScan: (
    barcode: string,
    source: BarcodeScanSource
  ) =>
    | { ok: boolean; message: string; suppressToast?: boolean }
    | Promise<{ ok: boolean; message: string; suppressToast?: boolean }>;
  /** Optional quick check to know whether Enter in the search input matches a product barcode */
  hasBarcodeMatch?: (code: string) => boolean;
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

function playScanTone(success: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(success ? 1046.5 : 280, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.11 : 0.22));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.12 : 0.24));
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Audio feedback is strictly optional
  }
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  enabled,
  isVi = false,
  searchValue,
  onSearchChange,
  onScan,
  hasBarcodeMatch,
}) => {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const viewfinderId = `jf_cam_scanner_${reactId}`;

  // Hardware USB / Bluetooth HID scanner state
  const [hardwareEnabled, setHardwareEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<BarcodeScanResult | null>(null);

  // Camera panel state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [sessionScanCount, setSessionScanCount] = useState(0);

  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);
  const lastCameraDecodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const continuousModeRef = useRef(continuousMode);
  continuousModeRef.current = continuousMode;

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const dispatchScan = useCallback(async (rawCode: string, source: BarcodeScanSource) => {
    const cleaned = rawCode.trim();
    if (!cleaned) return { ok: false, message: '' };

    const outcome = await onScanRef.current(cleaned, source);
    if (soundEnabledRef.current) {
      playScanTone(outcome.ok);
    }
    if (outcome.suppressToast) {
      setLastScan(null);
    } else {
      setLastScan({
        ok: outcome.ok,
        code: cleaned,
        message: outcome.message,
        source,
        timestamp: Date.now(),
      });
    }
    if (source === 'camera' && outcome.ok) {
      setSessionScanCount((c) => c + 1);
    }
    return outcome;
  }, []);

  // Global USB / Bluetooth HID keyboard-wedge listener (active even if camera panel is open)
  useBarcodeScanner({
    enabled: enabled && hardwareEnabled,
    onScan: (code) => {
      void dispatchScan(code, 'hardware');
      onSearchChange('');
      setManualCode('');
    },
  });

  // Enumerate cameras when opening camera drawer
  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    setSessionScanCount(0);

    Html5Qrcode.getCameras()
      .then((devices) => {
        if (cancelled) return;
        const mapped = devices.map((d, idx) => ({
          id: d.id,
          label: d.label || `${isVi ? 'Camera' : 'Camera'} ${idx + 1}`,
        }));
        setCameras(mapped);
        if (mapped.length > 0 && !selectedCameraId) {
          const backCam = mapped.find((c) =>
            /back|rear|environment/i.test(c.label)
          );
          setSelectedCameraId((backCam || mapped[0]).id);
        }
      })
      .catch(() => {
        // Fallback to facingMode: 'environment' below
      });

    return () => {
      cancelled = true;
    };
  }, [cameraOpen, isVi, selectedCameraId]);

  // Start / stop live camera viewfinder
  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;
    setCameraError(null);
    setCameraActive(false);
    lastCameraDecodeRef.current = { code: '', at: 0 };

    const stopExisting = async () => {
      const existing = scannerInstanceRef.current;
      scannerInstanceRef.current = null;
      if (!existing) return;
      try {
        if (existing.isScanning) {
          await existing.stop();
        }
      } catch {
        // Ignore stop errors if already stopped or never started
      }
      try {
        existing.clear();
      } catch {
        // Ignore clear errors
      }
    };

    const startCamera = async () => {
      await stopExisting();
      if (cancelled) return;
      if (!document.getElementById(viewfinderId)) return;

      try {
        const instance = new Html5Qrcode(viewfinderId, {
          formatsToSupport: SUPPORTED_FORMATS,
          verbose: false,
        });
        scannerInstanceRef.current = instance;

        const cameraConstraint: string | { facingMode: string } = selectedCameraId
          ? selectedCameraId
          : { facingMode: 'environment' };

        await instance.start(
          cameraConstraint,
          {
            fps: 10,
            qrbox: { width: 250, height: 130 },
            aspectRatio: 1.6,
          },
          (decodedText) => {
            if (cancelled) return;
            const cleaned = decodedText.trim();
            if (!cleaned) return;

            const now = Date.now();
            const prev = lastCameraDecodeRef.current;
            // Cooldown prevents accidental rapid re-scans of the same barcode held in frame
            if (prev.code === cleaned && now - prev.at < 1500) {
              return;
            }
            lastCameraDecodeRef.current = { code: cleaned, at: now };

            void dispatchScan(cleaned, 'camera').then((outcome) => {
              if (outcome.ok && !continuousModeRef.current) {
                void stopExisting();
                setCameraOpen(false);
              }
            });
          },
          () => {
            // Per-frame decode miss (normal while aiming)
          }
        );

        if (cancelled) {
          await stopExisting();
          return;
        }

        setCameraActive(true);
      } catch (err) {
        await stopExisting();
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : '';
          setCameraError(
            /permission|denied|notallowed/i.test(msg)
              ? isVi
                ? 'Chưa cấp quyền camera. Bạn vẫn có thể dùng máy quét USB/Bluetooth hoặc nhập mã thủ công bên dưới.'
                : 'Camera permission denied. You can still use a USB/Bluetooth scanner or type the barcode below.'
              : isVi
                ? 'Không tìm thấy camera trên thiết bị này. Hãy dùng máy quét USB/Bluetooth hoặc nhập mã bên dưới.'
                : 'No camera detected on this device. Use a USB/Bluetooth scanner or enter the barcode manually below.'
          );
        }
      }
    };

    const timer = window.setTimeout(() => {
      void startCamera();
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void stopExisting();
    };
  }, [cameraOpen, selectedCameraId, viewfinderId, dispatchScan, isVi]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const code = searchValue.trim();
    if (!code) return;
    const looksLikeBarcode =
      /^[0-9]{6,14}$/.test(code) || /^JF-[A-Z0-9-]+$/i.test(code);
    if (!hasBarcodeMatch || hasBarcodeMatch(code) || looksLikeBarcode) {
      e.preventDefault();
      void dispatchScan(code, 'manual');
      onSearchChange('');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.trim();
    if (!cleaned) return;
    setManualCode('');
    void dispatchScan(cleaned, 'manual').then((res) => {
      if (res.ok && !continuousMode) {
        setCameraOpen(false);
      }
    });
  };

  const handleCycleCamera = () => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.id === selectedCameraId);
    const next = cameras[(idx + 1) % cameras.length];
    setSelectedCameraId(next.id);
  };

  const sourceLabel = (source: BarcodeScanSource) => {
    if (source === 'hardware') return 'USB / BT';
    if (source === 'camera') return isVi ? 'Camera' : 'Camera';
    return isVi ? 'Nhập tay' : 'Manual';
  };

  return (
    <div className="space-y-2.5">
      {/* Primary Search + Scanner Action Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            data-barcode-capture="true"
            placeholder={
              isVi
                ? 'Tìm tên sản phẩm hoặc quét / nhập mã vạch + Enter...'
                : 'Search products or scan / type barcode + Enter...'
            }
            className="w-full pl-9 pr-8 py-2.5 text-sm border border-stone-200 rounded-lg bg-white text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={isVi ? 'Xóa tìm kiếm' : 'Clear search'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-stone-400 hover:text-stone-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* USB / Bluetooth HID Scanner Toggle */}
          <button
            type="button"
            onClick={() => setHardwareEnabled((prev) => !prev)}
            title={
              isVi
                ? 'Bật/tắt nhận tín hiệu trực tiếp từ máy quét mã vạch USB hoặc Bluetooth'
                : 'Toggle external USB / Bluetooth barcode scanner listening'
            }
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              hardwareEnabled
                ? 'border-[#0F5C43]/30 bg-emerald-50/70 text-[#0F5C43]'
                : 'border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-800'
            }`}
          >
            <Usb className="w-4 h-4 shrink-0" />
            <span>
              {hardwareEnabled
                ? isVi
                  ? 'USB/BT Sẵn sàng'
                  : 'USB/BT Ready'
                : isVi
                  ? 'USB/BT Tạm dừng'
                  : 'USB/BT Paused'}
            </span>
          </button>

          {/* Audio Beep Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            aria-label={soundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
            title={
              soundEnabled
                ? isVi
                  ? 'Tắt âm thanh báo quét'
                  : 'Mute scan beep'
                : isVi
                  ? 'Bật âm thanh báo quét'
                  : 'Enable scan beep'
            }
            className="p-2.5 border border-stone-200 rounded-lg text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors shrink-0"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-stone-400" />}
          </button>

          {/* Camera Scanner Launch Button */}
          <button
            type="button"
            onClick={() => setCameraOpen((prev) => !prev)}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              cameraOpen
                ? 'bg-stone-900 text-white hover:bg-stone-800'
                : 'bg-[#0F5C43] text-white hover:bg-[#0B4734]'
            }`}
          >
            <ScanBarcode className="w-4 h-4 shrink-0" />
            <span>
              {cameraOpen
                ? isVi
                  ? 'Đóng Camera'
                  : 'Close Camera'
                : isVi
                  ? 'Quét Camera'
                  : 'Camera Scan'}
            </span>
          </button>
        </div>
      </div>

      {/* Inline Last-Scan Feedback Line (Unboxed clean metadata strip) */}
      {lastScan && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-xs ${
            lastScan.ok
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {lastScan.ok ? (
              <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
            )}
            <span className="font-medium truncate">{lastScan.message}</span>
            <span aria-hidden="true" className="text-stone-400">
              ·
            </span>
            <span className="font-mono-num text-[11px] opacity-80 shrink-0">{lastScan.code}</span>
            <span aria-hidden="true" className="text-stone-400 hidden sm:inline">
              ·
            </span>
            <span className="text-[11px] opacity-75 hidden sm:inline shrink-0">
              {sourceLabel(lastScan.source)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastScan(null)}
            aria-label={isVi ? 'Đóng thông báo' : 'Dismiss'}
            className="p-0.5 opacity-60 hover:opacity-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Expandable Live Camera Scanner Panel (Inline above product grid so cart stays visible) */}
      {cameraOpen && (
        <div className="border-t border-stone-200 pt-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-stone-700">
              <Camera className="w-4 h-4 text-[#0F5C43] shrink-0" />
              <span className="font-semibold text-stone-900">
                {isVi ? 'Máy quét mã vạch bằng Camera' : 'Live Camera Barcode Scanner'}
              </span>
              {sessionScanCount > 0 && (
                <>
                  <span aria-hidden="true" className="text-stone-300">
                    ·
                  </span>
                  <span className="font-mono-num text-[#0F5C43] font-semibold">
                    {sessionScanCount} {isVi ? 'món đã thêm' : 'added'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Continuous vs Single-Scan Segmented Control */}
              <div className="inline-flex items-center p-0.5 bg-stone-100 rounded-lg text-[11px]">
                <button
                  type="button"
                  onClick={() => setContinuousMode(true)}
                  className={`px-2.5 py-1 font-semibold rounded-md transition-colors whitespace-nowrap ${
                    continuousMode ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                  }`}
                >
                  {isVi ? 'Quét liên tục' : 'Multi-Scan'}
                </button>
                <button
                  type="button"
                  onClick={() => setContinuousMode(false)}
                  className={`px-2.5 py-1 font-semibold rounded-md transition-colors whitespace-nowrap ${
                    !continuousMode ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                  }`}
                >
                  {isVi ? 'Quét 1 lần' : 'Single'}
                </button>
              </div>

              {cameras.length > 1 && (
                <button
                  type="button"
                  onClick={handleCycleCamera}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 rounded-lg whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isVi ? 'Đổi camera' : 'Switch'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
            {/* Live Camera Viewfinder */}
            <div className="md:col-span-7 relative rounded-lg overflow-hidden bg-stone-950 border border-stone-200 min-h-[210px] flex items-center justify-center">
              <div id={viewfinderId} className="w-full" />
              {!cameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-300 text-xs px-4 text-center">
                  <Camera className="w-6 h-6 text-stone-400" />
                  <span>
                    {isVi ? 'Đang khởi động camera...' : 'Starting camera viewfinder...'}
                  </span>
                </div>
              )}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-900/95 text-stone-200 text-xs px-6 text-center">
                  <Camera className="w-6 h-6 text-amber-400" />
                  <p className="leading-relaxed max-w-xs">{cameraError}</p>
                </div>
              )}
            </div>

            {/* Quick Manual / Hardware Entry Fallback beside viewfinder */}
            <div className="md:col-span-5 flex flex-col justify-between gap-3 bg-stone-50 border border-stone-200 rounded-lg p-3.5">
              <div className="space-y-1.5 text-xs text-stone-600">
                <p className="font-semibold text-stone-900 flex items-center gap-1.5">
                  <Keyboard className="w-3.5 h-3.5 text-[#0F5C43]" />
                  {isVi ? 'Nhập mã nhanh hoặc máy quét rời' : 'Manual Entry or USB/BT Scan'}
                </p>
                <p className="leading-relaxed">
                  {isVi
                    ? 'Hỗ trợ mã vạch sản phẩm (EAN-13, UPC, Code-128), mã biến thể kích cỡ và mã thùng.'
                    : 'Supports EAN-13, UPC, Code-128, QR, size-variant codes, and carton barcodes.'}
                </p>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="e.g. 8851959132012"
                  data-barcode-capture="true"
                  className="w-full px-3 py-2 text-sm font-mono-num bg-white border border-stone-300 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="w-full py-2 px-3 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                >
                  {isVi ? 'Thêm vào giỏ hàng' : 'Add to Cart'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
