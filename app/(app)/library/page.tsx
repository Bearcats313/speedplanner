import { LibraryBrowser } from "@/components/LibraryBrowser";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[28px] font-semibold text-ink">Library</h1>
      <LibraryBrowser />
    </div>
  );
}
