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
});
