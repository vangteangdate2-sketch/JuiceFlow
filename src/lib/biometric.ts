import type { BiometricSecurityConfig } from '../types';

const SECURITY_STORAGE_KEY = 'juiceflow_security_v1';

export const DEFAULT_SECURITY_CONFIG: BiometricSecurityConfig = {
  enabled: false,
  biometricEnrolled: false,
  credentialId: null,
  pinHash: null,
  pinSalt: null,
  lockOnBackground: false,
};

export function loadSecurityConfig(): BiometricSecurityConfig {
  try {
    const raw = localStorage.getItem(SECURITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SECURITY_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BiometricSecurityConfig>;
    return {
      ...DEFAULT_SECURITY_CONFIG,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SECURITY_CONFIG };
  }
}

export function saveSecurityConfig(config: BiometricSecurityConfig): void {
  try {
    localStorage.setItem(SECURITY_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota issues
  }
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function isBiometricSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function enrollBiometricCredential(userLabel: string): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  if (typeof window === 'undefined' || !navigator.credentials || !window.PublicKeyCredential) {
    return { ok: false, error: 'WebAuthn unavailable in this browser' };
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const rpId = window.location.hostname;

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'JuiceFlow Family Ledger',
          id: rpId,
        },
        user: {
          id: userId,
          name: userLabel || 'family-member',
          displayName: userLabel || 'JuiceFlow Family Member',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, error: 'No biometric credential returned' };
    }

    return {
      ok: true,
      credentialId: bufferToBase64Url(credential.rawId),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Biometric enrollment failed',
    };
  }
}

export async function verifyBiometricCredential(credentialId: string): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.credentials || !window.PublicKeyCredential) {
    return false;
  }

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rawIdBytes = base64UrlToBuffer(credentialId);
    const idBuffer = rawIdBytes.buffer.slice(
      rawIdBytes.byteOffset,
      rawIdBytes.byteOffset + rawIdBytes.byteLength
    ) as ArrayBuffer;

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          {
            id: idBuffer,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

export async function hashPin(pin: string, existingSalt?: string): Promise<{ hash: string; salt: string }> {
  const salt =
    existingSalt ||
    bufferToBase64Url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const data = new TextEncoder().encode(`${salt}:${pin}:juiceflow`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return {
    hash: bufferToBase64Url(digest),
    salt,
  };
}

export async function verifyPin(pin: string, config: BiometricSecurityConfig): Promise<boolean> {
  if (!config.pinHash || !config.pinSalt) return false;
  const { hash } = await hashPin(pin, config.pinSalt);
  return hash === config.pinHash;
}
