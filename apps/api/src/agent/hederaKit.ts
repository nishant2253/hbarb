/**
 * hederaKit.ts — Hedera Agent Kit v3 initialization
 *
 * Wires up the LangChain-compatible Hedera toolkit with:
 *   - saucerswapPlugin: DEX swap quotes + execution on Hedera
 *   - pythPlugin:       Signed price attestations via Hermes REST API
 *
 * The toolkit provides LangChain-compatible "tools" that the LLM
 * can invoke as function calls inside the ReAct agent loop.
 *
 * CRITICAL: The Hedera Agent Kit manages the Hedera client internally.
 * It uses the OPERATOR_ACCOUNT_ID and OPERATOR_PRIVATE_KEY from env.
 */

import { HederaLangchainToolkit, AgentMode } from 'hedera-agent-kit';
import { saucerswapPlugin } from 'hak-saucerswap-plugin';
import { pythPlugin } from 'hak-pyth-plugin';
import { createHederaClient } from '@tradeagent/hedera';

// ── Types ────────────────────────────────────────────────────────

export interface AgentKitResult {
  toolkit: HederaLangchainToolkit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools:   any[];
  client:  ReturnType<typeof createHederaClient>;
}

// ── createAgentKit ────────────────────────────────────────────────

/**
 * Initializes the Hedera Agent Kit with SaucerSwap + Pyth plugins.
 *
 * Returns the toolkit + the array of LangChain tools
 * that the ReAct agent uses to interact with Hedera and DEX protocols.
 */
export function createAgentKit(): AgentKitResult {
  const client = createHederaClient();

  const toolkit = new HederaLangchainToolkit({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    configuration: {
      plugins: [
        saucerswapPlugin,  // DEX: quote + execute HBAR/USDC swaps
        pythPlugin,        // Prices: Pyth Network Hermes REST API
      ],
      context: {
        mode: AgentMode.AUTONOMOUS,
      },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (toolkit.getTools() as any[]);

  console.log(`[HederaKit] Agent toolkit ready with ${tools.length} tools`);
  if (tools.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log(`[HederaKit] Available: ${tools.map((t: any) => t.name).join(', ')}`);
  }

  return { toolkit, tools, client };
}

// ── getPythPrice (Hermes REST API direct call) ───────────────────

/**
 * Fetches the latest HBAR/USD price from Pyth Network Hermes API.
 * Falls back to Mirror Node exchange rate if Pyth is unavailable.
 *
 * @param asset - e.g. "HBAR/USDC" (used only for logging)
 */
export async function getPythPrice(
  asset: string,
  mirrorFallback = true
): Promise<number | null> {
  try {
    // Pyth Hermes REST API (public, no auth)
    // HBAR/USD price feed: https://pyth.network/price-feeds
    const HBAR_USD_FEED_ID = '0x3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd';

    const resp = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${HBAR_USD_FEED_ID}`
    );

    if (!resp.ok) throw new Error(`Pyth Hermes ${resp.status}`);

    const data = await resp.json() as {
      parsed: Array<{ price: { price: string; expo: number } }>;
    };

    if (!data.parsed?.length) throw new Error('No price data from Pyth');

    const { price, expo } = data.parsed[0].price;
    const parsed = parseFloat(price) * Math.pow(10, expo);

    console.log(`[HederaKit] Pyth price for ${asset}: $${parsed.toFixed(6)}`);
    return parsed;
  } catch (err) {
    console.warn(`[HederaKit] Pyth API failed: ${(err as Error).message}`);

    if (mirrorFallback) {
      try {
        const resp = await fetch('https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate');
        const data = await resp.json() as {
          current_rate: { cent_equivalent: number; hbar_equivalent: number };
        };
        const usd = data.current_rate.cent_equivalent / data.current_rate.hbar_equivalent / 100;
        console.log(`[HederaKit] Mirror Node HBAR fallback: $${usd.toFixed(6)}`);
        return usd;
      } catch {
        return null;
      }
    }
    return null;
  }
}
