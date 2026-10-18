import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isUserRole, requiredRoleForPath, roleHome } from "@/lib/auth/roles";
import type { Database } from "@/types/database";
import { getSupabasePublicEnvOrNull } from "./env";

const PUBLIC_PATHS = new Set(["/login"]);

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const env = getSupabasePublicEnvOrNull();

  if (!env) {
    if (isPublicPath(request.nextUrl.pathname) || request.nextUrl.pathname === "/") {
      return supabaseResponse;
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  const { url, anonKey } = env;

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (isPublicPath(pathname) || pathname === "/") {
      return supabaseResponse;
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !isUserRole(profile.role)) {
    await supabase.auth.signOut();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("error", "profile");
    return NextResponse.redirect(loginUrl);
  }

  const destination = roleHome(profile.role);

  if (pathname === "/" || pathname === "/login" || pathname === "/dashboard") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = destination;
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  const requiredRole = requiredRoleForPath(pathname);

  if (requiredRole && requiredRole !== profile.role) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = destination;
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}
