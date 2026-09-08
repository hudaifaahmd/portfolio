(function () {
  "use strict";

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------------- Theme toggle (single segmented control) ---------------- */
  var root = document.documentElement;
  var themeToggle = document.querySelector('.theme-toggle');
  var themeButtons = themeToggle ? Array.prototype.slice.call(themeToggle.querySelectorAll('.themebtn')) : [];

  function systemPrefersDark() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }
  // Updates only the toggle's visual state (which button looks pressed) —
  // does not touch data-theme or localStorage. Used to keep the toggle in
  // sync with the OS while no explicit choice has been saved.
  function updateToggleUI(effectiveMode) {
    if (themeToggle) themeToggle.setAttribute('data-mode', effectiveMode);
    themeButtons.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.set === effectiveMode ? 'true' : 'false'); });
  }
  // Explicit user choice — sets data-theme, persists it, and from then on
  // the site ignores the OS setting until the user clears storage.
  function applyTheme(mode) {
    root.setAttribute('data-theme', mode);
    updateToggleUI(mode);
    try { localStorage.setItem('theme', mode); } catch (e) {}
  }
  themeButtons.forEach(function (b) {
    b.addEventListener('click', function () { applyTheme(b.dataset.set); });
  });
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') {
      root.setAttribute('data-theme', saved);
      updateToggleUI(saved);
      return;
    }
    // No explicit choice yet — follow the OS. Leave data-theme unset so the
    // CSS prefers-color-scheme query drives the actual rendering, and just
    // keep the toggle's highlighted button matching the live OS setting.
    root.removeAttribute('data-theme');
    updateToggleUI(systemPrefersDark() ? 'dark' : 'light');
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystemChange = function (e) {
        var current = null;
        try { current = localStorage.getItem('theme'); } catch (err) {}
        if (current === 'light' || current === 'dark') return;
        updateToggleUI(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
      else if (mq.addListener) mq.addListener(onSystemChange);
    }
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
    // "Updated:" badge always reflects the visitor's current month/year —
    // computed from the browser clock on every load, never hand-edited.
    var panelUpdatedEl = document.getElementById('panelUpdatedText');
    if (panelUpdatedEl) {
      var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var now = new Date();
      panelUpdatedEl.textContent = MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();
    }

    var startDate = new Date(panel.dataset.startDate + 'T00:00:00');
    var scaleMax = parseFloat(panel.dataset.scaleMax || '10');
    var options = JSON.parse(panel.dataset.statusOptions || '[]');
    var statusIndex = parseInt(panel.dataset.statusIndex, 10) || 0;
    var originalStatusIndex = statusIndex;
    var statusNote = panel.dataset.statusNote || '';
    var originalStatusNote = statusNote;
    var statusNoteDetail = panel.dataset.statusNoteDetail || '';
    var originalStatusNoteDetail = statusNoteDetail;
    var mode = panel.dataset.mode || 'LEARNING';

    // The knob cycles through every stop, including Early Career — but
    // Early Career is a pass-through, not a resting state (see cycleKnob).
    var cycleStart = 0;
    var lastIndex = options.length - 1;

    var cx = 66, cy = 66, r = 50;
    var sweep = 280;
    var startAngle = -sweep / 2;
    var angles = options.map(function (_, i) {
      return options.length > 1 ? startAngle + i * (sweep / (options.length - 1)) : 0;
    });

    var CATEGORY_VAR = { blue: '--accent2', green: '--good', amber: '--warn' };
    // Category is by position, not by wording, so relabeling an option in the
    // JSON data never silently breaks the coloring: the last stop (the
    // destination link) is amber, the one before it is green, everything
    // earlier is blue.
    function categoryForIndex(i) {
      if (i === lastIndex) return 'amber';
      if (i === lastIndex - 1) return 'green';
      return 'blue';
    }
    function shortLines(label) {
      if (/experienced professional/i.test(label)) return ['Experienced'];
      if (/available immediately/i.test(label)) return ['Available'];
      if (label.length > 10 && label.indexOf(' ') !== -1) {
        var parts = label.split(' ');
        return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
      }
      return [label];
    }
    // The readout box gets its own label text, separate from the dial —
    // "Your Company" on the dial reads as "HIRE ME" in the readout.
    function readoutLabel(label) {
      if (/your company/i.test(label)) return 'Hire Me';
      return label;
    }

    var labelsGroup = panel.querySelector('.knob-labels');
    var ticksGroup = panel.querySelector('.knob-ticks');
    var knobPointer = document.getElementById('knobPointer');
    var labelEls = [], tickEls = [], catByIndex = [];
    if (labelsGroup) {
      options.forEach(function (label, i) {
        var deg = angles[i];
        var rad = deg * Math.PI / 180;
        var cat = categoryForIndex(i);
        catByIndex.push(cat);

        var tick = null;
        var tickRadius = 41;
        if (ticksGroup) {
          var tx = cx + tickRadius * Math.sin(rad), ty = cy - tickRadius * Math.cos(rad);
          tick = document.createElementNS(SVG_NS, 'circle');
          tick.setAttribute('cx', tx); tick.setAttribute('cy', ty);
          ticksGroup.appendChild(tick);
        }
        tickEls.push(tick);

        var lines = shortLines(label);
        // Labels need clearance from the tick dot (radius 41) or they visually
        // collide with it — two-line labels need extra room on top of that.
        var textRadius = lines.length > 1 ? r + 8 : r + 4;
        var x = cx + textRadius * Math.sin(rad);
        var y = cy - textRadius * Math.cos(rad);

        var textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('class', 'gauge-yourco cat-' + cat);
        labelEls.push(textEl);

        if (lines.length > 1) {
          textEl.setAttribute('y', y - 4);
          lines.forEach(function (word, wi) {
            var tspan = document.createElementNS(SVG_NS, 'tspan');
            tspan.setAttribute('x', x);
            tspan.setAttribute('dy', wi === 0 ? 0 : 10);
            tspan.textContent = word;
            textEl.appendChild(tspan);
          });
        } else {
          textEl.setAttribute('y', y + 3);
          textEl.textContent = lines[0];
        }

        // Every dial label is directly clickable — jumps the knob straight
        // to that position (no cycling, no navigation side-effects).
        var hit = document.createElementNS(SVG_NS, 'circle');
        hit.setAttribute('cx', x); hit.setAttribute('cy', y + 4);
        hit.setAttribute('r', 14); hit.setAttribute('fill', 'transparent');

        var shortcutG = document.createElementNS(SVG_NS, 'g');
        shortcutG.setAttribute('class', 'knob-shortcut');
        shortcutG.setAttribute('tabindex', '0');
        shortcutG.setAttribute('role', 'button');
        shortcutG.setAttribute('aria-label', 'Set career status to ' + label);
        shortcutG.dataset.index = i;
        shortcutG.appendChild(hit);
        shortcutG.appendChild(textEl);
        labelsGroup.appendChild(shortcutG);
      });
    }

    function scrollToContact() {
      var target = document.getElementById('contact');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function highlightStatus() {
      var cat = catByIndex[statusIndex] || 'blue';
      labelEls.forEach(function (el, i) { if (el) el.classList.toggle('active', i === statusIndex); });
      tickEls.forEach(function (el, i) {
        if (!el) return;
        var active = i === statusIndex;
        el.setAttribute('r', active ? '3.6' : '2.2');
        el.setAttribute('fill', active ? 'var(' + CATEGORY_VAR[cat] + ')' : 'var(--ink-faint)');
      });
      if (knobPointer) knobPointer.setAttribute('fill', 'var(' + CATEGORY_VAR[cat] + ')');
    }

    function renderKnob() {
      var el = document.getElementById('statusKnob');
      if (el) el.setAttribute('transform', 'rotate(' + angles[statusIndex] + ' 66 66)');
      var cat = catByIndex[statusIndex] || 'blue';
      var box = document.getElementById('statusReadoutBox');
      var main = document.getElementById('statusReadout');
      var sub = document.getElementById('statusReadoutSub');
      if (box) box.className = 'dial-readout cat-' + cat;
      if (main) main.textContent = (statusNote || readoutLabel(options[statusIndex]) || '').toUpperCase();
      if (sub) sub.textContent = statusNoteDetail || '';
      highlightStatus();
    }

    function setStatus(i, opts) {
      statusIndex = i;
      if (statusIndex === originalStatusIndex) {
        statusNote = originalStatusNote;
        statusNoteDetail = originalStatusNoteDetail;
      } else {
        statusNote = '';
        statusNoteDetail = '';
      }
      renderKnob();
      if (!(opts && opts.keepTimer) && knobContactTimer) { clearTimeout(knobContactTimer); knobContactTimer = null; }
      if (earlyCareerTimer) { clearTimeout(earlyCareerTimer); earlyCareerTimer = null; }
    }

    // Clicking the knob body steps through every stage in order, wrapping
    // around. Early Career is a pass-through stop, not a place to rest — see
    // the auto-advance below.
    var knobWrap = document.getElementById('knobWrap');
    var knobContactTimer = null;
    var earlyCareerTimer = null;
    // Early Career is a pass-through marker, not a place to rest — whether
    // you land on it by turning the knob or by clicking its label directly,
    // it briefly explains itself, then hops on to Experienced Professional.
    function armEarlyCareerAdvance() {
      var sub = document.getElementById('statusReadoutSub');
      if (sub) sub.textContent = 'Just a starting marker — moving on…';
      earlyCareerTimer = setTimeout(function () { earlyCareerTimer = null; setStatus(1); }, 450);
    }
    if (knobWrap && options.length > 1) {
      function cycleKnob() {
        var span = lastIndex - cycleStart + 1;
        var within = statusIndex >= cycleStart ? (statusIndex - cycleStart + 1) % span : 0;
        setStatus(cycleStart + within);
        if (statusIndex === lastIndex) {
          // Landed on "Your Company" by turning the knob — give it a couple
          // of seconds to register, then head to Contact.
          knobContactTimer = setTimeout(function () { knobContactTimer = null; scrollToContact(); }, 2000);
        } else if (statusIndex === 0) {
          armEarlyCareerAdvance();
        }
      }
      knobWrap.addEventListener('click', function (e) {
        var shortcut = e.target.closest && e.target.closest('.knob-shortcut');
        if (shortcut) {
          var idx = parseInt(shortcut.dataset.index, 10);
          setStatus(idx);
          if (idx === 0) armEarlyCareerAdvance();
          return;
        }
        cycleKnob();
      });
      knobWrap.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var shortcut = e.target.closest && e.target.closest('.knob-shortcut');
        if (shortcut) {
          e.preventDefault();
          var idx = parseInt(shortcut.dataset.index, 10);
          setStatus(idx);
          if (idx === 0) armEarlyCareerAdvance();
          return;
        }
        e.preventDefault(); cycleKnob();
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
        tick.setAttribute('stroke', 'var(--ink-muted)'); tick.setAttribute('stroke-opacity', '.65'); tick.setAttribute('stroke-width', '1.5');
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
      if (readout) readout.textContent = Math.floor(years) + '+ Years';
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

    var modeCaption = document.getElementById('modeCaption');
    var modeCaptionText = document.getElementById('modeCaptionText');
    function renderLever() {
      var handle = document.getElementById('leverHandle');
      if (handle) {
        handle.classList.toggle('top', mode === 'EMPLOYMENT');
        handle.setAttribute('aria-label', 'Current mode: ' + mode + '. Click or drag to change.');
      }
      panel.querySelectorAll('.lever-stop').forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
      });
      if (modeCaption) {
        modeCaption.dataset.mode = mode;
        if (modeCaptionText) {
          modeCaptionText.textContent = mode === 'EMPLOYMENT'
            ? (modeCaption.dataset.captionEmployment || '')
            : (modeCaption.dataset.captionLearning || '');
        }
      }
    }

    var modeContactTimer = null;
    function afterModeChange() {
      renderLever();
      if (modeContactTimer) { clearTimeout(modeContactTimer); modeContactTimer = null; }
      if (mode === 'EMPLOYMENT') {
        // Moved to Employment — give it a beat to register, then head to Contact.
        modeContactTimer = setTimeout(function () { modeContactTimer = null; scrollToContact(); }, 2000);
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

  /* ---------------- Nested experience-category accordion ---------------- */
  document.querySelectorAll('.exp-cat-toggle').forEach(function (btn) {
    var detail = btn.nextElementSibling;
    var chevron = btn.querySelector('.exp-cat-chevron');
    var parentDetail = btn.closest('.exp-detail');
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      detail.style.maxHeight = open ? '0px' : detail.scrollHeight + 'px';
      if (chevron) chevron.textContent = open ? '+' : '−';
      // A category expanding inside the outer job accordion can grow past
      // that accordion's own max-height (snapshotted when IT opened, before
      // any category was expanded). Give it generous headroom rather than
      // re-measuring mid-transition — an oversized max-height has no visual
      // effect on a panel that's already showing all of its real content.
      if (parentDetail && parentDetail.style.maxHeight && parentDetail.style.maxHeight !== '0px') {
        parentDetail.style.maxHeight = '3000px';
      }
    });
  });

  /* ---------------- Resume PDF embed fullscreen ---------------- */
  var resumeFullscreenBtn = document.getElementById('resumeFullscreen');
  var resumeFrame = document.getElementById('resumeCanvasWrap');
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

  // Formspree's notification email stamps "Submitted" in UTC, which reads as
  // the wrong time for visitors elsewhere. Record the actual local time (with
  // timezone) as an extra field so the email carries an accurate one too.
  var contactFormEl = document.querySelector('.contact-form');
  var localTimeInput = document.getElementById('contactLocalTime');
  if (contactFormEl && localTimeInput) {
    contactFormEl.addEventListener('submit', function () {
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        localTimeInput.value = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + tz + ')';
      } catch (e) {
        localTimeInput.value = new Date().toString();
      }
    });
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
