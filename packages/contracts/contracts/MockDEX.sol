// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IExchangeRate {
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256);
    function tinybarsToTinycents(uint256 tinybars) external returns (uint256);
}

/**
 * @title MockDEX
 * @notice Simulates SaucerSwap V2 AMM behavior on Hedera testnet.
 *
 * WHY THIS EXISTS:
 * SaucerSwap has no testnet deployment - no liquidity pools exist on testnet.
 * This contract provides equivalent AMM math (x*y=k constant product formula)
 * so TradeAgent can execute full end-to-end trades on testnet using faucet HBAR.
 *
 * KEY FEATURE: Every swap stores the HCS sequence number that triggered it.
 * This links the on-chain swap back to the aBFT-timestamped HCS decision -
 * making the proof chain fully visible on HashScan.
 *
 * MAINNET: Replace executeSwap() call with hak-saucerswap-plugin v1.0.1.
 * The HCS logging before/after stays identical.
 */
contract MockDEX {
    // Hedera-specific precompile addresses
    // Exchange Rate Precompile: converts HBAR <-> USD on-chain
    // This is a Hedera-EXCLUSIVE feature - not available on Ethereum
    address constant EXCHANGE_RATE_PRECOMPILE = 0x0000000000000000000000000000000000000168;

    // Pool state
    // Simulated liquidity reserves (x*y=k constant product)
    uint256 public reserveHBAR = 1_000_000 * 1e8; // 1M HBAR in tinybars
    uint256 public reserveUSDC = 85_000 * 1e6; // 85K USDC ($0.085/HBAR)
    uint256 public constant FEE_BPS = 30; // 0.3% fee = SaucerSwap V2
    uint256 public constant MAX_SLIPPAGE_BPS = 100; // 1% max slippage

    address public owner;

    // Swap record - links HCS decision to on-chain trade
    struct SwapRecord {
        address trader;
        string agentId;
        string direction; // "HBAR_TO_USDC" or "USDC_TO_HBAR"
        uint256 amountIn;
        uint256 amountOut;
        uint256 priceUSDCents; // HBAR price when swap executed
        uint256 slippageBps;
        uint256 timestamp;
        string hcsSequenceNum; // HCS seq# of the decision that triggered this
        string hcsTopicId; // HCS topic ID for verification
    }

    // Storage
    SwapRecord[] public allSwaps;
    mapping(string => SwapRecord[]) public agentSwapHistory;
    mapping(string => uint256) public agentTradeCount;

    // Events - Mirror Node indexes these
    event SwapExecuted(
        string indexed agentId,
        string direction,
        uint256 amountIn,
        uint256 amountOut,
        uint256 slippageBps,
        string hcsSequenceNum, // links to HCS decision proof
        string hcsTopicId,
        uint256 timestamp
    );

    event QuoteGenerated(
        string agentId,
        string direction,
        uint256 amountIn,
        uint256 expectedOut,
        uint256 priceImpactBps
    );

    event ReservesRefreshed(uint256 newHBAR, uint256 newUSDC, uint256 timestamp);

    // Constructor
    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Core AMM Math (x*y=k constant product formula)
    /**
     * @notice Get a swap quote - identical math to SaucerSwap V2
     * @param direction "HBAR_TO_USDC" or "USDC_TO_HBAR"
     * @param amountIn Amount to swap (tinybars for HBAR, micro-USDC for USDC)
     */
    function getSwapQuote(
        string memory direction,
        uint256 amountIn
    ) public view returns (
        uint256 amountOut,
        uint256 priceImpactBps,
        uint256 slippageBps
    ) {
        require(amountIn > 0, "Amount must be > 0");

        // Apply 0.3% fee before calculating output (same as SaucerSwap)
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
        bytes32 dirHash = keccak256(bytes(direction));

        if (dirHash == keccak256(bytes("HBAR_TO_USDC"))) {
            // x*y=k: new_y = k / (x + dx)
            // amountOut = reserveUSDC - k/(reserveHBAR + amountIn)
            amountOut = (reserveUSDC * amountInWithFee) / (reserveHBAR + amountInWithFee);
            // Price impact: how much % of the pool we are consuming
            priceImpactBps = (amountIn * 10000) / reserveHBAR;
        } else if (dirHash == keccak256(bytes("USDC_TO_HBAR"))) {
            amountOut = (reserveHBAR * amountInWithFee) / (reserveUSDC + amountInWithFee);
            priceImpactBps = (amountIn * 10000) / reserveUSDC;
        } else {
            revert("Invalid direction: use HBAR_TO_USDC or USDC_TO_HBAR");
        }

        // Approximate slippage as half of price impact
        slippageBps = priceImpactBps / 2;
    }

    // Execute Swap
    /**
     * @notice Execute a swap - MUST be called AFTER HCS decision is logged.
     *
     * @param agentId The TradeAgent agent identifier
     * @param direction "HBAR_TO_USDC" or "USDC_TO_HBAR"
     * @param amountIn Amount to swap in smallest units
     * @param minAmountOut Minimum output (slippage protection)
     * @param hcsSequenceNum HCS message sequence number of the triggering decision
     * @param hcsTopicId HCS topic ID for cross-reference
     *
     * The hcsSequenceNum parameter is critical - it links this on-chain swap
     * to the aBFT-timestamped HCS decision. Anyone can verify on HashScan:
     * 1. Find the HCS message with this sequence number
     * 2. See it was timestamped BEFORE this transaction
     * 3. Confirm the decision preceded the trade
     */
    function executeSwap(
        string memory agentId,
        string memory direction,
        uint256 amountIn,
        uint256 minAmountOut,
        string memory hcsSequenceNum,
        string memory hcsTopicId
    ) external returns (uint256 amountOut) {
        // Get quote and validate
        (uint256 expectedOut, uint256 priceImpactBps, uint256 slippageBps) = getSwapQuote(direction, amountIn);
        
        require(expectedOut >= minAmountOut, string.concat(
            "Slippage exceeded. Expected: ", toString(expectedOut), " Got min: ", toString(minAmountOut)
        ));
        require(slippageBps <= MAX_SLIPPAGE_BPS, "Price impact > 1% - trade rejected for safety");
        
        amountOut = expectedOut;

        // Update simulated pool reserves (x*y=k)
        bytes32 dirHash = keccak256(bytes(direction));
        if (dirHash == keccak256(bytes("HBAR_TO_USDC"))) {
            reserveHBAR += amountIn;
            reserveUSDC -= amountOut;
        } else {
            reserveUSDC += amountIn;
            reserveHBAR -= amountOut;
        }

        // Get current HBAR price using Hedera Exchange Rate Precompile
        // This is HEDERA-EXCLUSIVE - not available on any other EVM chain
        uint256 hbarPriceUsdCents = 0;
        try IExchangeRate(EXCHANGE_RATE_PRECOMPILE).tinybarsToTinycents(100_000_000) returns (uint256 cents) {
            hbarPriceUsdCents = cents; // USD cents per 1 HBAR
        } catch {
            hbarPriceUsdCents = 8; // Fallback: $0.08/HBAR
        }

        // Record the swap WITH the HCS link - this is the key connection
        SwapRecord memory record = SwapRecord({
            trader: msg.sender,
            agentId: agentId,
            direction: direction,
            amountIn: amountIn,
            amountOut: amountOut,
            priceUSDCents: hbarPriceUsdCents,
            slippageBps: slippageBps,
            timestamp: block.timestamp,
            hcsSequenceNum: hcsSequenceNum, // links to HCS
            hcsTopicId: hcsTopicId
        });

        allSwaps.push(record);
        agentSwapHistory[agentId].push(record);
        agentTradeCount[agentId]++;

        // Emit event - Mirror Node indexes this for dashboard
        emit SwapExecuted(
            agentId, direction, amountIn, amountOut,
            slippageBps, hcsSequenceNum, hcsTopicId, block.timestamp
        );

        return amountOut;
    }

    // Read Functions (free - no gas)
    function getAgentSwaps(string memory agentId) external view returns (SwapRecord[] memory) {
        return agentSwapHistory[agentId];
    }

    function getTotalSwapCount() external view returns (uint256) {
        return allSwaps.length;
    }

    function getPoolState() external view returns (uint256 hbar, uint256 usdc, uint256 spotPrice) {
        hbar = reserveHBAR;
        usdc = reserveUSDC;
        // Spot price: USDC per HBAR (in micro-USDC per tinybar)
        spotPrice = reserveUSDC * 1e8 / reserveHBAR;
    }

    // Admin Functions
    // Refresh pool reserves to simulate realistic market conditions
    // Call this periodically to keep the simulated price realistic
    function refreshReserves(uint256 newHBARReserve, uint256 newUSDCReserve) external onlyOwner {
        require(newHBARReserve > 0 && newUSDCReserve > 0, "Invalid reserves");
        reserveHBAR = newHBARReserve;
        reserveUSDC = newUSDCReserve;
        emit ReservesRefreshed(newHBARReserve, newUSDCReserve, block.timestamp);
    }

    // Helper for string conversion in error messages
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
