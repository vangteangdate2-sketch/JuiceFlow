import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  Coffee,
  LayoutDashboard,
  Lock,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingCart,
  X,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StoreProvider, useStore } from './context/StoreContext';
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

const JuiceFlowShell: React.FC = () => {
  const { settings, cloudSynced, syncing, refreshing, refreshData, t, setActiveOperator } = useStore();
  const isVi = settings.language === 'vi';

  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('join')) {
      return 'settings';
    }
    return 'dashboard';
  });
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
    <div className="min-h-screen bg-[#F6F7F5] text-stone-900 flex flex-col">
      <OfflineBanner />

      <div className="flex-1 flex min-w-0">
        {/* Mobile Sidebar Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar Navigation (256px desktop or 72px icon-only rail when collapsed) */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-stone-200 flex flex-col transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
            sidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'
          } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {/* Brand Lockup & Collapse Toggle */}
          <div
            className={`h-14 border-b border-stone-200 flex items-center shrink-0 ${
              sidebarCollapsed ? 'px-5 lg:px-0 lg:justify-center' : 'px-5 justify-between'
            }`}
          >
            <button
              type="button"
              onClick={() => navigate('dashboard')}
              title={t.brand}
              className={`font-display text-xl font-bold tracking-tight text-[#0F5C43] whitespace-nowrap shrink-0 ${
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
              className="hidden lg:inline-flex items-center justify-center p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors shrink-0"
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
              className="p-1.5 text-stone-500 hover:text-stone-900 lg:hidden"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Primary Navigation Links */}
          <nav
            className={`flex-1 space-y-1 overflow-y-auto ${
              sidebarCollapsed ? 'p-3 lg:px-2.5' : 'p-3'
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
                  className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    sidebarCollapsed
                      ? 'px-3.5 py-2.5 lg:px-0 lg:justify-center'
                      : 'px-3.5 py-2.5'
                  } ${
                    isCurrent
                      ? 'bg-[#0D5C3E] text-white'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-950'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-white' : 'text-stone-500'}`} />
                  <span className={`truncate ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                    {t.nav[id]}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Family Operator Switcher & Lock Footer */}
          <div
            className={`border-t border-solid border-stone-200 bg-white shrink-0 ${
              sidebarCollapsed ? 'p-4 lg:p-2.5 lg:flex lg:flex-col lg:items-center lg:gap-2' : 'p-4 space-y-3'
            }`}
          >
            {sidebarCollapsed && (
              <div className="hidden lg:flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  title={`${t.common.activeOperator}: ${settings.activeOperator}`}
                  className="w-9 h-9 rounded-lg bg-[#E6F2ED] text-[#0D5C3E] text-xs font-bold flex items-center justify-center hover:bg-[#D9ECE4] transition-colors"
                >
                  {(settings.activeOperator || 'U').slice(0, 2).toUpperCase()}
                </button>
                {security.enabled && (
                  <button
                    type="button"
                    onClick={() => setIsLocked(true)}
                    title={t.common.lockApp}
                    aria-label={t.common.lockApp}
                    className="p-2 rounded-lg text-stone-500 hover:text-[#0D5C3E] hover:bg-stone-100 transition-colors"
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
                  className="block text-[11px] font-medium text-stone-500 mb-1"
                >
                  {t.common.activeOperator}
                </label>
                <select
                  id="operator-select"
                  value={settings.activeOperator}
                  onChange={(e) => setActiveOperator(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-medium bg-white border border-stone-200 rounded-lg text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]"
                >
                  {settings.familyMembers.map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
                <button
                  type="button"
                  onClick={() => {
                    navigate('settings');
                    window.setTimeout(() => {
                      document.getElementById('cloud-sync')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }}
                  className="truncate text-left hover:text-[#0F5C43] transition-colors"
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
                    className="inline-flex items-center gap-1 font-medium text-stone-700 hover:text-[#0F5C43] whitespace-nowrap shrink-0"
                  >
                    <Lock className="w-3 h-3" />
                    {t.common.lockApp}
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar (56px height, clean breadcrumb left + 1-2 primary controls right) */}
          <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-xs border-b border-stone-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 -ml-2 text-stone-600 hover:text-stone-900 lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="font-medium text-stone-500 truncate hidden sm:inline">
                  {settings.name}
                </span>
                <span className="text-stone-300 hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <span className="font-semibold text-stone-900 truncate">
                  {t.nav[activeTab]}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
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
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 hover:text-stone-900 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {justRefreshed ? (
                  <Check className="w-3.5 h-3.5 text-[#0F5C43]" />
                ) : (
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${refreshing || syncing ? 'animate-spin text-[#0F5C43]' : 'text-stone-500'}`}
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
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
  return (
    <ErrorBoundary>
      <StoreProvider>
        <JuiceFlowShell />
      </StoreProvider>
    </ErrorBoundary>
  );
}
