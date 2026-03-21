# TradeAgent Enhancements

This document tracks major feature enhancements and integrations for the TradeAgent platform.

## 1. HashPack / WalletConnect Integration

**Context**
TradeAgent is an AI-powered trading platform on Hedera. To allow users to pay for deployments, authorize transactions, and receive royalties, a native Hedera wallet connection is required. We chose **HashPack** via the official WalletConnect SDK as the primary integration for the hackathon, ensuring compatibility with Hedera Token Service (HTS) and Hedera Consensus Service (HCS).

**Steps Implemented:**
1. **WalletConnect SDK Installation**: Installed `@hashgraph/hedera-wallet-connect`, `@walletconnect/modal`, and `@walletconnect/sign-client`.
2. **Global State Management**: Upgraded `src/stores/walletStore.ts` to use `zustand` with persistence (`persist` middleware). This ensures account IDs, EVM addresses, and connection status survive page refreshes.
3. **Wallet Lib initialization**: Created `src/lib/wallet.ts` to initialize the `DAppConnector` targeting `LedgerId.TESTNET`.
4. **Dynamic UI Component**: Created `src/components/WalletConnect.tsx`, replacing the hardcoded connect button with a dynamic button that opens the WalletConnect modal.
5. **Real-time Balance Lookups**: Configured the wallet component to fetch the user's actual HBAR balance using the public Hedera Testnet Mirror Node (`testnet.mirrornode.hedera.com/api/v1/accounts/`).
6. **Deployment Flow Wiring**: In the AI Builder (`/create` route), the "Deploy to Hedera" action now checks the wallet state. If unconnected, it intercepts the action, opens the WalletConnect modal, waits for authentication, and *then* submits the deployment to the backend `/api/agents/deploy` route using the authenticated `accountId`.

## Next Steps / Future Enhancements
- **Smart Contract Linking**: Use the WalletConnect `sign-client` to prompt the user to sign the actual `ContractCreateTransaction` directly from their HashPack wallet, rather than relying on a backend operator account.
- **Atomic Swaps**: Implement Phase 3 logic where users can purchase Strategy NFTs via the HashPack extension, triggering simultaneous HBAR transfer and NFT delivery.
