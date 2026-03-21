'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import Link from 'next/link';
import {
  TrendingUpIcon, UsersIcon, BarChart2Icon, ExternalLinkIcon,
  SearchIcon, SlidersIcon, ZapIcon,
} from 'lucide-react';

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
                <div
                  className="glass-card p-4 flex items-center gap-4 transition-all duration-200 hover:border-[#00A9BA]/40"
                >
                  {/* Avatar */}
                  <AgentAvatar name={agent.name} />

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-semibold text-sm truncate pr-2" style={{ color: '#E2E8F0' }}>
                        {agent.name}
                      </h3>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: 'rgba(0,169,186,0.1)',
                          color: '#00A9BA',
                          border: '1px solid rgba(0,169,186,0.2)',
                        }}
                      >
                        {agent.strategyType.replace('_',' ')}
                      </span>
                    </div>

                    {/* Stats row — mirrors Walbi layout */}
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div>
                        <p className="text-[10px] mb-0.5" style={{ color: '#334155' }}>Turnover</p>
                        <p className="text-sm font-bold" style={{ color: '#E2E8F0' }}>
                          {agent.priceHbar ? `${agent.priceHbar} ℏ` : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] mb-0.5" style={{ color: '#334155' }}>Executions</p>
                        <p className="text-sm font-bold" style={{ color: '#E2E8F0' }}>{agent.executions}</p>
                      </div>
                      <div>
                        <p className="text-[10px] mb-0.5" style={{ color: '#334155' }}>Win Rate</p>
                        <p
                          className="text-sm font-bold"
                          style={{ color: agent.winRate > 60 ? '#10B981' : agent.winRate > 40 ? '#EAB308' : '#EF4444' }}
                        >
                          {agent.winRate}%
                        </p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3">
                      <span className="badge-hcs">Verified on HCS</span>
                      <a
                        href={agent.hashscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs cursor-pointer transition-colors duration-200 hover:text-white"
                        style={{ color: '#334155' }}
                      >
                        HashScan
                        <ExternalLinkIcon size={11} />
                      </a>
                    </div>
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
