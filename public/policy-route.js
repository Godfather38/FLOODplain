// Classic, dependency-free: the submitted hash URL works even if maps, app modules or feeds fail.
(() => {
  function policyRoute() {
    const active = /^#\/(privacy|terms)\/?$/.test(location.hash);
    document.body.classList.toggle('policy-open', active);
    document.getElementById('legacy-policy').hidden = !active;
  }
  addEventListener('hashchange', policyRoute);
  policyRoute();
})();
