export const USER_ROLES = ["student", "proctor", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_HOME: Record<UserRole, string> = {
  student: "/dashboard/student",
  proctor: "/dashboard/proctor",
  admin: "/dashboard/admin",
};

export function isUserRole(value: string | null | undefined): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function roleHome(role: UserRole) {
  return ROLE_HOME[role];
}

export function requiredRoleForPath(pathname: string): UserRole | null {
  if (pathname === "/dashboard/student" || pathname.startsWith("/dashboard/student/")) {
    return "student";
  }

  if (pathname === "/dashboard/proctor" || pathname.startsWith("/dashboard/proctor/")) {
    return "proctor";
  }

  if (pathname === "/dashboard/admin" || pathname.startsWith("/dashboard/admin/")) {
    return "admin";
  }

  return null;
}
