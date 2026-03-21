import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import { HardhatUserConfig } from 'hardhat/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

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
    // Local Hardhat network (for fast unit tests)
    hardhat: {
      chainId: 31337,
    },

    // Hedera Testnet via JSON-RPC Relay
    hederaTestnet: {
      url: 'https://testnet.hashio.io/api',
      chainId: 296,
      timeout: 60000, // 60s — Hedera can be slow for contracts
      gasPrice: 960000000000, // 960 gwei — required for Hedera
      accounts: process.env.OPERATOR_PRIVATE_KEY
        ? [process.env.OPERATOR_PRIVATE_KEY]
        : [],
    },

    // Hedera Mainnet (for after hackathon)
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
