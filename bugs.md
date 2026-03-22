# TradeAgent Bug Tracker & Resolutions

This document tracks bugs encountered during the TradeAgent development lifecycle.

## Resolved Bugs

### 1. Next.js 15 Routing Types Mismatch
**Resolution:** Updated dynamic route params to use `Promise` and `use(params)`.

### 2. Missing shadcn/ui Button Component
**Resolution:** Replaced with standard HTML buttons styled with Tailwind.

### 3. Syntax Error: Duplicate Closing Tags
**Resolution:** Restored correct JSX structure in `CreatePage`.

### 4. Missing Next.js Link Import
**Resolution:** Re-added the import.

### 5. SDK Bug: Query.fromBytes() Recursion
**Symptom:** `Query.fromBytes() not implemented for type getByKey`.
**Resolution:** Bypassed `getReceiptWithSigner` for certain steps using propagation delay and direct Mirror Node check in `src/lib/tokenAssociation.ts`.

### 6. Ethers.js v6 Recursion Error with Custom Signers
**Symptom:** `TypeError: Cannot read properties of undefined (reading 'then')`.
**Resolution:** Implemented manual transaction encoding using `interface.encodeFunctionData` and called `sendTransaction` directly in `src/app/create/page.tsx`.

### 7. Missing agentId during Registration
**Symptom:** Deployment crashed with `invalid string value (value=null)`.
**Resolution:** Explicitly merged `agentId` from backend response into configuration state in `CreatePage`.

### 8. Backend Crash: Duplicate prisma Imports
**Resolution:** Consolidated Prisma imports in `tradeExecutor.ts`.

### 9. Wallet Session Rehydration
**Resolution:** Added `useEffect` in `WalletConnect.tsx` to restore session state on page refresh.
