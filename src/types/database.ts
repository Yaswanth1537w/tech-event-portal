import type { UserRole } from "@/lib/auth/roles";

export type Profile = {
  id: string;
  full_name: string;
  roll_number: string;
  department: string;
  role: UserRole;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          full_name: string;
          roll_number: string;
          department: string;
          role: UserRole;
        };
        Update: Partial<Omit<Profile, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
