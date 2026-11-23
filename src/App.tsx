import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Coffee,
  LayoutDashboard,
  Lock,
  Menu,
  Package,
  Plus,
  Receipt,
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
  const { settings, cloudSynced, syncing, t, setActiveOperator } = useStore();

  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('join')) {
      return 'settings';
    }
    return 'dashboard';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [security, setSecurity] = useState<BiometricSecurityConfig>(() => loadSecurityConfig());
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    const cfg = loadSecurityConfig();
    return cfg.enabled && (cfg.biometricEnrolled || Boolean(cfg.pinHash));
  });

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

        {/* Sidebar Navigation (256px desktop) */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-stone-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Brand Lockup */}
          <div className="h-14 px-5 border-b border-stone-200 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={() => navigate('dashboard')}
              className="font-display text-xl font-bold tracking-tight text-[#0F5C43] whitespace-nowrap shrink-0"
            >
              {t.brand}
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
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Main navigation">
            {NAV_ITEMS.map(({ id, icon: Icon }) => {
              const isCurrent = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isCurrent
                      ? 'bg-[#0F5C43] text-white'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-950'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-white' : 'text-stone-500'}`} />
                  <span className="truncate">{t.nav[id]}</span>
                </button>
              );
            })}
          </nav>

          {/* Family Operator Switcher & Lock Footer */}
          <div className="p-4 border-t border-stone-200 space-y-3 bg-stone-50/60">
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

            <div className="flex items-center gap-2.5 shrink-0">
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
          <main className="flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {activeTab === 'dashboard' && <DashboardView onNavigate={navigate} />}
            {activeTab === 'sales' && <SalesView />}
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
