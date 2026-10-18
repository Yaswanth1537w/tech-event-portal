import { getCurrentProfile } from "@/lib/auth/profile";
import type { UserRole } from "@/lib/auth/roles";

const COPY: Record<UserRole, { title: string; body: string }> = {
  student: {
    title: "Student desk",
    body: "Browse events, register, and keep your participation record in one place.",
  },
  proctor: {
    title: "Proctor desk",
    body: "Check halls, attendance, and the students assigned to your sessions.",
  },
  admin: {
    title: "Admin desk",
    body: "Manage users, roles, and the event catalog for the campus.",
  },
};

export async function RoleDashboard({ role }: { role: UserRole }) {
  const profile = await getCurrentProfile();
  const copy = COPY[role];

  return (
    <main>
      <h1 className="font-display text-4xl tracking-tight text-ink">{copy.title}</h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-ink/70">{copy.body}</p>
      {profile ? (
        <p className="mt-8 text-sm text-ink/55">
          Signed in as {profile.full_name} · {profile.department}
        </p>
      ) : null}
    </main>
  );
}
