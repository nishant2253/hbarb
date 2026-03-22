'use client';

import { useEffect, useState, use } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeftIcon, ExternalLinkIcon, PlayIcon, PauseIcon,
  ShieldCheckIcon, FileTextIcon, ActivityIcon, ClockIcon, ZapIcon,
  ArrowRightLeftIcon, CheckCircle2Icon, WalletIcon, TrendingUpIcon, ArrowDownToLineIcon,
  StoreIcon, TagIcon, Loader2,
} from 'lucide-react';

import { TradeApprovalModal } from '@/components/TradeApprovalModal';
import { useWalletStore } from '@/stores/walletStore';
import { TokenAssociateTransaction, TokenId, AccountId, Hbar } from '@hashgraph/sdk';

const STRATEGY_TOKEN_ID =
  process.env.NEXT_PUBLIC_STRATEGY_TOKEN_ID || '0.0.8316389';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';

interface HCSMessage {
  seq:         number;
  timestamp:   string;
  decision: {
    signal:     string;
    confidence: number;
    price:      number;
    reasoning:  string;
    indicators?: Record<string, number>;
  } | null;
  hashscanUrl: string;
}

/** Parse the flat reasoning string that tradeExecutor writes for EXECUTION_RESULT */
function parseExecutionReasoning(reasoning: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = reasoning.split(/\.\s+/);
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const key = pair.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, '_');
    const val = pair.slice(colonIdx + 1).trim().replace(/\.$/, '');
    if (key && val) result[key] = val;
  }
  return result;
}

function relativeTime(timestamp: string): string {
  const ms = parseFloat(timestamp) * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

interface AgentDetail {
  id:                    string;
  name:                  string;
  ownerId:               string;
  strategyType:          string;
  hcsTopicId:            string;
  hfsConfigId:           string | null;
  contractTxId:          string | null;
  hcs10TopicId:          string | null;
  active:                boolean;
  listed:                boolean;
  configHash:            string;
  createdAt:             string;
  executionMode:         'AUTO' | 'MANUAL';
  agentAccountId:        string | null;
  agentAccountEvmAddress: string | null;
  tradingBudgetHbar:     number;
}

interface AgentPortfolio {
  hbar:   number;
  tusdt:  number;
  pnlPct: number | null;
}

interface PendingTrade {
  signal: 'BUY' | 'SELL';
  amount: bigint;
  price: number;
  confidence: number;
  hcsSequenceNum: string;
}

function SignalBadge({ signal }: { signal: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    BUY:  { bg: 'rgba(16,185,129,0.15)',  color: '#10B981' },
    SELL: { bg: 'rgba(239,68,68,0.15)',   color: '#EF4444' },
    HOLD: { bg: 'rgba(234,179,8,0.15)',   color: '#EAB308' },
  };
  const s = styles[signal] ?? styles.HOLD;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded font-bold"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}40` }}
    >
      {signal}
    </span>
  );
}

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const [agent,       setAgent]       = useState<AgentDetail | null>(null);
  const [history,     setHistory]     = useState<HCSMessage[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [togglingMode, setTogglingMode] = useState(false);
  const [portfolio,     setPortfolio]     = useState<AgentPortfolio | null>(null);
  const [withdrawing,   setWithdrawing]   = useState(false);
  const [listingPrice,  setListingPrice]  = useState('');
  const [listingStatus, setListingStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [listingResult, setListingResult] = useState<{ serialNumber: number; tokenId: string } | null>(null);
  const [delisting,     setDelisting]     = useState(false);

  const { accountId, signer } = useWalletStore();

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/agents/${agentId}`).then(r => r.json()),
      fetch(`${API_URL}/api/agents/${agentId}/history?limit=50`).then(r => r.json()),
    ]).then(([agentData, historyData]) => {
      setAgent(agentData);
      setHistory(historyData.history ?? []);
      // If agent has a dedicated account, fetch its balances from Mirror Node
      if (agentData.agentAccountId) {
        fetchAgentPortfolio(agentData.agentAccountId, agentData.tradingBudgetHbar).then(setPortfolio);
      }
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId]);

  async function fetchAgentPortfolio(agentAcctId: string, budgetHbar: number): Promise<AgentPortfolio> {
    const base = `https://${NETWORK}.mirrornode.hedera.com/api/v1`;
    const tUSDTId = process.env.NEXT_PUBLIC_TEST_USDT_TOKEN_ID;
    try {
      const [accRes, tokRes] = await Promise.all([
        fetch(`${base}/accounts/${agentAcctId}`),
        tUSDTId ? fetch(`${base}/accounts/${agentAcctId}/tokens?token.id=${tUSDTId}`) : Promise.resolve(null),
      ]);
      const accData = await accRes.json() as any;
      const hbar    = (accData?.balance?.balance ?? 0) / 1e8;
      let   tusdt   = 0;
      if (tokRes) {
        const tokData = await tokRes.json() as any;
        tusdt = (tokData?.tokens?.[0]?.balance ?? 0) / 1e6;
      }
      const pnlPct = budgetHbar > 0
        ? parseFloat((((hbar - budgetHbar) / budgetHbar) * 100).toFixed(2))
        : null;
      return { hbar, tusdt, pnlPct };
    } catch {
      return { hbar: 0, tusdt: 0, pnlPct: null };
    }
  }

  async function withdraw() {
    if (!agent?.agentAccountId || !accountId) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/withdraw`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ownerAccountId: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
      alert(`Withdrawal complete! HBAR and tUSDT sent back to your wallet.\nTx: ${data.txIds?.[0] ?? ''}`);
      // Refresh portfolio
      const p = await fetchAgentPortfolio(agent.agentAccountId, agent.tradingBudgetHbar);
      setPortfolio(p);
      setAgent(a => a ? { ...a, tradingBudgetHbar: 0 } : a);
    } catch (err: any) {
      alert(`Withdrawal failed: ${err.message}`);
    } finally {
      setWithdrawing(false);
    }
  }

  async function listOnMarketplace() {
    if (!agent || !listingPrice || parseFloat(listingPrice) <= 0) return;
    if (!signer || !accountId) {
      alert('Please connect your wallet first.');
      return;
    }
    setListingStatus('loading');
    try {
      // ── Step 1: Associate strategy NFT token with the owner's wallet ──
      // HashPack will show a popup so the user explicitly approves the association.
      // This is required before the operator can transfer the minted NFT to this account.
      const strategyTokenId = TokenId.fromString(STRATEGY_TOKEN_ID);
      const ownerAcctId     = AccountId.fromString(accountId);
      try {
        const assocTx = await new TokenAssociateTransaction()
          .setAccountId(ownerAcctId)
          .setTokenIds([strategyTokenId])
          .setMaxTransactionFee(new Hbar(2))
          .freezeWithSigner(signer);
        const assocResp = await assocTx.executeWithSigner(signer);
        await assocResp.getReceiptWithSigner(signer);
      } catch (assocErr: any) {
        if (!assocErr?.message?.includes('TOKEN_ALREADY_ASSOCIATED')) {
          throw assocErr;
        }
      }

      // ── Step 2: Backend mints the NFT (operator-signed) and transfers to owner ──
      const res = await fetch(`${API_URL}/api/marketplace/list`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          agentId,
          priceHbar:   parseFloat(listingPrice),
          description: `${agent.strategyType} strategy agent by ${agent.ownerId}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Listing failed');
      setListingResult({ serialNumber: data.serialNumber, tokenId: data.tokenId });
      setAgent(a => a ? { ...a, listed: true, serialNumber: data.serialNumber, priceHbar: parseFloat(listingPrice) } as any : a);
      setListingStatus('done');
    } catch (err: any) {
      alert(`Listing failed: ${err.message}`);
      setListingStatus('error');
    }
  }

  async function delistFromMarketplace() {
    if (!agent) return;
    setDelisting(true);
    try {
      const res = await fetch(`${API_URL}/api/marketplace/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delist failed');
      setAgent(a => a ? { ...a, listed: false } : a);
      setListingStatus('idle');
      setListingResult(null);
    } catch (err: any) {
      alert(`Delist failed: ${err.message}`);
    } finally {
      setDelisting(false);
    }
  }

  const triggerRun = async (dryRun = true) => {
    setRunning(true);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      
      // Update history with the initial HCS record
      const newEntry = {
        seq:       parseInt(data.hcsSequenceNumber),
        timestamp: data.hcsTimestamp,
        decision:  { signal: data.signal, confidence: data.confidence, price: data.price, reasoning: data.reasoning },
        hashscanUrl: `https://hashscan.io/${NETWORK}/topic/${agent?.hcsTopicId}`,
      };
      setHistory(h => [newEntry, ...h]);

      // If we got a trade signal and we're NOT in a dry run, trigger the modal
      if (!dryRun && (data.signal === 'BUY' || data.signal === 'SELL')) {
        // Deterministic amounts for demo/testnet
        const tradeAmount = data.signal === 'SELL' ? BigInt(5 * 1e8) : BigInt(1 * 1e6); // 5 HBAR or 1 USDT
        setPendingTrade({
          signal: data.signal,
          amount: tradeAmount,
          price: data.price,
          confidence: data.confidence,
          hcsSequenceNum: data.hcsSequenceNumber
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  const toggleMode = async (newMode: 'AUTO' | 'MANUAL') => {
    if (!agent || togglingMode) return;
    setTogglingMode(true);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) throw new Error("Failed to update mode");
      setAgent({ ...agent, executionMode: newMode });
    } catch (e) {
      console.error(e);
      alert("Failed to change execution mode.");
    } finally {
      setTogglingMode(false);
    }
  };

  const togglePause = async () => {
    await fetch(`${API_URL}/api/agents/${agentId}/pause`, { method: 'PUT' });
    setAgent(a => a ? { ...a, active: !a.active } : a);
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#00A9BA', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-center">
          <p style={{ color: '#334155' }}>Agent not found</p>
          <Link href="/wallet" className="text-sm mt-2 block" style={{ color: '#00A9BA' }}>← Back to Wallet</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-5xl mx-auto">
      {/* Back */}
      <Link
        href="/wallet"
        className="flex items-center gap-2 text-sm mb-6 cursor-pointer transition-colors duration-200 hover:text-white w-fit"
        style={{ color: '#475569' }}
      >
        <ArrowLeftIcon size={14} />
        Back to Wallet
      </Link>

      {/* ── Agent Header ─────────────────────────────────────────── */}
      <div className="glass-card p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-display font-bold" style={{ color: '#E2E8F0' }}>{agent.name}</h1>
              <span
                className="text-xs px-2 py-1 rounded-full font-medium"
                style={{
                  background: agent.active ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                  color:      agent.active ? '#10B981' : '#64748B',
                  border:     `1px solid ${agent.active ? 'rgba(16,185,129,0.25)' : 'rgba(100,116,139,0.25)'}`,
                }}
              >
                {agent.active ? 'Active' : 'Paused'}
              </span>
            </div>
            <p className="text-sm" style={{ color: '#475569' }}>{agent.strategyType.replace('_', ' ')} · {agent.ownerId}</p>
            
            {/* Mode Switcher */}
            <div className="mt-4 flex items-center gap-2">
              <div 
                className="flex p-1 rounded-xl bg-black/40 border border-white/5 w-fit"
              >
                {[
                  { id: 'MANUAL', label: 'Manual Sign', sub: 'You sign trades' },
                  { id: 'AUTO',   label: 'Auto Trade',  sub: 'Agent signs' }
                ].map((m) => (
                  <button
                    key={m.id}
                    disabled={togglingMode}
                    onClick={() => toggleMode(m.id as any)}
                    className={`px-4 py-2 rounded-lg transition-all duration-200 text-left ${
                      agent.executionMode === m.id 
                        ? 'bg-[#00A9BA] text-white shadow-lg shadow-[#00A9BA]/20' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <p className="text-xs font-bold uppercase tracking-wider leading-none">{m.label}</p>
                    <p className={`text-[10px] mt-0.5 opacity-60 ${agent.executionMode === m.id ? 'text-white' : ''}`}>{m.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 shrink-0 flex-wrap items-center">
            <div className="relative group">
              <button
                onClick={() => triggerRun(false)}
                disabled={running || !agent.active || agent.executionMode === 'AUTO'}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: running ? 'rgba(16,185,129,0.06)' : 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(0,169,186,0.18))',
                  border: '1px solid rgba(16,185,129,0.35)',
                  color: '#10B981',
                }}
              >
                <ZapIcon size={14} />
                {running ? 'Running…' : 'Run Trade'}
              </button>
              {agent.executionMode === 'AUTO' && (
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.08)', color: '#64748B' }}>
                  Disabled in Auto mode — agent signs automatically
                </div>
              )}
            </div>
            <button
              onClick={() => triggerRun(true)}
              disabled={running}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 disabled:opacity-50"
              style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.25)', color: '#00A9BA' }}
            >
              <PlayIcon size={14} />
              <span>{running ? 'Running…' : 'Test Run'}</span>
              <span className="text-[9px] opacity-60 font-normal">no swap</span>
            </button>
            <button
              onClick={togglePause}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      '#64748B',
              }}
            >
              <PauseIcon size={14} />
              {agent.active ? 'Pause' : 'Resume'}
            </button>
          </div>
        </div>

        {/* Hedera IDs grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { label: 'HCS Topic ID',  value: agent.hcsTopicId,   href: `https://hashscan.io/${NETWORK}/topic/${agent.hcsTopicId}`, icon: ActivityIcon },
            { label: 'HFS Config',    value: agent.hfsConfigId,  href: agent.hfsConfigId ? `https://hashscan.io/${NETWORK}/file/${agent.hfsConfigId}` : '#', icon: FileTextIcon },
            { label: 'Contract TxID', value: agent.contractTxId, href: agent.contractTxId ? `https://hashscan.io/${NETWORK}/transaction/${agent.contractTxId}` : '#', icon: ShieldCheckIcon },
            { label: 'Config Hash',   value: agent.configHash?.slice(0, 22) + '…', href: '#', icon: ShieldCheckIcon },
          ].map(({ label, value, href, icon: Icon }) => (
            <div key={label} className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(0,169,186,0.08)' }}
              >
                <Icon size={13} style={{ color: '#00A9BA' }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs mb-0.5" style={{ color: '#334155' }}>{label}</p>
                {value ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-mono cursor-pointer transition-colors duration-200 hover:text-white truncate"
                    style={{ color: '#00A9BA' }}
                  >
                    {value}
                    <ExternalLinkIcon size={10} className="flex-shrink-0" />
                  </a>
                ) : (
                  <span className="text-xs" style={{ color: '#1E293B' }}>—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Agent Portfolio (only if dedicated account exists) ───── */}
      {agent.agentAccountId && (
        <div className="glass-card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2" style={{ color: '#E2E8F0' }}>
              <WalletIcon size={16} style={{ color: '#00A9BA' }} />
              Agent Portfolio
            </h2>
            <a
              href={`https://hashscan.io/${NETWORK}/account/${agent.agentAccountId}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[10px] flex items-center gap-1 transition-colors hover:text-white"
              style={{ color: '#334155' }}
            >
              {agent.agentAccountId} <ExternalLinkIcon size={10} />
            </a>
          </div>

          {portfolio ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {/* HBAR balance */}
              <div className="rounded-xl p-3" style={{ background: 'rgba(0,169,186,0.06)', border: '1px solid rgba(0,169,186,0.12)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#334155' }}>HBAR Balance</p>
                <p className="text-lg font-bold font-mono" style={{ color: '#E2E8F0' }}>{portfolio.hbar.toFixed(4)}</p>
                <p className="text-[10px]" style={{ color: '#475569' }}>ℏ</p>
              </div>
              {/* tUSDT balance */}
              <div className="rounded-xl p-3" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.12)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#334155' }}>tUSDT Balance</p>
                <p className="text-lg font-bold font-mono" style={{ color: '#10B981' }}>{portfolio.tusdt.toFixed(4)}</p>
                <p className="text-[10px]" style={{ color: '#475569' }}>tUSDT</p>
              </div>
              {/* Budget */}
              <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#334155' }}>Initial Budget</p>
                <p className="text-lg font-bold font-mono" style={{ color: '#94A3B8' }}>{agent.tradingBudgetHbar.toFixed(2)}</p>
                <p className="text-[10px]" style={{ color: '#475569' }}>ℏ funded</p>
              </div>
              {/* P&L */}
              <div className="rounded-xl p-3" style={{
                background: portfolio.pnlPct === null ? 'rgba(255,255,255,0.02)' : portfolio.pnlPct >= 0 ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                border: `1px solid ${portfolio.pnlPct === null ? 'rgba(255,255,255,0.06)' : portfolio.pnlPct >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`,
              }}>
                <p className="text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1" style={{ color: '#334155' }}>
                  <TrendingUpIcon size={10} /> P&amp;L (HBAR)
                </p>
                <p className="text-lg font-bold font-mono" style={{
                  color: portfolio.pnlPct === null ? '#475569' : portfolio.pnlPct >= 0 ? '#10B981' : '#EF4444',
                }}>
                  {portfolio.pnlPct === null ? '—' : `${portfolio.pnlPct >= 0 ? '+' : ''}${portfolio.pnlPct}%`}
                </p>
                <p className="text-[10px]" style={{ color: '#475569' }}>vs initial budget</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4" style={{ color: '#334155' }}>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Fetching agent balances…</span>
            </div>
          )}

          {/* Withdraw button */}
          <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[10px]" style={{ color: '#1E293B' }}>
              Operator-signed withdrawal — no HashPack required. Funds go back to <span style={{ color: '#00A9BA' }}>{agent.ownerId}</span>.
            </p>
            <button
              onClick={withdraw}
              disabled={withdrawing || !portfolio || (portfolio.hbar < 0.1 && portfolio.tusdt < 0.01)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444' }}
            >
              {withdrawing ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLineIcon size={12} />}
              Withdraw All
            </button>
          </div>
        </div>
      )}

      {/* ── NFT Marketplace Listing ───────────────────────────────── */}
      {agent && agent.ownerId === accountId && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold flex items-center gap-2" style={{ color: '#E2E8F0' }}>
              <StoreIcon size={16} style={{ color: '#00A9BA' }} />
              NFT Marketplace
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,169,186,0.1)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.2)' }}>
              5% royalty — Hedera protocol-enforced
            </span>
          </div>

          {agent.listed ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <CheckCircle2Icon size={20} className="text-green-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-400">Listed on Marketplace</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Serial #{(agent as any).serialNumber} · {(agent as any).priceHbar ?? '?'} HBAR
                  </p>
                </div>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL?.replace('3001', '3000')}/marketplace/${agentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1"
                  style={{ background: 'rgba(0,169,186,0.1)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.2)' }}
                >
                  View <ExternalLinkIcon size={11} />
                </a>
              </div>
              <button
                onClick={delistFromMarketplace}
                disabled={delisting}
                className="w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444' }}
              >
                {delisting ? <Loader2 size={12} className="animate-spin" /> : <TagIcon size={12} />}
                Delist from Marketplace
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Mint this agent&apos;s strategy as an HTS NFT. Buyers receive a working copy of your agent. 
                Every resale automatically pays you 5% royalty — enforced at the Hedera protocol level, impossible to bypass.
              </p>

              {listingStatus === 'done' && listingResult ? (
                <div className="p-4 rounded-xl" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <p className="text-sm font-semibold text-green-400 mb-1">Listed Successfully!</p>
                  <p className="text-[11px] text-gray-400">Serial #{listingResult.serialNumber}</p>
                  <a
                    href={`https://hashscan.io/${NETWORK}/token/${listingResult.tokenId}/${listingResult.serialNumber}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-[#00A9BA] hover:underline flex items-center gap-1 mt-1"
                  >
                    View NFT on HashScan <ExternalLinkIcon size={10} />
                  </a>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Price in HBAR"
                      value={listingPrice}
                      onChange={e => setListingPrice(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm font-mono text-white placeholder-gray-600 bg-black/30 border border-white/10 focus:border-[#00A9BA]/50 outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">HBAR</span>
                  </div>
                  <button
                    onClick={listOnMarketplace}
                    disabled={listingStatus === 'loading' || !listingPrice || parseFloat(listingPrice) <= 0}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 transition-all"
                    style={{ background: 'rgba(0,169,186,0.15)', border: '1px solid rgba(0,169,186,0.3)', color: '#00A9BA' }}
                  >
                    {listingStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <StoreIcon size={14} />}
                    List as NFT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── HCS Execution History ─────────────────────────────────── */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: '#E2E8F0' }}>
            <ActivityIcon size={16} style={{ color: '#00A9BA' }} />
            HCS Execution History
          </h2>
          <div className="flex items-center gap-2 text-xs" style={{ color: '#334155' }}>
            <ShieldCheckIcon size={12} style={{ color: '#00A9BA' }} />
            Source: Hedera Mirror Node · aBFT guaranteed
          </div>
        </div>

        {history.length === 0 ? (
          <div className="py-12 text-center">
            <ClockIcon size={28} className="mx-auto mb-3" style={{ color: '#1C2333' }} />
            <p className="text-sm" style={{ color: '#334155' }}>No executions yet.</p>
            <p className="text-xs mt-1" style={{ color: '#1E293B' }}>
              {agent.executionMode === 'AUTO'
                ? 'Agent is in Auto mode — trades will execute automatically based on the BullMQ schedule.'
                : 'Click "Run Trade" to execute a live cycle or "Test Run · no swap" to simulate without spending HBAR.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((msg, i) => {
              const isExecResult = msg.decision?.signal === 'EXECUTION_RESULT';
              const execParsed   = isExecResult ? parseExecutionReasoning(msg.decision?.reasoning ?? '') : null;
              const swapTxHash   = execParsed?.txhash ?? execParsed?.tx_hash;
              const swapDir      = execParsed?.direction ?? '';
              const amtIn        = msg.decision?.indicators?.amountIn;
              const amtOut       = msg.decision?.indicators?.amountOut;
              const slippageBps  = msg.decision?.indicators?.slippageBps;

              // Key indicator values from decision messages
              const indicatorEntries = msg.decision?.indicators
                ? Object.entries(msg.decision.indicators).filter(([k]) => !['price', 'signal_strength'].includes(k))
                : [];

              return (
                <motion.div
                  key={msg.seq}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="p-3 rounded-xl"
                  style={{
                    background: isExecResult
                      ? 'rgba(16,185,129,0.04)'
                      : 'rgba(255,255,255,0.02)',
                    border: isExecResult ? '1px solid rgba(16,185,129,0.12)' : '1px solid rgba(255,255,255,0.03)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Signal badge / swap icon */}
                    {isExecResult ? (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', border: '1px solid rgba(16,185,129,0.3)', whiteSpace: 'nowrap' }}>
                        <CheckCircle2Icon size={11} />
                        SWAP DONE
                      </div>
                    ) : (
                      <SignalBadge signal={msg.decision?.signal ?? '—'} />
                    )}

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Header row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-1">
                        <span className="text-xs font-mono" style={{ color: '#E2E8F0' }}>Seq #{msg.seq}</span>

                        {!isExecResult && msg.decision?.confidence != null && (
                          <span className="text-xs" style={{ color: '#475569' }}>
                            Confidence: <span style={{ color: '#94A3B8' }}>{msg.decision.confidence}%</span>
                          </span>
                        )}
                        {!isExecResult && msg.decision?.price != null && (
                          <span className="text-xs" style={{ color: '#475569' }}>
                            Price: <span style={{ color: '#94A3B8' }}>${msg.decision.price.toFixed(6)}</span>
                          </span>
                        )}

                        {/* Swap details */}
                        {isExecResult && swapDir && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: '#64748B' }}>
                            <ArrowRightLeftIcon size={11} style={{ color: '#10B981' }} />
                            {swapDir === 'HBAR_TO_USDC' ? 'HBAR → tUSDT' : 'tUSDT → HBAR'}
                          </span>
                        )}
                        {isExecResult && amtIn != null && amtOut != null && (
                          <span className="text-xs" style={{ color: '#475569' }}>
                            <span style={{ color: '#94A3B8' }}>{(Number(amtIn) / 1e8).toFixed(4)}</span>
                            {' → '}
                            <span style={{ color: '#10B981' }}>{(Number(amtOut) / 1e6).toFixed(4)}</span>
                          </span>
                        )}
                        {isExecResult && slippageBps != null && (
                          <span className="text-xs" style={{ color: '#475569' }}>
                            Slippage: <span style={{ color: '#94A3B8' }}>{(Number(slippageBps) / 100).toFixed(2)}%</span>
                          </span>
                        )}
                      </div>

                      {/* Reasoning (decision) or tx hash (execution) */}
                      {!isExecResult && msg.decision?.reasoning && (
                        <p className="text-xs leading-relaxed mb-1.5" style={{ color: '#334155' }}>
                          {msg.decision.reasoning}
                        </p>
                      )}

                      {/* Indicator chips for decision messages */}
                      {!isExecResult && indicatorEntries.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {indicatorEntries.map(([k, v]) => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                              style={{ background: 'rgba(0,169,186,0.08)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.15)' }}>
                              {k}: {typeof v === 'number' ? v.toFixed(4) : v}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Execution: swap tx hash link */}
                      {isExecResult && swapTxHash && (
                        <a
                          href={`https://hashscan.io/${NETWORK}/transaction/${swapTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-mono mt-1 w-fit transition-colors hover:text-white"
                          style={{ color: '#10B981' }}
                        >
                          <ExternalLinkIcon size={10} />
                          {swapTxHash.slice(0, 14)}…{swapTxHash.slice(-8)} ↗ HashScan
                        </a>
                      )}
                    </div>

                    {/* Timestamp + HCS link */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                      <span className="text-[10px]" style={{ color: '#475569' }}>
                        {relativeTime(msg.timestamp)}
                      </span>
                      <a
                        href={msg.hashscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] transition-colors hover:text-white"
                        style={{ color: '#334155' }}
                      >
                        HashScan <ExternalLinkIcon size={10} />
                      </a>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Source attestation */}
        <div
          className="mt-5 pt-4 flex items-center gap-2 text-xs"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: '#1E293B' }}
        >
          <ShieldCheckIcon size={12} style={{ color: '#00A9BA' }} />
          Data sourced directly from{' '}
          <a
            href={`https://testnet.mirrornode.hedera.com/api/v1/topics/${agent.hcsTopicId}/messages`}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer transition-colors duration-200 hover:text-white"
            style={{ color: '#00A9BA' }}
          >
            Hedera Mirror Node
          </a>
          {' '}— aBFT-guaranteed, tamper-proof.
        </div>
      </div>

      {/* Trade Approval Modal */}
      {pendingTrade && (
        <TradeApprovalModal
          {...pendingTrade}
          agentId={agentId}
          hcsTopicId={agent.hcsTopicId}
          onApprove={() => {
            setPendingTrade(null);
            // Optionally refresh history here
          }}
          onReject={() => setPendingTrade(null)}
        />
      )}
    </div>
  );
}
