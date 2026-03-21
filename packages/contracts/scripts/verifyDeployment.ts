/**
 * verifyDeployment.ts — Post-deployment verification for AgentRegistry
 *
 * Calls registerAgent() on the deployed contract with a test agent.
 * Confirms the transaction succeeds and the agent is stored on-chain.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/verifyDeployment.ts
 *
 * Requires: AGENT_REGISTRY_CONTRACT_ID in apps/api/.env (set by deployNative.ts)
 */

import {
  Client,
  AccountId,
  PrivateKey,
  ContractExecuteTransaction,
  ContractCallQuery,
  ContractId,
  Hbar,
  ContractFunctionParameters,
} from '@hashgraph/sdk';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../apps/api/.env') });

const ARTIFACT_PATH = path.resolve(
  __dirname,
  '../artifacts/contracts/AgentRegistry.sol/AgentRegistry.json'
);

async function verifyDeployment(): Promise<void> {
  console.log('');
  console.log('🔍 TradeAgent — AgentRegistry Deployment Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // ── Validate env ──────────────────────────────────────────────
  const accountId      = process.env.OPERATOR_ACCOUNT_ID;
  const privateKeyStr  = process.env.OPERATOR_PRIVATE_KEY;
  const contractIdStr  = process.env.AGENT_REGISTRY_CONTRACT_ID;
  const network        = process.env.HEDERA_NETWORK || 'testnet';

  if (!accountId || accountId.includes('XXXXX')) {
    console.error('❌ OPERATOR_ACCOUNT_ID missing from apps/api/.env');
    process.exit(1);
  }

  if (!contractIdStr || contractIdStr.trim() === '') {
    console.error('❌ AGENT_REGISTRY_CONTRACT_ID missing from apps/api/.env');
    console.error('   Run deployNative.ts first, it fills this automatically.');
    process.exit(1);
  }

  // ── Setup client ──────────────────────────────────────────────
  const client = network === 'mainnet'
    ? Client.forMainnet()
    : Client.forTestnet();

  const operatorId = AccountId.fromString(accountId);
  const privateKey = PrivateKey.fromStringECDSA(privateKeyStr!);

  client.setOperator(operatorId, privateKey);
  client.setDefaultMaxTransactionFee(new Hbar(5));

  const contractId = ContractId.fromString(contractIdStr);

  console.log(`📋 Configuration:`);
  console.log(`   Network:     ${network}`);
  console.log(`   Operator:    ${accountId}`);
  console.log(`   Contract ID: ${contractIdStr}`);
  console.log('');

  // ── Test data ─────────────────────────────────────────────────
  const testAgentId   = 'verify-test-' + Date.now();
  const testConfigHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify({ strategyType: 'TEST', asset: 'HBAR/USDC' }))
  );
  const testHcsTopicId    = '0.0.9999999'; // placeholder for verification
  const testHfsConfigId   = '0.0.9999998'; // placeholder for verification
  const testStrategyType  = 'CUSTOM';

  // ── Test 1: registerAgent() ───────────────────────────────────
  console.log('🧪 Test 1: Calling registerAgent()...');

  const registerTx = await new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(400_000)
    .setFunction(
      'registerAgent',
      new ContractFunctionParameters()
        .addString(testAgentId)
        .addBytes32(Buffer.from(testConfigHash.replace('0x', ''), 'hex'))
        .addString(testHcsTopicId)
        .addString(testHfsConfigId)
        .addString(testStrategyType)
    )
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);

  const registerReceipt = await registerTx.getReceipt(client);

  console.log(`   ✅ registerAgent() succeeded!`);
  console.log(`   Transaction ID: ${registerTx.transactionId.toString()}`);
  console.log('');

  // ── Test 2: verifyConfigHash() ────────────────────────────────
  console.log('🧪 Test 2: Calling verifyConfigHash()...');

  const verifyResult = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction(
      'verifyConfigHash',
      new ContractFunctionParameters()
        .addString(testAgentId)
        .addBytes32(Buffer.from(testConfigHash.replace('0x', ''), 'hex'))
    )
    .execute(client);

  const hashMatches = verifyResult.getBool(0);
  if (!hashMatches) {
    console.error('   ❌ Config hash verification FAILED — configHash mismatch');
    process.exit(1);
  }

  console.log(`   ✅ verifyConfigHash() returned true — config hash matches!`);
  console.log('');

  // ── Test 3: getTotalAgents() ──────────────────────────────────
  console.log('🧪 Test 3: Calling getTotalAgents()...');

  const totalResult = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(100_000)
    .setFunction('getTotalAgents')
    .execute(client);

  const totalAgents = totalResult.getUint256(0);
  console.log(`   ✅ getTotalAgents() = ${totalAgents} agents on-chain`);
  console.log('');

  // ── Test 4: logExecution() ────────────────────────────────────
  console.log('🧪 Test 4: Calling logExecution() (BUY signal)...');

  const logTx = await new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(400_000)
    .setFunction(
      'logExecution',
      new ContractFunctionParameters()
        .addString(testAgentId)
        .addString('BUY')
        .addUint256(84200000) // 0.0842 HBAR in tinybars
    )
    .setMaxTransactionFee(new Hbar(2))
    .execute(client);

  await logTx.getReceipt(client);

  console.log(`   ✅ logExecution() succeeded — AgentExecutionLogged event emitted`);
  console.log(`   Transaction ID: ${logTx.transactionId.toString()}`);
  console.log('');

  // ── Summary ───────────────────────────────────────────────────
  const hashscanUrl = `https://hashscan.io/${network}/contract/${contractIdStr}`;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ALL TESTS PASSED — AgentRegistry is fully functional!');
  console.log('');
  console.log('   ✅ registerAgent()    — Agent stored on-chain');
  console.log('   ✅ verifyConfigHash() — Config hash verified');
  console.log('   ✅ getTotalAgents()   — Count query works');
  console.log('   ✅ logExecution()     — Execution event emitted');
  console.log('');
  console.log(`   🔗 HashScan: ${hashscanUrl}`);
  console.log('');
  console.log('   Phase 2 complete! Ready for Phase 3 (HCS + HTS + HFS).');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  client.close();
}

verifyDeployment().catch((err) => {
  console.error('❌ Verification failed:', err.message || err);
  process.exit(1);
});
