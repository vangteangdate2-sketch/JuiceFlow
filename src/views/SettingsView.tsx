import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  Globe,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { BiometricSecurityConfig } from '../types';
import {
  DEFAULT_SECURITY_CONFIG,
  enrollBiometricCredential,
  hashPin,
  isBiometricSupported,
} from '../lib/biometric';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { GoogleSignInButton } from '../components/GoogleSignInButton';

interface SettingsViewProps {
  security: BiometricSecurityConfig;
  onUpdateSecurity: (next: BiometricSecurityConfig) => void;
  onLockNow: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  security,
  onUpdateSecurity,
  onLockNow,
}) => {
  const {
    settings,
    user,
    cloudSynced,
    syncing,
    rememberMe,
    setRememberMe,
    t,
    setLanguage,
    setActiveOperator,
    updateSettings,
    startQuickCloudSync,
    signInWithGoogle,
    signOutGoogle,
    joinWorkspaceByCode,
    exportJsonBackup,
    importJsonBackup,
    resetDemoData,
  } = useStore();

  const [shopName, setShopName] = useState(settings.name);
  const [shopLocation, setShopLocation] = useState(settings.location);
  const [usdRate, setUsdRate] = useState(String(settings.usdRate));
  const [posExchangeRate, setPosExchangeRate] = useState(
    String(settings.posExchangeRate ?? 4000)
  );
  const [lowStockDefault, setLowStockDefault] = useState(String(settings.lowStockDefault));
  const [allowNegativeStock, setAllowNegativeStock] = useState(Boolean(settings.allowNegativeStock));
  const [enableOpenFoodFactsLookup, setEnableOpenFoodFactsLookup] = useState(
    settings.enableOpenFoodFactsLookup !== false
  );
  const [savedNotice, setSavedNotice] = useState('');

  // Family members
  const [newMember, setNewMember] = useState('');

  // Cloud workspace pairing
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [joinCode, setJoinCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const param = new URLSearchParams(window.location.search).get('join');
    return param ? param.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) : '';
  });
  const [hasUrlInvite] = useState(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(new URLSearchParams(window.location.search).get('join'));
  });
  const [joining, setJoining] = useState(false);
  const [startingQuickSync, setStartingQuickSync] = useState(false);
  const [joinStatus, setJoinStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [authError, setAuthError] = useState('');
  const [setupHintMode, setSetupHintMode] = useState<'none' | 'domain' | 'anon'>('none');

  // Biometric & PIN
  const [bioAvailable, setBioAvailable] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [bioMessage, setBioMessage] = useState('');

  // Backup / Reset
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [backupNotice, setBackupNotice] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setShopName(settings.name);
    setShopLocation(settings.location);
    setUsdRate(String(settings.usdRate));
    setPosExchangeRate(String(settings.posExchangeRate ?? 4000));
    setLowStockDefault(String(settings.lowStockDefault));
    setAllowNegativeStock(Boolean(settings.allowNegativeStock));
    setEnableOpenFoodFactsLookup(settings.enableOpenFoodFactsLookup !== false);
  }, [
    settings.name,
    settings.location,
    settings.usdRate,
    settings.posExchangeRate,
    settings.lowStockDefault,
    settings.allowNegativeStock,
    settings.enableOpenFoodFactsLookup,
  ]);

  useEffect(() => {
    isBiometricSupported().then(setBioAvailable);
  }, []);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({
      name: shopName.trim() || 'JuiceFlow',
      location: shopLocation.trim(),
      usdRate: Math.max(100, Number(usdRate) || 4000),
      posExchangeRate: Math.max(100, Math.round(Number(posExchangeRate) || 4000)),
      lowStockDefault: Math.max(0, Number(lowStockDefault) || 15),
      allowNegativeStock,
      enableOpenFoodFactsLookup,
    });
    setSavedNotice(t.settings.savedSuccess);
    window.setTimeout(() => setSavedNotice(''), 2500);
  };

  const handleAddFamilyMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMember.trim();
    if (!trimmed || settings.familyMembers.includes(trimmed)) return;
    const next = [...settings.familyMembers, trimmed].slice(0, 10);
    await updateSettings({ familyMembers: next });
    setNewMember('');
  };

  const handleRemoveFamilyMember = async (name: string) => {
    if (settings.familyMembers.length <= 1) return;
    const next = settings.familyMembers.filter((m) => m !== name);
    await updateSettings({
      familyMembers: next,
      activeOperator: settings.activeOperator === name ? next[0] : settings.activeOperator,
    });
  };

  const handleStartQuickSync = async () => {
    if (startingQuickSync) return;
    setAuthError('');
    setJoinStatus(null);
    setSetupHintMode('none');
    setStartingQuickSync(true);
    try {
      const res = await startQuickCloudSync();
      if (!res.ok) {
        setAuthError(res.error || 'Unable to start quick cloud sync.');
        if (res.errorCode === 'auth/operation-not-allowed') {
          setSetupHintMode('anon');
        }
      }
    } finally {
      setStartingQuickSync(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setJoinStatus(null);
    setSetupHintMode('none');
    const res = await signInWithGoogle();
    if (!res.ok) {
      setAuthError(res.error || 'Google sign-in failed.');
      if (res.errorCode === 'auth/unauthorized-domain') {
        setSetupHintMode('domain');
      }
    }
  };

  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || joining) return;
    setJoinStatus(null);
    setAuthError('');
    setSetupHintMode('none');
    setJoining(true);
    try {
      const res = await joinWorkspaceByCode(joinCode);
      if (res.ok) {
        if (!res.redirected) {
          setJoinStatus({ type: 'ok', text: t.settings.joinSuccess });
          setJoinCode('');
        }
      } else {
        setJoinStatus({ type: 'err', text: res.error || t.settings.joinError });
        if (res.errorCode === 'auth/unauthorized-domain') {
          setSetupHintMode('domain');
        } else if (res.errorCode === 'auth/operation-not-allowed') {
          setSetupHintMode('anon');
        }
      }
    } finally {
      setJoining(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(settings.inviteCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(settings.inviteCode)}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCopyCurrentDomain = async () => {
    try {
      await navigator.clipboard.writeText(window.location.hostname);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleEnrollBiometric = async () => {
    setBioMessage('');
    const result = await enrollBiometricCredential(settings.activeOperator || 'JuiceFlow Family');
    if (result.ok && result.credentialId) {
      onUpdateSecurity({
        ...security,
        enabled: true,
        biometricEnrolled: true,
        credentialId: result.credentialId,
      });
      setBioMessage(t.settings.savedSuccess);
    } else {
      setBioMessage(result.error || t.settings.biometricUnavailable);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pinInput.replace(/\D/g, '');
    if (cleaned.length < 4 || cleaned.length > 6) return;
    const { hash, salt } = await hashPin(cleaned);
    onUpdateSecurity({
      ...security,
      enabled: true,
      pinHash: hash,
      pinSalt: salt,
    });
    setPinInput('');
    setBioMessage(t.settings.savedSuccess);
  };

  const handleDisableLock = () => {
    onUpdateSecurity({ ...DEFAULT_SECURITY_CONFIG });
    setBioMessage('');
  };

  const handleDownloadBackup = () => {
    const json = exportJsonBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `juiceflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importJsonBackup(String(reader.result || ''));
      setBackupNotice(res.ok ? t.settings.savedSuccess : res.error || 'Import failed');
      window.setTimeout(() => setBackupNotice(''), 3500);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
          {t.settings.title}
        </h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B]">{t.settings.subtitle}</p>
      </div>

      {/* 1. Language Switcher (English / Vietnamese) */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {t.settings.sectionLanguage}
              </h2>
              <p className="text-sm text-stone-500 dark:text-[#94A39B] mt-0.5">
                {t.settings.languageDesc}
              </p>
            </div>
          </div>

          <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] rounded-lg self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`h-9 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                settings.language === 'en'
                  ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                  : 'text-stone-700 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('vi')}
              className={`h-9 px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                settings.language === 'vi'
                  ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                  : 'text-stone-700 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
              }`}
            >
              Tiếng Việt
            </button>
          </div>
        </div>
      </section>

      {/* 2. Business Profile & Currency */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6">
        <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] mb-4">
          {t.settings.sectionBusiness}
        </h2>
        <form onSubmit={handleSaveBusiness} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.shopName}
              </label>
              <input
                type="text"
                maxLength={100}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.shopLocation}
              </label>
              <input
                type="text"
                maxLength={120}
                value={shopLocation}
                onChange={(e) => setShopLocation(e.target.value)}
                className="w-full h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.primaryCurrency}
              </label>
              <input
                type="text"
                readOnly
                value="Cambodian Riel (KHR · ៛)"
                className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-stone-50 dark:bg-[#0F1814] text-stone-700 dark:text-[#94A39B]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.posExchangeRateLabel}
              </label>
              <input
                type="number"
                min={100}
                step={50}
                value={posExchangeRate}
                onChange={(e) => setPosExchangeRate(e.target.value)}
                className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.usdRateLabel}
              </label>
              <input
                type="number"
                min={100}
                step={50}
                value={usdRate}
                onChange={(e) => setUsdRate(e.target.value)}
                className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1">
                {t.settings.lowStockDefault}
              </label>
              <input
                type="number"
                min={0}
                value={lowStockDefault}
                onChange={(e) => setLowStockDefault(e.target.value)}
                className="w-full h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 dark:border-[#1F3028] space-y-3">
            <label className="flex items-start gap-3 cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981]"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                  {t.settings.allowNegativeStockLabel}
                </span>
                <span className="block text-xs text-stone-500 dark:text-[#94A39B]">
                  {t.settings.allowNegativeStockDesc}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={enableOpenFoodFactsLookup}
                onChange={(e) => setEnableOpenFoodFactsLookup(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981]"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                  {settings.language === 'vi'
                    ? 'Tự động tra cứu Open Food Facts v3 khi quét mã mới'
                    : 'Auto-lookup unrecognized barcodes on Open Food Facts v3'}
                </span>
                <span className="block text-xs text-stone-500 dark:text-[#94A39B]">
                  {settings.language === 'vi'
                    ? 'Luôn kiểm tra sổ mã vạch JuiceFlow trước. Kết quả ngoài chỉ gợi ý tên, thương hiệu, nhóm hàng — không bao giờ tự điền giá KHR hay tồn kho.'
                    : 'Always checks JuiceFlow Firestore registry first. External matches only prefill name, brand, and category — never local KHR prices or stock quantities.'}
                </span>
              </span>
            </label>

            <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
              Timezone: {settings.timezone || 'Asia/Phnom_Penh'}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="h-11 px-5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors"
            >
              {t.common.save}
            </button>
            {savedNotice && (
              <span className="text-xs font-medium text-emerald-700 dark:text-[#34D399] inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {savedNotice}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* 3. Family Access (Module 7: Full Access, No Permission Barriers) */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.settings.sectionFamily}
            </h2>
            <p className="text-sm text-stone-500 dark:text-[#94A39B] mt-0.5">
              {t.settings.familyDesc}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-stone-100 dark:divide-[#1F3028] border-t border-b border-stone-100 dark:border-[#1F3028]">
          {settings.familyMembers.map((member) => {
            const isActive = settings.activeOperator === member;
            return (
              <li key={member} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveOperator(member)}
                    className={`min-h-11 text-sm font-medium transition-colors truncate ${
                      isActive
                        ? 'text-[#0F5C43] dark:text-[#34D399] font-semibold'
                        : 'text-stone-800 dark:text-[#F1F5F3] hover:text-stone-950 dark:hover:text-white'
                    }`}
                  >
                    {member}
                  </button>
                  <span className="text-xs text-stone-400 dark:text-[#94A39B]">·</span>
                  <span className="text-xs text-stone-500 dark:text-[#94A39B]">
                    {isActive ? t.common.activeOperator : 'Full Access'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => setActiveOperator(member)}
                      className="h-9 px-3 text-xs font-medium text-[#0F5C43] dark:text-[#34D399] hover:bg-emerald-50 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                    >
                      Switch
                    </button>
                  )}
                  {settings.familyMembers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFamilyMember(member)}
                      className="h-10 w-10 inline-flex items-center justify-center text-stone-400 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-stone-50 dark:hover:bg-[#18251F] rounded-lg transition-colors"
                      aria-label={`Remove ${member}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <form onSubmit={handleAddFamilyMember} className="flex items-center gap-2 max-w-md">
          <input
            type="text"
            maxLength={50}
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            placeholder={t.settings.addMemberPlaceholder}
            className="flex-1 h-11 px-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
          />
          <button
            type="submit"
            className="h-11 inline-flex items-center gap-1.5 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.common.add}
          </button>
        </form>
      </section>

      {/* 4. Multi-Device Cloud Sync (Firebase) */}
      <section
        id="cloud-sync"
        className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 space-y-5"
      >
        <div className="flex items-start gap-3">
          <Cloud className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.settings.sectionCloud}
            </h2>
            <p className="text-sm text-stone-500 dark:text-[#94A39B] mt-0.5">
              {t.settings.cloudDesc}
            </p>
          </div>
        </div>

        {!user ? (
          <div className="space-y-5 pt-2 border-t border-stone-100 dark:border-[#1F3028]">
            {/* Remember Me Toggle */}
            <label className="flex items-start gap-3 cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981]"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                  {t.settings.rememberMeLabel}
                </span>
                <span className="block text-xs text-stone-500 dark:text-[#94A39B]">
                  {t.settings.rememberMeDesc}
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100 dark:border-[#1F3028] md:divide-x md:divide-stone-200 dark:md:divide-[#24352C]">
              {/* Left: Start / Reconnect Workspace */}
              <div className="space-y-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                    {t.settings.startWorkspaceTitle}
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                    {t.settings.startWorkspaceDesc}
                  </p>
                </div>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleStartQuickSync}
                    disabled={startingQuickSync}
                    className="h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Zap className="w-4 h-4 shrink-0" />
                    {startingQuickSync ? t.settings.joiningWorkspace : t.settings.quickSyncBtn}
                  </button>
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                    {t.settings.quickSyncHint}
                  </p>
                </div>

                <div className="pt-2 space-y-2 border-t border-stone-100 dark:border-[#1F3028]">
                  <p className="text-xs font-medium text-stone-500 dark:text-[#94A39B]">
                    {t.settings.orUseGoogle}
                  </p>
                  <GoogleSignInButton
                    onClick={handleGoogleSignIn}
                    label={t.settings.signInGoogle}
                  />
                </div>

                {authError && (
                  <p className="text-xs font-medium text-red-700 dark:text-[#F87171]">{authError}</p>
                )}
              </div>

              {/* Right: Direct Join Another Family Member's Workspace (On Surface Before Login) */}
              <form onSubmit={handleJoinWorkspace} className="space-y-3 md:pl-6">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] inline-flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                    {t.settings.joinWorkspaceTitle}
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-0.5">
                    {hasUrlInvite && joinCode
                      ? t.settings.inviteDetectedHint
                      : t.settings.joinBeforeLoginDesc}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={16}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder={t.settings.joinWorkspacePlaceholder}
                    className="flex-1 min-w-0 h-11 px-3 text-sm font-mono-num uppercase tracking-wider bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinCode.trim()}
                    className="h-11 px-4 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {joining ? t.settings.joiningWorkspace : t.settings.joinDirectBtn}
                  </button>
                </div>
                <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                  {t.settings.staySignedInNote}
                </p>
                {joinStatus && (
                  <p
                    className={`text-xs font-medium ${
                      joinStatus.type === 'ok'
                        ? 'text-emerald-700 dark:text-[#34D399]'
                        : 'text-red-700 dark:text-[#F87171]'
                    }`}
                  >
                    {joinStatus.text}
                  </p>
                )}
              </form>
            </div>

            {/* Actionable External-Domain / Render Setup Helper (only appears when needed) */}
            {setupHintMode !== 'none' && (
              <div className="pt-4 border-t border-amber-200 dark:border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30 -mx-6 px-6 pb-3 space-y-3">
                <p className="text-xs font-semibold text-amber-950 dark:text-amber-200">
                  {t.settings.externalHostGuideTitle}
                </p>
                {setupHintMode === 'domain' && typeof window !== 'undefined' && (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-900 dark:text-amber-200/90">
                      {t.settings.externalHostGuideDomain}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono-num text-xs font-semibold px-2.5 py-2 bg-white dark:bg-[#18251F] border border-amber-200 dark:border-amber-500/40 rounded-md text-stone-900 dark:text-[#F1F5F3]">
                        {window.location.hostname}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCurrentDomain}
                        className="h-10 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-amber-200 dark:border-amber-500/40 hover:bg-amber-50 dark:hover:bg-[#1F3028] rounded-md whitespace-nowrap shrink-0"
                      >
                        {copiedDomain ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#34D399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedDomain ? t.settings.copied : t.settings.copyDomain}
                      </button>
                      <a
                        href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-10 inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-[#0F5C43] dark:text-[#34D399] bg-white dark:bg-[#18251F] border border-emerald-200 dark:border-[#10B981]/40 hover:bg-emerald-50 dark:hover:bg-[#1F3028] rounded-md whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {t.settings.openAuthorizedDomains}
                      </a>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs text-amber-900 dark:text-amber-200/90">
                    {t.settings.externalHostGuideAnon}
                  </p>
                  <a
                    href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 inline-flex items-center gap-1.5 px-3 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-md whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t.settings.openSignInProviders}
                  </a>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-100 dark:border-[#1F3028]">
              <div>
                <p className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {user.isAnonymous
                    ? `${settings.activeOperator} (${t.settings.deviceSyncSession})`
                    : user.displayName || user.email}
                </p>
                <p className="text-xs text-stone-500 dark:text-[#94A39B]">
                  {user.email ? `${user.email} · ` : ''}
                  <span className="text-emerald-700 dark:text-[#34D399] font-medium">
                    {syncing
                      ? t.common.syncing
                      : cloudSynced
                        ? t.common.onlineSynced
                        : t.common.localMode}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={signOutGoogle}
                className="h-11 inline-flex items-center gap-1.5 px-4 text-xs font-medium text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg self-start sm:self-auto whitespace-nowrap shrink-0 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t.settings.signOut}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-medium text-stone-600 dark:text-[#94A39B] mb-1.5">
                  {t.settings.workspaceCode}
                </p>
                {cloudSynced ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="h-11 inline-flex items-center font-mono-num text-base font-bold tracking-wider px-3.5 bg-stone-50 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg text-stone-900 dark:text-[#F1F5F3]">
                        {settings.inviteCode}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="h-11 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-stone-700 dark:text-[#D5DFDA] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap shrink-0 transition-colors"
                      >
                        {copiedCode ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#34D399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedCode ? t.settings.copied : t.settings.copyCode}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyInviteLink}
                        className="h-11 inline-flex items-center gap-1.5 px-3 text-xs font-medium text-[#0F5C43] dark:text-[#6EE7B7] border border-emerald-200 dark:border-[#10B981]/50 bg-emerald-50/40 dark:bg-[#064E3B] hover:bg-emerald-50 dark:hover:bg-[#065F46] rounded-lg whitespace-nowrap shrink-0 transition-colors"
                      >
                        {copiedLink ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-[#34D399]" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        {copiedLink ? t.settings.linkCopied : t.settings.copyInviteLink}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-stone-500 dark:text-[#94A39B]">
                      {t.settings.syncBackfillNote}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] py-2">
                    {syncing ? t.common.syncing : t.settings.joinBeforeLoginDesc}
                  </p>
                )}
              </div>

              <form onSubmit={handleJoinWorkspace} className="space-y-2">
                <label className="block text-xs font-medium text-stone-600 dark:text-[#94A39B]">
                  {t.settings.joinWorkspaceTitle}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={16}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder={t.settings.joinWorkspacePlaceholder}
                    className="flex-1 min-w-0 h-11 px-3 text-sm font-mono-num uppercase tracking-wider bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinCode.trim()}
                    className="h-11 px-4 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 transition-colors"
                  >
                    {joining ? t.settings.joiningWorkspace : t.settings.joinWorkspaceBtn}
                  </button>
                </div>
                {joinStatus && (
                  <p
                    className={`text-xs font-medium ${
                      joinStatus.type === 'ok'
                        ? 'text-emerald-700 dark:text-[#34D399]'
                        : 'text-red-700 dark:text-[#F87171]'
                    }`}
                  >
                    {joinStatus.text}
                  </p>
                )}
              </form>
            </div>
          </div>
        )}
      </section>

      {/* 5. Biometric Security & Privacy Lock */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Fingerprint className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
              {t.settings.sectionSecurity}
            </h2>
            <p className="text-sm text-stone-500 dark:text-[#94A39B] mt-0.5">
              {t.settings.securityDesc}
            </p>
          </div>
        </div>

        <p className="text-xs text-stone-600 dark:text-[#94A39B]">
          {bioAvailable ? t.settings.biometricAvailable : t.settings.biometricUnavailable}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleEnrollBiometric}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
          >
            <Fingerprint className="w-4 h-4" />
            {t.settings.enableBiometric}
          </button>

          {security.enabled && (
            <>
              <button
                type="button"
                onClick={onLockNow}
                className="h-11 inline-flex items-center gap-2 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap transition-colors"
              >
                <Lock className="w-4 h-4" />
                {t.settings.testLock}
              </button>
              <button
                type="button"
                onClick={handleDisableLock}
                className="h-11 px-4 text-sm font-medium text-red-700 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg whitespace-nowrap transition-colors"
              >
                {t.settings.disableLock}
              </button>
            </>
          )}
        </div>

        <form
          onSubmit={handleSavePin}
          className="pt-4 border-t border-stone-100 dark:border-[#1F3028] space-y-3 max-w-md"
        >
          <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
            {t.settings.setPinTitle}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t.settings.pinPlaceholder}
              className="flex-1 h-11 px-3 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
            />
            <button
              type="submit"
              disabled={pinInput.length < 4}
              className="h-11 inline-flex items-center gap-1.5 px-4 text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              {t.settings.savePin}
            </button>
          </div>
        </form>

        {security.enabled && (
          <label className="inline-flex items-center gap-2.5 text-xs text-stone-700 dark:text-[#D5DFDA] cursor-pointer py-1">
            <input
              type="checkbox"
              checked={security.lockOnBackground}
              onChange={(e) =>
                onUpdateSecurity({ ...security, lockOnBackground: e.target.checked })
              }
              className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981]"
            />
            {t.settings.lockOnBackground}
          </label>
        )}

        {bioMessage && (
          <p className="text-xs font-medium text-emerald-700 dark:text-[#34D399]">{bioMessage}</p>
        )}
      </section>

      {/* 6. Offline PWA & Local Backup */}
      <section className="bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6 space-y-4">
        <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3]">
          {t.settings.sectionOffline}
        </h2>
        <p className="text-sm text-stone-500 dark:text-[#94A39B]">{t.settings.offlineDesc}</p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <PWAInstallButton variant="full" />

          <button
            type="button"
            onClick={handleDownloadBackup}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap transition-colors"
          >
            <Download className="w-4 h-4" />
            {t.settings.exportBackup}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-11 inline-flex items-center gap-2 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-300 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t.settings.importBackup}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            className="hidden"
          />

          {confirmReset ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  setConfirmReset(false);
                  setBackupNotice(t.settings.savedSuccess);
                }}
                className="h-11 px-4 font-semibold text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-950/50 border border-transparent dark:border-red-500/40 rounded-lg"
              >
                {t.settings.resetDemo}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="h-11 px-3 text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]"
              >
                {t.common.cancel}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="h-11 inline-flex items-center gap-2 px-4 text-sm font-medium text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg whitespace-nowrap transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t.settings.resetDemo}
            </button>
          )}
        </div>

        {backupNotice && (
          <p className="text-xs font-medium text-emerald-700 dark:text-[#34D399]">{backupNotice}</p>
        )}
      </section>
    </div>
  );
};
