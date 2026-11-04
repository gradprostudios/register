// Light / dark theme toggle, shared by the student portal and the admin portal.
// The <head> of each page already set data-theme before first paint; this wires the
// [data-theme-toggle] buttons. Same storage key as the main page ('gps-theme').
(function(){
  const KEY = 'gps-theme';
  const root = document.documentElement;
  const deviceDark = window.matchMedia('(prefers-color-scheme: dark)');
  const deviceTheme = () => (deviceDark.matches ? 'dark' : 'light');
  const getSaved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const save = (t) => { try { localStorage.setItem(KEY, t); } catch (e) {} };
  const clear = () => { try { localStorage.removeItem(KEY); } catch (e) {} };

  const SUN = '<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  const buttons = [...document.querySelectorAll('[data-theme-toggle]')];
  // Logos with a dark-mode version: <img src="GPS.png" data-dark-src="GPS-dark.png">.
  const logos = [...document.querySelectorAll('img[data-dark-src]')];
  logos.forEach(img => { img.dataset.lightSrc = img.getAttribute('src'); });
  buttons.forEach(b => { b.innerHTML = SUN + MOON; });

  function apply(theme){
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#050505' : '#ffffff');
    logos.forEach(img => {
      const src = theme === 'dark' ? img.dataset.darkSrc : img.dataset.lightSrc;
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    buttons.forEach(b => {
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      b.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  const saved = getSaved();
  apply(saved === 'light' || saved === 'dark' ? saved : deviceTheme());

  buttons.forEach(b => b.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    // Picking the device's own theme goes back to following the device.
    if (next === deviceTheme()) clear(); else save(next);
  }));
  // Follow the device live (e.g. a phone switching to dark at night) unless a theme was picked.
  deviceDark.addEventListener?.('change', () => { if (!getSaved()) apply(deviceTheme()); });
})();
