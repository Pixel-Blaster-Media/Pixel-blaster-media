import { finalsCronAuthorized, runFinalsDispatch } from '@/lib/media/finals/dispatcher';
import { createProductionFinalsRuntime } from '@/lib/media/finals/production';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Authenticated manual recovery, not another Vercel cron entry.
export async function GET(request:Request){
 if(!finalsCronAuthorized(request,process.env.CRON_SECRET))return Response.json({ok:false},{status:401});
 const result=await runFinalsDispatch(process.env,createProductionFinalsRuntime);
 return Response.json(result,{status:result.ok?200:503,headers:{'Cache-Control':'private, no-store'}});
}
