// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── Hedera System Contract Interfaces ────────────────────────────
// HTS Precompile — native token operations on Hedera
// This is Hedera-EXCLUSIVE. Not available on any other EVM chain.
interface IHederaTokenService {
    function transferToken(
        address token,
        address sender,
        address receiver,
        int64 amount
    ) external returns (int64 responseCode);

    function associateToken(
        address account,
        address token
    ) external returns (int64 responseCode);
}

// Exchange Rate Precompile — HBAR ↔ USD on-chain (Hedera-exclusive)
interface IExchangeRate {
    function tinybarsToTinycents(uint256 tinybars)
        external returns (uint256);
    function tinycentsToTinybars(uint256 tinycents)
        external returns (uint256);
}

/**
 * @title MockDEX — Real Token Swap on Hedera Testnet
 *
 * REAL BEHAVIOR:
 *   SELL (HBAR_TO_USDC):
 *     - Caller sends real HBAR (msg.value)
 *     - Contract sends real tUSDC to caller via HTS precompile
 *     - Caller's HBAR balance decreases
 *     - Caller's tUSDC balance increases
 *
 *   BUY (USDC_TO_HBAR):
 *     - Caller grants allowance, contract pulls tUSDC via HTS
 *     - Contract sends real HBAR to caller
 *     - Caller's tUSDC balance decreases
 *     - Caller's HBAR balance increases
 *
 * Single unified executeSwap() entry point embeds HCS sequence number
 * for tamper-proof proof chain: AI decision → HCS → on-chain swap.
 */
contract MockDEX {

    // ── Hedera Precompile Addresses ───────────────────────────────
    address constant HTS_PRECOMPILE =
        0x0000000000000000000000000000000000000167;
    address constant EXCHANGE_RATE_PRECOMPILE =
        0x0000000000000000000000000000000000000168;

    // ── State ─────────────────────────────────────────────────────
    address public owner;
    address public tUSDCTokenAddress;   // HTS fungible token address

    // Simulated pool reserves for AMM price calculation (x*y=k)
    uint256 public reserveHBAR = 1_000_000 * 1e8;  // 1M HBAR in tinybars
    uint256 public reserveUSDC = 85_000 * 1e6;      // 85K USDC in micro-USDC
    uint256 public constant FEE_BPS = 30;            // 0.3% swap fee

    // Swap record — links every trade to its HCS decision
    struct SwapRecord {
        address trader;
        string  agentId;
        string  direction;
        uint256 amountIn;
        uint256 amountOut;
        uint256 hbarPriceUSDCents;
        uint256 slippageBps;
        uint256 timestamp;
        string  hcsSequenceNum;   // ← Links to aBFT-timestamped HCS decision
        string  hcsTopicId;
    }

    mapping(string => SwapRecord[]) public agentSwaps;
    SwapRecord[] public allSwaps;

    // ── Events — indexed by Mirror Node ──────────────────────────
    event SwapExecuted(
        string  indexed agentId,
        string  direction,
        uint256 hbarAmount,
        uint256 usdcAmount,
        uint256 slippageBps,
        string  hcsSequenceNum,
        string  hcsTopicId,
        address trader,
        uint256 timestamp
    );

    event ReservesRefreshed(uint256 hbar, uint256 usdc, uint256 price);

    // ── Constructor ───────────────────────────────────────────────
    constructor(address _tUSDCAddress) {
        owner = msg.sender;
        tUSDCTokenAddress = _tUSDCAddress;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Contract must be able to receive HBAR
    receive() external payable {}
    fallback() external payable {}

    // ── AMM Quote (x*y=k constant product) ───────────────────────
    /**
     * @notice Returns expected output, price impact, and slippage for a swap.
     * @dev Read-only — safe to call via ethers.JsonRpcProvider without signing.
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

        uint256 amountInFee = amountIn * (10000 - FEE_BPS) / 10000;
        bytes32 dir = keccak256(bytes(direction));

        if (dir == keccak256(bytes("HBAR_TO_USDC"))) {
            amountOut      = (reserveUSDC * amountInFee) / (reserveHBAR + amountInFee);
            priceImpactBps = (amountIn * 10000) / reserveHBAR;
        } else if (dir == keccak256(bytes("USDC_TO_HBAR"))) {
            amountOut      = (reserveHBAR * amountInFee) / (reserveUSDC + amountInFee);
            priceImpactBps = (amountIn * 10000) / reserveUSDC;
        } else {
            revert("Invalid direction: use HBAR_TO_USDC or USDC_TO_HBAR");
        }

        slippageBps = priceImpactBps / 2;
    }

    // ── Unified Swap Entry Point ──────────────────────────────────
    /**
     * @notice Execute a swap. Real HTS token transfers on both directions.
     *
     * HBAR_TO_USDC (SELL):
     *   - Send HBAR as msg.value; receives tUSDC via HTS precompile.
     *   - amountIn is IGNORED — msg.value is used instead.
     *
     * USDC_TO_HBAR (BUY):
     *   - Grant allowance first via AccountAllowanceApproveTransaction.
     *   - amountIn = tUSDC amount in micro-USDC (6 decimals).
     *   - Receives HBAR via direct transfer.
     *
     * @param agentId       UUID of the trading agent
     * @param direction     "HBAR_TO_USDC" or "USDC_TO_HBAR"
     * @param amountIn      For USDC_TO_HBAR: micro-USDC to spend. For HBAR_TO_USDC: ignored (use msg.value).
     * @param minAmountOut  Minimum output; reverts if slippage exceeded
     * @param hcsSeq        HCS sequence number of AI decision (proof chain)
     * @param topicId       HCS topic ID
     */
    function executeSwap(
        string memory agentId,
        string memory direction,
        uint256 amountIn,
        uint256 minAmountOut,
        string memory hcsSeq,
        string memory topicId
    ) external payable returns (uint256 amountOut) {
        bytes32 dir = keccak256(bytes(direction));

        if (dir == keccak256(bytes("HBAR_TO_USDC"))) {
            amountOut = _sellHBARforUSDC(agentId, minAmountOut, hcsSeq, topicId);
        } else if (dir == keccak256(bytes("USDC_TO_HBAR"))) {
            require(amountIn > 0, "amountIn must be > 0 for USDC_TO_HBAR");
            amountOut = _buyHBARwithUSDC(agentId, amountIn, minAmountOut, hcsSeq, topicId);
        } else {
            revert("Invalid direction: use HBAR_TO_USDC or USDC_TO_HBAR");
        }
    }

    // ── SELL: HBAR → tUSDC ────────────────────────────────────────
    function _sellHBARforUSDC(
        string memory agentId,
        uint256 minUSDCOut,
        string memory hcsSeq,
        string memory topicId
    ) internal returns (uint256 usdcOut) {
        uint256 hbarIn = msg.value;
        require(hbarIn > 0, "Must send HBAR as msg.value");

        (uint256 expectedOut, , uint256 slippageBps) = getSwapQuote("HBAR_TO_USDC", hbarIn);
        require(expectedOut >= minUSDCOut, "Slippage exceeded");
        require(slippageBps <= 200, "Price impact > 2%");

        usdcOut = expectedOut;

        // Update pool reserves
        reserveHBAR += hbarIn;
        reserveUSDC -= usdcOut;

        // ── Transfer real tUSDC to caller via HTS Precompile ─────
        _htsTransfer(tUSDCTokenAddress, address(this), msg.sender, int64(uint64(usdcOut)));

        uint256 price = _getHBARPriceUSDCents();
        _recordSwap(agentId, "HBAR_TO_USDC", hbarIn, usdcOut, price, slippageBps, hcsSeq, topicId);
    }

    // ── BUY: tUSDC → HBAR ─────────────────────────────────────────
    function _buyHBARwithUSDC(
        string memory agentId,
        uint256 usdcIn,
        uint256 minHBAROut,
        string memory hcsSeq,
        string memory topicId
    ) internal returns (uint256 hbarOut) {
        (uint256 expectedOut, , uint256 slippageBps) = getSwapQuote("USDC_TO_HBAR", usdcIn);
        require(expectedOut >= minHBAROut, "Slippage exceeded");
        require(slippageBps <= 200, "Price impact > 2%");
        require(address(this).balance >= expectedOut, "Insufficient DEX HBAR");

        hbarOut = expectedOut;

        // ── Pull tUSDC from caller via HTS Precompile ────────────
        // Caller must have called AccountAllowanceApproveTransaction first
        _htsTransfer(tUSDCTokenAddress, msg.sender, address(this), int64(uint64(usdcIn)));

        // Update pool reserves
        reserveUSDC += usdcIn;
        reserveHBAR -= hbarOut;

        // ── Send real HBAR to caller ──────────────────────────────
        (bool sent, ) = payable(msg.sender).call{value: hbarOut}("");
        require(sent, "HBAR transfer failed");

        uint256 price = _getHBARPriceUSDCents();
        _recordSwap(agentId, "USDC_TO_HBAR", usdcIn, hbarOut, price, slippageBps, hcsSeq, topicId);
    }

    // ── Internal helpers ──────────────────────────────────────────

    function _htsTransfer(
        address token,
        address from,
        address to,
        int64 amount
    ) internal {
        // Always call the HTS precompile directly — on Hedera testnet/mainnet,
        // extcodesize(0x167) returns 0 because system contracts are native node
        // handlers, not deployed EVM bytecode. The old extcodesize guard was
        // silently skipping all token transfers on-chain.
        int64 code = IHederaTokenService(HTS_PRECOMPILE).transferToken(token, from, to, amount);
        require(code == 22, "HTS transfer failed");
    }

    function _getHBARPriceUSDCents() internal returns (uint256 price) {
        price = 8; // fallback: $0.08
        (bool ok, bytes memory result) = EXCHANGE_RATE_PRECOMPILE.call(
            abi.encodeWithSelector(IExchangeRate.tinybarsToTinycents.selector, 100_000_000)
        );
        if (ok && result.length > 0) {
            price = abi.decode(result, (uint256));
        }
    }

    function _recordSwap(
        string memory agentId,
        string memory direction,
        uint256 amountIn,
        uint256 amountOut,
        uint256 price,
        uint256 slippage,
        string memory hcsSeq,
        string memory topicId
    ) internal {
        SwapRecord memory rec = SwapRecord({
            trader:            msg.sender,
            agentId:           agentId,
            direction:         direction,
            amountIn:          amountIn,
            amountOut:         amountOut,
            hbarPriceUSDCents: price,
            slippageBps:       slippage,
            timestamp:         block.timestamp,
            hcsSequenceNum:    hcsSeq,
            hcsTopicId:        topicId
        });
        agentSwaps[agentId].push(rec);
        allSwaps.push(rec);

        emit SwapExecuted(
            agentId, direction, amountIn, amountOut,
            slippage, hcsSeq, topicId, msg.sender, block.timestamp
        );
    }

    // ── Read Functions ────────────────────────────────────────────

    function getAgentSwaps(string memory agentId)
        external view returns (SwapRecord[] memory) {
        return agentSwaps[agentId];
    }

    function getTotalSwapCount() external view returns (uint256) {
        return allSwaps.length;
    }

    function getPoolState() external view returns (
        uint256 hbar, uint256 usdc, uint256 spotPrice
    ) {
        hbar      = reserveHBAR;
        usdc      = reserveUSDC;
        // micro-USDC per tinybar: spot price in contract units
        spotPrice = (reserveUSDC * 1e8) / reserveHBAR;
    }

    // ── Admin ─────────────────────────────────────────────────────

    function fundWithHBAR() external payable onlyOwner {}

    /**
     * @notice Associate this contract with the tUSDC token (run once after deploy).
     */
    function associateTUSDC() external onlyOwner {
        uint256 codeSize;
        address precompile = HTS_PRECOMPILE;
        assembly { codeSize := extcodesize(precompile) }
        if (codeSize > 0) {
            IHederaTokenService(HTS_PRECOMPILE).associateToken(address(this), tUSDCTokenAddress);
        }
    }

    /**
     * @notice Refresh reserves to match current market price.
     * Call from operator after fetching Pyth/SaucerSwap price.
     */
    function refreshReserves(
        uint256 newHBAR,
        uint256 newUSDC
    ) external onlyOwner {
        reserveHBAR = newHBAR;
        reserveUSDC = newUSDC;
        uint256 price = (newUSDC * 1e8) / newHBAR;
        emit ReservesRefreshed(newHBAR, newUSDC, price);
    }
}
