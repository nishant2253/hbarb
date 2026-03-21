/**
 * promptBuilder.ts — Gemini 1.5 Flash prompt-to-agent config builder
 *
 * Converts a plain-English user prompt into a validated AgentConfig JSON
 * using Gemini's structured JSON output mode (responseMimeType: application/json).
 *
 * Also computes the keccak256 config hash that gets stored on-chain in:
 *   - AgentRegistry smart contract (AgentRegistered event)
 *   - HFS file alongside the full config
 *
 * Usage:
 *   const { config, configJson, configHash } = await buildAgentFromPrompt(
 *     "Create an EMA-20 trend following bot for HBAR/USDC on 1h timeframe"
 *   );
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { keccak256, toUtf8Bytes } from 'ethers';

// ── Gemini client (lazy init for testability) ─────────────────────
// Model name — configurable via GEMINI_MODEL env or default to gemini-2.5-flash
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment');
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// ── AgentConfig Schema (Zod + used as Gemini output schema) ──────

export const AgentConfigSchema = z.object({
  name: z.string().min(3).max(50),

  strategyType: z.enum([
    'TREND_FOLLOW',
    'MEAN_REVERT',
    'BREAKOUT',
    'MOMENTUM',
    'CUSTOM',
  ]),

  asset: z.string().default('HBAR/USDC'),

  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),

  indicators: z.object({
    movingAverage: z.object({
      type:   z.enum(['SMA', 'EMA', 'WMA']),
      period: z.number().int().min(5).max(200),
    }).optional(),

    rsi: z.object({
      period:    z.number().int().default(14),
      overbought: z.number().default(70),
      oversold:   z.number().default(30),
    }).optional(),

    macd: z.object({
      fast:   z.number().int().default(12),
      slow:   z.number().int().default(26),
      signal: z.number().int().default(9),
    }).optional(),
  }),

  risk: z.object({
    maxPositionSizePct: z.number().min(1).max(20).default(10),
    stopLossPct:        z.number().min(0.5).max(10).default(3),
    takeProfitPct:      z.number().min(1).max(50).default(8),
  }),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema> & {
  agentId?: string;  // Assigned after DB insert
};

// ── buildAgentFromPrompt ────────────────────────────────────────

/**
 * Converts a plain English prompt → validated AgentConfig.
 *
 * Steps:
 *   1. Send prompt to Gemini 1.5 Flash with structured JSON output
 *   2. Parse + validate via Zod schema
 *   3. Compute keccak256 hash (for on-chain storage & verification)
 *
 * @param userPrompt - "Build me an EMA-20 trend following bot for HBAR"
 * @returns { config, configJson, configHash }
 */
export async function buildAgentFromPrompt(userPrompt: string): Promise<{
  config:     AgentConfig;
  configJson: string;
  configHash: string;
}> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature:      0.1,  // Low temp for deterministic config output
    },
  });

  const systemPrompt = `You are a trading agent configuration expert for TradeAgent on Hedera blockchain.

Convert the user's strategy description to a JSON object matching this schema EXACTLY:
${JSON.stringify({
  name: 'string (3-50 chars)',
  strategyType: 'TREND_FOLLOW | MEAN_REVERT | BREAKOUT | MOMENTUM | CUSTOM',
  asset: 'string (default: HBAR/USDC)',
  timeframe: '1m | 5m | 15m | 1h | 4h | 1d',
  indicators: {
    movingAverage: '{ type: SMA|EMA|WMA, period: 5-200 } (optional)',
    rsi: '{ period: 14, overbought: 70, oversold: 30 } (optional)',
    macd: '{ fast: 12, slow: 26, signal: 9 } (optional)',
  },
  risk: {
    maxPositionSizePct: 'number 1-20 (default 10)',
    stopLossPct:        'number 0.5-10 (default 3)',
    takeProfitPct:      'number 1-50 (default 8)',
  },
}, null, 2)}

CRITICAL RULES:
- stopLossPct MUST be <= 10%
- maxPositionSizePct MUST be <= 20%
- Respond with ONLY valid JSON, no markdown, no explanation
- Choose appropriate indicators based on the strategy type`;

  const result = await model.generateContent(
    systemPrompt + '\n\nUser strategy: ' + userPrompt
  );

  const rawJson  = result.response.text().trim();

  // Strip markdown code blocks if Gemini adds them despite responseMimeType
  const cleanJson = rawJson
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '');

  const parsed = AgentConfigSchema.parse(JSON.parse(cleanJson));

  const configJson = JSON.stringify(parsed);
  const configHash = keccak256(toUtf8Bytes(configJson));

  console.log(`[PromptBuilder] Config built: ${parsed.name} | ${parsed.strategyType} | ${parsed.asset}`);
  console.log(`[PromptBuilder] Config hash:  ${configHash.slice(0, 18)}...`);

  return { config: parsed, configJson, configHash };
}

// ── computeConfigHash (utility) ───────────────────────────────────

/**
 * Computes the keccak256 hash of an existing config.
 * Used to verify on-chain config matches the stored HFS file.
 */
export function computeConfigHash(config: AgentConfig): string {
  return keccak256(toUtf8Bytes(JSON.stringify(config)));
}

// ── validateConfigHash (utility) ──────────────────────────────────

/**
 * Verifies that a config matches its expected on-chain hash.
 * Called before registering an agent on-chain.
 */
export function validateConfigHash(config: AgentConfig, expectedHash: string): boolean {
  const computed = computeConfigHash(config);
  const match = computed === expectedHash;
  if (!match) {
    console.warn(`[PromptBuilder] Hash mismatch! computed=${computed.slice(0, 18)} expected=${expectedHash.slice(0, 18)}`);
  }
  return match;
}
