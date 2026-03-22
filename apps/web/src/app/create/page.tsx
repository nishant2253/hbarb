'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  SendIcon, BotIcon, UserIcon, ZapIcon, 
  ArrowRightIcon, SparklesIcon, Loader2 
} from 'lucide-react';
import { 
  TopicCreateTransaction, 
  FileCreateTransaction, 
  Hbar 
} from '@hashgraph/sdk';
import { ethers } from 'ethers';

import { useAgentStore, AgentConfig } from '@/stores/agentStore';
import { useWalletStore } from '@/stores/walletStore';
import { getHashPackEthersSigner } from '@/lib/hashpackEthers';

const REGISTRY_ABI = [
  "function registerAgent(string id, bytes32 configHash, string hcsTopicId, string hfsFileId, string strategyType) external"
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const EXAMPLE_PROMPTS = [
  'BTCUSD, medium risk, RSI>55, exit at +2%',
  'Build a swing trader using 60-day EMA on HBAR/USDC with RSI confirmation',
  'Trend follower: buy when 20 EMA crosses above 50 EMA on 15m chart',
  'Breakout strategy on HBAR/USDC, tight stop-loss at 1%',
];

interface Message {
  role:    'user' | 'assistant';
  content: string;
  config?: AgentConfig;
  configHash?: string;
  error?:  boolean;
}

function DeployingModal({ step }: { step: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0D1B2A] border border-white/10 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
        <Loader2 className="w-12 h-12 text-[#00A9BA] animate-spin mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Deploying Agent</h3>
        <p className="text-gray-400 text-sm">{step}</p>
        <div className="mt-6 flex justify-center gap-1">
           {[0, 1, 2].map(i => (
             <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00A9BA]/30 animate-pulse" />
           ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onDeploy }: { msg: Message, onDeploy: (config: AgentConfig, hash: string) => void }) {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ background: isUser ? 'rgba(0,169,186,0.15)' : 'rgba(21,101,192,0.15)', border: `1px solid ${isUser ? 'rgba(0,169,186,0.3)' : 'rgba(21,101,192,0.3)'}` }}
      >
        {isUser
          ? <UserIcon size={14} style={{ color: '#00A9BA' }} />
          : <BotIcon  size={14} style={{ color: '#1565C0' }} />
        }
      </div>

      {/* Bubble */}
      <div className="flex flex-col gap-2 max-w-[80%]">
        <div 
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'bg-[#00A9BA]/10 rounded-tr-none' : 'bg-white/5 rounded-tl-none'}`}
          style={{ border: isUser ? '1px solid rgba(0,169,186,0.15)' : '1px solid rgba(255,255,255,0.06)' }}
        >
          <p style={{ color: isUser ? '#E2E8F0' : '#CBD5E1' }}>{msg.content}</p>

          {msg.config && msg.configHash && (
            <div className="mt-4 p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Proposal</span>
                <span className="text-[10px] font-mono text-[#00A9BA]">{msg.configHash.slice(0, 12)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                <div className="text-gray-400">Strategy: <span className="text-white">{msg.config.strategyType}</span></div>
                <div className="text-gray-400">Asset: <span className="text-white">{msg.config.asset}</span></div>
                <div className="text-gray-400">Risk: <span className="text-white">{msg.config.riskLevel}</span></div>
              </div>
              <button
                onClick={() => onDeploy(msg.config!, msg.configHash!)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#00A9BA] hover:bg-[#008A9A] text-white font-bold transition-all text-xs cursor-pointer"
              >
                <ZapIcon size={12} />
                Deploy Agent
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const { setBuildingConfig } = useAgentStore();
  const { signer, accountId } = useWalletStore();
  
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your TradeAgent AI. Describe the trading strategy you want to deploy on Hedera. I'll configure the agent and prepare it for deployment." },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [deployStep, setDeployStep] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function deployAgent(config: AgentConfig, configHash: string) {
    if (!signer || !accountId) {
      alert("Please connect your wallet first!");
      return;
    }

    try {
      // 1. Storing config on HFS
      setDeployStep("Step 1/3: Storing strategy on Hedera File Service...");
      const configBytes = Buffer.from(JSON.stringify(config));
      const fileCreateTx = await new FileCreateTransaction()
        .setContents(configBytes)
        .setFileMemo(`TradeAgent:${config.agentId}`)
        .setMaxTransactionFee(new Hbar(5))
        .freezeWithSigner(signer);
      
      const fileResponse = await fileCreateTx.executeWithSigner(signer);
      const fileReceipt = await fileResponse.getReceiptWithSigner(signer);
      const hfsFileId = fileReceipt.fileId!.toString();
      console.log("HFS file created:", hfsFileId);

      // 2. Creating HCS audit topic
      setDeployStep("Step 2/3: Creating HCS audit topic...");
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo(`TradeAgent:${config.agentId}`)
        .setMaxTransactionFee(new Hbar(5))
        .freezeWithSigner(signer);
      
      const topicResponse = await topicTx.executeWithSigner(signer);
      const topicReceipt = await topicResponse.getReceiptWithSigner(signer);
      const hcsTopicId = topicReceipt.topicId!.toString();
      console.log("HCS topic created:", hcsTopicId);

      // 3. Registering agent on contract via ethers bridge
      setDeployStep("Step 3/3: Registering agent on AgentRegistry...");
      const ethersSigner = await getHashPackEthersSigner(signer);
      const registry = new ethers.Contract(
        process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS!,
        REGISTRY_ABI,
        ethersSigner
      );

      console.log("Preparing registerAgent transaction via manual encoding...");
      
      const _agentId = config.agentId;
      const _configHash = configHash;
      const _hcsTopicId = hcsTopicId;
      const _hfsFileId = hfsFileId;
      const _strategyType = config.strategyType;

      if (!_agentId) throw new Error("Missing agentId");
      if (!_configHash || !_configHash.startsWith('0x')) throw new Error("Missing or invalid configHash");
      if (!_hcsTopicId) throw new Error("Missing hcsTopicId");
      if (!_hfsFileId) throw new Error("Missing hfsFileId");
      if (!_strategyType) throw new Error("Missing strategyType");

      console.log("Arguments validated:", { _agentId, _configHash, _hcsTopicId, _hfsFileId, _strategyType });

      // ⚠️ CRITICAL: Bypass ethers.Contract's high-level call which is causing recursion/TypeError
      const data = registry.interface.encodeFunctionData("registerAgent", [
        _agentId,
        _configHash,
        _hcsTopicId,
        _hfsFileId,
        _strategyType
      ]);

      console.log("Encoded transaction data successfully");

      const txRequest = {
        to: process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS!,
        data: data,
        gasLimit: 2000000 
      };

      console.log("Sending encoded transaction via signer...");
      const tx = await ethersSigner.sendTransaction(txRequest);
      console.log("Transaction sent! Hash:", tx.hash);
      
      setDeployStep("Step 3/3: Waiting for block confirmation...");
      await tx.wait();
      
      setDeployStep("Finalizing agent configuration...");
      // Backend finalize — performs HCS-10 and BullMQ setup (operator pays, silent)
      const finalizeRes = await fetch(`${API_URL}/api/agents/finalize-deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: config.agentId,
          config,
          hcsTopicId,
          hfsFileId,
          contractTxHash: tx.hash,
          ownerAccountId: accountId,
        }),
      });

      if (!finalizeRes.ok) throw new Error("Backend finalization failed");

      router.push(`/dashboard/${config.agentId}`);
    } catch (err: any) {
      console.error("Deployment failed:", err);
      if (err?.message?.includes('User rejected')) {
         alert("Deployment cancelled: Transaction rejected in wallet.");
      } else {
         alert(`Deployment failed: ${err.message}`);
      }
    } finally {
      setDeployStep(null);
    }
  }

  async function sendMessage(prompt = input) {
    if (!prompt.trim() || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: prompt }]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/agents/build`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to build agent');

      const finalConfig = { ...data.config, agentId: data.agentId };
      setBuildingConfig(finalConfig);
      setMessages(m => [
        ...m,
        {
          role: 'assistant',
          content: `Agent configured! Strategy: ${data.config.strategyType}, Asset: ${data.config.asset}. ConfigHash: ${data.configHash.slice(0, 12)}... Ready to deploy on Hedera?`,
          config: finalConfig, 
          configHash: data.configHash,
        },
      ]);
    } catch (err) {
      setMessages(m => [
        ...m,
        { role: 'assistant', content: `Error: ${(err as Error).message}`, error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-64px)]" style={{ background: 'var(--ta-bg)' }}>
      {deployStep && <DeployingModal step={deployStep} />}

      {/* ── Left Sidebar ───────────────────────────────────────── */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col p-4 hidden md:flex"
        style={{ borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(13,27,42,0.5)' }}
      >
        {/* Active tab */}
        <div
          className="flex items-center gap-3 p-3 rounded-xl mb-2 cursor-default"
          style={{ background: 'rgba(0,169,186,0.1)', border: '1px solid rgba(0,169,186,0.2)' }}
        >
          <BotIcon size={14} style={{ color: '#00A9BA' }} />
          <span className="text-sm font-semibold" style={{ color: '#E2E8F0' }}>AI Builder</span>
        </div>
        <Link
          href="/marketplace"
          className="flex items-center gap-3 p-3 rounded-xl mb-4 cursor-pointer transition-all duration-200 hover:bg-white/5"
          style={{ color: '#64748B' }}
        >
          <SparklesIcon size={14} />
          <span className="text-sm">Marketplace</span>
        </Link>

        {/* Prompt starters */}
        <div
          className="p-3 rounded-xl mb-4"
          style={{ background: 'rgba(21,101,192,0.12)', border: '1px solid rgba(21,101,192,0.2)' }}
        >
          <p className="text-xs font-semibold mb-2" style={{ color: '#60A5FA' }}>Try a prompt:</p>
          {EXAMPLE_PROMPTS.slice(0, 2).map(p => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="w-full text-left text-xs p-2 rounded-lg mb-1 cursor-pointer transition-all duration-200 hover:bg-white/5"
              style={{ color: '#64748B' }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-auto">
          <div
            className="p-3 rounded-xl text-xs"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p style={{ color: '#475569' }}>Tired of trading manually?</p>
            <p style={{ color: '#475569' }} className="mt-1">Create or choose an AI agent!</p>
            <Link
              href="/marketplace"
              className="w-full mt-2 block text-center py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200"
              style={{ background: 'rgba(0,169,186,0.15)', color: '#00A9BA' }}
            >
              Browse Agents
            </Link>
          </div>
        </div>
      </aside>

      {/* ── Chat Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-6 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,169,186,0.12)' }}
          >
            <BotIcon size={16} style={{ color: '#00A9BA' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#E2E8F0' }}>TradeAgent AI</p>
            <p className="text-xs" style={{ color: '#475569' }}>Powered by Gemini · Deploys on Hedera</p>
          </div>
          <div
            className="ml-auto px-2 py-1 rounded-full text-xs flex items-center gap-1"
            style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
            Live
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onDeploy={deployAgent} />
            ))}
          </AnimatePresence>

          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(21,101,192,0.15)' }}>
                <BotIcon size={14} style={{ color: '#1565C0' }} />
              </div>
              <div className="px-4 py-3 rounded-xl" style={{ background: 'rgba(21,101,192,0.08)' }}>
                <div className="flex gap-1">
                  {[0, 0.15, 0.3].map(delay => (
                    <motion.div
                      key={delay}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay }}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: '#1565C0' }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Example prompts */}
        <div
          className="px-6 py-3 flex gap-2 overflow-x-auto"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
        >
          {EXAMPLE_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-200 hover:border-teal-500/50"
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#64748B',
                background: 'rgba(255,255,255,0.02)',
                maxWidth: 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer'
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div
          className="px-6 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(13,27,42,0.5)' }}
        >
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Describe your trading strategy... (e.g. HBAR/USDC momentum 15m RSI>60)"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: '#E2E8F0' }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff' }}
              aria-label="Send"
            >
              <SendIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
