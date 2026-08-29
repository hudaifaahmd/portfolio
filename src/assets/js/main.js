(function () {
  "use strict";

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  /* ---------------- Theme toggle (single segmented control) ---------------- */
  var root = document.documentElement;
  var themeToggle = document.querySelector('.theme-toggle');
  var themeButtons = themeToggle ? Array.prototype.slice.call(themeToggle.querySelectorAll('.themebtn')) : [];

  function setTheme(mode) {
    if (mode === 'light') root.setAttribute('data-theme', 'light');
    else if (mode === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    if (themeToggle) themeToggle.setAttribute('data-mode', mode);
    themeButtons.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.set === mode ? 'true' : 'false'); });
    try { localStorage.setItem('theme', mode); } catch (e) {}
  }
  themeButtons.forEach(function (b) {
    b.addEventListener('click', function () { setTheme(b.dataset.set); });
  });
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    setTheme(saved === 'light' || saved === 'dark' ? saved : 'system');
  })();

  /* ---------------- Mobile nav (auto-closes on outside tap) ---------------- */
  var navToggle = document.getElementById('navToggle');
  var siteNav = document.getElementById('siteNav');

  function closeNav() {
    if (!siteNav) return;
    siteNav.classList.remove('open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }
  function openNav() {
    if (!siteNav) return;
    siteNav.classList.add('open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'true');
  }
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (siteNav.classList.contains('open')) closeNav(); else openNav();
    });
    siteNav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeNav);
    });
    document.addEventListener('click', function (e) {
      if (!siteNav.classList.contains('open')) return;
      if (navToggle.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.theme-toggle')) return;
      // Any tap that isn't on a link and isn't the toggle itself closes the menu —
      // this covers both taps on the page behind it and taps on the menu's own backdrop.
      if (!e.target.closest || !e.target.closest('a')) { closeNav(); return; }
      closeNav();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
  }

  /* ---------------- Back to top ---------------- */
  var toTop = document.getElementById('toTop');
  if (toTop) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 480) toTop.classList.add('visible');
      else toTop.classList.remove('visible');
    }, { passive: true });
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------------- Career Control Panel ---------------- */
  var panel = document.getElementById('careerPanel');
  if (panel) {
    var startDate = new Date(panel.dataset.startDate + 'T00:00:00');
    var scaleMax = parseFloat(panel.dataset.scaleMax || '10');
    var options = JSON.parse(panel.dataset.statusOptions || '[]');
    var statusIndex = parseInt(panel.dataset.statusIndex, 10) || 0;
    var originalStatusIndex = statusIndex;
    var statusNote = panel.dataset.statusNote || '';
    var originalStatusNote = statusNote;
    var mode = panel.dataset.mode || 'LEARNING';

    var cx = 66, cy = 66, r = 50;
    var sweep = 280;
    var startAngle = -sweep / 2;
    var angles = options.map(function (_, i) {
      return options.length > 1 ? startAngle + i * (sweep / (options.length - 1)) : 0;
    });

    var labelsGroup = panel.querySelector('.knob-labels');
    var ticksGroup = panel.querySelector('.knob-ticks');
    var labelEls = [], tickEls = [];
    if (labelsGroup) {
      options.forEach(function (label, i) {
        var deg = angles[i];
        var rad = deg * Math.PI / 180;

        var tick = null;
        if (ticksGroup) {
          var tx1 = cx + 41 * Math.sin(rad), ty1 = cy - 41 * Math.cos(rad);
          var tx2 = cx + 46 * Math.sin(rad), ty2 = cy - 46 * Math.cos(rad);
          tick = document.createElementNS(SVG_NS, 'line');
          tick.setAttribute('x1', tx1); tick.setAttribute('y1', ty1);
          tick.setAttribute('x2', tx2); tick.setAttribute('y2', ty2);
          tick.setAttribute('stroke-linecap', 'round');
          ticksGroup.appendChild(tick);
        }
        tickEls.push(tick);

        var x = cx + r * Math.sin(rad);
        var y = cy - r * Math.cos(rad);
        var isDestination = /your company/i.test(label);

        var textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('class', 'gauge-yourco');
        labelEls.push(textEl);

        if (isDestination) {
          // Two short lines ("Your" / "Company") so the CTA stays readable
          // without needing the plate to be any wider.
          textEl.setAttribute('y', y - 1);
          ['Your', 'Company'].forEach(function (word, wi) {
            var tspan = document.createElementNS(SVG_NS, 'tspan');
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', wi === 0 ? 0 : 10);
            tspan.textContent = word;
            textEl.appendChild(tspan);
          });
        } else {
          textEl.setAttribute('y', y + 3);
          textEl.textContent = label.length > 11 ? label.split(' ')[0] : label;
        }

        if (isDestination) {
          // Larger invisible hit-target so the link is easy to tap, drawn on top of everything else.
          var hit = document.createElementNS(SVG_NS, 'circle');
          hit.setAttribute('cx', x); hit.setAttribute('cy', y + 4);
          hit.setAttribute('r', 14); hit.setAttribute('fill', 'transparent');

          var link = document.createElementNS(SVG_NS, 'a');
          link.setAttributeNS(XLINK_NS, 'href', '#contact');
          link.setAttribute('href', '#contact');
          link.setAttribute('class', 'gauge-link');
          link.setAttribute('aria-label', label + ' — go to contact section');
          link.appendChild(hit);
          link.appendChild(textEl);
          labelsGroup.appendChild(link);
        } else {
          labelsGroup.appendChild(textEl);
        }
      });
    }

    function scrollToContact() {
      var target = document.getElementById('contact');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function highlightStatus() {
      labelEls.forEach(function (el, i) { if (el) el.classList.toggle('active', i === statusIndex); });
      tickEls.forEach(function (el, i) {
        if (!el) return;
        el.setAttribute('stroke', i === statusIndex ? 'var(--accent)' : 'var(--line)');
        el.setAttribute('stroke-width', i === statusIndex ? '2.5' : '1.5');
      });
    }

    function renderKnob() {
      var el = document.getElementById('statusKnob');
      if (el) el.setAttribute('transform', 'rotate(' + angles[statusIndex] + ' 66 66)');
      var readout = document.getElementById('statusReadout');
      if (readout) readout.textContent = statusNote || (options[statusIndex] || '').toUpperCase();
      highlightStatus();
    }

    // The knob is a click-through toy, like the mode lever — clicking it steps
    // through the stages so it feels responsive, even though the "real" value
    // (and the note shown for it) only makes full sense at its data-set index.
    var knobWrap = document.getElementById('knobWrap');
    var knobContactTimer = null;
    if (knobWrap && options.length > 1) {
      function cycleKnob() {
        statusIndex = (statusIndex + 1) % options.length;
        statusNote = statusIndex === originalStatusIndex ? originalStatusNote : '';
        renderKnob();
        if (knobContactTimer) { clearTimeout(knobContactTimer); knobContactTimer = null; }
        if (statusIndex === options.length - 1) {
          // Landed on "Working at Your Company" by turning the knob — give it
          // a couple of seconds to register, then head to Contact.
          knobContactTimer = setTimeout(function () { knobContactTimer = null; scrollToContact(); }, 2000);
        }
      }
      knobWrap.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.gauge-link')) {
          // Clicking the "Your Company" text/link itself is a direct shortcut —
          // it navigates immediately via its own href, so no cycling and no
          // separate delayed auto-scroll (and cancel one if it was mid-countdown).
          if (knobContactTimer) { clearTimeout(knobContactTimer); knobContactTimer = null; }
          return;
        }
        cycleKnob();
      });
      knobWrap.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleKnob(); }
      });
    }

    function computeYears() { return (Date.now() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000); }

    function renderGaugeTicks() {
      var ticks = panel.querySelector('.gauge-ticks');
      var labels = panel.querySelector('.gauge-ticklabels');
      if (!ticks) return;
      var steps = 5;
      for (var i = 0; i <= steps; i++) {
        var val = (scaleMax / steps) * i;
        var deg = -135 + (val / scaleMax) * 270;
        var rad = deg * Math.PI / 180;
        var x1 = 66 + 44 * Math.sin(rad), y1 = 66 - 44 * Math.cos(rad);
        var x2 = 66 + 52 * Math.sin(rad), y2 = 66 - 52 * Math.cos(rad);
        var tick = document.createElementNS(SVG_NS, 'line');
        tick.setAttribute('x1', x1); tick.setAttribute('y1', y1);
        tick.setAttribute('x2', x2); tick.setAttribute('y2', y2);
        tick.setAttribute('stroke', 'var(--ink)'); tick.setAttribute('stroke-width', '2');
        tick.setAttribute('stroke-linecap', 'round');
        ticks.appendChild(tick);
        if (labels) {
          var lx = 66 + 34 * Math.sin(rad), ly = 66 - 34 * Math.cos(rad);
          var t = document.createElementNS(SVG_NS, 'text');
          t.setAttribute('x', lx); t.setAttribute('y', ly + 3);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('class', 'gauge-ticklabel');
          t.textContent = (i === steps ? Math.round(val) + '+' : Math.round(val));
          labels.appendChild(t);
        }
      }
    }

    var needleBaseAngle = 0;
    function renderMeter() {
      var years = computeYears();
      var clamped = Math.min(Math.max(years, 0), scaleMax);
      needleBaseAngle = -135 + (clamped / scaleMax) * 270;
      var needle = document.getElementById('expNeedle');
      if (needle && !needleWiggleActive) needle.setAttribute('transform', 'rotate(' + needleBaseAngle.toFixed(1) + ' 66 66)');
      var readout = document.getElementById('expReadout');
      if (readout) readout.textContent = Math.floor(years) + '+ yrs';
    }

    // Touch/hover the gauge and the needle gives a little to-and-fro tremble
    // around its real reading, then settles back — a bit of tactile life
    // without ever showing a fake number.
    var needleWiggleActive = false;
    var needleWiggleRAF = null;
    function stopNeedleWiggle() {
      needleWiggleActive = false;
      if (needleWiggleRAF) { cancelAnimationFrame(needleWiggleRAF); needleWiggleRAF = null; }
      var needle = document.getElementById('expNeedle');
      if (needle) needle.setAttribute('transform', 'rotate(' + needleBaseAngle.toFixed(1) + ' 66 66)');
    }
    function startNeedleWiggle() {
      var needle = document.getElementById('expNeedle');
      if (!needle || needleWiggleActive) return;
      needleWiggleActive = true;
      var start = performance.now();
      var duration = 750;
      function frame(now) {
        var t = now - start;
        if (t > duration) { stopNeedleWiggle(); return; }
        var decay = 1 - t / duration;
        var offset = Math.sin(t / 55) * 7 * decay;
        needle.setAttribute('transform', 'rotate(' + (needleBaseAngle + offset).toFixed(1) + ' 66 66)');
        needleWiggleRAF = requestAnimationFrame(frame);
      }
      needleWiggleRAF = requestAnimationFrame(frame);
    }
    var gaugeWrap = panel.querySelector('.gauge-wrap2');
    if (gaugeWrap) {
      gaugeWrap.addEventListener('mouseenter', startNeedleWiggle);
      gaugeWrap.addEventListener('touchstart', startNeedleWiggle, { passive: true });
    }

    function renderLever() {
      var handle = document.getElementById('leverHandle');
      if (handle) {
        handle.classList.toggle('top', mode === 'EMPLOYMENT');
        handle.setAttribute('aria-label', 'Current mode: ' + mode + '. Click or drag to change.');
      }
      panel.querySelectorAll('.lever-stop').forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
      });
    }

    var modeContactTimer = null;
    function afterModeChange() {
      renderLever();
      if (modeContactTimer) { clearTimeout(modeContactTimer); modeContactTimer = null; }
      if (mode === 'EMPLOYMENT') {
        // Moved to Employment — give it a beat to register, then head to Contact.
        modeContactTimer = setTimeout(function () { modeContactTimer = null; scrollToContact(); }, 1000);
      }
    }

    panel.querySelectorAll('.lever-stop').forEach(function (btn) {
      btn.addEventListener('click', function () { mode = btn.dataset.mode; afterModeChange(); });
    });

    var leverHandle = document.getElementById('leverHandle');
    var leverTrack = panel.querySelector('.lever-track-v');
    if (leverHandle && leverTrack) {
      function toggleMode() { mode = mode === 'EMPLOYMENT' ? 'LEARNING' : 'EMPLOYMENT'; afterModeChange(); }
      leverHandle.addEventListener('click', function (e) { e.stopPropagation(); toggleMode(); });
      leverHandle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMode(); }
      });

      var dragging = false;
      function modeFromY(clientY) {
        var rect = leverTrack.getBoundingClientRect();
        var rel = clientY - rect.top;
        return rel < rect.height / 2 ? 'EMPLOYMENT' : 'LEARNING';
      }
      leverHandle.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { leverHandle.setPointerCapture(e.pointerId); } catch (err) {}
      });
      leverHandle.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var next = modeFromY(e.clientY);
        if (next !== mode) { mode = next; afterModeChange(); }
      });
      ['pointerup', 'pointercancel'].forEach(function (evt) {
        leverHandle.addEventListener(evt, function () { dragging = false; });
      });
      leverTrack.addEventListener('click', function (e) {
        if (e.target === leverHandle) return;
        mode = modeFromY(e.clientY);
        afterModeChange();
      });
    }

    renderKnob(); renderGaugeTicks(); renderMeter(); renderLever();
  }

  /* ---------------- Experience accordion (+ / − text swap) ---------------- */
  document.querySelectorAll('.exp-toggle').forEach(function (btn) {
    var detail = btn.nextElementSibling;
    var chevron = btn.querySelector('.exp-chevron');
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.style.maxHeight = open ? '0px' : detail.scrollHeight + 'px';
      if (chevron) chevron.textContent = open ? '+' : '−';
    });
  });

  /* ---------------- Resume PDF embed fullscreen ---------------- */
  var resumeFullscreenBtn = document.getElementById('resumeFullscreen');
  var resumeFrame = document.getElementById('resumeFrame');
  if (resumeFullscreenBtn && resumeFrame) {
    resumeFullscreenBtn.addEventListener('click', function () {
      try {
        if (resumeFrame.requestFullscreen) resumeFrame.requestFullscreen();
        else if (resumeFrame.webkitRequestFullscreen) resumeFrame.webkitRequestFullscreen();
      } catch (e) {}
    });
  }

  /* ---------------- Contact form: purpose -> email subject ---------------- */
  var purposeSelect = document.getElementById('contactPurpose');
  var subjectInput = document.getElementById('contactSubjectHidden');
  if (purposeSelect && subjectInput) {
    function syncSubject() {
      var label = purposeSelect.options[purposeSelect.selectedIndex]
        ? purposeSelect.options[purposeSelect.selectedIndex].text
        : purposeSelect.value;
      subjectInput.value = 'Portfolio contact — ' + label;
    }
    purposeSelect.addEventListener('change', syncSubject);
  }

  /* ---------------- Certificate carousel ---------------- */
  var carouselEl = document.getElementById('certCarousel');
  if (carouselEl) {
    var stage = document.getElementById('certStage');
    var slides = Array.prototype.slice.call(stage.querySelectorAll('.cert-slide'));
    var dotsWrap = document.getElementById('certDots');
    var dots = Array.prototype.slice.call(dotsWrap.querySelectorAll('.cert-dot'));
    var stateEl = document.getElementById('certState');
    var idx = 0, timer = null, manuallyStopped = false;
    var intervalMs = parseInt(carouselEl.dataset.interval, 10) || 6000;

    function render() {
      slides.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
      dots.forEach(function (d, i) { d.setAttribute('aria-current', i === idx ? 'true' : 'false'); });
      requestAnimationFrame(function () {
        var active = slides[idx];
        if (active) stage.style.height = active.offsetHeight + 'px';
      });
    }
    window.addEventListener('resize', function () {
      var active = slides[idx];
      if (active) stage.style.height = active.offsetHeight + 'px';
    });
    function goTo(i, manual) {
      idx = (i + slides.length) % slides.length; render();
      if (manual) { manuallyStopped = true; stop(); if (stateEl) stateEl.textContent = 'auto-rotation paused (you navigated manually)'; }
    }
    function next() { goTo(idx + 1); }
    function start() { if (manuallyStopped || slides.length < 2) return; stop(); timer = setInterval(next, intervalMs); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    dots.forEach(function (d, i) { d.addEventListener('click', function () { goTo(i, true); }); });
    var prevBtn = document.getElementById('certPrev'), nextBtn = document.getElementById('certNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(idx - 1, true); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(idx + 1, true); });

    carouselEl.addEventListener('mouseenter', stop);
    carouselEl.addEventListener('mouseleave', function () { if (!manuallyStopped) start(); });
    carouselEl.addEventListener('focusin', stop);
    carouselEl.addEventListener('focusout', function () { if (!manuallyStopped) start(); });

    var touchX = null;
    carouselEl.addEventListener('touchstart', function (e) { touchX = e.changedTouches[0].clientX; }, { passive: true });
    carouselEl.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) goTo(dx < 0 ? idx + 1 : idx - 1, true);
      touchX = null;
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (!manuallyStopped) start();
    });

    var lightbox = document.getElementById('certLightbox');
    if (lightbox) {
      stage.addEventListener('click', function (e) {
        if (e.target.classList.contains('cert-view')) {
          var slide = slides[+e.target.dataset.i];
          var img = slide.querySelector('img');
          document.getElementById('lbImage').src = img.src;
          document.getElementById('lbImage').alt = img.alt;
          document.getElementById('lbTitle').textContent = slide.querySelector('.cert-title').textContent;
          document.getElementById('lbMeta').textContent = slide.querySelector('.cert-meta').textContent;
          lightbox.classList.add('open');
        }
      });
      function closeLightbox() { lightbox.classList.remove('open'); }
      var closeBtn = document.getElementById('certLightboxClose');
      if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
      lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
    }

    render();
    start();
  }
})();
