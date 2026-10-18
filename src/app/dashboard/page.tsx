import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth/profile";
import { roleHome } from "@/lib/auth/roles";

async function DashboardRedirect() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  redirect(roleHome(profile.role));
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-ink/60">Opening your desk…</p>}>
      <DashboardRedirect />
    </Suspense>
  );
}
