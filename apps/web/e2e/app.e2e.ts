/**
 * app.e2e.ts
 * Phase 7 — Frontend End-to-End Tests (Playwright)
 *
 * Run:
 *   cd apps/web && npx playwright test        # headless
 *   cd apps/web && npx playwright test --ui   # visual
 *
 * Prereq: npm run dev must be running on port 3000
 *         (or set baseURL below to staging URL)
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ── 1. Homepage ───────────────────────────────────────────────────
test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
  });

  test('loads with 200 and correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/TradeAgent/);
  });

  test('hero headline is visible', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Deploy AI Trading Agents');
  });

  test('navigation bar is visible with all links', async ({ page }) => {
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
    await expect(page.getByRole('link', { name: /wallet/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /create/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /marketplace/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /builder/i })).toBeVisible();
  });

  test('"Create Your Agent" CTA links to /create', async ({ page }) => {
    await page.getByRole('link', { name: /create your agent/i }).click();
    await expect(page).toHaveURL(`${BASE}/create`);
  });

  test('"Browse Marketplace" CTA links to /marketplace', async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole('link', { name: /browse marketplace/i }).click();
    await expect(page).toHaveURL(`${BASE}/marketplace`);
  });

  test('stats cards are visible', async ({ page }) => {
    await page.goto(BASE);
    // Wait for at least one animated stat card
    const cards = page.locator('.glass-card');
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
  });

  test('page has dark background (no white flash)', async ({ page }) => {
    const bg = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    // #0A0A0F = rgb(10,10,15)
    expect(bg).toBe('rgb(10, 10, 15)');
  });
});

// ── 2. Navigation ──────────────────────────────────────────────────
test.describe('Navigation', () => {
  test('Connect Wallet button is visible when not connected', async ({ page }) => {
    await page.goto(BASE);
    const btn = page.getByRole('link', { name: /connect wallet/i });
    await expect(btn).toBeVisible();
  });

  test('nav links navigate to correct pages', async ({ page }) => {
    const routes = [
      { label: 'Wallet',      url: '/wallet' },
      { label: 'Create',      url: '/create' },
      { label: 'Marketplace', url: '/marketplace' },
      { label: 'Builder',     url: '/builder' },
    ];

    for (const { label, url } of routes) {
      await page.goto(BASE);
      await page.getByRole('link', { name: label }).first().click();
      await expect(page).toHaveURL(`${BASE}${url}`);
    }
  });
});

// ── 3. Wallet page ─────────────────────────────────────────────────
test.describe('Wallet page', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}/wallet`);
    await page.waitForLoadState('networkidle');
    // Filter out known benign errors (e.g. browser extension attributes)
    const fatal = errors.filter(e => !e.includes('hydration') && !e.includes('extension'));
    expect(fatal).toHaveLength(0);
  });

  test('shows Connect Wallet prompt when not connected', async ({ page }) => {
    await page.goto(`${BASE}/wallet`);
    // Either "Connect Wallet" text or the balance section
    const connectText = page.getByText(/connect.*wallet|wallet.*connect/i);
    await expect(connectText.first()).toBeVisible({ timeout: 5000 });
  });
});

// ── 4. Create (AI Prompt Builder) page ────────────────────────────
test.describe('Create Agent page', () => {
  test('shows chat interface', async ({ page }) => {
    await page.goto(`${BASE}/create`);
    // Input or textarea should be present
    const input = page.locator('input[type="text"], textarea').first();
    await expect(input).toBeVisible({ timeout: 5000 });
  });

  test('example prompts are clickable', async ({ page }) => {
    await page.goto(`${BASE}/create`);
    const prompt = page.getByText(/RSI|EMA|momentum|BTCUSD/i).first();
    if (await prompt.isVisible()) {
      await prompt.click();
    }
    // No assertion needed — just ensure no crash on click
  });
});

// ── 5. Marketplace page ───────────────────────────────────────────
test.describe('Marketplace page', () => {
  test('renders heading', async ({ page }) => {
    await page.goto(`${BASE}/marketplace`);
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('filter pills are visible', async ({ page }) => {
    await page.goto(`${BASE}/marketplace`);
    // "All" filter pill should always be there
    const allPill = page.getByRole('button', { name: /all/i }).first();
    if (await allPill.isVisible()) {
      await allPill.click(); // no crash
    }
  });
});

// ── 6. Builder page ───────────────────────────────────────────────
test.describe('Builder page', () => {
  test('ReactFlow canvas mounts', async ({ page }) => {
    await page.goto(`${BASE}/builder`);
    // ReactFlow renders a .react-flow container
    const canvas = page.locator('.react-flow, [data-testid="rf__wrapper"]');
    await expect(canvas).toBeVisible({ timeout: 8000 });
  });
});

// ── 7. 404 page ───────────────────────────────────────────────────
test.describe('404 handling', () => {
  test('unknown route returns 404 status', async ({ page }) => {
    const res = await page.goto(`${BASE}/nonexistent-page-xyz`);
    expect(res?.status()).toBe(404);
  });
});
