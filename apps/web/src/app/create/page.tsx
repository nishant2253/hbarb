'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore, AgentConfig } from '@/stores/agentStore';
import { useWalletStore } from '@/stores/walletStore';
import { connectWallet } from '@/lib/wallet';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SendIcon, BotIcon, UserIcon, ZapIcon, ArrowRightIcon, SparklesIcon, Loader2 } from 'lucide-react';

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

function MessageBubble({ msg }: { msg: Message }) {
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
      <div
        className="max-w-[75%] rounded-xl px-4 py-3 text-sm"
        style={{
          background: isUser ? 'rgba(0,169,186,0.1)' : 'rgba(21,101,192,0.08)',
          border: `1px solid ${isUser ? 'rgba(0,169,186,0.2)' : 'rgba(21,101,192,0.15)'}`,
          color: msg.error ? '#EF4444' : '#E2E8F0',
          lineHeight: 1.6,
        }}
      >
        {msg.content}

        {/* Deploy card */}
        {msg.config && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-3 p-3 rounded-lg"
            style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              {[
                ['Strategy', msg.config.strategyType],
                ['Asset',    msg.config.asset],
                ['Timeframe',msg.config.timeframe],
                ['Risk',     msg.config.riskLevel],
              ].map(([k,v]) => (
                <div key={k}>
                  <span style={{ color: '#475569' }}>{k}: </span>
                  <span style={{ color: '#00A9BA', fontWeight: 600 }}>{String(v)}</span>
                </div>
              ))}
            </div>
            <DeployButton msg={msg} />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function DeployButton({ msg }: { msg: Message }) {
  const [deploying, setDeploying] = useState(false);
  const router = useRouter();

  async function handleDeploy() {
    setDeploying(true);
    try {
      let walletStatus = useWalletStore.getState();
      
      if (!walletStatus.isConnected || !walletStatus.accountId) {
        // Trigger modal
        const { accountId, evmAddress, walletName, connector } = await connectWallet();
        useWalletStore.getState().setWallet(accountId, evmAddress, walletName, connector);
        walletStatus = useWalletStore.getState();
      }

      // Backend route /api/agents/deploy handles all onchain logic
      const res = await fetch(`${API_URL}/api/agents/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: msg.config!,
          configHash: msg.configHash!, // We need this from msg
          walletAddress: walletStatus.accountId, // 0.0.XXXXX
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deploy failed');

      router.push(`/agents/${data.agentId}`);
    } catch (err: any) {
      alert(`Deploy failed: ${err.message}`);
    } finally {
      setDeploying(false);
    }
  }

  return (
    <button
      onClick={handleDeploy}
      disabled={deploying}
      className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all duration-200 ${deploying ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.02]'}`}
      style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff' }}
    >
      {deploying ? (
        <><Loader2 size={12} className="animate-spin" /> Deploying to Hedera...</>
      ) : (
        <><ZapIcon size={12} /> Deploy to Hedera <ArrowRightIcon size={12} /></>
      )}
    </button>
  );
}

export default function CreatePage() {
  const { setBuildingConfig } = useAgentStore();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your TradeAgent AI. Describe the trading strategy you want to deploy on Hedera. I'll configure the agent and prepare it for deployment." },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      setBuildingConfig(data.config);
      setMessages(m => [
        ...m,
        {
          role: 'assistant',
          content: `Agent configured! Strategy: ${data.config.strategyType}, Asset: ${data.config.asset}. ConfigHash: ${data.configHash.slice(0, 18)}... Ready to deploy on Hedera?`,
          config: data.config,
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
              <MessageBubble key={i} msg={msg} />
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
