import { Suspense } from "react";
import { Navbar } from "@/components/navbar";

function NavbarFallback() {
  return (
    <div className="h-[4.25rem] border-b border-ink/10 bg-paper" aria-hidden="true" />
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-paper">
      <Suspense fallback={<NavbarFallback />}>
        <Navbar />
      </Suspense>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
