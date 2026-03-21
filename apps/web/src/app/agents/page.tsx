'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAgentStore } from '@/stores/agentStore';
import { useWalletStore } from '@/stores/walletStore';
import Link from 'next/link';
import {
  BotIcon, ActivityIcon, TrendingUpIcon, ExternalLinkIcon, BarChart2Icon,
} from 'lucide-react';
import { hashscanUrl, fmtTimestamp } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';

export default function AgentsDashboardPage() {
  const { agents, setAgents, liveSignals, isLoading, setLoading } = useAgentStore();
  const { accountId, isConnected } = useWalletStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !accountId) return;
    setLoading(true);
    fetch(`${API_URL}/api/agents?ownerId=${accountId}`)
      .then(r => r.json())
      .then(d => { if (d.agents) setAgents(d.agents); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isConnected, accountId, setAgents, setLoading]);

  const selected = agents.find(a => a.id === selectedId);
  const agentSignals = liveSignals.filter(s => s.agentId === selectedId);

  if (!isConnected) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-center">
          <BotIcon size={36} className="mx-auto mb-4" style={{ color: '#1C2333' }} />
          <p className="font-semibold mb-1" style={{ color: '#334155' }}>Not connected</p>
          <Link href="/wallet" className="text-sm" style={{ color: '#00A9BA' }}>
            Connect wallet to view agents →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex" style={{ background: 'var(--ta-bg)' }}>
      {/* ── Agents list sidebar ──────────────────────────────── */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col overflow-y-auto"
        style={{ borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(13,27,42,0.5)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-semibold" style={{ color: '#E2E8F0' }}>My Agents</h2>
          <p className="text-xs mt-0.5" style={{ color: '#334155' }}>{agents.length} deployed</p>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="h-16 rounded-xl shimmer" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs" style={{ color: '#334155' }}>No agents yet.</p>
            <Link href="/create" className="text-xs mt-2 block" style={{ color: '#00A9BA' }}>
              Create one →
            </Link>
          </div>
        ) : (
          <div className="p-2">
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setSelectedId(agent.id)}
                className="w-full text-left p-3 rounded-xl mb-1 cursor-pointer transition-all duration-200"
                style={{
                  background: selectedId === agent.id ? 'rgba(0,169,186,0.1)' : 'transparent',
                  border: `1px solid ${selectedId === agent.id ? 'rgba(0,169,186,0.25)' : 'transparent'}`,
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate pr-2" style={{ color: '#E2E8F0' }}>
                    {agent.name}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: agent.active ? '#10B981' : '#334155' }}
                  />
                </div>
                <span className="text-xs" style={{ color: '#475569' }}>
                  {agent.strategyType.replace('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Detail panel ──────────────────────────────────────── */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full">
            <BotIcon size={48} style={{ color: '#1C2333', marginBottom: 16 }} />
            <p className="font-semibold" style={{ color: '#1E293B' }}>Select an agent to view details</p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-5">
            {/* Header */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-xl font-display font-bold mb-1" style={{ color: '#E2E8F0' }}>
                    {selected.name}
                  </h1>
                  <p className="text-sm" style={{ color: '#475569' }}>
                    {selected.strategyType.replace('_', ' ')}
                  </p>
                </div>
                <Link
                  href={`/agents/${selected.id}`}
                  className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all duration-200"
                  style={{ background: 'rgba(0,169,186,0.08)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.25)' }}
                >
                  Full Detail →
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {[
                  { label: 'Status',    value: selected.active ? 'Active' : 'Paused', color: selected.active ? '#10B981' : '#64748B' },
                  { label: 'Executions', value: selected.executions, color: '#00A9BA' },
                  { label: 'Listed',    value: selected.listed ? 'Yes' : 'No', color: selected.listed ? '#F59E0B' : '#334155' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <p className="text-xs mb-1" style={{ color: '#334155' }}>{label}</p>
                    <p className="font-bold" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Hedera IDs */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }} className="glass-card p-5">
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#E2E8F0' }}>Hedera IDs</h2>
              <div className="space-y-2">
                {[
                  { label: 'HCS Topic ID',  value: selected.hcsTopicId,   type: 'topic' as const },
                  { label: 'HFS Config',    value: selected.hfsConfigId,  type: 'file' as const },
                ].map(({ label, value, type }) => value && (
                  <div key={label} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-xs" style={{ color: '#334155' }}>{label}</span>
                    <a
                      href={hashscanUrl(value, type, NETWORK)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-mono cursor-pointer transition-colors duration-200 hover:text-white"
                      style={{ color: '#00A9BA' }}
                    >
                      {value}
                      <ExternalLinkIcon size={10} />
                    </a>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Live signal feed for this agent */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }} className="glass-card p-5">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#E2E8F0' }}>
                <ActivityIcon size={14} style={{ color: '#00A9BA' }} />
                Live HCS Signals
              </h2>
              {agentSignals.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: '#1E293B' }}>
                  No signals yet for this agent.
                </p>
              ) : (
                <div className="space-y-2">
                  {agentSignals.slice(0, 15).map((s, i) => {
                    const colorMap: Record<string, string> = { BUY: '#10B981', SELL: '#EF4444', HOLD: '#EAB308' };
                    const c = colorMap[s.decision?.signal ?? ''] ?? '#475569';
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-2 rounded-lg text-xs"
                        style={{ background: 'rgba(255,255,255,0.02)' }}
                      >
                        <span className="font-bold" style={{ color: c }}>{s.decision?.signal ?? '—'}</span>
                        <span style={{ color: '#475569' }}>Seq #{s.seq}</span>
                        <span className="ml-auto font-mono" style={{ color: '#334155' }}>
                          {fmtTimestamp(s.timestamp)}
                        </span>
                        <a href={s.hashscanUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#334155' }}>
                          <ExternalLinkIcon size={11} />
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
