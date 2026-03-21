/**
 * setupHedera.ts — Phase 3 integration script
 *
 * Bootstraps all Hedera infrastructure required before Phase 4 (AI engine):
 *   1. Creates HCS topic for the test agent (per-agent audit trail)
 *   2. Stores test agent config in HFS (on-chain config)
 *   3. Creates the TradeAgent Strategies NFT collection
 *   4. Registers the platform on HCS-10 OpenConvAI (if enabled)
 *
 * Run this ONCE to set up the platform, then save the output to .env.
 *
 * Usage:
 *   cd apps/api
 *   npx ts-node --project tsconfig.json src/scripts/setupHedera.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  createHederaClient,
  getOperatorKey,
  getOperatorAccountId,
  createAgentTopic,
  submitAgentDecision,
  storeAgentConfig,
  readAgentConfig,
  createStrategyNFTCollection,
} from '@tradeagent/hedera';
import { readFileSync, writeFileSync } from 'fs';

const ENV_PATH = path.resolve(__dirname, '../../.env');

async function setupHedera(): Promise<void> {
  console.log('');
  console.log('🔧 TradeAgent — Hedera Infrastructure Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const client      = createHederaClient();
  const operatorKey = getOperatorKey();
  const operatorId  = getOperatorAccountId().toString();
  const network     = process.env.HEDERA_NETWORK || 'testnet';

  console.log(`📋 Operator: ${operatorId} | Network: ${network}`);
  console.log('');

  // ── Step 1: Create test agent HCS topic ──────────────────────
  console.log('📌 Step 1: Creating HCS topic (per-agent audit trail)...');

  const testAgentId = 'setup-test-agent';
  const hcsTopicId  = await createAgentTopic(client, testAgentId, operatorKey);

  console.log(`   ✅ HCS Topic created: ${hcsTopicId}`);
  console.log(`   🔗 HashScan: https://hashscan.io/${network}/topic/${hcsTopicId}`);
  console.log('');

  // ── Step 2: Submit a test decision to HCS ────────────────────
  console.log('📝 Step 2: Submitting test decision to HCS (before-trade invariant check)...');

  const hcsResult = await submitAgentDecision(client, hcsTopicId, {
    agentId:    testAgentId,
    signal:     'HOLD',
    price:      0.0842,
    confidence: 95,
    reasoning:  'Infrastructure test — no trade execution',
    indicators: { rsi: 50, ema_20: 0.0840 },
    timestamp:  new Date().toISOString(),
  });

  console.log(`   ✅ HCS message submitted!`);
  console.log(`   Sequence#: ${hcsResult.sequenceNumber}`);
  console.log(`   Consensus: ${hcsResult.consensusTimestamp}`);
  console.log('');

  // ── Step 3: Store test config in HFS ─────────────────────────
  console.log('📁 Step 3: Storing test agent config in HFS...');

  const testConfig = {
    agentId:      testAgentId,
    name:         'Setup Test Agent',
    strategyType: 'TREND_FOLLOW',
    asset:        'HBAR/USDC',
    timeframe:    '1h',
    indicators:   { movingAverage: { type: 'EMA', period: 20 }, rsi: { period: 14 } },
    risk:         { maxPositionSizePct: 10, stopLossPct: 3, takeProfitPct: 8 },
    createdAt:    new Date().toISOString(),
    version:      '1.0',
  };

  const hfsFileId = await storeAgentConfig(client, testConfig, operatorKey);

  console.log(`   ✅ HFS file created: ${hfsFileId}`);
  console.log(`   🔗 HashScan: https://hashscan.io/${network}/file/${hfsFileId}`);
  console.log('');

  // Verify we can read it back
  const readBack = await readAgentConfig(client, hfsFileId);
  console.log(`   ✅ Config verified on-chain: ${readBack.name} | ${readBack.strategyType}`);
  console.log('');

  // ── Step 4: Create NFT collection ────────────────────────────
  const skipNFT = process.env.STRATEGY_TOKEN_ID && process.env.STRATEGY_TOKEN_ID.trim() !== '';

  if (skipNFT) {
    console.log(`🎨 Step 4: NFT collection already exists — skipping`);
    console.log(`   STRATEGY_TOKEN_ID: ${process.env.STRATEGY_TOKEN_ID}`);
  } else {
    console.log('🎨 Step 4: Creating TradeAgent Strategies NFT collection (5% royalties)...');

    const tokenId = await createStrategyNFTCollection(client, operatorId, operatorKey);

    console.log(`   ✅ NFT collection created: ${tokenId}`);
    console.log(`   🔗 HashScan: https://hashscan.io/${network}/token/${tokenId}`);

    // Auto-update .env
    let envContent = readFileSync(ENV_PATH, 'utf8');
    envContent = envContent.replace(
      /^STRATEGY_TOKEN_ID=.*$/m,
      `STRATEGY_TOKEN_ID=${tokenId}`
    );
    writeFileSync(ENV_PATH, envContent, 'utf8');
    console.log(`   ✅ STRATEGY_TOKEN_ID saved to .env`);
  }

  console.log('');

  // ── Summary ───────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Phase 3 Hedera Infrastructure Ready!');
  console.log('');
  console.log('   ✅ HCS:  Topic created and test message confirmed with aBFT timestamp');
  console.log('   ✅ HFS:  Agent config stored and read back from Hedera File Service');
  console.log('   ✅ HTS:  Strategy NFT collection ready (5% protocol royalties)');
  console.log('');
  console.log(`   All services verified on: https://hashscan.io/${network}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📋 Save these to apps/api/.env:');
  console.log(`   AGENT_CONFIG_FILE_ID=<your first agent HFS ID>`);
  console.log('');
  console.log('▶️  Next: Phase 4 — AI Engine (Gemini + LangGraph + SaucerSwap)');
  console.log('');

  client.close();
}

setupHedera().catch((err) => {
  console.error('❌ Setup failed:', err.message || err);
  process.exit(1);
});
