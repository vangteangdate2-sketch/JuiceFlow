import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
];

export const REMEMBER_ME_STORAGE_KEY = 'juiceflow_remember_me';
export const PENDING_JOIN_STORAGE_KEY = 'juiceflow_pending_join_code';

export function loadRememberMePreference(): boolean {
  try {
    const saved = localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
    if (saved === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function saveRememberMePreference(rememberMe: boolean): void {
  try {
    localStorage.setItem(REMEMBER_ME_STORAGE_KEY, rememberMe ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
}

const app = initializeApp(firebaseConfig);
const databaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

let firestoreInstance: Firestore;
try {
  const settings = {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  };
  firestoreInstance = databaseId
    ? initializeFirestore(app, settings, databaseId)
    : initializeFirestore(app, settings);
} catch {
  firestoreInstance = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

export const db: Firestore = firestoreInstance;
export const auth = getAuth(app);

// Apply initial Remember Me persistence preference on startup
void setPersistence(
  auth,
  loadRememberMePreference() ? browserLocalPersistence : browserSessionPersistence
).catch(() => {
  // Fallback to default Firebase Auth persistence if browser storage is restricted
});

// Clean Google provider for Firestore Cloud Sync (no extra Workspace scopes)
export const cloudSyncGoogleProvider = new GoogleAuthProvider();
cloudSyncGoogleProvider.setCustomParameters({ prompt: 'select_account' });

// Dedicated Google provider with Drive read-only scope ONLY for Google Drive photo picker
export const driveGoogleProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  driveGoogleProvider.addScope(scope);
}

// In-memory access token cache ONLY (never persisted to localStorage or sessionStorage)
let cachedWorkspaceAccessToken: string | null = null;
let isSigningIn = false;

onAuthStateChanged(auth, (user: User | null) => {
  if (!user && !isSigningIn) {
    cachedWorkspaceAccessToken = null;
  }
});

export function isAllowedCloudUser(user: User | null): boolean {
  return Boolean(user && (user.emailVerified || user.isAnonymous));
}

export function getFirebaseAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  const match = message.match(/auth\/[a-z0-9-]+/i);
  return match ? match[0].toLowerCase() : '';
}

export async function applyAuthPersistence(rememberMe: boolean): Promise<void> {
  saveRememberMePreference(rememberMe);
  try {
    await setPersistence(
      auth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    );
  } catch {
    // Ignore restricted storage fallback
  }
}

export async function signInAnonymouslyForSync(rememberMe: boolean): Promise<User> {
  await applyAuthPersistence(rememberMe);
  const result = await signInAnonymously(auth);
  return result.user;
}

export async function signInWithGoogleForSync(
  rememberMe: boolean,
  pendingJoinCode?: string
): Promise<User | null> {
  await applyAuthPersistence(rememberMe);
  try {
    const result = await signInWithPopup(auth, cloudSyncGoogleProvider);
    return result.user;
  } catch (err) {
    const code = getFirebaseAuthErrorCode(err);
    // Automatic redirect fallback when mobile/PWA/static host blocks popups
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      if (pendingJoinCode) {
        try {
          sessionStorage.setItem(PENDING_JOIN_STORAGE_KEY, pendingJoinCode);
        } catch {
          // Ignore sessionStorage errors
        }
      }
      await signInWithRedirect(auth, cloudSyncGoogleProvider);
      return null;
    }
    throw err;
  }
}

export async function checkPendingRedirectResult(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch {
    return null;
  }
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  isSigningIn = true;
  try {
    await applyAuthPersistence(loadRememberMePreference());
    const result = await signInWithPopup(auth, driveGoogleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedWorkspaceAccessToken = credential.accessToken;
    }
    return {
      user: result.user,
      accessToken: cachedWorkspaceAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export function getWorkspaceAccessToken(): string | null {
  return cachedWorkspaceAccessToken;
}

export function clearWorkspaceAccessToken(): void {
  cachedWorkspaceAccessToken = null;
}

export async function signOutWorkspace(): Promise<void> {
  cachedWorkspaceAccessToken = null;
  await signOut(auth);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
