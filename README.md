# TradeAgent — AI-Powered Trading Agent Platform on Hedera

> **Hedera APEX Hackathon 2026 · Track 1: AI & Agents**

TradeAgent is a decentralized AI trading agent platform. Users create, deploy, and monetize autonomous trading agents whose every decision is permanently recorded on Hedera with aBFT-guaranteed timestamps.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 22+** and **npm 10+**
- Hedera testnet account → [portal.hedera.com](https://portal.hedera.com)
- Gemini API key (free) → [aistudio.google.com](https://aistudio.google.com)
- Supabase project (free) → [supabase.com](https://supabase.com)
- Redis (local Docker or [Redis Cloud free tier](https://redis.io/try-free))

### 1. Clone & Install

```bash
git clone <your-repo>
cd tradeagent
npm install
```

### 2. Configure Environment

```bash
# Copy the example env file
cp apps/api/.env.example apps/api/.env

# Edit with your real credentials
open apps/api/.env  # or use VS Code
```

**Required values in `apps/api/.env`:**

| Variable | Where to get it |
|---|---|
| `OPERATOR_ACCOUNT_ID` | [portal.hedera.com](https://portal.hedera.com) → Create Account → Testnet |
| `OPERATOR_PRIVATE_KEY` | Same portal — use ECDSA key type |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API Key |
| `SUPABASE_URL` | Your Supabase project → Settings → API |
| `SUPABASE_ANON_KEY` | Same page |
| `DATABASE_URL` | Supabase → Settings → Database → Connection string |

### 3. Set Up Database (Supabase + Prisma)

```bash
cd apps/api
npm run prisma:generate   # Generate Prisma client
npm run prisma:migrate    # Run migrations (first time)
```

### 4. Start Development Server

```bash
# From root
npm run dev:api           # API server on http://localhost:3001

# In another terminal
npm run dev:web           # Frontend on http://localhost:3000 (Phase 6)
```

---

## 🏗️ Monorepo Structure

```
tradeagent/                          # npm workspaces root
├── apps/
│   ├── web/                         # Next.js 15 frontend (Phase 6)
│   │   ├── src/app/                 # App Router pages
│   │   └── src/stores/              # Zustand state stores
│   └── api/                         # Node.js + Express API
│       ├── src/
│       │   ├── index.ts             # Server entry point
│       │   ├── config/env.ts        # Typed env loader
│       │   ├── agent/               # AI engine (Phase 4)
│       │   └── routes/              # API routes (Phase 5)
│       └── prisma/schema.prisma     # DB schema
├── packages/
│   ├── contracts/                   # Solidity smart contracts (Phase 2)
│   │   ├── contracts/AgentRegistry.sol
│   │   └── scripts/deployNative.ts  # Hedera-native deployment
│   ├── hedera/                      # Hedera SDK integration (Phase 3)
│   │   └── src/
│   │       ├── client.ts            # Hedera SDK singleton
│   │       ├── hcs.ts               # HCS topics (Phase 3)
│   │       ├── hts.ts               # HTS NFTs (Phase 3)
│   │       ├── hfs.ts               # HFS file storage (Phase 3)
│   │       └── openconvai.ts        # HCS-10 (Phase 3)
│   └── shared/                      # Shared types & schemas
│       └── src/index.ts             # AgentConfig, AgentDecision, Zod schemas
└── assets/                          # Walbi UI reference screenshots
```

---

## 🛠️ Implementation Phases

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | ✅ Complete | Project setup, monorepo, env config |
| **Phase 2** | ⏳ Pending | AgentRegistry.sol + native Hedera deployment |
| **Phase 3** | ⏳ Pending | HCS + HTS + HFS + HCS-10 infrastructure |
| **Phase 4** | ⏳ Pending | AI engine (Gemini + LangGraph + SaucerSwap + Pyth) |
| **Phase 5** | ⏳ Pending | Backend API routes (agents, marketplace) |
| **Phase 6** | ⏳ Pending | Frontend (Next.js 15 + Zustand + shadcn/ui) |
| **Phase 7** | ⏳ Pending | Testing, demo, deployment |

---

## 🔗 Key Resources

- Hedera testnet HBAR faucet: [portal.hedera.com](https://portal.hedera.com)
- HashScan explorer: [hashscan.io/testnet](https://hashscan.io/testnet)
- API health check: [localhost:3001/health](http://localhost:3001/health)
- SaucerSwap: [saucerswap.finance](https://saucerswap.finance)

---

## 📜 Tech Stack

**Frontend:** Next.js 15 · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion · Zustand · ReactFlow · Recharts

**Backend:** Node.js 22 · Express 4 · Supabase · Prisma · BullMQ · Redis · Zod

**AI Engine:** Gemini 1.5 Flash (free) · LangGraph · Hedera Agent Kit v3 · SaucerSwap Plugin · Pyth Oracle Plugin

**Blockchain:** Hedera HCS · HTS · HFS · HSCS · HCS-10 · Mirror Node · @hashgraph/sdk

**Contracts:** Solidity 0.8.24 · OpenZeppelin 5.x · Hardhat (compile only)

**Deployment:** Vercel (frontend) · Railway (API) · Supabase (DB) · Redis Cloud
