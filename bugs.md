# TradeAgent Bug Tracker & Resolutions

This document tracks bugs encountered during the TradeAgent development lifecycle.

---

## Resolved Bugs

### 1. Next.js 15 Routing Types Mismatch
**Symptom:** Type error on dynamic route params.
**Resolution:** Updated dynamic route params to use `Promise` and `use(params)`.

### 2. Missing shadcn/ui Button Component
**Symptom:** Import error at build time.
**Resolution:** Replaced with standard HTML buttons styled with Tailwind.

### 3. Missing Next.js Link Import
**Symptom:** `Link` is not defined.
**Resolution:** Re-added the `import Link from 'next/link'`.

### 4. SDK Bug: Query.fromBytes() Recursion
**Symptom:** `Query.fromBytes() not implemented for type getByKey`.
**Resolution:** Bypassed `getReceiptWithSigner` for certain steps using propagation delay and direct Mirror Node check in `src/lib/tokenAssociation.ts`.

### 5. Ethers.js v6 Custom Signer Incompatibility
**Symptom:** `TypeError: Cannot read properties of undefined (reading 'then')` when routing HSCS calls through the HashPack ethers bridge.
**Root Cause:** `DAppSigner` in `@hashgraph/hedera-wallet-connect` v1.x expects a Hedera SDK `Transaction` object — not a raw EVM transaction object from ethers.
**Resolution:** Removed `hashpackEthers.ts` bridge entirely. Replaced with native `ContractExecuteTransaction` + `ContractFunctionParameters` from `@hashgraph/sdk`.

### 6. Missing `finalize-deploy` Endpoint
**Symptom:** Frontend completed all 3 HashPack transactions, then received 404.
**Resolution:** Added the complete `finalize-deploy` handler including `prisma.agent.create()`, `scheduleAgentJob()`, and fire-and-forget HCS-10 registration.

### 7. finalize-deploy Blocking for 60+ Seconds
**Symptom:** Frontend spinner ran 60+ seconds after HashPack approvals.
**Root Cause:** `registerAgentHCS10()` was awaited synchronously inside the HTTP handler.
**Resolution:** Wrapped `registerAgentHCS10()` in `setImmediate()`. DB and BullMQ are saved first, `res.json()` fires immediately, HCS-10 runs in background.

### 8. Gemini Always Returns HOLD — No Trades Executing
**Symptom:** Every agent run returns HOLD with "EMA value not provided" reasoning.
**Root Cause:** The decision prompt sent the indicator *config* (e.g. `{type:"EMA", period:60}`) but not actual computed values. Gemini could not make a BUY/SELL decision without real EMA/RSI numbers.
**Resolution:** Added `fetchPriceHistory()` (80 Binance 1h candles), `computeEMA()`, and `computeRSI()` in `agentRunner.ts`. Gemini now receives computed values like `EMA_60: 0.08843`, `RSI_14: 52.3` and cites them in the reasoning.

### 9. WalletConnect Double-Init / "No Signer for Account" After Reconnect
**Symptom:** After disconnecting and reconnecting, required 2 clicks. Console showed:
- `Error: No signer for account`
- `WalletConnect Core is already initialized`
- `WalletConnect is not initialized`
**Root Cause:** Three independent race conditions: (1) `dAppConnector` was nulled on disconnect, causing re-init on reconnect; (2) signer population is async and wasn't retried; (3) `useEffect` called `connectWallet` (modal-opening) instead of silent rehydration.
**Resolution:**
- `disconnectWallet()` no longer nulls `dAppConnector`
- Added `waitForSigner()` with up to 10 retries (100ms delay each)
- Added `rehydrateWallet()` — silent, no modal, checks existing sessions
- `connectWallet()` calls `rehydrateWallet()` first before opening modal
- `WalletConnect.tsx` `useEffect` calls `rehydrateWallet()` on mount; if it returns null, calls `disconnect()` to clear stale Zustand state

### 10. MockDEX Direction Strings and Function Name Wrong in Both Frontend and Backend
**Symptom:** On-chain revert: `"Invalid direction: use HBAR_TO_USDC or USDC_TO_HBAR"` when triggering a manual trade via the `TradeApprovalModal`. Auto mode trades also silently failed.
**Root Cause (two layers):**
1. The deployed `MockDEX.sol` uses **one** function: `executeSwap(agentId, direction, amountIn, minAmountOut, hcsSeq, topicId)`. Both `TradeApprovalModal.tsx` and `tradeExecutor.ts` were calling non-existent `sellHBARforUSDT` / `buyHBARwithUSDT` functions left over from an earlier draft of the contract.
2. Direction strings were `"HBAR_TO_USDT"` / `"USDT_TO_HBAR"`. The deployed contract only accepts `"HBAR_TO_USDC"` / `"USDC_TO_HBAR"`.
**Resolution:**
- `TradeApprovalModal.tsx`: replaced two-branch `sellHBARforUSDT`/`buyHBARwithUSDT` calls with a single `executeSwap(agentId, direction, amountIn, minAmountOut, hcsSeq, topicId)` call.
- `tradeExecutor.ts`: same — replaced two-branch logic with single `executeSwap` call.
- Direction strings corrected to `"HBAR_TO_USDC"` (SELL) and `"USDC_TO_HBAR"` (BUY) in both files.
- `MOCK_DEX_ABI` simplified to the single `executeSwap` entry plus `getSwapQuote` and `SwapExecuted` event.

### 11. TypeScript: `bigint` Not Assignable to `Hbar.fromTinybars` Parameter
**Symptom:** API server crashed with `TSError: TS2345: Argument of type 'bigint' is not assignable to parameter of type 'string | number | Long | BigNumber'` on the `/withdraw` endpoint.
**Root Cause:** `Hbar.fromTinybars()` from `@hashgraph/sdk` does not accept native `bigint` — it expects `string`, `number`, `Long`, or `BigNumber`.
**Resolution:** Convert `withdrawAmount` to string via `.toString()` before passing to `Hbar.fromTinybars()`. Use string prefix `"-"` for the debit side.

### 12. `transaction._makeTransactionBody is not a function` on Manual Trade Approval
**Symptom:** Clicking "Approve Swap" in `TradeApprovalModal` threw `TypeError: transaction._makeTransactionBody is not a function` from inside `DAppSigner.signTransaction`, preventing the trade from executing.
**Root Cause:** `TradeApprovalModal.tsx` used `getHashPackEthersSigner` (the `hashpackEthers.ts` bridge) to build an ethers signer, then called `mockDex.executeSwap()` through it. Ethers passes a raw EVM transaction object `{ to, data, gasLimit }` to `signer.sendTransaction()`, which forwarded it to `hederaSigner.signTransaction(tx)`. But `DAppSigner` from `@hashgraph/hedera-wallet-connect` internally calls `transactionToTransactionBody(tx)` which requires a Hedera SDK `Transaction` instance (one that has `_makeTransactionBody`). A plain EVM object has no such method.
**Resolution:** Replaced the entire ethers write path with the native Hedera SDK pattern:
- `getSwapQuote` (read-only): still called via `ethers.JsonRpcProvider` + `ethers.Contract` — no signing needed.
- `executeSwap` (write): replaced with `ContractExecuteTransaction` + `ContractFunctionParameters` using `freezeWithSigner(signer).executeWithSigner(signer)` — identical to the deployment pattern.
- Removed `getHashPackEthersSigner` import from `TradeApprovalModal.tsx` entirely.

### 13. TypeScript `TS6059` — Monorepo Packages Outside `rootDir`
**Symptom:** Linter reported `File '.../packages/hedera/src/index.ts' is not under 'rootDir' '.../apps/api/src'` on every file that imported `@tradeagent/hedera` or `@tradeagent/shared` in the API.
**Root Cause:** `apps/api/tsconfig.json` set `rootDir: "src"`, but `paths` mapped `@tradeagent/hedera` and `@tradeagent/shared` to files in `packages/*/src`, which is outside `apps/api/src`. When TypeScript resolved these aliases it included the package files in the compilation, violating the `rootDir` constraint.
**Resolution:** Changed `rootDir: "src"` → `rootDir: "../.."` (workspace root) and added `packages/shared/src/**/*` and `packages/hedera/src/**/*` to the `include` array in `apps/api/tsconfig.json`. The `outDir: "dist"` still functions correctly; `ts-node` dev mode is unaffected.

### 14. `TopicMessageSubmitTransaction` Always Requires `freezeWith(client)` — HCS Decisions Skipped
**Symptom:** Every `Run Trade` cycle prints `[HCS] ■ Decision logging failed — SKIPPING TRADE` with:
```
Error: transaction must have been frozen before calculating the hash will be stable, try calling `freeze`
  at TopicMessageSubmitTransaction._requireFrozen
  at TopicMessageSubmitTransaction.signWithOperator
  at TopicMessageSubmitTransaction.executeAll
  at TopicMessageSubmitTransaction.execute
  at submitAgentDecision (hcs.ts:105)
```
**Root Cause:** The Hedera SDK's `TopicMessageSubmitTransaction.execute()` internally always calls `executeAll()` (line 320 of the SDK CJS bundle). `executeAll()` calls `signWithOperator()` which calls `signWith()` which calls `_requireFrozen()`. Unlike most other transactions, `TopicMessageSubmitTransaction` does NOT auto-freeze before executing — `freezeWith(client)` must be called explicitly by the caller.
A previous "fix" that removed `freezeWith(client)` was incorrect; it appeared to work for short messages in some SDK versions but is fundamentally broken.
**Resolution:** Added `.freezeWith(client)` between `.setMaxTransactionFee()` and `.execute(client)` in `submitAgentDecision` in `packages/hedera/src/hcs.ts`:
```typescript
const response = await new TopicMessageSubmitTransaction()
  .setTopicId(TopicId.fromString(topicId))
  .setMessage(message)
  .setMaxTransactionFee(new Hbar(1))
  .freezeWith(client)   // ← required for TopicMessageSubmitTransaction
  .execute(client);
```

### 15. `createAgentTopic` Called with Missing `operatorKey` in `post-purchase` Route
**Symptom:** `POST /api/marketplace/post-purchase` would throw a TypeScript/runtime error: `Expected 3 arguments, but got 2` when trying to clone an agent for a buyer.
**Root Cause:** `marketplace.ts` called `createAgentTopic(client, newAgentId)` with only 2 arguments, but the function signature in `hcs.ts` is `createAgentTopic(client, agentId, operatorKey)`.
**Resolution:** Added `const operatorKey = getOperatorKey()` and passed it as the third argument: `createAgentTopic(client, newAgentId, operatorKey)` in `marketplace.ts`.

### 16. MockDEX Real HTS Transfers — `INSUFFICIENT_GAS` on `executeSwap` After v2 Deploy
**Symptom:** After redeploying `MockDEX.sol` v2 (with real HTS precompile calls), the TradeApprovalModal produced `INSUFFICIENT_GAS` errors. Gas of 300,000 was sufficient for the old simulated MockDEX but not for the new one that calls HTS precompile (0x167) for token transfers.
**Root Cause:** HTS precompile calls inside `executeSwap` (real tUSDC transfers via `IHederaTokenService.transferToken`) consume significantly more gas than the old reserve-only MockDEX.
**Resolution:** Gas limit increased to `800,000` in `TradeApprovalModal.tsx` (already set; confirmed sufficient). Backend `tradeExecutor.ts` also uses `800000` gas and `1200 gwei` gas price.

### 17. `TypeError: Cannot read properties of undefined (reading 'reduce')` on Marketplace Detail Page
**Symptom:** Navigating to `/marketplace/[id]` (clicking "View" on any listed agent) threw a React render crash: `TypeError: Cannot read properties of undefined (reading 'reduce')`.
**Root Cause:** `MarketplaceDetailPage` computed `buySell` by calling `listing.recentSignals.reduce(...)` directly. When the API response returns `recentSignals` as `null` or omits the field entirely (no prior trade signals), `.reduce` is called on `undefined`, crashing the render.
**Resolution:** Added a safe fallback in `apps/web/src/app/marketplace/[id]/page.tsx`:
```typescript
const signals = listing.recentSignals ?? [];
const buySell = signals.reduce((acc, s) => { ... }, { buy: 0, sell: 0 });
```
All three usages of `listing.recentSignals` (reduce, `.length > 0`, `.slice`) were updated to use the `signals` local variable.

### 18. "List as NFT" Had No HashPack Popup — Silent Backend-Only Call

**Symptom:** Clicking "List as NFT" on the agent dashboard called the backend silently with no user-visible wallet interaction. The operator minted the NFT, but the user never approved anything in HashPack, and the NFT could not be transferred to their account (TOKEN_NOT_ASSOCIATED).
**Root Cause:** `listOnMarketplace()` in `agents/[agentId]/page.tsx` made a direct `fetch()` POST to `/api/marketplace/list` with no prior `TokenAssociateTransaction`, so:
1. The user saw no HashPack popup
2. HTS could not transfer the minted NFT to the owner's account (not associated)
**Resolution:** Added a two-step flow to `listOnMarketplace()`:
1. **User signs `TokenAssociateTransaction`** for `NEXT_PUBLIC_STRATEGY_TOKEN_ID` → HashPack popup appears with gas fees
2. **Backend call** — operator mints NFT and transfers to the now-associated wallet
If the wallet is already associated, the `TOKEN_ALREADY_ASSOCIATED` error is silently caught and the flow continues to the backend call.

---

### 19. Four TypeScript Compilation Errors After Trading Platform Upgrade

**Symptom (4 separate errors in one batch):**
1. `apps/web/src/app/marketplace/page.tsx` — `Property 'profitFactor' does not exist on type 'Listing'` (and same for `sharpeRatio`, `avgWin`, `avgLoss`) — 8 errors total.
2. `apps/web/src/app/wallet/page.tsx(35)` — `Property 'setBalance' does not exist on type 'WalletState'`.
3. `apps/web/src/components/TradeApprovalModal.tsx` — `TS2737: BigInt literals are not available when targeting lower than ES2020` (4 occurrences).
4. `apps/web/src/components/TradeApprovalModal.tsx(138,139)` — `TS2345: Argument of type 'string' is not assignable to parameter of type 'number | BigNumber | Long'` on `.addUint256(amount.toString())` and `.addUint256(slippageMin.toString())`.

**Root Causes:**
1. `marketplaceStore.ts`'s `Listing` interface was not extended with the new performance fields (`profitFactor`, `sharpeRatio`, `avgWin`, `avgLoss`, `equitySparkline`) that the upgraded `marketplace/page.tsx` now reads.
2. `wallet/page.tsx` destructured `setBalance` (singular) from `useWalletStore`, but the store only exposes `setBalances` (plural). The variable was never actually called — dead code from an old draft.
3. `apps/web/tsconfig.json` had `"target": "ES2017"`. Native `bigint` literals (`0n`, `995n`) require at minimum `"target": "ES2020"` per the TypeScript specification.
4. `ContractFunctionParameters.addUint256()` from `@hashgraph/sdk` accepts `number | BigNumber | Long` — not `string`. Passing `.toString()` on a `bigint` produced a `string` which does not satisfy the overload.

**Resolutions:**
1. Added `profitFactor`, `sharpeRatio`, `avgWin`, `avgLoss`, `equitySparkline` as optional nullable fields to the `Listing` interface in `apps/web/src/stores/marketplaceStore.ts`.
2. Removed the unused `setBalance` from the destructure in `wallet/page.tsx` (store already exposes `setBalances`).
3. Changed `"target": "ES2017"` → `"target": "ES2020"` in `apps/web/tsconfig.json`.
4. Changed `.addUint256(amount.toString())` / `.addUint256(slippageMin.toString())` → `.addUint256(Number(amount))` / `.addUint256(Number(slippageMin))` in `TradeApprovalModal.tsx`.

**Files changed:** `apps/web/src/stores/marketplaceStore.ts`, `apps/web/src/app/wallet/page.tsx`, `apps/web/src/components/TradeApprovalModal.tsx`, `apps/web/tsconfig.json`.
