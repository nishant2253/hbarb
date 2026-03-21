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
