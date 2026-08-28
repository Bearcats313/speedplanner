import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-4 pt-6">{children}</div>
      <Nav />
    </div>
  );
}
