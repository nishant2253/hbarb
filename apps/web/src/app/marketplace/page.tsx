'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import Link from 'next/link';
import {
  TrendingUpIcon, UsersIcon, BarChart2Icon, ExternalLinkIcon,
  SearchIcon, SlidersIcon, ZapIcon, ShieldCheckIcon,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';

const API_URL  = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';

const STRATEGIES = ['all', 'TREND_FOLLOW', 'MEAN_REVERT', 'BREAKOUT', 'MOMENTUM', 'SWING'];

// ── Generate gradient avatar from agent name ──────────────────────
function AgentAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, hsl(${hue},70%,40%), hsl(${(hue+80)%360},70%,55%))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.4, fontWeight: 700, color: '#fff', fontFamily: 'Orbitron, monospace',
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function MarketplacePage() {
  const { listings, filter, sort, isLoading, setListings, setFilter, setSort, setLoading } = useMarketplaceStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/api/marketplace`)
      .then(r => r.json())
      .then(d => { if (d.listings) setListings(d.listings); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setListings, setLoading]);

  // Filter + sort
  const visible = listings
    .filter(l => filter === 'all' || l.strategyType === filter)
    .filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'winRate')   return (b.winRate ?? 0) - (a.winRate ?? 0);
      if (sort === 'priceHbar') return (a.priceHbar ?? 0) - (b.priceHbar ?? 0);
      if (sort === 'executions')return b.executions - a.executions;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-6xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold mb-2" style={{ color: '#E2E8F0' }}>
          Agents Marketplace
        </h1>
        <p className="text-sm" style={{ color: '#475569' }}>
          Community-built strategies. Performance verified on Hedera HCS — tamper-proof.
        </p>
      </div>

      {/* ── Filters row ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div
          className="flex items-center gap-2 flex-1 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <SearchIcon size={14} style={{ color: '#475569' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: '#E2E8F0' }}
          />
        </div>

        {/* Strategy filter pills */}
        <div className="flex gap-2 overflow-x-auto">
          {STRATEGIES.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="flex-shrink-0 text-xs px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 font-medium"
              style={{
                background: filter === s ? 'rgba(0,169,186,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${filter === s ? 'rgba(0,169,186,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color: filter === s ? '#00A9BA' : '#64748B',
              }}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <SlidersIcon size={14} style={{ color: '#475569' }} />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as 'winRate' | 'priceHbar' | 'executions' | 'createdAt')}
            className="text-xs px-3 py-2 rounded-xl cursor-pointer outline-none"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#94A3B8',
            }}
          >
            <option value="winRate">Win Rate</option>
            <option value="executions">Most Executed</option>
            <option value="priceHbar">Price: Low-High</option>
            <option value="createdAt">Newest</option>
          </select>
        </div>
      </div>

      {/* ── Grid ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card p-4 h-28 shimmer" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-24 text-center">
          <ZapIcon size={32} className="mx-auto mb-4" style={{ color: '#1C2333' }} />
          <p className="font-semibold mb-1" style={{ color: '#334155' }}>No agents listed yet</p>
          <p className="text-sm" style={{ color: '#1E293B' }}>
            Deploy an agent and list it as an NFT strategy!
          </p>
          <Link
            href="/create"
            className="inline-block mt-4 text-sm cursor-pointer"
            style={{ color: '#00A9BA' }}
          >
            Create Agent →
          </Link>
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05 } },
          }}
        >
          {visible.map((agent, i) => (
            <motion.div
              key={agent.id}
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}
            >
              <Link href={`/marketplace/${agent.id}`} className="block cursor-pointer">
        <div className="glass-card p-4 transition-all duration-200 hover:border-[#00A9BA]/40">
                  {/* Card Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <AgentAvatar name={agent.name} />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate" style={{ color: '#E2E8F0' }}>
                        {agent.name}
                      </h3>
                      <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
                        {agent.strategyType.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold" style={{ color: '#00A9BA' }}>
                        {agent.priceHbar ? `${agent.priceHbar} ℏ` : '—'}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        ≈ ${((agent.priceHbar ?? 0) * 0.08).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* 6 Performance Stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: 'Win Rate',     value: agent.winRate != null ? `${Number(agent.winRate).toFixed(1)}%` : '—',     color: (agent.winRate ?? 0) > 50 ? '#22C55E' : '#F59E0B' },
                      { label: 'Profit Factor',value: agent.profitFactor != null ? Number(agent.profitFactor).toFixed(2) : '—', color: (agent.profitFactor ?? 0) > 1.5 ? '#22C55E' : '#F59E0B' },
                      { label: 'Sharpe',       value: agent.sharpeRatio != null ? Number(agent.sharpeRatio).toFixed(2) : '—',   color: (agent.sharpeRatio ?? 0) > 1 ? '#22C55E' : '#F59E0B' },
                      { label: 'Trades',       value: agent.executions ?? 0,                                                     color: '#00A9BA' },
                      { label: 'Avg Win',      value: agent.avgWin != null ? `+${Number(agent.avgWin).toFixed(1)}%` : '—',       color: '#22C55E' },
                      { label: 'Avg Loss',     value: agent.avgLoss != null ? `-${Number(agent.avgLoss).toFixed(1)}%` : '—',     color: '#EF4444' },
                    ].map(s => (
                      <div key={s.label} className="bg-[#0A1628] rounded-lg p-2 text-center">
                        <p className="text-[9px] text-gray-600 mb-0.5">{s.label}</p>
                        <p className="text-xs font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Mini equity sparkline */}
                  {Array.isArray((agent as any).equitySparkline) && (agent as any).equitySparkline.length > 1 && (
                    <div className="h-12 mb-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={(agent as any).equitySparkline}>
                          <defs>
                            <linearGradient id={`spk-${agent.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#00A9BA" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#00A9BA" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area
                            type="monotone" dataKey="equity"
                            stroke="#00A9BA" strokeWidth={1.5}
                            fill={`url(#spk-${agent.id})`}
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[10px]" style={{ color: '#00A9BA' }}>
                      <ShieldCheckIcon size={10} />
                      <span>{agent.executions} HCS decisions</span>
                    </div>
                    <a
                      href={agent.hashscanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[10px] hover:text-white transition-colors"
                      style={{ color: '#334155' }}
                    >
                      HashScan
                      <ExternalLinkIcon size={9} />
                    </a>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Collection stats footer */}
      <div className="mt-10 text-center text-xs" style={{ color: '#1E293B' }}>
        5% royalty on secondary sales · Enforced by Hedera protocol · Cannot be bypassed
      </div>
    </div>
  );
}
