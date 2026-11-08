import { connect, keyStores, KeyPair } from 'near-api-js';
import { actionCreators } from '@near-js/transactions';

const RPC = 'https://rpc.testnet.pagoda.co';

export async function relay(accountId, privateKey, signedDelegate) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  const account = await near.account(accountId);
  const action = { DelegateV2: signedDelegate };
  return account.signAndSendTransaction({ receiverId: signedDelegate.senderId, actions: [actionCreators.signedDelegate(action)] });
}

export async function sendRaw(signedTxBase64) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'relay', method: 'broadcast_tx_commit', params: [signedTxBase64] }),
  });
  return res.json();
}
