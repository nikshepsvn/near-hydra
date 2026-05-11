# Tool Reference

All 21 MCP tools and 4 MCP resources `near-hydra` registers, with input fields, outputs, and notes. CLI subcommands mirror tools one-to-one.

Conventions:
- 🔍 = read-only (safe by default)
- ✏️ = signing (gated by `policy.readOnly = false`, `dry: true` by default)

---

## 🔍 hydra_config_show

Show the active configuration.

**Input:** none.

**Output:** `{ network, accountId, hasPrivateKey, mpcContract, nearRpc, oneClickBaseUrl, oneClickAuthed, policy }`

---

## 🔍 hydra_account_view

View a NEAR account's on-chain state.

**Input:** `{ accountId: string }`

**Output:** `{ accountId, network, balance: { total, available, usedOnStorage, locked, totalNear, availableNear }, storageUsage, codeHash }`

---

## 🔍 hydra_contract_view

Call a read-only view method on a NEAR contract.

**Input:** `{ contractId: string, method: string, args?: object }`

**Output:** parsed JSON if the contract returns valid JSON, otherwise the raw string.

---

## 🔍 hydra_address_derive

Derive a foreign-chain address via Chain Signatures.

**Input:** `{ chain: SupportedChain, predecessor: string, path?: string }`

`chain`: `ethereum | polygon | arbitrum | base | optimism | bnb | avalanche | aurora | bitcoin | solana`. `predecessor` is a NEAR account id. `path` defaults to `<chain>-1`.

**Output:** `{ chain, predecessor, path, address, publicKey }`

---

## 🔍 hydra_address_balance

Native-asset balance of an address on a foreign chain.

**Input:** `{ chain: SupportedChain, address: string }`

**Output:** `{ chain, address, balance, decimals }` (balance is a string of base units)

---

## 🔍 hydra_account_balance_all_chains

For one NEAR account, derive its addresses on every supported chain and return all balances. Per-chain errors are reported individually — partial success is normal.

**Input:** `{ accountId: string }`

**Output:** `{ accountId, derived: Array<{ chain, address?, balance?, decimals?, error? }> }`

---

## 🔍 hydra_swap_tokens

List all tokens supported by NEAR Intents 1Click for cross-chain swaps.

**Input:** none.

**Output:** array of `{ assetId, decimals, blockchain, symbol, price, priceUpdatedAt, contractAddress }`.

---

## 🔍 hydra_swap_quote

Get a 1Click cross-chain swap quote.

**Input:** `{ originAsset, destinationAsset, amount, recipient, recipientType, refundTo, refundType, depositType, swapType, slippageTolerance, depositMode?, dry, sessionId? }`

Critical fields:
- `originAsset` / `destinationAsset` — 1Click asset IDs (e.g. `nep141:wrap.near`, `nep141:eth-0xdac17...omft.near`). See `hydra_swap_tokens`.
- `amount` — base units of `originAsset`.
- `swapType` — `EXACT_INPUT | EXACT_OUTPUT | FLEX_INPUT | ANY_INPUT`.
- `slippageTolerance` — basis points (100 = 1%).
- `dry: true` — simulate; no deposit address. `dry: false` — real deposit address returned.

**Output:** `QuoteResponse` from 1Click — see [their docs](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api).

---

## 🔍 hydra_swap_status

Check the execution status of a 1Click swap.

**Input:** `{ depositAddress: string, depositMemo?: string }`

**Output:** `GetExecutionStatusResponse` from 1Click.

---

## 🔍 hydra_swap_submit_deposit

Notify 1Click that the deposit transaction has been broadcast.

**Input:** `{ depositAddress: string, txHash: string }`

**Output:** `SubmitDepositTxResponse` from 1Click.

---

## ✏️ hydra_send_near

Send native NEAR from the configured account.

**Input:** `{ to: string, amountYocto: string, dry?: boolean (default true) }`

`amountYocto` is in yoctoNEAR (1 NEAR = 10²⁴ yocto).

**Output (dry):** `{ dry: true, plan: { kind: "send_near", from, to, amountYocto } }`
**Output (broadcast):** `{ dry: false, plan, txHash, result }`

---

## ✏️ hydra_send_ft

Send a NEP-141 fungible token via `ft_transfer`.

**Input:** `{ tokenContract: string, to: string, amount: string, memo?: string, dry?: boolean }`

`amount` is in the token's base units. `memo` is optional, sometimes required by 1Click for MEMO-mode chains.

**Output:** `{ dry, plan: { kind: "send_ft", from, tokenContract, to, amount, memo }, txHash?, result? }`

---

## ✏️ hydra_contract_call

Call a state-changing method on a NEAR contract.

**Input:** `{ contractId: string, method: string, args?: object, depositYocto?: string, gas?: string, dry?: boolean }`

`gas` is in absolute units (10¹² = 1 TGas). Default 30 TGas. `depositYocto` is the attached NEAR.

**Output:** `{ dry, plan: { kind: "contract_call", from, contractId, method, args, depositYocto, gas }, txHash?, result? }`

---

## ✏️ hydra_send_evm

Send an EVM transaction signed via Chain Signatures from a derived address.

**Input:** `{ chain: EvmChain, predecessor?: string, path?: string, to: string, valueWei?: string, dataHex?: 0x..., erc20?: { token, recipient, amount }, dry?: boolean }`

Modes:
- **Native value:** set `to` + `valueWei` (and optionally `dataHex`).
- **ERC-20 transfer:** set `erc20: { token, recipient, amount }`. Hydra encodes the calldata, sets `to = token`, `value = 0`.

`predecessor` defaults to the configured NEAR account, `path` to `<chain>-1`.

**Output (dry):** `{ dry: true, plan: { kind: "send_evm", chain, from (derived), to, valueWei, dataHex, derivedFrom: { predecessor, path } } }`
**Output (broadcast):** `{ dry: false, plan, txHash, signedTx }`

Pre-conditions for broadcast: derived `from` address must hold the origin asset + native gas on its chain. NEAR account pays for the MPC sign request (gas + 1 yocto deposit).

---

## ✏️ hydra_send_btc

Send BTC via Chain Signatures from a derived Bitcoin address. UTXO selection via Mempool API.

**Input:** `{ predecessor?: string, path?: string, to: string, satoshi: string, dry?: boolean }`

**Output:** `{ dry, plan: { kind: "send_btc", from, to, satoshi, derivedFrom }, txHash?, signedTx? }`

Pre-conditions: derived address must have spendable UTXOs ≥ `satoshi` + fees.

---

## ✏️ hydra_send_solana

Send native SOL via Chain Signatures from a derived Solana address.

**Input:** `{ predecessor?: string, path?: string, to: string, lamports: string, dry?: boolean }`

**Output:** `{ dry, plan: { kind: "send_sol", from, to, lamports, derivedFrom }, txHash?, signedTx? }`

Pre-conditions: derived address must have SOL ≥ `lamports` + fees.

---

## ✏️ hydra_send_spl

Send a Solana SPL token via Chain Signatures from a derived Solana address. Hydra derives both source and destination ATAs (Associated Token Accounts) and creates the destination ATA on the fly if it doesn't exist (sender pays ~0.002 SOL of rent).

**Input:** `{ predecessor?: string, path?: string, mint: string, to: string, amount: string, decimals?: number, dry?: boolean }`

`mint` is the SPL mint base58 address (e.g. `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` for USDC). `to` is the recipient *wallet* address — hydra derives the destination ATA from `(mint, to)`. `amount` is in token base units. `decimals` is looked up on-chain via `getMint` if not provided.

**Output:** `{ dry, plan: { kind: "send_spl", from, to, mint, amount, decimals, sourceAta, destAta, needsCreateDestAta, derivedFrom }, txHash?, signedTx? }`

Pre-conditions: derived address must hold ≥ `amount` of the SPL token in its source ATA, plus a small SOL balance (rent for new ATAs + tx fees).

---

## ✏️ hydra_create_agent_key

Mint NEAR function-call access keys scoped to specific contracts (with a NEAR allowance cap). Use to give an autonomous agent a key it can only spend gas with and only call specific contracts — never a full-access key.

**Input:** `{ receiverContracts: string[], methods?: string[], allowanceYocto: string, dry?: boolean }`

One fresh `ed25519` keypair is generated per `receiverContract` (NEAR allows only one access key per public_key, so multiple contracts require multiple keypairs). `methods: []` means "any method on that contract."

**Output (dry):** `{ dry: true, plan: { kind: "create_agent_key", accountId, existingKeyCount, allowanceYocto, methods, keys: [{ contractId, publicKey }] } }`
**Output (broadcast):** `{ dry: false, plan, warning, keys: [{ contractId, publicKey, privateKey, methods, txHash }] }`

**The `privateKey` field is shown ONCE on broadcast. Save it immediately.**

---

## ✏️ hydra_sign_message

Sign an arbitrary message (EIP-191 `personal_sign`) or EIP-712 typed data from a Chain-Signature-derived address. Used for Sign-In-With-Ethereum / Sign-In-With-Solana / EIP-712 typed data / Permit2 approvals.

**Input:** `{ chain: SupportedChain, predecessor?: string, path?: string, message?: string, typedData?: TypedDataDefinition }`

For EVM chains: pass `message` (EIP-191) or `typedData` (EIP-712). Returns a 65-byte `0x...` signature.
For Solana: pass `message`. Returns a base58-encoded Ed25519 signature.
For Bitcoin: throws (BIP-322 not yet supported).

**Output:** `{ chain, address, scheme: "eip191"|"eip712"|"ed25519", signature, digestHex?, recoveredAddress? }`

For EVM, the signature is recovered locally to verify it matches the derived address; if the canonical `v` (27/28) doesn't recover, `v` is flipped and reverified before return.

---

## ✏️ hydra_ensure_gas

Top up a derived foreign-chain address with native gas via NEAR Intents 1Click. Checks current balance; if below `minBalance`, swaps a NEAR-side asset (default wNEAR) to the chain's native asset, sends to the derived address, polls until delivered.

**Input:** `{ chain, predecessor?, path?, minBalance?, sourceAsset?, timeoutMs?, pollIntervalMs?, dry?: boolean }`

`sourceAsset` must be a NEAR-side `nep141:*.near` asset, not an `omft.near` foreign-bridged asset. Default `nep141:wrap.near`.

`minBalance` defaults to a per-chain `GAS_DEFAULTS` value tuned for ~10 typical transactions.

**Output:** `{ dry, alreadyFunded, address, currentBalance, targetMinimum, finalBalance?, plan?, swap? }`

Bitcoin special case: reports balance only (no "gas" concept — UTXOs are the value). Aurora is currently not supported (no omft bridge).

---

## ✏️ hydra_swap_execute

End-to-end cross-chain swap. Auto-routes the origin send by parsing `originAsset`:

| Pattern | Routes via |
|---|---|
| `nep141:<x>.near` (NEAR-side FT) | `sendFt` |
| `nep141:eth-0x...omft.near`, `arb-...`, `pol-...`, `bsc-...`, `base-...`, `op-...`, `avax-...`, `aurora-...` | `sendEvm` (ERC-20 calldata if has contract suffix, native value if not) |
| `nep141:btc.omft.near` | `sendBtc` |
| `nep141:sol.omft.near` | `sendSolana` |
| `nep141:sol-<omft-id>.omft.near` (SPL) | `sendSpl` (real mint resolved via 1Click `getTokens`) |

**Input:** `{ originAsset, destinationAsset, amount, recipient, recipientType, refundTo?, refundType?, depositType?, swapType?, slippageTolerance?, depositMode?, dry?: boolean }`

**Output (dry):** `{ dry: true, plan: { kind: "swap_execute", route, originAsset, destinationAsset, amount, recipient }, previewQuoteRequest }`
**Output (broadcast):** `{ dry: false, route, quote, sendResult, txHash, depositAddress, submitResult, next: { hint } }`

Use `hydra_swap_status` afterward to poll settlement.

---

## CLI parity

Every tool has a CLI subcommand. Most-used:

```
near-hydra config
near-hydra account view <id>
near-hydra account balance-all <id>
near-hydra address derive -c <chain> -p <id>
near-hydra address balance -c <chain> -a <addr>
near-hydra contract view <contractId> <method> [-a <jsonArgs>]
near-hydra swap tokens
near-hydra swap quote --from ... --to ... --amount ... --recipient ... --refund-to ...
near-hydra swap status <depositAddress>
near-hydra swap execute --from ... --to ... --amount ... --recipient ... [--broadcast]
near-hydra send near <to> <amountYocto> [--broadcast]
near-hydra send ft <tokenContract> <to> <amount> [--memo ...] [--broadcast]
near-hydra send evm -c <chain> --to <addr> [--value-wei ... | --erc20-token ... --erc20-recipient ... --erc20-amount ...] [--broadcast]
near-hydra send btc <to> <satoshi> [--broadcast]
near-hydra send sol <to> <lamports> [--broadcast]
near-hydra send spl <mint> <to> <amount> [--decimals N] [--broadcast]
near-hydra key create-agent --receiver <id> [--methods <m,m>] --allowance-yocto <y> [--broadcast]
near-hydra sign-message -c <chain> -m <utf8>            # or --typed-data <json>
near-hydra ensure-gas -c <chain> [--min-balance ...] [--source-asset ...] [--broadcast]
near-hydra call <contractId> <method> [-a <jsonArgs>] [--deposit-yocto ...] [--gas ...] [--broadcast]
```

CLI defaults to dry-run for every signing command. Pass `--broadcast` to actually send.

---

## MCP Resources

In addition to tools, `near-hydra-mcp` exposes four [MCP resources](https://modelcontextprotocol.io/docs/concepts/resources). MCP clients that read resources at session start (Claude Code, Cursor) get the static context for free without spending tool calls.

| URI | Contents |
|---|---|
| `near-hydra://chains` | Supported chains + default derivation paths |
| `near-hydra://tokens` | 1Click-supported swap tokens (cached 5 min) |
| `near-hydra://config` | Active configuration (network, MPC contract, RPC endpoints — no private keys) |
| `near-hydra://policy` | Active safety policy (`readOnly`, value caps) |

All four return `application/json`. The `tokens` resource is per-`(baseUrl, apiKey)` cached for 5 minutes.
