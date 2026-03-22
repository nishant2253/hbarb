# Verification Flow: HashPack Deployment & User-Pays Model

Follow these steps to verify the full HashPack integration.

## 1. Prerequisites
- HashPack Wallet connected to **Hedera Testnet**.
- `redis-server` and `npm run dev` (API + Web) running.

## 2. Connection & Association
1. Go to `/create`.
2. Click **Connect Wallet** and sign in HashPack.
3. **Verify:** Check browser console. It should say `tUSDT already associated` or prompt for association.
4. **Verify:** UI should show your live HBAR and tUSDT balances.

## 3. Agent Deployment
1. Type a strategy and click **Build with AI**. 
2. Wait for the Assistant message.
3. Click **Deploy Agent**.
4. **Verify Signatures:**
   - **Signature 1:** HFS File Create (Stores configuration).
   - **Signature 2:** HCS Topic Create (Audit trail). Trace: HashPack should show "Topic Memo: TradeAgent:[ID]".
   - **Signature 3:** Smart Contract (AgentRegistry).
5. **Verify:** The app should redirect you to the dashboard upon success.

## 4. Trade Execution
1. In the Dashboard Settings, set mode to **MANUAL**.
2. Trigger a manual trade.
3. **Verify:** HashPack should popup with a "Contract Call" (buy/sell).
4. **Verify:** Confirm balances update after the trade completes.
