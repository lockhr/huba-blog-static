/* Runs before first paint; Vue reuses this exact gate after navigation.
   No viewport-height or CSS orientation queries: keyboards can change both. */
;(function () {
  var root = document.documentElement
  var query = new URLSearchParams(location.search)
  var ua = navigator.userAgent
  var standalone = window.matchMedia('(display-mode: standalone)')
  var eligible = /iPhone/.test(ua) && /Version\/[\d.]+.*Mobile\/.*Safari\//.test(ua)
    && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    && !/iPad|CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Ddg\/|GSA\/|YaBrowser|YxiOS|MicroMessenger|FBAN|FBAV|Instagram|Line\/|Brave/i.test(ua)
    && (!query.has('safariEdge') || query.get('safariEdge') === 'native')
    && query.get('mobileCover') !== '1' && !query.has('wallpaperPreview')
    && query.get('iphonePortrait') !== 'off'
  var base = new URL('.', document.currentScript.src).pathname
  var path = location.hash.startsWith('#/') ? location.hash.slice(1)
    : '/' + (location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname.slice(1))

  function portrait() {
    var orientation = window.screen && window.screen.orientation
    if (orientation && orientation.type) return orientation.type.startsWith('portrait')
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) !== 90
    // Physical screen dimensions are independent of the software keyboard.
    return !!window.screen && window.screen.height > window.screen.width
  }
  function sync() {
    var active = eligible && !navigator.standalone && !standalone.matches
      && path.split(/[?#]/)[0] === '/' && portrait()
    if (active) root.dataset.iphonePortrait = 'active'
    else delete root.dataset.iphonePortrait
  }
  sync()

  window.__iphonePortrait = {
    start: function (router) {
      if (!eligible) return function () {}
      path = router.currentRoute.value.path
      sync()
      var stopRoute = router.afterEach(function (to, from, failure) {
        if (failure) return
        path = to.path
        sync()
      })
      var orientation = window.screen && window.screen.orientation
      window.addEventListener('orientationchange', sync, { passive: true })
      window.addEventListener('resize', sync, { passive: true })
      window.addEventListener('pageshow', sync)
      orientation?.addEventListener('change', sync)
      standalone.addEventListener('change', sync)
      return function () {
        stopRoute()
        window.removeEventListener('orientationchange', sync)
        window.removeEventListener('resize', sync)
        window.removeEventListener('pageshow', sync)
        orientation?.removeEventListener('change', sync)
        standalone.removeEventListener('change', sync)
        delete root.dataset.iphonePortrait
      }
    },
  }
})()
