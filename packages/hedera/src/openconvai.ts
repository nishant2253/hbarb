/**
 * openconvai.ts — HCS-10 OpenConvAI agent registration & discovery
 *
 * Registers TradeAgent AI agents on the HCS-10 standard network,
 * enabling inter-agent communication and discovery via the
 * OpenConvAI ecosystem.
 *
 * Key concepts:
 *   - Each agent gets inbound + outbound HCS topics for messaging
 *   - Other AI agents can discover TradeAgent agents via HCS-10 registry
 *   - Enables agent-to-agent collaboration (future: agent marketplace)
 *
 * Uses @hashgraphonline/standards-sdk (HCS-10 reference implementation)
 */

import { HCS10Client, AgentBuilder, AIAgentCapability } from '@hashgraphonline/standards-sdk';

// ── Types ────────────────────────────────────────────────────────

export interface HCS10RegistrationParams {
  name:         string;
  description:  string;
  strategyType: string;
  accountId:    string;    // Hedera account ID (0.0.XXXXX)
  privateKey:   string;    // ECDSA private key hex
}

export interface HCS10AgentResult {
  inboundTopicId:  string;
  outboundTopicId: string;
  accountId:       string;
  agentId?:        string;
}

// ── registerAgentHCS10 ───────────────────────────────────────────

/**
 * Registers an agent on the HCS-10 OpenConvAI standard.
 *
 * This creates:
 *   - Inbound HCS topic:  where other agents send messages to this agent
 *   - Outbound HCS topic: where this agent broadcasts messages to others
 *
 * Once registered, the agent appears in the HCS-10 agent registry
 * and can be discovered by other AI agents on Hedera.
 *
 * @returns inboundTopicId + outboundTopicId for storing in DB
 */
export async function registerAgentHCS10(
  params: HCS10RegistrationParams
): Promise<HCS10AgentResult> {
  const client = new HCS10Client({
    network:            'testnet',
    operatorId:         params.accountId,
    operatorPrivateKey: params.privateKey,
    logLevel:           'warn',
  });

  const agent = new AgentBuilder()
    .setName(params.name)
    .setDescription(`TradeAgent: ${params.description} | Strategy: ${params.strategyType}`)
    .setAgentType('autonomous')
    .setModel('gemini-1.5-flash')
    .setNetwork('testnet')
    .setCapabilities([
      AIAgentCapability.TEXT_GENERATION,
      AIAgentCapability.MARKET_INTELLIGENCE,
      AIAgentCapability.TRANSACTION_ANALYTICS,
    ]);

  // Creates inbound + outbound HCS topics for inter-agent messaging
  const result = await client.createAgent(agent);

  console.log(`[HCS-10] Agent registered: ${params.name}`);
  console.log(`[HCS-10]   Inbound topic:  ${result.inboundTopicId}`);
  console.log(`[HCS-10]   Outbound topic: ${result.outboundTopicId}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultAny = result as any;

  return {
    inboundTopicId:  resultAny.inboundTopicId  as string,
    outboundTopicId: resultAny.outboundTopicId as string,
    accountId:       resultAny.accountId       as string ?? params.accountId,
  };
}

// ── sendAgentMessage ─────────────────────────────────────────────

/**
 * Sends a message from one agent to another via HCS-10 protocol.
 * Used for future agent-to-agent collaboration features.
 */
export async function sendAgentMessage(params: {
  senderAccountId:  string;
  senderPrivateKey: string;
  recipientInboundTopicId: string;
  message: Record<string, unknown>;
}): Promise<void> {
  const client = new HCS10Client({
    network:            'testnet',
    operatorId:         params.senderAccountId,
    operatorPrivateKey: params.senderPrivateKey,
    logLevel:           'warn',
  });

  await client.sendMessage(
    params.recipientInboundTopicId,
    JSON.stringify(params.message)
  );

  console.log(`[HCS-10] Message sent to topic ${params.recipientInboundTopicId}`);
}
