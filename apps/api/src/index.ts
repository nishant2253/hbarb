import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadEnv } from './config/env';
import agentsRouter from './routes/agents';
import marketplaceRouter from './routes/marketplace';

// Load and validate environment variables first
loadEnv();

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    service:   'TradeAgent API',
    version:   '2.1.0',
    network:   process.env.HEDERA_NETWORK || 'testnet',
    timestamp: new Date().toISOString(),
  });
});

// ── Phase 5: API Routes ──────────────────────────────────────────
app.use('/api/agents',      agentsRouter);
app.use('/api/marketplace', marketplaceRouter);

// ── Root ─────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name:        'TradeAgent API',
    description: 'AI-Powered Trading Agent Platform on Hedera Blockchain',
    version:     '2.1.0',
    hackathon:   'Hedera APEX Hackathon 2026 — Track 1: AI & Agents',
    routes: {
      health:           'GET  /health',
      buildAgent:       'POST /api/agents/build',
      deployAgent:      'POST /api/agents/deploy',
      listAgents:       'GET  /api/agents',
      getAgent:         'GET  /api/agents/:id',
      agentHistory:     'GET  /api/agents/:id/history   ← Mirror Node source of truth',
      runAgent:         'POST /api/agents/:id/run',
      pauseAgent:       'PUT  /api/agents/:id/pause',
      marketplace:      'GET  /api/marketplace',
      listNFT:          'POST /api/marketplace/list',
      getListingDetail: 'GET  /api/marketplace/:id',
      delistNFT:        'DELETE /api/marketplace/:id',
    },
  });
});

// ── 404 handler ──────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ─────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[TradeAgent API Error]', err.message);
  res.status(500).json({
    error:   'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start server ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ██████████╗ ██████╗  █████╗ ██████╗ ███████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗');
  console.log('  ╚══ ██╔══╝ ██╔══██╗ ██╔══╝ ██╔══██╗ ╚════╝  ██╔══╝ ██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝');
  console.log('       ██║   ██████╔╝ ███████║██║  ██║ █████╗  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║');
  console.log('       ██║   ██╔══██╗ ██╔══██║██║  ██║ ██╔══╝  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║');
  console.log('       ██║   ██║  ██║ ██║  ██║██████╔╝ ███████╗██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║');
  console.log('       ╚═╝   ╚═╝  ╚═╝ ╚═╝  ╚═╝╚═════╝  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝');
  console.log('');
  console.log(`  🚀 TradeAgent API v2.1.0 — Hedera APEX Hackathon 2026`);
  console.log(`  🌐 Server:  http://localhost:${PORT}`);
  console.log(`  ❤️  Health:  http://localhost:${PORT}/health`);
  console.log(`  🔗 Network: ${process.env.HEDERA_NETWORK || 'testnet'}`);
  console.log(`  ⚡ Mode:    ${process.env.NODE_ENV || 'development'}`);
  console.log('');
});

export default app;
