/**
 * suppress-csp-warning.js — loaded via <script src> (not inline) so it
 * passes CSP script-src 'self' in production builds.
 *
 * Filters known-noise console messages that we cannot fix without
 * breaking Electron 33 WebGL (MapLibre 5.7.3 tile-picking / style-spec).
 *
 * IMPORTANT: Do NOT monkey-patch window.Blob. MapLibre creates its worker
 * with `new Blob([workerBundleString], { type: 'text/javascript' })`.
 * Prepending code into that Blob (or breaking instanceof Blob) causes
 * workers to fail silently — tiles still request, but only the style
 * background color paints (灰白 / #f8f4f0).
 */
(function () {
  if (window.__cspWarnSuppressed) return;
  window.__cspWarnSuppressed = true;

  function shouldDrop(arg) {
    if (arg == null) return false;
    var s = typeof arg === 'string' ? arg : (arg && arg.message ? String(arg.message) : String(arg));
    if (s.indexOf('Insecure Content-Security-Policy') >= 0) return true;
    // MapLibre 5.7.3 known bug (fixed upstream in 5.8+, but 5.8 vendor
    // breaks WebGL on Electron 33). Harmless at runtime — suppress noise.
    if (s.indexOf('Expected value to be of type number, but found null') >= 0) return true;
    // Harmless: setStyle while previous style still loading → full rebuild.
    if (s.indexOf('Unable to perform style diff') >= 0) return true;
    return false;
  }

  function wrap(fn) {
    return function () {
      for (var i = 0; i < arguments.length; i++) {
        if (shouldDrop(arguments[i])) return;
      }
      return fn.apply(console, arguments);
    };
  }

  console.warn = wrap(console.warn.bind(console));
  console.log = wrap(console.log.bind(console));
  console.error = wrap(console.error.bind(console));
})();
