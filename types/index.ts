// Parameters for createEscrow.
// - userSeed:            the seed of the user staking the XRP.
// - destinationAddress:  where the funds go on EscrowFinish. Under Option B
//                        (see SCHEMA.md) this is the charity's XRPL address,
//                        NOT the pot. The pot wallet is only a signer/fee-payer.
// - amountXRP:           stake amount as a decimal string (converted to drops).
// - deadline:            goal deadline; sets on-chain CancelAfter.
export interface CreateEscrowParams {
  userSeed: string;
  destinationAddress: string;
  amountXRP: string;
  deadline: Date;
}

// creates the escrow result for create escroe
// escrowsequence is the sequence of the escrow
// txhash is the hash of the escrow transaction (hash which ids the transaction)
export interface CreateEscrowResult {
  escrowSequence: number;
  txHash: string;
}

// finish escrow params ( what we pass into finshEscrow function)
// potwalletseed - self explanatory
// useraddress - the address of the escrow owner
// escrowsequence - the sequence of the escrow
export interface FinishEscrowParams {
  potWalletSeed: string;
  userAddress: string;
  escrowSequence: number;
}

// cancel escrow params ( what we pass into cancelEscrow function)
// userseed - the seed of the user who is canceling the escrow
// useraddress - the address of the escrow owner
// escrowsequence - the sequence of the escrow
export interface CancelEscrowParams {
  userSeed: string;
  userAddress: string;
  escrowSequence: number;
}

// escrow tx result ( what we get back from the escrow transaction)
// txhash is the hash of the escrow transaction (hash which ids the transaction)
export interface EscrowTxResult {
  txHash: string;
}
