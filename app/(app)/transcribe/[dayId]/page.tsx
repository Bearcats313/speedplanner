// Fallback for a dead push endpoint (PRD R7). Not built in v1 — tech spec
// §7.2, §9: "not built in v1. Spec in PRD R7." Push (R16) is confirmed
// working, so this route exists to reserve the path but does nothing yet.
// Build it out per PRD R7 the day push actually breaks.

export default async function TranscribePage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  await params;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-paper px-6 text-center">
      <p className="text-[16px] text-ink">Transcribe view isn&apos;t built yet.</p>
      <p className="text-[13px] text-ink/50">
        It&apos;s the fallback for when push to the machine stops working. Push is confirmed
        working, so this hasn&apos;t been needed — see PRD R7.
      </p>
    </main>
  );
}
