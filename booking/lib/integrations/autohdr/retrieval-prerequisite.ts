/**
 * AutoHDR retrieval deliberately remains unavailable until the application has
 * a DNS-pinned, redirect-denying HTTPS streamed downloader that can discover
 * and verify the expected SHA-256 before createProductionR2Storage writes an
 * immutable checksum-addressed master. The current R2 boundary requires that
 * expected SHA-256 before the write begins, so buffering provider responses or
 * returning their signed URLs would weaken the security contract.
 */
export const AUTOHDR_RETRIEVAL_PREREQUISITE =
  "Retrieval needs a DNS-pinned streamed downloader and a verified expected SHA-256 before private immutable storage can accept provider output.";
