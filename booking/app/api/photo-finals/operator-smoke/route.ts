import 'server-only';
import {getServerSupabase} from '@/lib/supabase/server';
import {verifiedResumeSession} from '@/lib/media/finals/resume-session';
import {createOperatorSmokeHandler, createSmokeStorage} from '@/lib/media/finals/operator-smoke';

export const runtime='nodejs';
export const maxDuration=20;
export const dynamic='force-dynamic';

export async function POST(request:Request) {
  const enteredAt=Date.now();
  return createOperatorSmokeHandler({
    env:process.env,
    storage:createSmokeStorage,
    async authorize(_request,signal) {
      const db=await getServerSupabase();
      const session=await verifiedResumeSession(db.auth);
      signal.throwIfAborted();
      if(!session)return null;
      const {data:profile,error}=await db.from('profiles')
        .select('id,organization_id,role,archived_at').eq('id',session.actorId)
        .abortSignal(signal).maybeSingle<{id:string;organization_id:string;role:string;archived_at:string|null}>();
      if(error || !profile || profile.id!==session.actorId || profile.archived_at!==null || profile.role!=='admin')return null;
      const {data:member,error:membershipError}=await db.from('organization_members')
        .select('organization_id,role').eq('profile_id',session.actorId)
        .eq('organization_id',profile.organization_id).in('role',['owner','admin'])
        .abortSignal(signal).maybeSingle<{organization_id:string;role:string}>();
      if(membershipError || !member || member.organization_id!==profile.organization_id)return null;
      return {actorId:session.actorId,organizationId:profile.organization_id,role:profile.role,archivedAt:profile.archived_at,membershipRole:member.role};
    },
  })(request,enteredAt);
}
