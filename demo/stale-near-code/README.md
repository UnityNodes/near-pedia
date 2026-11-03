# Demo: NEAR code written from memory

This directory exists only to show the NEARpedia pull-request check at work. Its files are what an assistant trained before NEAR's recent changes tends to write: a near-sdk-js contract, a near-api-js 4 relayer with `keyStores` and `actionCreators`, a `DelegateV2` action, `broadcast_tx_commit`, and a Pagoda RPC endpoint. Opening a pull request that adds them makes the `NEARpedia` workflow comment on every such line with its replacement and source. It is never merged.
