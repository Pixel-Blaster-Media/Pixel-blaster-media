import {after} from 'next/server';
import {getCurrentUserResult} from '@/lib/auth/current-user';
import {getServerSupabase} from '@/lib/supabase/server';
import {createFinalsHandler} from '@/lib/media/finals/http';
import {createProductionFinalsRuntime} from '@/lib/media/finals/production';
import {UUID} from '@/lib/media/finals/manifest';
export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
const handler=createFinalsHandler({
 async authorize(_request,bookingId,signal){
  if(!UUID.test(bookingId))return null;
  const user=await getCurrentUserResult();if(user.kind!=='active'||user.profile.archivedAt)return null;
  const p=user.profile,db=await getServerSupabase();
  // Session/RLS first, then every canonical RPC independently checks live ownership.
  const query=db.from('bookings').select('id,organization_id,property_id,owner_id,status').eq('id',bookingId).eq('organization_id',p.organizationId);
  const {data,error}=await (signal?query.abortSignal(signal):query).maybeSingle<{id:string;organization_id:string;property_id:string;owner_id:string;status:string}>();
  if(error||!data||data.status==='cancelled')return null;
  return {actorId:p.userId,operator:p.role==='admin',scope:{organizationId:p.organizationId,bookingId:data.id,propertyId:data.property_id}};
 },
 schedule:callback=>after(callback),
 runtime:createProductionFinalsRuntime,
});
export async function GET(request:Request,context:{params:Promise<{bookingId:string}>}){return handler(request,(await context.params).bookingId);}
export async function POST(request:Request,context:{params:Promise<{bookingId:string}>}){const enteredAt=Date.now();return handler(request,(await context.params).bookingId,enteredAt);}
