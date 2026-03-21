# TradeAgent Bug Tracker & Resolutions

This document tracks bugs encountered during the TradeAgent development lifecycle, specifically focusing on the frontend wallet integration phase.

## Resolved Bugs

### 1. Next.js 15 Routing Types Mismatch (`PageProps` Promise Error)
**Symptom:** Build failures in `src/app/agents/[agentId]/page.tsx` and `src/app/marketplace/[id]/page.tsx`.
**Error:** `Type error: Type '{ params: { id: string; }; }' does not satisfy the constraint 'PageProps'.`
**Resolution:** Next.js 15 requires dynamic route `params` to be treated as a `Promise`. Updated the component signatures to `({ params }: { params: Promise<{ id: string }> })` and utilized React's `use(params)` hook to unwrap the properties in client components.

### 2. Missing `shadcn/ui` Button Component
**Symptom:** Build failed due to missing module: `@/components/ui/button`.
**Error:** `Module not found: Can't resolve '@/components/ui/button'`
**Resolution:** Replaced the import with a standard HTML `<button>` element inside `WalletConnect.tsx`, applying the existing Tailwind design system classes (`bg-[#00A9BA] hover:bg-[#007A8A] text-white`) to maintain the visual aesthetic without depending on uninitialized UI libraries.

### 3. Syntax Error: Duplicate Closing Tags in React Component
**Symptom:** Build failure with multiple TS errors (`Cannot find name 'div'`, `Expression expected`) in `src/app/create/page.tsx`.
**Cause:** During the injection of the `DeployButton` logic, duplicate closing tags (`</motion.div>`, `</div>`) were accidentally added, prematurely closing the main `MessageBubble` component and breaking the AST.
**Resolution:** Stripped out the duplicate closing tags from lines 142-147, restoring the correct React functional component structure.

### 4. Missing Next.js `Link` Import
**Symptom:** Build failure reporting `Cannot find name 'Link'`.
**Cause:** The `import Link from 'next/link'` statement was accidentally overwritten when consolidating imports for the WalletConnect integration in the `/create` route.
**Resolution:** Re-added the import.

### 5. `Message` Interface Missing `configHash`
**Symptom:** Build failure: `Property 'configHash' does not exist on type 'Message'`.
**Cause:** The AI Builder chat state required passing a `configHash` to the `DeployButton`, but the strict TypeScript interface did not define it.
**Resolution:** Updated the `Message` interface in `src/app/create/page.tsx` to include `configHash?: string;`.

### 6. `setWallet` Demo Mock Signature Mismatch
**Symptom:** Build failure: `Expected 4 arguments, but got 3` in `src/app/wallet/page.tsx`.
**Cause:** Upgraded the `walletStore` to support a `walletName` tracking property (e.g., "HashPack" vs "MetaMask"), which changed the signature of the `setWallet` action. The hardcoded demo fallback in the Wallet page was still passing 3 arguments.
**Resolution:** Updated `connectDemo` to pass `'DemoWallet'` as the third argument.

### 7. WalletConnect Modal Re-trigger on Refresh
**Symptom:** UI prompted WalletConnect QR code modal repeatedly after page refreshes.
**Cause:** `connectWallet` logic did not poll or wait for an active session to be established before showing the modal, preventing session persistence functionality.
**Resolution:** Implemented `dappConnector.checkSession()` polling to detect existing sessions gracefully and bypass the `openModal()` call if already connected.

### 8. `Converting circular structure to JSON` in Zustand Persist
**Symptom:** Unhandled runtime exception preventing application loading after WalletConnect initialization.
**Cause:** The `connector` object created by WalletConnect contains circular references and was being dumped into standard `localStorage` via Zustand `persist`.
**Resolution:** Configured Zustand `partialize` to omit the non-serializable `connector` object from the persistence cache.

### 9. Next.js Unhandled Logger Exception on Wallet Reject
**Symptom:** `Error: {} createUnhandledError` Next.js overlay triggers when user clicks 'Reject' or closes the WalletConnect modal.
**Cause:** The `@walletconnect/logger` was outputting `error` level logs which Next.js development server strictly interpreted as unhandled runtime application crashes.
**Resolution:** Lowered WalletConnect internal logger level to `fatal` and added explicit `catch (err)` blocks around `handleDeploy` and `handleConnect` to ignore user-initiated cancellations.

### 10. MockDEX Contract NatSpec Parsing Error
**Symptom:** Hardhat failed to compile `MockDEX.sol` with `DocstringParsingError: Documentation tag @1.0.1. not valid for contracts.`
**Cause:** The Solidity compiler interpreted the package version `@1.0.1` inside a docstring `/** ... */` as an invalid NatSpec tag.
**Resolution:** Replaced the `@` symbol with `v` (`v1.0.1`) in the block comment.

### 11. Testnet Deployment Out of Gas Revert
**Symptom:** `deployMockDEX.ts` threw `transaction execution reverted (action="sendTransaction"...)` consuming exactly 500,000 internal gas.
**Cause:** The Hedera network requires slightly more gas for AMM operations compared to standard EVM testnets.
**Resolution:** Increased the Hardhat deployment `gasLimit` from 500,000 to 2,000,000 and elevated base `gasPrice` to 960 gwei to meet new Hedera thresholds.

### 12. EVM Address to Hedera Integer Overflow
**Symptom:** The `deployMockDEX.ts` script generated an invalid scientific notation Hedera ID (`0.0.7.414070674793464e+47`) inside `apps/api/.env`.
**Cause:** The provided guide parsed the 160-bit equivalent 40-character hexadecimal EVM address natively using JavaScript's `parseInt()`, which vastly overflowed `Number.MAX_SAFE_INTEGER`.
**Resolution:** Passed the raw EVM address directly to the Hedera Testnet Mirror Node via REST API (`/api/v1/contracts/{evm_address}`) to resolve the precise valid `0.0.XXXXX` contract ID, and updated the environment variables manually.

### 13. TypeScript TradeExecutor Integration Mismatch
**Symptom:** Deep nested IDE type errors inside `agentRunner.ts` handling `executeTradeSignal`.
**Cause:** The MockDEX pipeline returned more expansive properties (`txHash`, `slippageBps`, `fillPrice`) than the standard base LangGraph execution model, causing strict interface definitions to fail.
**Resolution:** Utilized scoped `any` typecasting on execution responses and forced the LangChain tools array export shape to `any[]` to circumvent TypeScript's infinite instantiation recursion bug.
