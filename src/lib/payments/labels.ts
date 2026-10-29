import type { RequestStatus } from "./requests";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Waiting for payment",
  confirming: "Payment submitted — confirming",
  confirmed: "Payment confirmed on testnet",
  expired: "Expired",
  cancelled: "Cancelled",
  under_review: "Under review — payment evidence changed on chain",
};

/** Plain-language reasons a submitted transaction did not satisfy a request. */
export const REJECTION_MESSAGES: Record<string, string> = {
  invalid_hash: "That is not a valid transaction hash.",
  reverted: "The transaction failed on chain, so no USDC moved. You can try again.",
  request_missing_creation_block: "This request was created before verification was available and can’t be paid. Ask for a new link.",
  no_token_transfer: "The transaction did not move any Base Sepolia test USDC.",
  // Retired by D37; kept so older attempts still read clearly.
  wrong_token_contract: "The transaction did not use the Base Sepolia test USDC contract.",
  not_direct_transfer: "The transaction was not a direct USDC transfer.",
  wrong_recipient: "The USDC went to a different address than this request.",
  wrong_amount: "The amount sent does not exactly match this request.",
  unexpected_transfer_logs: "The transaction contained an unexpected set of USDC transfers.",
  sender_mismatch: "The transfer was not sent by the transaction’s own account.",
  transfer_before_request: "This transfer happened before the request was created.",
  transfer_after_expiry: "This transfer happened after the request expired. The USDC may still have arrived on chain, but it can’t be matched to this request.",
  evidence_already_used: "This transfer has already been used to pay another request.",
  evidence_before_request: "This transfer happened before the request was created.",
  evidence_after_expiry: "This transfer happened after the request expired.",
  evidence_mismatch: "This transfer does not match the request.",
  request_already_confirmed: "This request was already paid by another transaction.",
  request_not_open: "This request is no longer accepting payments.",
};

export function rejectionMessage(code: string | null): string {
  return (code && REJECTION_MESSAGES[code]) ?? "This transaction can’t be matched to this request.";
}
