import { Client, AccountId, PrivateKey, Hbar } from '@hashgraph/sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env if not already loaded
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

let cachedClient: Client | null = null;

/**
 * Creates and returns a singleton Hedera SDK client.
 *
 * The operator account pays all Hedera transaction fees on behalf of users.
 * Uses ECDSA private key (required for EVM/JSON-RPC compatibility).
 *
 * @returns Hedera Client configured for testnet or mainnet
 */
export function createHederaClient(): Client {
  // Return cached client if already initialized
  if (cachedClient) {
    return cachedClient;
  }

  const network = process.env.HEDERA_NETWORK || 'testnet';
  const accountId = process.env.OPERATOR_ACCOUNT_ID;
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;

  if (!accountId || !privateKey) {
    throw new Error(
      '❌ Hedera credentials not set.\n' +
      '   Set OPERATOR_ACCOUNT_ID and OPERATOR_PRIVATE_KEY in apps/api/.env\n' +
      '   Get a free testnet account at: portal.hedera.com'
    );
  }

  // Create client for the configured network
  const client = network === 'mainnet'
    ? Client.forMainnet()
    : Client.forTestnet();

  // Set the operator (server-side Hedera identity that pays all fees)
  // IMPORTANT: Must use ECDSA key for EVM compatibility
  client.setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringECDSA(privateKey)
  );

  // Set sensible defaults to avoid accidental overspending
  client.setDefaultMaxTransactionFee(new Hbar(2));
  client.setDefaultMaxQueryPayment(new Hbar(1));

  cachedClient = client;

  console.log(`✅ Hedera Client initialized`);
  console.log(`   Network:  ${network}`);
  console.log(`   Operator: ${accountId}`);

  return client;
}

/**
 * Resets the cached client (useful for testing or key rotation)
 */
export function resetHederaClient(): void {
  if (cachedClient) {
    cachedClient.close();
    cachedClient = null;
  }
}

/**
 * Returns the operator's PrivateKey object from env
 */
export function getOperatorKey(): PrivateKey {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not set in environment');
  }
  return PrivateKey.fromStringECDSA(privateKey);
}

/**
 * Returns the operator's AccountId object from env
 */
export function getOperatorAccountId(): AccountId {
  const accountId = process.env.OPERATOR_ACCOUNT_ID;
  if (!accountId) {
    throw new Error('OPERATOR_ACCOUNT_ID not set in environment');
  }
  return AccountId.fromString(accountId);
}
