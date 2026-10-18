import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth/profile";
import { roleHome } from "@/lib/auth/roles";

async function HomeRedirect() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  redirect(roleHome(profile.role));
}

export default function Home() {
  return (
    <Suspense fallback={<main className="p-8 text-ink/60">Opening your desk…</main>}>
      <HomeRedirect />
    </Suspense>
  );
}
