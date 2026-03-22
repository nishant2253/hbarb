import { ethers } from 'ethers';

/**
 * Creates an ethers.js signer that routes transaction signing
 * through HashPack via WalletConnect.
 * 
 * When a contract method is called with this signer,
 * HashPack opens and asks the user to approve.
 * Fee is deducted from the user's wallet.
 */
export async function getHashPackEthersSigner(hederaSigner: any) {
  const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');

  class HashPackSigner extends ethers.AbstractSigner {
    constructor() {
      super(provider);
    }

    async getAddress(): Promise<string> {
      const accountId = hederaSigner.getAccountId().toString();
      const parts = accountId.split('.');
      const num = parseInt(parts[2], 10);
      return `0x${num.toString(16).padStart(40, '0')}`;
    }

    // We don't support signing without sending for now through this bridge
    async signTransaction(_tx: ethers.TransactionRequest): Promise<string> {
      throw new Error("signTransaction not supported directly; use sendTransaction");
    }

    async sendTransaction(tx: ethers.TransactionRequest): Promise<ethers.TransactionResponse> {
      console.log("[HashPackSigner] sendTransaction entering");
      try {
        // Hedera DAppSigner expects a Transaction object
        // It handles its own population if we don't.
        const responseBytes = await hederaSigner.signTransaction(tx);
        console.log("[HashPackSigner] signTransaction bytes received");
        
        const txResponse = await provider.broadcastTransaction(responseBytes);
        console.log("[HashPackSigner] Broadcast success:", txResponse.hash);
        return txResponse;
      } catch (err) {
        console.error("[HashPackSigner] sendTransaction failure:", err);
        throw err;
      }
    }

    async signMessage(_message: string | Uint8Array): Promise<string> {
      throw new Error("signMessage not implemented");
    }

    async signTypedData(_domain: any, _types: any, _value: any): Promise<string> {
      throw new Error("signTypedData not implemented");
    }

    connect(provider: ethers.Provider | null): ethers.Signer {
      return new HashPackSigner();
    }
  }

  return new HashPackSigner();
}
