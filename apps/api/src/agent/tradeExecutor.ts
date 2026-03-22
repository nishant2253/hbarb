import { ethers } from "ethers";
import { submitAgentDecision } from "@tradeagent/hedera";
import prisma from "../db/prisma";

// ■■ MockDEX ABI (only the functions we call) ■■■■■■■■■■■■■
const MOCK_DEX_ABI = [
  // Read
  "function getSwapQuote(string direction, uint256 amountIn) view returns (uint256 amountOut, uint256 priceImpactBps, uint256 slippageBps)",
  "function getAgentSwaps(string agentId) view returns (tuple(address trader, string agentId, string direction, uint256 amountIn, uint256 amountOut, uint256 priceUSDCents, uint256 slippageBps, uint256 timestamp, string hcsSequenceNum, string hcsTopicId)[])",
  "function getPoolState() view returns (uint256 hbar, uint256 usdc, uint256 spotPrice)",
  // Write
  "function executeSwap(string agentId, string direction, uint256 amountIn, uint256 minAmountOut, string hcsSequenceNum, string hcsTopicId) returns (uint256)",
  // Events
  "event SwapExecuted(string indexed agentId, string direction, uint256 amountIn, uint256 amountOut, uint256 slippageBps, string hcsSequenceNum, string hcsTopicId, uint256 timestamp)",
];

// ■■ Types ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
interface TradeParams {
  signal: "BUY" | "SELL" | "HOLD";
  asset: string; // e.g. "HBAR/USDC"
  amountTinybars: bigint; // amount in tinybars (1 HBAR = 100,000,000)
  agentId: string;
  hcsTopicId: string; // e.g. "0.0.4823901"
  confidence: number; // 0-100
  reasoning: string;
  price: number; // current asset price in USD
  indicators: Record<string, number>;
  hederaClient: any; // @hashgraph/sdk Client
}

interface TradeResult {
  hcsResult: { sequenceNumber: string; consensusTimestamp: string };
  tradeResult: any | null;
  mode: "HOLD" | "TESTNET_MOCK_DEX" | "MAINNET_SAUCERSWAP" | "SKIPPED_SLIPPAGE" | "SKIPPED_HCS_FAIL";
}

// ■■ Main Entry Point ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
export async function executeTradeSignal(
  params: TradeParams
): Promise<TradeResult> {
  const { signal, agentId, hcsTopicId, hederaClient } = params;

  console.log(`[TradeAgent] Confidence: ${params.confidence}%`);

  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  // STEP 0 — CHECK EXECUTION MODE
  // If MANUAL, we only log to HCS and skip automated swap.
  // The frontend will handle the swap via HashPack.
  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { executionMode: true }
  });
  const mode = agent?.executionMode || 'MANUAL';
  console.log(`[TradeAgent] Execution Mode: ${mode}`);

  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  // STEP 1 — LOG TO HCS FIRST (BEFORE ANY TRADE)
  // This is the core TradeAgent invariant.
  // The aBFT timestamp proves the decision preceded the trade.
  // If this fails, we DO NOT execute the trade.
  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  let hcsResult: { sequenceNumber: string; consensusTimestamp: string };
  try {
    hcsResult = await submitAgentDecision(hederaClient, hcsTopicId, {
      signal,
      price: params.price,
      confidence: params.confidence,
      reasoning: params.reasoning,
      indicators: params.indicators,
      agentId,
      timestamp: new Date().toISOString(),
    });
    console.log(`[HCS] ■ Decision logged BEFORE trade`);
    console.log(`[HCS] Sequence: #${hcsResult.sequenceNumber}`);
    console.log(`[HCS] Timestamp: ${hcsResult.consensusTimestamp}`);
    console.log(`[HCS] Verify: https://hashscan.io/testnet/topic/${hcsTopicId}`);
  } catch (err) {
    // HCS write failed — DO NOT execute trade
    // This protects the audit trail integrity
    console.error("[HCS] ■ Decision logging failed — SKIPPING TRADE");
    console.error("[HCS] Error:", err);
    return {
      hcsResult: { sequenceNumber: "0", consensusTimestamp: "" },
      tradeResult: null,
      mode: "SKIPPED_HCS_FAIL",
    };
  }

  // HOLD or MANUAL mode — log to HCS but do not execute automated swap
  if (signal === "HOLD" || mode === "MANUAL") {
    console.log(`[Trade] Signal is ${signal} | Mode is ${mode} — no automated swap executed`);
    return { hcsResult, tradeResult: null, mode: signal === "HOLD" ? "HOLD" : "MANUAL_PENDING" as any };
  }

  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  // STEP 2 — EXECUTE TRADE
  // Route to MockDEX (testnet) or SaucerSwap (mainnet)
  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  const direction = signal === "BUY" ? "USDC_TO_HBAR" : "HBAR_TO_USDC";
  const isTestnet = process.env.HEDERA_NETWORK === "testnet";

  console.log(`[Trade] Direction: ${direction}`);
  console.log(`[Trade] Network: ${isTestnet ? "TESTNET → MockDEX" : "MAINNET → SaucerSwap"}`);

  const tradeResult = isTestnet
    ? await executeViaMockDEX(params, direction, hcsResult.sequenceNumber)
    : await executeViaSaucerSwap(params, direction, hcsResult.sequenceNumber);

  if (!tradeResult || tradeResult.mode === "SKIPPED_SLIPPAGE") {
    return { hcsResult, tradeResult: null, mode: "SKIPPED_SLIPPAGE" };
  }

  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  // STEP 3 — LOG EXECUTION RESULT BACK TO HCS
  // Completes the audit trail: decision → trade → outcome
  // ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
  try {
    await submitAgentDecision(hederaClient, hcsTopicId, {
      signal: "EXECUTION_RESULT" as any,
      agentId,
      price: (tradeResult as any).fillPrice ?? params.price,
      confidence: 100,
      reasoning: [
        `Swap executed via ${(tradeResult as any).mode}.`,
        `Direction: ${direction}.`,
        `Amount in: ${(tradeResult as any).amountIn}.`,
        `Amount out: ${(tradeResult as any).amountOut}.`,
        `Slippage: ${((tradeResult as any).slippageBps / 100).toFixed(2)}%.`,
        `TxHash: ${(tradeResult as any).txHash}.`,
        `Based on HCS decision #${hcsResult.sequenceNumber}.`,
      ].join(" "),
      indicators: {
        amountIn: Number((tradeResult as any).amountIn),
        amountOut: Number((tradeResult as any).amountOut),
        slippageBps: (tradeResult as any).slippageBps,
      },
      timestamp: new Date().toISOString(),
    });
    console.log("[HCS] ■ Execution result logged — audit trail complete");
  } catch (err) {
    console.error("[HCS] ■■ Execution result logging failed (trade already executed)");
  }

  return {
    hcsResult,
    tradeResult,
    mode: isTestnet ? "TESTNET_MOCK_DEX" : "MAINNET_SAUCERSWAP",
  };
}

// ■■ Testnet: Execute via MockDEX ■■■■■■■■■■■■■■■■■■■■■■■■■■
async function executeViaMockDEX(
  params: TradeParams,
  direction: string,
  hcsSequenceNum: string
) {
  const provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  const wallet = new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider);
  const mockDex = new ethers.Contract(process.env.MOCK_DEX_ADDRESS!, MOCK_DEX_ABI, wallet);

  // Get current pool state for logging
  const [hbarReserve, usdcReserve, spotPrice] = await mockDex.getPoolState();
  console.log(`[MockDEX] Pool state: ${ethers.formatUnits(hbarReserve, 8)} HBAR / ${ethers.formatUnits(usdcReserve, 6)} USDC`);

  // Step 1: Get swap quote
  const [expectedOut, priceImpactBps, slippageBps] = await mockDex.getSwapQuote(direction, params.amountTinybars);
  console.log(`[MockDEX] Quote:`);
  console.log(` Amount in: ${params.amountTinybars.toString()}`);
  console.log(` Expected out: ${expectedOut.toString()}`);
  console.log(` Price impact: ${Number(priceImpactBps) / 100}%`);
  console.log(` Slippage: ${Number(slippageBps) / 100}%`);

  // Step 2: Check slippage (same logic as SaucerSwap plugin)
  if (Number(slippageBps) > 100) {
    console.warn(`[MockDEX] ■■ Slippage ${Number(slippageBps)/100}% > 1% — skipping`);
    return { mode: "SKIPPED_SLIPPAGE" };
  }

  // Step 3: Calculate minimum output with 0.5% tolerance
  const minOut = expectedOut * 995n / 1000n;

  // Step 4: Execute the swap
  // Note: passing hcsSequenceNum embeds the HCS proof in this on-chain tx
  console.log(`[MockDEX] Executing swap (HCS seq #${hcsSequenceNum})...`);
  const tx = await mockDex.executeSwap(
    params.agentId,
    direction,
    params.amountTinybars,
    minOut,
    hcsSequenceNum, // ← This links the swap to the HCS decision
    params.hcsTopicId,
    {
      gasLimit: 300000,
      gasPrice: ethers.parseUnits("960", "gwei"), // Using 960 to support latest Hedera minimums
    }
  );
  console.log(`[MockDEX] Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[MockDEX] ■ Swap confirmed!`);
  console.log(` TxHash: ${receipt.hash}`);
  console.log(` Block: ${receipt.blockNumber}`);
  console.log(` HashScan: https://hashscan.io/testnet/transaction/${receipt.hash}`);

  return {
    txHash: receipt.hash,
    amountIn: params.amountTinybars.toString(),
    amountOut: expectedOut.toString(),
    fillPrice: Number(expectedOut) / Number(params.amountTinybars),
    slippageBps: Number(slippageBps),
    priceImpactBps: Number(priceImpactBps),
    direction,
    mode: "TESTNET_MOCK_DEX",
    hcsSequenceNum,
    hashscanUrl: `https://hashscan.io/testnet/transaction/${receipt.hash}`,
  };
}

// ■■ Mainnet: Execute via hak-saucerswap-plugin ■■■■■■■■■■■■
async function executeViaSaucerSwap(
  params: TradeParams,
  direction: string,
  hcsSequenceNum: string
) {
  // Dynamically import to avoid loading on testnet
  const { HederaLangchainToolkit, AgentMode } = await import("hedera-agent-kit");
  const { saucerswapPlugin } = await import("hak-saucerswap-plugin");
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  const { createReactAgent } = await import("@langchain/langgraph/prebuilt");

  const toolkit = new HederaLangchainToolkit({
    client: params.hederaClient,
    configuration: {
      plugins: [saucerswapPlugin],
      context: { mode: AgentMode.AUTONOMOUS },
    },
  });

  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
  });

  const agent = createReactAgent({ llm, tools: toolkit.getTools() as any[] });

  const instruction = direction === "USDC_TO_HBAR"
    ? `On SaucerSwap: buy HBAR with USDC for agent ${params.agentId}. Execute if slippage < 1%.`
    : `On SaucerSwap: sell HBAR for USDC for agent ${params.agentId}. Execute if slippage < 1%.`;

  const result = await agent.invoke({
    messages: [{ role: "user", content: instruction }],
  });

  return {
    ...result,
    mode: "MAINNET_SAUCERSWAP",
    hcsSequenceNum,
  };
}
