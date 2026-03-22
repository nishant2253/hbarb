import { TokenAssociateTransaction, TokenId, Hbar } from '@hashgraph/sdk'

export async function associateTUSDT(accountId: string, signer: any): Promise<boolean> {
  const tUSDTIdStr = process.env.NEXT_PUBLIC_TEST_USDT_TOKEN_ID
  if (!tUSDTIdStr) {
    console.warn("No TEST_USDT_TOKEN_ID found in environment.")
    return false
  }

  const tUSDTTokenId = TokenId.fromString(tUSDTIdStr)
  const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet'

  try {
    // Check if already associated (Mirror Node — free)
    const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}/tokens?token.id=${tUSDTIdStr}`)
    const data = await res.json()
    if (data.tokens && data.tokens.length > 0) {
      console.log("tUSDT already associated")
      return true
    }

    // HashPack popup: "Associate tUSDT token"
    console.log("Prompting user to associate tUSDT...")
    const assocTx = await new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tUSDTTokenId])
      .setMaxTransactionFee(new Hbar(2))
      .freezeWithSigner(signer)

    // User approves in HashPack — ~0.001 HBAR
    const response = await assocTx.executeWithSigner(signer)
    
    // ⚠️ CRITICAL: DAppSigner has a bug in getReceiptWithSigner / Query.fromBytes
    // We wait 2s for mirror node to propagate instead of relying on receipt
    console.log("Waiting for association to propagate...")
    await new Promise(r => setTimeout(r, 2000))
    
    console.log("✅ tUSDT successfully associated")
    return true
  } catch (err) {
    console.error("Token association failed:", err)
    return false
  }
}
