import { Platform } from 'react-native';

const PROD_HOST = 'talkhint.app';
export const WEB_PREVIEW_BASE = '/secretary-preview/';

export function isProductionHost(hostname: string): boolean {
  return hostname === PROD_HOST || hostname.endsWith(`.${PROD_HOST}`);
}

export function validateOrigin(value: string, native = Platform.OS !== 'web'): string {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an http or https backend origin.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Enter only the backend origin, without a path, credentials, or query string.');
  }
  if (isProductionHost(parsed.hostname)) throw new Error('Production talkhint.app is blocked in this development client.');
  if (native && parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Native clients require a development HTTPS backend origin.');
  }
  return parsed.origin;
}

export function defaultApiOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (configured) {
    try { return validateOrigin(configured); } catch { return ''; }
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (!isProductionHost(window.location.hostname)) return window.location.origin;
  }
  return '';
}
