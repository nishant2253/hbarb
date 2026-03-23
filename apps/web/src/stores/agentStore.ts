import { create } from 'zustand';

export interface Agent {
  id:           string;
  name:         string;
  ownerId:      string;
  strategyType: string;
  hcsTopicId:   string;
  hfsConfigId:  string | null;
  active:       boolean;
  listed:       boolean;
  priceHbar:    number | null;
  executions:   number;
  createdAt:    string;
}

export interface Signal {
  seq:         number;
  timestamp:   string;
  decision: {
    signal:     string;
    confidence: number;
    price:      number;
    reasoning:  string;
  } | null;
  hashscanUrl: string;
  agentId:     string;
  agentName:   string;
}

interface AgentState {
  agents:      Agent[];
  activeAgent: Agent | null;
  liveSignals: Signal[];
  isLoading:   boolean;

  setAgents:      (agents: Agent[]) => void;
  setActiveAgent: (agent: Agent | null) => void;
  addSignal:      (signal: Signal) => void;
  setLoading:     (loading: boolean) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  agents:      [],
  activeAgent: null,
  liveSignals: [],
  isLoading:   false,

  setAgents: (agents) => set({ agents }),

  setActiveAgent: (activeAgent) => set({ activeAgent }),

  addSignal: (signal) =>
    set((state) => ({
      liveSignals: [signal, ...state.liveSignals].slice(0, 50),
    })),

  setLoading: (isLoading) => set({ isLoading }),
}));
