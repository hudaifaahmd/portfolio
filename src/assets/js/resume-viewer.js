// Renders the resume PDF as a stack of canvases using PDF.js, instead of a
// native <iframe src="*.pdf">. Most mobile browsers (Chrome for Android
// included) don't have a built-in inline PDF renderer the way desktop
// Chrome does — an iframe embed on those just shows a bare "Open" prompt.
// PDF.js sidesteps that entirely: it parses and paints the PDF itself via
// canvas, so the result looks identical on desktop and mobile alike.
//
// The PDF.js module is loaded with a dynamic import() (not a static one) so
// that if it can't be fetched for some reason, the failure is a normal
// rejected promise we can catch below and fall back gracefully, rather than
// the whole script failing to evaluate.
(function () {
  "use strict";
  var container = document.getElementById('resumeCanvasWrap');
  if (!container) return;
  var url = container.getAttribute('data-pdf-url');
  if (!url) return;

  async function run() {
    var pdfjsLib = await import('/assets/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.mjs';

    var pdf = await pdfjsLib.getDocument({ url: url }).promise;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    for (var pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      var page = await pdf.getPage(pageNum);
      var containerWidth = container.clientWidth || 640;
      var baseViewport = page.getViewport({ scale: 1 });
      var scale = containerWidth / baseViewport.width;
      var viewport = page.getViewport({ scale: scale * dpr });

      var canvas = document.createElement('canvas');
      canvas.className = 'resume-page';
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = Math.ceil(viewport.width / dpr) + 'px';
      canvas.style.height = Math.ceil(viewport.height / dpr) + 'px';
      container.appendChild(canvas);

      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }

    container.classList.add('loaded');
  }

  run().catch(function () {
    // The "open the PDF directly" link rendered inside this container still
    // works even when the inline preview itself can't load.
    container.classList.add('load-failed');
  });
})();
