/**
 * routes/agents.ts — Core agent API routes
 *
 * POST /api/agents/build   — Gemini parses user prompt → AgentConfig + hash
 * POST /api/agents/deploy  — 5-step Hedera deployment (HCS + HFS + HSCS + HCS-10 + BullMQ)
 * GET  /api/agents         — List all agents for an owner
 * GET  /api/agents/:id     — Get single agent details
 * GET  /api/agents/:id/history — Mirror Node HCS history (tamper-proof source of truth)
 * POST /api/agents/:id/run — Trigger one manual execution cycle (dry-run optional)
 * PUT  /api/agents/:id/pause   — Pause/resume scheduling
 * DELETE /api/agents/:id  — Deactivate agent + remove from BullMQ queue
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import prisma from '../db/prisma';
import { AgentConfigSchema } from '../agent/promptBuilder';
import { buildAgentFromPrompt } from '../agent/promptBuilder';
import { runAgentCycle } from '../agent/agentRunner';
import {
  AccountCreateTransaction,
  TokenAssociateTransaction,
  TransferTransaction,
  AccountId,
  PrivateKey as HederaPrivateKey,
  Hbar as HederaHbar,
  TokenId,
} from '@hashgraph/sdk';
import {
  createHederaClient,
  getOperatorKey,
  getOperatorAccountId,
  createAgentTopic,
  storeAgentConfig,
  registerAgentHCS10,
} from '@tradeagent/hedera';
import { computeConfigHash } from '../agent/promptBuilder';
import { agentQueue, scheduleAgentJob } from '../agent/agentWorker';

const router = Router();

// ── AgentRegistry ABI (only the functions we call) ───────────────
const REGISTRY_ABI = [
  'function registerAgent(string agentId, bytes32 configHash, string hcsTopicId, string hfsConfigId, string strategyType) external',
  'function logExecution(string agentId, string signal, uint256 price) external',
  'function getTotalAgents() external view returns (uint256)',
];

// ── Zod request schemas ───────────────────────────────────────────
const BuildPromptSchema = z.object({
  prompt: z.string().min(10).max(1000),
});

const DeploySchema = z.object({
  config:        AgentConfigSchema,
  configHash:    z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a keccak256 hex hash'),
  walletAddress: z.string().min(5),   // Hedera account ID (0.0.XXXXX)
  dryRun:        z.boolean().optional().default(false),
});

const RunSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

// ── Helper: Mirror Node URL ───────────────────────────────────────
const MIRROR_BASE = process.env.MIRROR_NODE_URL ||
  'https://testnet.mirrornode.hedera.com';

// ── POST /api/agents/build ────────────────────────────────────────
/**
 * Build an AgentConfig from a plain English prompt via Gemini.
 * Returns config + configHash for client to review before deploying.
 *
 * Does NOT deploy anything — just builds the config.
 */
router.post('/build', async (req: Request, res: Response) => {
  try {
    const { prompt } = BuildPromptSchema.parse(req.body);
    const { config, configJson, configHash } = await buildAgentFromPrompt(prompt);

    res.json({
      config,
      configJson,
      configHash,
      message: 'Review config, then POST to /api/agents/deploy',
    });
  } catch (err: unknown) {
    const msg = err instanceof z.ZodError
      ? err.errors.map(e => e.message).join(', ')
      : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

// ── POST /api/agents/deploy ───────────────────────────────────────
/**
 * 5-Step Hedera Deployment:
 *   1. Create HCS topic (per-agent audit trail)
 *   2. Store full config in HFS (on-chain verifiable)
 *   3. Register on AgentRegistry smart contract (HSCS)
 *   4. Register with HCS-10 OpenConvAI (inter-agent discovery)
 *   5. Save to Supabase via Prisma + schedule in BullMQ
 */
router.post('/deploy', async (req: Request, res: Response) => {
  try {
    const { config, configHash, walletAddress, dryRun } = DeploySchema.parse(req.body);

    const agentId    = uuidv4();
    const client     = createHederaClient();
    const operatorKey = getOperatorKey();
    const operatorId  = getOperatorAccountId().toString();
    const network     = process.env.HEDERA_NETWORK || 'testnet';

    console.log(`\n[Deploy] Starting 5-step deployment for agent: ${config.name}`);
    console.log(`[Deploy] Owner: ${walletAddress} | DryRun: ${dryRun}`);

    // ── Step 1: Create HCS topic ──────────────────────────────────
    console.log('[Deploy] Step 1: Creating HCS audit topic...');
    const hcsTopicId = await createAgentTopic(client, agentId, operatorKey);
    console.log(`[Deploy] ✅ HCS topic: ${hcsTopicId}`);

    // ── Step 2: Store config in HFS ───────────────────────────────
    console.log('[Deploy] Step 2: Storing config in HFS...');
    const hfsConfigId = await storeAgentConfig(
      client,
      { ...config, agentId, createdAt: new Date().toISOString(), version: '1.0' },
      operatorKey
    );
    console.log(`[Deploy] ✅ HFS config: ${hfsConfigId}`);

    // ── Step 3: Register on HSCS (AgentRegistry contract) ────────
    let contractTxId: string | undefined;
    const registryAddress = process.env.AGENT_REGISTRY_EVM_ADDRESS;

    if (registryAddress && !dryRun) {
      console.log('[Deploy] Step 3: Registering on AgentRegistry smart contract...');
      try {
        const provider = new ethers.JsonRpcProvider(
          `https://${network}.hashio.io/api`
        );
        const wallet  = new ethers.Wallet(
          process.env.OPERATOR_PRIVATE_KEY_HEX || process.env.OPERATOR_PRIVATE_KEY!,
          provider
        );
        const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, wallet);
        const tx = await registry.registerAgent(
          agentId, configHash, hcsTopicId, hfsConfigId, config.strategyType
        );
        await tx.wait();
        contractTxId = tx.hash;
        console.log(`[Deploy] ✅ Contract txId: ${contractTxId}`);
      } catch (err) {
        // Non-fatal: HSCS registration failure doesn't block deployment
        console.warn('[Deploy] ⚠️  HSCS registration failed (non-fatal):', (err as Error).message);
      }
    } else {
      console.log('[Deploy] Step 3: Skipping HSCS registration (dry-run or no registry address)');
    }

    // ── Step 4: Register with HCS-10 OpenConvAI ──────────────────
    console.log('[Deploy] Step 4: Registering on HCS-10 OpenConvAI...');
    let hcs10TopicId: string | undefined;
    try {
      const hcs10Result = await registerAgentHCS10({
        name:         config.name,
        description:  `${config.strategyType} strategy for ${config.asset}`,
        strategyType: config.strategyType,
        accountId:    operatorId,
        privateKey:   process.env.OPERATOR_PRIVATE_KEY!,
      });
      hcs10TopicId = hcs10Result.inboundTopicId;
      console.log(`[Deploy] ✅ HCS-10 inbound topic: ${hcs10TopicId}`);
    } catch (err) {
      // Non-fatal
      console.warn('[Deploy] ⚠️  HCS-10 registration failed (non-fatal):', (err as Error).message);
    }

    // ── Step 5: Save to DB + schedule BullMQ ─────────────────────
    console.log('[Deploy] Step 5: Saving to Supabase + scheduling BullMQ...');
    const agent = await prisma.agent.create({
      data: {
        id:            agentId,
        name:          config.name,
        ownerId:       walletAddress,
        config:        config as object,
        configHash,
        strategyType:  config.strategyType,
        hcsTopicId,
        hfsConfigId,
        contractTxId,
        hcs10TopicId,
        active:        true,
      },
    });

    // Schedule BullMQ cron job
    if (!dryRun) {
      await scheduleAgentJob(
        { ...config, agentId },
        hcsTopicId,
        false
      );
      console.log(`[Deploy] ✅ BullMQ scheduled for ${config.timeframe} timeframe`);
    }

    client.close();

    console.log(`[Deploy] 🎉 Deployment complete! Agent ${agentId} is live.\n`);

    res.status(201).json({
      agentId,
      name:          agent.name,
      hcsTopicId,
      hfsConfigId,
      hcs10TopicId,
      contractTxId,
      strategyType:  config.strategyType,
      scheduled:     !dryRun,
      links: {
        topic:    `https://hashscan.io/${network}/topic/${hcsTopicId}`,
        file:     `https://hashscan.io/${network}/file/${hfsConfigId}`,
        contract: contractTxId ? `https://hashscan.io/${network}/transaction/${contractTxId}` : null,
      },
    });
  } catch (err: unknown) {
    console.error('[Deploy] Error:', err);
    const msg = err instanceof z.ZodError
      ? err.errors.map(e => e.message).join(', ')
      : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

// ── GET /api/agents ───────────────────────────────────────────────
/**
 * List all agents (optionally filter by ownerId).
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const ownerId = req.query.ownerId as string | undefined;

    const agents = await prisma.agent.findMany({
      where:   ownerId ? { ownerId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { executions: true } },
      },
    });

    res.json({
      agents: agents.map((a: typeof agents[number]) => ({
        id:           a.id,
        name:         a.name,
        ownerId:      a.ownerId,
        strategyType: a.strategyType,
        hcsTopicId:   a.hcsTopicId,
        hfsConfigId:  a.hfsConfigId,
        active:       a.active,
        listed:       a.listed,
        priceHbar:    a.priceHbar,
        executions:   a._count.executions,
        createdAt:    a.createdAt,
        links: {
          topic: `https://hashscan.io/${process.env.HEDERA_NETWORK || 'testnet'}/topic/${a.hcsTopicId}`,
        },
      })),
      total: agents.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/agents/:id ───────────────────────────────────────────
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({
      where:   { id: agentId },
      include: {
        executions: {
          orderBy: { createdAt: 'desc' },
          take:    10,
        },
      },
    });

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const network = process.env.HEDERA_NETWORK || 'testnet';
    res.json({
      ...agent,
      links: {
        topic:     `https://hashscan.io/${network}/topic/${agent.hcsTopicId}`,
        file:      agent.hfsConfigId ? `https://hashscan.io/${network}/file/${agent.hfsConfigId}` : null,
        contract:  agent.contractTxId ? `https://hashscan.io/${network}/transaction/${agent.contractTxId}` : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/agents/:id/history ───────────────────────────────────
/**
 * Returns agent execution history from Mirror Node — NOT our DB.
 * Mirror Node is the aBFT-guaranteed, tamper-proof source of truth.
 * UI should display: "Sourced from Hedera Mirror Node" badge.
 */
router.get('/:agentId/history', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { hcsTopicId: true, hfsConfigId: true, name: true },
    });

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const order = req.query.order === 'asc' ? 'asc' : 'desc';

    // Pull directly from Mirror Node — aBFT guaranteed
    const url = `${MIRROR_BASE}/api/v1/topics/${agent.hcsTopicId}/messages?limit=${limit}&order=${order}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`Mirror Node error: ${resp.status}`);
    }

    const data = await resp.json() as {
      messages: Array<{
        sequence_number: number;
        consensus_timestamp: string;
        message: string;
      }>;
    };

    const network = process.env.HEDERA_NETWORK || 'testnet';

    const history = data.messages.map((m) => {
      let decision: unknown = null;
      try {
        decision = JSON.parse(Buffer.from(m.message, 'base64').toString('utf-8'));
      } catch { /* malformed message */ }

      return {
        seq:          m.sequence_number,
        timestamp:    m.consensus_timestamp,
        decision,
        hashscanUrl:  `https://hashscan.io/${network}/topic/${agent.hcsTopicId}?k=${m.consensus_timestamp}`,
      };
    });

    res.json({
      agentId,
      agentName:  agent.name,
      topicId:    agent.hcsTopicId,
      hfsConfigId: agent.hfsConfigId,
      history,
      total:      history.length,
      // IMPORTANT: Tell the client where the data comes from
      source:     'hedera-mirror-node',
      sourceUrl:  url,
      note:       'Data sourced from Hedera Mirror Node (aBFT-guaranteed). This is tamper-proof.',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/agents/:id/run ──────────────────────────────────────
/**
 * Manually trigger one agent cycle.
 * dryRun: true (default) = no real swap execution.
 */
router.post('/:agentId/run', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.active) return res.status(400).json({ error: 'Agent is paused' });

    const { dryRun } = RunSchema.parse(req.body);
    const config = agent.config as Record<string, unknown>;

    const result = await runAgentCycle(
      { ...(config as Parameters<typeof runAgentCycle>[0]), agentId: agent.id },
      agent.hcsTopicId,
      dryRun
    );

    // Cache result in DB (Mirror Node is still source of truth)
    const tr = result.tradeResult as { txHash?: string; fillPrice?: number; slippageBps?: number } | null;
    await prisma.execution.create({
      data: {
        agentId:            agent.id,
        signal:             result.decision.signal,
        price:              result.decision.price,
        confidence:         result.decision.confidence,
        reasoning:          result.decision.reasoning,
        hcsSequenceNumber:  result.hcsResult.sequenceNumber,
        consensusTimestamp: result.hcsResult.consensusTimestamp,
        swapTxId:           tr?.txHash    ?? null,
        fillPrice:          tr?.fillPrice ?? null,
        slippage:           tr?.slippageBps != null ? tr.slippageBps / 100 : null,
      },
    });

    const network = process.env.HEDERA_NETWORK || 'testnet';
    res.json({
      signal:            result.decision.signal,
      confidence:        result.decision.confidence,
      reasoning:         result.decision.reasoning,
      price:             result.decision.price,
      hcsSequenceNumber: result.hcsResult.sequenceNumber,
      hcsTimestamp:      result.hcsResult.consensusTimestamp,
      swapExecuted:      result.swapExecuted,
      swapTxId:          tr?.txHash ?? null,
      cycleMs:           result.cycleMs,
      dryRun,
      hashscanUrl:       `https://hashscan.io/${network}/topic/${agent.hcsTopicId}`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/agents/:id/log-execution-result ──────────────────────
/**
 * Called by the frontend TradeApprovalModal AFTER the user approves a MANUAL
 * trade in HashPack and the swap confirms on-chain.
 * Logs the EXECUTION_RESULT back to HCS (completing the audit trail:
 * decision seq#N → swap on-chain → execution result seq#N+1).
 * Also updates the corresponding DB Execution row with the tx details.
 */
router.post('/:agentId/log-execution-result', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const {
      txHash, signal, direction, hcsSequenceNum,
      hcsTopicId: bodyTopicId, amountIn, amountOut, slippageBps, price,
    } = req.body as {
      txHash:         string;
      signal:         string;
      direction:      string;
      hcsSequenceNum: string;
      hcsTopicId:     string;
      amountIn:       string;
      amountOut:      string;
      slippageBps:    number;
      price:          number;
    };

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const hcsTopicId = bodyTopicId || agent.hcsTopicId;

    // ── Log execution result to HCS ──────────────────────────────────
    const { submitAgentDecision, createHederaClient } = await import('@tradeagent/hedera');
    const client = createHederaClient();
    try {
      await submitAgentDecision(client, hcsTopicId, {
        signal:     'EXECUTION_RESULT' as any,
        agentId,
        price,
        confidence: 100,
        reasoning: [
          `Manual swap approved by wallet owner.`,
          `Direction: ${direction}.`,
          `Amount in: ${amountIn}.`,
          `Amount out: ${amountOut}.`,
          `Slippage: ${(slippageBps / 100).toFixed(2)}%.`,
          `TxHash: ${txHash}.`,
          `Based on HCS decision #${hcsSequenceNum}.`,
        ].join(' '),
        indicators: {
          amountIn:    Number(amountIn),
          amountOut:   Number(amountOut),
          slippageBps: slippageBps,
        },
        timestamp: new Date().toISOString(),
      });
    } finally {
      client.close();
    }

    // ── Update the matching DB Execution row ──────────────────────────
    await prisma.execution.updateMany({
      where:  { agentId, hcsSequenceNumber: hcsSequenceNum, swapTxId: null },
      data:   { swapTxId: txHash, fillPrice: price, slippage: slippageBps / 100 },
    });

    res.json({ ok: true, message: 'Execution result logged to HCS' });
  } catch (err) {
    console.error('[log-execution-result] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PUT /api/agents/:id/pause ─────────────────────────────────────
router.put('/:agentId/pause', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const updatedAgent = await prisma.agent.update({
      where: { id: agentId },
      data:  { active: !agent.active },
    });

    res.json({
      agentId: updatedAgent.id,
      active:  updatedAgent.active,
      message: updatedAgent.active ? 'Agent resumed' : 'Agent paused',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PUT /api/agents/:id/mode ──────────────────────────────────────
router.put('/:agentId/mode', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const { mode } = z.object({ mode: z.enum(['AUTO', 'MANUAL']) }).parse(req.body);

    const updatedAgent = await prisma.agent.update({
      where: { id: agentId },
      data:  { executionMode: mode },
    });

    res.json({
      agentId: updatedAgent.id,
      executionMode: updatedAgent.executionMode,
      message: `Execution mode changed to ${mode}`,
    });
  } catch (err) {
    const msg = err instanceof z.ZodError 
      ? err.errors.map(e => e.message).join(', ') 
      : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

// ── POST /api/agents/:id/trigger ──────────────────────────────────
// Added for Phase 7 Demo execution
router.post("/:agentId/trigger", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not available in production" });
  }

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.agentId }
    });
    
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Run cycle immediately (bypasses BullMQ cron)
    const config = agent.config as Record<string, unknown>;
    await runAgentCycle({ ...(config as any), agentId: agent.id }, agent.hcsTopicId, false);

    res.json({
      success: true,
      message: "Agent cycle triggered",
      hashscanUrl: `https://hashscan.io/testnet/topic/${agent.hcsTopicId}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agents/finalize-deploy ─────────────────────────────
/**
 * Called by the frontend AFTER the user has signed HFS, HCS, and HSCS
 * transactions via HashPack. This endpoint handles the backend-only steps:
 *   4. HCS-10 OpenConvAI registration (operator pays, silent)
 *   5. Save agent to Supabase via Prisma
 *   6. Schedule BullMQ cron job
 *
 * The user-signed transactions (HFS/HCS/HSCS) are already on-chain
 * before this endpoint is called.
 */
router.post('/finalize-deploy', async (req: Request, res: Response) => {
  try {
    const {
      agentId,
      config,
      configHash,
      hcsTopicId,
      hfsFileId,
      contractTxHash,
      ownerAccountId,
    } = req.body;

    if (!agentId || !config || !hcsTopicId || !ownerAccountId) {
      return res.status(400).json({ error: 'Missing required fields: agentId, config, hcsTopicId, ownerAccountId' });
    }

    const operatorId = getOperatorAccountId().toString();
    const network    = process.env.HEDERA_NETWORK || 'testnet';

    console.log(`\n[finalize-deploy] Finalizing agent: ${agentId}`);
    console.log(`[finalize-deploy] Owner: ${ownerAccountId} | HCS: ${hcsTopicId}`);

    // ── Step 4: Create dedicated agent trading account ────────────
    // Each agent gets its own ECDSA Hedera account so it can trade
    // autonomously in AUTO mode without requiring a per-trade user signature.
    const client = createHederaClient();
    let agentAccountId: string | null    = null;
    let agentAccountEvmAddress: string | null = null;
    let agentAccountPrivateKey: string | null = null;

    try {
      console.log('[finalize-deploy] Creating agent trading account...');
      const agentKey = HederaPrivateKey.generateECDSA();
      const agentAccountTx = await new AccountCreateTransaction()
        .setKeyWithoutAlias(agentKey.publicKey)
        .setInitialBalance(new HederaHbar(0.1)) // seed from operator for gas
        .setAccountMemo(`TradeAgent:${agentId}`)
        .execute(client);
      const agentAccountReceipt = await agentAccountTx.getReceipt(client);
      agentAccountId         = agentAccountReceipt.accountId!.toString();
      agentAccountEvmAddress = `0x${agentKey.publicKey.toEvmAddress()}`;
      agentAccountPrivateKey = agentKey.toStringRaw(); // 32-byte hex ECDSA key

      console.log(`[finalize-deploy] ✅ Agent account created: ${agentAccountId} (${agentAccountEvmAddress})`);

      // Associate tUSDT token with agent account so MockDEX can send tUSDT to it
      const tUSDTTokenIdStr = process.env.TEST_USDT_TOKEN_ID;
      if (tUSDTTokenIdStr) {
        try {
          const assocTx = await new TokenAssociateTransaction()
            .setAccountId(AccountId.fromString(agentAccountId))
            .setTokenIds([TokenId.fromString(tUSDTTokenIdStr)])
            .freezeWith(client)
            .sign(agentKey);
          await assocTx.execute(client);
          console.log(`[finalize-deploy] ✅ tUSDT associated with agent account`);
        } catch (assocErr) {
          console.warn('[finalize-deploy] ⚠️  tUSDT association failed (non-fatal):', (assocErr as Error).message);
        }
      }
    } catch (accountErr) {
      console.warn('[finalize-deploy] ⚠️  Agent account creation failed (non-fatal):', (accountErr as Error).message);
    }

    // ── Step 5: Save to Supabase + schedule BullMQ (instant) ─────
    const resolvedConfigHash = configHash || computeConfigHash(config);

    const agent = await prisma.agent.create({
      data: {
        id:                    agentId,
        name:                  config.name,
        ownerId:               ownerAccountId,
        config:                config as object,
        configHash:            resolvedConfigHash,
        strategyType:          config.strategyType,
        hcsTopicId,
        hfsConfigId:           hfsFileId,
        contractTxId:          contractTxHash,
        hcs10TopicId:          null, // will be patched in background
        agentAccountId,
        agentAccountEvmAddress,
        agentAccountPrivateKey,
        active:                true,
      },
    });

    // ── Step 6: Schedule BullMQ cron job ─────────────────────────
    await scheduleAgentJob({ ...config, agentId }, hcsTopicId, false);
    console.log(`[finalize-deploy] ✅ DB saved + BullMQ scheduled | Agent ${agentId} is live.`);

    // ── Step 7: HCS-10 OpenConvAI registration — fire-and-forget ─
    setImmediate(() => {
      registerAgentHCS10({
        name:         config.name,
        description:  `${config.strategyType} strategy for ${config.asset}`,
        strategyType: config.strategyType,
        accountId:    operatorId,
        privateKey:   process.env.OPERATOR_PRIVATE_KEY!,
      })
        .then(async (hcs10Result) => {
          const hcs10TopicId = hcs10Result.inboundTopicId;
          console.log(`[finalize-deploy] ✅ HCS-10 registered (background): ${hcs10TopicId}`);
          await prisma.agent.update({
            where: { id: agentId },
            data:  { hcs10TopicId },
          }).catch((e: Error) => console.warn('[finalize-deploy] HCS-10 patch failed:', e.message));
        })
        .catch((err: Error) => {
          console.warn('[finalize-deploy] ⚠️  HCS-10 registration failed (non-fatal):', err.message);
        });
    });

    res.status(201).json({
      agentId,
      name:                  agent.name,
      hcsTopicId,
      hfsConfigId:           hfsFileId,
      hcs10TopicId:          null,
      contractTxHash,
      agentAccountId,        // returned so frontend can show "Fund Agent" step
      agentAccountEvmAddress,
      scheduled:             true,
      links: {
        agent:    `/agents/${agentId}`,
        topic:    `https://hashscan.io/${network}/topic/${hcsTopicId}`,
        file:     hfsFileId ? `https://hashscan.io/${network}/file/${hfsFileId}` : null,
        contract: contractTxHash ? `https://hashscan.io/${network}/transaction/${contractTxHash}` : null,
      },
    });
  } catch (err: unknown) {
    console.error('[finalize-deploy] Error:', err);
    const msg = err instanceof z.ZodError
      ? err.errors.map(e => e.message).join(', ')
      : (err as Error).message;
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/agents/:id/fund ─────────────────────────────────────
/**
 * Called by frontend after user has sent HBAR to agentAccountId via HashPack.
 * Records the funded budget so the agent can start trading in AUTO mode.
 */
router.post('/:agentId/fund', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const { budgetHbar } = z.object({ budgetHbar: z.number().positive() }).parse(req.body);

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.agentAccountId) return res.status(400).json({ error: 'Agent account not created yet' });

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data:  { tradingBudgetHbar: budgetHbar },
    });

    console.log(`[Fund] Agent ${agentId} funded with ${budgetHbar} HBAR → account ${agent.agentAccountId}`);
    res.json({ agentId, agentAccountId: agent.agentAccountId, tradingBudgetHbar: updated.tradingBudgetHbar });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/agents/:id/withdraw ─────────────────────────────────
/**
 * Operator-signed withdrawal: transfers all remaining HBAR + tUSDT from the
 * agent's dedicated Hedera account back to the owner's account.
 * Uses the agent's stored ECDSA key — no user signature required for the transfer.
 */
router.post('/:agentId/withdraw', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const { ownerAccountId } = z.object({ ownerAccountId: z.string().min(5) }).parse(req.body);

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.agentAccountId || !agent.agentAccountPrivateKey) {
      return res.status(400).json({ error: 'Agent account not configured' });
    }
    if (agent.ownerId !== ownerAccountId) {
      return res.status(403).json({ error: 'Only the agent owner can withdraw' });
    }

    const client          = createHederaClient();
    const agentKey        = HederaPrivateKey.fromStringECDSA(agent.agentAccountPrivateKey);
    const agentAcctId     = AccountId.fromString(agent.agentAccountId);
    const ownerAcctId     = AccountId.fromString(ownerAccountId);
    const network         = process.env.HEDERA_NETWORK || 'testnet';
    const tUSDTTokenIdStr = process.env.TEST_USDT_TOKEN_ID;

    // Fetch agent account HBAR balance from Mirror Node
    const mirrorRes = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${agent.agentAccountId}`);
    const mirrorData = await mirrorRes.json() as any;
    const balanceTinybars = BigInt(mirrorData?.balance?.balance ?? 0);

    const txIds: string[] = [];

    // Transfer HBAR (keep a small reserve for the transaction fee itself)
    const feeReserve = BigInt(5_000_000); // 0.05 HBAR
    if (balanceTinybars > feeReserve) {
      const withdrawAmount = balanceTinybars - feeReserve;
      const withdrawAmountStr = withdrawAmount.toString();
      const hbarTx = await new TransferTransaction()
        .addHbarTransfer(agentAcctId, HederaHbar.fromTinybars(`-${withdrawAmountStr}`))
        .addHbarTransfer(ownerAcctId, HederaHbar.fromTinybars(withdrawAmountStr))
        .freezeWith(client)
        .sign(agentKey);
      const hbarResponse = await hbarTx.execute(client);
      txIds.push(hbarResponse.transactionId.toString());
      console.log(`[Withdraw] HBAR transfer: ${Number(withdrawAmount) / 1e8} HBAR → ${ownerAccountId}`);
    }

    // Transfer tUSDT if present
    if (tUSDTTokenIdStr) {
      try {
        const tokenRes = await fetch(
          `https://${network}.mirrornode.hedera.com/api/v1/accounts/${agent.agentAccountId}/tokens?token.id=${tUSDTTokenIdStr}`
        );
        const tokenData = await tokenRes.json() as any;
        const tusdtBalance = BigInt(tokenData?.tokens?.[0]?.balance ?? 0);

        if (tusdtBalance > 0n) {
          const tokenTx = await new TransferTransaction()
            .addTokenTransfer(TokenId.fromString(tUSDTTokenIdStr), agentAcctId, -tusdtBalance)
            .addTokenTransfer(TokenId.fromString(tUSDTTokenIdStr), ownerAcctId, tusdtBalance)
            .freezeWith(client)
            .sign(agentKey);
          const tokenResponse = await tokenTx.execute(client);
          txIds.push(tokenResponse.transactionId.toString());
          console.log(`[Withdraw] tUSDT transfer: ${Number(tusdtBalance) / 1e6} tUSDT → ${ownerAccountId}`);
        }
      } catch (tokenErr) {
        console.warn('[Withdraw] tUSDT transfer failed (non-fatal):', (tokenErr as Error).message);
      }
    }

    // Reset budget in DB
    await prisma.agent.update({
      where: { id: agentId },
      data:  { tradingBudgetHbar: 0 },
    });

    res.json({ agentId, ownerAccountId, txIds, message: 'Withdrawal complete' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
