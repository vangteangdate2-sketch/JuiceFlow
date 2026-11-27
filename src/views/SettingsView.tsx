import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useHints } from '../context/HintsContext';
import type { BiometricSecurityConfig, CategoryColorKey, CategoryScope } from '../types';
import {
  CATEGORY_COLOR_OPTIONS,
  getCategoryBadgeClass,
  getCategoryDisplayName,
  getCategoryDotClass,
  pickNextCategoryColor,
  resolveCategoryColor,
  resolveIngredientCategoryId,
  resolveProductCategoryId,
  UNCATEGORIZED_ID,
} from '../utils/categories';
import {
  DEFAULT_SECURITY_CONFIG,
  enrollBiometricCredential,
  hashPin,
  isBiometricSupported,
} from '../lib/biometric';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import {
  addCashPreset,
  DEFAULT_CASH_PRESETS,
  MAX_CASH_PRESETS,
  removeCashPreset,
  updateCashPreset,
} from '../utils/cashTender';

interface SettingsViewProps {
  security: BiometricSecurityConfig;
  onUpdateSecurity: (next: BiometricSecurityConfig) => void;
  onLockNow: () => void;
}

type SettingsSectionId =
  | 'language'
  | 'business'
  | 'categories'
  | 'family'
  | 'cloud-sync'
  | 'security';

const SECTION_IDS: SettingsSectionId[] = [
  'language',
  'business',
  'categories',
  'family',
  'cloud-sync',
  'security',
];

interface InfoTriggerProps {
  hintId: string;
  active: boolean;
  label: string;
  onToggle: (hintId: string) => void;
}

const InfoTrigger: React.FC<InfoTriggerProps> = ({ hintId, active, label, onToggle }) => (
  <button
    type="button"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle(hintId);
    }}
    aria-label={label}
    aria-expanded={active}
    title={label}
    className="w-11 h-11 p-2 -my-1.5 mx-0 inline-flex items-center justify-center shrink-0 rounded-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
  >
    <span
      className={`w-7 h-7 rounded-full inline-flex items-center justify-center border transition-colors ${
        active
          ? 'bg-neutral-200 border-neutral-300 text-neutral-800 dark:bg-neutral-700 dark:border-neutral-600 dark:text-neutral-100'
          : 'bg-neutral-100 border-neutral-200/90 text-neutral-500 group-hover:bg-neutral-200/80 group-hover:text-neutral-700 dark:bg-neutral-800/90 dark:border-neutral-700/80 dark:text-neutral-400 dark:group-hover:bg-neutral-700/80 dark:group-hover:text-neutral-200'
      }`}
    >
      <HelpCircle className="w-3.5 h-3.5" />
    </span>
  </button>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  security,
  onUpdateSecurity,
  onLockNow,
}) => {
  const {
    settings,
    categories,
    products,
    ingredients,
    user,
    cloudSynced,
    syncing,
    rememberMe,
    setRememberMe,
    cashPresets,
    setCashPresets,
    t,
    setLanguage,
    setActiveOperator,
    updateSettings,
    addCategory,
    updateCategory,
    deleteCategory,
    startQuickCloudSync,
    signInWithGoogle,
    signOutGoogle,
    joinWorkspaceByCode,
    exportJsonBackup,
    importJsonBackup,
    resetDemoData,
  } = useStore();

  const isVi = settings.language === 'vi';
  const familyMembers =
    Array.isArray(settings.familyMembers) && settings.familyMembers.length > 0
      ? settings.familyMembers
      : [settings.activeOperator || 'Family'];

  // Sync with global "Show Hints" toggle + per-item overrides + app-wide ? icon visibility
  const {
    showHints,
    resetEpoch,
    hideHintsOutsideSettings,
    setHideHintsOutsideSettings,
  } = useHints();
  const showQuestionHintsAcrossApp = !hideHintsOutsideSettings;
  const [hintOverrides, setHintOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setHintOverrides({});
  }, [resetEpoch]);

  // Collapsible section states (all expanded initially for immediate access)
  const [openSections, setOpenSections] = useState<Record<SettingsSectionId, boolean>>({
    language: true,
    business: true,
    categories: true,
    family: true,
    'cloud-sync': true,
    security: true,
  });

  // Active quick-jump tab tracked via scroll position
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('language');
  const sectionRefs = useRef<Record<SettingsSectionId, HTMLElement | null>>({
    language: null,
    business: null,
    categories: null,
    family: null,
    'cloud-sync': null,
    security: null,
  });
  const scrollLockUntilRef = useRef<number>(0);

  // Business form state
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

  // Quick-Cash Presets editor state
  const [newPresetInput, setNewPresetInput] = useState('');
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [editPresetInput, setEditPresetInput] = useState('');
  const [presetFeedback, setPresetFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Category manager state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryScope, setNewCategoryScope] = useState<CategoryScope>('product');
  const [newCategoryColor, setNewCategoryColor] = useState<CategoryColorKey>(() =>
    pickNextCategoryColor(categories)
  );
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatScope, setEditCatScope] = useState<CategoryScope>('product');
  const [editCatColor, setEditCatColor] = useState<CategoryColorKey>('emerald');
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>(UNCATEGORIZED_ID);
  const [catBusy, setCatBusy] = useState(false);
  const [catFeedback, setCatFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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

  const isHintVisible = useCallback(
    (hintId: string) => hintOverrides[hintId] ?? showHints,
    [hintOverrides, showHints]
  );

  const toggleSingleHint = useCallback(
    (hintId: string) => {
      setHintOverrides((prev) => {
        const current = prev[hintId] ?? showHints;
        return { ...prev, [hintId]: !current };
      });
    },
    [showHints]
  );

  const allExpanded = useMemo(
    () => SECTION_IDS.every((id) => openSections[id]),
    [openSections]
  );

  const handleToggleAllSections = () => {
    const nextState = !allExpanded;
    setOpenSections({
      language: nextState,
      business: nextState,
      categories: nextState,
      family: nextState,
      'cloud-sync': nextState,
      security: nextState,
    });
  };

  const toggleSection = (id: SettingsSectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleQuickJump = (id: SettingsSectionId) => {
    setActiveSection(id);
    setOpenSections((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    scrollLockUntilRef.current = Date.now() + 650;
    window.requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  // Highlight active quick-jump tab as user scrolls
  useEffect(() => {
    const handleScroll = () => {
      if (Date.now() < scrollLockUntilRef.current) return;

      const scrollThreshold = 175;
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;
      if (nearBottom) {
        setActiveSection(SECTION_IDS[SECTION_IDS.length - 1]);
        return;
      }

      let current: SettingsSectionId = SECTION_IDS[0];
      for (const id of SECTION_IDS) {
        const el = sectionRefs.current[id];
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= scrollThreshold) {
          current = id;
        }
      }
      setActiveSection(current);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

  const isDefaultCashPresets = useMemo(() => {
    if (cashPresets.length !== DEFAULT_CASH_PRESETS.length) return false;
    return cashPresets.every((amt, i) => amt === DEFAULT_CASH_PRESETS[i]);
  }, [cashPresets]);

  const handleAddPreset = () => {
    const res = addCashPreset(cashPresets, newPresetInput);
    if (!res.ok) {
      setPresetFeedback({
        type: 'err',
        text: isVi ? 'Nhập số tiền KHR hợp lệ và chưa trùng lặp.' : res.error || 'Invalid preset amount.',
      });
      return;
    }
    setCashPresets(res.presets);
    setNewPresetInput('');
    setPresetFeedback({
      type: 'ok',
      text: isVi ? 'Đã thêm mức tiền nhanh.' : 'Quick-cash preset added.',
    });
    window.setTimeout(() => setPresetFeedback(null), 2200);
  };

  const handleStartEditPreset = (amount: number) => {
    setEditingPreset(amount);
    setEditPresetInput(String(amount));
    setPresetFeedback(null);
  };

  const handleSaveEditPreset = (oldAmount: number) => {
    const res = updateCashPreset(cashPresets, oldAmount, editPresetInput);
    if (!res.ok) {
      setPresetFeedback({
        type: 'err',
        text: isVi ? 'Số tiền KHR không hợp lệ hoặc đã tồn tại.' : res.error || 'Invalid preset amount.',
      });
      return;
    }
    setCashPresets(res.presets);
    setEditingPreset(null);
    setEditPresetInput('');
    setPresetFeedback({
      type: 'ok',
      text: isVi ? 'Đã cập nhật mức tiền nhanh.' : 'Quick-cash preset updated.',
    });
    window.setTimeout(() => setPresetFeedback(null), 2200);
  };

  const handleRemovePreset = (amount: number) => {
    setCashPresets(removeCashPreset(cashPresets, amount));
    if (editingPreset === amount) {
      setEditingPreset(null);
      setEditPresetInput('');
    }
    setPresetFeedback(null);
  };

  const handleResetDefaultPresets = () => {
    setCashPresets([...DEFAULT_CASH_PRESETS]);
    setEditingPreset(null);
    setEditPresetInput('');
    setPresetFeedback({
      type: 'ok',
      text: isVi ? 'Đã khôi phục mức tiền mặc định.' : 'Default presets restored.',
    });
    window.setTimeout(() => setPresetFeedback(null), 2200);
  };

  const handleAddFamilyMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMember.trim();
    if (!trimmed || familyMembers.includes(trimmed)) return;
    const next = [...familyMembers, trimmed].slice(0, 10);
    await updateSettings({ familyMembers: next });
    setNewMember('');
  };

  const handleRemoveFamilyMember = async (name: string) => {
    if (familyMembers.length <= 1) return;
    const next = familyMembers.filter((m) => m !== name);
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

  const categoryUsageMap = useMemo(() => {
    const map = new Map<string, { products: number; ingredients: number }>();
    for (const cat of categories) {
      map.set(cat.id, { products: 0, ingredients: 0 });
    }
    for (const p of products) {
      const cid = resolveProductCategoryId(p, categories);
      const entry = map.get(cid) || { products: 0, ingredients: 0 };
      entry.products += 1;
      map.set(cid, entry);
    }
    for (const ing of ingredients) {
      const cid = resolveIngredientCategoryId(ing, categories);
      const entry = map.get(cid) || { products: 0, ingredients: 0 };
      entry.ingredients += 1;
      map.set(cid, entry);
    }
    return map;
  }, [categories, products, ingredients]);

  const showCategoryFeedback = (type: 'ok' | 'err', text: string) => {
    setCatFeedback({ type, text });
    window.setTimeout(() => {
      setCatFeedback((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim() || catBusy) return;
    setCatBusy(true);
    try {
      const res = await addCategory({
        name: newCategoryName.trim(),
        scope: newCategoryScope,
        color: newCategoryColor,
      });
      if (!res.ok) {
        showCategoryFeedback('err', res.error || (isVi ? 'Không thể thêm danh mục.' : 'Could not add category.'));
        return;
      }
      setNewCategoryName('');
      if (res.category) {
        setNewCategoryColor(pickNextCategoryColor([...categories, res.category]));
      }
      showCategoryFeedback(
        'ok',
        isVi
          ? `Đã thêm danh mục "${res.category?.name}"`
          : `Added category "${res.category?.name}"`
      );
    } finally {
      setCatBusy(false);
    }
  };

  const handleSaveEditCategory = async (catId: string) => {
    if (!editCatName.trim() || catBusy) return;
    setCatBusy(true);
    try {
      const res = await updateCategory(catId, {
        name: editCatName.trim(),
        scope: editCatScope,
        color: editCatColor,
      });
      if (!res.ok) {
        showCategoryFeedback('err', res.error || (isVi ? 'Không thể cập nhật danh mục.' : 'Could not update category.'));
        return;
      }
      setEditingCatId(null);
      showCategoryFeedback(
        'ok',
        isVi ? 'Đã cập nhật danh mục và đồng bộ toàn ứng dụng.' : 'Category updated and synced across all views.'
      );
    } finally {
      setCatBusy(false);
    }
  };

  const handleConfirmDeleteCategory = async (catId: string) => {
    if (catBusy) return;
    setCatBusy(true);
    try {
      const targetId = reassignTargetId === catId ? UNCATEGORIZED_ID : reassignTargetId;
      const res = await deleteCategory(catId, targetId);
      if (!res.ok) {
        showCategoryFeedback('err', res.error || (isVi ? 'Không thể xóa danh mục.' : 'Could not delete category.'));
        return;
      }
      setDeletingCatId(null);
      setReassignTargetId(UNCATEGORIZED_ID);
      showCategoryFeedback(
        'ok',
        isVi ? 'Đã xóa danh mục và chuyển các mục liên quan an toàn.' : 'Category deleted and linked items safely reassigned.'
      );
    } finally {
      setCatBusy(false);
    }
  };

  const formatScopeLabel = (scope: CategoryScope) => {
    if (scope === 'product') return isVi ? 'Sản phẩm & POS' : 'Products & POS';
    if (scope === 'inventory') return isVi ? 'Kho nguyên liệu' : 'Inventory';
    return isVi ? 'Cả hai' : 'Both';
  };

  const quickJumpTabs: { id: SettingsSectionId; label: string }[] = [
    { id: 'language', label: isVi ? 'Ngôn ngữ' : 'Language' },
    { id: 'business', label: isVi ? 'Cửa hàng & Tiền tệ' : 'Business & Currency' },
    { id: 'categories', label: isVi ? 'Danh mục' : 'Categories' },
    { id: 'family', label: isVi ? 'Gia đình' : 'Family Access' },
    { id: 'cloud-sync', label: isVi ? 'Đám mây & Sao lưu' : 'Cloud & Backup' },
    { id: 'security', label: isVi ? 'Bảo mật' : 'Security' },
  ];

  // Subtle status summaries shown in collapsed card headers
  const languageSummary = settings.language === 'vi' ? 'Tiếng Việt' : 'English';
  const formattedPosRate = (settings.posExchangeRate ?? 4000).toLocaleString('en-US');
  const businessSummary = `KHR • ${formattedPosRate} ៛`;
  const categoriesSummary = isVi
    ? `${categories.length} danh mục`
    : `${categories.length} ${categories.length === 1 ? 'Category' : 'Categories'}`;
  const familySummary = isVi
    ? `${familyMembers.length} thành viên`
    : `${familyMembers.length} ${familyMembers.length === 1 ? 'Member' : 'Members'}`;
  const cloudSummary = syncing
    ? t.common.syncing
    : cloudSynced
      ? t.common.onlineSynced
      : t.common.localMode;
  const securitySummary = security.enabled
    ? isVi
      ? 'Đã bật khóa'
      : 'Lock Enabled'
    : isVi
      ? 'Chưa bật'
      : 'Off';

  const hideLabel = isVi ? 'Ẩn' : 'Hide';
  const showLabel = isVi ? 'Hiện' : 'Show';

  const renderSectionToggleButton = (id: SettingsSectionId) => {
    const isOpen = openSections[id];
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSection(id);
        }}
        aria-expanded={isOpen}
        className="h-11 min-h-[44px] px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] bg-stone-100/90 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-200/80 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap shrink-0"
      >
        <span>{isOpen ? hideLabel : showLabel}</span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-stone-500 dark:text-[#94A39B]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-stone-500 dark:text-[#94A39B]" />
        )}
      </button>
    );
  };

  return (
    <div className="max-w-4xl">
      {/* Page Header + Global Controls (Show Hints + Expand/Collapse All) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {t.settings.title}
            </h1>
            <InfoTrigger
              hintId="pageSubtitle"
              active={isHintVisible('pageSubtitle')}
              label={isVi ? 'Thông tin trang cài đặt' : 'About Business Settings'}
              onToggle={toggleSingleHint}
            />
          </div>
          {isHintVisible('pageSubtitle') && (
            <p className="mt-1 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {t.settings.subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {/* Expand All / Collapse All Button */}
          <button
            type="button"
            onClick={handleToggleAllSections}
            className="h-11 min-h-[44px] px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
          >
            {allExpanded ? (
              <ChevronsDownUp className="w-4 h-4 text-stone-500 dark:text-[#94A39B]" />
            ) : (
              <ChevronsUpDown className="w-4 h-4 text-stone-500 dark:text-[#94A39B]" />
            )}
            <span>
              {allExpanded
                ? isVi
                  ? 'Thu gọn tất cả'
                  : 'Collapse All'
                : isVi
                  ? 'Mở rộng tất cả'
                  : 'Expand All'}
            </span>
          </button>
        </div>
      </div>

      {/* Sticky Horizontal Quick-Jump Bar */}
      <nav
        aria-label={isVi ? 'Điều hướng nhanh cài đặt' : 'Settings quick navigation'}
        className="sticky top-16 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 mb-6 flex items-center gap-2 overflow-x-auto py-2.5 bg-[#F6F7F5]/95 dark:bg-[#0B110E]/90 backdrop-blur-md border-b border-stone-200 dark:border-[#24352C] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {quickJumpTabs.map((tab) => {
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleQuickJump(tab.id)}
              aria-current={isActive ? 'location' : undefined}
              className={`h-11 min-h-[44px] px-4 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981] ${
                isActive
                  ? 'bg-[#0D5C3E] text-white dark:bg-[#10B981] dark:text-[#042419]'
                  : 'bg-white text-stone-700 border border-stone-200 hover:bg-stone-100 hover:text-stone-950 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* 5 Collapsible Settings Sections */}
      <div className="space-y-6">
        {/* 1. Language */}
        <section
          id="settings-language"
          ref={(el) => {
            sectionRefs.current.language = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('language')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('language');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Globe className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.settings.sectionLanguage}
                </h2>
                <InfoTrigger
                  hintId="languageDesc"
                  active={isHintVisible('languageDesc')}
                  label={isVi ? 'Thông tin ngôn ngữ' : 'Language info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections.language && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {languageSummary}
                </span>
              )}
              {renderSectionToggleButton('language')}
            </div>
          </div>

          {isHintVisible('languageDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {t.settings.languageDesc}
            </p>
          )}

          {openSections.language && (
            <div className="mt-5 pt-5 border-t border-stone-100 dark:border-[#1F3028] space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-sm text-stone-700 dark:text-[#D5DFDA] font-medium">
                  {isVi ? 'Ngôn ngữ hiển thị hiện tại' : 'Current Interface Language'}:{' '}
                  <span className="font-semibold text-[#0F5C43] dark:text-[#34D399]">
                    {languageSummary}
                  </span>
                </div>

                <div className="inline-flex items-center p-1 bg-stone-100 dark:bg-[#18251F] border border-stone-200/80 dark:border-[#24352C] rounded-lg self-start sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => setLanguage('en')}
                    className={`h-11 min-h-[44px] px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
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
                    className={`h-11 min-h-[44px] px-4 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      settings.language === 'vi'
                        ? 'bg-[#0F5C43] text-white dark:bg-[#10B981] dark:text-[#042419]'
                        : 'text-stone-700 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3]'
                    }`}
                  >
                    Tiếng Việt
                  </button>
                </div>
              </div>

              {/* Show ? Hints Across App Toggle (always keeps ? hints visible inside Settings) */}
              <div className="pt-4 border-t border-stone-100 dark:border-[#1F3028] flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                      {isVi ? 'Hiện nút gợi ý ? trên toàn ứng dụng' : 'Show ? Hints Across App'}
                    </span>
                    <InfoTrigger
                      hintId="showQuestionHintsAcrossAppDesc"
                      active={isHintVisible('showQuestionHintsAcrossAppDesc')}
                      label={
                        isVi
                          ? 'Thông tin hiển thị nút gợi ý ?'
                          : 'About showing ? hints across the app'
                      }
                      onToggle={toggleSingleHint}
                    />
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={showQuestionHintsAcrossApp}
                    onClick={() => setHideHintsOutsideSettings(showQuestionHintsAcrossApp)}
                    aria-label={
                      isVi ? 'Hiện nút gợi ý ? trên toàn ứng dụng' : 'Show ? Hints Across App'
                    }
                    className="h-11 min-h-[44px] px-2.5 inline-flex items-center gap-2.5 rounded-lg hover:bg-stone-50 dark:hover:bg-[#18251F] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
                  >
                    <span className="text-xs font-semibold text-stone-600 dark:text-[#94A39B]">
                      {showQuestionHintsAcrossApp
                        ? isVi
                          ? 'Bật'
                          : 'ON'
                        : isVi
                          ? 'Tắt'
                          : 'OFF'}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        showQuestionHintsAcrossApp
                          ? 'bg-[#0D5C3E] dark:bg-[#10B981]'
                          : 'bg-stone-300 dark:bg-[#2A3D33]'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-[#0B110E] shadow-xs transition-transform ${
                          showQuestionHintsAcrossApp ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </span>
                  </button>
                </div>

                {isHintVisible('showQuestionHintsAcrossAppDesc') && (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                    {isVi
                      ? 'Khi tắt, các nút dấu hỏi ? sẽ được ẩn trên Tổng quan, Bán hàng, Sản phẩm, Kho hàng, Chi phí và Báo cáo — nhưng vẫn luôn hiển thị trong trang Cài đặt này.'
                      : 'When OFF, ? help buttons are hidden on Dashboard, Sales, Products, Inventory, Expenses, and Reports, while remaining available here in Settings.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 2. Business Profile & Currency */}
        <section
          id="settings-business"
          ref={(el) => {
            sectionRefs.current.business = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('business')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('business');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Building2 className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.settings.sectionBusiness}
                </h2>
                <InfoTrigger
                  hintId="businessDesc"
                  active={isHintVisible('businessDesc')}
                  label={isVi ? 'Thông tin cửa hàng và tiền tệ' : 'Business & currency info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections.business && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium font-mono-num bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {businessSummary}
                </span>
              )}
              {renderSectionToggleButton('business')}
            </div>
          </div>

          {isHintVisible('businessDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {isVi
                ? 'Cấu hình tên cửa hàng, tỷ giá quy đổi USD/KHR tại quầy thu ngân và ngưỡng cảnh báo tồn kho mặc định.'
                : 'Configure shop identity, POS USD-to-KHR exchange rates, default low-stock thresholds, and checkout rules.'}
            </p>
          )}

          {openSections.business && (
            <form
              onSubmit={handleSaveBusiness}
              className="mt-5 pt-5 border-t border-stone-100 dark:border-[#1F3028] space-y-5"
            >
              {/* Balanced 2-column Shop Name & Location */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.shopName}
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.shopLocation}
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={shopLocation}
                    onChange={(e) => setShopLocation(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
              </div>

              {/* Balanced 2-column Currency, Rates & Threshold Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.primaryCurrency}
                  </label>
                  <input
                    type="text"
                    readOnly
                    value="Cambodian Riel (KHR · ៛)"
                    className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-stone-50 dark:bg-[#0F1814] text-stone-700 dark:text-[#94A39B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.posExchangeRateLabel}
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={50}
                    value={posExchangeRate}
                    onChange={(e) => setPosExchangeRate(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.usdRateLabel}
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={50}
                    value={usdRate}
                    onChange={(e) => setUsdRate(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA] mb-1.5 whitespace-nowrap truncate">
                    {t.settings.lowStockDefault}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={lowStockDefault}
                    onChange={(e) => setLowStockDefault(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                </div>
              </div>

              {/* Customizable POS Quick-Cash Presets (KHR) */}
              <div className="pt-4 border-t border-stone-100 dark:border-[#1F3028] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Banknote className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                    <span className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                      {isVi ? 'Mức tiền mặt nhanh tại POS (KHR)' : 'POS Quick-Cash Presets (KHR)'}
                    </span>
                    <InfoTrigger
                      hintId="cashPresetsDesc"
                      active={isHintVisible('cashPresetsDesc')}
                      label={isVi ? 'Thông tin mức tiền mặt nhanh' : 'Quick-cash presets info'}
                      onToggle={toggleSingleHint}
                    />
                  </div>
                  {!isDefaultCashPresets && (
                    <button
                      type="button"
                      onClick={handleResetDefaultPresets}
                      className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isVi ? 'Mặc định' : 'Reset Defaults'}
                    </button>
                  )}
                </div>

                {isHintVisible('cashPresetsDesc') && (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                    {isVi
                      ? 'Tùy chỉnh các nút tiền mặt KHR hiển thị trong hộp thoại thanh toán tiền mặt trên màn hình POS. Thay đổi được lưu tự động trên thiết bị này.'
                      : 'Customize the one-tap KHR bill buttons shown inside the POS Cash Payment modal. Changes save automatically on this device.'}
                  </p>
                )}

                {/* Existing Preset Chips / Inline Editors */}
                {cashPresets.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] py-2">
                    {isVi
                      ? 'Chưa có mức tiền nhanh nào. Thêm mức tiền bên dưới hoặc nhấn Mặc định.'
                      : 'No quick-cash presets configured. Add an amount below or restore defaults.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {cashPresets.map((amt) => {
                      const isEditing = editingPreset === amt;
                      if (isEditing) {
                        return (
                          <div
                            key={amt}
                            className="inline-flex items-center gap-1.5 p-1 rounded-lg border border-[#0D5C3E] dark:border-[#10B981] bg-white dark:bg-[#18251F]"
                          >
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              step={100}
                              value={editPresetInput}
                              onChange={(e) => setEditPresetInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveEditPreset(amt);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingPreset(null);
                                  setEditPresetInput('');
                                }
                              }}
                              aria-label={isVi ? 'Sửa số tiền KHR' : 'Edit KHR amount'}
                              className="w-28 h-10 px-2.5 text-sm font-mono-num font-semibold bg-stone-50 dark:bg-[#0B110E] text-stone-900 dark:text-[#F1F5F3] border border-stone-200 dark:border-[#24352C] rounded-md focus:outline-none focus:ring-2 focus:ring-[#0D5C3E]/40 dark:focus:ring-[#10B981]/40"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveEditPreset(amt)}
                              aria-label={t.common.save}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-md bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] text-white dark:text-[#042419] transition-colors"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPreset(null);
                                setEditPresetInput('');
                              }}
                              aria-label={t.common.cancel}
                              className="w-10 h-10 inline-flex items-center justify-center rounded-md text-stone-500 dark:text-[#94A39B] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={amt}
                          className="inline-flex items-center gap-1 pl-3.5 pr-1 py-1 rounded-lg border border-stone-200 dark:border-[#24352C] bg-stone-50/80 dark:bg-[#18251F]"
                        >
                          <span className="font-mono-num text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] pr-1">
                            {amt.toLocaleString('en-US')} ៛
                          </span>
                          <button
                            type="button"
                            onClick={() => handleStartEditPreset(amt)}
                            aria-label={`${isVi ? 'Sửa' : 'Edit'} ${amt.toLocaleString('en-US')} KHR`}
                            title={isVi ? 'Sửa mức tiền' : 'Edit preset'}
                            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-stone-500 dark:text-[#94A39B] hover:text-[#0D5C3E] dark:hover:text-[#34D399] hover:bg-white dark:hover:bg-[#1F3028] transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePreset(amt)}
                            aria-label={`${isVi ? 'Xóa' : 'Remove'} ${amt.toLocaleString('en-US')} KHR`}
                            title={isVi ? 'Xóa mức tiền' : 'Remove preset'}
                            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-stone-500 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add New Custom Preset Row */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={100}
                      value={newPresetInput}
                      onChange={(e) => {
                        setNewPresetInput(e.target.value);
                        if (presetFeedback) setPresetFeedback(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddPreset();
                        }
                      }}
                      placeholder={
                        isVi ? 'Thêm mức tiền (VD: 15000, 100000)' : 'Add amount (e.g., 15000, 100000)'
                      }
                      className="w-full h-11 pl-3.5 pr-8 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-stone-400 dark:text-[#94A39B]">
                      ៛
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!newPresetInput.trim() || cashPresets.length >= MAX_CASH_PRESETS}
                    onClick={handleAddPreset}
                    className="h-11 px-4 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    {isVi ? 'Thêm mức tiền' : 'Add Preset'}
                  </button>
                </div>

                {presetFeedback && (
                  <p
                    className={`text-xs font-medium ${
                      presetFeedback.type === 'ok'
                        ? 'text-emerald-700 dark:text-[#34D399]'
                        : 'text-red-700 dark:text-[#F87171]'
                    }`}
                  >
                    {presetFeedback.text}
                  </p>
                )}
              </div>

              {/* Clean Checkboxes with Individual Info Triggers */}
              <div className="pt-4 border-t border-stone-100 dark:border-[#1F3028] flex flex-col gap-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <label className="inline-flex items-center gap-3 cursor-pointer select-none min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={allowNegativeStock}
                        onChange={(e) => setAllowNegativeStock(e.target.checked)}
                        className="h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981] shrink-0"
                      />
                      <span className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                        {t.settings.allowNegativeStockLabel}
                      </span>
                    </label>
                    <InfoTrigger
                      hintId="allowNegativeStockDesc"
                      active={isHintVisible('allowNegativeStockDesc')}
                      label={t.settings.allowNegativeStockLabel}
                      onToggle={toggleSingleHint}
                    />
                  </div>
                  {isHintVisible('allowNegativeStockDesc') && (
                    <span className="pl-8 text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                      {t.settings.allowNegativeStockDesc}
                    </span>
                  )}
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <label className="inline-flex items-center gap-3 cursor-pointer select-none min-h-[44px]">
                      <input
                        type="checkbox"
                        checked={enableOpenFoodFactsLookup}
                        onChange={(e) => setEnableOpenFoodFactsLookup(e.target.checked)}
                        className="h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981] shrink-0"
                      />
                      <span className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                        {isVi
                          ? 'Tự động tra cứu Open Food Facts v3 khi quét mã mới'
                          : 'Auto-lookup unrecognized barcodes on Open Food Facts v3'}
                      </span>
                    </label>
                    <InfoTrigger
                      hintId="openFoodFactsDesc"
                      active={isHintVisible('openFoodFactsDesc')}
                      label={
                        isVi
                          ? 'Thông tin tra cứu Open Food Facts v3'
                          : 'Open Food Facts v3 lookup info'
                      }
                      onToggle={toggleSingleHint}
                    />
                  </div>
                  {isHintVisible('openFoodFactsDesc') && (
                    <span className="pl-8 text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                      {isVi
                        ? 'Luôn kiểm tra sổ mã vạch JuiceFlow trước. Kết quả ngoài chỉ gợi ý tên, thương hiệu, nhóm hàng — không bao giờ tự điền giá KHR hay tồn kho.'
                        : 'Always checks JuiceFlow Firestore registry first. External matches only prefill name, brand, and category — never local KHR prices or stock quantities.'}
                    </span>
                  )}
                </div>
              </div>

              {/* Footer: Inline Timezone + Save Button */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-stone-200 dark:border-[#24352C]">
                <p className="text-xs text-stone-500 dark:text-[#94A39B] font-mono-num">
                  Timezone: {settings.timezone || 'Asia/Phnom_Penh'}
                </p>
                <div className="flex items-center gap-3">
                  {savedNotice && (
                    <span className="text-xs font-medium text-emerald-700 dark:text-[#34D399] inline-flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      {savedNotice}
                    </span>
                  )}
                  <button
                    type="submit"
                    className="h-11 px-6 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                  >
                    {t.common.save}
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>

        {/* 2b. Categories Manager */}
        <section
          id="settings-categories"
          ref={(el) => {
            sectionRefs.current.categories = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('categories')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('categories');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Tag className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Quản lý danh mục' : 'Categories'}
                </h2>
                <InfoTrigger
                  hintId="categoriesDesc"
                  active={isHintVisible('categoriesDesc')}
                  label={isVi ? 'Thông tin quản lý danh mục' : 'Categories management info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections.categories && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {categoriesSummary}
                </span>
              )}
              {renderSectionToggleButton('categories')}
            </div>
          </div>

          {isHintVisible('categoriesDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {isVi
                ? 'Thêm, đổi tên hoặc xóa danh mục tại đây. Mọi thay đổi tự động đồng bộ trên POS, Sản phẩm, Kho hàng và Báo cáo tài chính mà không làm mất lịch sử bán hàng.'
                : 'Add, rename, or remove categories here. Changes stay synced across POS, Products, Inventory, and Financial Reports without splitting historical data.'}
            </p>
          )}

          {openSections.categories && (
            <div className="mt-5 pt-5 border-t border-stone-200 dark:border-[#24352C] space-y-5">
              {/* Add New Category Bar */}
              <form onSubmit={handleAddCategory} className="space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5">
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="new-category-name"
                      className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                    >
                      {isVi ? 'Tên danh mục mới' : 'New Category Name'}
                    </label>
                    <input
                      id="new-category-name"
                      type="text"
                      maxLength={64}
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder={isVi ? 'VD: Nước ép Detox, Bánh ngọt...' : 'e.g. Detox Juices, Pastries...'}
                      className="w-full h-11 px-3.5 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
                    />
                  </div>
                  <div className="sm:w-44">
                    <label
                      htmlFor="new-category-scope"
                      className="block text-xs font-semibold text-stone-700 dark:text-[#D5DFDA] mb-1.5"
                    >
                      {isVi ? 'Áp dụng cho' : 'Scope'}
                    </label>
                    <select
                      id="new-category-scope"
                      value={newCategoryScope}
                      onChange={(e) => setNewCategoryScope(e.target.value as CategoryScope)}
                      className="w-full h-11 px-3 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
                    >
                      <option value="product">{isVi ? 'Sản phẩm & POS' : 'Products & POS'}</option>
                      <option value="inventory">{isVi ? 'Kho nguyên liệu' : 'Inventory'}</option>
                      <option value="both">{isVi ? 'Cả hai' : 'Both'}</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={!newCategoryName.trim() || catBusy}
                    className="h-11 px-4 inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    {isVi ? 'Thêm danh mục' : 'Add Category'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-stone-600 dark:text-[#94A39B] mr-1">
                    {isVi ? 'Màu nhận diện:' : 'Color Tag:'}
                  </span>
                  {CATEGORY_COLOR_OPTIONS.map((opt) => {
                    const selected = newCategoryColor === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setNewCategoryColor(opt.key)}
                        aria-label={isVi ? opt.labelVi : opt.label}
                        aria-pressed={selected}
                        title={isVi ? opt.labelVi : opt.label}
                        className={`w-8 h-8 rounded-full inline-flex items-center justify-center border transition-all ${
                          selected
                            ? 'border-stone-900 dark:border-white scale-105 ring-2 ring-stone-900/15 dark:ring-white/25'
                            : 'border-stone-200 dark:border-[#24352C] hover:border-stone-400 dark:hover:border-[#344E41]'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full ${getCategoryDotClass(opt.key)}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </form>

              {catFeedback && (
                <div
                  role="status"
                  className={`px-3.5 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 ${
                    catFeedback.type === 'ok'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 dark:bg-[#064E3B]/40 dark:text-[#6EE7B7] dark:border-[#10B981]/30'
                      : 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/35 dark:text-rose-300 dark:border-rose-800/50'
                  }`}
                >
                  <span>{catFeedback.text}</span>
                  <button
                    type="button"
                    onClick={() => setCatFeedback(null)}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                    aria-label={t.common.close}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Category List */}
              <div className="divide-y divide-stone-100 dark:divide-[#1F3028] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden">
                {categories.map((cat) => {
                  const isSystem = Boolean(cat.isSystem || cat.id === UNCATEGORIZED_ID);
                  const usage = categoryUsageMap.get(cat.id) || { products: 0, ingredients: 0 };
                  const totalLinked = usage.products + usage.ingredients;
                  const isEditing = editingCatId === cat.id;
                  const isDeleting = deletingCatId === cat.id;
                  const replacementOptions = categories.filter((c) => c.id !== cat.id);

                  return (
                    <div
                      key={cat.id}
                      className="p-3.5 bg-white dark:bg-[#131D18] hover:bg-stone-50/70 dark:hover:bg-[#16221C] transition-colors"
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                            <input
                              type="text"
                              maxLength={64}
                              value={editCatName}
                              onChange={(e) => setEditCatName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleSaveEditCategory(cat.id);
                                } else if (e.key === 'Escape') {
                                  setEditingCatId(null);
                                }
                              }}
                              autoFocus
                              className="flex-1 h-11 px-3 text-sm border border-[#0D5C3E] dark:border-[#10B981] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
                            />
                            {!isSystem && (
                              <select
                                value={editCatScope}
                                onChange={(e) => setEditCatScope(e.target.value as CategoryScope)}
                                className="sm:w-40 h-11 px-3 text-xs font-medium border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3]"
                              >
                                <option value="product">{isVi ? 'Sản phẩm & POS' : 'Products & POS'}</option>
                                <option value="inventory">{isVi ? 'Kho nguyên liệu' : 'Inventory'}</option>
                                <option value="both">{isVi ? 'Cả hai' : 'Both'}</option>
                              </select>
                            )}
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={!editCatName.trim() || catBusy}
                                onClick={() => void handleSaveEditCategory(cat.id)}
                                className="h-11 px-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {t.common.save}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCatId(null)}
                                className="h-11 px-3 inline-flex items-center justify-center text-xs font-medium text-stone-600 dark:text-[#94A39B] bg-stone-100 dark:bg-[#18251F] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-lg"
                              >
                                {t.common.cancel}
                              </button>
                            </div>
                          </div>
                          {!isSystem && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-stone-600 dark:text-[#94A39B] mr-1">
                                {isVi ? 'Màu:' : 'Color:'}
                              </span>
                              {CATEGORY_COLOR_OPTIONS.map((opt) => {
                                const selected = editCatColor === opt.key;
                                return (
                                  <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => setEditCatColor(opt.key)}
                                    aria-label={isVi ? opt.labelVi : opt.label}
                                    aria-pressed={selected}
                                    title={isVi ? opt.labelVi : opt.label}
                                    className={`w-8 h-8 rounded-full inline-flex items-center justify-center border transition-all ${
                                      selected
                                        ? 'border-stone-900 dark:border-white scale-105 ring-2 ring-stone-900/15 dark:ring-white/25'
                                        : 'border-stone-200 dark:border-[#24352C] hover:border-stone-400 dark:hover:border-[#344E41]'
                                    }`}
                                  >
                                    <span
                                      className={`w-4 h-4 rounded-full ${getCategoryDotClass(opt.key)}`}
                                      aria-hidden="true"
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${getCategoryBadgeClass(
                                cat
                              )}`}
                            >
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${getCategoryDotClass(cat)}`}
                                aria-hidden="true"
                              />
                              {getCategoryDisplayName(cat, isVi)}
                            </span>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C]">
                              {formatScopeLabel(cat.scope)}
                            </span>
                            <span className="font-mono-num text-[11px] text-stone-500 dark:text-[#94A39B]">
                              {totalLinked === 0
                                ? isVi
                                  ? 'Chưa dùng'
                                  : 'Unused'
                                : [
                                    usage.products > 0
                                      ? `${usage.products} ${isVi ? 'sản phẩm' : usage.products === 1 ? 'product' : 'products'}`
                                      : '',
                                    usage.ingredients > 0
                                      ? `${usage.ingredients} ${isVi ? 'nguyên liệu' : usage.ingredients === 1 ? 'ingredient' : 'ingredients'}`
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                            {isSystem && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-[#0D5C3E] dark:bg-[#064E3B]/60 dark:text-[#6EE7B7]">
                                <Lock className="w-2.5 h-2.5" />
                                {isVi ? 'Mặc định hệ thống' : 'System Default'}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingCatId(null);
                                setEditingCatId(cat.id);
                                setEditCatName(cat.name);
                                setEditCatScope(cat.scope);
                                setEditCatColor(resolveCategoryColor(cat.id, cat.color));
                              }}
                              aria-label={isVi ? `Sửa ${cat.name}` : `Edit ${cat.name}`}
                              className="h-11 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-[#D5DFDA] bg-stone-100/80 dark:bg-[#18251F] hover:bg-stone-200/80 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{isVi ? 'Sửa' : 'Edit'}</span>
                            </button>
                            {!isSystem && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCatId(null);
                                  setDeletingCatId(isDeleting ? null : cat.id);
                                  setReassignTargetId(UNCATEGORIZED_ID);
                                }}
                                aria-label={isVi ? `Xóa ${cat.name}` : `Delete ${cat.name}`}
                                className="w-11 h-11 inline-flex items-center justify-center text-stone-500 hover:text-rose-600 dark:text-[#94A39B] dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {isDeleting && !isSystem && (
                        <div className="mt-3 pt-3 border-t border-rose-200/70 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20 -mx-3.5 -mb-3.5 px-3.5 pb-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-rose-800 dark:text-rose-200">
                              {totalLinked > 0
                                ? isVi
                                  ? `Chuyển ${totalLinked} mục sang:`
                                  : `Reassign ${totalLinked} linked ${totalLinked === 1 ? 'item' : 'items'} to:`
                                : isVi
                                  ? `Xóa danh mục "${cat.name}"?`
                                  : `Delete category "${cat.name}"?`}
                            </span>
                            {totalLinked > 0 && (
                              <select
                                value={reassignTargetId}
                                onChange={(e) => setReassignTargetId(e.target.value)}
                                className="h-11 px-3 text-xs font-medium border border-rose-200 dark:border-rose-800/70 rounded-lg bg-white dark:bg-[#131D18] text-stone-900 dark:text-[#F1F5F3]"
                              >
                                {replacementOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {getCategoryDisplayName(opt, isVi)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={catBusy}
                              onClick={() => void handleConfirmDeleteCategory(cat.id)}
                              className="h-11 px-4 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                            >
                              {totalLinked > 0
                                ? isVi
                                  ? 'Chuyển & Xóa'
                                  : 'Reassign & Delete'
                                : isVi
                                  ? 'Xác nhận xóa'
                                  : 'Confirm Delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingCatId(null)}
                              className="h-11 px-3 text-xs font-medium text-stone-600 dark:text-[#94A39B] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg"
                            >
                              {t.common.cancel}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 3. Family Access */}
        <section
          id="settings-family"
          ref={(el) => {
            sectionRefs.current.family = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('family')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('family');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Users className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.settings.sectionFamily}
                </h2>
                <InfoTrigger
                  hintId="familyDesc"
                  active={isHintVisible('familyDesc')}
                  label={isVi ? 'Thông tin quyền gia đình' : 'Family access info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections.family && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {familySummary}
                </span>
              )}
              {renderSectionToggleButton('family')}
            </div>
          </div>

          {isHintVisible('familyDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {t.settings.familyDesc}
            </p>
          )}

          {openSections.family && (
            <div className="mt-5 pt-5 border-t border-stone-100 dark:border-[#1F3028] space-y-5">
              <ul className="divide-y divide-stone-100 dark:divide-[#1F3028] border-t border-b border-stone-100 dark:border-[#1F3028]">
                {familyMembers.map((member) => {
                  const isActive = settings.activeOperator === member;
                  return (
                    <li
                      key={member}
                      className="py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => setActiveOperator(member)}
                          className={`min-h-[44px] text-sm font-medium transition-colors truncate ${
                            isActive
                              ? 'text-[#0F5C43] dark:text-[#34D399] font-semibold'
                              : 'text-stone-800 dark:text-[#F1F5F3] hover:text-stone-950 dark:hover:text-white'
                          }`}
                        >
                          {member}
                        </button>
                        <span className="text-xs text-stone-400 dark:text-[#94A39B]" aria-hidden="true">
                          ·
                        </span>
                        <span
                          className={`text-xs whitespace-nowrap ${
                            isActive
                              ? 'font-semibold text-[#0F5C43] dark:text-[#34D399]'
                              : 'text-stone-500 dark:text-[#94A39B]'
                          }`}
                        >
                          {isActive ? t.common.activeOperator : 'Full Access'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => setActiveOperator(member)}
                            className="h-9 px-3.5 rounded-full text-xs font-semibold text-[#0D5C3E] dark:text-[#6EE7B7] bg-[#E6F2ED] dark:bg-[#064E3B] border border-[#0D5C3E]/20 dark:border-[#10B981]/30 hover:bg-[#D5EAE1] dark:hover:bg-[#065F46] transition-colors whitespace-nowrap"
                          >
                            {isVi ? 'Chuyển' : 'Switch'}
                          </button>
                        )}
                        {familyMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFamilyMember(member)}
                            className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-stone-200 dark:border-[#24352C] bg-stone-50/70 dark:bg-[#18251F] text-stone-500 dark:text-[#94A39B] hover:text-red-700 dark:hover:text-[#F87171] hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-200 dark:hover:border-red-500/40 transition-colors shrink-0"
                            aria-label={`Remove ${member}`}
                            title={`Remove ${member}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <form onSubmit={handleAddFamilyMember} className="flex items-center gap-2.5 max-w-md">
                <input
                  type="text"
                  maxLength={50}
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  placeholder={t.settings.addMemberPlaceholder}
                  className="flex-1 h-11 px-3.5 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
                <button
                  type="submit"
                  className="h-11 inline-flex items-center gap-1.5 px-4 text-sm font-medium text-stone-800 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-lg whitespace-nowrap shrink-0 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t.common.add}
                </button>
              </form>
            </div>
          )}
        </section>

        {/* 4. Cloud & Backup (Multi-Device Cloud Sync + Offline PWA & Local Backup) */}
        <section
          id="cloud-sync"
          ref={(el) => {
            sectionRefs.current['cloud-sync'] = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('cloud-sync')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('cloud-sync');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Cloud className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {isVi ? 'Đồng bộ Đám mây & Sao lưu' : 'Cloud Sync & Backup'}
                </h2>
                <InfoTrigger
                  hintId="cloudDesc"
                  active={isHintVisible('cloudDesc')}
                  label={isVi ? 'Thông tin đồng bộ đám mây' : 'Cloud sync info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections['cloud-sync'] && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {cloudSummary}
                </span>
              )}
              {renderSectionToggleButton('cloud-sync')}
            </div>
          </div>

          {isHintVisible('cloudDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {t.settings.cloudDesc}
            </p>
          )}

          {openSections['cloud-sync'] && (
            <div className="mt-5 pt-5 border-t border-stone-100 dark:border-[#1F3028] space-y-6">
              {/* Cloud Sync Subsection */}
              {!user ? (
                <div className="space-y-5">
                  {/* Remember Me Toggle */}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <label className="inline-flex items-center gap-3 cursor-pointer select-none min-h-[44px]">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-5 w-5 rounded border-stone-300 dark:border-[#24352C] accent-[#0F5C43] dark:accent-[#10B981] shrink-0"
                        />
                        <span className="text-sm font-medium text-stone-900 dark:text-[#F1F5F3]">
                          {t.settings.rememberMeLabel}
                        </span>
                      </label>
                      <InfoTrigger
                        hintId="rememberMeDesc"
                        active={isHintVisible('rememberMeDesc')}
                        label={t.settings.rememberMeLabel}
                        onToggle={toggleSingleHint}
                      />
                    </div>
                    {isHintVisible('rememberMeDesc') && (
                      <span className="pl-8 text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                        {t.settings.rememberMeDesc}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-stone-100 dark:border-[#1F3028] md:divide-x md:divide-stone-200 dark:md:divide-[#24352C]">
                    {/* Left: Start / Reconnect Workspace */}
                    <div className="space-y-3.5">
                      <div>
                        <div className="flex items-center gap-1">
                          <h3 className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                            {t.settings.startWorkspaceTitle}
                          </h3>
                          <InfoTrigger
                            hintId="startWorkspaceDesc"
                            active={isHintVisible('startWorkspaceDesc')}
                            label={t.settings.startWorkspaceTitle}
                            onToggle={toggleSingleHint}
                          />
                        </div>
                        {isHintVisible('startWorkspaceDesc') && (
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-1 leading-relaxed">
                            {t.settings.startWorkspaceDesc}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={handleStartQuickSync}
                            disabled={startingQuickSync}
                            className="h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                          >
                            <Zap className="w-4 h-4 shrink-0" />
                            {startingQuickSync ? t.settings.joiningWorkspace : t.settings.quickSyncBtn}
                          </button>
                          <InfoTrigger
                            hintId="quickSyncHint"
                            active={isHintVisible('quickSyncHint')}
                            label={t.settings.quickSyncBtn}
                            onToggle={toggleSingleHint}
                          />
                        </div>
                        {isHintVisible('quickSyncHint') && (
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                            {t.settings.quickSyncHint}
                          </p>
                        )}
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
                        <p className="text-xs font-medium text-red-700 dark:text-[#F87171]">
                          {authError}
                        </p>
                      )}
                    </div>

                    {/* Right: Direct Join Another Family Member's Workspace */}
                    <form onSubmit={handleJoinWorkspace} className="space-y-3 md:pl-6">
                      <div>
                        <div className="flex items-center gap-1">
                          <h3 className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3] inline-flex items-center gap-1.5">
                            <KeyRound className="w-4 h-4 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
                            {t.settings.joinWorkspaceTitle}
                          </h3>
                          <InfoTrigger
                            hintId="joinBeforeLoginDesc"
                            active={isHintVisible('joinBeforeLoginDesc')}
                            label={t.settings.joinWorkspaceTitle}
                            onToggle={toggleSingleHint}
                          />
                        </div>
                        {(isHintVisible('joinBeforeLoginDesc') || (hasUrlInvite && Boolean(joinCode))) && (
                          <p className="text-xs text-stone-500 dark:text-[#94A39B] mt-1 leading-relaxed">
                            {hasUrlInvite && joinCode
                              ? t.settings.inviteDetectedHint
                              : t.settings.joinBeforeLoginDesc}
                          </p>
                        )}
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
                      {isHintVisible('joinBeforeLoginDesc') && (
                        <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                          {t.settings.staySignedInNote}
                        </p>
                      )}
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

                  {/* Actionable External-Domain / Render Setup Helper (only appears on auth error) */}
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
                          {cloudSummary}
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
                      <div className="flex items-center gap-1 mb-1.5">
                        <p className="text-xs font-medium text-stone-600 dark:text-[#94A39B]">
                          {t.settings.workspaceCode}
                        </p>
                        <InfoTrigger
                          hintId="syncBackfillNote"
                          active={isHintVisible('syncBackfillNote')}
                          label={t.settings.workspaceCode}
                          onToggle={toggleSingleHint}
                        />
                      </div>
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
                          {isHintVisible('syncBackfillNote') && (
                            <p className="mt-2 text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                              {t.settings.syncBackfillNote}
                            </p>
                          )}
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

              {/* Offline PWA & Local Backup Subsection */}
              <div className="pt-5 border-t border-stone-200 dark:border-[#24352C] space-y-4">
                <div>
                  <div className="flex items-center gap-1">
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-[#F1F5F3]">
                      {t.settings.sectionOffline}
                    </h3>
                    <InfoTrigger
                      hintId="offlineDesc"
                      active={isHintVisible('offlineDesc')}
                      label={t.settings.sectionOffline}
                      onToggle={toggleSingleHint}
                    />
                  </div>
                  {isHintVisible('offlineDesc') && (
                    <p className="mt-1 text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                      {t.settings.offlineDesc}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
                        className="h-11 px-4 font-semibold text-red-700 dark:text-red-200 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/40 rounded-lg"
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
                  <p className="text-xs font-medium text-emerald-700 dark:text-[#34D399]">
                    {backupNotice}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 5. Security (Biometric & Privacy Lock) */}
        <section
          id="settings-security"
          ref={(el) => {
            sectionRefs.current.security = el;
          }}
          className="scroll-mt-36 bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection('security')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('security');
              }
            }}
            className="flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Fingerprint className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
              <div className="flex items-center gap-1 min-w-0">
                <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.settings.sectionSecurity}
                </h2>
                <InfoTrigger
                  hintId="securityDesc"
                  active={isHintVisible('securityDesc')}
                  label={isVi ? 'Thông tin bảo mật sinh trắc học' : 'Security & lock info'}
                  onToggle={toggleSingleHint}
                />
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!openSections.security && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-stone-100 text-stone-700 dark:bg-[#18251F] dark:text-[#94A39B] border border-stone-200/80 dark:border-[#24352C] whitespace-nowrap">
                  {securitySummary}
                </span>
              )}
              {renderSectionToggleButton('security')}
            </div>
          </div>

          {isHintVisible('securityDesc') && (
            <p className="mt-2.5 text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
              {t.settings.securityDesc}
            </p>
          )}

          {openSections.security && (
            <div className="mt-5 pt-5 border-t border-stone-100 dark:border-[#1F3028] space-y-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleEnrollBiometric}
                    className="h-11 inline-flex items-center gap-2 px-4 text-sm font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Fingerprint className="w-4 h-4" />
                    {t.settings.enableBiometric}
                  </button>

                  <InfoTrigger
                    hintId="biometricStatusHint"
                    active={isHintVisible('biometricStatusHint')}
                    label={isVi ? 'Trạng thái sinh trắc học thiết bị' : 'Device biometric support'}
                    onToggle={toggleSingleHint}
                  />

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

                {isHintVisible('biometricStatusHint') && (
                  <p className="text-xs text-stone-500 dark:text-[#94A39B] leading-relaxed">
                    {bioAvailable ? t.settings.biometricAvailable : t.settings.biometricUnavailable}
                  </p>
                )}
              </div>

              <form
                onSubmit={handleSavePin}
                className="pt-4 border-t border-stone-100 dark:border-[#1F3028] space-y-3 max-w-md"
              >
                <label className="block text-xs font-medium text-stone-700 dark:text-[#D5DFDA]">
                  {t.settings.setPinTitle}
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t.settings.pinPlaceholder}
                    className="flex-1 h-11 px-3.5 text-sm font-mono-num bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  />
                  <button
                    type="submit"
                    disabled={pinInput.length < 4}
                    className="h-11 inline-flex items-center gap-1.5 px-4 text-xs font-semibold text-stone-900 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {t.settings.savePin}
                  </button>
                </div>
              </form>

              {security.enabled && (
                <label className="inline-flex items-center gap-3 text-sm text-stone-700 dark:text-[#D5DFDA] cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={security.lockOnBackground}
                    onChange={(e) =>
                      onUpdateSecurity({ ...security, lockOnBackground: e.target.checked })
                    }
                    className="w-5 h-5 accent-[#0F5C43] dark:accent-[#10B981] shrink-0"
                  />
                  <span>{t.settings.lockOnBackground}</span>
                </label>
              )}

              {bioMessage && (
                <p className="text-xs font-medium text-emerald-700 dark:text-[#34D399]">
                  {bioMessage}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
