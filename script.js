/* ============================================================
   PIXEL BLASTER MEDIA — JAVASCRIPT
   ============================================================ */

/* ------------------------------------------------------------
   NAVBAR — shrink on scroll
   ------------------------------------------------------------ */
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });


/* ------------------------------------------------------------
   HAMBURGER MENU
   ------------------------------------------------------------ */
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  const isOpen = hamburger.classList.toggle('open');
  navLinks.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
});

// Close menu when any nav link is clicked
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
    document.body.style.overflow = '';
  });
});


/* ------------------------------------------------------------
   PORTFOLIO — Category cards → gallery
   ------------------------------------------------------------ */
const catCards            = document.querySelectorAll('.cat-card');
const portfolioCategories = document.getElementById('portfolioCategories');
const portfolioGrid       = document.getElementById('portfolioGrid');
const portfolioBack       = document.getElementById('portfolioBack');
const portfolioItems      = document.querySelectorAll('.portfolio-item');

catCards.forEach(card => {
  card.addEventListener('click', () => {
    const filter = card.dataset.filter;

    // Show only items matching the selected category
    portfolioItems.forEach(item => {
      item.classList.toggle('hidden', item.dataset.type !== filter);
    });

    // Swap views
    portfolioCategories.classList.add('hidden');
    portfolioGrid.classList.remove('hidden');
    portfolioBack.classList.remove('hidden');

    // Scroll to top of portfolio section
    document.getElementById('portfolio').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

portfolioBack.addEventListener('click', () => {
  portfolioCategories.classList.remove('hidden');
  portfolioGrid.classList.add('hidden');
  portfolioBack.classList.add('hidden');
  portfolioItems.forEach(item => item.classList.remove('hidden'));
});


/* ------------------------------------------------------------
   SCROLL ANIMATIONS
   ------------------------------------------------------------ */
// Add the .anim class to elements we want to animate in
const animTargets = [
  '.section-header',
  '.service-card',
  '.cat-card',
  '.about-images',
  '.about-content',
  '.contact-item',
  '.contact-form',
  '.stat',
];

animTargets.forEach(selector => {
  document.querySelectorAll(selector).forEach((el, i) => {
    el.classList.add('anim');
    // Stagger delay for sibling items
    if (i % 4 === 1) el.classList.add('delay-1');
    if (i % 4 === 2) el.classList.add('delay-2');
    if (i % 4 === 3) el.classList.add('delay-3');
  });
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.anim').forEach(el => observer.observe(el));


/* ------------------------------------------------------------
   SHOWREEL PLAY BUTTON
   ------------------------------------------------------------ */
const reelVideo   = document.getElementById('reelVideo');
const reelPlayBtn = document.getElementById('reelPlayBtn');

if (reelVideo && reelPlayBtn) {
  reelPlayBtn.addEventListener('click', () => {
    reelPlayBtn.classList.add('hidden');
    reelVideo.controls = true;
    reelVideo.play();
  });

  reelVideo.addEventListener('ended', () => {
    reelVideo.controls = false;
    reelPlayBtn.classList.remove('hidden');
  });
}


/* ------------------------------------------------------------
   CONTACT FORM
   Swap the Formspree action URL in index.html to make it live.
   Until then, this shows a success message for demo purposes.
   ------------------------------------------------------------ */
const contactForm = document.getElementById('contactForm');

contactForm.addEventListener('submit', async (e) => {
  const action = contactForm.getAttribute('action');

  // If Formspree isn't set up yet, show a demo confirmation
  if (!action || action.includes('YOUR_FORM_ID')) {
    e.preventDefault();
    showFormSuccess();
    return;
  }

  // If Formspree IS set up, let the form submit normally (page redirects)
  // or you can use fetch() below for a seamless AJAX submit:
  e.preventDefault();

  const btn = contactForm.querySelector('button[type="submit"]');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    const data = new FormData(contactForm);
    const res  = await fetch(action, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      showFormSuccess();
    } else {
      btn.textContent = 'Error — please email us directly';
      btn.disabled = false;
    }
  } catch {
    btn.textContent = 'Error — please email us directly';
    btn.disabled = false;
  }
});

function showFormSuccess() {
  contactForm.innerHTML = `
    <div style="
      text-align:center;
      padding: 3rem 2rem;
      border: 1px solid rgba(26,127,142,0.3);
      border-radius: 14px;
      background: rgba(26,127,142,0.06);
    ">
      <svg style="width:48px;height:48px;color:#22a4b5;margin:0 auto 1rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <h3 style="font-size:1.25rem;font-weight:700;margin-bottom:0.5rem;">Message Sent!</h3>
      <p style="color:#94a3b8;font-size:0.9rem;">Thanks for reaching out. We'll be in touch within 24 hours.</p>
    </div>
  `;
}


/* ------------------------------------------------------------
   LIGHTBOX
   ------------------------------------------------------------ */
const lightbox        = document.getElementById('lightbox');
const lightboxImg     = document.getElementById('lightboxImg');
const lightboxClose   = document.getElementById('lightboxClose');
const lightboxPrev    = document.getElementById('lightboxPrev');
const lightboxNext    = document.getElementById('lightboxNext');
const lightboxCounter = document.getElementById('lightboxCounter');

let lbItems = [];  // visible portfolio items for the current category
let lbIndex = 0;   // which one is open

function openLightbox(items, index) {
  lbItems = items;
  lbIndex = index;
  updateLightboxPhoto();
  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('open');
  document.body.style.overflow = '';
}

function updateLightboxPhoto() {
  const img = lbItems[lbIndex].querySelector('img');
  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightboxCounter.textContent = `${lbIndex + 1} / ${lbItems.length}`;
}

function lightboxStep(dir) {
  lbIndex = (lbIndex + dir + lbItems.length) % lbItems.length;
  updateLightboxPhoto();
}

// Open lightbox when any portfolio item is clicked
portfolioItems.forEach(item => {
  item.addEventListener('click', () => {
    const visible = Array.from(portfolioItems).filter(i => !i.classList.contains('hidden'));
    const index   = visible.indexOf(item);
    if (index === -1) return;
    openLightbox(visible, index);
  });
});

lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click',  () => lightboxStep(-1));
lightboxNext.addEventListener('click',  () => lightboxStep(1));

// Click outside image (on the dark backdrop) to close
lightbox.addEventListener('click', e => {
  if (e.target === lightbox) closeLightbox();
});

// Keyboard: ESC closes, arrow keys navigate
document.addEventListener('keydown', e => {
  if (!lightbox.classList.contains('open')) return;
  if (e.key === 'Escape')     { closeLightbox();      return; }
  if (e.key === 'ArrowLeft')  { lightboxStep(-1);     return; }
  if (e.key === 'ArrowRight') { lightboxStep(1);      return; }
});


/* ------------------------------------------------------------
   ACTIVE NAV LINK on scroll (highlight current section)
   ------------------------------------------------------------ */
const sections  = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.getAttribute('id');
      navAnchors.forEach(a => {
        a.style.color = a.getAttribute('href') === `#${id}` ? '#f8fafc' : '';
      });
    }
  });
}, { threshold: 0.4 });

sections.forEach(sec => sectionObserver.observe(sec));
