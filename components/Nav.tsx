"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";

const TABS = [
  { href: "/week", label: "Week" },
  { href: "/generate", label: "Generate" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-10 flex h-14 items-stretch border-t border-line bg-surface">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 items-center justify-center text-[13px] font-medium ${
              active ? "text-signal" : "text-ink/60"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      <form action={signOut} className="flex items-center">
        <button type="submit" className="px-4 text-[13px] text-ink/60">
          Sign out
        </button>
      </form>
    </nav>
  );
}
