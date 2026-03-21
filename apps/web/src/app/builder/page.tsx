'use client';

import { useCallback, useState } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  PlayIcon, UndoIcon, ZapIcon, ArrowRightIcon,
  TrendingUpIcon, ActivityIcon, GitBranchIcon, ArrowUpIcon, ArrowDownIcon,
} from 'lucide-react';

const NODE_PALETTE = [
  { group: 'Indicators', items: [
    { type: 'indicator', label: 'Moving Average', color: '#00A9BA', icon: TrendingUpIcon },
    { type: 'indicator', label: 'RSI Node',       color: '#00A9BA', icon: ActivityIcon },
    { type: 'indicator', label: 'MACD Node',      color: '#00A9BA', icon: TrendingUpIcon },
    { type: 'indicator', label: 'Bollinger Band', color: '#00A9BA', icon: ActivityIcon },
  ]},
  { group: 'Conditions', items: [
    { type: 'condition', label: 'Greater Than',  color: '#F59E0B', icon: TrendingUpIcon },
    { type: 'condition', label: 'Crosses Above', color: '#F59E0B', icon: TrendingUpIcon },
    { type: 'condition', label: 'Crosses Below', color: '#F59E0B', icon: TrendingUpIcon },
  ]},
  { group: 'Actions', items: [
    { type: 'action', label: 'BUY Signal',  color: '#10B981', icon: ArrowUpIcon },
    { type: 'action', label: 'SELL Signal', color: '#EF4444', icon: ArrowDownIcon },
    { type: 'action', label: 'HOLD Signal', color: '#EAB308', icon: ZapIcon },
  ]},
];

let nodeId = 1;

export default function BuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [saved, setSaved] = useState(false);

  const onConnect = useCallback(
    (connection: Connection) => setEdges(e => addEdge(connection, e)),
    [setEdges]
  );

  const addNode = (type: string, label: string, color: string) => {
    const id = `node-${nodeId++}`;
    setNodes(n => [
      ...n,
      {
        id,
        type: 'default',
        position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: { label },
        style: {
          background:  `${color}18`,
          border:      `1px solid ${color}50`,
          borderRadius: 10,
          color:       '#E2E8F0',
          fontSize:    12,
          fontFamily:  'Exo 2, sans-serif',
          padding:     '8px 12px',
          minWidth:    120,
        },
      },
    ]);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type  = e.dataTransfer.getData('nodeType');
    const label = e.dataTransfer.getData('nodeLabel');
    const color = e.dataTransfer.getData('nodeColor');
    if (!type) return;
    const bounds = (e.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
    const id = `node-${nodeId++}`;
    setNodes(n => [
      ...n,
      {
        id,
        type: 'default',
        position: { x: e.clientX - (bounds?.left ?? 0) - 60, y: e.clientY - (bounds?.top ?? 0) - 20 },
        data: { label },
        style: {
          background: `${color}18`,
          border:     `1px solid ${color}50`,
          borderRadius: 10,
          color: '#E2E8F0',
          fontSize: 12,
          fontFamily: 'Exo 2, sans-serif',
          padding: '8px 12px',
          minWidth: 120,
        },
      },
    ]);
  }, [setNodes]);

  const clearCanvas = () => { setNodes([]); setEdges([]); };

  return (
    <div className="flex h-[calc(100vh-64px)]" style={{ background: '#07090E' }}>
      {/* ── Left Sidebar: Pipeline Control ───────────────────── */}
      <aside
        className="w-48 flex-shrink-0 flex flex-col p-3 overflow-y-auto"
        style={{ borderRight: '1px solid rgba(255,255,255,0.06)', background: '#0D1117' }}
      >
        {/* Controls */}
        <div className="mb-4">
          <p className="text-[10px] font-bold mb-2 tracking-widest" style={{ color: '#334155' }}>PIPELINE CONTROL</p>
          <button
            onClick={() => setSaved(true)}
            className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg mb-2 cursor-pointer transition-all duration-200"
            style={{ background: 'rgba(0,169,186,0.12)', border: '1px solid rgba(0,169,186,0.25)', color: '#00A9BA' }}
          >
            <PlayIcon size={12} />
            Run Pipeline
          </button>
          <button
            onClick={clearCanvas}
            className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg cursor-pointer transition-all duration-200"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: '#64748B' }}
          >
            <UndoIcon size={12} />
            Clear Canvas
          </button>
        </div>

        {/* Node palette */}
        <div className="mb-4">
          <p className="text-[10px] font-bold mb-2 tracking-widest" style={{ color: '#334155' }}>QUICK ACCESS</p>
          {NODE_PALETTE.map(group => (
            <div key={group.group} className="mb-3">
              <p className="text-[9px] mb-1.5 font-semibold tracking-wider" style={{ color: '#1E293B' }}>
                {group.group.toUpperCase()}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.map(n => (
                  <div
                    key={n.label}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('nodeType',  n.type);
                      e.dataTransfer.setData('nodeLabel', n.label);
                      e.dataTransfer.setData('nodeColor', n.color);
                    }}
                    onClick={() => addNode(n.type, n.label, n.color)}
                    className="rounded-lg p-2 text-center cursor-grab active:cursor-grabbing transition-all duration-200 hover:border-current"
                    style={{
                      background: `${n.color}10`,
                      border:     `1px solid ${n.color}25`,
                    }}
                  >
                    <n.icon size={12} style={{ color: n.color, margin: '0 auto 3px' }} />
                    <p className="text-[9px] leading-tight" style={{ color: '#94A3B8' }}>{n.label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Deploy CTA */}
        {nodes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-auto"
          >
            <Link
              href="/create"
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-bold cursor-pointer transition-all duration-200"
              style={{ background: 'linear-gradient(135deg, #00A9BA, #1565C0)', color: '#fff' }}
            >
              <ZapIcon size={12} />
              Deploy via AI
              <ArrowRightIcon size={12} />
            </Link>
          </motion.div>
        )}
      </aside>

      {/* ── ReactFlow Canvas ─────────────────────────────────── */}
      <div
        className="flex-1 relative"
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
      >
        {/* Empty state overlay */}
        {nodes.length === 0 && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
            aria-hidden="true"
          >
            <GitBranchIcon size={40} style={{ color: '#1C2333', marginBottom: 12 }} />
            <p className="text-sm font-medium" style={{ color: '#1E293B' }}>Drag nodes from the left panel</p>
            <p className="text-xs mt-1" style={{ color: '#0F172A' }}>or click them to add to canvas</p>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          style={{ background: '#07090E' }}
          defaultEdgeOptions={{
            style: { stroke: '#00A9BA', opacity: 0.5, strokeWidth: 1.5 },
            animated: true,
          }}
        >
          <Controls
            style={{ bottom: 16, left: 8 }}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(255,255,255,0.04)"
          />
          <MiniMap
            nodeColor="#1C2333"
            maskColor="rgba(7,9,14,0.8)"
            style={{ background: '#0D1117', border: '1px solid rgba(255,255,255,0.06)' }}
          />
        </ReactFlow>

        {/* Saved toast */}
        <AnimatedToast show={saved} onDone={() => setSaved(false)} />
      </div>
    </div>
  );
}

function AnimatedToast({ show, onDone }: { show: boolean; onDone: () => void }) {
  if (!show) return null;
  setTimeout(onDone, 2500);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
      style={{ background: 'rgba(0,169,186,0.15)', border: '1px solid rgba(0,169,186,0.3)', color: '#00A9BA' }}
    >
      <PlayIcon size={14} />
      Pipeline saved! Ready for AI deployment.
    </motion.div>
  );
}
