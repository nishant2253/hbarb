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

  await dAppConnector.init({ logger: 'fatal' })
  return dAppConnector
}

interface ConnectWalletResult {
  accountId: string;
  evmAddress: string;
  walletName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connector: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any;
}

// Open the wallet selection modal
export async function connectWallet(): Promise<ConnectWalletResult> {
  const connector = await initWalletConnector()

  // 1. If a session already exists, reuse it and don't open the modal!
  const existingSessions = connector.walletConnectClient?.session.getAll()
  if (existingSessions && existingSessions.length > 0) {
    const session = existingSessions[0]
    const accountId = session.namespaces.hedera?.accounts[0]?.split(':')[2]
    if (accountId) {
      const evmAddress = accountIdToEvmAddress(accountId)
      const walletName = session.peer.metadata.name || 'WalletConnect'
      // Get the signer — used to sign ALL user transactions
      const signer = connector.signers.find(
        (s: any) => s.getAccountId().toString() === accountId
      )
      return { accountId, evmAddress, walletName, connector, session, signer }
    }
  }

  // 2. Otherwise, wait for a new connection
  return new Promise<ConnectWalletResult>(async (resolve, reject) => {
    let checkInterval: NodeJS.Timeout
    let isResolving = false

    const checkSession = (isFinalCheck = false) => {
      const sessions = connector.walletConnectClient?.session.getAll()
      if (sessions && sessions.length > 0) {
        isResolving = true
        clearInterval(checkInterval)
        
        const session = sessions[0]
        const accountId = session.namespaces.hedera?.accounts[0]?.split(':')[2]
        if (!accountId) {
          reject(new Error('No Hedera account in session'))
          return
        }
        
        const evmAddress = accountIdToEvmAddress(accountId)
        const walletName = session.peer.metadata.name || 'WalletConnect'
        
        // Get the signer — used to sign ALL user transactions
        const signer = connector.signers.find(
          (s: any) => s.getAccountId().toString() === accountId
        )
        if (!signer) {
          reject(new Error('No signer for account'))
          return
        }
        
        resolve({ accountId, evmAddress, walletName, connector, session, signer })
      } else if (isFinalCheck && !isResolving) {
        reject(new Error('No wallet session established. User closed modal.'))
      }
    }

    // Subscribe to modal state to stop polling if closed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = connector.walletConnectModal.subscribeModal((state: any) => {
      if (!state.open && !isResolving) {
        clearInterval(checkInterval)
        unsubscribe()
        setTimeout(() => checkSession(true), 800)
      }
    })

    // Poll every 500ms while the modal is open or connection is pending
    checkInterval = setInterval(() => checkSession(false), 500)

    try {
      await connector.openModal()
    } catch (err) {
      clearInterval(checkInterval)
      unsubscribe()
      reject(err)
    }
  })
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
  // Convert decimal to hex and pad to 40 chars, then add 0x
  const hex = num.toString(16).padStart(40, '0')
  return `0x${hex}`
}
