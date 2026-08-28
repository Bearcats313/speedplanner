import { getActiveWeek } from "@/lib/actions/week";
import { WeekBoard } from "@/components/WeekBoard";
import { EmptyState } from "@/components/EmptyState";

export default async function WeekPage() {
  const week = await getActiveWeek();

  if (!week) return <EmptyState />;

  return <WeekBoard week={week} />;
}
