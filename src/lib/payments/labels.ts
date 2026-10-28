import type { RequestStatus } from "./requests";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Waiting for payment",
  confirming: "Payment submitted — confirming",
  confirmed: "Payment confirmed on testnet",
  expired: "Expired",
  cancelled: "Cancelled",
};
