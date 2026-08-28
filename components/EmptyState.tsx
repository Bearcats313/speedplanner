import Link from "next/link";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-[16px] text-ink/70">No plan yet.</p>
      <Link
        href="/generate"
        className="flex h-11 items-center rounded-md bg-signal px-5 text-[14px] font-medium text-white"
      >
        Generate week
      </Link>
    </div>
  );
}
