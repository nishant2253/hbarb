'use client';

import { useEffect, useState, use } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeftIcon, ExternalLinkIcon, ShoppingCartIcon,
  ShieldCheckIcon, TrendingUpIcon, ActivityIcon, BarChart2Icon,
} from 'lucide-react';
import { hashscanUrl, fmtTimestamp } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const NETWORK  = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';

interface ListingDetail {
  id:            string;
  name:          string;
  ownerId:       string;
  strategyType:  string;
  hcsTopicId:    string;
  serialNumber:  number | null;
  priceHbar:     number | null;
  ipfsCID:       string | null;
  winRate:       number;
  executions:    number;
  recentSignals: Array<{ signal: string; confidence: number }>;
  hashscanUrl:   string;
  createdAt:     string;
}

function AgentAvatar({ name, size = 64 }: { name: string; size?: number }) {
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: `linear-gradient(135deg, hsl(${hue},70%,40%), hsl(${(hue + 80) % 360},70%,55%))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.35, fontWeight: 700, color: '#fff',
        fontFamily: 'Orbitron, monospace', flexShrink: 0,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

import { 
  TransferTransaction, TokenAssociateTransaction,
  TokenId, NftId, AccountId, Hbar,
} from "@hashgraph/sdk";
import { useRouter } from 'next/navigation';
import { useWalletStore } from '@/stores/walletStore';
import { fetchBalances } from '@/lib/balance';

// Read strategy NFT token ID from env (set after NFT collection is created)
const STRATEGY_TOKEN_ID =
  process.env.NEXT_PUBLIC_STRATEGY_TOKEN_ID || '0.0.8316389';

export default function MarketplaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router  = useRouter();
  const [listing,   setListing]   = useState<ListingDetail | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [buying,    setBuying]    = useState(false);
  const [buyPhase,  setBuyPhase]  = useState<string>('');
  const [bought,    setBought]    = useState(false);
  const [clonedId,  setClonedId]  = useState<string | null>(null);
  const { signer, accountId, setBalances } = useWalletStore();

  useEffect(() => {
    fetch(`${API_URL}/api/marketplace/${id}`)
      .then(r => r.json())
      .then(d => setListing(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleBuy = async () => {
    if (!signer || !accountId || !listing || !listing.serialNumber) return;
    
    setBuying(true);
    try {
      const strategyTokenId = TokenId.fromString(STRATEGY_TOKEN_ID);
      const buyerAcctId     = AccountId.fromString(accountId);
      const sellerAcctId    = AccountId.fromString(listing.ownerId);
      const priceTinybars   = Math.floor((listing.priceHbar || 0) * 1e8);

      // ── Step 1: Associate strategy NFT token with buyer's wallet ──
      // Required before HTS can transfer the NFT to this account.
      setBuyPhase('Associating strategy NFT token…');
      try {
        const assocTx = await new TokenAssociateTransaction()
          .setAccountId(buyerAcctId)
          .setTokenIds([strategyTokenId])
          .setMaxTransactionFee(new Hbar(2))
          .freezeWithSigner(signer);
        const assocResp = await assocTx.executeWithSigner(signer);
        await assocResp.getReceiptWithSigner(signer);
      } catch (assocErr: any) {
        // TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT is fine — skip
        if (!assocErr?.message?.includes('TOKEN_ALREADY_ASSOCIATED')) {
          throw assocErr;
        }
      }

      // ── Step 2: Atomic swap — HBAR from buyer → seller, NFT from seller → buyer
      // Hedera HTS auto-deducts 5% royalty at protocol level (buyer pays gross amount)
      setBuyPhase('Confirming NFT purchase on Hedera…');
      const atomicSwapTx = await new TransferTransaction()
        .addHbarTransfer(buyerAcctId,  Hbar.fromTinybars(-priceTinybars))
        .addHbarTransfer(sellerAcctId, Hbar.fromTinybars(priceTinybars))
        .addNftTransfer(new NftId(strategyTokenId, listing.serialNumber), sellerAcctId, buyerAcctId)
        .setMaxTransactionFee(new Hbar(10))
        .freezeWithSigner(signer);

      const response = await atomicSwapTx.executeWithSigner(signer);
      await response.getReceiptWithSigner(signer);

      // ── Step 3: Tell backend to clone agent for buyer ─────────────
      setBuyPhase('Setting up your agent copy…');
      const postRes = await fetch(`${API_URL}/api/marketplace/post-purchase`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tokenId:        STRATEGY_TOKEN_ID,
          serialNumber:   listing.serialNumber,
          buyerAccountId: accountId,
          txId:           response.transactionId?.toString() ?? '',
        }),
      });
      if (!postRes.ok) throw new Error('Backend post-purchase failed');
      const postData = await postRes.json();
      setClonedId(postData.clonedAgentId);

      setBought(true);
      setBuyPhase('');

      // Refresh balances
      const b = await fetchBalances(accountId);
      setBalances(b.hbar, b.tusdt);

      // Auto-redirect to the new agent after 3 seconds
      if (postData.clonedAgentId) {
        setTimeout(() => router.push(`/agents/${postData.clonedAgentId}`), 3000);
      }
    } catch (err: any) {
      console.error('NFT Purchase failed:', err);
      setBuyPhase('');
      if (err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
        alert('Purchase cancelled: Transaction rejected in wallet.');
      } else {
        alert(`Purchase failed: ${err.message}`);
      }
    } finally {
      setBuying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: '#00A9BA', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="text-center">
          <p style={{ color: '#334155' }}>Listing not found</p>
          <Link href="/marketplace" className="text-sm mt-2 block" style={{ color: '#00A9BA' }}>
            ← Back to Marketplace
          </Link>
        </div>
      </div>
    );
  }

  const signals = listing.recentSignals ?? [];
  const buySell = signals.reduce((acc, s) => {
    if (s.signal === 'BUY')  acc.buy++;
    if (s.signal === 'SELL') acc.sell++;
    return acc;
  }, { buy: 0, sell: 0 });

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-5xl mx-auto">
      {/* Back */}
      <Link
        href="/marketplace"
        className="flex items-center gap-2 text-sm mb-6 cursor-pointer transition-colors duration-200 hover:text-white w-fit"
        style={{ color: '#475569' }}
      >
        <ArrowLeftIcon size={14} />
        Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Agent card ────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Header card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6"
          >
            <div className="flex items-start gap-5">
              <AgentAvatar name={listing.name} />
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-display font-bold mb-1" style={{ color: '#E2E8F0' }}>
                  {listing.name}
                </h1>
                <p className="text-sm mb-3" style={{ color: '#475569' }}>
                  {listing.strategyType.replace(/_/g, ' ')} Strategy
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="badge-hcs">Verified on HCS</span>
                  {listing.serialNumber && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(139,92,246,0.12)', color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.25)' }}
                    >
                      NFT #{listing.serialNumber}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stat trio */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {[
                { label: 'Win Rate',    value: `${listing.winRate}%`,   color: listing.winRate > 60 ? '#10B981' : listing.winRate > 40 ? '#EAB308' : '#EF4444', icon: TrendingUpIcon },
                { label: 'Executions', value: listing.executions,       color: '#00A9BA', icon: ActivityIcon },
                { label: 'Buy / Sell', value: `${buySell.buy} / ${buySell.sell}`, color: '#F59E0B', icon: BarChart2Icon },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="text-center">
                  <Icon size={16} className="mx-auto mb-1.5" style={{ color }} />
                  <p className="text-lg font-bold font-display" style={{ color }}>{value}</p>
                  <p className="text-xs" style={{ color: '#334155' }}>{label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* HCS info */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-5"
          >
            <h2 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: '#E2E8F0' }}>
              <ShieldCheckIcon size={15} style={{ color: '#00A9BA' }} />
              On-Chain Verification
            </h2>
            <div className="space-y-3">
              {[
                { label: 'HCS Topic ID', value: listing.hcsTopicId, href: hashscanUrl(listing.hcsTopicId, 'topic', NETWORK) },
                { label: 'Owner',        value: listing.ownerId,     href: hashscanUrl(listing.ownerId, 'account', NETWORK) },
                { label: 'Listed',       value: fmtTimestamp(listing.createdAt), href: '#' },
                ...(listing.ipfsCID ? [{ label: 'IPFS Metadata', value: listing.ipfsCID.slice(0, 30) + '…', href: `https://ipfs.io/ipfs/${listing.ipfsCID}` }] : []),
              ].map(({ label, value, href }) => (
                <div key={label} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="text-xs" style={{ color: '#334155' }}>{label}</span>
                  <a
                    href={href}
                    target={href !== '#' ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-mono cursor-pointer transition-colors duration-200 hover:text-white"
                    style={{ color: '#00A9BA' }}
                  >
                    {value}
                    {href !== '#' && <ExternalLinkIcon size={10} />}
                  </a>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Recent signals */}
          {signals.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="glass-card p-5"
            >
              <h2 className="font-semibold text-sm mb-4" style={{ color: '#E2E8F0' }}>Recent HCS Signals</h2>
              <div className="flex gap-2 flex-wrap">
                {signals.slice(0, 20).map((s, i) => {
                  const colors: Record<string, { bg: string; color: string }> = {
                    BUY:  { bg: 'rgba(16,185,129,0.12)', color: '#10B981' },
                    SELL: { bg: 'rgba(239,68,68,0.12)',  color: '#EF4444' },
                    HOLD: { bg: 'rgba(234,179,8,0.12)',  color: '#EAB308' },
                  };
                  const st = colors[s.signal] ?? colors.HOLD;
                  return (
                    <div
                      key={i}
                      className="text-xs px-2 py-1 rounded-lg font-semibold"
                      style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}30` }}
                    >
                      {s.signal}
                      <span className="ml-1 opacity-60">{s.confidence}%</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Right: Buy card ──────────────────────────────────── */}
        <div>
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-5 sticky top-24"
          >
            <div className="text-center mb-5">
              <p className="text-xs mb-1" style={{ color: '#334155' }}>Price</p>
              <p className="font-display text-3xl font-bold" style={{ color: '#F59E0B' }}>
                {listing.priceHbar ? `${listing.priceHbar} ℏ` : 'Free'}
              </p>
              {listing.priceHbar && (
                <p className="text-xs mt-1" style={{ color: '#1E293B' }}>
                  + 5% royalty on secondary sales
                </p>
              )}
            </div>

            {bought ? (
              <div className="space-y-3">
                <div
                  className="w-full py-3 rounded-xl text-center text-sm font-bold"
                  style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981', border: '1px solid rgba(16,185,129,0.25)' }}
                >
                  ✓ Strategy Acquired!
                </div>
                {clonedId && (
                  <Link
                    href={`/agents/${clonedId}`}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: 'rgba(0,169,186,0.1)', color: '#00A9BA', border: '1px solid rgba(0,169,186,0.25)' }}
                  >
                    Go to My Agent Dashboard →
                  </Link>
                )}
                <p className="text-[10px] text-center text-gray-500">Redirecting automatically…</p>
              </div>
            ) : (
              <button
                onClick={handleBuy}
                disabled={buying || !accountId}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all duration-200 disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, #00A9BA, #1565C0)',
                  color: '#fff',
                  boxShadow: '0 0 24px rgba(0,169,186,0.3)',
                }}
              >
                <ShoppingCartIcon size={15} />
                {buying ? (buyPhase || 'Processing…') : !accountId ? 'Connect Wallet First' : 'Buy Strategy NFT'}
              </button>
            )}

            <p className="text-xs text-center mt-3" style={{ color: '#1E293B' }}>
              Royalty enforced at protocol level · Cannot be bypassed
            </p>

            <div
              className="mt-4 pt-4 text-xs"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#334155' }}
            >
              <div className="flex justify-between mb-1">
                <span>Network</span>
                <span style={{ color: '#64748B', textTransform: 'uppercase' }}>{NETWORK}</span>
              </div>
              <div className="flex justify-between">
                <span>Royalty</span>
                <span style={{ color: '#64748B' }}>5% (HIP-412)</span>
              </div>
            </div>

            <a
              href={listing.hashscanUrl || hashscanUrl(listing.hcsTopicId, 'topic', NETWORK)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 mt-4 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200"
              style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#475569' }}
            >
              View on HashScan
              <ExternalLinkIcon size={12} />
            </a>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
