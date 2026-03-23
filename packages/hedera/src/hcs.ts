/**
 * hcs.ts — Hedera Consensus Service integration
 *
 * Provides aBFT-guaranteed audit trail for every AI agent decision.
 *
 * CRITICAL INVARIANT — enforced in agentRunner.ts:
 *   HCS write MUST happen BEFORE trade execution.
 *   Mirror Node becomes the tamper-proof source of truth.
 *
 * Pattern:
 *   1. createAgentTopic()     — one dedicated topic per agent at creation time
 *   2. submitAgentDecision()  — called before every HCS trade execution
 */

import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  TopicInfoQuery,
  Hbar,
  PrivateKey,
} from '@hashgraph/sdk';

// ── Types ────────────────────────────────────────────────────────

export interface AgentDecision {
  agentId:    string;
  signal:     'BUY' | 'SELL' | 'HOLD';
  price:      number;
  confidence: number;           // 0–100
  reasoning:  string;
  indicators: Record<string, number>;
  timestamp:  string;           // ISO 8601
}

export interface HCSSubmitResult {
  sequenceNumber:     string;
  consensusTimestamp: string;
  topicId:            string;
}

// ── createAgentTopic ─────────────────────────────────────────────

/**
 * Creates a dedicated HCS topic for one agent's audit trail.
 * Called once when the agent is first registered.
 *
 * - submitKey = operator's public key → only our backend can post
 * - memo = Arcane:{agentId} → searchable on HashScan
 *
 * @returns Hedera topic ID string ("0.0.XXXXX")
 */
export async function createAgentTopic(
  client: Client,
  agentId: string,
  operatorKey: PrivateKey
): Promise<string> {
  const frozen = await new TopicCreateTransaction()
    .setTopicMemo(`Arcane:${agentId}`)
    .setSubmitKey(operatorKey.publicKey)  // Only backend can post
    .setMaxTransactionFee(new Hbar(2))
    .freezeWith(client);
  const tx = await frozen.execute(client);

  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId!.toString(); // "0.0.4823901"

  console.log(`[HCS] Topic created for agent ${agentId}: ${topicId}`);
  return topicId;
}

// ── submitAgentDecision ──────────────────────────────────────────

/**
 * Submits an agent decision to its HCS topic.
 *
 * ⚠️  MUST be called BEFORE executing any trade on SaucerSwap.
 *     The aBFT consensus timestamp proves the decision came first.
 *     Mirror Node indexes the message for the leaderboard.
 *
 * @returns sequenceNumber + consensusTimestamp (Mirror Node verifiable)
 */
export async function submitAgentDecision(
  client: Client,
  topicId: string,
  decision: AgentDecision
): Promise<HCSSubmitResult> {
  const message = JSON.stringify({
    version:   '1.0',
    agentId:   decision.agentId,
    signal:    decision.signal,
    price:     decision.price,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    indicators: decision.indicators,
    timestamp: decision.timestamp,
  });

  // TopicMessageSubmitTransaction.execute() internally calls executeAll() which
  // requires the transaction to be frozen first — freezeWith(client) is mandatory.
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(message)
    .setMaxTransactionFee(new Hbar(1))
    .freezeWith(client)
    .execute(client);

  const receipt = await response.getReceipt(client);

  // Note: consensus timestamp is available via Mirror Node query after submission.
  // The receipt confirms finality; approximate timestamp used here.
  const result: HCSSubmitResult = {
    sequenceNumber:     receipt.topicSequenceNumber!.toString(),
    consensusTimestamp: new Date().toISOString(),
    topicId,
  };

  console.log(`[HCS] Decision logged → topic ${topicId} seq#${result.sequenceNumber} signal=${decision.signal}`);
  return result;
}

// ── getTopicMessages (Mirror Node) ───────────────────────────────

/**
 * Reads all messages from an agent's HCS topic via Mirror Node.
 * Mirror Node is the source of truth for performance data — NOT our DB.
 *
 * @param topicId - Hedera topic ID string ("0.0.XXXXX")
 * @param mirrorNodeUrl - defaults to testnet Mirror Node
 * @returns Array of parsed decision messages
 */
export async function getTopicMessages(
  topicId: string,
  mirrorNodeUrl = 'https://testnet.mirrornode.hedera.com'
): Promise<AgentDecision[]> {
  const url = `${mirrorNodeUrl}/api/v1/topics/${topicId}/messages?limit=100&order=desc`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mirror Node error: ${response.status} for topic ${topicId}`);
  }

  const data = await response.json() as { messages: Array<{ message: string; consensus_timestamp: string; sequence_number: number }> };

  return data.messages.map((msg) => {
    try {
      const decoded = Buffer.from(msg.message, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) as AgentDecision;
      return {
        ...parsed,
        timestamp: msg.consensus_timestamp,
      };
    } catch {
      return null;
    }
  }).filter(Boolean) as AgentDecision[];
}

// ── verifyTopicExists ────────────────────────────────────────────

/**
 * Verifies a topic exists and is accessible on the network.
 * Used as a sanity check after createAgentTopic().
 */
export async function verifyTopicExists(
  client: Client,
  topicId: string
): Promise<boolean> {
  try {
    await new TopicInfoQuery()
      .setTopicId(TopicId.fromString(topicId))
      .execute(client);
    return true;
  } catch {
    return false;
  }
}
