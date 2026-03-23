'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SendIcon, BotIcon, UserIcon, ZapIcon,
  SparklesIcon, Loader2, WalletIcon, ArrowRightIcon, CheckCircle2Icon,
  TrendingUpIcon, BarChart2Icon, TrendingDownIcon, ActivityIcon,
  ChevronRightIcon, StoreIcon,
} from 'lucide-react';
import {
  TopicCreateTransaction,
  FileCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  TransferTransaction,
  AccountId,
} from '@hashgraph/sdk';

import { useAgentStore, AgentConfig } from '@/stores/agentStore';
import { useWalletStore } from '@/stores/walletStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';

function recordTx(payload: {
  ownerId:    string;
  agentId?:   string;
  type:       string;
  txId:       string;
  status?:    string;
  details?:   Record<string, unknown>;
}) {
  const hashscanUrl = `https://hashscan.io/${NETWORK}/transaction/${payload.txId}`;
  fetch(`${API_URL}/api/transactions`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...payload, hashscanUrl }),
  }).catch(() => { /* non-fatal */ });
}

// ── Strategy quick-prompts ─────────────────────────────────────
const STRATEGIES = [
  {
    icon: TrendingUpIcon,
    label: 'Trend Follow',
    color: '#00A9BA',
    bg: 'rgba(0,169,186,0.1)',
    border: 'rgba(0,169,186,0.25)',
    prompt: 'Build a trend-following bot for HBAR/USDC on 1h timeframe using EMA-20 crossover with conservative risk — 3% stop-loss, 8% take-profit, max 10% position size',
  },
  {
    icon: BarChart2Icon,
    label: 'Mean Revert',
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,0.1)',
    border: 'rgba(139,92,246,0.25)',
    prompt: 'Mean reversion strategy on HBAR/USDC — buy when RSI drops below 30 (oversold), sell when RSI hits 65, tight 2% stop-loss',
  },
  {
    icon: ZapIcon,
    label: 'Breakout',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.25)',
    prompt: 'Breakout strategy on HBAR/USDC — detect high-volume consolidation breakouts, tight 1% stop-loss, 5% take-profit, 15m timeframe',
  },
  {
    icon: ActivityIcon,
    label: 'Momentum',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.1)',
    border: 'rgba(16,185,129,0.25)',
    prompt: 'MACD momentum strategy on HBAR/USDC — buy on MACD crossover above signal line, RSI between 50-70, 3% stop-loss, 9% take-profit',
  },
];

// ── All example prompts (for bottom chips) ─────────────────────
const EXAMPLE_PROMPTS = [
  'Build a trend-following bot for HBAR/USDC on 1h timeframe using EMA-20 crossover with conservative risk — 3% stop-loss, 8% take-profit, max 10% position size',
  'Create an aggressive trend follower on HBAR/USDC using EMA-50 with RSI confirmation above 55, 5% stop-loss and 15% take-profit',
  'Swing trader using 60-day EMA on HBAR/USDC with RSI confirmation, medium risk, exit at +5%',
  'Mean reversion strategy on HBAR/USDC — buy when RSI drops below 30 (oversold), sell when RSI hits 65, tight 2% stop-loss',
  'Bollinger Band mean revert bot: enter when price touches lower band, exit at midline, HBAR/USDC on 4h chart with moderate risk',
  'Breakout strategy on HBAR/USDC — detect high-volume consolidation breakouts, tight 1% stop-loss, 5% take-profit, 15m timeframe',
  'Momentum breakout on HBAR/USDC: enter on new highs with MACD confirmation, 2% stop-loss, 10% target, aggressive sizing',
  'MACD momentum strategy on HBAR/USDC — buy on MACD crossover above signal line, RSI between 50-70, 3% stop-loss, 9% take-profit',
  'Dual-momentum bot: RSI > 55 AND MACD positive histogram on HBAR/USDC 15m, moderate risk with 5% stop-loss',
  'Conservative safe bot for HBAR/USDC: only trade when EMA-20 trend AND RSI 40–60 range confirm, max 5% position, 2% stop',
  'HBAR/USDC all-weather strategy: trend follow in bull market (EMA-50 above EMA-200), mean revert in chop (Bollinger squeeze), 3% stop-loss',
  'High-frequency momentum scalper on HBAR/USDC 5m chart: RSI trend + MACD divergence, 1% stop-loss, 3% take-profit, small positions',
];

interface Message {
  role:    'user' | 'assistant';
  content: string;
  config?: AgentConfig;
  configHash?: string;
  error?:  boolean;
}

// ── Deploying Modal ────────────────────────────────────────────
function DeployingModal({ step }: { step: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center"
        style={{ background: '#0D1B2A', border: '1px solid rgba(0,169,186,0.3)', boxShadow: '0 0 60px rgba(0,169,186,0.15)' }}
      >
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.3)' }}>
          <Loader2 className="animate-spin" size={28} style={{ color: '#00A9BA' }} />
        </div>
        <h3 className="text-lg font-bold mb-2" style={{ color: '#E2E8F0' }}>Deploying to Hedera</h3>
        <p className="text-sm leading-relaxed" style={{ color: '#94A3B8' }}>{step}</p>
        <div className="mt-5 flex justify-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div key={i} animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              className="w-1.5 h-1.5 rounded-full" style={{ background: '#00A9BA' }} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── Fund Agent Modal ───────────────────────────────────────────
interface FundAgentModalProps {
  agentId: string; agentAccountId: string;
  signer: any; accountId: string; onComplete: () => void;
}

function FundAgentModal({ agentId, agentAccountId, signer, accountId, onComplete }: FundAgentModalProps) {
  const [budget, setBudget] = useState('20');
  const [funding, setFunding] = useState(false);
  const [funded, setFunded] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fundAgent() {
    const hbar = parseFloat(budget);
    if (!hbar || hbar <= 0) return;
    setFunding(true); setError(null);
    try {
      const tinybars = Math.round(hbar * 1e8);
      const transferTx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(accountId), Hbar.fromTinybars(-tinybars))
        .addHbarTransfer(AccountId.fromString(agentAccountId), Hbar.fromTinybars(tinybars))
        .setTransactionMemo(`Fund Arcane:${agentId}`)
        .setMaxTransactionFee(new Hbar(2))
        .freezeWithSigner(signer);
      const response = await transferTx.executeWithSigner(signer);
      // getReceiptWithSigner hangs indefinitely with DAppSigner on TransferTransaction (Bug #5).
      // The executeWithSigner return itself confirms acceptance; wait for Hedera finality instead.
      await new Promise(r => setTimeout(r, 3000));
      const txIdStr = response.transactionId.toString();
      setTxId(txIdStr);
      await fetch(`${API_URL}/api/agents/${agentId}/fund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetHbar: hbar }),
      });
      recordTx({ ownerId: accountId, agentId, type: 'AGENT_FUND', txId: txIdStr,
        details: { agentAccountId, budgetHbar: hbar } });
      setFunded(true);
      setTimeout(() => onComplete(), 2500);
    } catch (err: any) {
      setError(err?.message?.includes('rejected') ? 'Transaction cancelled.' : err?.message ?? 'Failed');
    } finally { setFunding(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="rounded-3xl p-8 max-w-md w-full"
        style={{ background: '#0D1B2A', border: '1px solid rgba(0,169,186,0.3)', boxShadow: '0 0 60px rgba(0,169,186,0.15)' }}>
        {funded ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(16,185,129,0.15)' }}>
              <CheckCircle2Icon size={32} style={{ color: '#10B981' }} />
            </div>
            <p className="text-lg font-bold mb-1" style={{ color: '#E2E8F0' }}>Agent Funded!</p>
            <p className="text-sm" style={{ color: '#94A3B8' }}>Redirecting to your agent dashboard…</p>
            {txId && (
              <a href={`https://hashscan.io/${NETWORK}/transaction/${txId}`} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(0,169,186,0.12)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.25)' }}>
                View on HashScan ↗
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(0,169,186,0.1)', border: '1px solid rgba(0,169,186,0.2)' }}>
                <WalletIcon size={22} style={{ color: '#00A9BA' }} />
              </div>
              <div>
                <h3 className="text-lg font-bold" style={{ color: '#E2E8F0' }}>Step 4: Fund Your Agent</h3>
                <p className="text-xs" style={{ color: '#94A3B8' }}>One-time · Agent trades autonomously after this</p>
              </div>
            </div>
            <div className="rounded-xl p-4 mb-5" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-xs leading-relaxed mb-3" style={{ color: '#94A3B8' }}>
                Your agent has its own Hedera account. Fund it with HBAR and it will trade
                <span style={{ color: '#00A9BA' }}> fully autonomously</span> — no per-trade signing needed.
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: '#94A3B8' }}>
                <span>Agent wallet:</span>
                <span style={{ color: '#00A9BA' }}>{agentAccountId}</span>
              </div>
            </div>
            <div className="mb-5">
              <label className="text-xs mb-2 block" style={{ color: '#94A3B8' }}>Trading Budget (HBAR)</label>
              <div className="flex gap-2">
                {['10', '20', '50'].map(v => (
                  <button key={v} onClick={() => setBudget(v)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: budget === v ? 'rgba(0,169,186,0.2)' : 'rgba(255,255,255,0.04)',
                      border: budget === v ? '1px solid rgba(0,169,186,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      color: budget === v ? '#00A9BA' : '#64748B',
                    }}>{v} ℏ</button>
                ))}
                <input type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)}
                  className="flex-1 bg-transparent rounded-xl px-3 text-sm text-center outline-none"
                  style={{ border: '1px solid rgba(255,255,255,0.12)', color: '#E2E8F0' }} />
              </div>
            </div>
            {error && <p className="text-xs mb-4" style={{ color: '#EF4444' }}>{error}</p>}
            <div className="flex gap-3">
              <button onClick={onComplete} disabled={funding}
                className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#94A3B8' }}>
                Skip for now
              </button>
              <button onClick={fundAgent} disabled={funding || !budget}
                className="flex-[2] py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff' }}>
                {funding
                  ? <><Loader2 size={15} className="animate-spin" /> Funding…</>
                  : <><WalletIcon size={14} /> Fund Agent <ArrowRightIcon size={14} /></>}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ── Config Proposal Card ───────────────────────────────────────
function ConfigProposalCard({ config, configHash, onDeploy }: {
  config: AgentConfig; configHash: string; onDeploy: () => void;
}) {
  const ind  = config.indicators ?? {};
  const risk = config.risk ?? { stopLossPct: 3, takeProfitPct: 8, maxPositionSizePct: 10 };
  const tfLabel: Record<string, string> = { '1m': '1 min', '5m': '5 min', '15m': '15 min', '1h': '1 hr', '4h': '4 hr', '1d': '1 day' };
  const stLabel: Record<string, string> = { TREND_FOLLOW: 'Trend Follow', MEAN_REVERT: 'Mean Revert', BREAKOUT: 'Breakout', MOMENTUM: 'Momentum', CUSTOM: 'Custom' };

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,169,186,0.25)', background: 'rgba(0,0,0,0.4)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'rgba(0,169,186,0.08)', borderBottom: '1px solid rgba(0,169,186,0.12)' }}>
        <div className="flex items-center gap-2">
          <ZapIcon size={11} style={{ color: '#00A9BA' }} />
          <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#00A9BA' }}>Agent Proposal</span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: '#94A3B8' }}>{configHash.slice(0, 12)}…</span>
      </div>

      <div className="px-4 py-4 space-y-3">
        <p className="font-bold text-sm" style={{ color: '#E2E8F0' }}>{config.name}</p>

        {/* Core params */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Strategy',   value: stLabel[config.strategyType] ?? config.strategyType },
            { label: 'Asset',      value: config.asset },
            { label: 'Timeframe',  value: tfLabel[config.timeframe] ?? config.timeframe },
          ].map(c => (
            <div key={c.label} className="rounded-lg px-2.5 py-2 text-center"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: '#94A3B8' }}>{c.label}</p>
              <p className="text-xs font-semibold" style={{ color: '#E2E8F0' }}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Indicators */}
        {(ind.rsi || ind.movingAverage || ind.macd) && (
          <div className="flex flex-wrap gap-1.5">
            {ind.movingAverage && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                style={{ background: 'rgba(21,101,192,0.2)', color: '#60A5FA', border: '1px solid rgba(21,101,192,0.3)' }}>
                {ind.movingAverage.type}({ind.movingAverage.period})
              </span>
            )}
            {ind.rsi && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#C084FC', border: '1px solid rgba(168,85,247,0.25)' }}>
                RSI({ind.rsi.period})
              </span>
            )}
            {ind.macd && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-mono"
                style={{ background: 'rgba(234,179,8,0.12)', color: '#FDE047', border: '1px solid rgba(234,179,8,0.2)' }}>
                MACD({ind.macd.fast},{ind.macd.slow},{ind.macd.signal})
              </span>
            )}
          </div>
        )}

        {/* Risk */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg py-2 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: '#EF4444' }}>Stop-Loss</p>
            <p className="text-sm font-bold" style={{ color: '#FCA5A5' }}>{risk.stopLossPct}%</p>
          </div>
          <div className="rounded-lg py-2 text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: '#10B981' }}>Take-Profit</p>
            <p className="text-sm font-bold" style={{ color: '#6EE7B7' }}>{risk.takeProfitPct}%</p>
          </div>
          <div className="rounded-lg py-2 text-center" style={{ background: 'rgba(0,169,186,0.08)', border: '1px solid rgba(0,169,186,0.15)' }}>
            <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: '#00A9BA' }}>Max Size</p>
            <p className="text-sm font-bold" style={{ color: '#67E8F9' }}>{risk.maxPositionSizePct}%</p>
          </div>
        </div>

        <button onClick={onDeploy}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff', boxShadow: '0 0 20px rgba(0,169,186,0.3)' }}>
          <ZapIcon size={13} />
          Deploy on Hedera
          <ArrowRightIcon size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Message Bubble ─────────────────────────────────────────────
function MessageBubble({ msg, onDeploy }: { msg: Message; onDeploy: (c: AgentConfig, h: string) => void }) {
  const isUser = msg.role === 'user';
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{
          background: isUser ? 'rgba(0,169,186,0.15)' : 'rgba(21,101,192,0.15)',
          border: `1px solid ${isUser ? 'rgba(0,169,186,0.3)' : 'rgba(21,101,192,0.3)'}`,
        }}>
        {isUser ? <UserIcon size={13} style={{ color: '#00A9BA' }} /> : <BotIcon size={13} style={{ color: '#60A5FA' }} />}
      </div>
      <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`} style={{ maxWidth: '82%' }}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}`}
          style={{
            background: isUser ? 'rgba(0,169,186,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isUser ? 'rgba(0,169,186,0.2)' : 'rgba(255,255,255,0.07)'}`,
            color: msg.error ? '#FCA5A5' : isUser ? '#E2E8F0' : '#CBD5E1',
          }}>
          {msg.content}
          {msg.config && msg.configHash && (
            <ConfigProposalCard config={msg.config} configHash={msg.configHash}
              onDeploy={() => onDeploy(msg.config!, msg.configHash!)} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Welcome State (empty chat) ─────────────────────────────────
function WelcomeScreen({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.25)', boxShadow: '0 0 30px rgba(0,169,186,0.15)' }}>
        <SparklesIcon size={28} style={{ color: '#00A9BA' }} />
      </div>
      <h2 className="font-display text-xl font-bold mb-2" style={{ color: '#E2E8F0' }}>
        Build Your Trading Agent
      </h2>
      <p className="text-sm mb-8 max-w-sm" style={{ color: '#94A3B8', lineHeight: 1.7 }}>
        Describe your strategy in plain English. Gemini AI will configure it, then deploy it
        on Hedera with a tamper-proof HCS audit trail.
      </p>

      {/* Strategy quick-start cards */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-md">
        {STRATEGIES.map(s => (
          <button key={s.label} onClick={() => onSelect(s.prompt)}
            className="text-left p-4 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.02] group"
            style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={15} style={{ color: s.color }} />
              <span className="text-xs font-semibold font-display" style={{ color: s.color }}>{s.label}</span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
              {s.prompt.slice(0, 60)}…
            </p>
            <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRightIcon size={11} style={{ color: s.color }} />
              <span className="text-[10px]" style={{ color: s.color }}>Use this prompt</span>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function CreatePage() {
  const router = useRouter();
  const { setBuildingConfig } = useAgentStore();
  const { signer, accountId } = useWalletStore();

  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [deployStep, setDeployStep] = useState<string | null>(null);
  const [fundModal,  setFundModal]  = useState<{ agentId: string; agentAccountId: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function deployAgent(config: AgentConfig, configHash: string) {
    if (!signer || !accountId) { alert('Please connect your wallet first!'); return; }
    const agentId = (config as any).agentId || crypto.randomUUID();
    const deployConfig = { ...config, agentId };
    try {
      setDeployStep('Step 1/3: Storing strategy on Hedera File Service…');
      const configBytes = Buffer.from(JSON.stringify(deployConfig));
      const fileTx = await new FileCreateTransaction()
        .setContents(configBytes).setFileMemo(`Arcane:${agentId}`)
        .setMaxTransactionFee(new Hbar(5)).freezeWithSigner(signer);
      const fileResp    = await fileTx.executeWithSigner(signer);
      const fileReceipt = await fileResp.getReceiptWithSigner(signer);
      const hfsFileId   = fileReceipt.fileId!.toString();
      recordTx({ ownerId: accountId, agentId, type: 'DEPLOY_HFS', txId: fileResp.transactionId.toString(), details: { hfsFileId } });

      setDeployStep('Step 2/3: Creating HCS audit topic…');
      const topicTx   = await new TopicCreateTransaction()
        .setTopicMemo(`Arcane:${agentId}`).setMaxTransactionFee(new Hbar(5)).freezeWithSigner(signer);
      const topicResp    = await topicTx.executeWithSigner(signer);
      const topicReceipt = await topicResp.getReceiptWithSigner(signer);
      const hcsTopicId   = topicReceipt.topicId!.toString();
      recordTx({ ownerId: accountId, agentId, type: 'DEPLOY_HCS', txId: topicResp.transactionId.toString(), details: { hcsTopicId } });

      setDeployStep('Step 3/3: Registering agent on AgentRegistry…');
      const registryAddress = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS!;
      const contractId      = ContractId.fromEvmAddress(0, 0, registryAddress);
      const hashBytes       = Buffer.from(configHash.slice(2), 'hex');
      const contractParams  = new ContractFunctionParameters()
        .addString(agentId).addBytes32(hashBytes).addString(hcsTopicId)
        .addString(hfsFileId).addString(deployConfig.strategyType);
      const contractTx   = await new ContractExecuteTransaction()
        .setContractId(contractId).setGas(800000).setFunction('registerAgent', contractParams)
        .setMaxTransactionFee(new Hbar(5)).freezeWithSigner(signer);
      const contractResp = await contractTx.executeWithSigner(signer);
      // No receipt data needed — delay for finality instead of getReceiptWithSigner (Bug #5)
      await new Promise(r => setTimeout(r, 3000));
      const contractTxHash = contractResp.transactionId.toString();
      recordTx({ ownerId: accountId, agentId, type: 'DEPLOY_HSCS', txId: contractTxHash, details: { strategyType: deployConfig.strategyType } });

      setDeployStep('Finalizing configuration…');
      const finalizeRes = await fetch(`${API_URL}/api/agents/finalize-deploy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, config: deployConfig, configHash, hcsTopicId, hfsFileId, contractTxHash, ownerAccountId: accountId }),
      });
      if (!finalizeRes.ok) {
        const e = await finalizeRes.json().catch(() => ({}));
        throw new Error((e as any).error || 'Backend finalization failed');
      }
      const finalizeData = await finalizeRes.json() as { agentAccountId?: string };
      setDeployStep(null);
      if (finalizeData.agentAccountId) {
        setFundModal({ agentId, agentAccountId: finalizeData.agentAccountId });
      } else {
        router.push(`/agents/${agentId}`);
      }
    } catch (err: any) {
      console.error('Deployment failed:', err);
      if (err?.message?.includes('rejected')) {
        alert('Deployment cancelled: Transaction rejected in wallet.');
      } else {
        alert(`Deployment failed: ${err.message}`);
      }
      setDeployStep(null);
    }
  }

  async function sendMessage(prompt = input) {
    if (!prompt.trim() || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: prompt }]);
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/agents/build`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to build agent');
      setBuildingConfig({ ...data.config });
      const ind = data.config.indicators ?? {};
      const parts: string[] = [];
      if (ind.movingAverage) parts.push(`${ind.movingAverage.type}(${ind.movingAverage.period})`);
      if (ind.rsi)  parts.push(`RSI(${ind.rsi.period})`);
      if (ind.macd) parts.push('MACD');
      const indStr = parts.length ? ` using ${parts.join(' + ')}` : '';
      const stLbl: Record<string, string> = { TREND_FOLLOW: 'trend-following', MEAN_REVERT: 'mean-reversion', BREAKOUT: 'breakout', MOMENTUM: 'momentum', CUSTOM: 'custom' };
      setMessages(m => [...m, {
        role: 'assistant',
        content: `✓ Configured "${data.config.name}" — a ${stLbl[data.config.strategyType] ?? data.config.strategyType} strategy for ${data.config.asset}${indStr}. Stop-loss ${data.config.risk?.stopLossPct}%, take-profit ${data.config.risk?.takeProfitPct}%. Review the proposal and deploy to Hedera when ready.`,
        config: { ...data.config },
        configHash: data.configHash,
      }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${(err as Error).message}`, error: true }]);
    } finally { setLoading(false); }
  }

  return (
    <div className="flex h-[calc(100vh-64px)]" style={{ background: 'var(--ta-bg)' }}>
      {deployStep && <DeployingModal step={deployStep} />}
      {fundModal && signer && accountId && (
        <FundAgentModal agentId={fundModal.agentId} agentAccountId={fundModal.agentAccountId}
          signer={signer} accountId={accountId}
          onComplete={() => { setFundModal(null); router.push(`/agents/${fundModal.agentId}`); }} />
      )}

      {/* ══════════════════════════════════════════════════════
          LEFT SIDEBAR
      ══════════════════════════════════════════════════════ */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col"
        style={{
          borderRight: '1px solid rgba(255,255,255,0.06)',
          background: 'linear-gradient(180deg, rgba(13,27,42,0.8) 0%, rgba(10,10,15,0.9) 100%)',
        }}
      >
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)' }}>
              <BotIcon size={15} style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: '#E2E8F0' }}>AI Builder</p>
              <p className="text-[10px]" style={{ color: '#94A3B8' }}>Gemini · Hedera</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <div className="px-3 py-3 space-y-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{ background: 'rgba(0,169,186,0.1)', border: '1px solid rgba(0,169,186,0.2)' }}>
            <SparklesIcon size={13} style={{ color: '#00A9BA' }} />
            <span className="text-xs font-semibold" style={{ color: '#00A9BA' }}>AI Builder</span>
          </div>
          <Link href="/marketplace"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-200 hover:bg-white/5"
            style={{ color: '#94A3B8' }}>
            <StoreIcon size={13} />
            <span className="text-xs font-medium">Marketplace</span>
          </Link>
          <Link href="/agents"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-200 hover:bg-white/5"
            style={{ color: '#94A3B8' }}>
            <ActivityIcon size={13} />
            <span className="text-xs font-medium">My Agents</span>
          </Link>
        </div>

        {/* Strategy quick-start */}
        <div className="px-3 py-4 flex-1 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest font-semibold px-1 mb-3" style={{ color: '#94A3B8' }}>
            Quick Prompts
          </p>
          <div className="space-y-2">
            {STRATEGIES.map(s => (
              <button key={s.label} onClick={() => sendMessage(s.prompt)}
                className="w-full text-left p-3 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.01] group"
                style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <s.icon size={12} style={{ color: s.color }} />
                    <span className="text-[11px] font-bold" style={{ color: s.color }}>{s.label}</span>
                  </div>
                  <ChevronRightIcon size={11} className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: s.color }} />
                </div>
                <p className="text-[10px] leading-relaxed line-clamp-2" style={{ color: '#94A3B8' }}>
                  {s.prompt.slice(0, 72)}…
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="px-3 pb-4">
          <div className="p-3 rounded-xl" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[11px] mb-1" style={{ color: '#94A3B8' }}>Want pre-built agents?</p>
            <Link href="/marketplace"
              className="w-full block text-center py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
              style={{ background: 'rgba(0,169,186,0.12)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.2)' }}>
              Browse Marketplace
            </Link>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════
          MAIN CHAT PANEL
      ══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Chat header */}
        <div className="flex items-center gap-3 px-6 py-3.5 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(13,27,42,0.4)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.2)' }}>
            <BotIcon size={15} style={{ color: '#00A9BA' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#E2E8F0' }}>Arcane AI</p>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>Powered by Gemini 1.5 Flash · Deploys on Hedera</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
            style={{ background: 'rgba(16,185,129,0.08)', color: '#10B981', border: '1px solid rgba(16,185,129,0.2)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
            Live
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <WelcomeScreen onSelect={sendMessage} />
          ) : (
            <div className="px-6 py-6 space-y-5 max-w-3xl mx-auto w-full">
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <MessageBubble key={i} msg={msg} onDeploy={deployAgent} />
                ))}
              </AnimatePresence>

              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(21,101,192,0.15)', border: '1px solid rgba(21,101,192,0.25)' }}>
                    <BotIcon size={13} style={{ color: '#60A5FA' }} />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-none"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="flex gap-1.5 items-center">
                      {[0, 0.15, 0.3].map(delay => (
                        <motion.div key={delay}
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1.2, repeat: Infinity, delay }}
                          className="w-1.5 h-1.5 rounded-full" style={{ background: '#60A5FA' }} />
                      ))}
                      <span className="text-xs ml-1" style={{ color: '#94A3B8' }}>Generating…</span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Prompt chips — scrollable row */}
        <div className="flex-shrink-0 px-4 py-2 flex gap-2 overflow-x-auto"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(10,10,15,0.5)' }}>
          {EXAMPLE_PROMPTS.map((p, i) => (
            <button key={i} onClick={() => sendMessage(p)}
              className="flex-shrink-0 text-[11px] px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-200 hover:border-[rgba(0,169,186,0.4)] hover:text-[#94A3B8] whitespace-nowrap"
              style={{
                border: '1px solid rgba(255,255,255,0.07)',
                color: '#94A3B8',
                background: 'rgba(255,255,255,0.02)',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
              {p.length > 32 ? p.slice(0, 32) + '…' : p}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div className="flex-shrink-0 px-5 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(13,27,42,0.6)' }}>
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3 max-w-3xl mx-auto"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
            }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Describe your trading strategy… (e.g. HBAR/USDC momentum 15m RSI>60)"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#2D3748]"
              style={{ color: '#E2E8F0' }}
              disabled={loading}
            />
            <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 disabled:opacity-30 hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff', flexShrink: 0 }}
              aria-label="Send">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <SendIcon size={13} />}
            </button>
          </div>
          <p className="text-center text-[10px] mt-2" style={{ color: '#94A3B8' }}>
            AI-generated · Always verify on HashScan before deploying real capital
          </p>
        </div>
      </div>
    </div>
  );
}
