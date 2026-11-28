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
  isKm?: boolean;
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
  /** Optional left-aligned controls rendered in the compact status row (e.g. Show/Hide Filters toggle) */
  secondaryLeftSlot?: React.ReactNode;
  /** Optional right-aligned controls rendered in the compact status row (e.g. Reset All button) */
  secondaryRightSlot?: React.ReactNode;
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
  isKm = false,
  searchValue,
  onSearchChange,
  onScan,
  hasBarcodeMatch,
  secondaryLeftSlot,
  secondaryRightSlot,
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
          label: d.label || `${isKm ? 'កាមេរ៉ា' : 'Camera'} ${idx + 1}`,
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
  }, [cameraOpen, isKm, selectedCameraId]);

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
              ? isKm
                ? 'មិនទាន់អនុញ្ញាតកាមេរ៉ា។ អ្នកនៅតែអាចប្រើម៉ាស៊ីនស្កេន USB/Bluetooth ឬវាយបាកូដខាងក្រោមបាន។'
                : 'Camera permission denied. You can still use a USB/Bluetooth scanner or type the barcode below.'
              : isKm
                ? 'រកមិនឃើញកាមេរ៉ានៅលើឧបករណ៍នេះទេ។ សូមប្រើម៉ាស៊ីនស្កេន USB/Bluetooth ឬវាយបាកូដខាងក្រោម។'
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
  }, [cameraOpen, selectedCameraId, viewfinderId, dispatchScan, isKm]);

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
    if (source === 'camera') return isKm ? 'កាមេរ៉ា' : 'Camera';
    return isKm ? 'វាយបញ្ចូល' : 'Manual';
  };

  return (
    <div className="space-y-3">
      {/* Row 1: Integrated Search + Scan Input (10px radius, 48px touch height) & Adjacent Audio Beep Toggle */}
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0 flex items-center h-12 rounded-[10px] border border-stone-200 dark:border-[#24352C] bg-stone-50/50 dark:bg-[#18251F] focus-within:bg-white dark:focus-within:bg-[#18251F] focus-within:border-[#0D5C3E] dark:focus-within:border-[#10B981] focus-within:ring-2 focus-within:ring-[#0D5C3E]/20 dark:focus-within:ring-[#10B981]/25 transition-all">
          <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] ml-3.5 shrink-0 pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            data-barcode-capture="true"
            placeholder={isKm ? 'ស្វែងរក...' : 'Search'}
            className="flex-1 min-w-0 h-full px-2.5 text-sm bg-transparent text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus:outline-none"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={isKm ? 'សម្អាតការស្វែងរក' : 'Clear search'}
              className="inline-flex items-center justify-center w-11 h-11 text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3] rounded-md shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <div className="pr-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setCameraOpen((prev) => !prev)}
              aria-expanded={cameraOpen}
              className={`inline-flex items-center justify-center gap-1.5 h-11 px-3.5 text-xs font-semibold rounded-[8px] transition-all duration-150 active:scale-[0.97] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981] ${
                cameraOpen
                  ? 'bg-stone-800 text-white hover:bg-stone-900 dark:bg-[#1F3028] dark:text-[#F1F5F3] dark:hover:bg-[#2A3F35]'
                  : 'bg-[#0D5C3E] text-white hover:bg-[#0A4A31] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399]'
              }`}
            >
              <ScanBarcode className="w-4 h-4 shrink-0" />
              <span>
                {cameraOpen
                  ? isKm
                    ? 'បិទ'
                    : 'Close'
                  : isKm
                    ? 'ស្កេន'
                    : 'Scan'}
              </span>
            </button>
          </div>
        </div>

        {/* Audio Beep Toggle directly to the right of the search bar (48x48 touch target) */}
        <button
          type="button"
          onClick={() => setSoundEnabled((prev) => !prev)}
          aria-label={soundEnabled ? 'Mute scan beep' : 'Enable scan beep'}
          title={
            soundEnabled
              ? isKm
                ? 'បិទសំឡេងស្កេន'
                : 'Mute scan beep'
              : isKm
                ? 'បើកសំឡេងស្កេន'
                : 'Enable scan beep'
          }
          className={`inline-flex items-center justify-center h-12 w-12 rounded-[10px] border transition-all duration-150 active:scale-[0.96] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981] ${
            soundEnabled
              ? 'border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3] hover:bg-stone-50 dark:hover:bg-[#1F3028] hover:text-stone-900'
              : 'border-stone-200 dark:border-[#24352C] bg-stone-50 dark:bg-[#131D18] text-stone-400 dark:text-[#94A39B] hover:text-stone-700 dark:hover:text-[#F1F5F3]'
          }`}
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Row 2: Compact Filter Control + USB/BT Ready Status Pill (Left) & Reset All (Right) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {secondaryLeftSlot}

          {/* USB / Bluetooth HID Scanner Status Pill (minimum 44px touch height) */}
          <button
            type="button"
            onClick={() => setHardwareEnabled((prev) => !prev)}
            title={
              isKm
                ? 'បើក/បិទការទទួលសញ្ញាពីម៉ាស៊ីនស្កេនបាកូដ USB ឬ Bluetooth'
                : 'Toggle external USB / Bluetooth barcode scanner listening'
            }
            className={`inline-flex items-center justify-center gap-1.5 h-11 px-3.5 text-xs font-medium rounded-full border transition-all duration-150 active:scale-[0.97] whitespace-nowrap shrink-0 ${
              hardwareEnabled
                ? 'border-[#0D5C3E]/15 dark:border-[#10B981]/35 bg-[#E6F2ED] dark:bg-[#064E3B] text-[#0D5C3E] dark:text-[#6EE7B7] hover:bg-[#D9ECE4] dark:hover:bg-[#065F46]'
                : 'border-stone-200 dark:border-[#24352C] bg-stone-100 dark:bg-[#18251F] text-stone-500 dark:text-[#94A39B] hover:text-stone-800 dark:hover:text-[#F1F5F3]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                hardwareEnabled ? 'bg-emerald-600 dark:bg-[#34D399]' : 'bg-stone-400 dark:bg-[#94A39B]'
              }`}
            />
            <Usb className="w-3.5 h-3.5 shrink-0 opacity-85" />
            <span>
              {hardwareEnabled
                ? isKm
                  ? 'USB/BT រួចរាល់'
                  : 'USB/BT Ready'
                : isKm
                  ? 'USB/BT បានផ្អាក'
                  : 'USB/BT Paused'}
            </span>
          </button>
        </div>

        {secondaryRightSlot && (
          <div className="flex items-center shrink-0">{secondaryRightSlot}</div>
        )}
      </div>

      {/* Inline Last-Scan Feedback Line (Unboxed clean metadata strip) */}
      {lastScan && (
        <div
          role="status"
          className={`animate-drawer-in flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border text-xs ${
            lastScan.ok
              ? 'bg-emerald-50/70 dark:bg-[#064E3B]/50 border-emerald-200 dark:border-[#10B981]/35 text-emerald-900 dark:text-[#D1FAE5]'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-500/35 text-red-800 dark:text-red-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {lastScan.ok ? (
              <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#34D399] shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-[#F87171] shrink-0" />
            )}
            <span className="font-medium truncate">{lastScan.message}</span>
            <span aria-hidden="true" className="text-stone-400 dark:text-[#94A39B]">
              ·
            </span>
            <span className="font-mono-num text-[11px] opacity-85 shrink-0">{lastScan.code}</span>
            <span aria-hidden="true" className="text-stone-400 dark:text-[#94A39B] hidden sm:inline">
              ·
            </span>
            <span className="text-[11px] opacity-80 hidden sm:inline shrink-0">
              {sourceLabel(lastScan.source)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastScan(null)}
            aria-label={isKm ? 'បិទការជូនដំណឹង' : 'Dismiss'}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md opacity-70 hover:opacity-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Expandable Live Camera Scanner Panel (Inline above product grid so cart stays visible) */}
      {cameraOpen && (
        <div className="animate-drawer-in border-t border-stone-200 dark:border-[#24352C] pt-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-stone-700 dark:text-[#94A39B]">
              <Camera className="w-4 h-4 text-[#0F5C43] dark:text-[#10B981] shrink-0" />
              <span className="font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {isKm ? 'ម៉ាស៊ីនស្កេនបាកូដតាមកាមេរ៉ា' : 'Live Camera Barcode Scanner'}
              </span>
              {sessionScanCount > 0 && (
                <>
                  <span aria-hidden="true" className="text-stone-300 dark:text-[#24352C]">
                    ·
                  </span>
                  <span className="font-mono-num text-[#0F5C43] dark:text-[#34D399] font-semibold">
                    {sessionScanCount} {isKm ? 'មុខបានបន្ថែម' : 'added'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Continuous vs Single-Scan Segmented Control */}
              <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#0B110E] border border-transparent dark:border-[#24352C] rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setContinuousMode(true)}
                  className={`h-9 px-3 font-semibold rounded-md transition-colors whitespace-nowrap ${
                    continuousMode
                      ? 'bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B]'
                  }`}
                >
                  {isKm ? 'ស្កេនបន្តបន្ទាប់' : 'Multi-Scan'}
                </button>
                <button
                  type="button"
                  onClick={() => setContinuousMode(false)}
                  className={`h-9 px-3 font-semibold rounded-md transition-colors whitespace-nowrap ${
                    !continuousMode
                      ? 'bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] shadow-xs'
                      : 'text-stone-600 dark:text-[#94A39B]'
                  }`}
                >
                  {isKm ? 'ស្កេនម្ដង' : 'Single'}
                </button>
              </div>

              {cameras.length > 1 && (
                <button
                  type="button"
                  onClick={handleCycleCamera}
                  className="inline-flex items-center gap-1.5 h-11 px-3 text-xs font-medium text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {isKm ? 'ប្ដូរកាមេរ៉ា' : 'Switch'}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
            {/* Live Camera Viewfinder */}
            <div className="md:col-span-7 relative rounded-lg overflow-hidden bg-stone-950 border border-stone-200 dark:border-[#24352C] min-h-[210px] flex items-center justify-center">
              <div id={viewfinderId} className="w-full" />
              {!cameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-300 text-xs px-4 text-center">
                  <Camera className="w-6 h-6 text-stone-400" />
                  <span>
                    {isKm ? 'កំពុងបើកកាមេរ៉ា...' : 'Starting camera viewfinder...'}
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
            <div className="md:col-span-5 flex flex-col justify-between gap-3 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg p-3.5">
              <div className="space-y-1.5 text-xs text-stone-600 dark:text-[#94A39B]">
                <p className="font-semibold text-stone-900 dark:text-[#F1F5F3] flex items-center gap-1.5">
                  <Keyboard className="w-3.5 h-3.5 text-[#0F5C43] dark:text-[#10B981]" />
                  {isKm ? 'វាយបញ្ចូលបាកូដ ឬស្កេន USB/BT' : 'Manual Entry or USB/BT Scan'}
                </p>
                <p className="leading-relaxed">
                  {isKm
                    ? 'គាំទ្របាកូដ EAN-13, UPC, Code-128, QR, កូដទំហំ និងបាកូដកេស។'
                    : 'Supports EAN-13, UPC, Code-128, QR, size-variant codes, and carton barcodes.'}
                </p>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-2.5">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="e.g. 8851959132012"
                  data-barcode-capture="true"
                  className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#0B110E] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-300 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
                <button
                  type="submit"
                  disabled={!manualCode.trim()}
                  className="w-full h-11 px-3 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-all duration-150 active:scale-[0.97] whitespace-nowrap"
                >
                  {isKm ? 'បន្ថែមទៅកន្ត្រក' : 'Add to Cart'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
