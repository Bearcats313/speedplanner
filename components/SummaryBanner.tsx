export function SummaryBanner({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return <p className="text-[14px] leading-relaxed text-ink/70">{summary}</p>;
}
