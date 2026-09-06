import { recoveryStatus } from "@/lib/integrations/recovery-status";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return recoveryStatus(request, process.env.CRON_SECRET, getServiceSupabase);
}