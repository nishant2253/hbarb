# TradeAgent — Verification & Post-Deployment Flow

**Last verified:** March 23, 2026 | Status: ✅ Full deployment confirmed working end-to-end

> **Features:** Deterministic indicator engine (EMA/RSI/MACD/Bollinger/ATR), 4 trading strategies, Kelly risk manager, analytics dashboard (`/dashboard/[id]`), leaderboard (`GET /api/leaderboard`), backtesting (`POST /api/backtest`), enhanced marketplace cards with 6 performance stats + equity sparkline, min-7-HCS listing gate. Agent builder removed — agents are pre-deployed by the operator.

---

## Prerequisites

Before starting, make sure all three services are running:

```bash
# Terminal 1 — Redis
redis-server

# Terminal 2 — API backend (port 3001)
cd apps/api && npm run dev

# Terminal 3 — Next.js frontend (port 3000)
cd apps/web && npm run dev
```

HashPack wallet must be connected to **Hedera Testnet** with at least **2 HBAR** (1 for fees, 1 for funding agent).

---

## Step 1 — Wallet Connection

1. Open `http://localhost:3000`
2. Click **Connect Wallet** in the top navigation bar
3. HashPack modal opens → approve the connection
4. **Verify:** Top nav shows your account ID (e.g., `0.0.8321325`) and live HBAR balance

**Auto-rehydration:** On page refresh, your wallet reconnects silently — no HashPack prompt.
Expected: tUSDC association prompt fires automatically on first connect (~0.001 HBAR).

---

## Step 2 — Verify Agent on HashScan

On the agent dashboard, verify all Hedera IDs are visible:

### 2a. HCS Audit Topic
```
https://hashscan.io/testnet/topic/[your-hcs-topic-id]
```
- Should exist with 0 messages initially
- Every AI decision + execution result will appear here

### 2b. HFS Config File
```
https://hashscan.io/testnet/file/[your-hfs-file-id]
```
- Contains the full AgentConfig JSON stored on-chain

### 2c. AgentRegistry Contract
```
https://hashscan.io/testnet/contract/0.0.8316308
```
- The agent's `configHash`, `hcsTopicId`, `hfsConfigId` are all on-chain

### 2d. Agent Dedicated Account
- Visible in the **Agent Portfolio** card on the agent dashboard
- Click the account ID to see it on HashScan

---

## Step 3 — Run a Trade Cycle

From the agent dashboard at `/agents/[agentId]`:

### Execution Mode Reference

| Mode | Behaviour | Signs | tUSDT goes to |
|------|-----------|-------|---------------|
| **MANUAL SIGN** | AI cycle → HCS log → TradeApprovalModal → user approves → swap | User (HashPack, per trade) | User's HashPack wallet |
| **AUTO TRADE** | BullMQ cron → AI cycle → HCS log → agent account signs → swap | Agent account key (no user needed) | Agent's dedicated account |
| **Test Run · no swap** | AI cycle + HCS log, swap skipped | None | — |

> **To see tUSDT in your HashPack wallet → use MANUAL SIGN mode.**
> **For fully autonomous trading → use AUTO TRADE mode** (requires funding in Step 4).

### Trigger a cycle manually

1. Click **Run Trade** (disabled in AUTO mode — cron runs automatically)
2. Backend fetches live HBAR price from Pyth, cross-checks with SaucerSwap DEX price
3. MockDEX pool reserves synced automatically to match current market price
4. Gemini 2.5 Flash generates BUY/SELL/HOLD citing actual EMA/RSI values
5. HCS logs the decision with aBFT timestamp (before any swap)
6. If BUY or SELL in MANUAL mode → **Trade Approval Modal** appears:
   - Shows live quote: "You send X HBAR / You receive ~Y tUSDC"
   - **SELL**: one HashPack approval (HBAR sent, tUSDC received)
   - **BUY**: two HashPack approvals (Step 1: allow tUSDC spend; Step 2: execute swap)
7. Real tUSDC/HBAR balance updates in the wallet after confirmation

**Expected backend logs:**
```
[HederaKit] Pyth price for HBAR/USDC: $0.089621
[SaucerSwap] DEX market price: $0.089534
[MockDEX] Pool synced: $0.0895/HBAR
[AgentRunner] Step 2a: Fetching 80 OHLCV candles from Binance...
[AgentRunner] Step 2b: Computing full indicator set (EMA/RSI/MACD/Bollinger/ATR/Volume)...
[AgentRunner] compositeScore: 0.68 | EMA_60: 0.08843 | RSI_14: 52.3 | MACD: bullish | ATR: 0.0004
[AgentRunner] Step 2c: Running TREND_FOLLOW strategy (runStrategy)...
[AgentRunner] Signal: BUY (confidence: 72%) stopLoss: 0.0881 takeProfit: 0.0932
[AgentRunner] Step 2d: Kelly position size → 850000000 tinybars (8.5 HBAR)
[AgentRunner] Step 2e: Gemini enriching reasoning text...
[AgentRunner] Decision: BUY (confidence: 72%) — EMA crossover confirmed above EMA_60...

[HCS] ■ Decision logged BEFORE trade
[HCS] Sequence: #1
[MockDEX] Using wallet: 0x... (agent account)
[MockDEX] ■ Swap confirmed! TxHash: 0x...
[HCS] ■ Execution result logged — audit trail complete
```

---

## Step 4 — Verify the Proof Chain on HashScan

This is the **core demo moment** for judges.

1. Go to `https://hashscan.io/testnet/topic/[your-hcs-topic-id]`
2. You should see **2 messages** per completed trade:
   - **Message #N** — BUY/SELL decision: signal, confidence, price, EMA/RSI values, reasoning
   - **Message #N+1** — Execution result: direction, amountIn, amountOut, slippage, TxHash
3. Click message #1 → expand base64 content → full AI reasoning JSON
4. Take the `txHash` → search on HashScan
5. In the `SwapExecuted` event, find `hcsSequenceNum = "1"` embedded on-chain

**This proves:** The AI decided at timestamp `T`, the swap happened at `T+4s` — decision ALWAYS precedes trade, sealed by aBFT consensus.

---

## Step 5 — HCS Execution History + Analytics Link (Agent Dashboard)

The **HCS Execution History** panel on the agent page shows:

- **Decision entries** (BUY/SELL/HOLD badges): confidence %, price, reasoning, indicator chips (EMA value, RSI value, price_vs_ma_pct)
- **Execution entries** (green "SWAP DONE" badge): direction arrow (HBAR → tUSDT), amounts in/out, slippage %, clickable tx hash → HashScan
- **Timestamps** shown as relative time ("3m ago", "1h ago")
- All data sourced live from Hedera Mirror Node — aBFT-guaranteed, tamper-proof

**Analytics Link:** A "View Analytics Dashboard" button on the agent page navigates to `/dashboard/[agentId]` — see Step 12.

---

## Step 6 — Agent Portfolio (AUTO mode)

When the agent is in **AUTO TRADE mode** with a funded account, the **Agent Portfolio** card shows:

| Field | Description |
|-------|-------------|
| HBAR Balance | Live from Mirror Node — decreases as SELL trades execute |
| tUSDT Balance | Live from Mirror Node — increases as SELL trades execute |
| Initial Budget | HBAR funded in Step 4 |
| P&L % | (current HBAR − initial budget) / initial budget |

**Withdraw All** button: operator-signed transfer returns remaining HBAR + tUSDT to your account — no HashPack signature needed.

---

## Step 7 — Transaction Audit Log (Wallet Page)

Navigate to `/wallet`. Below the live HCS Signal Feed:

**Transaction Audit Log** shows every HashPack-approved transaction with HashScan links:

| Type | When it appears |
|------|-----------------|
| DEPLOY_HFS | After TX1 approval |
| DEPLOY_HCS | After TX2 approval |
| DEPLOY_HSCS | After TX3 approval |
| AGENT_FUND | After Fund Agent step |
| TRADE_SWAP | After ManualTradeApproval swap confirms |

---

## Step 8 — NFT Marketplace (Listing & Buying)

### Listing your agent (seller)

1. Go to agent dashboard → **NFT Marketplace** section (only shown to owner)
2. Enter price in HBAR → click **List as NFT**
3. **Prerequisite check:** Backend verifies the agent has **≥ 7 HCS decision messages** on Mirror Node — agents with fewer than 7 trades are rejected with an informative error. Run more trade cycles to build a track record before listing.
4. **HashPack popup 1** — "Associate strategy NFT token" (one-time, max 2 HBAR fee) — approve it
5. Backend mints an HTS NFT (strategy token `0.0.8316389`) with 5% royalty and transfers to your wallet
6. Serial number and HashScan link appear after success
7. Agent appears at `/marketplace` with 6 performance stats (win rate, profit factor, Sharpe, trades, avg win/loss) + an equity sparkline computed from the HCS trade history

### Buying a strategy (buyer)

1. Browse `/marketplace` → click on a listed agent
2. Click **Buy Strategy NFT** → 3 steps:
   - **Step 1**: Associate strategy NFT token (one-time HashPack popup)
   - **Step 2**: Atomic swap — HBAR → NFT, 5% royalty auto-deducted by Hedera
   - **Step 3**: Backend clones agent for you + creates new HCS topic
3. Auto-redirected to your new agent dashboard with working copy ready

**5% royalty** is enforced at the Hedera HTS protocol level — impossible to bypass on any secondary marketplace.

---

---

## Step 9 — Analytics Dashboard (/dashboard/[agentId])

Navigate to `/dashboard/[agentId]` (or click "View Analytics Dashboard" on the agent page).

**Verify the page shows:**
- **Mirror Node proof banner** — HCS topic ID + total message count (all data sourced on-chain)
- **8 metric cards:** Win Rate, Profit Factor, Sharpe Ratio, Max Drawdown, Avg Win %, Avg Loss %, Expectancy, Total Signals
- **Equity Curve** (Recharts `AreaChart`) — indexed to 100, built from HCS message history
- **Signal Distribution** (Recharts `PieChart`) — BUY / SELL / HOLD breakdown
- **Trade P&L Bar Chart** (Recharts `BarChart`) — individual trade R-multiples
- **Live HCS Decision Feed** — last 10 HCS messages with BUY/SELL/HOLD badges
- **Trade History Table** — entry price, exit price, P&L %, signal, timestamp

**API call verified:**
```
GET /api/analytics/[agentId]/performance
→ { winRate, profitFactor, sharpeRatio, maxDrawdown, avgWin, avgLoss,
    expectancy, totalSignals, equityCurve, hcsTopicId, totalHCSMsgs, source }
```

Page auto-refreshes every 30 seconds. On first load with no trades, all metric cards show `—` gracefully.

---

## Step 10 — Leaderboard API

Test the leaderboard endpoint directly:
```bash
curl "http://localhost:3001/api/leaderboard?sortBy=winRate&limit=10"
```

**Expected response:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "agentId": "...",
      "name": "Mean Revert Bot",
      "strategyType": "MEAN_REVERT",
      "winRate": 63.2,
      "profitFactor": 1.84,
      "sharpeRatio": 1.43,
      "totalTrades": 12,
      "hcsVerifiedCount": 24,
      "priceHbar": 50
    }
  ],
  "sortBy": "winRate",
  "total": 3
}
```

`hcsVerifiedCount` is fetched live from Hedera Mirror Node for each listed agent — on-chain verified.

Supported `sortBy` values: `winRate`, `profitFactor`, `sharpeRatio`, `totalTrades`.

---

## Step 11 — Backtesting API

Test the backtesting endpoint:
```bash
curl -X POST http://localhost:3001/api/backtest \
  -H "Content-Type: application/json" \
  -d '{"strategyType":"TREND_FOLLOW","asset":"HBAR","days":30}'
```

**Expected response:**
```json
{
  "result": {
    "strategyType": "TREND_FOLLOW",
    "asset": "HBAR",
    "days": 30,
    "totalTrades": 8,
    "winRate": 62.5,
    "profitFactor": 1.73,
    "sharpeRatio": 1.21,
    "maxDrawdown": 8.4,
    "equityCurve": [100, 102.3, 98.7, ...],
    "trades": [...]
  }
}
```

Historical OHLCV data is fetched from CoinGecko (`/coins/hedera-hashgraph/ohlc`). The same deterministic `runStrategy()` function used in live trading is applied to each candle — backtest results reflect exactly what the live agent would have done.

---

## Current Deployment Status (Verified)

**Deployed contracts (testnet):**
- AgentRegistry: `0.0.8316308`
- MockDEX v2: `0.0.8332937` (EVM: `0x00000000000000000000000000000000007f2689`)
- tUSDC token: `0.0.8332870`
- Strategy NFT collection: `0.0.8316389`

| Component | Status | Details |
|-----------|--------|---------|
| Agent account creation | ✅ Working | ECDSA account per agent, tUSDC auto-associated |
| Fund Agent modal | ✅ Working | TransferTransaction via HashPack (1 sig, one-time) |
| HCS-10 registration | ✅ Working | Background fire-and-forget (~60s) |
| Indicator engine (indicators.ts) | ✅ Working | EMA/RSI/MACD/Bollinger/ATR/Volume, composite score |
| 4 deterministic strategies (strategies.ts) | ✅ Working | TREND_FOLLOW, MEAN_REVERT, MOMENTUM, BREAKOUT |
| Kelly risk manager (riskManager.ts) | ✅ Working | Half-Kelly sizing, ATR stop loss, daily loss/drawdown gates |
| Real BUY/SELL signals | ✅ Working | Deterministic pipeline; Gemini enriches reasoning only |
| SaucerSwap price feed | ✅ Working | Cross-checks Pyth; uses DEX price on >5% divergence |
| MockDEX reserve sync | ✅ Working | Pool updated each cycle to match market price |
| HCS decision logging | ✅ Fixed | `freezeWith(client)` required for `TopicMessageSubmitTransaction` |
| Run Trade button | ✅ Working | Disabled in AUTO mode; full cycle in MANUAL |
| Test Run (no swap) | ✅ Working | HCS log only, no MockDEX call |
| TradeApprovalModal SELL | ✅ Working | Live quote + setPayableAmount, real tUSDC received |
| TradeApprovalModal BUY | ✅ Working | 2-step: allowance → swap, real HBAR received |
| AUTO mode agent trading | ✅ Working | Agent ECDSA key signs autonomously |
| Agent Portfolio card | ✅ Working | Live HBAR + tUSDC balance, P&L %, Withdraw All |
| Withdraw All | ✅ Working | Operator-signed back to owner |
| TRADE_SWAP audit log | ✅ Working | Visible in /wallet with HashScan links |
| Marketplace listing UI | ✅ Working | Price input + "List as NFT" — HashPack association popup + operator mint |
| Marketplace min-7-HCS gate | ✅ Working | Mirror Node checked before listing — < 7 messages rejected |
| Marketplace 6-stat cards + sparkline | ✅ Working | winRate, profitFactor, Sharpe, avgWin/Loss + AreaChart sparkline |
| Marketplace post-purchase | ✅ Working | Clones agent for buyer, new HCS topic, BullMQ job |
| NFT buyer association | ✅ Working | TokenAssociateTransaction before atomic swap |
| 5% royalty | ✅ Working | HTS CustomRoyaltyFee, protocol-enforced |
| Analytics dashboard (/dashboard/[id]) | ✅ Working | 8 metric cards, equity curve, signal donut, HCS feed, trade table |
| Leaderboard (GET /api/leaderboard) | ✅ Working | sortBy winRate/profitFactor/sharpeRatio, hcsVerifiedCount from Mirror Node |
| Backtesting (POST /api/backtest) | ✅ Working | CoinGecko OHLCV, same runStrategy() as live trading |
| "View Analytics Dashboard" link | ✅ Working | Button on agent page → /dashboard/[agentId] |
| Wallet rehydration | ✅ Working | Silent reconnect on page refresh |
| BullMQ scheduling | ✅ Working | Cron based on agent timeframe |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `INSUFFICIENT_GAS` on TX3 | Gas set to 800,000 — should not occur |
| `INSUFFICIENT_GAS` on swap | New MockDEX v2 needs 800k gas (HTS precompile calls) — already set |
| `User rejected` | User clicked Reject in HashPack — retry |
| Stuck on "Finalizing..." | Check API terminal — should resolve in <5s |
| HCS `transaction must be frozen` | Fixed — `freezeWith(client)` added to `submitAgentDecision` in `hcs.ts` |
| HCS topic shows 0 messages | Normal — trigger first cycle with Run Trade |
| tUSDC not appearing in HashPack | Use MANUAL SIGN mode; check for BUY/SELL signal (not HOLD) |
| tUSDC balance not updating | Must restart frontend after redeploying MockDEX (env vars changed) |
| Agent always returns HOLD | Check API logs for "Computed indicators" — Binance fetch must succeed |
| Run Trade button grayed out | Agent is in AUTO mode (intentional) or Paused |
| BUY shows "Contract ID: 0.0.0" | Frontend env var `NEXT_PUBLIC_MOCK_DEX_ADDRESS` not loaded — restart Next.js |
| `tUSDC allowance failed` | Token not associated with wallet — reconnect to trigger association |
| MockDEX swap fails silently | Check contract address matches `0.0.8332937` — old contract is deprecated |
| Marketplace page crashes on open | `recentSignals` null from API — fixed with `?? []` fallback in `marketplace/[id]/page.tsx` |
| "List as NFT" shows no HashPack popup | Fixed — `TokenAssociateTransaction` now fires before backend mint; wallet must be connected |
| "List as NFT" rejected — insufficient trade history | Agent needs ≥ 7 HCS decisions before listing; run more trade cycles |
| Analytics dashboard shows all `—` metric cards | Agent has no completed trades yet — trigger trade cycles first |
| `/api/leaderboard` returns empty array | No agents listed on marketplace yet — complete an NFT listing first |
| `/api/backtest` returns 422 or empty trades | CoinGecko may rate-limit or have no data for short `days` values; try `days: 30` |
| TS2737 BigInt literals error in web build | Ensure `apps/web/tsconfig.json` has `"target": "ES2020"` — already fixed |
