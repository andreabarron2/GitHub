(function(){
  try{
    const url = new URL(window.location.href);
    const apiFromQuery = url.searchParams.get('api');
    if (apiFromQuery) {
      localStorage.setItem('API_BASE', apiFromQuery);
    }
    const stored = localStorage.getItem('API_BASE');
    if (stored) {
      window.API_BASE = stored;
      return;
    }
    // Default: local dev
    if (location.hostname === 'localhost') {
      window.API_BASE = 'http://localhost:3000';
    } else {
      // Fallback to same-origin (solo funcionaría si hay reverse proxy)
      window.API_BASE = location.origin;
    }
  }catch(e){
    window.API_BASE = 'http://localhost:3000';
  }
})();
