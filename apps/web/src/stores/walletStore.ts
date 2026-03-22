import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  accountId:   string | null;   // "0.0.XXXXX"
  evmAddress:  string | null;   // "0x..."
  hbarBalance: number;
  tusdtBalance: number;
  isConnected: boolean;
  walletName:  string | null;   // "HashPack" | "MetaMask" | "WalletConnect"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connector:   any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer:      any | null;

  // Actions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setWallet:   (accountId: string, evmAddress: string, name: string, connector: any, signer: any) => void;
  setBalances: (hbar: number, tusdt: number) => void;
  disconnect:  () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      accountId:   null,
      evmAddress:  null,
      hbarBalance: 0,
      tusdtBalance: 0,
      isConnected: false,
      walletName:  null,
      connector:   null,
      signer:      null,

      setWallet: (accountId, evmAddress, name, connector, signer) =>
        set({ accountId, evmAddress, connector, signer, isConnected: true, walletName: name }),

      setBalances: (hbar, tusdt) => set({ hbarBalance: hbar, tusdtBalance: tusdt }),

      disconnect: () => set({
        accountId: null, evmAddress: null,
        isConnected: false, connector: null, signer: null, hbarBalance: 0, tusdtBalance: 0, walletName: null
      }),
    }),
    { 
      name: 'tradeagent-wallet',
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { connector, signer, ...rest } = state;
        return rest;
      }
    }
  )
);
