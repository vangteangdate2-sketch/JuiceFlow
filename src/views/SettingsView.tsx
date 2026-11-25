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
  const [lowStockDefault, setLowStockDefault] = useState(String(settings.lowStockDefault));
  const [allowNegativeStock, setAllowNegativeStock] = useState(Boolean(settings.allowNegativeStock));
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
    setLowStockDefault(String(settings.lowStockDefault));
    setAllowNegativeStock(Boolean(settings.allowNegativeStock));
  }, [
    settings.name,
    settings.location,
    settings.usdRate,
    settings.lowStockDefault,
    settings.allowNegativeStock,
  ]);

  useEffect(() => {
    isBiometricSupported().then(setBioAvailable);
  }, []);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({
      name: shopName.trim() || 'JuiceFlow',
      location: shopLocation.trim(),
      usdRate: Math.max(100, Number(usdRate) || 4050),
      lowStockDefault: Math.max(0, Number(lowStockDefault) || 15),
      allowNegativeStock,
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
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
          {t.settings.title}
        </h1>
        <p className="mt-1 text-sm text-stone-500">{t.settings.subtitle}</p>
      </div>

      {/* 1. Language Switcher (English / Vietnamese) */}
      <section className="bg-white border border-stone-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-[#0F5C43] mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-stone-900">
                {t.settings.sectionLanguage}
              </h2>
              <p className="text-sm text-stone-500 mt-0.5">{t.settings.languageDesc}</p>
            </div>
          </div>

          <div className="inline-flex items-center p-1 bg-stone-100 rounded-lg self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                settings.language === 'en'
                  ? 'bg-[#0F5C43] text-white'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('vi')}
              className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                settings.language === 'vi'
                  ? 'bg-[#0F5C43] text-white'
                  : 'text-stone-700 hover:text-stone-900'
              }`}
            >
              Tiếng Việt
            </button>
          </div>
        </div>
      </section>

      {/* 2. Business Profile & Currency */}
      <section className="bg-white border border-stone-200 rounded-xl p-6">
        <h2 className="font-display text-lg font-semibold text-stone-900 mb-4">
          {t.settings.sectionBusiness}
        </h2>
        <form onSubmit={handleSaveBusiness} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                {t.settings.shopName}
              </label>
              <input
                type="text"
                maxLength={100}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                {t.settings.shopLocation}
              </label>
              <input
                type="text"
                maxLength={120}
                value={shopLocation}
                onChange={(e) => setShopLocation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                {t.settings.primaryCurrency}
              </label>
              <input
                type="text"
                readOnly
                value="Cambodian Riel (KHR · ៛)"
                className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 text-stone-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                {t.settings.usdRateLabel}
              </label>
              <input
                type="number"
                min={100}
                step={50}
                value={usdRate}
                onChange={(e) => setUsdRate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                {t.settings.lowStockDefault}
              </label>
              <input
                type="number"
                min={0}
                value={lowStockDefault}
                onChange={(e) => setLowStockDefault(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[#0F5C43]"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900">
                  {t.settings.allowNegativeStockLabel}
                </span>
                <span className="block text-xs text-stone-500">
                  {t.settings.allowNegativeStockDesc}
                </span>
              </span>
            </label>

            <p className="text-xs text-stone-500 font-mono-num">
              Timezone: {settings.timezone || 'Asia/Phnom_Penh'}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="px-5 py-2 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors"
            >
              {t.common.save}
            </button>
            {savedNotice && (
              <span className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {savedNotice}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* 3. Family Access (Module 7: Full Access, No Permission Barriers) */}
      <section className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Users className="w-5 h-5 text-[#0F5C43] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.settings.sectionFamily}
            </h2>
            <p className="text-sm text-stone-500 mt-0.5">{t.settings.familyDesc}</p>
          </div>
        </div>

        <ul className="divide-y divide-stone-100 border-t border-b border-stone-100">
          {settings.familyMembers.map((member) => {
            const isActive = settings.activeOperator === member;
            return (
              <li key={member} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveOperator(member)}
                    className={`text-sm font-medium transition-colors truncate ${
                      isActive ? 'text-[#0F5C43] font-semibold' : 'text-stone-800 hover:text-stone-950'
                    }`}
                  >
                    {member}
                  </button>
                  <span className="text-xs text-stone-400">·</span>
                  <span className="text-xs text-stone-500">
                    {isActive ? t.common.activeOperator : 'Full Access'}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => setActiveOperator(member)}
                      className="text-xs font-medium text-[#0F5C43] hover:underline"
                    >
                      Switch
                    </button>
                  )}
                  {settings.familyMembers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFamilyMember(member)}
                      className="p-1 text-stone-400 hover:text-red-700"
                      aria-label={`Remove ${member}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
            className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t.common.add}
          </button>
        </form>
      </section>

      {/* 4. Multi-Device Cloud Sync (Firebase) */}
      <section id="cloud-sync" className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Cloud className="w-5 h-5 text-[#0F5C43] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.settings.sectionCloud}
            </h2>
            <p className="text-sm text-stone-500 mt-0.5">{t.settings.cloudDesc}</p>
          </div>
        </div>

        {!user ? (
          <div className="space-y-5 pt-2 border-t border-stone-100">
            {/* Remember Me Toggle */}
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[#0F5C43]"
              />
              <span>
                <span className="block text-sm font-medium text-stone-900">
                  {t.settings.rememberMeLabel}
                </span>
                <span className="block text-xs text-stone-500">
                  {t.settings.rememberMeDesc}
                </span>
              </span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100 md:divide-x md:divide-stone-200">
              {/* Left: Start / Reconnect Workspace */}
              <div className="space-y-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900">
                    {t.settings.startWorkspaceTitle}
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {t.settings.startWorkspaceDesc}
                  </p>
                </div>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleStartQuickSync}
                    disabled={startingQuickSync}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Zap className="w-4 h-4 shrink-0" />
                    {startingQuickSync ? t.settings.joiningWorkspace : t.settings.quickSyncBtn}
                  </button>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    {t.settings.quickSyncHint}
                  </p>
                </div>

                <div className="pt-2 space-y-2 border-t border-stone-100">
                  <p className="text-xs font-medium text-stone-500">{t.settings.orUseGoogle}</p>
                  <GoogleSignInButton
                    onClick={handleGoogleSignIn}
                    label={t.settings.signInGoogle}
                  />
                </div>

                {authError && <p className="text-xs font-medium text-red-700">{authError}</p>}
              </div>

              {/* Right: Direct Join Another Family Member's Workspace (On Surface Before Login) */}
              <form onSubmit={handleJoinWorkspace} className="space-y-3 md:pl-6">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 inline-flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-[#0F5C43] shrink-0" />
                    {t.settings.joinWorkspaceTitle}
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
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
                    className="flex-1 min-w-0 px-3 py-2 text-sm font-mono-num uppercase tracking-wider border border-stone-200 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinCode.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {joining ? t.settings.joiningWorkspace : t.settings.joinDirectBtn}
                  </button>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                  {t.settings.staySignedInNote}
                </p>
                {joinStatus && (
                  <p
                    className={`text-xs font-medium ${
                      joinStatus.type === 'ok' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {joinStatus.text}
                  </p>
                )}
              </form>
            </div>

            {/* Actionable External-Domain / Render Setup Helper (only appears when needed) */}
            {setupHintMode !== 'none' && (
              <div className="pt-4 border-t border-amber-200 bg-amber-50/60 -mx-6 px-6 pb-2 space-y-3">
                <p className="text-xs font-semibold text-amber-950">
                  {t.settings.externalHostGuideTitle}
                </p>
                {setupHintMode === 'domain' && typeof window !== 'undefined' && (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-900">
                      {t.settings.externalHostGuideDomain}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono-num text-xs font-semibold px-2.5 py-1.5 bg-white border border-amber-200 rounded-md text-stone-900">
                        {window.location.hostname}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCurrentDomain}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-800 bg-white border border-amber-200 hover:bg-amber-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        {copiedDomain ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedDomain ? t.settings.copied : t.settings.copyDomain}
                      </button>
                      <a
                        href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0F5C43] bg-white border border-emerald-200 hover:bg-emerald-50 rounded-md whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {t.settings.openAuthorizedDomains}
                      </a>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs text-amber-900">
                    {t.settings.externalHostGuideAnon}
                  </p>
                  <a
                    href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-md whitespace-nowrap shrink-0"
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-100">
              <div>
                <p className="text-sm font-semibold text-stone-900">
                  {user.isAnonymous
                    ? `${settings.activeOperator} (${t.settings.deviceSyncSession})`
                    : user.displayName || user.email}
                </p>
                <p className="text-xs text-stone-500">
                  {user.email ? `${user.email} · ` : ''}
                  <span className="text-emerald-700 font-medium">
                    {syncing ? t.common.syncing : cloudSynced ? t.common.onlineSynced : t.common.localMode}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={signOutGoogle}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 rounded-lg self-start sm:self-auto whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t.settings.signOut}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-medium text-stone-600 mb-1.5">
                  {t.settings.workspaceCode}
                </p>
                {cloudSynced ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono-num text-base font-bold tracking-wider px-3.5 py-2 bg-stone-50 border border-stone-200 rounded-lg text-stone-900">
                        {settings.inviteCode}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCode ? t.settings.copied : t.settings.copyCode}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyInviteLink}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F5C43] border border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 rounded-lg whitespace-nowrap shrink-0"
                      >
                        {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Link2 className="w-3.5 h-3.5" />}
                        {copiedLink ? t.settings.linkCopied : t.settings.copyInviteLink}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-stone-500">{t.settings.syncBackfillNote}</p>
                  </>
                ) : (
                  <p className="text-xs text-stone-500 py-2">
                    {syncing ? t.common.syncing : t.settings.joinBeforeLoginDesc}
                  </p>
                )}
              </div>

              <form onSubmit={handleJoinWorkspace} className="space-y-2">
                <label className="block text-xs font-medium text-stone-600">
                  {t.settings.joinWorkspaceTitle}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={16}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder={t.settings.joinWorkspacePlaceholder}
                    className="flex-1 min-w-0 px-3 py-2 text-sm font-mono-num uppercase tracking-wider border border-stone-200 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinCode.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {joining ? t.settings.joiningWorkspace : t.settings.joinWorkspaceBtn}
                  </button>
                </div>
                {joinStatus && (
                  <p
                    className={`text-xs font-medium ${
                      joinStatus.type === 'ok' ? 'text-emerald-700' : 'text-red-700'
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
      <section className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Fingerprint className="w-5 h-5 text-[#0F5C43] mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900">
              {t.settings.sectionSecurity}
            </h2>
            <p className="text-sm text-stone-500 mt-0.5">{t.settings.securityDesc}</p>
          </div>
        </div>

        <p className="text-xs text-stone-600">
          {bioAvailable ? t.settings.biometricAvailable : t.settings.biometricUnavailable}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleEnrollBiometric}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap"
          >
            <Fingerprint className="w-4 h-4" />
            {t.settings.enableBiometric}
          </button>

          {security.enabled && (
            <>
              <button
                type="button"
                onClick={onLockNow}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-800 border border-stone-300 hover:bg-stone-50 rounded-lg whitespace-nowrap"
              >
                <Lock className="w-4 h-4" />
                {t.settings.testLock}
              </button>
              <button
                type="button"
                onClick={handleDisableLock}
                className="px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg whitespace-nowrap"
              >
                {t.settings.disableLock}
              </button>
            </>
          )}
        </div>

        <form onSubmit={handleSavePin} className="pt-4 border-t border-stone-100 space-y-3 max-w-md">
          <label className="block text-xs font-medium text-stone-700">
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
              className="flex-1 px-3 py-2 text-sm font-mono-num border border-stone-200 rounded-lg"
            />
            <button
              type="submit"
              disabled={pinInput.length < 4}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-stone-900 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-4 h-4" />
              {t.settings.savePin}
            </button>
          </div>
        </form>

        {security.enabled && (
          <label className="inline-flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
            <input
              type="checkbox"
              checked={security.lockOnBackground}
              onChange={(e) =>
                onUpdateSecurity({ ...security, lockOnBackground: e.target.checked })
              }
              className="w-4 h-4 accent-[#0F5C43]"
            />
            {t.settings.lockOnBackground}
          </label>
        )}

        {bioMessage && <p className="text-xs font-medium text-emerald-700">{bioMessage}</p>}
      </section>

      {/* 6. Offline PWA & Local Backup */}
      <section className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
        <h2 className="font-display text-lg font-semibold text-stone-900">
          {t.settings.sectionOffline}
        </h2>
        <p className="text-sm text-stone-500">{t.settings.offlineDesc}</p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <PWAInstallButton variant="full" />

          <button
            type="button"
            onClick={handleDownloadBackup}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            {t.settings.exportBackup}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg whitespace-nowrap"
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
                className="px-3 py-2 font-semibold text-red-700 bg-red-50 rounded-lg"
              >
                {t.settings.resetDemo}
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-2 py-2 text-stone-500"
              >
                {t.common.cancel}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-900 rounded-lg whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              {t.settings.resetDemo}
            </button>
          )}
        </div>

        {backupNotice && <p className="text-xs font-medium text-emerald-700">{backupNotice}</p>}
      </section>
    </div>
  );
};
