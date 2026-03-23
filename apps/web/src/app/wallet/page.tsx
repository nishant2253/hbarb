'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '@/stores/walletStore';
import { useAgentStore } from '@/stores/agentStore';
import { WalletConnectButton } from '@/components/WalletConnect';
import Link from 'next/link';
import {
  WalletIcon, CopyIcon, ExternalLinkIcon, TrendingUpIcon,
  ActivityIcon, BotIcon, BarChart3Icon,
} from 'lucide-react';
import { TxHistoryPanel } from '@/components/TxHistoryPanel';

const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';
const API_URL  = process.env.NEXT_PUBLIC_API_URL || '';

const ALLOCATION_CARDS = [
  { label: 'HBAR Balance', key: 'balance', color: '#00A9BA', icon: WalletIcon },
  { label: 'Active Agents', key: 'agents',  color: '#1565C0', icon: BotIcon },
  { label: 'HCS Signals',  key: 'signals', color: '#10B981', icon: ActivityIcon },
  { label: 'Strategies',  key: 'listed',  color: '#F59E0B', icon: TrendingUpIcon },
];

function CopyButton({ text }: { text: string }) {
  const copy = () => navigator.clipboard.writeText(text);
  return (
    <button onClick={copy} className="cursor-pointer transition-colors duration-200 hover:text-white" style={{ color: '#475569' }} title="Copy">
      <CopyIcon size={14} />
    </button>
  );
}

export default function WalletPage() {
  const { accountId, hbarBalance, isConnected, setWallet } = useWalletStore();
  const { agents, liveSignals, setAgents } = useAgentStore();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);



  // Fetch agents when connected
  useEffect(() => {
    if (!isConnected || !accountId) return;
    fetch(`${API_URL}/api/agents?ownerId=${accountId}`)
      .then(r => r.json())
      .then(d => { if (d.agents) setAgents(d.agents); })
      .catch(() => {});
  }, [isConnected, accountId, setAgents]);

  const allocValues: Record<string, string | number> = {
    balance: `${hbarBalance.toFixed(2)} ℏ`,
    agents:  agents.length,
    signals: liveSignals.length,
    listed:  agents.filter(a => a.listed).length,
  };

  if (!isConnected) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="glass-card p-10 text-center max-w-sm w-full"
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.25)' }}
          >
            <WalletIcon size={28} style={{ color: '#00A9BA' }} />
          </div>
          <h1 className="text-xl font-bold mb-2 font-display" style={{ color: '#E2E8F0' }}>Connect Your Wallet</h1>
          <p className="text-sm mb-8" style={{ color: '#475569' }}>Connect your Hedera account to view balances and manage agents.</p>
          <div className="flex justify-center w-full mt-4">
            <WalletConnectButton />
          </div>
          <p className="text-xs mt-3" style={{ color: '#334155' }}>HashPack · Blade · WalletConnect</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-6xl mx-auto">
      {/* ── Header: Total value ────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <p className="text-sm mb-1" style={{ color: '#475569' }}>Estimated total value</p>
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-5xl font-bold" style={{ color: '#E2E8F0' }}>
            {hbarBalance.toFixed(2)}
          </h1>
          <span className="text-2xl" style={{ color: '#475569' }}>HBAR</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm font-mono" style={{ color: '#00A9BA' }}>{accountId}</span>
          <CopyButton text={accountId!} />
          <a
            href={`https://hashscan.io/${NETWORK}/account/${accountId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer transition-colors duration-200 hover:text-white"
            style={{ color: '#475569' }}
            title="View on HashScan"
          >
            <ExternalLinkIcon size={14} />
          </a>
        </div>
      </motion.div>

      {/* ── Allocation cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {ALLOCATION_CARDS.map((card, i) => (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
            className="glass-card p-4 cursor-default"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{ background: `${card.color}18` }}
            >
              <card.icon size={16} style={{ color: card.color }} />
            </div>
            <p className="text-xs mb-1" style={{ color: '#475569' }}>{card.label}</p>
            <p className="text-xl font-bold font-display" style={{ color: card.color }}>
              {allocValues[card.key]}
            </p>
          </motion.div>
        ))}
      </div>

      {/* ── My agents table ──────────────────────────────────────── */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: '#E2E8F0' }}>
            <BotIcon size={16} style={{ color: '#00A9BA' }} />
            My Agents
          </h2>
          <Link
            href="/agents"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
            style={{ background: 'rgba(0,169,186,0.1)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.25)' }}
          >
            View Agents
          </Link>
        </div>

        {agents.length === 0 ? (
          <div className="py-12 text-center">
            <BotIcon size={32} className="mx-auto mb-3" style={{ color: '#1C2333' }} />
            <p className="text-sm" style={{ color: '#334155' }}>No agents deployed yet.</p>
            <p className="text-xs mt-2" style={{ color: '#475569' }}>Contact the operator to deploy a new agent.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Name','Strategy','Topic ID','Status','Executions',''].map(h => (
                    <th key={h} className="pb-3 text-left text-xs font-medium" style={{ color: '#475569' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((agent, i) => (
                  <tr
                    key={agent.id}
                    style={{ borderBottom: i < agents.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                  >
                    <td className="py-3 font-medium" style={{ color: '#E2E8F0' }}>{agent.name}</td>
                    <td className="py-3 text-xs" style={{ color: '#64748B' }}>{agent.strategyType}</td>
                    <td className="py-3">
                      <a
                        href={`https://hashscan.io/${NETWORK}/topic/${agent.hcsTopicId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 cursor-pointer transition-colors duration-200 hover:text-white"
                        style={{ color: '#00A9BA', fontFamily: 'monospace', fontSize: 11 }}
                      >
                        {agent.hcsTopicId}
                        <ExternalLinkIcon size={11} />
                      </a>
                    </td>
                    <td className="py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: agent.active ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
                          color: agent.active ? '#10B981' : '#64748B',
                          border: `1px solid ${agent.active ? 'rgba(16,185,129,0.25)' : 'rgba(100,116,139,0.25)'}`,
                        }}
                      >
                        {agent.active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="py-3 text-sm" style={{ color: '#64748B' }}>{agent.executions}</td>
                    <td className="py-3">
                      <Link
                        href={`/agents/${agent.id}`}
                        className="text-xs cursor-pointer transition-colors duration-200 hover:text-white"
                        style={{ color: '#475569' }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Transaction Audit Log ───────────────────────────────── */}
      <div className="mb-6">
        <TxHistoryPanel ownerId={accountId!} />
      </div>

      {/* ── Live HCS signals feed ────────────────────────────────── */}
      <div className="glass-card p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2" style={{ color: '#E2E8F0' }}>
          <div className="live-dot w-2 h-2 rounded-full" style={{ background: '#10B981' }} />
          Live HCS Signal Feed
        </h2>
        {liveSignals.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: '#334155' }}>
            No signals yet. Deploy an agent to start receiving decisions.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {liveSignals.slice(0, 20).map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-lg text-xs"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                <span
                  className="px-2 py-0.5 rounded font-bold"
                  style={{
                    background: s.decision?.signal === 'BUY' ? 'rgba(16,185,129,0.15)' : s.decision?.signal === 'SELL' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
                    color: s.decision?.signal === 'BUY' ? '#10B981' : s.decision?.signal === 'SELL' ? '#EF4444' : '#EAB308',
                  }}
                >
                  {s.decision?.signal ?? '—'}
                </span>
                <span style={{ color: '#64748B' }}>{s.agentName}</span>
                <span className="ml-auto" style={{ color: '#334155', fontFamily: 'monospace' }}>
                  #{s.seq}
                </span>
                <a
                  href={s.hashscanUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="cursor-pointer hover:text-white transition-colors duration-200"
                  style={{ color: '#475569' }}
                >
                  <ExternalLinkIcon size={12} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
