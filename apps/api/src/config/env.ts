import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from apps/api directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── Required env var validator ────────────────────────────────────
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.includes('XXXXX') || value.includes('your_')) {
    throw new Error(
      `❌ Missing required env var: ${key}\n` +
      `   → Copy apps/api/.env.example to apps/api/.env and fill in your values.\n` +
      `   → Hedera testnet account: portal.hedera.com\n` +
      `   → Gemini API key:         aistudio.google.com\n` +
      `   → Supabase:               supabase.com`
    );
  }
  return value;
}

// ── Optional env var (with default) ──────────────────────────────
function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

// ── Validate required environment variables ───────────────────────
export function loadEnv(): void {
  const network = optionalEnv('HEDERA_NETWORK', 'testnet');
  const nodeEnv = optionalEnv('NODE_ENV', 'development');

  console.log(`\n📋 TradeAgent Environment Loading...`);
  console.log(`   Network: ${network}`);
  console.log(`   Mode:    ${nodeEnv}`);

  // For Phase 1, we only warn if values are missing (Phase 2+ will require them)
  const requiredForAll = ['NODE_ENV', 'HEDERA_NETWORK'];
  const requiredForHedera = ['OPERATOR_ACCOUNT_ID', 'OPERATOR_PRIVATE_KEY'];
  const requiredForAI = ['GEMINI_API_KEY'];
  const requiredForDB = ['DATABASE_URL', 'SUPABASE_URL'];

  let warnings: string[] = [];

  for (const key of requiredForHedera) {
    if (!process.env[key] || process.env[key]!.includes('XXXXX')) {
      warnings.push(key);
    }
  }

  for (const key of requiredForAI) {
    if (!process.env[key] || process.env[key]!.includes('AIza') === false) {
      // Gemini key starts with AIza
    }
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  Phase 1 Setup Required:`);
    console.log(`   The following env vars need your real values in apps/api/.env:`);
    warnings.forEach(w => console.log(`   → ${w}`));
    console.log(`\n   📖 Setup guide:`);
    console.log(`      1. Hedera testnet account → portal.hedera.com`);
    console.log(`      2. Gemini API key         → aistudio.google.com`);
    console.log(`      3. Supabase project       → supabase.com`);
    console.log(`      4. Redis                  → redis.io/try-free OR docker run -p 6379:6379 redis`);
    console.log('');
  } else {
    console.log(`   ✅ All environment variables loaded successfully!\n`);
  }
}

// ── Typed env exports (use these throughout the app) ─────────────
export const env = {
  // Server
  port: parseInt(optionalEnv('PORT', '3001')),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  corsOrigin: optionalEnv('CORS_ORIGIN', 'http://localhost:3000'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',

  // Hedera
  hederaNetwork: optionalEnv('HEDERA_NETWORK', 'testnet'),
  operatorAccountId: process.env.OPERATOR_ACCOUNT_ID || '',
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY || '',
  operatorPublicKey: process.env.OPERATOR_PUBLIC_KEY || '',

  // Contracts (filled after Phase 2)
  agentRegistryContractId: process.env.AGENT_REGISTRY_CONTRACT_ID || '',
  agentRegistryEvmAddress: process.env.AGENT_REGISTRY_EVM_ADDRESS || '',
  strategyTokenId: process.env.STRATEGY_TOKEN_ID || '',

  // Gemini AI
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: optionalEnv('GEMINI_MODEL', 'gemini-1.5-flash'),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  databaseUrl: process.env.DATABASE_URL || '',

  // Redis
  redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),

  // Storage
  nftStorageApiKey: process.env.NFT_STORAGE_API_KEY || '',

  // Mirror Node
  mirrorNodeUrl: optionalEnv('MIRROR_NODE_URL', 'https://testnet.mirrornode.hedera.com'),
} as const;
