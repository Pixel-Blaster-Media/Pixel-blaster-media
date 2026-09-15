import { photoFinalsEligibility, type PhotoFinalsScope } from './config.ts';
type Env=Readonly<Record<string,string|undefined>>;
function required(env:Env,key:string){const v=env[key];if(!v||v.length>4096||v.trim()!==v||/[\r\n\0]/.test(v))throw new Error('finals_configuration_invalid');return v;}
/** Configuration is an operator attestation, not remote proof of bucket privacy.
 * No development variables, bucket, endpoint override or public origin is reused. */
export function loadProductionFinalsConfig(env:Env,scope:PhotoFinalsScope){
 const e=photoFinalsEligibility(env,scope);
 if(!e.eligible||e.environment!=='production'||env.PHOTO_FINALS_PRODUCTION_ACK!=='private-resources-schema-runtime-certified-v1')throw new Error('finals_production_disabled');
 const account=required(env,'PHOTO_FINALS_R2_ACCOUNT_ID');if(!/^[a-f0-9]{32}$/.test(account))throw new Error('finals_configuration_invalid');
 const bucket=required(env,'PHOTO_FINALS_R2_BUCKET');
 const raw=required(env,'PHOTO_FINALS_PRIVATE_BUCKET_ALLOWLIST');const allowed:unknown=JSON.parse(raw);
 const validBucket=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v)&&!/(?:^|-)(?:dev|development|synthetic|public)(?:-|$)/.test(v);
 if(!Array.isArray(allowed)||allowed.length<1||allowed.length>10||!allowed.every(validBucket)||new Set(allowed).size!==allowed.length||!validBucket(bucket)||!allowed.includes(bucket))throw new Error('finals_private_bucket_invalid');
 const accessKeyId=required(env,'PHOTO_FINALS_R2_ACCESS_KEY_ID'),secretAccessKey=required(env,'PHOTO_FINALS_R2_SECRET_ACCESS_KEY');
 if(!/^[a-f0-9]{32}$/.test(accessKeyId)||! /^[a-f0-9]{64}$/.test(secretAccessKey))throw new Error('finals_credentials_invalid');
 const supabaseUrl=required(env,'NEXT_PUBLIC_SUPABASE_URL');
 if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseUrl))throw new Error('finals_database_origin_invalid');
 const serviceKey=required(env,'SUPABASE_SERVICE_ROLE_KEY');
 return Object.freeze({endpoint:`https://${account}.r2.cloudflarestorage.com`,bucket,credentials:Object.freeze({accessKeyId,secretAccessKey}),supabaseUrl,serviceKey});
}
export function finalsExecutionAllowed(env:Env,scope:PhotoFinalsScope){
 const e=photoFinalsEligibility(env,scope);if(!e.eligible)return false;
 if(e.environment==='synthetic-local')return true;
 try{loadProductionFinalsConfig(env,scope);return true;}catch{return false;}
}
