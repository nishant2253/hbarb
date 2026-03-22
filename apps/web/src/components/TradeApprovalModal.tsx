'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
import { ZapIcon, XIcon, Loader2, ArrowRightIcon, ShieldCheckIcon, ArrowDownIcon } from 'lucide-react';
import {
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  AccountAllowanceApproveTransaction,
  AccountId,
  TokenId,
  Hbar,
} from '@hashgraph/sdk';
import { useWalletStore } from '@/stores/walletStore';
import { fetchBalances } from '@/lib/balance';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';
const HASHIO   = `https://${NETWORK}.hashio.io/api`;

// Read-only ABI — used for getSwapQuote via JsonRpcProvider (no signing)
const QUOTE_ABI = [
  "function getSwapQuote(string direction, uint256 amountIn) view returns (uint256 amountOut, uint256 priceImpactBps, uint256 slippageBps)",
];

interface SwapQuote {
  amountOut:      bigint;
  priceImpactBps: number;
  slippageBps:    number;
}

interface TradeApprovalProps {
  signal:         'BUY' | 'SELL';
  agentId:        string;
  agentName?:     string;
  hcsTopicId:     string;
  hcsSequenceNum: string;
  amount:         bigint;   // tinybars for SELL, micro-USDC for BUY
  price:          number;
  confidence:     number;
  onApprove:      () => void;
  onReject:       () => void;
}

export function TradeApprovalModal({
  signal, agentId, agentName, hcsTopicId, hcsSequenceNum,
  amount, price, confidence, onApprove, onReject
}: TradeApprovalProps) {
  const { signer, accountId, setBalances } = useWalletStore();
  const [executing, setExecuting]     = useState(false);
  const [txHash, setTxHash]           = useState<string | null>(null);
  const [quote, setQuote]             = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  // BUY needs two steps: allowance then swap
  const [buyStep, setBuyStep]         = useState<'allowance' | 'swap'>('allowance');

  const mockDexAddr       = process.env.NEXT_PUBLIC_MOCK_DEX_ADDRESS!;
  const mockDexContractId = process.env.NEXT_PUBLIC_MOCK_DEX_CONTRACT_ID!;
  const tUSDCTokenId      = process.env.NEXT_PUBLIC_TEST_USDT_TOKEN_ID!;
  const direction         = signal === 'SELL' ? 'HBAR_TO_USDC' : 'USDC_TO_HBAR';

  // ── Fetch live quote on mount ──────────────────────────────────
  useEffect(() => {
    async function loadQuote() {
      setQuoteLoading(true);
      try {
        const provider  = new ethers.JsonRpcProvider(HASHIO);
        const mockDexRO = new ethers.Contract(mockDexAddr, QUOTE_ABI, provider);
        const [amountOut, priceBps, slippageBps] = await mockDexRO.getSwapQuote(direction, amount);
        setQuote({
          amountOut:      BigInt(amountOut.toString()),
          priceImpactBps: Number(priceBps),
          slippageBps:    Number(slippageBps),
        });
      } catch (err) {
        console.warn('[TradeApproval] Quote failed:', err);
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    }
    if (mockDexAddr && amount > 0n) loadQuote();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockDexAddr, direction, amount.toString()]);

  // ── Step 1 for BUY: grant tUSDC allowance to MockDEX ──────────
  async function grantAllowance() {
    if (!signer || !accountId || !tUSDCTokenId || !mockDexContractId) {
      alert('Wallet not connected or env vars missing');
      return;
    }
    setExecuting(true);
    try {
      // Approve MockDEX (as an account ID on Hedera) to spend tUSDC
      const spenderAccountId = AccountId.fromString(mockDexContractId);
      const allowanceTx = await new AccountAllowanceApproveTransaction()
        .addTokenAllowance(
          TokenId.fromString(tUSDCTokenId),
          spenderAccountId,
          Number(amount),   // micro-USDC
        )
        .setMaxTransactionFee(new Hbar(2))
        .freezeWithSigner(signer);

      const allowanceResp = await allowanceTx.executeWithSigner(signer);
      await allowanceResp.getReceiptWithSigner(signer);
      setBuyStep('swap');
    } catch (err: any) {
      console.error('Allowance failed:', err);
      if (err?.message?.includes('rejected') || err?.message?.includes('User rejected')) {
        alert('Allowance rejected in wallet.');
      } else {
        alert(`Allowance failed: ${err.message}`);
      }
    } finally {
      setExecuting(false);
    }
  }

  // ── Execute the actual swap ─────────────────────────────────────
  async function executeSwap() {
    if (!signer || !accountId) {
      alert('Wallet not connected!');
      return;
    }
    setExecuting(true);
    try {
      const slippageMin = quote
        ? (quote.amountOut * 995n) / 1000n
        : 0n;

      const contractId = ContractId.fromEvmAddress(0, 0, mockDexAddr);
      const fnParams   = new ContractFunctionParameters()
        .addString(agentId)
        .addString(direction)
        .addUint256(amount.toString())
        .addUint256(slippageMin.toString())
        .addString(hcsSequenceNum)
        .addString(hcsTopicId);

      let contractTx = new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(800000)
        .setFunction('executeSwap', fnParams)
        .setMaxTransactionFee(new Hbar(5));

      // SELL: attach HBAR value so MockDEX can do real token transfer
      if (signal === 'SELL') {
        const hbarAmount = Number(amount) / 1e8;
        contractTx = contractTx.setPayableAmount(
          Hbar.fromTinybars(Math.round(Number(amount)))
        );
        console.log(`[TradeApproval] SELL: sending ${hbarAmount.toFixed(4)} HBAR with tx`);
      }

      const frozenTx = await contractTx.freezeWithSigner(signer);
      const response = await frozenTx.executeWithSigner(signer);
      await response.getReceiptWithSigner(signer);

      const txIdStr = response.transactionId?.toString() ?? '';
      setTxHash(txIdStr);

      // Audit log (fire-and-forget)
      fetch(`${API_URL}/api/transactions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ownerId:     accountId,
          agentId,
          type:        'TRADE_SWAP',
          txId:        txIdStr,
          status:      'SUCCESS',
          details:     {
            agentName: agentName ?? agentId,
            signal,
            price,
            confidence,
            hcsSequenceNum,
            direction,
            amountOut: quote?.amountOut.toString(),
          },
          hashscanUrl: `https://hashscan.io/${NETWORK}/transaction/${txIdStr}`,
        }),
      }).catch(() => {});

      // Refresh balances — real tokens moved now
      const b = await fetchBalances(accountId);
      setBalances(b.hbar, b.tusdt);

      setTimeout(() => onApprove(), 3000);
    } catch (err: any) {
      console.error('Swap failed:', err);
      if (err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
        alert('Swap cancelled: Transaction rejected in wallet.');
      } else {
        alert(`Swap failed: ${err.message}`);
      }
      onReject();
    } finally {
      setExecuting(false);
    }
  }

  function handleApprove() {
    if (signal === 'BUY' && buyStep === 'allowance') {
      grantAllowance();
    } else {
      executeSwap();
    }
  }

  // ── Display helpers ────────────────────────────────────────────
  const sendLabel = signal === 'SELL'
    ? `${(Number(amount) / 1e8).toFixed(4)} HBAR`
    : `${(Number(amount) / 1e6).toFixed(2)} tUSDC`;

  const receiveLabel = quoteLoading
    ? '...'
    : quote
      ? signal === 'SELL'
        ? `~${(Number(quote.amountOut) / 1e6).toFixed(4)} tUSDC`
        : `~${(Number(quote.amountOut) / 1e8).toFixed(4)} HBAR`
      : 'Quote unavailable';

  const pricePerHbar = quoteLoading || !quote
    ? `$${price.toFixed(4)}`
    : signal === 'SELL'
      ? `$${(Number(quote.amountOut) / 1e6 / (Number(amount) / 1e8)).toFixed(4)}/HBAR`
      : `$${((Number(amount) / 1e6) / (Number(quote.amountOut) / 1e8)).toFixed(4)}/HBAR`;

  const approveLabel = () => {
    if (executing) return <><Loader2 size={16} className="animate-spin" /> {signal === 'BUY' && buyStep === 'allowance' ? 'Approving Allowance...' : 'Executing Swap...'}</>;
    if (signal === 'BUY' && buyStep === 'allowance') return <>Step 1: Allow tUSDC Spend <ArrowRightIcon size={16} /></>;
    return <>Approve Swap <ArrowRightIcon size={16} /></>;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0D1B2A] border border-[#00A9BA]/30 rounded-3xl p-8 max-w-md w-full shadow-[0_0_50px_rgba(0,169,186,0.2)] relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00A9BA]/10 blur-[60px] rounded-full -mr-16 -mt-16" />

        {!executing && !txHash && (
          <button onClick={onReject} className="absolute top-4 right-4 p-2 text-gray-500 hover:text-white transition-colors">
            <XIcon size={20} />
          </button>
        )}

        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${signal === 'BUY' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              <ZapIcon size={24} className={signal === 'BUY' ? 'text-green-500' : 'text-red-500'} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Agent Signal Received</h3>
              <p className="text-xs text-gray-400">Manual Approval Required · seq #{hcsSequenceNum}</p>
            </div>
          </div>

          {/* Swap preview */}
          <div className="bg-black/40 border border-white/5 rounded-2xl p-4 mb-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${signal === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {signal} SIGNAL
              </span>
              <span className="text-xs text-[#00A9BA] font-mono">{confidence}% confidence</span>
            </div>

            {/* Token flow */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
                <span className="text-[11px] text-gray-400 uppercase tracking-wider">You send</span>
                <span className="font-mono text-white font-bold">{sendLabel}</span>
              </div>
              <div className="flex justify-center">
                <div className="w-7 h-7 rounded-full bg-[#00A9BA]/15 border border-[#00A9BA]/30 flex items-center justify-center">
                  <ArrowDownIcon size={14} className="text-[#00A9BA]" />
                </div>
              </div>
              <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
                <span className="text-[11px] text-gray-400 uppercase tracking-wider">You receive</span>
                <span className={`font-mono font-bold ${quoteLoading ? 'text-gray-500' : 'text-[#00A9BA]'}`}>
                  {receiveLabel}
                </span>
              </div>
            </div>

            {/* Price + impact */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="text-center">
                <p className="text-[10px] text-gray-500 mb-0.5">Pool price</p>
                <p className="text-[11px] text-gray-300 font-mono">{pricePerHbar}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-500 mb-0.5">Price impact</p>
                <p className={`text-[11px] font-mono ${!quote || quote.priceImpactBps < 50 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {quoteLoading ? '...' : quote ? `${(quote.priceImpactBps / 100).toFixed(3)}%` : 'n/a'}
                </p>
              </div>
            </div>
          </div>

          {/* BUY step progress (2-step flow) */}
          {signal === 'BUY' && !txHash && (
            <div className="flex items-center gap-2 mb-4">
              <div className={`flex-1 h-1.5 rounded-full ${buyStep === 'allowance' ? 'bg-[#00A9BA]' : 'bg-[#00A9BA]/40'}`} />
              <div className={`flex-1 h-1.5 rounded-full ${buyStep === 'swap' ? 'bg-[#00A9BA]' : 'bg-white/10'}`} />
              <span className="text-[10px] text-gray-500 ml-1">
                {buyStep === 'allowance' ? 'Step 1/2' : 'Step 2/2'}
              </span>
            </div>
          )}

          {/* Disclaimer banners */}
          <div className="space-y-2 mb-6">
            <div className="flex items-start gap-2 p-3 bg-[#00A9BA]/5 border border-[#00A9BA]/15 rounded-xl">
              <ShieldCheckIcon size={13} className="text-[#00A9BA] mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-[#94D5DB] leading-relaxed">
                AI decision sealed on HCS seq #{hcsSequenceNum} before this swap. Completing the tamper-proof proof chain.
              </p>
            </div>
            {signal === 'SELL' ? (
              <div className="flex items-start gap-2 p-3 bg-green-500/5 border border-green-500/15 rounded-xl">
                <span className="text-green-400 text-[11px] mt-0.5 flex-shrink-0">✓</span>
                <p className="text-[10px] text-green-300/80 leading-relaxed">
                  SELL: real HBAR leaves wallet, real tUSDC arrives via HTS. Balances update after confirmation.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-yellow-500/5 border border-yellow-500/15 rounded-xl">
                <span className="text-yellow-400 text-[11px] mt-0.5 flex-shrink-0">⚠</span>
                <p className="text-[10px] text-yellow-300/80 leading-relaxed">
                  BUY (2 steps): first approve tUSDC allowance, then execute swap. tUSDC leaves wallet, HBAR arrives.
                </p>
              </div>
            )}
          </div>

          {/* Success state */}
          {txHash ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldCheckIcon size={32} className="text-green-500" />
              </div>
              <p className="text-green-400 font-bold mb-1">Proof Chain Complete ✓</p>
              <p className="text-[10px] text-gray-400 mb-1">HCS #{hcsSequenceNum} → on-chain swap → balances updated</p>
              <p className="text-[10px] text-gray-500 font-mono truncate px-4">{txHash}</p>
              <a
                href={`https://hashscan.io/${NETWORK}/transaction/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'rgba(0,169,186,0.12)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.25)' }}
              >
                Verify on HashScan ↗
              </a>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={onReject}
                disabled={executing}
                className="flex-1 py-3 rounded-xl border border-white/10 text-gray-400 font-bold text-sm hover:bg-white/5 transition-all disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={executing || quoteLoading}
                className="flex-[2] py-3 rounded-xl bg-[#00A9BA] hover:bg-[#008A9A] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {approveLabel()}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
