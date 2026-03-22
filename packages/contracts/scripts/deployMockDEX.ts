/**
 * deployMockDEX.ts — Deploy new MockDEX with real HTS token transfers
 *
 * Uses ContractCreateFlow (Hedera SDK native) for deployment so we get
 * the correct Hedera contract ID back directly.
 *
 * Steps:
 *   1. Create tUSDC HTS fungible token (or reuse TUSDC_TOKEN_ID env var)
 *   2. Deploy MockDEX via ContractCreateFlow (Hedera-native, not eth_sendRawTransaction)
 *   3. Associate tUSDC with MockDEX contract
 *   4. Fund MockDEX with 100 HBAR for BUY payouts
 *   5. Transfer 10,000 tUSDC to MockDEX for SELL payouts
 *   6. Seed pool reserves to ~$0.089/HBAR
 *   7. Update apps/api/.env and apps/web/.env.local
 *
 * Usage:
 *   cd packages/contracts && npx hardhat compile
 *   npx ts-node --project tsconfig.json scripts/deployMockDEX.ts
 *
 *   To reuse an already-created tUSDC token:
 *   TUSDC_TOKEN_ID=0.0.XXXXX npx ts-node --project tsconfig.json scripts/deployMockDEX.ts
 */

import {
  Client,
  AccountId,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  TokenAssociateTransaction,
  TokenId,
  Hbar,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractId,
  ContractFunctionParameters,
} from '@hashgraph/sdk';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const ARTIFACT_PATH = path.resolve(
  __dirname, '../artifacts/contracts/MockDEX.sol/MockDEX.json'
);
const API_ENV_PATH = path.resolve(__dirname, '../../../apps/api/.env');
const WEB_ENV_PATH = path.resolve(__dirname, '../../../apps/web/.env.local');

// Pool seeded at ~$0.089/HBAR: 500K HBAR : 44,500 USDC
const RESERVE_HBAR_TINYBARS = BigInt(500_000) * BigInt(100_000_000);
const RESERVE_USDC_MICRO    = BigInt(44_500)  * BigInt(1_000_000);
const FUND_HBAR             = 100;    // HBAR to seed for BUY payouts
const FUND_TUSDC            = 10_000; // tUSDC units for SELL payouts

function hederaIdToEvmAddress(hederaId: string): string {
  const num = parseInt(hederaId.split('.')[2], 10);
  return `0x${num.toString(16).padStart(40, '0')}`;
}

function setEnvVar(filePath: string, key: string, value: string): void {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, `${key}=${value}`)
    : content.trimEnd() + `\n${key}=${value}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
}

async function main() {
  console.log('\n■ TradeAgent — MockDEX Deployment (Real HTS Token Transfers)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const accountIdStr  = process.env.OPERATOR_ACCOUNT_ID!;
  const privateKeyStr = process.env.OPERATOR_PRIVATE_KEY!;
  const network       = process.env.HEDERA_NETWORK || 'testnet';

  if (!accountIdStr || !privateKeyStr) {
    throw new Error('OPERATOR_ACCOUNT_ID and OPERATOR_PRIVATE_KEY must be set in apps/api/.env');
  }

  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error('Artifacts not found. Run: cd packages/contracts && npx hardhat compile');
  }

  const client     = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  const operatorId = AccountId.fromString(accountIdStr);
  const privateKey = PrivateKey.fromStringECDSA(privateKeyStr);
  client.setOperator(operatorId, privateKey);
  client.setDefaultMaxTransactionFee(new Hbar(50));

  console.log(`Operator:  ${accountIdStr}`);
  console.log(`Network:   ${network}\n`);

  // ── Step 1: tUSDC token ────────────────────────────────────────
  let tUSDCTokenId: string;

  if (process.env.TUSDC_TOKEN_ID) {
    tUSDCTokenId = process.env.TUSDC_TOKEN_ID;
    console.log(`Step 1: Reusing existing tUSDC token: ${tUSDCTokenId}`);
  } else {
    console.log('Step 1: Creating tUSDC HTS fungible token...');
    const tx = await new TokenCreateTransaction()
      .setTokenName('Test USD Coin')
      .setTokenSymbol('tUSDC')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(1_000_000_000_000)  // 1M tUSDC (6 decimals)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(privateKey.publicKey)
      .setAdminKey(privateKey.publicKey)
      .setTokenMemo('TradeAgent tUSDC — testnet swap token')
      .setMaxTransactionFee(new Hbar(30))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    tUSDCTokenId  = receipt.tokenId!.toString();
  }

  const tUSDCEvmAddr = hederaIdToEvmAddress(tUSDCTokenId);
  console.log(`   ✓ tUSDC Token ID:  ${tUSDCTokenId}`);
  console.log(`   ✓ tUSDC EVM addr:  ${tUSDCEvmAddr}`);
  console.log(`   ✓ https://hashscan.io/${network}/token/${tUSDCTokenId}\n`);

  // ── Step 2: Deploy MockDEX via ContractCreateFlow ──────────────
  let contractIdStr: string;
  let mockDexEvmAddr: string;

  if (process.env.MOCK_DEX_HEDERA_ID) {
    contractIdStr  = process.env.MOCK_DEX_HEDERA_ID;
    const num      = parseInt(contractIdStr.split('.')[2], 10);
    mockDexEvmAddr = `0x${num.toString(16).padStart(40, '0')}`;
    console.log(`Step 2: Reusing existing MockDEX: ${contractIdStr}`);
    console.log(`   ✓ EVM address: ${mockDexEvmAddr}\n`);
  } else {
    console.log('Step 2: Deploying MockDEX.sol (ContractCreateFlow)...');

    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
    const bytecode = artifact.bytecode as string;

    // Encode constructor arg: address _tUSDCAddress
    const abiCoder     = new ethers.AbiCoder();
    const encodedArgs  = abiCoder.encode(['address'], [tUSDCEvmAddr]).replace('0x', '');
    const fullBytecode = bytecode + encodedArgs;

    const deployFlow = await new ContractCreateFlow()
      .setBytecode(fullBytecode)
      .setGas(2_000_000)
      .setAdminKey(privateKey.publicKey)
      .setContractMemo('TradeAgent:MockDEX:v2')
      .execute(client);

    const deployReceipt = await deployFlow.getReceipt(client);
    const contractId    = deployReceipt.contractId!;
    contractIdStr       = contractId.toString();
    mockDexEvmAddr      = `0x${contractId.toSolidityAddress()}`;

    console.log(`   ✓ Hedera ID:       ${contractIdStr}`);
    console.log(`   ✓ EVM address:     ${mockDexEvmAddr}`);
    console.log(`   ✓ https://hashscan.io/${network}/contract/${contractIdStr}\n`);
  }

  console.log(`   ✓ Hedera ID:       ${contractIdStr}`);
  console.log(`   ✓ EVM address:     ${mockDexEvmAddr}`);
  console.log(`   ✓ https://hashscan.io/${network}/contract/${contractIdStr}\n`);

  // ── Step 3: Associate tUSDC with MockDEX contract account ─────
  // Use TokenAssociateTransaction directly — more reliable than calling
  // the contract's associateTUSDC() helper (which can silently fail).
  // The operator can sign this because it holds the contract's adminKey.
  console.log('Step 3: Associating tUSDC with MockDEX contract account...');
  const assocTx = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(contractIdStr))   // contract's Hedera account ID
    .setTokenIds([TokenId.fromString(tUSDCTokenId)])
    .setMaxTransactionFee(new Hbar(2))
    .freezeWith(client)
    .sign(privateKey);
  const assocResponse = await assocTx.execute(client);
  await assocResponse.getReceipt(client);
  console.log('   ✓ tUSDC associated\n');

  // ── Step 4: Fund MockDEX with HBAR ────────────────────────────
  console.log(`Step 4: Funding MockDEX with ${FUND_HBAR} HBAR...`);
  const fundHbarTx = await new TransferTransaction()
    .addHbarTransfer(operatorId, new Hbar(-FUND_HBAR))
    .addHbarTransfer(AccountId.fromString(contractIdStr), new Hbar(FUND_HBAR))
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);
  await fundHbarTx.getReceipt(client);
  console.log(`   ✓ ${FUND_HBAR} HBAR sent\n`);

  // ── Step 5: Transfer tUSDC to MockDEX ─────────────────────────
  console.log(`Step 5: Transferring ${FUND_TUSDC} tUSDC to MockDEX...`);
  const fundTusdcTx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(tUSDCTokenId), operatorId, -(FUND_TUSDC * 1_000_000))
    .addTokenTransfer(TokenId.fromString(tUSDCTokenId), AccountId.fromString(contractIdStr), FUND_TUSDC * 1_000_000)
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);
  await fundTusdcTx.getReceipt(client);
  console.log(`   ✓ ${FUND_TUSDC} tUSDC transferred\n`);

  // ── Step 6: Seed pool reserves ────────────────────────────────
  console.log('Step 6: Seeding pool reserves...');
  const refreshTx = await new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(contractIdStr))
    .setGas(100_000)
    .setFunction('refreshReserves', new ContractFunctionParameters()
      .addUint256(Number(RESERVE_HBAR_TINYBARS))
      .addUint256(Number(RESERVE_USDC_MICRO))
    )
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);
  await refreshTx.getReceipt(client);
  const priceUSD = (Number(RESERVE_USDC_MICRO) / Number(RESERVE_HBAR_TINYBARS) * 1e2).toFixed(4);
  console.log(`   ✓ Pool price: $${priceUSD}/HBAR\n`);

  // ── Step 7: Update env files ───────────────────────────────────
  console.log('Step 7: Updating env files...');
  setEnvVar(API_ENV_PATH, 'MOCK_DEX_ADDRESS',    mockDexEvmAddr);
  setEnvVar(API_ENV_PATH, 'MOCK_DEX_HEDERA_ID',  contractIdStr);
  setEnvVar(API_ENV_PATH, 'TEST_USDT_TOKEN_ID',  tUSDCTokenId);
  setEnvVar(WEB_ENV_PATH, 'NEXT_PUBLIC_MOCK_DEX_ADDRESS',     mockDexEvmAddr);
  setEnvVar(WEB_ENV_PATH, 'NEXT_PUBLIC_MOCK_DEX_CONTRACT_ID', contractIdStr);
  setEnvVar(WEB_ENV_PATH, 'NEXT_PUBLIC_TEST_USDT_TOKEN_ID',   tUSDCTokenId);
  console.log('   ✓ apps/api/.env updated');
  console.log('   ✓ apps/web/.env.local updated\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('■ Deployment complete!\n');
  console.log(`  tUSDC Token:    ${tUSDCTokenId}`);
  console.log(`  MockDEX EVM:    ${mockDexEvmAddr}`);
  console.log(`  MockDEX Hedera: ${contractIdStr}\n`);
  console.log('  Next: restart API + frontend, then reconnect wallet.');
  console.log('═══════════════════════════════════════════════════════════\n');

  client.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n■ Deployment failed:', err.message || err);
    process.exit(1);
  });
