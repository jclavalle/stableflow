import Link from "next/link";

export function SiteNav() {
  return (
    <nav aria-label="Main" className="w-full border-b border-current/10">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold">
          StableFlow
        </Link>
        <Link href="/requests" className="underline-offset-4 hover:underline">
          Requests
        </Link>
        <Link href="/account" className="underline-offset-4 hover:underline">
          Account
        </Link>
      </div>
    </nav>
  );
}
