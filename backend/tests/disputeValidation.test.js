import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prismaMock = {
  dispute: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
};

const cacheMock = {
  get: jest.fn(),
  set: jest.fn(),
  setWithTags: jest.fn(),
  invalidate: jest.fn(),
  invalidateTags: jest.fn(),
  invalidatePrefix: jest.fn(),
};

jest.unstable_mockModule('../lib/prisma.js', () => ({ default: prismaMock }));
jest.unstable_mockModule('../lib/cache.js', () => ({ default: cacheMock }));
jest.unstable_mockModule('../api/middleware/auth.js', () => ({
  default: (req, _res, next) => {
    req.user = { userId: 1, tenantId: 'tenant_default', type: 'access' };
    next();
  },
}));

const { default: disputeRoutes } = await import('../api/routes/disputeRoutes.js');

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.tenant = { id: 'tenant_default' };
    next();
  });
  app.use('/api/disputes', disputeRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheMock.get.mockReturnValue(null);
  prismaMock.dispute.findMany.mockResolvedValue([]);
  prismaMock.dispute.count.mockResolvedValue(0);
  prismaMock.dispute.findFirst.mockResolvedValue(null);
});

describe('dispute route validation', () => {
  it('accepts GET / with valid pagination query', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: '2', limit: '10' });
    expect(res.status).toBe(200);
    expect(prismaMock.dispute.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant_default' }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it('accepts GET / with no query (defaults in controller)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes');
    expect(res.status).toBe(200);
  });

  it('returns 400 for non-integer page', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'page',
          location: 'query',
        }),
      ]),
    });
    expect(prismaMock.dispute.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when limit exceeds maximum (100)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ limit: '500' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(prismaMock.dispute.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for page less than 1', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes').query({ page: '0' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid escrowId param', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({
          field: 'escrowId',
          location: 'params',
        }),
      ]),
    });
    expect(prismaMock.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for escrowId zero', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/disputes/0');
    expect(res.status).toBe(400);
  });

  it('accepts numeric escrowId and reaches controller', async () => {
    const app = buildApp();
    // Use numeric escrowId in the mock so JSON.stringify (res.json) succeeds; Prisma
    // returns BigInt in production — serialization is handled separately if needed.
    prismaMock.dispute.findFirst.mockResolvedValue({
      id: 99,
      escrowId: 42,
      raisedByAddress: 'GTEST',
      raisedAt: new Date(),
      resolvedAt: null,
      resolution: null,
      escrow: {},
      evidence: [],
      appeals: [],
    });
    const res = await request(app).get('/api/disputes/42');
    expect(res.status).toBe(200);
    expect(prismaMock.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { escrowId: 42n, tenantId: 'tenant_default' },
      }),
    );
  });

  describe('dispute evidence hash and CID validation', () => {
    it('accepts valid IPFS CIDv0 format', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      expect(isValidEvidenceHash('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco')).toBe(true);
    });

    it('accepts valid IPFS CIDv1 format', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      expect(isValidEvidenceHash('bafybeic56wh45asvf7ggn7p7pu2475y7k7j6n72u5quq4pynvaxevv2nha')).toBe(true);
    });

    it('accepts valid 64-char Hex SHA-256 format', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      expect(isValidEvidenceHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(true);
    });

    it('rejects empty evidence hash', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      expect(isValidEvidenceHash('')).toBe(false);
      expect(isValidEvidenceHash(null)).toBe(false);
      expect(isValidEvidenceHash(undefined)).toBe(false);
    });

    it('rejects oversized evidence hash (> 128 characters)', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      const oversized = 'a'.repeat(129);
      expect(isValidEvidenceHash(oversized)).toBe(false);
    });

    it('rejects evidence hash with invalid characters', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      expect(isValidEvidenceHash('QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6!@#')).toBe(false);
      expect(isValidEvidenceHash('QmXoypizjW3WknFiJnKLwHCnL 72vedxjQkDDP1mXWo6uco')).toBe(false);
    });

    it('rejects malformed CIDv0 (invalid base58 chars)', async () => {
      const { isValidEvidenceHash } = await import('../middleware/validation.js');
      // Contains '0' which is excluded in base58btc
      expect(isValidEvidenceHash('Qm00000000000000000000000000000000000000000000')).toBe(false);
    });
  });
});

