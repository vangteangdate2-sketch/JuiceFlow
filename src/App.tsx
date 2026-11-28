import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronRight,
  Coffee,
  HelpCircle,
  LayoutDashboard,
  Lock,
  Moon,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Settings,
  ShoppingCart,
  Sun,
  User,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StoreProvider, useStore } from './context/StoreContext';
import { HintsProvider, useHints } from './context/HintsContext';
import { UndoToastProvider } from './context/UndoToastContext';
import { useTheme } from './hooks/useTheme';
import { BiometricLockScreen } from './components/BiometricLockScreen';
import { OfflineBanner, SyncStatusPill } from './components/OfflineBanner';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ModalPortal } from './components/ModalPortal';
import { DashboardView } from './views/DashboardView';
import { SalesView } from './views/SalesView';
import { ProductsView } from './views/ProductsView';
import { InventoryView, type PendingInventoryTarget } from './views/InventoryView';
import { ExpensesView } from './views/ExpensesView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { loadSecurityConfig, saveSecurityConfig } from './lib/biometric';
import type { AppTab, BiometricSecurityConfig, Ingredient, Product } from './types';

const NAV_ITEMS: { id: AppTab; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'sales', icon: ShoppingCart },
  { id: 'products', icon: Coffee },
  { id: 'inventory', icon: Package },
  { id: 'expenses', icon: Receipt },
  { id: 'reports', icon: BarChart3 },
  { id: 'settings', icon: Settings },
];

const BOTTOM_NAV_PRIMARY: {
  id: AppTab;
  icon: React.ComponentType<{ className?: string }>;
  shortEn: string;
  shortVi: string;
}[] = [
  { id: 'sales', icon: ShoppingCart, shortEn: 'Sales & POS', shortVi: 'Bán hàng' },
  { id: 'products', icon: Coffee, shortEn: 'Products', shortVi: 'Sản phẩm' },
  { id: 'inventory', icon: Package, shortEn: 'Inventory', shortVi: 'Kho hàng' },
  { id: 'reports', icon: BarChart3, shortEn: 'Reports', shortVi: 'Báo cáo' },
];

const MORE_SHEET_TABS: {
  id: AppTab;
  icon: React.ComponentType<{ className?: string }>;
  descEn: string;
  descVi: string;
}[] = [
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    descEn: 'Today’s overview & quick shortcuts',
    descVi: 'Tổng quan hôm nay & lối tắt nhanh',
  },
  {
    id: 'expenses',
    icon: Receipt,
    descEn: 'Log operating & daily shop costs',
    descVi: 'Ghi chi phí vận hành hằng ngày',
  },
  {
    id: 'settings',
    icon: Settings,
    descEn: 'Shop details, exchange rate & sync',
    descVi: 'Cài đặt quán, tỷ giá & đồng bộ',
  },
];

interface JuiceFlowShellProps {
  activeTab: AppTab;
  setActiveTab: React.Dispatch<React.SetStateAction<AppTab>>;
}

const JuiceFlowShell: React.FC<JuiceFlowShellProps> = ({ activeTab, setActiveTab }) => {
  const { settings, t, setActiveOperator } = useStore();
  const { isDark, toggleTheme } = useTheme();
  const { showHints, toggleShowHints, areQuestionHintsVisible } = useHints();
  const isVi = settings?.language === 'vi';
  const familyMembers =
    Array.isArray(settings?.familyMembers) && settings.familyMembers.length > 0
      ? settings.familyMembers
      : [settings?.activeOperator || 'Family'];
  const activeOperator = settings?.activeOperator || familyMembers[0] || 'Family';

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('juiceflow_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [pendingAction, setPendingAction] = useState<'add_expense' | 'add_product' | null>(null);
  const [pendingInventoryTarget, setPendingInventoryTarget] =
    useState<PendingInventoryTarget | null>(null);
  const [security, setSecurity] = useState<BiometricSecurityConfig>(() => loadSecurityConfig());
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    const cfg = loadSecurityConfig();
    return cfg.enabled && (cfg.biometricEnrolled || Boolean(cfg.pinHash));
  });

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('juiceflow_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  const handleUpdateSecurity = (next: BiometricSecurityConfig) => {
    setSecurity(next);
    saveSecurityConfig(next);
    if (!next.enabled) {
      setIsLocked(false);
    }
  };

  useEffect(() => {
    if (!security.enabled || !security.lockOnBackground) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [security.enabled, security.lockOnBackground]);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('join')) {
      window.setTimeout(() => {
        document.getElementById('cloud-sync')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }, []);

  useEffect(() => {
    if (!moreSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreSheetOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreSheetOpen]);

  const navigate = (tab: AppTab, action?: 'add_expense' | 'add_product') => {
    setActiveTab(tab);
    setPendingAction(action ?? null);
    setMoreSheetOpen(false);
  };

  const goToCloudSync = () => {
    navigate('settings');
    window.setTimeout(() => {
      document.getElementById('cloud-sync')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const isMoreTabActive =
    moreSheetOpen || activeTab === 'dashboard' || activeTab === 'expenses' || activeTab === 'settings';

  if (isLocked && security.enabled) {
    return <BiometricLockScreen config={security} onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#F6F7F5] text-stone-900 dark:bg-[#0B110E] dark:text-[#F1F5F3] flex flex-col transition-colors duration-150">
      <OfflineBanner />

      <div className="flex-1 flex w-full min-w-0">
        {/* Desktop / Landscape Collapsible Left Sidebar (lg and up) */}
        <aside
          className={`hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:shrink-0 bg-white dark:bg-[#131D18] border-r border-stone-200 dark:border-[#24352C] flex-col transition-[width,background-color,border-color] duration-200 print:hidden ${
            sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-64'
          }`}
        >
          {/* Brand Lockup & Collapse Toggle */}
          <div
            className={`h-16 border-b border-stone-200 dark:border-[#24352C] flex items-center shrink-0 ${
              sidebarCollapsed ? 'px-0 justify-center' : 'px-5 justify-between'
            }`}
          >
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={() => navigate('dashboard')}
                title={t.brand}
                className="font-display text-xl font-bold tracking-tight text-[#0F5C43] dark:text-[#10B981] whitespace-nowrap shrink-0 h-11 inline-flex items-center"
              >
                {t.brand}
              </button>
            )}
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              title={
                sidebarCollapsed
                  ? isVi
                    ? 'Mở rộng thanh bên'
                    : 'Expand sidebar'
                  : isVi
                    ? 'Thu gọn thanh bên'
                    : 'Collapse sidebar'
              }
              aria-label={
                sidebarCollapsed
                  ? isVi
                    ? 'Mở rộng thanh bên'
                    : 'Expand sidebar'
                  : isVi
                    ? 'Thu gọn thanh bên'
                    : 'Collapse sidebar'
              }
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Primary Navigation Links (minimum 44px touch height) */}
          <nav className="flex-1 space-y-1.5 overflow-y-auto p-3" aria-label="Main navigation">
            {NAV_ITEMS.map(({ id, icon: Icon }) => {
              const isCurrent = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  title={sidebarCollapsed ? t.nav[id] : undefined}
                  aria-label={t.nav[id]}
                  className={`w-full min-h-[44px] h-11 flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200 ease-out whitespace-nowrap ${
                    sidebarCollapsed ? 'px-0 justify-center' : 'px-3.5'
                  } ${
                    isCurrent
                      ? 'bg-[#0D5C3E] text-white dark:bg-[#10B981] dark:text-[#042419] font-semibold shadow-2xs'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-[#94A39B] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors duration-200 ${
                      isCurrent
                        ? 'text-white dark:text-[#042419]'
                        : 'text-stone-500 dark:text-[#94A39B]'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{t.nav[id]}</span>}
                </button>
              );
            })}
          </nav>

          {/* Operator Switcher, Reassuring Sync Status & Lock Footer */}
          <div
            className={`border-t border-solid border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] shrink-0 ${
              sidebarCollapsed ? 'p-3 flex flex-col items-center gap-2' : 'p-4 space-y-3'
            }`}
          >
            {sidebarCollapsed ? (
              <>
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  title={`${t.common.activeOperator}: ${activeOperator}`}
                  className="w-11 h-11 rounded-lg bg-[#E6F2ED] dark:bg-[#064E3B] text-[#0D5C3E] dark:text-[#6EE7B7] text-xs font-bold flex items-center justify-center hover:bg-[#D9ECE4] dark:hover:bg-[#065F46] transition-colors"
                >
                  {activeOperator.slice(0, 2).toUpperCase()}
                </button>
                {security.enabled && (
                  <button
                    type="button"
                    onClick={() => setIsLocked(true)}
                    title={t.common.lockApp}
                    aria-label={t.common.lockApp}
                    className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-[#0D5C3E] dark:hover:text-[#10B981] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                )}
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="operator-select"
                    className="block text-[11px] font-medium text-stone-500 dark:text-[#94A39B] mb-1.5"
                  >
                    {t.common.activeOperator}
                  </label>
                  <select
                    id="operator-select"
                    value={activeOperator}
                    onChange={(e) => setActiveOperator(e.target.value)}
                    className="w-full h-11 px-3 text-xs font-medium bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] rounded-lg text-stone-900 dark:text-[#F1F5F3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                  >
                    {familyMembers.map((member) => (
                      <option key={member} value={member}>
                        {member}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <SyncStatusPill compact onClick={goToCloudSync} />
                  {security.enabled && (
                    <button
                      type="button"
                      onClick={() => setIsLocked(true)}
                      title={t.common.lockApp}
                      aria-label={t.common.lockApp}
                      className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#94A39B] hover:text-[#0F5C43] dark:hover:text-[#10B981] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors shrink-0"
                    >
                      <Lock className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 flex flex-col w-full min-w-0">
          {/* Minimalist Full-Bleed Top Bar (64px height) */}
          <header className="sticky top-0 inset-x-0 w-full z-30 h-16 bg-white/90 dark:bg-[#0D1411]/90 backdrop-blur-md border-b border-slate-200/60 dark:border-emerald-950/50 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 shrink-0 transition-colors duration-150 print:hidden">
            <div className="flex items-center gap-2 min-w-0">
              {/* Mobile/Tablet brand tap target -> Dashboard */}
              <button
                type="button"
                onClick={() => navigate('dashboard')}
                className="lg:hidden font-display text-base sm:text-lg font-bold tracking-tight text-[#0F5C43] dark:text-[#10B981] h-11 px-1.5 -ml-1.5 inline-flex items-center rounded-lg hover:bg-stone-100/80 dark:hover:bg-[#18251F] transition-colors whitespace-nowrap shrink-0"
              >
                {t.brand}
              </button>
              <span
                className="lg:hidden text-stone-300 dark:text-[#24352C] shrink-0"
                aria-hidden="true"
              >
                /
              </span>
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="font-medium text-stone-500 dark:text-[#94A39B] truncate hidden lg:inline">
                  {settings.name}
                </span>
                <span
                  className="text-stone-300 dark:text-[#24352C] hidden lg:inline"
                  aria-hidden="true"
                >
                  /
                </span>
                <span className="font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.nav[activeTab]}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Global Show Hints Switch (only shown when ? hints are enabled in Settings) */}
              {areQuestionHintsVisible && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={showHints}
                  onClick={toggleShowHints}
                  aria-label={
                    isVi
                      ? 'Bật hoặc tắt gợi ý trên toàn ứng dụng'
                      : 'Toggle helper hints across all pages'
                  }
                  title={isVi ? 'Hiện / ẩn gợi ý giải thích' : 'Show or hide helper hints'}
                  className="inline-flex items-center gap-1.5 sm:gap-2 h-11 min-h-[44px] px-2.5 sm:px-3 text-xs font-medium text-stone-700 dark:text-[#D5DFDA] bg-transparent border border-slate-200/80 dark:border-emerald-950/70 hover:bg-stone-100/80 dark:hover:bg-[#18251F] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
                >
                  <HelpCircle
                    className={`w-4 h-4 shrink-0 ${
                      showHints
                        ? 'text-[#0D5C3E] dark:text-[#34D399]'
                        : 'text-stone-400 dark:text-[#94A39B]'
                    }`}
                  />
                  <span className="hidden md:inline">{isVi ? 'Gợi ý' : 'Show Hints'}</span>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                      showHints
                        ? 'bg-[#0D5C3E] dark:bg-[#10B981]'
                        : 'bg-stone-300 dark:bg-[#24352C]'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-[#0B110E] shadow-xs transition-transform ${
                        showHints ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </span>
                </button>
              )}

              {/* Light / Dark Mode Switcher (44x44px subtle ghost button) */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  isDark
                    ? isVi
                      ? 'Chuyển sang chế độ sáng'
                      : 'Switch to light mode'
                    : isVi
                      ? 'Chuyển sang chế độ tối'
                      : 'Switch to dark mode'
                }
                title={
                  isDark
                    ? isVi
                      ? 'Chế độ sáng'
                      : 'Light mode'
                    : isVi
                      ? 'Chế độ tối'
                      : 'Dark mode'
                }
                className="inline-flex items-center justify-center w-11 h-11 text-stone-600 dark:text-[#D5DFDA] bg-transparent border border-slate-200/80 dark:border-emerald-950/70 hover:bg-stone-100/80 dark:hover:bg-[#18251F] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
              >
                {isDark ? (
                  <Sun className="w-[18px] h-[18px] text-amber-300" />
                ) : (
                  <Moon className="w-[18px] h-[18px] text-stone-600" />
                )}
              </button>

              <PWAInstallButton variant="compact" />

              {/* Hide redundant + New Sale button when already on Sales & POS */}
              {activeTab !== 'sales' && (
                <button
                  type="button"
                  onClick={() => navigate('sales')}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-3.5 sm:px-4 text-xs sm:text-sm font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-all duration-150 active:scale-[0.98] whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline">{t.dashboard.newSale}</span>
                  <span className="sm:hidden">{isVi ? 'Bán' : 'POS'}</span>
                </button>
              )}
            </div>
          </header>

          {/* Main Content Container (extra bottom clearance on < lg for sticky bottom bar) */}
          <main
            className={`flex-1 w-full mx-auto px-4 sm:px-6 transition-[max-width] duration-200 ${
              activeTab === 'sales'
                ? sidebarCollapsed
                  ? 'max-w-[1520px] pt-4 sm:pt-5 pb-24 lg:pb-5'
                  : 'max-w-[1360px] pt-4 sm:pt-5 pb-24 lg:pb-5'
                : 'max-w-[1320px] lg:px-8 pt-6 sm:pt-8 pb-24 lg:pb-8'
            }`}
          >
            <div key={activeTab} className="animate-view-enter">
              {activeTab === 'dashboard' && <DashboardView onNavigate={navigate} />}
              {activeTab === 'sales' && (
                <SalesView
                  sidebarCollapsed={sidebarCollapsed}
                  onRestockExistingProduct={(prod: Product) => {
                    setPendingInventoryTarget({ kind: 'product', id: prod.id, mode: 'restock' });
                    setActiveTab('inventory');
                  }}
                  onEditExistingIngredient={(ing: Ingredient) => {
                    setPendingInventoryTarget({ kind: 'ingredient', id: ing.id, mode: 'edit' });
                    setActiveTab('inventory');
                  }}
                  onRestockExistingIngredient={(ing: Ingredient) => {
                    setPendingInventoryTarget({ kind: 'ingredient', id: ing.id, mode: 'restock' });
                    setActiveTab('inventory');
                  }}
                />
              )}
              {activeTab === 'products' && (
                <ProductsView
                  autoOpenAdd={pendingAction === 'add_product'}
                  onAutoOpenHandled={() => setPendingAction(null)}
                  onRestockExistingProduct={(prod: Product) => {
                    setPendingInventoryTarget({ kind: 'product', id: prod.id, mode: 'restock' });
                    setActiveTab('inventory');
                  }}
                  onEditExistingIngredient={(ing: Ingredient) => {
                    setPendingInventoryTarget({ kind: 'ingredient', id: ing.id, mode: 'edit' });
                    setActiveTab('inventory');
                  }}
                  onRestockExistingIngredient={(ing: Ingredient) => {
                    setPendingInventoryTarget({ kind: 'ingredient', id: ing.id, mode: 'restock' });
                    setActiveTab('inventory');
                  }}
                />
              )}
              {activeTab === 'inventory' && (
                <InventoryView
                  pendingTarget={pendingInventoryTarget}
                  onPendingTargetHandled={() => setPendingInventoryTarget(null)}
                />
              )}
              {activeTab === 'expenses' && (
                <ExpensesView
                  autoOpenAdd={pendingAction === 'add_expense'}
                  onAutoOpenHandled={() => setPendingAction(null)}
                />
              )}
              {activeTab === 'reports' && <ReportsView />}
              {activeTab === 'settings' && (
                <SettingsView
                  security={security}
                  onUpdateSecurity={handleUpdateSecurity}
                  onLockNow={() => setIsLocked(true)}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      {/* ================================================================== */}
      {/* STICKY BOTTOM NAVIGATION BAR (Portrait Tablets & Phones, < lg)     */}
      {/* 5 primary workflows with >=48px touch targets                      */}
      {/* ================================================================== */}
      <nav
        aria-label={isVi ? 'Điều hướng chính' : 'Primary mobile navigation'}
        className="fixed bottom-0 inset-x-0 z-30 lg:hidden bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-xs border-t border-stone-200 dark:border-[#24352C] pb-[env(safe-area-inset-bottom)] print:hidden"
      >
        <div className="grid grid-cols-5 gap-0.5 px-1.5 py-1.5 max-w-2xl mx-auto">
          {BOTTOM_NAV_PRIMARY.map(({ id, icon: Icon, shortEn, shortVi }) => {
            const isCurrent = activeTab === id && !moreSheetOpen;
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(id)}
                aria-current={isCurrent ? 'page' : undefined}
                className={`min-h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl px-1 transition-all duration-200 ease-out ${
                  isCurrent
                    ? 'bg-[#E6F2ED] text-[#0D5C3E] dark:bg-[#064E3B] dark:text-[#6EE7B7] font-semibold'
                    : 'text-stone-600 dark:text-[#94A39B] hover:bg-stone-100/80 dark:hover:bg-[#1F3028]'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 transition-colors duration-200 ${
                    isCurrent
                      ? 'text-[#0D5C3E] dark:text-[#34D399]'
                      : 'text-stone-500 dark:text-[#94A39B]'
                  }`}
                />
                <span className="text-[11px] leading-tight truncate max-w-full">
                  {isVi ? shortVi : shortEn}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreSheetOpen((prev) => !prev)}
            aria-expanded={moreSheetOpen}
            aria-haspopup="dialog"
            className={`min-h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl px-1 transition-all duration-200 ease-out ${
              isMoreTabActive
                ? 'bg-[#E6F2ED] text-[#0D5C3E] dark:bg-[#064E3B] dark:text-[#6EE7B7] font-semibold'
                : 'text-stone-600 dark:text-[#94A39B] hover:bg-stone-100/80 dark:hover:bg-[#1F3028]'
            }`}
          >
            <MoreHorizontal
              className={`w-5 h-5 shrink-0 transition-colors duration-200 ${
                isMoreTabActive
                  ? 'text-[#0D5C3E] dark:text-[#34D399]'
                  : 'text-stone-500 dark:text-[#94A39B]'
              }`}
            />
            <span className="text-[11px] leading-tight truncate max-w-full">
              {isVi ? 'Thêm' : 'More'}
            </span>
          </button>
        </div>
      </nav>

      {/* ================================================================== */}
      {/* SLIDE-UP "MORE" SHEET (Dashboard, Expenses, Settings, Staff)       */}
      {/* ================================================================== */}
      {moreSheetOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-40 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden print:hidden animate-backdrop"
            onClick={() => setMoreSheetOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={isVi ? 'Menu mở rộng' : 'More navigation and staff options'}
            className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-white dark:bg-[#111916] rounded-t-2xl border-t border-slate-200/80 dark:border-emerald-950/60 shadow-2xl max-h-[85vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] print:hidden animate-sheet-up"
          >
            {/* Drag Handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <span
                aria-hidden="true"
                className="w-10 h-1 rounded-full bg-stone-300 dark:bg-[#2F463A]"
              />
            </div>

            {/* Sheet Header */}
            <div className="px-4 py-2.5 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <h2 className="font-display text-base font-bold text-stone-900 dark:text-[#F1F5F3]">
                  {isVi ? 'Thêm' : 'More'}
                </h2>
                <SyncStatusPill compact onClick={goToCloudSync} />
              </div>
              <button
                type="button"
                onClick={() => setMoreSheetOpen(false)}
                aria-label={t.common.close}
                className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* Secondary Navigation Rows (h-14 / 56px generous touch targets) */}
              <div className="space-y-2">
                {MORE_SHEET_TABS.map(({ id, icon: Icon, descEn, descVi }) => {
                  const isCurrent = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate(id)}
                      className={`w-full min-h-[56px] px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left transition-colors ${
                        isCurrent
                          ? 'bg-[#E6F2ED] dark:bg-[#064E3B] border-[#0D5C3E]/30 dark:border-[#10B981]/40 text-[#0D5C3E] dark:text-[#D1FAE5]'
                          : 'bg-stone-50/70 dark:bg-[#0F1814] border-stone-200 dark:border-[#24352C] text-stone-900 dark:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            isCurrent
                              ? 'bg-[#0D5C3E] text-white dark:bg-[#10B981] dark:text-[#042419]'
                              : 'bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] text-stone-600 dark:text-[#94A39B]'
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{t.nav[id]}</p>
                          <p
                            className={`text-xs truncate ${
                              isCurrent
                                ? 'text-[#0D5C3E]/80 dark:text-[#A7F3D0]/90'
                                : 'text-stone-500 dark:text-[#94A39B]'
                            }`}
                          >
                            {isVi ? descVi : descEn}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
                    </button>
                  );
                })}
              </div>

              {/* Active Staff Member Quick Switcher */}
              <div className="space-y-2.5 pt-3 border-t border-stone-200 dark:border-[#24352C]">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-[#94A39B]">
                  <User className="w-3.5 h-3.5" />
                  <span>{t.common.activeOperator}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {familyMembers.map((member) => {
                    const selected = member === activeOperator;
                    return (
                      <button
                        key={member}
                        type="button"
                        onClick={() => {
                          setActiveOperator(member);
                          setMoreSheetOpen(false);
                        }}
                        className={`h-11 px-4 rounded-xl text-sm font-semibold border inline-flex items-center gap-2 transition-colors ${
                          selected
                            ? 'bg-[#0D5C3E] text-white border-[#0D5C3E] dark:bg-[#10B981] dark:text-[#042419] dark:border-[#10B981]'
                            : 'bg-white dark:bg-[#0F1814] text-stone-700 dark:text-[#D5DFDA] border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#18251F]'
                        }`}
                      >
                        {selected && <Check className="w-4 h-4 shrink-0" />}
                        <span>{member}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional App Lock Action */}
              {security.enabled && (
                <div className="pt-2 border-t border-stone-200 dark:border-[#24352C]">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreSheetOpen(false);
                      setIsLocked(true);
                    }}
                    className="w-full h-12 px-4 rounded-xl border border-stone-200 dark:border-[#24352C] bg-stone-50 dark:bg-[#0F1814] hover:bg-stone-100 dark:hover:bg-[#18251F] text-sm font-semibold text-stone-800 dark:text-[#F1F5F3] inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{t.common.lockApp}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('join')) {
      return 'settings';
    }
    return 'dashboard';
  });

  return (
    <ErrorBoundary>
      <StoreProvider>
        <HintsProvider activeView={activeTab}>
          <UndoToastProvider>
            <JuiceFlowShell activeTab={activeTab} setActiveTab={setActiveTab} />
          </UndoToastProvider>
        </HintsProvider>
      </StoreProvider>
    </ErrorBoundary>
  );
}
