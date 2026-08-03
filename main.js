/* ============================================================
   THE NOVA SOCIAL CLUB — Main JavaScript
   ============================================================ */

(function () {
  'use strict';

  /* ── Nav: scroll state ──────────────────────────────────── */
  const nav = document.getElementById('nav');
  let lastScroll = 0;

  function updateNav() {
    const scrollY = window.scrollY;
    nav.classList.toggle('scrolled', scrollY > 60);
    lastScroll = scrollY;
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav(); // run once on load

  /* ── Nav: mobile hamburger ──────────────────────────────── */
  const hamburger = document.getElementById('hamburger');
  const navMenu   = document.getElementById('nav-menu');

  hamburger.addEventListener('click', function () {
    const isOpen = navMenu.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    hamburger.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  // Close mobile menu when a link is clicked
  navMenu.querySelectorAll('.nav__link').forEach(function (link) {
    link.addEventListener('click', function () {
      navMenu.classList.remove('open');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });

  // Close mobile menu on resize to desktop
  window.addEventListener('resize', function () {
    if (window.innerWidth > 768) {
      navMenu.classList.remove('open');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  });

  /* ── Scroll reveal (Intersection Observer) ──────────────── */
  const revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    // Fallback: show all immediately
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ── Active nav link on scroll ──────────────────────────── */
  const sections   = document.querySelectorAll('section[id]');
  const navLinks   = document.querySelectorAll('.nav__link');

  function setActiveLink() {
    const scrollMid = window.scrollY + window.innerHeight / 2;
    let current = '';

    sections.forEach(function (section) {
      if (section.offsetTop <= scrollMid) {
        current = section.id;
      }
    });

    navLinks.forEach(function (link) {
      link.classList.toggle(
        'active',
        link.getAttribute('href') === '#' + current
      );
    });
  }

  window.addEventListener('scroll', setActiveLink, { passive: true });

  /* ── Form submission handler (shared) ───────────────────── */
  function wireForm(formId, successId) {
    const form = document.getElementById(formId);
    const success = document.getElementById(successId);
    if (!form || !success) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      const required = form.querySelectorAll('[required]');
      let valid = true;

      required.forEach(function (field) {
        if (!field.value.trim()) {
          valid = false;
          field.style.borderColor = '#e05252';
          field.addEventListener('input', function () {
            field.style.borderColor = '';
          }, { once: true });
        }
      });

      if (!valid) return;

      // Submit to the backend
      const endpoint = form.getAttribute('data-endpoint');
      const payload = {};
      new FormData(form).forEach(function (value, key) { payload[key] = value; });

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) { return r.text().then(function (t) { throw new Error(t || 'Submission failed. Please try again.'); }); }
        return r.json();
      }).then(function (res) {
        if (!res.ok) { throw new Error((res.errors && res.errors[0]) || 'Submission failed'); }

        // Animate form out, show success
        form.style.transition = 'opacity 0.4s, transform 0.4s';
        form.style.opacity    = '0';
        form.style.transform  = 'translateY(-10px)';

        setTimeout(function () {
          form.hidden = true;
          success.hidden = false;
          success.style.opacity   = '0';
          success.style.transform = 'translateY(10px)';
          success.style.transition = 'opacity 0.4s, transform 0.4s';

          requestAnimationFrame(function () {
            success.style.opacity   = '1';
            success.style.transform = 'translateY(0)';
          });
        }, 400);
      }).catch(function (err) {
        alert(err.message); // keep the form visible so the user can retry
      });
    });
  }

  wireForm('apply-form',   'form-success');
  wireForm('partner-form', 'partner-success');

  /* ── Newsletter signup ──────────────────────────────────── */
  const nlForm = document.getElementById('newsletter-form');
  if (nlForm) {
    nlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const msg = document.getElementById('newsletter-msg');
      const payload = {};
      new FormData(nlForm).forEach(function (v, k) { payload[k] = v; });
      fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (res) {
        msg.hidden = false;
        msg.textContent = res.ok
          ? "You're subscribed — check your inbox."
          : ((res.errors && res.errors[0]) || 'Please try again.');
        if (res.ok) nlForm.reset();
      }).catch(function () {
        msg.hidden = false;
        msg.textContent = 'Please try again.';
      });
    });
  }

  /* ── Smooth anchor scroll (polyfill for older browsers) ─── */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;

      e.preventDefault();
      const navHeight = nav ? nav.offsetHeight : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight;

      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });

  /* ── Hero scroll cue: hide after scrolling past hero ───── */
  const scrollCue = document.querySelector('.hero__scroll-cue');
  const hero      = document.getElementById('hero');

  if (scrollCue && hero) {
    function toggleScrollCue() {
      const heroBottom = hero.offsetTop + hero.offsetHeight;
      scrollCue.style.opacity = window.scrollY > heroBottom * 0.4 ? '0' : '';
    }
    window.addEventListener('scroll', toggleScrollCue, { passive: true });
  }

})();
