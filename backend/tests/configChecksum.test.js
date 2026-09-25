import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import configRoutes from '../api/routes/configRoutes.js';
import {
  getRuntimeConfigChecksum,
  isSecretKey,
  getSanitizedRuntimeConfig,
  ALLOWED_CONFIG_SETTINGS,
} from '../services/runtimeConfigChecksumService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRoutes);
  return app;
}

describe('Runtime Config Checksum Endpoint (#202)', () => {
  it('GET /api/config/checksum returns 200 with checksum and hashes', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/config/checksum');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checksum');
    expect(res.body).toHaveProperty('algorithm', 'sha256');
    expect(res.body).toHaveProperty('keys');
    expect(res.body).toHaveProperty('hashes');
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(typeof res.body.hashes).toBe('object');
  });

  it('excludes secret keys from allowed settings and hashes', async () => {
    const testEnv = {
      NODE_ENV: 'test',
      PORT: '4000',
      JWT_SECRET: 'super-sensitive-jwt-secret-do-not-leak',
      ADMIN_API_KEY: 'admin-super-key-12345',
      DATABASE_URL: 'postgresql://postgres:secretpassword@localhost:5432/trustchain',
      VAULT_TOKEN: 's.my-vault-token',
    };

    const result = getRuntimeConfigChecksum({
      envSource: testEnv,
      allowedKeys: ['NODE_ENV', 'PORT', 'JWT_SECRET', 'ADMIN_API_KEY', 'DATABASE_URL', 'VAULT_TOKEN'],
    });

    // Secret keys must be excluded from keys list
    expect(result.keys).toContain('NODE_ENV');
    expect(result.keys).toContain('PORT');
    expect(result.keys).not.toContain('JWT_SECRET');
    expect(result.keys).not.toContain('ADMIN_API_KEY');
    expect(result.keys).not.toContain('DATABASE_URL');
    expect(result.keys).not.toContain('VAULT_TOKEN');

    // Hashes must only be present for allowed safe keys
    expect(result.hashes.NODE_ENV).toBeDefined();
    expect(result.hashes.PORT).toBeDefined();
    expect(result.hashes.JWT_SECRET).toBeUndefined();
    expect(result.hashes.ADMIN_API_KEY).toBeUndefined();
    expect(result.hashes.DATABASE_URL).toBeUndefined();

    // Verify raw secret values are nowhere in the output JSON
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-sensitive-jwt-secret-do-not-leak');
    expect(serialized).not.toContain('admin-super-key-12345');
    expect(serialized).not.toContain('secretpassword');
    expect(serialized).not.toContain('s.my-vault-token');
  });

  it('masks secrets in getSanitizedRuntimeConfig', () => {
    const testEnv = {
      NODE_ENV: 'production',
      PORT: '8080',
      JWT_SECRET: 'secret-key-123',
      DATABASE_URL: 'postgres://user:pass@db:5432/main',
      API_KEY: 'sensitive-api-token',
    };

    const sanitized = getSanitizedRuntimeConfig(testEnv);

    expect(sanitized.NODE_ENV).toBe('production');
    expect(sanitized.PORT).toBe('8080');
    expect(sanitized.JWT_SECRET).toBe('[REDACTED]');
    expect(sanitized.DATABASE_URL).toBe('[REDACTED]');
    expect(sanitized.API_KEY).toBe('[REDACTED]');
  });

  it('identifies sensitive keys accurately with isSecretKey', () => {
    expect(isSecretKey('JWT_SECRET')).toBe(true);
    expect(isSecretKey('JWT_ACCESS_SECRET')).toBe(true);
    expect(isSecretKey('ADMIN_API_KEY')).toBe(true);
    expect(isSecretKey('DATABASE_URL')).toBe(true);
    expect(isSecretKey('DB_PASSWORD')).toBe(true);
    expect(isSecretKey('PRIVATE_KEY')).toBe(true);
    expect(isSecretKey('AUTH_TOKEN')).toBe(true);
    expect(isSecretKey('SENTRY_DSN')).toBe(true);

    expect(isSecretKey('NODE_ENV')).toBe(false);
    expect(isSecretKey('PORT')).toBe(false);
    expect(isSecretKey('LOG_LEVEL')).toBe(false);
    expect(isSecretKey('STELLAR_NETWORK')).toBe(false);
    expect(isSecretKey('SOROBAN_RPC_URL')).toBe(false);
  });

  it('produces identical checksums for identical runtime configurations', () => {
    const envA = { NODE_ENV: 'production', PORT: '4000', LOG_LEVEL: 'info' };
    const envB = { NODE_ENV: 'production', PORT: '4000', LOG_LEVEL: 'info' };

    const checkA = getRuntimeConfigChecksum({ envSource: envA, allowedKeys: ['NODE_ENV', 'PORT', 'LOG_LEVEL'] });
    const checkB = getRuntimeConfigChecksum({ envSource: envB, allowedKeys: ['NODE_ENV', 'PORT', 'LOG_LEVEL'] });

    expect(checkA.checksum).toBe(checkB.checksum);
    expect(checkA.hashes).toEqual(checkB.hashes);
  });

  it('detects runtime configuration drift between instances', () => {
    const envA = { NODE_ENV: 'production', PORT: '4000', LOG_LEVEL: 'info' };
    const envB = { NODE_ENV: 'production', PORT: '4000', LOG_LEVEL: 'warn' };

    const checkA = getRuntimeConfigChecksum({ envSource: envA, allowedKeys: ['NODE_ENV', 'PORT', 'LOG_LEVEL'] });
    const checkB = getRuntimeConfigChecksum({ envSource: envB, allowedKeys: ['NODE_ENV', 'PORT', 'LOG_LEVEL'] });

    expect(checkA.checksum).not.toBe(checkB.checksum);
    expect(checkA.hashes.LOG_LEVEL).not.toBe(checkB.hashes.LOG_LEVEL);
    expect(checkA.hashes.NODE_ENV).toBe(checkB.hashes.NODE_ENV);
  });

  it('GET /api/config returns configuration overview with safe settings', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checksum');
    expect(res.body).toHaveProperty('settings');
    expect(typeof res.body.settings).toBe('object');
  });
});
