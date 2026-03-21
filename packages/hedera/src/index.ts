/**
 * packages/hedera/src/index.ts
 * Main export file for the @tradeagent/hedera workspace package.
 *
 * Usage in apps/api:
 *   import { createHederaClient, createAgentTopic, submitAgentDecision } from '@tradeagent/hedera'
 */

// ── Hedera Client ────────────────────────────────────────────────
export { createHederaClient, getOperatorKey, getOperatorAccountId } from './client';

// ── Phase 3: HCS — Consensus Service (aBFT audit trail) ─────────
export {
  createAgentTopic,
  submitAgentDecision,
  getTopicMessages,
  verifyTopicExists,
} from './hcs';
export type { AgentDecision, HCSSubmitResult } from './hcs';

// ── Phase 3: HFS — File Service (on-chain config) ────────────────
export {
  storeAgentConfig,
  readAgentConfig,
  updateAgentConfig,
  deleteAgentConfig,
} from './hfs';
export type { AgentConfigRecord } from './hfs';

// ── Phase 3: HTS — Token Service (NFT marketplace) ───────────────
export {
  createStrategyNFTCollection,
  mintAgentNFT,
  getAgentNFTOwner,
  getCollectionStats,
} from './hts';
export type { NFTMetadata } from './hts';

// ── Phase 3: HCS-10 — OpenConvAI inter-agent messaging ───────────
export {
  registerAgentHCS10,
  sendAgentMessage,
} from './openconvai';
export type { HCS10RegistrationParams, HCS10AgentResult } from './openconvai';
