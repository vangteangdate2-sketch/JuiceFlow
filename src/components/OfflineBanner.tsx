import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useStore } from '../context/StoreContext';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { t } = useStore();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs font-medium text-amber-900 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
      <span>{t.common.offlineMode}</span>
    </div>
  );
};
