/**
 * AgentRegistry.test.ts
 * Phase 7 — Smart Contract Unit Tests (Hardhat + Chai)
 *
 * Run — local Hardhat (no testnet):
 *   cd packages/contracts && npx hardhat test
 *
 * Run — Hedera testnet (full integration):
 *   npx hardhat test --network hederaTestnet
 */

// ── Chai matchers augmentation ─────────────────────────────────────
// Must be imported so `.emit()` / `.revertedWith()` are on Chai.Assertion
import '@nomicfoundation/hardhat-chai-matchers';

import type { HardhatEthersHelpers } from '@nomicfoundation/hardhat-ethers/types';
import type { ethers as EthersLib }   from 'ethers';

// @nomicfoundation/hardhat-ethers augments HRE to expose ethers with extra
// Hardhat-only helpers (getSigners, getContractFactory, provider).
// We union the types so the IDE resolves them correctly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ethers = require('hardhat').ethers as typeof EthersLib & HardhatEthersHelpers;

import { expect } from 'chai';


// ── Helpers ───────────────────────────────────────────────────────
function cfgHash(json: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(json));
}

async function blockTs(txReceipt: { blockNumber: number }): Promise<number> {
  const block = await ethers.provider.getBlock(txReceipt.blockNumber);
  return block!.timestamp;
}

// ── Shared fixtures ───────────────────────────────────────────────
// `registry` typed as `any` — TypeChain is not configured so the IDE cannot
// infer contract-specific methods (registerAgent, logExecution, etc.) from
// BaseContract. This is the correct pattern without TypeChain generation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
let owner: Awaited<ReturnType<HardhatEthersHelpers['getSigners']>>[0];
let addr1:  Awaited<ReturnType<HardhatEthersHelpers['getSigners']>>[0];

async function deployRegistry() {
  [owner, addr1] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('AgentRegistry');
  registry = await Factory.deploy();
  await registry.waitForDeployment();
}

async function registerTestAgent(
  id       = 'agent-001',
  topic    = '0.0.4823901',
  hfs      = '0.0.9999',
  strategy = 'TREND_FOLLOW',
) {
  const hash = cfgHash(JSON.stringify({ strategy }));
  const tx   = await registry.registerAgent(id, hash, topic, hfs, strategy);
  await tx.wait();
  return hash;
}

// ─────────────────────────────────────────────────────────────────
describe('AgentRegistry', function () {
  // ── 1. Deployment ───────────────────────────────────────────────
  describe('Deployment', function () {
    beforeEach(deployRegistry);

    it('deploys with owner set correctly', async function () {
      expect(await registry.owner()).to.equal(await owner.getAddress());
    });

    it('starts with zero agents', async function () {
      expect(await registry.getTotalAgents()).to.equal(0n);
    });

    it('starts with zero listings', async function () {
      expect(await registry.getTotalListings()).to.equal(0n);
    });
  });

  // ── 2. registerAgent ────────────────────────────────────────────
  describe('registerAgent', function () {
    beforeEach(deployRegistry);

    it('registers agent and emits AgentRegistered event', async function () {
      const hash = cfgHash('{"strategy":"EMA_CROSS"}');
      await expect(
        registry.registerAgent('agent-001', hash, '0.0.4823901', '0.0.9999', 'TREND_FOLLOW'),
      )
        .to.emit(registry, 'AgentRegistered')
        .withArgs('agent-001', await owner.getAddress(), '0.0.4823901', '0.0.9999', 'TREND_FOLLOW');
    });

    it('increments getTotalAgents', async function () {
      await registerTestAgent('a1');
      await registerTestAgent('a2');
      expect(await registry.getTotalAgents()).to.equal(2n);
    });

    it('stores active = true on registration', async function () {
      await registerTestAgent('a1');
      expect((await registry.getAgent('a1')).active).to.be.true;
    });

    it('stores serialNumber = 0 initially', async function () {
      await registerTestAgent('a1');
      expect((await registry.getAgent('a1')).serialNumber).to.equal(0n);
    });

    it('reverts on duplicate agentId', async function () {
      await registerTestAgent('dup-001');
      await expect(registerTestAgent('dup-001'))
        .to.be.revertedWith('AgentRegistry: already registered');
    });

    it('reverts on empty agentId', async function () {
      await expect(
        registry.registerAgent('', cfgHash('{}'), '0.0.1', '0.0.2', 'TREND_FOLLOW'),
      ).to.be.revertedWith('AgentRegistry: empty agentId');
    });

    it('reverts on empty hcsTopicId', async function () {
      await expect(
        registry.registerAgent('agent-x', cfgHash('{}'), '', '0.0.2', 'TREND_FOLLOW'),
      ).to.be.revertedWith('AgentRegistry: empty hcsTopicId');
    });

    it('reverts on empty hfsConfigId', async function () {
      await expect(
        registry.registerAgent('agent-x', cfgHash('{}'), '0.0.1', '', 'TREND_FOLLOW'),
      ).to.be.revertedWith('AgentRegistry: empty hfsConfigId');
    });

    it('tracks agents by owner', async function () {
      await registerTestAgent('owner-a1');
      await registerTestAgent('owner-a2');
      const ids = await registry.getAgentsByOwner(await owner.getAddress());
      expect(ids).to.include('owner-a1');
      expect(ids).to.include('owner-a2');
    });
  });

  // ── 3. verifyConfigHash ─────────────────────────────────────────
  describe('verifyConfigHash', function () {
    beforeEach(deployRegistry);

    it('returns true for matching hash', async function () {
      const config = JSON.stringify({ strategy: 'EMA_60', asset: 'HBAR/USDC' });
      const hash   = cfgHash(config);
      await registry.registerAgent('verify-01', hash, '0.0.1', '0.0.2', 'TREND_FOLLOW');
      expect(await registry.verifyConfigHash('verify-01', hash)).to.be.true;
    });

    it('returns false for tampered hash', async function () {
      const hash = cfgHash('{"strategy":"EMA_60"}');
      await registry.registerAgent('verify-02', hash, '0.0.1', '0.0.2', 'TREND_FOLLOW');
      expect(await registry.verifyConfigHash('verify-02', cfgHash('{"strategy":"TAMPERED"}'))).to.be.false;
    });
  });

  // ── 4. logExecution ─────────────────────────────────────────────
  describe('logExecution', function () {
    beforeEach(deployRegistry);

    it('emits AgentExecutionLogged with correct args', async function () {
      await registerTestAgent('exec-01');
      const price = 8_420_000;

      // Grab the tx receipt to get the actual block timestamp — avoids off-by-1 race
      const tx      = await registry.logExecution('exec-01', 'BUY', price);
      const receipt = await tx.wait();
      const ts      = await blockTs(receipt);

      await expect(tx)
        .to.emit(registry, 'AgentExecutionLogged')
        .withArgs('exec-01', 'BUY', price, ts);
    });

    it('reverts if called by non-owner', async function () {
      await registerTestAgent('exec-02');
      await expect(
        registry.connect(addr1).logExecution('exec-02', 'SELL', 8_000_000),
      ).to.be.revertedWith('AgentRegistry: not owner');
    });

    it('reverts after agent is deactivated', async function () {
      await registerTestAgent('exec-03');
      await registry.deactivateAgent('exec-03');
      await expect(
        registry.logExecution('exec-03', 'BUY', 8_420_000),
      ).to.be.revertedWith('AgentRegistry: agent inactive');
    });
  });

  // ── 5. listOnMarketplace ────────────────────────────────────────
  describe('listOnMarketplace', function () {
    beforeEach(deployRegistry);

    it('sets serialNumber and priceUSD, emits AgentListed', async function () {
      await registerTestAgent('list-01');
      await expect(registry.listOnMarketplace('list-01', 42, 2000))
        .to.emit(registry, 'AgentListed')
        .withArgs('list-01', 42, 2000);

      const agent = await registry.getAgent('list-01');
      expect(agent.serialNumber).to.equal(42n);
      expect(agent.priceUSD).to.equal(2000n);
    });

    it('increments getTotalListings', async function () {
      await registerTestAgent('list-02');
      await registry.listOnMarketplace('list-02', 1, 1000);
      expect(await registry.getTotalListings()).to.equal(1n);
    });

    it('reverts if priceUSD is 0', async function () {
      await registerTestAgent('list-03');
      await expect(registry.listOnMarketplace('list-03', 1, 0))
        .to.be.revertedWith('AgentRegistry: price must be > 0');
    });

    it('reverts if called by non-owner', async function () {
      await registerTestAgent('list-04');
      await expect(
        registry.connect(addr1).listOnMarketplace('list-04', 1, 1000),
      ).to.be.revertedWith('AgentRegistry: not owner');
    });
  });

  // ── 6. deactivateAgent ──────────────────────────────────────────
  describe('deactivateAgent', function () {
    beforeEach(deployRegistry);

    it('sets active = false and emits AgentDeactivated', async function () {
      await registerTestAgent('deact-01');
      await expect(registry.deactivateAgent('deact-01'))
        .to.emit(registry, 'AgentDeactivated')
        .withArgs('deact-01');
      expect((await registry.getAgent('deact-01')).active).to.be.false;
    });

    it('reverts if called by non-owner', async function () {
      await registerTestAgent('deact-02');
      await expect(
        registry.connect(addr1).deactivateAgent('deact-02'),
      ).to.be.revertedWith('AgentRegistry: not owner');
    });
  });

  // ── 7. View functions ───────────────────────────────────────────
  describe('View functions', function () {
    beforeEach(deployRegistry);

    it('getAgent returns full struct', async function () {
      const hash = cfgHash('{"strategy":"RSI_SWING"}');
      await registry.registerAgent('view-01', hash, '0.0.111', '0.0.222', 'SWING');
      const a = await registry.getAgent('view-01');
      expect(a.agentId).to.equal('view-01');
      expect(a.hcsTopicId).to.equal('0.0.111');
      expect(a.hfsConfigId).to.equal('0.0.222');
      expect(a.strategyType).to.equal('SWING');
      expect(a.configHash).to.equal(hash);
    });

    it('getAgentsByOwner returns empty array for unknown address', async function () {
      const ids = await registry.getAgentsByOwner(await addr1.getAddress());
      expect(ids).to.have.lengthOf(0);
    });

    it('getAgentsByOwner returns all ids after multiple registrations', async function () {
      await registerTestAgent('multi-01');
      await registerTestAgent('multi-02');
      await registerTestAgent('multi-03');
      const ids = await registry.getAgentsByOwner(await owner.getAddress());
      expect(ids.length).to.be.at.least(3);
      expect(ids).to.include('multi-01');
      expect(ids).to.include('multi-02');
      expect(ids).to.include('multi-03');
    });
  });

  // ── 8. HCS Write-Before-Trade Invariant ─────────────────────────
  describe('HCS Write-Before-Trade Invariant', function () {
    beforeEach(deployRegistry);

    /**
     * Core TradeAgent invariant:
     * configHash stored on HSCS MUST match keccak256(agentConfigJSON from HFS).
     * Any tampered config is PROVABLY detectable on-chain — no trust required.
     */
    it('original hash passes, tampered hash fails — detectable without trust', async function () {
      const original = JSON.stringify({ strategy: 'TREND_FOLLOW', rsi: 55, exit: 0.02 });
      const tampered = JSON.stringify({ strategy: 'TREND_FOLLOW', rsi: 40, exit: 0.10 });
      const origHash = cfgHash(original);
      const tampHash = cfgHash(tampered);

      await registry.registerAgent('invariant-01', origHash, '0.0.1', '0.0.2', 'TREND_FOLLOW');

      expect(await registry.verifyConfigHash('invariant-01', origHash)).to.be.true;
      expect(await registry.verifyConfigHash('invariant-01', tampHash)).to.be.false;
    });

    it('deactivated agent cannot log new signals', async function () {
      await registerTestAgent('guard-01');
      await registry.deactivateAgent('guard-01');
      await expect(registry.logExecution('guard-01', 'BUY', 100))
        .to.be.revertedWith('AgentRegistry: agent inactive');
    });

    it('non-owner cannot log signals (access control)', async function () {
      await registerTestAgent('guard-02');
      await expect(registry.connect(addr1).logExecution('guard-02', 'BUY', 100))
        .to.be.revertedWith('AgentRegistry: not owner');
    });
  });
});
