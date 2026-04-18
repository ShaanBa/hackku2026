// Deep-link helpers for the public XRPL testnet explorer so demo viewers
// can click through from a goal/tx in the UI and see the real ledger entry.
// Swap the base to https://livenet.xrpl.org if we ever point at mainnet.

const BASE = "https://testnet.xrpl.org";

export function txUrl(hash) {
  if (!hash) return null;
  return `${BASE}/transactions/${hash}`;
}

export function acctUrl(address) {
  if (!address) return null;
  return `${BASE}/accounts/${address}`;
}

export function shortHash(hash, head = 6, tail = 4) {
  if (!hash) return "";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}
