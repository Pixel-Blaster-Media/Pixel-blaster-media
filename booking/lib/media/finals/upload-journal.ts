// Browser metadata only. Never retain bytes, credentials or upload capabilities.
export type UploadIntent={requestId:string;intentId:string;sha256:string;byteSize:number};
type Store=Pick<Storage,'getItem'|'setItem'>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function rememberUpload(storage:Store,identity:string,file:{sha256:string;byteSize:number}):UploadIntent{
 if(!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.byteSize)||file.byteSize<1||file.byteSize>33554432)throw new Error('Invalid JPEG identity');
 const key='pixel-finals-upload.v1:'+identity,raw=storage.getItem(key);
 if(raw&&raw.length>32768)throw new Error('Upload recovery journal needs attention');
 const journal: {requestId:string;files:UploadIntent[]}=raw?JSON.parse(raw):{requestId:crypto.randomUUID(),files:[]};
 if(!uuid.test(journal.requestId)||!Array.isArray(journal.files)||journal.files.length>100||journal.files.some(f=>!f||!uuid.test(f.intentId)||f.requestId!==journal.requestId||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.byteSize)||f.byteSize<1||f.byteSize>33554432))throw new Error('Upload recovery journal needs attention');
 const existing=journal.files.find(f=>f.sha256===file.sha256&&f.byteSize===file.byteSize);if(existing)return existing;
 if(journal.files.length>=100)throw new Error('This upload batch already contains 100 photos');
 const intent={requestId:journal.requestId,intentId:crypto.randomUUID(),...file};journal.files.push(intent);
 // Persist before any intent/allocation request. A blocked/full store stops upload.
 storage.setItem(key,JSON.stringify(journal));return intent;
}
