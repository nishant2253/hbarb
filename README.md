# TradeAgent — AI-Powered Trading Agent Platform on Hedera

> **Hedera APEX Hackathon 2026 · Track 1: AI & Agents**

TradeAgent is a decentralized AI trading agent platform. Autonomous trading agents run on Hedera, with every decision permanently recorded with aBFT-guaranteed timestamps.

Each agent:
- Gets a dedicated Hedera ECDSA account to trade autonomously — no per-trade signing required
- Runs a **deterministic indicator pipeline** (EMA, RSI, MACD, Bollinger, ATR) that drives the trade signal; Gemini enriches the reasoning text
- Logs every AI decision to HCS *before* any swap executes (tamper-proof audit trail)
- Is registered as an NFT on HTS and listed in the on-chain marketplace with provable on-chain performance stats

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 22+** and **npm 10+**
- Hedera testnet account (ECDSA key) → [portal.hedera.com](https://portal.hedera.com)
- Gemini API key (free) → [aistudio.google.com](https://aistudio.google.com)
- Supabase project (free) → [supabase.com](https://supabase.com)
- Redis (local Docker or [Redis Cloud free tier](https://redis.io/try-free))
- HashPack wallet (browser extension) → [hashpack.app](https://www.hashpack.app)

### 1. Clone & Install

```bash
git clone <your-repo>
cd hbarb
npm install
```

### 2. Configure Environment

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your credentials
```

**Required values in `apps/api/.env`:**

| Variable | Where to get it |
|---|---|
| `OPERATOR_ACCOUNT_ID` | [portal.hedera.com](https://portal.hedera.com) → Testnet account (ECDSA) |
| `OPERATOR_PRIVATE_KEY` | Same portal — ECDSA hex key (starts with `0x`) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API Key |
| `SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_ANON_KEY` | Same page |
| `DATABASE_URL` | Supabase → Settings → Database → Connection string (Transaction pooler) |
| `MOCK_DEX_ADDRESS` | Auto-set by `deployMockDEX.ts` (testnet: `0x...7f2689`) |
| `MOCK_DEX_HEDERA_ID` | Auto-set by deploy script (testnet: `0.0.8332937`) |
| `TEST_USDT_TOKEN_ID` | Auto-set by deploy script — HTS tUSDC token (testnet: `0.0.8332870`) |
| `AGENT_REGISTRY_CONTRACT_ID` | Set after running `deployNative.ts` (testnet: `0.0.8316308`) |
| `STRATEGY_TOKEN_ID` | HTS NFT collection token (testnet: `0.0.8316389`) |
| `REDIS_URL` | `redis://localhost:6379` (local) or Redis Cloud URL |

**Required values in `apps/web/.env.local`:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |
| `NEXT_PUBLIC_HEDERA_NETWORK` | `testnet` |
| `NEXT_PUBLIC_MOCK_DEX_ADDRESS` | Auto-set by deploy script |
| `NEXT_PUBLIC_MOCK_DEX_CONTRACT_ID` | Auto-set by deploy script (needed for BUY allowance) |
| `NEXT_PUBLIC_TEST_USDT_TOKEN_ID` | Auto-set by deploy script — tUSDC token |
| `NEXT_PUBLIC_STRATEGY_TOKEN_ID` | HTS NFT collection token (testnet: `0.0.8316389`) |
| `NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS` | EVM address of AgentRegistry |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | [cloud.walletconnect.com](https://cloud.walletconnect.com) |

### 3. Set Up Database

```bash
cd apps/api
npx prisma generate      # Generate Prisma client
npx prisma db push       # Apply schema to Supabase (no migration file needed)
```

### 4. Start Development Servers

```bash
# Terminal 1 — Redis
redis-server

# Terminal 2 — API (port 3001)
npm run dev:api

# Terminal 3 — Frontend (port 3000)
npm run dev:web
```

---

## 🏗️ Monorepo Structure

```
hbarb/                               # npm workspaces root
├── apps/
│   ├── web/                         # Next.js 15 frontend
│   │   └── src/
│   │       ├── app/                 # App Router pages
│   │       │   ├── agents/[id]/     # Agent dashboard
│   │       │   ├── marketplace/     # Browse & buy agents
│   │       │   └── wallet/          # Portfolio + TX audit log
│   │       ├── components/          # Shared UI components
│   │       ├── lib/                 # wallet.ts, balance.ts, hashpackEthers.ts
│   │       └── stores/              # Zustand stores (walletStore, agentStore, marketplaceStore)
│   └── api/                         # Node.js + Express API (port 3001)
│       ├── src/
│       │   ├── index.ts             # Server entry, route registration
│       │   ├── config/env.ts        # Typed env loader
│       │   ├── agent/               # AI + algorithmic trading engine
│       │   │   ├── agentRunner.ts   # Deterministic indicator→strategy→Gemini loop
│       │   │   ├── indicators.ts    # EMA/RSI/MACD/Bollinger/ATR/Volume + composite score
│       │   │   ├── strategies.ts    # 4 strategies (EMA Crossover, RSI MR, MACD, Bollinger)
│       │   │   ├── riskManager.ts   # Kelly Criterion sizing, ATR stop loss, risk gates
│       │   │   └── tradeExecutor.ts # MockDEX swap logic (auto + manual)
│       │   ├── analytics/
│       │   │   └── performance.ts   # HCS → equity curve, Sharpe, profit factor, drawdown
│       │   ├── backtesting/
│       │   │   └── backtester.ts    # Historical OHLCV simulation (CoinGecko)
│       │   └── routes/              # API routes
│       │       ├── agents.ts        # CRUD, finalize-deploy, fund, withdraw
│       │       ├── transactions.ts  # TX audit log
│       │       ├── leaderboard.ts   # GET /api/leaderboard sorted by win rate
│       │       └── marketplace.ts   # Listing (min 7 HCS) + purchase + perf stats
│       └── prisma/schema.prisma     # DB schema (Agent, Execution, Transaction models)
├── packages/
│   ├── contracts/                   # Solidity smart contracts
│   │   ├── contracts/
│   │   │   ├── AgentRegistry.sol    # On-chain agent registry (HSCS)
│   │   │   └── MockDEX.sol          # Testnet AMM v2 (real HTS token transfers)
│   │   └── scripts/
│   │       ├── deployNative.ts      # AgentRegistry — Hedera-native (ContractCreateFlow)
│   │       └── deployMockDEX.ts     # MockDEX — creates tUSDC, deploys, funds, seeds pool
│   ├── hedera/                      # Hedera SDK wrappers
│   │   └── src/
│   │       ├── client.ts            # SDK singleton + operator key
│   │       ├── hcs.ts               # HCS topic creation + messaging
│   │       ├── hts.ts               # HTS NFT minting
│   │       ├── hfs.ts               # HFS file storage
│   │       └── openconvai.ts        # HCS-10 AI registration
│   └── shared/                      # Shared TypeScript types
│       └── src/index.ts             # AgentConfig, AgentDecision, Zod schemas
└── verificationflow.md              # Full demo walkthrough
```

---

## 🔑 Architecture Highlights

### User-Pays vs Operator-Pays

| Action | Who Signs | Who Pays |
|--------|-----------|----------|
| Fund agent account | User (1× HashPack) | User HBAR |
| AUTO trade execution | Agent account key | Agent HBAR |
| MANUAL trade execution | User (1× HashPack per trade) | User HBAR |
| HCS decision logging | Operator | Operator HBAR |
| HCS-10 registration | Operator | Operator HBAR |
| Agent account creation | Operator | Operator HBAR (~0.1 seed) |

### Decision → Trade Proof Chain

```
1. Binance 1h candles → pricesToOHLCV() → calculateAllIndicators()
   └─ EMA, RSI (Wilder), MACD, Bollinger Bands, ATR, Volume surge
   └─ Composite score weighted across all indicators
2. Pyth + SaucerSwap prices → cross-check (>5% divergence → use DEX price)
3. syncMockDexReserves() → pool updated to match market price
4. runStrategy(strategyType, indicators, price, risk)
   └─ TREND_FOLLOW: EMA Crossover  |  MEAN_REVERT: RSI ± Bollinger
   └─ MOMENTUM: MACD Crossover     |  BREAKOUT: Bollinger + Volume surge
   └─ Returns: signal (BUY/SELL/HOLD), confidence %, stopLoss, takeProfit
5. calculatePositionSize() → Kelly Criterion with ATR-based stop loss
6. Gemini 2.5 Flash → enriches reasoning text ONLY (does not decide signal)
7. HCS message #N  ← decision logged BEFORE swap (aBFT timestamp)
8. MockDEX.executeSwap()  ← real HTS token transfer; embeds HCS seq #N
9. HCS message #N+1 ← execution result logged with txHash
```

Every swap is cryptographically linked to the AI decision that triggered it.
HBAR and tUSDC balances change in real wallets — not simulated.
The trade signal is deterministic and verifiable; Gemini only explains it.

---

## 🛠️ Implementation Status

| Feature | Status |
|---------|--------|
| Agents deployed via operator (pre-configured) | ✅ Complete |
| AgentRegistry smart contract | ✅ Complete |
| Agent dedicated ECDSA account | ✅ Complete |
| tUSDT auto-association per agent | ✅ Complete |
| Fund Agent modal (one-time) | ✅ Complete |
| **Full indicator engine** (EMA/RSI/MACD/Bollinger/ATR/Volume + composite score) | ✅ Complete |
| **4 deterministic strategies** (EMA Crossover, RSI Mean Reversion, MACD Momentum, Bollinger Breakout) | ✅ Complete |
| **Kelly Criterion risk manager** (position sizing, ATR stop loss, daily loss gate, drawdown gate) | ✅ Complete |
| Gemini enriches reasoning text (signal determined by indicators, not LLM) | ✅ Complete |
| HCS decision logging (aBFT) | ✅ Complete |
| MockDEX v2 — real HTS token transfers (SELL + BUY) | ✅ Complete |
| SaucerSwap live DEX price feed + reserve sync | ✅ Complete |
| TradeApprovalModal — live quote + 2-step BUY flow | ✅ Complete |
| AUTO mode autonomous trading (agent key) | ✅ Complete |
| MANUAL mode (HashPack trade approval) | ✅ Complete |
| Test Run (dry run, no swap) | ✅ Complete |
| Agent Portfolio (balance + P&L + Withdraw All) | ✅ Complete |
| Transaction Audit Log (/wallet) | ✅ Complete |
| Rich HCS Execution History | ✅ Complete |
| HCS-10 OpenConvAI registration (background) | ✅ Complete |
| Marketplace listing UI (HashPack association + operator mint, min 7 HCS decisions) | ✅ Complete |
| Marketplace buyer flow (associate + atomic swap + clone) | ✅ Complete |
| **Marketplace 6-stat cards** (win rate, profit factor, Sharpe, trades, avg win/loss + sparkline) | ✅ Complete |
| 5% royalty — Hedera HTS protocol-enforced | ✅ Complete |
| **Analytics Dashboard** (/dashboard/[id]) — 8 metric cards, equity curve, signal donut, HCS feed | ✅ Complete |
| **Leaderboard** (GET /api/leaderboard — sortable by win rate, Sharpe, profit factor) | ✅ Complete |
| **Backtesting engine** (POST /api/backtest — CoinGecko historical OHLCV simulation) | ✅ Complete |
| Wallet rehydration (no re-prompt on refresh) | ✅ Complete |
| Mainnet / SaucerSwap live execution | ⏳ Post-hackathon |

---

## 🔗 Key Links

- Hedera testnet HBAR faucet: [portal.hedera.com](https://portal.hedera.com)
- HashScan explorer: [hashscan.io/testnet](https://hashscan.io/testnet)
- API health check: [localhost:3001/health](http://localhost:3001/health)
- Full demo walkthrough: [`verificationflow.md`](./verificationflow.md)
- Enhancement log: [`enhancement.md`](./enhancement.md)
- Bug tracker: [`bugs.md`](./bugs.md)

---

## 📜 Tech Stack

**Frontend:** Next.js 15 · TypeScript (ES2020) · Tailwind v4 · Lucide React · Zustand · Framer Motion · **Recharts** (equity curves, signal distribution, trade P&L)

**Backend:** Node.js 22 · Express 4 · Supabase (PostgreSQL) · Prisma v6 · BullMQ · Redis · Zod

**AI Engine:** Gemini 2.5 Flash (reasoning enrichment) · Binance REST API (OHLCV) · EMA/RSI/MACD/Bollinger/ATR (deterministic indicators) · Kelly Criterion (position sizing) · CoinGecko (backtesting)

**Blockchain:** Hedera HCS · HTS · HFS · HSCS · HCS-10 · Mirror Node API · @hashgraph/sdk v2

**Contracts:** Solidity 0.8.24 · OpenZeppelin 5.x · Hardhat (compile only) · MockDEX (AMM + HTS precompile)

**Wallet:** HashPack · @hashgraph/hedera-wallet-connect v1 · WalletConnect v2

**Deployment:** Vercel (frontend) · Railway (API) · Supabase (DB) · Redis Cloud
