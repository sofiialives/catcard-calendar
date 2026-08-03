(function () {
  'use strict';
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 1. Ambient particles in the hero ---- */
  function initParticles() {
    var container = document.getElementById('particles');
    if (!container || prefersReducedMotion) return;
    var BLUE = '#504CFF';
    var PURPLE = '#854CFF';
    var particles = [
      { l: '6%', dur: 18, del: 0, c: BLUE }, { l: '13%', dur: 24, del: 3.5, c: PURPLE },
      { l: '21%', dur: 20, del: 6, c: BLUE }, { l: '29%', dur: 22, del: 1.5, c: PURPLE },
      { l: '38%', dur: 17, del: 8, c: BLUE }, { l: '46%', dur: 25, del: 4, c: PURPLE },
      { l: '54%', dur: 19, del: 9.5, c: BLUE }, { l: '63%', dur: 23, del: 2.5, c: PURPLE },
      { l: '71%', dur: 21, del: 7, c: BLUE }, { l: '79%', dur: 18, del: 5.5, c: PURPLE },
      { l: '87%', dur: 26, del: 11, c: BLUE }, { l: '94%', dur: 16, del: 13, c: PURPLE },
      { l: '33%', dur: 22, del: 15, c: BLUE }, { l: '57%', dur: 19, del: 10.5, c: PURPLE }
    ];
    var fragment = document.createDocumentFragment();
    particles.forEach(function (p, i) {
      var el = document.createElement('div');
      el.className = 'particle';
      var size = i % 3 === 0 ? 2.5 : 1.5;
      el.style.left = p.l;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.background = p.c;
      el.style.animation = 'particleRise ' + p.dur + 's ' + p.del + 's linear infinite';
      fragment.appendChild(el);
    });
    container.appendChild(fragment);
  }

  /* ---- 2. Scroll-triggered reveal (fadeUp) ---- */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (prefersReducedMotion) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var el = entry.target;
            var delay = parseInt(el.getAttribute('data-delay') || '0', 10);
            setTimeout(function () {
              el.classList.add('is-visible');
            }, delay);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---- 3. Progress rail (optional visual: fills as user scrolls the roadmap) ---- */
  function initRoadmapProgress() {
    var line = document.querySelector('.roadmap__line');
    var fill = document.querySelector('.roadmap__line-fill');
    if (!line || !fill || prefersReducedMotion) return;
    function update() {
      var rect = line.getBoundingClientRect();
      var vh = window.innerHeight;
      var total = rect.height;
      var visible = Math.min(Math.max(vh * 0.7 - rect.top, 0), total);
      fill.style.height = (total ? (visible / total) * 100 : 0) + '%';
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initParticles();
    initReveal();
    initRoadmapProgress();
  });
})();