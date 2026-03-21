'use client'
import {
  DAppConnector,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  HederaChainId,
} from '@hashgraph/hedera-wallet-connect'
import { LedgerId } from '@hashgraph/sdk'

let dAppConnector: DAppConnector | null = null

// Initialize once — call on app mount
export async function initWalletConnector() {
  if (dAppConnector) return dAppConnector

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  if (!projectId) {
    console.error('Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID')
    throw new Error('WalletConnect Project ID not configured')
  }

  dAppConnector = new DAppConnector(
    {
      name: 'TradeAgent',
      description: 'AI-Powered Trading Agent Platform on Hedera',
      url: typeof window !== 'undefined' ? window.location.origin : '',
      icons: [`${typeof window !== 'undefined' ? window.location.origin : ''}/logo.png`],
    },
    LedgerId.TESTNET,
    projectId,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [HederaChainId.Testnet] // chainId 296
  )

  await dAppConnector.init({ logger: 'error' })
  return dAppConnector
}

// Open the wallet selection modal
export async function connectWallet() {
  const connector = await initWalletConnector()
  await connector.openModal()

  // Wait briefly for session to settle if they just connected
  await new Promise(resolve => setTimeout(resolve, 500))

  const sessions = connector.walletConnectClient?.session.getAll()
  if (!sessions?.length) throw new Error('No wallet session established')

  const session = sessions[0]
  // Hedera account ID from session (format: "hedera:testnet:0.0.XXXXX")
  const accountId = session.namespaces.hedera?.accounts[0]?.split(':')[2]
  if (!accountId) throw new Error('No Hedera account in session')

  // Derive EVM address from account ID for HSCS contract calls
  const evmAddress = accountIdToEvmAddress(accountId)
  const walletName = session.peer.metadata.name || 'WalletConnect'

  return { accountId, evmAddress, walletName, connector, session }
}

export async function disconnectWallet() {
  if (!dAppConnector) return
  await dAppConnector.disconnectAll()
  dAppConnector = null
}

// Convert Hedera account ID to EVM address for contract calls
// 0.0.XXXXX → 0x000000000000000000000000000000000000XXXXX
export function accountIdToEvmAddress(accountId: string): string {
  if (!accountId) return '0x0000000000000000000000000000000000000000'
  const parts = accountId.split('.')
  if (parts.length !== 3) return '0x0000000000000000000000000000000000000000'
  const num = parseInt(parts[2], 10)
  return `0x${num.toString(16).padStart(40, '0')}`
}
