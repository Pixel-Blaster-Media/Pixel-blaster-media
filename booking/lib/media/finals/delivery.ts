import {selectDeliverySources,type DeliverySourceCandidate} from '../../booking/delivery-source-policy.ts';
/** Invoke the authorized reader each time; never reuse a preview's readiness or
 * infer an iGUIDE vacancy from a provider fetch failure. A Pixel read failure
 * excludes Pixel only, preserving legacy/video-only delivery availability. */
export async function resolveFinalsDelivery(incumbent:DeliverySourceCandidate[],read:()=>Promise<{gallery:{downloads:DeliverySourceCandidate[]}|null}|null>):Promise<DeliverySourceCandidate[]>{
 let current=null;
 try{current=await read();}catch{/* Unconfirmed Pixel media must not enter the email. */}
 const downloads=current?.gallery?.downloads??[];
 const complete=downloads.length===2&&['photos_mls','photos_full_res'].every(slot=>downloads.some(d=>d.source==='pixel_release'&&d.category==='photos'&&d.slot===slot));
 return selectDeliverySources([...incumbent,...(complete?downloads:[])],{pixelFallbackEnabled:complete,pixelPackageSetComplete:complete});
}
