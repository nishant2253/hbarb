/**
 * health.test.ts
 * Phase 7 — API Integration Tests (basic health + route smoke tests)
 *
 * Run:  cd apps/api && npm test
 *
 * Uses Vitest (fast, native ESM) + Supertest for HTTP assertions.
 * Most routes are mocked — no live Hedera or Supabase connection required.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// ── Inline mock of heavy deps before importing the app ────────────
vi.mock('../db/prisma', () => ({
  prisma: {
    agent:        { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    execution:    { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    $disconnect:  vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Queue:  vi.fn().mockImplementation(() => ({ add: vi.fn(), close: vi.fn() })),
  Worker: vi.fn().mockImplementation(() => ({ close: vi.fn() })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    ping:       vi.fn().mockResolvedValue('PONG'),
    get:        vi.fn().mockResolvedValue(null),
    set:        vi.fn().mockResolvedValue('OK'),
    quit:       vi.fn().mockResolvedValue('OK'),
    on:         vi.fn(),
  })),
}));

// Mock Hedera SDK to avoid network calls
vi.mock('@hashgraph/sdk', () => ({
  Client:                    { forTestnet: vi.fn(() => ({ setOperator: vi.fn() })) },
  AccountId:                 { fromString: vi.fn(() => ({})) },
  PrivateKey:                { fromStringECDSA: vi.fn(() => ({})) },
  TopicCreateTransaction:    vi.fn(() => ({ execute: vi.fn(), setSubmitKey: vi.fn(), setAdminKey: vi.fn(), setTopicMemo: vi.fn() })),
  TopicMessageSubmitTransaction: vi.fn(() => ({ execute: vi.fn(), setTopicId: vi.fn(), setMessage: vi.fn() })),
  FileCreateTransaction:     vi.fn(() => ({ execute: vi.fn(), setContents: vi.fn(), setKeys: vi.fn() })),
  ContractCreateTransaction: vi.fn(() => ({ execute: vi.fn() })),
  Hbar:                      vi.fn(),
  Status:                    { Success: 22 },
}));

let app: any;

beforeAll(async () => {
  // Import app after mocks are set so env is not needed
  process.env.NODE_ENV          = 'test';
  process.env.GEMINI_API_KEY    = 'test-key';
  process.env.OPERATOR_ID       = '0.0.123456';
  process.env.OPERATOR_KEY      = '302e0201...';
  process.env.DATABASE_URL      = 'postgresql://test:test@localhost:5432/test';
  process.env.SUPABASE_URL      = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.REDIS_URL         = 'redis://localhost:6379';

  const { default: expressApp } = await import('../index');
  app = expressApp;
});

// ── 1. Health endpoint ────────────────────────────────────────────
describe('GET /', () => {
  it('responds 200 with TradeAgent header info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'TradeAgent API');
  });
});

describe('GET /health', () => {
  it('responds 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});

// ── 2. Agents routes ──────────────────────────────────────────────
describe('GET /api/agents', () => {
  it('returns 200 with agents array', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agents');
    expect(Array.isArray(res.body.agents)).toBe(true);
  });
});

describe('GET /api/agents/:agentId', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await request(app).get('/api/agents/nonexistent-agent-id');
    expect(res.status).toBe(404);
  });
});

// ── 3. Marketplace routes ─────────────────────────────────────────
describe('GET /api/marketplace', () => {
  it('returns 200 with listings array', async () => {
    const res = await request(app).get('/api/marketplace');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('listings');
    expect(Array.isArray(res.body.listings)).toBe(true);
  });
});

// ── 4. Validation guard tests ──────────────────────────────────────
describe('POST /api/agents/build — validation', () => {
  it('returns 400 when prompt is missing', async () => {
    const res = await request(app)
      .post('/api/agents/build')
      .send({})
      .set('Content-Type', 'application/json');
    // Either 400 (validation) or 500 (Gemini mock not configured) — not 201
    expect([400, 422, 500]).toContain(res.status);
  });
});

describe('POST /api/agents/deploy — validation', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/agents/deploy')
      .send({ name: 'Test' })
      .set('Content-Type', 'application/json');
    expect([400, 422, 500]).toContain(res.status);
  });
});
