// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ── Hedera-Exclusive Precompile Interfaces ───────────────────────
// These precompiles do NOT exist on Ethereum — they are Hedera-only.

/// @notice Exchange Rate Precompile (0x168)
/// Converts USD cents to tinybars using Hedera's live exchange rate.
/// No external oracle needed — the network handles it on-chain.
interface IExchangeRate {
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256);
    function tinybarsToTinycents(uint256 tinybars) external returns (uint256);
}

/// @title AgentRegistry
/// @notice On-chain registry for TradeAgent AI trading agents.
/// @dev Deployed natively via ContractCreateTransaction (not eth_sendRawTransaction).
///      Each agent links to:
///        - An HCS topic (aBFT audit trail of every decision)
///        - An HFS file (full AgentConfig JSON on-chain)
///        - An optional HTS NFT serial (marketplace listing)
contract AgentRegistry is Ownable, ReentrancyGuard {

    // ── Hedera-Exclusive Precompile Addresses ────────────────────
    address constant EXCHANGE_RATE = 0x0000000000000000000000000000000000000168;
    address constant PSEUDO_RANDOM  = 0x0000000000000000000000000000000000000169;

    // ── Agent Struct ─────────────────────────────────────────────
    struct Agent {
        string  agentId;        // UUID v4 generated off-chain
        address owner;          // Wallet address that deployed this agent
        bytes32 configHash;     // keccak256 of strategy JSON — immutable proof
        string  hcsTopicId;     // e.g. "0.0.4823901" — aBFT audit trail
        string  hfsConfigId;    // e.g. "0.0.9876" — full config on HFS
        string  strategyType;   // TREND_FOLLOW | MEAN_REVERT | BREAKOUT | MOMENTUM | SWING | CUSTOM
        uint256 deployedAt;     // block.timestamp at registration
        bool    active;         // can be deactivated by owner
        uint256 serialNumber;   // HTS NFT serial (0 = not listed on marketplace)
        uint256 priceUSD;       // listing price in USD cents (e.g. 2000 = $20.00)
    }

    // ── Storage ──────────────────────────────────────────────────
    mapping(string => Agent)      public agents;
    mapping(address => string[])  public ownerAgents;
    string[]                      public allAgentIds;
    string[]                      public listedAgentIds;

    // ── Events ───────────────────────────────────────────────────
    event AgentRegistered(
        string indexed agentId,
        address indexed owner,
        string hcsTopicId,
        string hfsConfigId,
        string strategyType
    );

    event AgentListed(
        string indexed agentId,
        uint256 serialNumber,
        uint256 priceUSD
    );

    event AgentExecutionLogged(
        string indexed agentId,
        string signal,       // BUY | SELL | HOLD
        uint256 price,       // price in tinybars
        uint256 timestamp    // block.timestamp
    );

    event AgentDeactivated(string indexed agentId);

    // ── Constructor ──────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ── Core Functions ───────────────────────────────────────────

    /// @notice Registers a new AI trading agent on-chain.
    /// @dev Stores the configHash (keccak256) linking off-chain config to this record.
    ///      The HCS topic ID provides the aBFT audit trail.
    ///      The HFS config ID provides full on-chain config verifiability.
    function registerAgent(
        string memory agentId,
        bytes32 configHash,
        string memory hcsTopicId,
        string memory hfsConfigId,
        string memory strategyType
    ) external nonReentrant {
        require(agents[agentId].deployedAt == 0, "AgentRegistry: already registered");
        require(bytes(agentId).length > 0,       "AgentRegistry: empty agentId");
        require(bytes(hcsTopicId).length > 0,    "AgentRegistry: empty hcsTopicId");
        require(bytes(hfsConfigId).length > 0,   "AgentRegistry: empty hfsConfigId");

        agents[agentId] = Agent({
            agentId:      agentId,
            owner:        msg.sender,
            configHash:   configHash,
            hcsTopicId:   hcsTopicId,
            hfsConfigId:  hfsConfigId,
            strategyType: strategyType,
            deployedAt:   block.timestamp,
            active:       true,
            serialNumber: 0,
            priceUSD:     0
        });

        ownerAgents[msg.sender].push(agentId);
        allAgentIds.push(agentId);

        emit AgentRegistered(agentId, msg.sender, hcsTopicId, hfsConfigId, strategyType);
    }

    /// @notice Logs a trading execution signal on-chain.
    /// @dev Called AFTER HCS write — both provide the audit trail.
    ///      Mirror Node indexes AgentExecutionLogged for leaderboard queries.
    function logExecution(
        string memory agentId,
        string memory signal,
        uint256 price
    ) external {
        require(agents[agentId].owner == msg.sender, "AgentRegistry: not owner");
        require(agents[agentId].active,              "AgentRegistry: agent inactive");

        emit AgentExecutionLogged(agentId, signal, price, block.timestamp);
    }

    /// @notice Lists an agent on the marketplace.
    /// @dev Sets serialNumber (HTS NFT) and price. Emits AgentListed.
    function listOnMarketplace(
        string memory agentId,
        uint256 serialNumber,
        uint256 priceUSD
    ) external nonReentrant {
        require(agents[agentId].owner == msg.sender, "AgentRegistry: not owner");
        require(agents[agentId].active,              "AgentRegistry: agent inactive");
        require(priceUSD > 0,                        "AgentRegistry: price must be > 0");

        agents[agentId].serialNumber = serialNumber;
        agents[agentId].priceUSD    = priceUSD;

        listedAgentIds.push(agentId);

        emit AgentListed(agentId, serialNumber, priceUSD);
    }

    /// @notice Deactivates an agent (owner only).
    function deactivateAgent(string memory agentId) external {
        require(agents[agentId].owner == msg.sender, "AgentRegistry: not owner");
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    // ── Hedera-Exclusive: Exchange Rate Precompile ───────────────

    /// @notice Gets listing price in tinybars using live HBAR/USD exchange rate.
    /// @dev This is HEDERA-EXCLUSIVE — uses Exchange Rate Precompile 0x168.
    ///      No external oracle needed. The network handles conversion on-chain.
    ///      Not possible on Ethereum or any EVM chain.
    function getPriceInHbar(string memory agentId) external returns (uint256 tinybars) {
        uint256 usdCents = agents[agentId].priceUSD;
        require(usdCents > 0, "AgentRegistry: agent not listed");
        tinybars = IExchangeRate(EXCHANGE_RATE).tinycentsToTinybars(usdCents);
    }

    // ── View Functions ───────────────────────────────────────────

    /// @notice Verifies that an agent config has not been tampered with.
    /// @dev Anyone can call keccak256(agentConfigJSON) and verify it matches.
    function verifyConfigHash(string memory agentId, bytes32 hash) external view returns (bool) {
        return agents[agentId].configHash == hash;
    }

    /// @notice Returns all agent IDs owned by a wallet address.
    function getAgentsByOwner(address owner) external view returns (string[] memory) {
        return ownerAgents[owner];
    }

    /// @notice Returns total count of all registered agents.
    function getTotalAgents() external view returns (uint256) {
        return allAgentIds.length;
    }

    /// @notice Returns total count of all marketplace listings.
    function getTotalListings() external view returns (uint256) {
        return listedAgentIds.length;
    }

    /// @notice Returns full agent struct.
    function getAgent(string memory agentId) external view returns (Agent memory) {
        return agents[agentId];
    }
}
