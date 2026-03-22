import { useEffect } from 'react'
import { useWalletStore } from '@/stores/walletStore'

interface Balances { hbar: number; tusdt: number }

export async function fetchBalances(accountId: string): Promise<Balances> {
  const tUSDTId = process.env.NEXT_PUBLIC_TEST_USDT_TOKEN_ID
  const network = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet'
  const base = `https://${network}.mirrornode.hedera.com/api/v1`
  
  try {
    const promises = [fetch(`${base}/accounts/${accountId}`)]
    if (tUSDTId) {
      promises.push(fetch(`${base}/accounts/${accountId}/tokens?token.id=${tUSDTId}`))
    }

    const responses = await Promise.all(promises)
    const accData = await responses[0].json()
    
    let tusdt = 0
    if (tUSDTId && responses[1]) {
      const tokData = await responses[1].json()
      tusdt = (tokData.tokens?.[0]?.balance ?? 0) / 1000000
    }

    const hbar = (accData.balance?.balance ?? 0) / 100000000
    return { hbar, tusdt }
  } catch (error) {
    console.warn("Failed to fetch balances:", error)
    return { hbar: 0, tusdt: 0 }
  }
}

// Hook: auto-refresh every 5 seconds
export function useBalances() {
  const { accountId, setBalances } = useWalletStore()

  useEffect(() => {
    if (!accountId) return

    let mounted = true
    const refresh = async () => {
      const b = await fetchBalances(accountId)
      if (mounted) {
        setBalances(b.hbar, b.tusdt)
      }
    }

    refresh()
    const interval = setInterval(refresh, 5000)
    
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [accountId, setBalances])
}
