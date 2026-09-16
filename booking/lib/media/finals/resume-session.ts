import {createHash} from 'node:crypto';
type Auth={getSession():Promise<{data:{session:{access_token:string}|null};error:unknown}>;getUser(token:string):Promise<{data:{user:{id:string}|null};error:unknown}>};
/** Decode only after getUser validates the exact token; a lookup ID is not authority. */
export async function verifiedResumeSession(auth:Auth){
 const s=await auth.getSession();if(s.error||!s.data.session)return null;
 const token=s.data.session.access_token;
 const verified=await auth.getUser(token);if(verified.error||!verified.data.user)return null;
 try{
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(payload.sub!==verified.data.user.id||typeof payload.session_id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.session_id))return null;
  return {actorId:verified.data.user.id,sessionHash:createHash('sha256').update(payload.sub+':'+payload.session_id).digest('hex')};
 }catch{return null;}
}
