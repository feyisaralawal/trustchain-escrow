/**
 * Runtime Configuration Checksum Service
 *
 * Provides a cryptographic digest (SHA-256) of safe, non-sensitive runtime
 * configuration so operators can compare and verify instance parity across
 * clusters and environments without exposing secrets or credentials.
 *
 * @module services/runtimeConfigChecksumService
 */

import crypto from 'crypto';

/**
 * Whitelist of safe, non-secret configuration keys that can be inspected and hashed.
 */
export const ALLOWED_CONFIG_SETTINGS = [
  'NODE_ENV',
  'PORT',
  'LOG_LEVEL',
  'STELLAR_NETWORK',
  'STELLAR_HORIZON_URL',
  'SOROBAN_RPC_URL',
  'CONTRACT_ID',
  'ESCROW_CONTRACT_ID',
  'API_VERSION',
  'CACHE_BACKEND',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'FEATURE_FLAGS',
  'CORS_ORIGIN',
  'APP_URL',
  'IPFS_GATEWAY_URL',
  'SECRETS_BACKEND',
  'REQUEST_SIZE_LIMIT',
  'HEALTH_STELLAR_TIMEOUT_MS',
];

/**
 * Patterns matching sensitive or secret environment variables that must never be leaked.
 */
export const SECRET_KEY_PATTERNS = [
  /secret/i,
  /key/i,
  /password/i,
  /pass/i,
  /token/i,
  /database_url/i,
  /prisma/i,
  /private/i,
  /auth/i,
  /credential/i,
  /salt/i,
  /encryption/i,
  /webhook/i,
  /cert/i,
  /sentry/i,
];

/**
 * Checks whether an environment variable key represents a secret.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  if (!key || typeof key !== 'string') return true;
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Hashes a configuration value with SHA-256.
 *
 * @param {string} value
 * @returns {string} Hex hash string
 */
export function hashConfigValue(value) {
  const normalized = value !== undefined && value !== null ? String(value) : '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generates runtime configuration checksum and individual setting hashes.
 * Secrets are strictly excluded from allowed keys and masked in settings.
 *
 * @param {Object} [options]
 * @param {string[]} [options.allowedKeys]
 * @param {boolean} [options.includeSettings=false]
 * @param {Object} [options.envSource=process.env]
 * @returns {Object}
 */
export function getRuntimeConfigChecksum(options = {}) {
  const envSource = options.envSource || process.env;
  const rawAllowed = options.allowedKeys || ALLOWED_CONFIG_SETTINGS;

  // Enforce secret exclusion: even if an allowedKeys list contains a secret key, exclude it
  const safeKeys = rawAllowed
    .filter((k) => !isSecretKey(k))
    .sort();

  const hashes = {};
  const settings = {};

  for (const key of safeKeys) {
    const rawVal = envSource[key];
    hashes[key] = hashConfigValue(rawVal);
    if (options.includeSettings) {
      settings[key] = rawVal !== undefined ? rawVal : null;
    }
  }

  // Canonical representation: sorted key=hash lines
  const canonical = safeKeys.map((k) => `${k}=${hashes[k]}`).join('\n');
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');

  const result = {
    checksum,
    algorithm: 'sha256',
    timestamp: new Date().toISOString(),
    keys: safeKeys,
    hashes,
  };

  if (options.includeSettings) {
    result.settings = settings;
  }

  return result;
}

/**
 * Returns sanitized runtime configuration with all secrets masked as [REDACTED].
 *
 * @param {Object} [envSource=process.env]
 * @returns {Object}
 */
export function getSanitizedRuntimeConfig(envSource = process.env) {
  const sanitized = {};
  for (const [key, value] of Object.entries(envSource)) {
    if (isSecretKey(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export default {
  ALLOWED_CONFIG_SETTINGS,
  SECRET_KEY_PATTERNS,
  isSecretKey,
  hashConfigValue,
  getRuntimeConfigChecksum,
  getSanitizedRuntimeConfig,
};
