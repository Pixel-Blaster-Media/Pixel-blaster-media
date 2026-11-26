type FolderEntry = Pick<File, 'name' | 'type' | 'size' | 'webkitRelativePath'>;

export function selectEditsFolder<T extends FolderEntry>(entries: Iterable<T>) {
  const all = Array.from(entries);
  // Ignore sources, sidecars and any exports inside nested folders.
  const files = all.filter(file => {
    const path = file.webkitRelativePath.split('/');
    return path.length === 2 && path[0] !== '' && path[1] === file.name
      && /\.jpe?g$/i.test(file.name) && (file.type === 'image/jpeg' || file.type === '');
  });
  if (files.length === 0) throw new Error('No JPEGs at the top level. Choose the exact folder containing your finished exports.');
  const folder = files[0].webkitRelativePath.split('/')[0];
  if (files.some(f => f.webkitRelativePath.split('/')[0] !== folder)) throw new Error('Choose one export folder at a time.');
  if (files.length > 100) throw new Error('Choose an export folder with no more than 100 JPEGs.');
  if (files.some(file => file.size < 1 || file.size > 33554432)) throw new Error('Each finished JPEG must be between 1 byte and 32 MiB.');
  if (files.reduce((bytes,file) => bytes + file.size, 0) > 1000000000) throw new Error("Finished JPEGs must total no more than 1 GB per folder.");
  const order = new Intl.Collator('en', {numeric:true, sensitivity:'variant'});
  return { folder, files: files.sort((a,b) => order.compare(a.name,b.name)), skipped: all.length - files.length };
}
