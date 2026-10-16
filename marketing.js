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
document.querySelectorAll('[data-collection]').forEach(button => button.addEventListener('click', () => {
  const item=collections[button.dataset.collection];
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
  const dialog=document.querySelector('#collection-dialog');
  dialog.showModal(); dialog.scrollTop=0;
}));
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
