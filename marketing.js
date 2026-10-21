const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
navigation.addEventListener('click', e => {
  if (e.target.closest('a,button')) { menu.setAttribute('aria-expanded','false'); navigation.classList.remove('open'); }
});
const filters = [...document.querySelectorAll('[data-filter]')];
function filterWork(category) {
  filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === category)));
  document.querySelectorAll('[data-category]').forEach(card => { card.hidden = category !== 'all' && card.dataset.category !== category; });
  document.querySelector('.portfolio-grid').classList.toggle('is-filtered', category !== 'all');
}
filters.forEach(button => button.addEventListener('click', () => filterWork(button.dataset.filter)));
document.querySelectorAll('[data-filter-link]').forEach(link => link.addEventListener('click', () => filterWork(link.dataset.filterLink)));
const collections = portfolio.collections;
const collectionDialog = document.querySelector('#collection-dialog');
const galleryPrefix = '#gallery/';
const galleryKeys = new Map(Object.entries(collections).map(([key, item]) => [item.slug, key]));
let activeCollection = null;
let galleryTrigger = null;

function galleryRoute() {
  if (!location.hash.startsWith(galleryPrefix)) return null;
  return galleryKeys.get(location.hash.slice(galleryPrefix.length)) || null;
}

function renderCollection(key) {
  if (activeCollection === key && collectionDialog.open) return;
  const item=collections[key];
  activeCollection = key;
  galleryTrigger = document.querySelector(`[data-collection="${key}"]`);
  document.querySelector('#collection-title').textContent=item.title;
  document.querySelector('#collection-description').textContent=item.description;
  const grid=document.querySelector('#collection-images'); grid.replaceChildren();
  const jumps=document.querySelector('#collection-jumps'); jumps.replaceChildren();
  const sections=item.sections || [{title:'Photographs',photos:item.photos}];
  jumps.hidden=sections.length<2;
  sections.forEach((section,sectionIndex) => {
    const group=document.createElement('section'); group.className='gallery-section';
    const heading=document.createElement('h3'); heading.id=`gallery-section-${sectionIndex}`; heading.tabIndex=-1;
    heading.textContent=section.title;
    group.setAttribute('aria-labelledby',heading.id);
    const count=document.createElement('p'); count.className='gallery-count'; count.textContent=`${section.photos.length} photographs`;
    const sectionGrid=document.createElement('div'); sectionGrid.className='gallery-grid';
    const jump=document.createElement('button'); jump.type='button'; jump.textContent=section.title;
    jump.addEventListener('click',()=>{heading.focus({preventScroll:true});group.scrollIntoView({block:'start',behavior:'instant'});});
    jumps.append(jump);
    section.photos.forEach((id,index) => {
    const photo=portfolio.photos[id];
    const figure=document.createElement('figure');
    const img=document.createElement('img');
    img.width=photo.width; img.height=photo.height; img.alt=photo.alt;
    img.decoding='async'; img.loading=sectionIndex===0&&index===0?'eager':'lazy';
    const wide=index===0 || (index===section.photos.length-1 && section.photos.length%2===0);
    if(wide) figure.className='gallery-wide';
    img.sizes=wide?'(max-width: 560px) calc(100vw - 64px), (max-width: 1050px) calc(100vw - 126px), 924px':'(max-width: 560px) calc(100vw - 64px), (max-width: 1050px) calc((100vw - 148px) / 2), 451px';
    img.srcset=photo.variants.map(v=>`${v.src} ${v.width}w`).join(', ');
    img.src=photo.variants[photo.variants.length-1].src;
    figure.append(img); sectionGrid.append(figure);
    });
    group.append(heading,count,sectionGrid); grid.append(group);
  });
  if (!collectionDialog.open) collectionDialog.showModal();
  collectionDialog.scrollTop=0;
}

function syncGalleryRoute() {
  const key = galleryRoute();
  if (key) {
    renderCollection(key);
    return;
  }
  // Unknown gallery links return to selected work without breaking other anchors.
  if (location.hash.startsWith(galleryPrefix)) {
    const url = new URL(location.href);
    url.hash = 'work';
    history.replaceState(null, '', url);
    document.querySelector('#work').scrollIntoView({block:'start'});
  }
  activeCollection = null;
  if (collectionDialog.open) collectionDialog.close();
}

document.querySelectorAll('[data-collection]').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.collection;
  const url = new URL(location.href);
  url.hash = `${galleryPrefix}${collections[key].slug}`;
  if (location.hash !== url.hash) {
    // Closing a gallery opened on this page returns to the exact prior URL.
    history.pushState({galleryReturn: location.href}, '', url);
  }
  renderCollection(key);
}));

collectionDialog.addEventListener('close', () => {
  // A route change may have closed this dialog, or reopened it before this event.
  if (collectionDialog.open) return;
  const closedCollection = activeCollection;
  activeCollection = null;
  if (galleryRoute() !== closedCollection || !closedCollection) return;
  if (galleryTrigger && !galleryTrigger.closest('[data-category]').hidden) {
    galleryTrigger.focus({preventScroll:true});
  }
  if (history.state?.galleryReturn) {
    history.back();
  } else {
    // A direct link has no local opener history; closing must keep visitors here.
    const url = new URL(location.href);
    url.hash = 'work';
    history.replaceState(null, '', url);
    document.querySelector('#work').scrollIntoView({block:'start'});
  }
});
window.addEventListener('popstate', syncGalleryRoute);
window.addEventListener('hashchange', syncGalleryRoute);
syncGalleryRoute();
document.querySelector('#open-reel').addEventListener('click', () => {
  const dialog=document.querySelector('#reel-dialog');
  const video=dialog.querySelector('video');
  video.src=window.matchMedia('(max-width: 800px)').matches
    ? 'assets/video/reel-720.mp4'
    : 'assets/video/reel-1080.mp4';
  dialog.showModal(); dialog.scrollTop=0;
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelectorAll('.close,.close-bottom').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close', () => {const video=dialog.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}});
});
