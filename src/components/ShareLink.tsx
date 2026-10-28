"use client";

import { useState } from "react";

export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-current/20 p-3">
      <label htmlFor="share-link" className="text-sm font-medium">
        Payment link
      </label>
      <input
        id="share-link"
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded-md border border-current/30 bg-transparent px-3 py-2 font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <button type="button" onClick={copy} className="rounded-md border border-current/40 px-3 py-1 text-sm">
          Copy link
        </button>
        <span role="status" aria-live="polite" className="text-sm">
          {copied ? "Copied." : ""}
        </span>
      </div>
      <p className="text-xs opacity-80">
        Save this link now. For security, StableFlow stores only a fingerprint of it and cannot
        show it again — you can create a new link later, which disables this one.
      </p>
    </div>
  );
}
