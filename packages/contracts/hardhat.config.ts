import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatUserConfig } from 'hardhat/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Minimal config — compile only. No toolbox needed for native Hedera deployment.
// Primary deployment is via scripts/deployNative.ts (ContractCreateTransaction).
dotenv.config({ path: path.resolve(__dirname, '../../apps/api/.env') });

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },

    // Secondary deploy option via JSON-RPC relay
    // Primary is: npx ts-node scripts/deployNative.ts
    hederaTestnet: {
      url: 'https://testnet.hashio.io/api',
      chainId: 296,
      accounts: process.env.OPERATOR_PRIVATE_KEY
        ? [process.env.OPERATOR_PRIVATE_KEY]
        : [],
    },

    hederaMainnet: {
      url: 'https://mainnet.hashio.io/api',
      chainId: 295,
      accounts: process.env.OPERATOR_PRIVATE_KEY
        ? [process.env.OPERATOR_PRIVATE_KEY]
        : [],
    },
  },

  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
};

export default config;
