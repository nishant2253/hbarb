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
  createHederaClient,
  getOperatorKey,
  getOperatorAccountId,
  createAgentTopic,
  storeAgentConfig,
  registerAgentHCS10,
} from '@tradeagent/hedera';
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
    await prisma.execution.create({
      data: {
        agentId:           agent.id,
        signal:            result.decision.signal,
        price:             result.decision.price,
        confidence:        result.decision.confidence,
        reasoning:         result.decision.reasoning,
        hcsSequenceNumber: result.hcsResult.sequenceNumber,
        consensusTimestamp: result.hcsResult.consensusTimestamp,
      },
    });

    const network = process.env.HEDERA_NETWORK || 'testnet';
    res.json({
      signal:        result.decision.signal,
      confidence:    result.decision.confidence,
      reasoning:     result.decision.reasoning,
      price:         result.decision.price,
      hcsSequenceNumber: result.hcsResult.sequenceNumber,
      hcsTimestamp:  result.hcsResult.consensusTimestamp,
      swapExecuted:  result.swapExecuted,
      cycleMs:       result.cycleMs,
      dryRun,
      hashscanUrl:   `https://hashscan.io/${network}/topic/${agent.hcsTopicId}`,
    });
  } catch (err) {
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

export default router;
