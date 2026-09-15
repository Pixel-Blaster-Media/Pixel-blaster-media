import 'server-only';
import {createPackageStatusReader} from './operator-status';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { FinalsIdentity, FinalsRuntime } from './http';
import { loadProductionFinalsConfig } from './production-config';
import { createProductionFinalsDatabase } from './transport';
import { createFinalsPresigner } from './presigner';
import { FinalsR2Storage } from './storage';
/** Construct only after complete production opt-in; never uses development config.
 * Configuration does not replace the external certification/activation gate. */
export async function createProductionFinalsRuntime(identity:FinalsIdentity):Promise<FinalsRuntime|null>{
 try{
  const env=Object.freeze({...process.env}),config=loadProductionFinalsConfig(env,identity.scope);
  const client=new S3Client({region:'auto',endpoint:config.endpoint,credentials:{...config.credentials},forcePathStyle:false,maxAttempts:1,
   requestHandler:new NodeHttpHandler({connectionTimeout:5000,requestTimeout:10000,throwOnRequestTimeout:true,socketTimeout:10000}),requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const db=createProductionFinalsDatabase(config);
  return {env,db,readPackageStatus:createPackageStatusReader(config,identity,db),budgets:{totalMs:240_000},storage:new FinalsR2Storage({client,organizationId:identity.scope.organizationId,buckets:{quarantine:config.bucket,masters:config.bucket,delivery:config.bucket}}),issueUpload:createFinalsPresigner(client,db,config.bucket)};
 }catch{return null;}
}
