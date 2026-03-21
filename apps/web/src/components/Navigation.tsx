'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useWalletStore } from '@/stores/walletStore';
import { BotIcon, WalletIcon, StoreIcon, WrenchIcon, LayoutDashboardIcon, MenuIcon, XIcon } from 'lucide-react';
import { WalletConnectButton } from './WalletConnect';

const NAV_LINKS = [
  { href: '/',            label: 'Dashboard',  icon: LayoutDashboardIcon },
  { href: '/wallet',      label: 'Wallet',     icon: WalletIcon },
  { href: '/create',      label: 'Create',     icon: BotIcon },
  { href: '/marketplace', label: 'Marketplace',icon: StoreIcon },
  { href: '/builder',     label: 'Builder',    icon: WrenchIcon },
];

export function Navigation() {
  const pathname = usePathname();
  const { accountId, hbarBalance, isConnected, disconnect } = useWalletStore();
  const [menuOpen, setMenuOpen] = useState(false);
  // Prevent SSR/client mismatch from Zustand persist (localStorage unavailable on server)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);


  const shortId = accountId
    ? `${accountId.slice(0, 5)}...${accountId.slice(-3)}`
    : null;

  return (
    <nav
      className="fixed top-0 inset-x-0 z-50"
      style={{
        background: 'rgba(10,10,15,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 cursor-pointer">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-display text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff' }}
          >
            TA
          </div>
          <span className="font-display text-sm font-bold tracking-widest" style={{ color: '#E2E8F0' }}>
            TRADE<span style={{ color: '#00A9BA' }}>AGENT</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer"
                style={{
                  color: active ? '#00A9BA' : '#94A3B8',
                  background: active ? 'rgba(0,169,186,0.1)' : 'transparent',
                }}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Wallet connect */}
        <div className="hidden md:flex items-center gap-3">
          {mounted && <WalletConnectButton />}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden p-2 rounded-lg cursor-pointer"
          style={{ color: '#94A3B8' }}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <XIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </div>

      {/* Mobile slide-down menu */}
      {menuOpen && (
        <div
          className="md:hidden px-4 pb-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          {NAV_LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium cursor-pointer"
              style={{ color: pathname === href ? '#00A9BA' : '#94A3B8' }}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
