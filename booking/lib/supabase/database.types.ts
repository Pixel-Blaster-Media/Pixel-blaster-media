// Generated types placeholder.
//
// Once Supabase is provisioned and the migration in supabase/migrations/
// has been applied, regenerate this file with:
//
//   npx supabase gen types typescript \
//     --project-id YOUR-PROJECT-REF > lib/supabase/database.types.ts
//
// or, with the local CLI:
//
//   npm run db:types
//
// Until then, this minimal shape keeps the Supabase clients type-safe
// without coupling them to the schema details.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
