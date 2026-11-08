export const EXAMPLE_FILENAME = 'contract.ts';

export const EXAMPLE_CODE = `import { NearBindgen, near, call, view } from "near-sdk-js";
import { connect, keyStores } from "near-api-js";

@NearBindgen({})
class Counter {
  count = 0;

  @view({})
  get_count() {
    return this.count;
  }

  @call({})
  increment() {
    this.count += 1;
    near.log(\`count is \${this.count}\`);
  }
}

export async function txStatus(hash: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  const conn = await connect({ networkId: "testnet", keyStore, nodeUrl: "https://rpc.testnet.pagoda.co" });
  return conn.connection.provider.sendJsonRpc("EXPERIMENTAL_tx_status", [hash, "counter.testnet"]);
}
`;
