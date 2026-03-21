'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRightIcon, ShieldCheckIcon, ZapIcon, TrendingUpIcon, ActivityIcon } from 'lucide-react';

const STATS = [
  { label: 'HCS Messages', value: '2.4M+',  sub: 'tamper-proof signals' },
  { label: 'AI Decisions', value: '18,432',  sub: 'executed on-chain' },
  { label: 'Active Agents', value: '347',    sub: 'live & trading' },
  { label: 'Strategy NFTs', value: '89',     sub: 'on marketplace' },
];

const FEATURES = [
  {
    icon: ZapIcon,
    title: 'AI Agent Engine',
    desc: 'Gemini 1.5 Flash + LangGraph ReAct loop makes trading decisions in milliseconds using live Pyth price feeds.',
    color: '#00A9BA',
  },
  {
    icon: ShieldCheckIcon,
    title: 'HCS Audit Trail',
    desc: 'Every decision is written to Hedera Consensus Service before any trade executes. aBFT-guaranteed, tamper-proof.',
    color: '#F59E0B',
  },
  {
    icon: TrendingUpIcon,
    title: 'SaucerSwap DEX',
    desc: 'Agents trade HBAR/USDC on SaucerSwap V2 via the Hedera Agent Kit — slippage-controlled, on-chain settlement.',
    color: '#10B981',
  },
  {
    icon: ActivityIcon,
    title: 'Strategy Marketplace',
    desc: 'List your agent as an HTS NFT with 5% royalty enforced at protocol level. Performance verified via Mirror Node.',
    color: '#8B5CF6',
  },
];

const container = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.4 } } };

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--ta-bg)' }}>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center overflow-hidden" style={{ padding: '80px 24px 64px', minHeight: '90vh' }}>
        {/* Ambient glow blobs */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
        >
          <div
            style={{
              position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
              width: 600, height: 600, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,169,186,0.12) 0%, transparent 70%)',
            }}
          />
          <div
            style={{
              position: 'absolute', top: '40%', right: '10%',
              width: 300, height: 300, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(245,158,11,0.07) 0%, transparent 70%)',
            }}
          />
        </div>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 text-xs font-semibold"
          style={{
            background: 'rgba(0,169,186,0.1)',
            border: '1px solid rgba(0,169,186,0.3)',
            color: '#00A9BA',
          }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: '#00A9BA' }} />
          Hedera APEX Hackathon 2026 · Track 1: AI & Agents
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(1.8rem, 5vw, 4.5rem)', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.01em', marginBottom: 24, maxWidth: 800, color: '#E2E8F0' }}
        >
          Deploy AI Trading Agents
          <br />
          <span className="gradient-text">On-Chain, Verifiable</span>
        </motion.h1>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl max-w-2xl mb-10"
          style={{ color: '#64748B', lineHeight: 1.7 }}
        >
          Every decision written to Hedera HCS <em>before</em> any trade executes.
          aBFT-guaranteed audit trail. No trust required — verify on HashScan.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <Link
            href="/create"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, #00A9BA, #1565C0)',
              color: '#fff',
              boxShadow: '0 0 24px rgba(0,169,186,0.35)',
            }}
          >
            Create Your Agent
            <ArrowRightIcon size={16} />
          </Link>
          <Link
            href="/marketplace"
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200"
            style={{
              color: '#94A3B8',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            Browse Marketplace
          </Link>
        </motion.div>
      </section>

      {/* ── Stats row ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          {STATS.map((s) => (
            <motion.div
              key={s.label}
              variants={item}
              className="glass-card p-5 text-center"
            >
              <p className="font-display text-2xl font-bold" style={{ color: '#00A9BA' }}>{s.value}</p>
              <p className="text-xs font-semibold mt-1" style={{ color: '#E2E8F0' }}>{s.label}</p>
              <p className="text-xs mt-0.5" style={{ color: '#475569' }}>{s.sub}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── Features ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <motion.h2
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-2xl font-display font-bold mb-10 text-center"
          style={{ color: '#E2E8F0' }}
        >
          Built on <span style={{ color: '#00A9BA' }}>Hedera's</span> Full Stack
        </motion.h2>
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-6"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={item}
              className="glass-card p-6 flex gap-4 cursor-default"
            >
              <div
                className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center"
                style={{ background: `${f.color}18` }}
              >
                <f.icon size={20} style={{ color: f.color }} />
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-1.5" style={{ color: '#E2E8F0' }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── HCS invariant callout ───────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-4 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card p-8 text-center"
          style={{
            background: 'rgba(0,169,186,0.04)',
            border: '1px solid rgba(0,169,186,0.2)',
          }}
        >
          <ShieldCheckIcon size={36} className="mx-auto mb-4" style={{ color: '#00A9BA' }} />
          <h2 className="font-display text-xl font-bold mb-3" style={{ color: '#E2E8F0' }}>
            The HCS Write-Before-Trade Invariant
          </h2>
          <p className="text-sm max-w-2xl mx-auto" style={{ color: '#64748B', lineHeight: 1.8 }}>
            Every AI decision is written to Hedera Consensus Service <strong style={{ color: '#94A3B8' }}>before</strong> any
            swap executes on SaucerSwap. This is enforced in code — not just a policy. If HCS write fails, the trade
            does not happen. Verify any execution on HashScan in one click.
          </p>
          <Link
            href="https://hashscan.io/testnet"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200"
            style={{
              color: '#00A9BA',
              border: '1px solid rgba(0,169,186,0.3)',
              background: 'rgba(0,169,186,0.08)',
            }}
          >
            Open HashScan
            <ArrowRightIcon size={14} />
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
