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
  createAgentTopic,
} from '@tradeagent/hedera';
import {
  TransferTransaction,
  TokenId,
  NftId,
  AccountId,
  Hbar,
} from '@hashgraph/sdk';

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
 * Returns all listed agents with live performance stats (win rate, profit
 * factor, Sharpe, avg win/loss) computed from DB executions plus recent
 * HCS signals. Includes equity sparkline for marketplace card display.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const listed = await prisma.agent.findMany({
      where:    { listed: true, active: true },
      orderBy:  { createdAt: 'desc' },
      include:  { executions: { orderBy: { createdAt: 'asc' } } },
    });

    const enriched = await Promise.all(listed.map(async (agent) => {
      // ── Recent HCS signals (for display) ────────────────────────
      let recentSignals: Array<{ signal: string; confidence: number }> = [];
      try {
        const url  = `${MIRROR_BASE}/api/v1/topics/${agent.hcsTopicId}/messages?limit=20&order=desc`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json() as { messages: Array<{ message: string }> };
          recentSignals = data.messages
            .map(m => {
              try { return JSON.parse(Buffer.from(m.message, 'base64').toString()) as { signal: string; confidence: number }; }
              catch { return null; }
            })
            .filter(Boolean) as Array<{ signal: string; confidence: number }>;
        }
      } catch { /* non-fatal */ }

      // ── Performance stats from DB executions ────────────────────
      const execPnLs = agent.executions
        .filter(e => e.fillPrice != null && e.price != null)
        .map(e => ({
          pnlPct: e.signal === 'BUY'
            ? ((e.fillPrice! - e.price) / e.price) * 100
            : ((e.price - e.fillPrice!) / e.price) * 100,
        }));

      const { calculateWinRate } = await import('../agent/riskManager');
      const stats = calculateWinRate(execPnLs);

      // ── Equity sparkline (last 10 points for mini-chart) ────────
      let equity = 100;
      const equitySparkline: { equity: number }[] = [{ equity: 100 }];
      for (const t of execPnLs.slice(-10)) {
        equity = equity * (1 + t.pnlPct / 100);
        equitySparkline.push({ equity: Math.round(equity * 100) / 100 });
      }

      return {
        id:            agent.id,
        name:          agent.name,
        ownerId:       agent.ownerId,
        strategyType:  agent.strategyType,
        hcsTopicId:    agent.hcsTopicId,
        serialNumber:  agent.serialNumber,
        priceHbar:     agent.priceHbar,
        ipfsCID:       agent.ipfsCID,
        createdAt:     agent.createdAt,
        executions:    agent.executions.length,
        recentSignals: recentSignals.slice(0, 5),
        // Performance stats
        winRate:       parseFloat(stats.winRate.toFixed(1)),
        profitFactor:  parseFloat(stats.profitFactor.toFixed(2)),
        sharpeRatio:   parseFloat(stats.sharpeRatio.toFixed(2)),
        avgWin:        parseFloat(stats.avgWin.toFixed(2)),
        avgLoss:       parseFloat(stats.avgLoss.toFixed(2)),
        equitySparkline,
        hashscanUrl:   `https://hashscan.io/${process.env.HEDERA_NETWORK || 'testnet'}/topic/${agent.hcsTopicId}`,
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
        tokenId:     process.env.STRATEGY_TOKEN_ID,
        totalMinted: collectionStats.totalMinted,
        royaltyPct:  5,
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

    // ── Require minimum 7 HCS decisions (verified track record) ───
    try {
      const mirrorUrl  = `${MIRROR_BASE}/api/v1/topics/${agent.hcsTopicId}/messages?limit=7&order=asc`;
      const mirrorResp = await fetch(mirrorUrl, { signal: AbortSignal.timeout(5000) });
      if (mirrorResp.ok) {
        const mirrorData = await mirrorResp.json() as { messages: unknown[] };
        const msgCount   = mirrorData.messages?.length ?? 0;
        if (msgCount < 7) {
          return res.status(400).json({
            error: `Minimum 7 HCS decisions required before listing. Agent has ${msgCount}. Run more trade cycles to build a track record.`,
          });
        }
      }
    } catch { /* Mirror Node unavailable — allow listing to proceed */ }

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
      image:        ipfsCID ? `ipfs://${ipfsCID}` : 'ipfs://QmArcaneDefault',
      creator:      agent.ownerId,
      createdAt:    new Date().toISOString(),
    }, operatorKey);

    // Update DB — store creatorId so secondary-sale royalties route correctly
    await prisma.agent.update({
      where: { id: agentId },
      data:  {
        listed:       true,
        serialNumber,
        priceHbar,
        ipfsCID:   ipfsCID ?? null,
        creatorId: agent.ownerId,   // persist original creator for royalty routing
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
    const { executions, ...agentRest } = agent;
    res.json({
      ...agentRest,
      executions: executions.length,
      royaltyPct: 5,
      // creatorId = original minter; equals ownerId for initial listings,
      // but differs on secondary sales so the frontend can route 5% correctly.
      creatorId: agent.creatorId ?? agent.ownerId,
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

// ── POST /api/marketplace/post-purchase ──────────────────────────
/**
 * Called by the frontend after a successful NFT atomic swap.
 * Clones the purchased agent for the new owner, creates a new HCS
 * topic for them, and schedules a BullMQ job.
 */
router.post('/post-purchase', async (req: Request, res: Response) => {
  try {
    const { tokenId, serialNumber, buyerAccountId, txId } = req.body as {
      tokenId:        string;
      serialNumber:   number;
      buyerAccountId: string;
      txId:           string;
    };

    if (!serialNumber || !buyerAccountId) {
      return res.status(400).json({ error: 'tokenId, serialNumber, buyerAccountId required' });
    }

    // 1. Find the original agent by serialNumber
    const original = await prisma.agent.findFirst({
      where: { serialNumber: Number(serialNumber) },
    });
    if (!original) {
      return res.status(404).json({ error: `No agent found with serialNumber ${serialNumber}` });
    }

    // 2. Create a new HCS topic for the buyer (operator pays — background tx)
    const client        = createHederaClient();
    const operatorKey   = getOperatorKey();
    const operatorAcctId = process.env.OPERATOR_ACCOUNT_ID!;

    // 2a. Transfer NFT from operator/treasury → buyer using operator key.
    //     The NFT was minted to the treasury (operator) at listing time via
    //     mintAgentNFT → TokenMintTransaction. The buyer already paid HBAR
    //     directly to the seller in Step 2 of the frontend flow. This step
    //     completes the exchange on the NFT side.
    if (tokenId && serialNumber) {
      try {
        const frozenNftTx = await new TransferTransaction()
          .addNftTransfer(
            new NftId(TokenId.fromString(tokenId), serialNumber),
            AccountId.fromString(operatorAcctId),
            AccountId.fromString(buyerAccountId),
          )
          .setMaxTransactionFee(new Hbar(2))
          .freezeWith(client);
        const nftTransferTx = await frozenNftTx.sign(operatorKey);
        const nftTxResponse = await nftTransferTx.execute(client);
        await nftTxResponse.getReceipt(client);
        console.log(`[Marketplace] NFT #${serialNumber} transferred from operator to ${buyerAccountId}`);
      } catch (nftErr) {
        // Log but don't abort — agent clone still proceeds so the buyer
        // gets a working copy even if the on-chain NFT transfer fails.
        console.error('[Marketplace] NFT transfer failed (non-fatal):', nftErr);
      }
    }

    const newAgentId  = require('crypto').randomUUID();
    const newHcsTopic = await createAgentTopic(client, newAgentId, operatorKey);

    // 3. Clone agent in DB with buyer as new owner.
    //    Preserve creatorId from original so secondary-sale royalties work.
    const cloned = await prisma.agent.create({
      data: {
        id:             newAgentId,
        name:           `${original.name} (Copy)`,
        ownerId:        buyerAccountId,
        ownerEvm:       '',
        config:         original.config ?? {},
        configHash:     original.configHash,
        strategyType:   original.strategyType,
        hcsTopicId:     newHcsTopic,
        hfsConfigId:    original.hfsConfigId,
        contractTxId:   txId,
        executionMode:  original.executionMode,
        active:         false,
        listed:         false,
        tradingBudgetHbar: 0,
        // Propagate original creator so royalties always route back to them
        creatorId:      original.creatorId ?? original.ownerId,
      },
    });

    // 4. Schedule BullMQ job for the cloned agent
    const { scheduleAgentJob } = await import('../agent/agentWorker');
    await scheduleAgentJob(newAgentId, newHcsTopic);

    // 5. Log an NFT_SALE transaction for the seller so their wallet history
    //    reflects the incoming HBAR without needing a wallet refresh.
    const network = process.env.HEDERA_NETWORK || 'testnet';
    const sellerAccountId = original.ownerId;
    const saleHashscanUrl = txId
      ? `https://hashscan.io/${network}/transaction/${txId.replace('@', '-').replace(/(\d+)\.(\d+)$/, '$1-$2')}`
      : `https://hashscan.io/${network}/topic/${newHcsTopic}`;
    try {
      await prisma.transaction.create({
        data: {
          ownerId:    sellerAccountId,
          agentId:    original.id,
          type:       'NFT_SALE',
          txId:       txId || `nft-sale-${newAgentId}`,
          status:     'SUCCESS',
          hashscanUrl: saleHashscanUrl,
          details: {
            agentName:      original.name,
            priceHbar:      original.priceHbar,
            buyerAccountId,
            serialNumber,
            royaltyNote:    '5% royalty on all secondary resales',
          },
        },
      });
    } catch (logErr) {
      console.warn('[Marketplace] Failed to log NFT_SALE transaction (non-fatal):', logErr);
    }

    client.close();

    res.status(201).json({
      clonedAgentId: newAgentId,
      hcsTopicId:    newHcsTopic,
      message:       'Agent cloned for new owner',
      links: {
        agent:     `/agents/${newAgentId}`,
        hashscan:  `https://hashscan.io/${process.env.HEDERA_NETWORK || 'testnet'}/topic/${newHcsTopic}`,
      },
    });
  } catch (err) {
    console.error('[Marketplace] post-purchase error:', err);
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
