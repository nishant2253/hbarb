import { create } from 'zustand';
import { Agent } from './agentStore';

export interface Listing {
  id:           string;
  name:         string;
  ownerId:      string;
  strategyType: string;
  hcsTopicId:   string;
  serialNumber: number | null;
  priceHbar:    number | null;
  ipfsCID:      string | null;
  createdAt:    string;
  executions:   number;
  recentSignals: Array<{ signal: string; confidence: number }>;
  winRate:      number;
  hashscanUrl:  string;
}

type SortKey = 'winRate' | 'priceHbar' | 'executions' | 'createdAt';

interface MarketplaceState {
  listings:      Listing[];
  filter:        string;
  sort:          SortKey;
  isLoading:     boolean;

  // Actions
  setListings:   (listings: Listing[]) => void;
  setFilter:     (filter: string) => void;
  setSort:       (sort: SortKey) => void;
  setLoading:    (loading: boolean) => void;
}

export const useMarketplaceStore = create<MarketplaceState>()((set) => ({
  listings:  [],
  filter:    'all',
  sort:      'winRate',
  isLoading: false,

  setListings: (listings) => set({ listings }),
  setFilter:   (filter) => set({ filter }),
  setSort:     (sort) => set({ sort }),
  setLoading:  (isLoading) => set({ isLoading }),
}));
