# TradeAgent Enhancements

This document tracks major feature enhancements and integrations for the TradeAgent platform.

---

## 1. HashPack / WalletConnect Integration
**Status:** ✅ Complete

### Key Features:
- **WalletConnect v2:** Secure, standards-compliant connection to HashPack on Hedera Testnet.
- **Session Persistence:** `rehydrateWallet()` restores sessions silently on page refresh — no modal pop-up.
- **Race-Condition Fix:** `waitForSigner()` retries signer lookup up to 10× (100ms each) to handle async population.
- **tUSDT Support:** Automatic token association detection and balance tracking via Mirror Node API.
- **User-Pays Model:** Users sign and pay HBAR fees for all on-chain actions (deployments and MANUAL trades).

---

## 2. Native HSCS Calls via ContractExecuteTransaction
**Status:** ✅ Complete (replaced ethers bridge across all user-signed contract calls)

The `hashpackEthers.ts` ethers signer bridge is permanently incompatible with `DAppSigner` for write calls and has been abandoned for all on-chain write operations. All user-signed smart contract calls now use:
- `ContractExecuteTransaction` + `ContractFunctionParameters` from `@hashgraph/sdk`
- `ContractId.fromEvmAddress(0, 0, address)` to resolve EVM address → Hedera contract ID
- Fully compatible with `freezeWithSigner(signer).executeWithSigner(signer)` pattern

**Applies to all user-signed write calls:**
| Call | Location | Gas | Max Fee |
|------|----------|-----|---------|
| `AgentRegistry.registerAgent()` (deploy TX3) | `create/page.tsx` | 800,000 | 5 HBAR |
| `MockDEX.executeSwap()` (manual trade SELL) | `TradeApprovalModal.tsx` | 800,000 | 5 HBAR |
| `MockDEX.executeSwap()` (manual trade BUY step 2) | `TradeApprovalModal.tsx` | 800,000 | 5 HBAR |

**Read-only calls** (`getSwapQuote`) continue to use `ethers.JsonRpcProvider` + `ethers.Contract` directly against Hashio — no wallet needed for reads.

---

## 3. Non-Blocking finalize-deploy Endpoint
**Status:** ✅ Complete

`POST /api/agents/finalize-deploy` responds in ~100ms:
1. Validate request params (~1ms)
2. Create dedicated agent trading account (AccountCreateTransaction + tUSDT association, ~3–5s)
3. `prisma.agent.create()` — save agent (~30ms)
4. `scheduleAgentJob()` — register BullMQ cron (~10ms)
5. `res.status(201).json(...)` — **respond immediately with `agentAccountId`**
6. `setImmediate(() => registerAgentHCS10(...))` — fire-and-forget HCS-10 (30–90s background)

---

## 4. AI Agent Proposal Card
**Status:** ✅ Complete

`ConfigProposalCard` in `create/page.tsx` displays full Gemini-generated `AgentConfig`:
- Agent name, strategy type badge, asset pair, timeframe
- Technical indicators as chips (EMA, RSI, MACD)
- Risk management: Stop-Loss %, Take-Profit %, Max Position %
- ConfigHash preview (first 14 chars of keccak256 hash)
- Deploy button scoped to this specific config version

---

## 5. Real Technical Indicator Computation
**Status:** ✅ Complete

Before every Gemini AI decision, the backend now:
- Fetches 80 hourly candles from Binance API (`/api/v3/klines?symbol=HBARUSDT&interval=1h`)
- Computes `EMA(period)` using proper SMA seed + exponential smoothing
- Computes `RSI(period)` using Wilder's smoothing method
- Computes `MACD line` if configured
- Passes computed values (e.g. `EMA_60: 0.08843`, `RSI_14: 52.3`, `price_vs_ma_pct: 1.43`) to Gemini

Gemini is required to cite actual values in its reasoning. The prompt includes explicit decision rules per strategy type to prevent spurious HOLDs.

---

## 6. Agent Wallet Architecture (True Agentic Trading)
**Status:** ✅ Complete

Each deployed agent gets its own dedicated Hedera ECDSA account — the core solution to the "agentic trading paradox":

| Mode | Behaviour |
|------|-----------|
| **MANUAL SIGN** | User signs each trade via HashPack TradeApprovalModal. tUSDT lands in user's HashPack. |
| **AUTO TRADE** | Agent account's ECDSA key signs autonomously. tUSDT lands in agent's own wallet. No per-trade user signing. |

**How it works:**
1. `finalize-deploy` generates a new ECDSA key pair, creates a Hedera account (`AccountCreateTransaction`), and associates the tUSDT token — all operator-paid, background
2. `agentAccountId`, `agentAccountEvmAddress`, and `agentAccountPrivateKey` stored in DB
3. Frontend shows **Step 4 "Fund Your Agent"** modal after deployment — user sends HBAR via one HashPack `TransferTransaction`
4. `tradeExecutor.ts` AUTO mode uses `agentAccountPrivateKey` to build an `ethers.Wallet` — MockDEX calls run from agent account
5. Agent Portfolio card on `/agents/[id]` shows live HBAR + tUSDT balances from Mirror Node, initial budget, and P&L %
6. "Withdraw All" button triggers operator-signed `TransferTransaction` returning funds to owner (no extra HashPack needed)

**Total user signatures for full lifecycle: 4 (3 deploy + 1 fund) + 1 optional withdrawal**

---

## 7. Transaction Audit Log
**Status:** ✅ Complete

New `Transaction` Prisma model and `/api/transactions` endpoints record every HashPack-approved transaction:

| Type | Trigger |
|------|---------|
| `DEPLOY_HFS` | HFS FileCreate during deployment |
| `DEPLOY_HCS` | HCS TopicCreate during deployment |
| `DEPLOY_HSCS` | ContractExecuteTransaction during deployment |
| `AGENT_FUND` | Fund Agent TransferTransaction |
| `TRADE_SWAP` | ManualTradeApprovalModal swap confirmed |

Accessible at `/wallet` — shows type icon, agent name, truncated Tx ID (copy button), status, relative timestamp, and HashScan deep-link.

---

## 8. Run Trade Button + Test Run
**Status:** ✅ Complete

Agent detail page (`/agents/[id]`) now has:
- **Run Trade** — triggers full AI cycle + HCS log; if BUY/SELL in MANUAL mode, shows `TradeApprovalModal` for user to sign the swap. **Disabled in AUTO mode** (agent trades automatically via BullMQ cron).
- **Test Run · no swap** — runs full AI cycle + HCS log but skips MockDEX call. Safe to use without spending HBAR. Formerly called "Dry Run".

---

## 9. Rich HCS Execution History
**Status:** ✅ Complete

HCS Execution History panel on agent dashboard now shows:
- **Decision entries** (BUY/SELL/HOLD badges): confidence %, price, AI reasoning, and indicator value chips (EMA, RSI, price_vs_ma_pct)
- **Execution entries** (green "SWAP DONE" badge): direction arrow (HBAR → tUSDT), amounts in/out, slippage %, clickable tx hash → HashScan
- Timestamps as relative time ("3m ago", "1h ago") instead of raw epoch strings
- All data sourced live from Hedera Mirror Node (aBFT-guaranteed)

---

## 10. MockDEX v2 — Real HTS Token Transfers
**Status:** ✅ Complete (deployed testnet: MockDEX `0.0.8332937`, tUSDC `0.0.8332870`)

`MockDEX.sol` v2 unified `executeSwap` with real on-chain token movement:

| Direction | Behaviour |
|-----------|-----------|
| `HBAR_TO_USDC` (SELL) | Caller sends real HBAR as `msg.value`; contract calls HTS precompile `transferToken(tUSDC, contract→caller, amount)` — real tUSDC arrives in caller's wallet |
| `USDC_TO_HBAR` (BUY) | Caller grants HTS allowance; contract calls `transferToken(tUSDC, caller→contract, amount)` — real HBAR sent back via `payable(msg.sender).call{value}` |

**Key components:**
- Uses HTS Precompile (0x167) for `transferToken` — Hedera-exclusive
- Uses Exchange Rate Precompile (0x168) for HBAR/USD on-chain pricing
- `getSwapQuote(direction, amountIn)` — AMM x*y=k read-only, no signing
- `refreshReserves(newHBAR, newUSDC)` — operator syncs pool to market price
- `associateTUSDC()` — one-time admin call to associate contract with HTS token
- `SwapExecuted` event embeds `hcsSequenceNum` — cryptographic proof chain

**Deploy script** (`deployMockDEX.ts`) fully automated:
1. Creates tUSDC HTS fungible token (1M supply, 6 decimals)
2. Deploys MockDEX via `ContractCreateFlow` (Hedera-native)
3. `TokenAssociateTransaction` to associate tUSDC with MockDEX account
4. Funds with 100 HBAR + 10,000 tUSDC for pool liquidity
5. Seeds reserves to ~$0.089/HBAR
6. Auto-updates `apps/api/.env` and `apps/web/.env.local`

---

## 11. Live SaucerSwap Price Feed + MockDEX Reserve Sync
**Status:** ✅ Complete

Every agent cycle now:
1. Fetches HBAR price from Pyth (primary) via Agent Kit
2. Cross-checks with SaucerSwap REST API (`https://api.saucerswap.finance/tokens/`) — the live DEX
3. If Pyth/SaucerSwap diverge by >5%, uses SaucerSwap (on-chain DEX price is ground truth)
4. Calls `syncMockDexReserves(priceUSD)` — updates MockDEX pool via `refreshReserves()` so `getSwapQuote()` returns accurate quotes

Both prices are logged to console for transparency:
```
[HederaKit] Pyth price for HBAR/USDC: $0.089621
[SaucerSwap] DEX market price: $0.089534
[MockDEX] Pool synced: $0.0895/HBAR
```

---

## 12. TradeApprovalModal — Live Quote + Real Swap Flow
**Status:** ✅ Complete

**Live quote preview** (no signing required):
- Fetches `getSwapQuote(direction, amount)` via `ethers.JsonRpcProvider` on mount
- Shows "You send: X HBAR / You receive: ~Y tUSDC" with pool price and price impact %
- Loading skeleton while quote fetches

**SELL path** (`HBAR_TO_USDC`):
- `ContractExecuteTransaction.setPayableAmount(Hbar.fromTinybars(amount))` sends real HBAR
- tUSDC arrives in wallet after confirmation

**BUY path** (`USDC_TO_HBAR`) — 2-step flow:
- **Step 1/2**: `AccountAllowanceApproveTransaction.addTokenAllowance(tUSDCTokenId, mockDexId, amount)` → HashPack "Allow tUSDC spend"
- **Step 2/2**: `ContractExecuteTransaction` for `executeSwap` → HashPack "Execute swap"
- Progress bar UI shows current step

**Balance refresh** restored after success — Mirror Node now reflects real token movement.

---

## 13. NFT Marketplace — Full Buyer + Seller Flow
**Status:** ✅ Complete

### Seller (agent owner) — "List as NFT" section on agent dashboard
- Price input (HBAR) + "List as NFT" button
- Calls `POST /api/marketplace/list` → mints HTS NFT via `mintAgentNFT()`
- Shows serial number, HashScan link, delist button
- 5% royalty enforced at Hedera protocol level (HIP-412 `CustomRoyaltyFee`) — impossible to bypass

### Buyer — `/marketplace/[id]` buy flow (3 steps)
1. **Associate** strategy NFT token with buyer's wallet (`TokenAssociateTransaction`) — auto-skipped if already associated
2. **Atomic swap**: `TransferTransaction` (HBAR from buyer → seller, NFT from seller → buyer) — 5% royalty auto-deducted by HTS
3. **Clone agent**: `POST /api/marketplace/post-purchase` creates a working copy for buyer:
   - New HCS topic for buyer's audit trail
   - New DB row with `buyerAccountId` as owner
   - New BullMQ job scheduled
   - Returns `clonedAgentId` → frontend redirects to buyer's agent dashboard

### Backend `POST /api/marketplace/post-purchase`
- Finds original agent by `serialNumber`
- Clones to new agent ID with buyer as owner
- Creates new HCS topic (operator-signed)
- Schedules BullMQ cron job
- Auto-redirects buyer to their new agent in 3 seconds

---

## 14. HCS-10 OpenConvAI Registration
**Status:** ✅ Complete (background)

Each deployed agent is registered in the Hedera HCS-10 OpenConvAI standard:
- Creates inbound + outbound topics on HCS
- Inscribes agent profile JSON (name, bio, capabilities)
- Compatible with AI-to-AI interoperability on Hedera
- Runs asynchronously in `setImmediate()` — does not delay the user's deployment flow

---

### Enhancement 14. Marketplace Detail Page — Safe `recentSignals` Guard
**Files changed:** `apps/web/src/app/marketplace/[id]/page.tsx`

**What changed:** The `buySell` computation (and signal history list render) now uses `const signals = listing.recentSignals ?? []` as a safe fallback. Previously the page crashed with `TypeError: Cannot read properties of undefined (reading 'reduce')` whenever an agent had no prior trade history (API returned `recentSignals: null` or omitted the field). All three usages of `listing.recentSignals` were migrated to the `signals` local variable.

---

### Enhancement 15. "List as NFT" — User-Signed Token Association (HashPack Popup)
**Files changed:** `apps/web/src/app/agents/[agentId]/page.tsx`

**What changed:** `listOnMarketplace()` now has a mandatory user-signed step before the operator mints:
1. **`TokenAssociateTransaction`** for the strategy NFT token (max fee: 2 HBAR) → triggers a HashPack popup so the user explicitly approves and sees the gas cost
2. **Backend mint + transfer** — operator mints an NFT and transfers it to the now-associated owner wallet

The `TokenId`, `AccountId`, and `Hbar` SDK classes were imported into `agents/[agentId]/page.tsx` and `signer` was extracted from `useWalletStore`. The association step silently skips if the account is already associated (`TOKEN_ALREADY_ASSOCIATED` error is caught and ignored).

---

## Upcoming / Planned

- [ ] Mainnet deployment: replace MockDEX with live SaucerSwap + HAK plugin
- [ ] Agent settings page: change risk params, adjust timeframe, pause/resume
- [ ] Portfolio dashboard: aggregate P&L across all agents
- [ ] Notification system: alert user when MANUAL trade approval is pending
- [ ] Encrypt `agentAccountPrivateKey` at rest (AES-256 with operator master key)
