import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  enabled: boolean;
  onScan: (barcode: string) => void;
  minLength?: number;
  maxIntervalMs?: number;
}

/**
 * Listens for USB/Bluetooth HID keyboard-wedge barcode scanners.
 * Hardware scanners emit characters rapidly (< 65ms apart) followed by Enter.
 * Slow manual typing inside normal form inputs is ignored.
 */
export function useBarcodeScanner({
  enabled,
  onScan,
  minLength = 4,
  maxIntervalMs = 65,
}: UseBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if modifier keys are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Allow scanning when not focused in a text field, OR if input explicitly opted in via data-barcode-capture
      const allowCapture = !isEditable || target?.getAttribute('data-barcode-capture') === 'true';
      if (!allowCapture) return;

      const now = Date.now();
      if (lastKeyTime > 0 && now - lastKeyTime > maxIntervalMs) {
        buffer = '';
      }

      if (e.key === 'Enter') {
        if (buffer.length >= minLength) {
          e.preventDefault();
          const code = buffer.trim();
          buffer = '';
          lastKeyTime = 0;
          onScanRef.current(code);
        } else {
          buffer = '';
          lastKeyTime = 0;
        }
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
        lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, minLength, maxIntervalMs]);
}
