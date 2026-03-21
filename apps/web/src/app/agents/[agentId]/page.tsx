'use client';

import { useEffect, useState, use } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeftIcon, ExternalLinkIcon, PlayIcon, PauseIcon,
  ShieldCheckIcon, FileTextIcon, ActivityIcon, ClockIcon,
} from 'lucide-react';

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
  } | null;
  hashscanUrl: string;
}

interface AgentDetail {
  id:           string;
  name:         string;
  ownerId:      string;
  strategyType: string;
  hcsTopicId:   string;
  hfsConfigId:  string | null;
  contractTxId: string | null;
  hcs10TopicId: string | null;
  active:       boolean;
  listed:       boolean;
  configHash:   string;
  createdAt:    string;
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
  const [agent,   setAgent]   = useState<AgentDetail | null>(null);
  const [history, setHistory] = useState<HCSMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/agents/${agentId}`).then(r => r.json()),
      fetch(`${API_URL}/api/agents/${agentId}/history?limit=50`).then(r => r.json()),
    ]).then(([agentData, historyData]) => {
      setAgent(agentData);
      setHistory(historyData.history ?? []);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId]);

  const triggerRun = async (dryRun = true) => {
    setRunning(true);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      // Prepend result to history feed
      setHistory(h => [{
        seq:       parseInt(data.hcsSequenceNumber),
        timestamp: data.hcsTimestamp,
        decision:  { signal: data.signal, confidence: data.confidence, price: data.price, reasoning: data.reasoning },
        hashscanUrl: `https://hashscan.io/${NETWORK}/topic/${agent?.hcsTopicId}`,
      }, ...h]);
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
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
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
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
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => triggerRun(true)}
              disabled={running}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 disabled:opacity-50"
              style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.25)', color: '#00A9BA' }}
            >
              <PlayIcon size={14} />
              {running ? 'Running…' : 'Dry Run'}
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
            <p className="text-xs mt-1" style={{ color: '#1E293B' }}>Click "Dry Run" to test your agent, or wait for the BullMQ cron cycle.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((msg, i) => (
              <motion.div
                key={msg.seq}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                {/* Signal */}
                <SignalBadge signal={msg.decision?.signal ?? '—'} />

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs" style={{ color: '#E2E8F0', fontFamily: 'monospace' }}>
                      Seq #{msg.seq}
                    </span>
                    {msg.decision?.confidence != null && (
                      <span className="text-xs" style={{ color: '#475569' }}>
                        Confidence: <span style={{ color: '#94A3B8' }}>{msg.decision.confidence}%</span>
                      </span>
                    )}
                    {msg.decision?.price != null && (
                      <span className="text-xs" style={{ color: '#475569' }}>
                        Price: <span style={{ color: '#94A3B8' }}>${msg.decision.price.toFixed(4)}</span>
                      </span>
                    )}
                  </div>
                  {msg.decision?.reasoning && (
                    <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>
                      {msg.decision.reasoning}
                    </p>
                  )}
                </div>

                {/* Timestamp + HashScan link */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                  <span className="text-[10px]" style={{ color: '#1E293B', fontFamily: 'monospace' }}>
                    {new Date(parseFloat(msg.timestamp) * 1000).toLocaleTimeString()}
                  </span>
                  <a
                    href={msg.hashscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] cursor-pointer transition-colors duration-200 hover:text-white"
                    style={{ color: '#334155' }}
                  >
                    HashScan
                    <ExternalLinkIcon size={10} />
                  </a>
                </div>
              </motion.div>
            ))}
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
    </div>
  );
}
