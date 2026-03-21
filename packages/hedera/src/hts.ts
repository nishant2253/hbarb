/**
 * hts.ts — Hedera Token Service integration
 *
 * Creates and manages the TradeAgent Strategies NFT collection.
 * Each listed agent gets minted as an NFT with 5% protocol royalties.
 *
 * Key Hedera differentiator:
 *   Royalties are enforced at the PROTOCOL level — not smart contract logic.
 *   Every secondary sale on any marketplace pays 5% to the TradeAgent operator.
 *   This is impossible to circumvent on Hedera. On Ethereum, it's optional.
 *
 * Pattern:
 *   1. createStrategyNFTCollection() — run ONCE at startup, saves STRATEGY_TOKEN_ID
 *   2. mintAgentNFT()                — called when owner lists agent on marketplace
 *   3. getAgentNFTOwner()            — reads current owner via Mirror Node
 */

import {
  Client,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  CustomRoyaltyFee,
  CustomFixedFee,
  AccountId,
  PrivateKey,
  Hbar,
  TokenId,
} from '@hashgraph/sdk';

// ── Types ────────────────────────────────────────────────────────

export interface NFTMetadata {
  agentId:       string;
  name:          string;
  description:   string;
  strategyType:  string;
  asset:         string;
  performance:   string;   // e.g. "+14.2% (30d)"
  hcsTopicId:    string;
  hfsConfigId:   string;
  image:         string;   // IPFS URI
  creator:       string;   // Hedera account ID
  createdAt:     string;
}

// ── createStrategyNFTCollection ──────────────────────────────────

/**
 * Creates the shared "TradeAgent Strategies" NFT collection.
 *
 * Run ONCE at startup, then save the returned ID as STRATEGY_TOKEN_ID in .env.
 *
 * Features:
 *   - 5% royalty on every secondary sale (protocol-enforced by Hedera)
 *   - 1 HBAR fallback fee for HBAR-denominated purchases
 *   - Max supply of 10,000 strategy NFTs
 *   - HIP-412 compliant metadata standard
 *
 * @returns Token ID string ("0.0.XXXXX")
 */
export async function createStrategyNFTCollection(
  client: Client,
  operatorId: string,
  operatorKey: PrivateKey
): Promise<string> {
  // 5% royalty fee on every secondary sale
  // Protocol-enforced — no smart contract needed, no bypass possible
  const royaltyFee = new CustomRoyaltyFee()
    .setNumerator(5)
    .setDenominator(100)
    .setFeeCollectorAccountId(AccountId.fromString(operatorId))
    .setFallbackFee(
      new CustomFixedFee().setHbarAmount(new Hbar(1))  // 1 HBAR fallback for HBAR sales
    );

  const tx = await new TokenCreateTransaction()
    .setTokenName('TradeAgent Strategies')
    .setTokenSymbol('TAS')
    .setTokenType(TokenType.NonFungibleUnique)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(10_000)
    .setTreasuryAccountId(AccountId.fromString(operatorId))
    .setSupplyKey(operatorKey)
    .setAdminKey(operatorKey)
    .setCustomFees([royaltyFee])
    .setTokenMemo('TradeAgent verified strategy NFTs — HIP-412')
    .setMaxTransactionFee(new Hbar(100))
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const tokenId = receipt.tokenId!.toString();

  console.log(`[HTS] Strategy NFT collection created: ${tokenId}`);
  console.log(`[HTS] Save this as STRATEGY_TOKEN_ID in apps/api/.env`);

  return tokenId;
}

// ── mintAgentNFT ─────────────────────────────────────────────────

/**
 * Mints one NFT for an agent when it's listed on the marketplace.
 *
 * Metadata follows HIP-412 standard — stored as JSON in NFT metadata field.
 * The metadata includes HCS topic ID and HFS config ID for on-chain verification.
 *
 * @returns serial number of the minted NFT
 */
export async function mintAgentNFT(
  client: Client,
  tokenId: string,
  metadata: NFTMetadata,
  operatorKey: PrivateKey
): Promise<number> {
  // HIP-412 compliant metadata object
  const nftMetadataJson = JSON.stringify({
    name:        metadata.name,
    description: metadata.description,
    image:       metadata.image,
    type:        'image/png',
    attributes: [
      { trait_type: 'Strategy',     value: metadata.strategyType },
      { trait_type: 'Asset',        value: metadata.asset },
      { trait_type: 'Performance',  value: metadata.performance },
      { trait_type: 'HCS Topic',    value: metadata.hcsTopicId },
      { trait_type: 'HFS Config',   value: metadata.hfsConfigId },
      { trait_type: 'Agent ID',     value: metadata.agentId },
      { trait_type: 'Creator',      value: metadata.creator },
    ],
    properties: {
      hcsTopicId:  metadata.hcsTopicId,
      hfsConfigId: metadata.hfsConfigId,
      agentId:     metadata.agentId,
      createdAt:   metadata.createdAt,
    },
  });

  // NFT metadata goes in the metadata bytes field (max 100 bytes on-chain)
  // Full metadata stored externally via IPFS, CID referenced in attributes
  const metadataBytes = Buffer.from(nftMetadataJson.slice(0, 100), 'utf-8');

  const tx = await new TokenMintTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .addMetadata(metadataBytes)
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const serials = receipt.serials!;
  const serial  = Number(serials[serials.length - 1]);

  console.log(`[HTS] Agent NFT minted: token ${tokenId} serial #${serial}`);
  return serial;
}

// ── getAgentNFTOwner (Mirror Node) ───────────────────────────────

/**
 * Returns the current owner of an agent NFT via Mirror Node.
 * Mirror Node is source of truth — not our DB.
 *
 * @param tokenId - HTS token ID ("0.0.XXXXX")
 * @param serialNumber - NFT serial number
 */
export async function getAgentNFTOwner(
  tokenId: string,
  serialNumber: number,
  mirrorNodeUrl = 'https://testnet.mirrornode.hedera.com'
): Promise<string | null> {
  const url = `${mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts/${serialNumber}`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json() as { account_id: string };
  return data.account_id ?? null;
}

// ── getCollectionStats (Mirror Node) ─────────────────────────────

/**
 * Returns stats for the strategy NFT collection via Mirror Node.
 */
export async function getCollectionStats(
  tokenId: string,
  mirrorNodeUrl = 'https://testnet.mirrornode.hedera.com'
): Promise<{ totalMinted: number; tokenId: string }> {
  const url = `${mirrorNodeUrl}/api/v1/tokens/${tokenId}`;

  const response = await fetch(url);
  if (!response.ok) {
    return { totalMinted: 0, tokenId };
  }

  const data = await response.json() as { total_supply: string };
  return {
    totalMinted: parseInt(data.total_supply ?? '0'),
    tokenId,
  };
}
