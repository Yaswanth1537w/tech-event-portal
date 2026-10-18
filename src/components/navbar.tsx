import { Building2, GraduationCap, Hash, LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { getCurrentProfile } from "@/lib/auth/profile";
import type { UserRole } from "@/lib/auth/roles";

const ROLE_LABEL: Record<UserRole, string> = {
  student: "Student",
  proctor: "Proctor",
  admin: "Admin",
};

const ROLE_BADGE: Record<UserRole, string> = {
  student: "bg-sky-100 text-sky-900 ring-sky-200",
  proctor: "bg-amber-100 text-amber-950 ring-amber-200",
  admin: "bg-violet-100 text-violet-950 ring-violet-200",
};

export async function Navbar() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="font-display text-lg tracking-tight text-ink">Event Portal</p>
          <p className="truncate text-sm text-ink/65">{profile.full_name}</p>
        </div>

        <div className="hidden min-w-0 items-center gap-5 md:flex">
          <Meta icon={Hash} label="Roll number" value={profile.roll_number} />
          <Meta icon={Building2} label="Department" value={profile.department} />
          <Meta icon={GraduationCap} label="Role" value={ROLE_LABEL[profile.role]} hidden />
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium ring-1 ${ROLE_BADGE[profile.role]}`}
          >
            {ROLE_LABEL[profile.role]}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-ink/15 bg-white px-4 text-sm font-medium text-ink transition hover:border-ink/30 hover:bg-ink/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto border-t border-ink/8 px-4 py-2 text-sm text-ink/70 md:hidden">
        <span>Roll {profile.roll_number}</span>
        <span>{profile.department}</span>
      </div>
    </header>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  hidden = false,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-ink/40" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-ink/50">{label}</p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
