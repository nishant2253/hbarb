'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { motion, AnimatePresence } from 'framer-motion';
import { ZapIcon, XIcon, Loader2, ArrowRightIcon, ShieldCheckIcon } from 'lucide-react';
import { useWalletStore } from '@/stores/walletStore';
import { getHashPackEthersSigner } from '@/lib/hashpackEthers';
import { fetchBalances } from '@/lib/balance';

const MOCK_DEX_ABI = [
  "function sellHBARforUSDT(string agentId, uint256 minOut, string hcsSeq, string topicId) payable returns (uint256)",
  "function buyHBARwithUSDT(string agentId, uint256 usdtIn, uint256 minHbarOut, string hcsSeq, string topicId) returns (uint256)",
  "function getSwapQuote(string direction, uint256 amountIn) view returns (uint256, uint256, uint256)",
];

interface TradeApprovalProps {
  signal: 'BUY' | 'SELL';
  agentId: string;
  hcsTopicId: string;
  hcsSequenceNum: string;
  amount: bigint; // tinybars for SELL, micro-USDT for BUY
  price: number;
  confidence: number;
  onApprove: () => void;
  onReject: () => void;
}

export function TradeApprovalModal({
  signal, agentId, hcsTopicId, hcsSequenceNum,
  amount, price, confidence, onApprove, onReject
}: TradeApprovalProps) {
  const { signer, accountId, setBalances } = useWalletStore();
  const [executing, setExecuting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function executeSwap() {
    if (!signer || !accountId) {
       alert("Wallet not connected!");
       return;
    }
    setExecuting(true);
    try {
      const ethersSigner = await getHashPackEthersSigner(signer);
      const mockDex = new ethers.Contract(
        process.env.NEXT_PUBLIC_MOCK_DEX_ADDRESS!,
        MOCK_DEX_ABI,
        ethersSigner
      );

      let tx: any;
      if (signal === 'SELL') {
        const [minOut] = await mockDex.getSwapQuote("HBAR_TO_USDT", amount);
        const slippageMin = (minOut * BigInt(995)) / BigInt(1000); // 0.5% slippage

        tx = await mockDex.sellHBARforUSDT(
          agentId,
          slippageMin,
          hcsSequenceNum,
          hcsTopicId,
          {
            value: amount,
            gasLimit: 1000000,
          }
        );
      } else {
        const [minOut] = await mockDex.getSwapQuote("USDT_TO_HBAR", amount);
        const slippageMin = (minOut * BigInt(995)) / BigInt(1000);

        tx = await mockDex.buyHBARwithUSDT(
          agentId,
          amount,
          slippageMin,
          hcsSequenceNum,
          hcsTopicId,
          { gasLimit: 1000000 }
        );
      }

      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      
      // Refresh balances immediately
      const b = await fetchBalances(accountId);
      setBalances(b.hbar, b.tusdt);
      
      setTimeout(() => onApprove(), 2000);
    } catch (err: any) {
      console.error("Swap failed:", err);
      if (err?.message?.includes('User rejected')) {
         alert("Swap cancelled: Transaction rejected in wallet.");
      } else {
         alert(`Swap failed: ${err.message}`);
      }
      onReject();
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0D1B2A] border border-[#00A9BA]/30 rounded-3xl p-8 max-w-md w-full shadow-[0_0_50px_rgba(0,169,186,0.2)] relative overflow-hidden"
      >
        {/* Background Glow */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00A9BA]/10 blur-[60px] rounded-full -mr-16 -mt-16" />
        
        {/* Close Button */}
        {!executing && !txHash && (
          <button 
            onClick={onReject}
            className="absolute top-4 right-4 p-2 text-gray-500 hover:text-white transition-colors"
          >
            <XIcon size={20} />
          </button>
        )}

        {/* Content */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${signal === 'BUY' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              <ZapIcon size={24} className={signal === 'BUY' ? 'text-green-500' : 'text-red-500'} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Agent Signal Received</h3>
              <p className="text-xs text-gray-400">Manual Approval Required</p>
            </div>
          </div>

          <div className="space-y-4 mb-8">
            <div className="bg-black/40 border border-white/5 rounded-2xl p-4">
              <div className="flex justify-between items-center mb-4">
                 <span className={`text-sm font-bold px-3 py-1 rounded-full ${signal === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                   {signal} SIGNAL
                 </span>
                 <span className="text-xs text-gray-500 font-mono">#{hcsSequenceNum}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Amount</p>
                  <p className="text-lg font-mono text-white">
                    {signal === 'SELL' 
                      ? `${(Number(amount) / 1e8).toFixed(2)} ℏ`
                      : `$${(Number(amount) / 1e6).toFixed(2)}`
                    }
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Confidence</p>
                  <p className="text-lg font-mono text-[#00A9BA]">{confidence}%</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
               <ShieldCheckIcon size={14} className="text-blue-400" />
               <p className="text-[10px] text-blue-300 leading-tight">
                 This trade maps to SaucerSwap v2 pricing. Real balances will change upon approval.
               </p>
            </div>
          </div>

          {txHash ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                <ShieldCheckIcon size={32} className="text-green-500" />
              </div>
              <p className="text-green-400 font-bold mb-1">Trade Executed!</p>
              <p className="text-[10px] text-gray-500 font-mono truncate px-8">{txHash}</p>
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
                onClick={executeSwap}
                disabled={executing}
                className="flex-[2] py-3 rounded-xl bg-[#00A9BA] hover:bg-[#008A9A] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {executing ? (
                  <><Loader2 size={16} className="animate-spin" /> Approving...</>
                ) : (
                  <>Approve Swap <ArrowRightIcon size={16} /></>
                )}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
