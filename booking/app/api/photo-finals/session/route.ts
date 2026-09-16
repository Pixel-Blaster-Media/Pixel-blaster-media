import {getServerSupabase} from '@/lib/supabase/server';
import {verifiedResumeSession} from '@/lib/media/finals/resume-session';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(process.env.PHOTO_FINALS_RESUMABLE_ENABLED!=='1')return Response.json({identity:null},{headers});
 try{const db=await getServerSupabase(),session=await verifiedResumeSession(db.auth);return Response.json({identity:session?.sessionHash??null},{headers});}
 catch{return Response.json({status:'unavailable'},{status:503,headers});}
}
