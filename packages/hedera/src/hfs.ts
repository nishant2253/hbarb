/**
 * hfs.ts — Hedera File Service integration
 *
 * Stores full agent configuration JSON on-chain in HFS.
 * NEW in v2.1: Complete config lives on Hedera — not just the hash.
 *
 * Pattern:
 *   1. storeAgentConfig()  — stores JSON in HFS, returns file ID
 *   2. readAgentConfig()   — reads back via FileContentsQuery
 *   3. updateAgentConfig() — replaces contents via FileUpdateTransaction
 *
 * The HFS file ID is stored in the AgentRegistry smart contract
 * alongside the keccak256 config hash — providing full on-chain verifiability.
 */

import {
  Client,
  FileCreateTransaction,
  FileUpdateTransaction,
  FileContentsQuery,
  FileAppendTransaction,
  FileDeleteTransaction,
  FileId,
  Hbar,
  PrivateKey,
} from '@hashgraph/sdk';

// ── Types ────────────────────────────────────────────────────────

export interface AgentConfigRecord {
  agentId:      string;
  name:         string;
  strategyType: string;
  asset:        string;
  timeframe:    string;
  indicators:   Record<string, unknown>;
  risk:         Record<string, number>;
  createdAt:    string;
  version:      string;
}

const HFS_CHUNK_SIZE = 4096; // bytes per transaction (HFS limit)

// ── storeAgentConfig ─────────────────────────────────────────────

/**
 * Stores the full agent configuration JSON in HFS.
 * Chunks the content if it exceeds 4KB (HFS per-transaction limit).
 *
 * @returns HFS file ID string ("0.0.XXXXX")
 */
export async function storeAgentConfig(
  client: Client,
  config: AgentConfigRecord,
  operatorKey: PrivateKey
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { version: _v, ...configWithoutVersion } = config;
  const configJson  = JSON.stringify({ version: '1.0', ...configWithoutVersion, storedAt: new Date().toISOString() });
  const configBytes = Buffer.from(configJson, 'utf-8');

  // Store first chunk via FileCreateTransaction
  const firstChunk     = configBytes.slice(0, HFS_CHUNK_SIZE);
  const remainingBytes = configBytes.slice(HFS_CHUNK_SIZE);

  const createTx = await new FileCreateTransaction()
    .setKeys([operatorKey.publicKey])
    .setContents(firstChunk)
    .setFileMemo(`TradeAgent:AgentConfig:${config.agentId}`)
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);

  const receipt    = await createTx.getReceipt(client);
  const fileId     = receipt.fileId!;
  const fileIdStr  = fileId.toString();

  // Append remaining chunks if config > 4KB
  if (remainingBytes.length > 0) {
    for (let offset = 0; offset < remainingBytes.length; offset += HFS_CHUNK_SIZE) {
      const chunk = remainingBytes.slice(offset, offset + HFS_CHUNK_SIZE);
      await new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(chunk)
        .setMaxTransactionFee(new Hbar(2))
        .execute(client);
    }
  }

  console.log(`[HFS] Agent config stored: ${fileIdStr} (${configBytes.length} bytes)`);
  return fileIdStr;
}

// ── readAgentConfig ──────────────────────────────────────────────

/**
 * Reads an agent config back from HFS.
 * Returns parsed JSON object.
 */
export async function readAgentConfig(
  client: Client,
  fileId: string
): Promise<AgentConfigRecord & { storedAt: string; version: string }> {
  const contents = await new FileContentsQuery()
    .setFileId(FileId.fromString(fileId))
    .execute(client);

  const json = Buffer.from(contents).toString('utf-8');
  return JSON.parse(json);
}

// ── updateAgentConfig ────────────────────────────────────────────

/**
 * Updates an existing HFS file with new config content.
 * Used when agent config is modified post-deployment.
 *
 * ⚠️  This changes the file contents. The config hash on the smart
 *      contract must also be updated via a separate contract call.
 */
export async function updateAgentConfig(
  client: Client,
  fileId: string,
  config: AgentConfigRecord,
  operatorKey: PrivateKey
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { version: _v2, ...configWithoutVersion2 } = config;
  const configJson  = JSON.stringify({ version: '1.0', ...configWithoutVersion2, updatedAt: new Date().toISOString() });
  const configBytes = Buffer.from(configJson, 'utf-8');
  const firstChunk  = configBytes.slice(0, HFS_CHUNK_SIZE);

  await new FileUpdateTransaction()
    .setFileId(FileId.fromString(fileId))
    .setContents(firstChunk)
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);

  // Append remaining if needed
  if (configBytes.length > HFS_CHUNK_SIZE) {
    const remaining = configBytes.slice(HFS_CHUNK_SIZE);
    for (let offset = 0; offset < remaining.length; offset += HFS_CHUNK_SIZE) {
      await new FileAppendTransaction()
        .setFileId(FileId.fromString(fileId))
        .setContents(remaining.slice(offset, offset + HFS_CHUNK_SIZE))
        .setMaxTransactionFee(new Hbar(2))
        .execute(client);
    }
  }

  console.log(`[HFS] Agent config updated: ${fileId}`);
}

// ── deleteAgentConfig ────────────────────────────────────────────

/**
 * Deletes an HFS config file (when agent is deactivated).
 * Requires operator key that was used to create the file.
 */
export async function deleteAgentConfig(
  client: Client,
  fileId: string
): Promise<void> {
  await new FileDeleteTransaction()
    .setFileId(FileId.fromString(fileId))
    .setMaxTransactionFee(new Hbar(1))
    .execute(client);

  console.log(`[HFS] Agent config deleted: ${fileId}`);
}
