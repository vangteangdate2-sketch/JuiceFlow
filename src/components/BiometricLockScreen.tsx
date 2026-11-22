import React, { useState } from 'react';
import { Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import type { BiometricSecurityConfig } from '../types';
import { verifyBiometricCredential, verifyPin } from '../lib/biometric';
import { useStore } from '../context/StoreContext';

interface BiometricLockScreenProps {
  config: BiometricSecurityConfig;
  onUnlock: () => void;
}

export const BiometricLockScreen: React.FC<BiometricLockScreenProps> = ({ config, onUnlock }) => {
  const { t, settings } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleBiometric = async () => {
    if (!config.credentialId) return;
    setError('');
    setChecking(true);
    const ok = await verifyBiometricCredential(config.credentialId);
    setChecking(false);
    if (ok) {
      onUnlock();
    } else {
      setError(t.lock.biometricFailed);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setChecking(true);
    const ok = await verifyPin(pin.trim(), config);
    setChecking(false);
    if (ok) {
      setPin('');
      onUnlock();
    } else {
      setError(t.lock.invalidPin);
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#F6F7F5] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white border border-stone-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#0F5C43] text-white flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-stone-900 truncate">
              {t.lock.title}
            </h1>
            <p className="text-xs text-stone-500 truncate">{settings.name}</p>
          </div>
        </div>

        <p className="text-sm text-stone-600 leading-relaxed mb-6">{t.lock.subtitle}</p>

        {config.biometricEnrolled && config.credentialId && (
          <div className="mb-6">
            <button
              type="button"
              disabled={checking}
              onClick={handleBiometric}
              className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <Fingerprint className="w-5 h-5 shrink-0" />
              {t.lock.unlockBiometric}
            </button>
          </div>
        )}

        {config.pinHash && (
          <form onSubmit={handlePinSubmit} className="space-y-4">
            {config.biometricEnrolled && (
              <div className="flex items-center gap-3 text-xs text-stone-400">
                <div className="h-px flex-1 bg-stone-200" />
                <span>{t.lock.orUsePin}</span>
                <div className="h-px flex-1 bg-stone-200" />
              </div>
            )}

            <div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                aria-label="Backup PIN"
                className="w-full px-4 py-3 text-center font-mono-num text-xl tracking-[0.4em] bg-stone-50 border border-stone-200 rounded-lg text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
              />
            </div>

            <button
              type="submit"
              disabled={checking || pin.length < 4}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-900 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              {t.lock.unlockPin}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-4 text-xs text-red-700 text-center font-medium" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
