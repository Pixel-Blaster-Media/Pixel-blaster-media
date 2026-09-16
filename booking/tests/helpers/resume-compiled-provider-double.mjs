// Local test preloader only: no production imports. Deny all non-loopback real fetches.
const original=globalThis.fetch;
const fixture=JSON.parse(process.env.PF_COMPILED_FIXTURE);
globalThis.fetch=async(input,init={})=>{
 const r=new Request(input,init),u=new URL(r.url);
 if(u.hostname===fixture.host){
  const bearer=r.headers.get('authorization');
  if(u.pathname==='/auth/v1/user')return bearer==='Bearer '+fixture.token?Response.json(fixture.user):Response.json({message:'SENTINEL',code:'bad_jwt'},{status:401});
  if(u.pathname==='/rest/v1/profiles')return Response.json({id:fixture.user.id,organization_id:fixture.scope.organizationId,role:'admin',archived_at:null});
  if(u.pathname==='/rest/v1/bookings')return Response.json({id:fixture.scope.bookingId,property_id:fixture.scope.propertyId,status:'confirmed'});
  if(u.pathname==='/rest/v1/rpc/photo_finals_transfer_begin')return Response.json(fixture.state);
  if(u.pathname==='/rest/v1/rpc/photo_finals_chunk_begin')return Response.json({code:'54000',message:'finals_attempt_budget',details:'SENTINEL'},{status:500});
  return Response.json({message:'unhandled local provider double'},{status:503});
 }
 if(u.hostname==='127.0.0.1'||u.hostname==='localhost')return original(input,init);
 throw Error('Test fixture blocked external network');
};
