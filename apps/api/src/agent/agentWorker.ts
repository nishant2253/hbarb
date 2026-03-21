/**
 * agentWorker.ts — BullMQ worker for scheduled agent execution
 *
 * Consumes jobs from the 'agent-execution' Redis queue.
 * Each job runs one full agentRunner cycle:
 *   1. Pyth price fetch
 *   2. Gemini AI decision
 *   3. HCS write (before trade)
 *   4. SaucerSwap execution (if BUY/SELL)
 *
 * Scheduling: jobs are added by the cron scheduler based on
 * each agent's timeframe (1m, 5m, 15m, 1h, 4h, 1d).
 *
 * Usage (run as separate process from Express API):
 *   npx ts-node src/agent/agentWorker.ts
 */

import { Worker, Queue } from 'bullmq';
import { runAgentCycle } from './agentRunner';
import type { AgentConfig } from './promptBuilder';

// ── Redis connection (URL string avoids ioredis version conflicts) ─
const REDIS_URL  = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: REDIS_URL };

// ── Queue names ───────────────────────────────────────────────────
export const AGENT_QUEUE_NAME = 'agent-execution';

// ── Job payload type ──────────────────────────────────────────────
export interface AgentJobPayload {
  agentConfig: AgentConfig & { agentId: string };
  hcsTopicId:  string;
  dryRun?:     boolean;
}

// ── Queue (for adding jobs from API routes) ───────────────────────
export const agentQueue = new Queue<AgentJobPayload>(AGENT_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff:  { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50 },
  },
});

// ── Worker (processes agent cycles) ──────────────────────────────
export function startAgentWorker() {
  const worker = new Worker<AgentJobPayload>(
    AGENT_QUEUE_NAME,
    async (job) => {
      console.log(`\n[AgentWorker] Processing job: ${job.id}`);
      console.log(`[AgentWorker] Agent: ${job.data.agentConfig.name} | DryRun: ${job.data.dryRun ?? false}`);

      const result = await runAgentCycle(
        job.data.agentConfig,
        job.data.hcsTopicId,
        job.data.dryRun ?? false
      );

      console.log(
        `[AgentWorker] Job ${job.id} complete: ` +
        `${result.decision.signal} | HCS seq#${result.hcsResult.sequenceNumber} | ${result.cycleMs}ms`
      );
      return result;
    },
    {
      connection,
      concurrency: 2,   // Max 2 agents running simultaneously
    }
  );

  worker.on('completed', (job) => {
    console.log(`[AgentWorker] ✅ Job ${job?.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[AgentWorker] ❌ Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('[AgentWorker] Worker error:', err);
  });

  console.log('[AgentWorker] Worker started — listening for agent jobs...');
  return worker;
}

// ── scheduleAgentJob ──────────────────────────────────────────────

/**
 * Schedules an agent to run on its configured timeframe.
 * Called when an agent is registered or re-activated.
 */
export async function scheduleAgentJob(
  agentConfig: AgentConfig & { agentId: string },
  hcsTopicId:  string,
  dryRun = false
): Promise<void> {
  const cronPattern = getCronPattern(agentConfig.timeframe);

  await agentQueue.add(
    `agent-${agentConfig.agentId}`,
    { agentConfig, hcsTopicId, dryRun },
    {
      repeat:    { pattern: cronPattern },
      jobId:     `agent-${agentConfig.agentId}`,
    }
  );

  console.log(`[AgentWorker] Agent ${agentConfig.agentId} scheduled: ${cronPattern}`);
}

// ── getCronPattern ────────────────────────────────────────────────

function getCronPattern(timeframe: string): string {
  const patterns: Record<string, string> = {
    '1m':  '* * * * *',
    '5m':  '*/5 * * * *',
    '15m': '*/15 * * * *',
    '1h':  '0 * * * *',
    '4h':  '0 */4 * * *',
    '1d':  '0 0 * * *',
  };
  return patterns[timeframe] ?? '*/15 * * * *';
}

// ── Standalone mode ───────────────────────────────────────────────
if (require.main === module) {
  console.log(`[AgentWorker] Starting standalone worker | Redis: ${REDIS_URL}`);
  startAgentWorker();
}
