/* Stringer Repairs — the "Real Results" photo strip.
   The strip is a native scroll-snap row, so touch and trackpad scrolling work
   without this file; these buttons only step it one photo at a time and
   disable themselves at either end. */
(function(){
  const track = document.getElementById('sr-track');
  if (!track) return;
  const prev = document.querySelector('.sr-gallery-prev');
  const next = document.querySelector('.sr-gallery-next');

  const step = () => {
    const first = track.firstElementChild;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return first ? first.getBoundingClientRect().width + gap : track.clientWidth;
  };
  const update = () => {
    const max = track.scrollWidth - track.clientWidth - 1;
    prev.disabled = track.scrollLeft <= 0;
    next.disabled = track.scrollLeft >= max;
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const go = (dir) => track.scrollBy({left: dir * step(), behavior: reduce.matches ? 'auto' : 'smooth'});
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  track.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', update);
  update();
})();
