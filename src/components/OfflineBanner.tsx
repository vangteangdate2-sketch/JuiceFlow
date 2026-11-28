import React from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useStore } from '../context/StoreContext';
import { useLanguage } from '../context/LanguageContext';

interface SyncStatusPillProps {
  onClick?: () => void;
  compact?: boolean;
}

export const SyncStatusPill: React.FC<SyncStatusPillProps> = ({ onClick, compact = false }) => {
  const isOnline = useOnlineStatus();
  const { cloudSynced, syncing } = useStore();
  const { isKm } = useLanguage();

  const statusConfig = !isOnline
    ? {
        tone: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-500/40',
        label: isKm ? 'គ្មានអ៊ីនធឺណិត • រក្សាទុកក្នុងឧបករណ៍' : 'Offline • Saved on Device',
        kind: 'offline' as const,
      }
    : syncing
      ? {
          tone: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-500/35',
          label: isKm ? 'កំពុងធ្វើសមកាលកម្ម...' : 'Syncing...',
          kind: 'syncing' as const,
        }
      : cloudSynced
        ? {
            tone: 'bg-emerald-50/90 text-emerald-900 border-emerald-200 dark:bg-[#064E3B]/70 dark:text-[#A7F3D0] dark:border-[#10B981]/35',
            label: isKm ? 'បានរក្សាទុក និងធ្វើសមកាលកម្ម' : 'Saved & Synced',
            kind: 'synced' as const,
          }
        : {
            tone: 'bg-emerald-50/80 text-emerald-900 border-emerald-200/90 dark:bg-[#064E3B]/50 dark:text-[#A7F3D0] dark:border-[#10B981]/30',
            label: isKm ? 'បានរក្សាទុកក្នុងឧបករណ៍' : 'Saved on Device',
            kind: 'local' as const,
          };

  const content = (
    <>
      {statusConfig.kind === 'offline' ? (
        <WifiOff className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
      ) : statusConfig.kind === 'syncing' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700 dark:text-amber-300 shrink-0" />
      ) : (
        <span
          aria-hidden="true"
          className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-[#34D399] shrink-0"
        />
      )}
      <span className="truncate">{statusConfig.label}</span>
    </>
  );

  const baseClass = `inline-flex items-center gap-2 rounded-full border font-semibold transition-all duration-150 active:scale-[0.97] max-w-full ${
    compact ? 'h-9 px-3 text-[11px]' : 'h-10 px-3.5 text-xs'
  } ${statusConfig.tone}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]`}
      >
        {content}
      </button>
    );
  }

  return <span className={baseClass}>{content}</span>;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { isKm } = useLanguage();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="bg-amber-50/95 dark:bg-amber-950/70 border-b border-amber-200 dark:border-amber-500/40 px-4 py-2 text-xs text-amber-950 dark:text-amber-100 flex flex-wrap items-center justify-center gap-2 print:hidden"
    >
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/80 border border-amber-300/80 dark:border-amber-500/40 font-semibold text-amber-900 dark:text-amber-100">
        <WifiOff className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
        <span>{isKm ? 'គ្មានអ៊ីនធឺណិត • រក្សាទុកក្នុងឧបករណ៍' : 'Offline • Saved on Device'}</span>
      </span>
      <span className="text-amber-800 dark:text-amber-200/90">
        {isKm
          ? 'ការលក់ និងការកែប្រែទាំងអស់ត្រូវបានរក្សាទុកដោយសុវត្ថិភាព ហើយនឹងធ្វើសមកាលកម្មពេលភ្ជាប់អ៊ីនធឺណិតវិញ។'
          : 'All sales and updates are safely saved and will sync when you reconnect.'}
      </span>
    </div>
  );
};
