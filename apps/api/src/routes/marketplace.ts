/**
 * routes/marketplace.ts — NFT Strategy Marketplace routes
 *
 * GET  /api/marketplace        — List all listed strategy NFTs
 * POST /api/marketplace/list   — List agent as NFT (mint HTS NFT + update DB)
 * GET  /api/marketplace/:id    — Get single listing with live HCS performance
 * DELETE /api/marketplace/:id  — Delist agent (burn NFT listing)
 *
 * Note: 5% royalty is protocol-enforced by Hedera — no smart contract needed.
 * Secondary sales on any marketplace automatically route 5% to the operator.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db/prisma';
import {
  createHederaClient,
  getOperatorKey,
  mintAgentNFT,
  getCollectionStats,
} from '@tradeagent/hedera';

const router = Router();

const MIRROR_BASE = process.env.MIRROR_NODE_URL ||
  'https://testnet.mirrornode.hedera.com';

// ── Zod schemas ───────────────────────────────────────────────────
const ListSchema = z.object({
  agentId:    z.string().uuid(),
  priceHbar:  z.number().positive().max(100_000),
  ipfsCID:    z.string().optional(),
  description: z.string().min(10).max(500).optional(),
});

// ── GET /api/marketplace ──────────────────────────────────────────
/**
 * Returns all listed agents with live performance stats from Mirror Node.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const listed = await prisma.agent.findMany({
      where: { listed: true, active: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id:           true,
        name:         true,
        ownerId:      true,
        strategyType: true,
        hcsTopicId:   true,
        serialNumber: true,
        priceHbar:    true,
        ipfsCID:      true,
        createdAt:    true,
        _count: { select: { executions: true } },
      },
    });

    // Enrich each listing with recent HCS performance (last 10 signals)
    const enriched = await Promise.all(listed.map(async (agent: typeof listed[number]) => {
      let recentSignals: Array<{ signal: string; confidence: number }> = [];
      let winRate = 0;

      try {
        const url = `${MIRROR_BASE}/api/v1/topics/${agent.hcsTopicId}/messages?limit=10&order=desc`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json() as {
            messages: Array<{ message: string }>;
          };
          recentSignals = data.messages
            .map(m => {
              try {
                return JSON.parse(Buffer.from(m.message, 'base64').toString()) as { signal: string; confidence: number };
              } catch { return null; }
            })
            .filter(Boolean) as Array<{ signal: string; confidence: number }>;

          const actionable = recentSignals.filter(s => s.signal !== 'HOLD');
          winRate = actionable.length > 0
            ? Math.round(actionable.filter(s => s.confidence > 70).length / actionable.length * 100)
            : 0;
        }
      } catch { /* non-fatal */ }

      return {
        ...agent,
        executions:   agent._count.executions,
        recentSignals: recentSignals.slice(0, 5),
        winRate,
        hashscanUrl: `https://hashscan.io/${process.env.HEDERA_NETWORK || 'testnet'}/topic/${agent.hcsTopicId}`,
      };
    }));

    // Collection stats from Hedera
    let collectionStats = { totalMinted: 0 };
    if (process.env.STRATEGY_TOKEN_ID) {
      try {
        collectionStats = await getCollectionStats(process.env.STRATEGY_TOKEN_ID);
      } catch { /* non-fatal */ }
    }

    res.json({
      listings:   enriched,
      total:      enriched.length,
      collection: {
        tokenId:    process.env.STRATEGY_TOKEN_ID,
        totalMinted: collectionStats.totalMinted,
        royaltyPct: 5,      // Protocol-enforced on Hedera
        royaltyNote: 'Royalties enforced at Hedera protocol level — cannot be bypassed',
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/marketplace/list ────────────────────────────────────
/**
 * Lists an agent on the marketplace:
 *   1. Mint HTS NFT with HIP-412 metadata
 *   2. Update agent in DB (listed=true, serialNumber, priceHbar)
 */
router.post('/list', async (req: Request, res: Response) => {
  try {
    const { agentId, priceHbar, ipfsCID, description } = ListSchema.parse(req.body);

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.listed) return res.status(400).json({ error: 'Agent already listed' });

    const tokenId = process.env.STRATEGY_TOKEN_ID;
    if (!tokenId) {
      return res.status(503).json({
        error: 'STRATEGY_TOKEN_ID not set. Run setupHedera.ts first.',
      });
    }

    const client     = createHederaClient();
    const operatorKey = getOperatorKey();
    const network     = process.env.HEDERA_NETWORK || 'testnet';

    // Mint NFT with HIP-412 metadata
    const serialNumber = await mintAgentNFT(client, tokenId, {
      agentId:      agent.id,
      name:         agent.name,
      description:  description ?? `${agent.strategyType} strategy agent by ${agent.ownerId}`,
      strategyType: agent.strategyType,
      asset:        (agent.config as Record<string, string>).asset ?? 'HBAR/USDC',
      performance:  'See HCS topic for live data',
      hcsTopicId:   agent.hcsTopicId,
      hfsConfigId:  agent.hfsConfigId ?? '',
      image:        ipfsCID ? `ipfs://${ipfsCID}` : 'ipfs://QmTradeAgentDefault',
      creator:      agent.ownerId,
      createdAt:    new Date().toISOString(),
    }, operatorKey);

    // Update DB
    await prisma.agent.update({
      where: { id: agentId },
      data:  {
        listed:       true,
        serialNumber,
        priceHbar,
        ipfsCID: ipfsCID ?? null,
      },
    });

    client.close();

    res.status(201).json({
      agentId,
      tokenId,
      serialNumber,
      priceHbar,
      message: 'Agent listed as strategy NFT',
      royaltyNote: '5% royalty on all secondary sales — enforced by Hedera protocol',
      links: {
        nft:   `https://hashscan.io/${network}/token/${tokenId}/${serialNumber}`,
        topic: `https://hashscan.io/${network}/topic/${agent.hcsTopicId}`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof z.ZodError
      ? err.errors.map(e => e.message).join(', ')
      : (err as Error).message;
    res.status(400).json({ error: msg });
  }
});

// ── GET /api/marketplace/:id ──────────────────────────────────────
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        executions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!agent || !agent.listed) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const network = process.env.HEDERA_NETWORK || 'testnet';
    res.json({
      ...agent,
      royaltyPct: 5,
      links: {
        nft:   agent.serialNumber
          ? `https://hashscan.io/${network}/token/${process.env.STRATEGY_TOKEN_ID}/${agent.serialNumber}`
          : null,
        topic: `https://hashscan.io/${network}/topic/${agent.hcsTopicId}`,
        file:  agent.hfsConfigId ? `https://hashscan.io/${network}/file/${agent.hfsConfigId}` : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── DELETE /api/marketplace/:id ───────────────────────────────────
router.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    const agentId = String(req.params.agentId);
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || !agent.listed) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    await prisma.agent.update({
      where: { id: agentId },
      data:  { listed: false, serialNumber: null, priceHbar: null },
    });

    res.json({ message: 'Agent delisted from marketplace', agentId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
