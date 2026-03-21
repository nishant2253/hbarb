import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  accountId:   string | null;   // "0.0.XXXXX"
  evmAddress:  string | null;   // "0x..."
  hbarBalance: number;
  isConnected: boolean;
  walletName:  string | null;   // "HashPack" | "MetaMask" | "WalletConnect"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connector:   any | null;

  // Actions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setWallet:   (accountId: string, evmAddress: string, name: string, connector: any) => void;
  setBalance:  (hbar: number) => void;
  disconnect:  () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      accountId:   null,
      evmAddress:  null,
      hbarBalance: 0,
      isConnected: false,
      walletName:  null,
      connector:   null,

      setWallet: (accountId, evmAddress, name, connector) =>
        set({ accountId, evmAddress, connector, isConnected: true, walletName: name }),

      setBalance: (hbar) => set({ hbarBalance: hbar }),

      disconnect: () => set({
        accountId: null, evmAddress: null,
        isConnected: false, connector: null, hbarBalance: 0, walletName: null
      }),
    }),
    { name: 'tradeagent-wallet' }
  )
);
