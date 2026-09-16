import {getServerSupabase} from '@/lib/supabase/server';
import {createResumeHandler} from '@/lib/media/finals/resume-http';
import {verifiedResumeSession} from '@/lib/media/finals/resume-session';
import {createProductionFinalsRuntime} from '@/lib/media/finals/production';
export const runtime='nodejs';
export const maxDuration=90;
export const dynamic='force-dynamic';
const handler=createResumeHandler({
 env:process.env,
 async authorize(_request,bookingId,signal){
  // Fresh authoritative verification on both admission and final handoff.
  const db=await getServerSupabase(),session=await verifiedResumeSession(db.auth);
  if(!session)return null;signal.throwIfAborted();
  const {data:p,error}=await db.from('profiles').select('id,organization_id,role,archived_at').eq('id',session.actorId).abortSignal(signal).maybeSingle<{id:string;organization_id:string;role:string;archived_at:string|null}>();
  if(error||!p||p.archived_at)return null;
  const {data:b,error:bookingError}=await db.from('bookings').select('id,property_id,status').eq('id',bookingId).eq('organization_id',p.organization_id).abortSignal(signal).maybeSingle<{id:string;property_id:string;status:string}>();
  if(bookingError||!b||b.status==='cancelled')return null;
  return {...session,operator:p.role==='admin',scope:{organizationId:p.organization_id,bookingId:b.id,propertyId:b.property_id}};
 },
 runtime:createProductionFinalsRuntime,
});
export async function GET(request:Request,context:{params:Promise<{bookingId:string}>}){const enteredAt=Date.now();return handler(request,(await context.params).bookingId,enteredAt);}
export async function POST(request:Request,context:{params:Promise<{bookingId:string}>}){const enteredAt=Date.now();return handler(request,(await context.params).bookingId,enteredAt);}
