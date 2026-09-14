document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  navToggle?.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  const dots = document.querySelectorAll('.carousel-dots .dot');
  const prev = document.querySelector('.carousel-arrow[aria-label="Previous testimonial"]');
  const next = document.querySelector('.carousel-arrow[aria-label="Next testimonial"]');

  let active = 0;
  const setActive = (i) => {
    active = (i + dots.length) % dots.length;
    dots.forEach((d, idx) => d.classList.toggle('active', idx === active));
  };

  dots.forEach((dot, i) => dot.addEventListener('click', () => setActive(i)));
  prev?.addEventListener('click', () => setActive(active - 1));
  next?.addEventListener('click', () => setActive(active + 1));

  const baRoot = document.getElementById('before-after');
  if (baRoot) {
    const after = baRoot.querySelector('.ba-after');
    const line = baRoot.querySelector('.ba-line');
    const handle = baRoot.querySelector('.ba-handle');
    let dragging = false;

    const setPos = (percent) => {
      percent = Math.min(100, Math.max(0, percent));
      after.style.clipPath = `inset(0 0 0 ${percent}%)`;
      line.style.left = percent + '%';
      handle.style.left = percent + '%';
      baRoot.setAttribute('aria-valuenow', String(Math.round(percent)));
    };

    const percentFromEvent = (e) => {
      const rect = baRoot.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return ((clientX - rect.left) / rect.width) * 100;
    };

    const onDown = (e) => {
      dragging = true;
      setPos(percentFromEvent(e));
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      setPos(percentFromEvent(e));
    };
    const onUp = () => { dragging = false; };

    baRoot.addEventListener('mousedown', onDown);
    baRoot.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);

    baRoot.addEventListener('keydown', (e) => {
      const current = parseFloat(baRoot.style.getPropertyValue('--ba-pos')) || parseFloat(handle.style.left) || 50;
      if (e.key === 'ArrowLeft') setPos(current - 5);
      if (e.key === 'ArrowRight') setPos(current + 5);
    });

    setPos(50);
  }

  const contactForm = document.getElementById('contact-form');
  contactForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      return;
    }
    contactForm.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
    contactForm.querySelector('.form-success').hidden = false;
  });
});
