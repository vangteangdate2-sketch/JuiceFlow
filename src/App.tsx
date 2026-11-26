import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  Coffee,
  HelpCircle,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sun,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StoreProvider, useStore } from './context/StoreContext';
import { HintsProvider, useHints } from './context/HintsContext';
import { useTheme } from './hooks/useTheme';
import { BiometricLockScreen } from './components/BiometricLockScreen';
import { OfflineBanner } from './components/OfflineBanner';
import { PWAInstallButton } from './components/PWAInstallButton';
import { DashboardView } from './views/DashboardView';
import { SalesView } from './views/SalesView';
import { ProductsView } from './views/ProductsView';
import { InventoryView } from './views/InventoryView';
import { ExpensesView } from './views/ExpensesView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { loadSecurityConfig, saveSecurityConfig } from './lib/biometric';
import type { AppTab, BiometricSecurityConfig } from './types';

const NAV_ITEMS: { id: AppTab; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'sales', icon: ShoppingCart },
  { id: 'products', icon: Coffee },
  { id: 'inventory', icon: Package },
  { id: 'expenses', icon: Receipt },
  { id: 'reports', icon: BarChart3 },
  { id: 'settings', icon: Settings },
];

interface JuiceFlowShellProps {
  activeTab: AppTab;
  setActiveTab: React.Dispatch<React.SetStateAction<AppTab>>;
}

const JuiceFlowShell: React.FC<JuiceFlowShellProps> = ({ activeTab, setActiveTab }) => {
  const { settings, cloudSynced, syncing, refreshing, refreshData, t, setActiveOperator } = useStore();
  const { isDark, toggleTheme } = useTheme();
  const { showHints, toggleShowHints } = useHints();
  const isVi = settings?.language === 'vi';
  const familyMembers =
    Array.isArray(settings?.familyMembers) && settings.familyMembers.length > 0
      ? settings.familyMembers
      : [settings?.activeOperator || 'Family'];
  const activeOperator = settings?.activeOperator || familyMembers[0] || 'Family';

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('juiceflow_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [justRefreshed, setJustRefreshed] = useState(false);
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

  const handleManualRefresh = async () => {
    if (refreshing || syncing) return;
    const res = await refreshData();
    if (res.ok) {
      setJustRefreshed(true);
      window.setTimeout(() => setJustRefreshed(false), 1600);
    }
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

  const navigate = (tab: AppTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  if (isLocked && security.enabled) {
    return <BiometricLockScreen config={security} onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#F6F7F5] text-stone-900 dark:bg-[#0B110E] dark:text-[#F1F5F3] flex flex-col transition-colors duration-150">
      <OfflineBanner />

      <div className="flex-1 flex min-w-0">
        {/* Mobile Sidebar Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Navigation (256px desktop or 76px icon-only rail when collapsed) */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-[#131D18] border-r border-stone-200 dark:border-[#24352C] flex flex-col transition-[width,transform,background-color,border-color] duration-200 lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
            sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-64'
          } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {/* Brand Lockup & Collapse Toggle */}
          <div
            className={`h-16 border-b border-stone-200 dark:border-[#24352C] flex items-center shrink-0 ${
              sidebarCollapsed ? 'px-5 lg:px-0 lg:justify-center' : 'px-5 justify-between'
            }`}
          >
            <button
              type="button"
              onClick={() => navigate('dashboard')}
              title={t.brand}
              className={`font-display text-xl font-bold tracking-tight text-[#0F5C43] dark:text-[#10B981] whitespace-nowrap shrink-0 h-11 inline-flex items-center ${
                sidebarCollapsed ? 'lg:hidden' : ''
              }`}
            >
              {t.brand}
            </button>
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
              className="hidden lg:inline-flex items-center justify-center w-11 h-11 rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] transition-colors shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] lg:hidden"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Primary Navigation Links (minimum 44px touch height) */}
          <nav
            className={`flex-1 space-y-1.5 overflow-y-auto ${
              sidebarCollapsed ? 'p-3 lg:px-3' : 'p-3'
            }`}
            aria-label="Main navigation"
          >
            {NAV_ITEMS.map(({ id, icon: Icon }) => {
              const isCurrent = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  title={sidebarCollapsed ? t.nav[id] : undefined}
                  aria-label={t.nav[id]}
                  className={`w-full min-h-[44px] h-11 flex items-center gap-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    sidebarCollapsed
                      ? 'px-3.5 lg:px-0 lg:justify-center'
                      : 'px-3.5'
                  } ${
                    isCurrent
                      ? 'bg-[#0D5C3E] text-white dark:bg-[#10B981] dark:text-[#042419] font-semibold'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-950 dark:text-[#94A39B] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isCurrent
                        ? 'text-white dark:text-[#042419]'
                        : 'text-stone-500 dark:text-[#94A39B]'
                    }`}
                  />
                  <span className={`truncate ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                    {t.nav[id]}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Family Operator Switcher & Lock Footer */}
          <div
            className={`border-t border-solid border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] shrink-0 ${
              sidebarCollapsed ? 'p-4 lg:p-3 lg:flex lg:flex-col lg:items-center lg:gap-2' : 'p-4 space-y-3'
            }`}
          >
            {sidebarCollapsed && (
              <div className="hidden lg:flex flex-col items-center gap-2">
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
              </div>
            )}

            <div className={sidebarCollapsed ? 'space-y-3 lg:hidden' : 'space-y-3'}>
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

              <div className="flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-[#94A39B]">
                <button
                  type="button"
                  onClick={() => {
                    navigate('settings');
                    window.setTimeout(() => {
                      document.getElementById('cloud-sync')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }}
                  className="min-h-[44px] truncate text-left hover:text-[#0F5C43] dark:hover:text-[#10B981] transition-colors"
                >
                  {syncing
                    ? t.common.syncing
                    : cloudSynced
                      ? t.common.onlineSynced
                      : t.common.localMode}
                </button>
                {security.enabled && (
                  <button
                    type="button"
                    onClick={() => setIsLocked(true)}
                    className="min-h-[44px] inline-flex items-center gap-1 font-medium text-stone-700 dark:text-[#F1F5F3] hover:text-[#0F5C43] dark:hover:text-[#10B981] whitespace-nowrap shrink-0"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    {t.common.lockApp}
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar (64px height so 44px touch targets have comfortable breathing room) */}
          <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-xs border-b border-stone-200 dark:border-[#24352C] px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0 transition-colors duration-150">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="w-11 h-11 -ml-1.5 inline-flex items-center justify-center rounded-lg text-stone-600 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#1F3028] lg:hidden shrink-0"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="font-medium text-stone-500 dark:text-[#94A39B] truncate hidden sm:inline">
                  {settings.name}
                </span>
                <span className="text-stone-300 dark:text-[#24352C] hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <span className="font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
                  {t.nav[activeTab]}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Global Show Hints Switch (minimum 44px touch height) */}
              <button
                type="button"
                role="switch"
                aria-checked={showHints}
                onClick={toggleShowHints}
                aria-label={isVi ? 'Bật hoặc tắt gợi ý trên toàn ứng dụng' : 'Toggle helper hints across all pages'}
                title={isVi ? 'Hiện / ẩn gợi ý giải thích' : 'Show or hide helper hints'}
                className="inline-flex items-center gap-1.5 sm:gap-2 h-11 min-h-[44px] px-2 sm:px-3 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100/90 dark:bg-neutral-800/90 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/80 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
              >
                <HelpCircle
                  className={`w-4 h-4 shrink-0 ${
                    showHints
                      ? 'text-[#0D5C3E] dark:text-[#34D399]'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                />
                <span className="hidden md:inline">
                  {isVi ? 'Gợi ý' : 'Show Hints'}
                </span>
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                    showHints
                      ? 'bg-[#0D5C3E] dark:bg-[#10B981]'
                      : 'bg-neutral-300 dark:bg-neutral-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-[#0B110E] shadow-xs transition-transform ${
                      showHints ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </span>
              </button>

              {/* Light / Dark Mode Switcher (minimum 44x44px tap area) */}
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
                className="inline-flex items-center justify-center w-11 h-11 text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]"
              >
                {isDark ? (
                  <Sun className="w-[18px] h-[18px] text-amber-300" />
                ) : (
                  <Moon className="w-[18px] h-[18px] text-stone-600" />
                )}
              </button>

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing || syncing}
                title={
                  cloudSynced
                    ? isVi
                      ? 'Làm mới dữ liệu từ đám mây'
                      : 'Refresh latest data from cloud'
                    : isVi
                      ? 'Làm mới dữ liệu cục bộ'
                      : 'Refresh local data'
                }
                aria-label={isVi ? 'Làm mới dữ liệu' : 'Refresh data'}
                className="inline-flex items-center justify-center gap-1.5 min-w-[44px] h-11 px-3.5 text-xs font-medium text-stone-700 dark:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] hover:text-stone-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {justRefreshed ? (
                  <Check className="w-4 h-4 text-[#0F5C43] dark:text-[#10B981]" />
                ) : (
                  <RefreshCw
                    className={`w-4 h-4 ${
                      refreshing || syncing
                        ? 'animate-spin text-[#0F5C43] dark:text-[#10B981]'
                        : 'text-stone-500 dark:text-[#94A39B]'
                    }`}
                  />
                )}
                <span className="hidden sm:inline">
                  {refreshing
                    ? isVi
                      ? 'Đang tải...'
                      : 'Refreshing...'
                    : justRefreshed
                      ? isVi
                        ? 'Đã cập nhật'
                        : 'Updated'
                      : isVi
                        ? 'Làm mới'
                        : 'Refresh'}
                </span>
              </button>
              <PWAInstallButton variant="compact" />
              {activeTab !== 'sales' && (
                <button
                  type="button"
                  onClick={() => navigate('sales')}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-4 text-xs font-semibold text-white dark:text-[#042419] bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  {t.dashboard.newSale}
                </button>
              )}
            </div>
          </header>

          {/* Main Content Container */}
          <main
            className={`flex-1 w-full mx-auto px-4 sm:px-6 transition-[max-width] duration-200 ${
              activeTab === 'sales'
                ? sidebarCollapsed
                  ? 'max-w-[1520px] py-4 sm:py-5'
                  : 'max-w-[1360px] py-4 sm:py-5'
                : 'max-w-[1320px] lg:px-8 py-6 sm:py-8'
            }`}
          >
            {activeTab === 'dashboard' && <DashboardView onNavigate={navigate} />}
            {activeTab === 'sales' && <SalesView sidebarCollapsed={sidebarCollapsed} />}
            {activeTab === 'products' && <ProductsView />}
            {activeTab === 'inventory' && <InventoryView />}
            {activeTab === 'expenses' && <ExpensesView />}
            {activeTab === 'reports' && <ReportsView />}
            {activeTab === 'settings' && (
              <SettingsView
                security={security}
                onUpdateSecurity={handleUpdateSecurity}
                onLockNow={() => setIsLocked(true)}
              />
            )}
          </main>
        </div>
      </div>
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
          <JuiceFlowShell activeTab={activeTab} setActiveTab={setActiveTab} />
        </HintsProvider>
      </StoreProvider>
    </ErrorBoundary>
  );
}
