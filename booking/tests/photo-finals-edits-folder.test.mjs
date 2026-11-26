import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEditsFolder} from '../lib/media/finals/edits-folder.ts';

const entry = (name, props={}) => ({name, type:'image/jpeg', size:1024, webkitRelativePath:'Edits/'+name, ...props});
test('Edits folder stages only direct JPEG exports in natural filename order', () => {
  const final10=entry('PBM-10.JPG'), final2=entry('PBM-2.jpg',{type:''});
  assert.deepEqual(selectEditsFolder([final10,entry('sidecar.xmp'),entry('source.jpg',{webkitRelativePath:'Edits/RAW/source.jpg'}),entry('wrong.jpg',{type:'image/png'}),final2]),{
    folder:'Edits', files:[final2,final10], skipped:3,
  });
});
test('Edits folder refuses empty, mismatched, mixed or invalid exports before staging', () => {
  assert.throws(()=>selectEditsFolder([entry('draft.jpeg',{webkitRelativePath:'Property/Edits/draft.jpeg'})]),/No JPEGs/);
  assert.throws(()=>selectEditsFolder([entry('a.jpg'),entry('b.jpg',{webkitRelativePath:'Other/b.jpg'})]),/one export folder/);
  for (const size of [0,33554433]) assert.throws(()=>selectEditsFolder([entry('a.jpg',{size})]),/32 MiB/);
});
test('Edits folder can include a full real-estate shoot but honors the release limit', () => {
  const entries=Array.from({length:101},(_,i)=>entry('PBM-'+i+'.jpg'));
  assert.equal(selectEditsFolder(entries.slice(0,50)).files.length,50);
  assert.equal(selectEditsFolder(entries.slice(0,100)).files.length,100);
  assert.throws(()=>selectEditsFolder(entries),/100 JPEGs/);
});
