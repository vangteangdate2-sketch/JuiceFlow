import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, Image as ImageIcon, Loader2, RefreshCw, Search, X } from 'lucide-react';
import {
  clearWorkspaceAccessToken,
  getWorkspaceAccessToken,
  signInWithGoogleWorkspace,
} from '../lib/firebase';
import {
  downloadDriveImageAsDataUrl,
  DriveAuthExpiredError,
  listDriveImages,
  type DriveImageFile,
} from '../lib/googleDrive';
import { useStore } from '../context/StoreContext';
import { GoogleSignInButton } from './GoogleSignInButton';

interface GoogleDrivePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelectPhoto: (dataUrl: string) => void;
}

export const GoogleDrivePickerModal: React.FC<GoogleDrivePickerModalProps> = ({
  open,
  onClose,
  onSelectPhoto,
}) => {
  const { t } = useStore();

  const [token, setToken] = useState<string | null>(() => getWorkspaceAccessToken());
  const [files, setFiles] = useState<DriveImageFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  const fetchImages = useCallback(
    async (activeToken: string, queryText: string, page?: string) => {
      setError('');
      if (page) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const res = await listDriveImages(activeToken, queryText, page);
        setFiles((prev) => (page ? [...prev, ...res.files] : res.files));
        setNextPageToken(res.nextPageToken);
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          clearWorkspaceAccessToken();
          setToken(null);
          setFiles([]);
        }
        setError(err instanceof Error ? err.message : t.products.driveError);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [t.products.driveError]
  );

  useEffect(() => {
    if (!open) return;
    const currentToken = getWorkspaceAccessToken();
    setToken(currentToken);
    setError('');
    if (currentToken) {
      fetchImages(currentToken, '');
    }
  }, [open, fetchImages]);

  if (!open) return null;

  const handleConnectGoogle = async () => {
    setError('');
    setSigningIn(true);
    try {
      const { accessToken } = await signInWithGoogleWorkspace();
      if (!accessToken) {
        setError(t.products.driveTokenMissing);
        return;
      }
      setToken(accessToken);
      await fetchImages(accessToken, searchQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.products.driveError);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    fetchImages(token, searchQuery);
  };

  const handlePickFile = async (file: DriveImageFile) => {
    if (!token || importingId) return;
    setError('');
    setImportingId(file.id);
    try {
      const dataUrl = await downloadDriveImageAsDataUrl(token, file.id);
      onSelectPhoto(dataUrl);
      onClose();
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        clearWorkspaceAccessToken();
        setToken(null);
        setFiles([]);
      }
      setError(err instanceof Error ? err.message : t.products.driveImportFailed);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/55 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl overflow-hidden flex flex-col max-h-[85vh] shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 dark:border-[#24352C] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <HardDrive className="w-5 h-5 text-[#0F5C43] dark:text-[#34D399] shrink-0" />
            <h3 className="font-display text-lg font-semibold text-stone-900 dark:text-[#F1F5F3] truncate">
              {t.products.driveModalTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:bg-stone-100 dark:hover:bg-[#18251F] rounded-lg transition-colors"
            aria-label={t.common.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {!token ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-stone-100 dark:bg-[#18251F] text-[#0F5C43] dark:text-[#34D399] flex items-center justify-center mx-auto">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div className="max-w-sm mx-auto space-y-1.5">
              <h4 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3]">
                {t.products.driveConnectTitle}
              </h4>
              <p className="text-sm text-stone-500 dark:text-[#94A39B] leading-relaxed">
                {t.products.driveConnectDesc}
              </p>
            </div>
            <div className="pt-2 flex justify-center">
              <GoogleSignInButton
                onClick={handleConnectGoogle}
                label={t.settings.signInGoogle}
                disabled={signingIn}
              />
            </div>
            {error && (
              <p className="text-xs text-red-700 dark:text-[#F87171] font-medium">{error}</p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Search toolbar */}
            <form
              onSubmit={handleSearchSubmit}
              className="p-4 border-b border-stone-200 dark:border-[#24352C] flex items-center gap-2 shrink-0"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 dark:text-[#94A39B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.products.driveSearchPlaceholder}
                  className="w-full h-11 pl-9 pr-3 text-sm bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] placeholder:text-stone-400 dark:placeholder:text-[#94A39B] border border-stone-200 dark:border-[#24352C] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="h-11 px-4 text-xs font-semibold text-white bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:text-[#042419] dark:hover:bg-[#34D399] rounded-lg whitespace-nowrap shrink-0 transition-colors"
              >
                {t.common.search.replace('...', '')}
              </button>
              <button
                type="button"
                onClick={() => fetchImages(token, searchQuery)}
                disabled={loading}
                className="h-11 w-11 inline-flex items-center justify-center text-stone-600 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:bg-stone-50 dark:hover:bg-[#1F3028] rounded-lg shrink-0 transition-colors"
                aria-label="Refresh Drive photos"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </form>

            {error && (
              <div className="mx-4 mt-3 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/40 rounded-lg">
                {error}
              </div>
            )}

            {/* Image grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-stone-200 dark:border-[#24352C] overflow-hidden"
                    >
                      <div className="h-28 bg-stone-100 dark:bg-[#18251F] animate-pulse" />
                      <div className="p-2.5">
                        <div className="h-3 bg-stone-100 dark:bg-[#18251F] rounded w-3/4 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : files.length === 0 ? (
                <div className="py-12 text-center text-sm text-stone-500 dark:text-[#94A39B]">
                  {t.products.driveEmpty}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {files.map((file) => {
                      const isImporting = importingId === file.id;
                      return (
                        <button
                          key={file.id}
                          type="button"
                          disabled={Boolean(importingId)}
                          onClick={() => handlePickFile(file)}
                          className="group text-left bg-white dark:bg-[#18251F] border border-stone-200 dark:border-[#24352C] hover:border-[#0F5C43] dark:hover:border-[#10B981] rounded-lg overflow-hidden transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981] disabled:opacity-60"
                        >
                          <div className="relative h-28 bg-stone-100 dark:bg-[#0F1814] flex items-center justify-center overflow-hidden">
                            {file.thumbnailLink ? (
                              <img
                                src={file.thumbnailLink}
                                alt={file.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                              />
                            ) : (
                              <ImageIcon className="w-7 h-7 text-stone-400 dark:text-[#94A39B]" />
                            )}
                            {isImporting && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white gap-1.5 text-xs font-medium">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>{t.products.importingPhoto}</span>
                              </div>
                            )}
                          </div>
                          <div className="p-2.5">
                            <p className="text-xs font-medium text-stone-800 dark:text-[#F1F5F3] truncate">
                              {file.name}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {nextPageToken && (
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => fetchImages(token, searchQuery, nextPageToken)}
                        className="h-11 px-4 text-xs font-medium text-stone-700 dark:text-[#F1F5F3] bg-stone-100 dark:bg-[#18251F] border border-transparent dark:border-[#24352C] hover:bg-stone-200 dark:hover:bg-[#1F3028] rounded-lg transition-colors"
                      >
                        {loadingMore ? t.products.importingPhoto : t.products.driveLoadMore}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
