/**
 * deployNative.ts — Hedera-native AgentRegistry deployment
 *
 * PRIMARY deployment path for TradeAgent Phase 2.
 *
 * Uses ContractCreateFlow — the Hedera SDK's native high-level API that:
 *   1. Stores bytecode in HFS (FileCreateTransaction + FileAppendTransaction)
 *   2. Deploys contract from HFS (ContractCreateTransaction)
 *   All in ONE flow — this is the canonical Hedera-native path.
 *
 * Usage:
 *   1. cd packages/contracts && npx hardhat compile
 *   2. npx ts-node --project tsconfig.json scripts/deployNative.ts
 */

import {
  Client,
  AccountId,
  PrivateKey,
  ContractCreateFlow,
  Hbar,
} from '@hashgraph/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const ARTIFACT_PATH = path.resolve(
  __dirname,
  '../artifacts/contracts/AgentRegistry.sol/AgentRegistry.json'
);

const ENV_PATH = path.resolve(__dirname, '../../../apps/api/.env');

async function deployNative(): Promise<void> {
  console.log('');
  console.log('🚀 TradeAgent — Native Hedera Contract Deployment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // ── Validate environment ──────────────────────────────────────
  const accountId     = process.env.OPERATOR_ACCOUNT_ID;
  const privateKeyStr = process.env.OPERATOR_PRIVATE_KEY;
  const network       = process.env.HEDERA_NETWORK || 'testnet';

  if (!accountId || accountId.includes('XXXXX')) {
    console.error('❌ OPERATOR_ACCOUNT_ID not set in apps/api/.env');
    console.error('   Get a free testnet account at: portal.hedera.com');
    process.exit(1);
  }

  if (!privateKeyStr || privateKeyStr.length < 10) {
    console.error('❌ OPERATOR_PRIVATE_KEY not set in apps/api/.env');
    console.error('   Must be ECDSA hex format from portal.hedera.com');
    process.exit(1);
  }

  // ── Validate Hardhat artifacts ────────────────────────────────
  if (!existsSync(ARTIFACT_PATH)) {
    console.error('❌ Hardhat artifacts not found. Run first:');
    console.error('   npx hardhat compile');
    process.exit(1);
  }

  // ── Setup Hedera client ───────────────────────────────────────
  const client = network === 'mainnet'
    ? Client.forMainnet()
    : Client.forTestnet();

  const operatorId = AccountId.fromString(accountId);
  const privateKey = PrivateKey.fromStringECDSA(privateKeyStr);

  client.setOperator(operatorId, privateKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));

  console.log(`📋 Configuration:`);
  console.log(`   Network:  ${network}`);
  console.log(`   Operator: ${accountId}`);
  console.log('');

  // ── Step 1: Read compiled bytecode ───────────────────────────
  console.log('📖 Step 1: Reading compiled bytecode from Hardhat artifacts...');
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8'));

  // ContractCreateFlow accepts the raw bytecode hex string directly
  const bytecode: string = artifact.bytecode;

  if (!bytecode || bytecode === '0x') {
    console.error('❌ Empty bytecode. Run: npx hardhat compile');
    process.exit(1);
  }

  const bytecodeBytes = Buffer.from(bytecode.replace(/^0x/, ''), 'hex');
  console.log(`   Bytecode size: ${bytecodeBytes.length} bytes`);
  console.log('');

  // ── Steps 2 + 3: ContractCreateFlow ─────────────────────────
  // ContractCreateFlow is the canonical Hedera-native deployment path.
  // It internally runs:
  //   → FileCreateTransaction   (stores first 4KB of bytecode in HFS)
  //   → FileAppendTransaction   (appends remaining chunks — needed here: 7248 bytes)
  //   → ContractCreateTransaction (deploys from the HFS file)
  // This uses TWO Hedera services (HFS + HSCS) in one atomic flow.
  console.log('⚡ Steps 2+3: ContractCreateFlow (HFS store → HSCS deploy)...');
  console.log('   Using Hedera-native flow — NOT eth_sendRawTransaction');
  console.log('');

  const contractCreateFlow = await new ContractCreateFlow()
    .setBytecode(bytecode)              // Pass the raw hex bytecode string
    .setGas(4_000_000)                  // Gas for constructor — Hedera gas is cheap (~$0.05 per million)
    .setAdminKey(privateKey.publicKey) // Admin key enables Hedera-native upgrades
    .setContractMemo('TradeAgent:AgentRegistry:v2.1')
    .execute(client);

  const receipt = await contractCreateFlow.getReceipt(client);
  const contractId  = receipt.contractId!;
  const evmAddress  = contractId.toSolidityAddress();
  const hashscanUrl = `https://hashscan.io/${network}/contract/${contractId.toString()}`;

  console.log('🎉 AgentRegistry deployed successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Hedera Contract ID:  ${contractId.toString()}`);
  console.log(`   EVM Address:         0x${evmAddress}`);
  console.log(`   HashScan:            ${hashscanUrl}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // ── Step 4: Update apps/api/.env automatically ───────────────
  console.log('📝 Updating apps/api/.env with contract addresses...');

  let envContent = readFileSync(ENV_PATH, 'utf8');
  envContent = envContent
    .replace(
      /^AGENT_REGISTRY_CONTRACT_ID=.*$/m,
      `AGENT_REGISTRY_CONTRACT_ID=${contractId.toString()}`
    )
    .replace(
      /^AGENT_REGISTRY_EVM_ADDRESS=.*$/m,
      `AGENT_REGISTRY_EVM_ADDRESS=0x${evmAddress}`
    );

  writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log('   ✅ .env updated with contract ID and EVM address');

  // ── Step 5: Save deployment.json ─────────────────────────────
  const deploymentInfo = {
    contractId:  contractId.toString(),
    evmAddress:  `0x${evmAddress}`,
    network,
    deployedAt:  new Date().toISOString(),
    hashscanUrl,
  };

  writeFileSync(
    path.resolve(__dirname, '../deployment.json'),
    JSON.stringify(deploymentInfo, null, 2),
    'utf8'
  );
  console.log('   ✅ Deployment info saved to packages/contracts/deployment.json');
  console.log('');
  console.log('🔑 Next steps:');
  console.log(`   1. View on HashScan: ${hashscanUrl}`);
  console.log('   2. Run verification:');
  console.log('      npx ts-node --project tsconfig.json scripts/verifyDeployment.ts');
  console.log('');

  client.close();
}

deployNative().catch((err) => {
  console.error('❌ Deployment failed:', err.message || err);
  process.exit(1);
});
