import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
    console.log("\n■ Deploying MockDEX to Hedera Testnet...");
    console.log(" Network: Hedera Testnet (chainId 296)");
    console.log(" RPC: https://testnet.hashio.io/api\n");

    const [deployer] = await ethers.getSigners();
    console.log("Deployer EVM address:", deployer.address);

    const balanceBefore = await ethers.provider.getBalance(deployer.address);
    console.log("Balance before: ", ethers.formatEther(balanceBefore), "HBAR\n");

    console.log("Deploying MockDEX...");
    const MockDEX = await ethers.getContractFactory("MockDEX");
    const mockDex = await MockDEX.deploy({
        gasLimit: 2000000,
        gasPrice: ethers.parseUnits("960", "gwei"), // Required for Hedera
    });

    console.log("Waiting for deployment confirmation...");
    await mockDex.waitForDeployment();

    const evmAddress = await mockDex.getAddress();

    // Convert EVM address to Hedera Contract ID
    const contractNum = parseInt(evmAddress.slice(2), 16);
    const hederaContractId = `0.0.${contractNum}`;

    const balanceAfter = await ethers.provider.getBalance(deployer.address);
    const cost = balanceBefore - balanceAfter;

    console.log("\n■ MockDEX deployed successfully!");
    console.log(" EVM Address:       ", evmAddress);
    console.log(" Hedera Contract:   ", hederaContractId);
    console.log(" Deployment cost:   ", ethers.formatEther(cost), "HBAR");
    console.log(" HashScan URL:      ", `https://hashscan.io/testnet/contract/${hederaContractId}`);

    const [hbar, usdc, spot] = await mockDex.getPoolState();
    console.log("\n Pool initialized:");
    console.log(" HBAR Reserve:      ", ethers.formatUnits(hbar, 8), "HBAR");
    console.log(" USDC Reserve:      ", ethers.formatUnits(usdc, 6), "USDC");
    console.log(" Spot Price:        $", (Number(spot) / 1e6).toFixed(4), "per HBAR\n");

    const envPath = path.resolve(__dirname, "../../../apps/api/.env");
    if (fs.existsSync(envPath)) {
        let env = fs.readFileSync(envPath, "utf8");

        if (env.includes("MOCK_DEX_ADDRESS=")) {
            env = env.replace(/MOCK_DEX_ADDRESS=.*/, `MOCK_DEX_ADDRESS=${evmAddress}`);
        } else {
            env += `\nMOCK_DEX_ADDRESS=${evmAddress}`;
        }

        if (env.includes("MOCK_DEX_HEDERA_ID=")) {
            env = env.replace(/MOCK_DEX_HEDERA_ID=.*/, `MOCK_DEX_HEDERA_ID=${hederaContractId}`);
        } else {
            env += `\nMOCK_DEX_HEDERA_ID=${hederaContractId}`;
        }

        fs.writeFileSync(envPath, env);
        console.log("■ Addresses saved to apps/api/.env automatically");
    } else {
        console.log("■■ .env file not found at", envPath);
        console.log(" Add manually:");
        console.log(` MOCK_DEX_ADDRESS=${evmAddress}`);
        console.log(` MOCK_DEX_HEDERA_ID=${hederaContractId}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\n■ Deployment failed:", err.message);
        process.exit(1);
    });
