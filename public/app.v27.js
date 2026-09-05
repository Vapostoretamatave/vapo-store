(function () {
  'use strict';

  var state = {
    settings: null,
    categories: [],
    products: [],
    banners: [],
    category: 'all',
    subcategory: '',
    facet: 'sub',
    search: '',
    promoOnly: false,
    sort: 'pertinence'
  };

  function readHash() {
    var h = location.hash.replace(/^#\/?/, '');
    state.promoOnly = false;
    if (!h || h === 'products') { goHome(); return; }
    var parts = h.split('/');
    if (parts[0] === 'cat' && parts[1]) {
      state.category = parts[1];
      state.facet = 'sub';
      state.subcategory = (parts[2] === 'sub' && parts[3]) ? parts[3] : '';
      state.search = '';
      $('searchInput').value = '';
      renderProducts();
      document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    } else if (parts[0] === 'marque' && parts[1]) {
      state.category = 'all';
      state.facet = 'marque';
      state.subcategory = decodeURIComponent(parts[1]);
      state.search = '';
      $('searchInput').value = '';
      renderProducts();
      document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    } else if (parts[0] === 'saveur' && parts[1]) {
      state.category = 'all';
      state.facet = 'saveur';
      state.subcategory = decodeURIComponent(parts[1]);
      state.search = '';
      $('searchInput').value = '';
      renderProducts();
      document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    } else if (parts[0] === 'search' && parts[1]) {
      state.category = 'all';
      state.facet = 'sub';
      state.subcategory = '';
      state.search = decodeURIComponent(parts[1]);
      $('searchInput').value = state.search;
      renderProducts();
      document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    } else if (parts[0] === 'promo') {
      state.promoOnly = true;
      state.category = 'all';
      state.facet = 'sub';
      state.subcategory = '';
      state.search = '';
      $('searchInput').value = '';
      renderProducts();
      document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
    } else {
      goHome();
    }
  }

  function writeHash() {
    var h = '';
    if (state.promoOnly) {
      h = 'promo';
    } else if (state.category !== 'all') {
      h = 'cat/' + state.category;
      if (state.subcategory) h += '/sub/' + state.subcategory;
    } else if (state.facet && state.facet !== 'sub' && state.subcategory) {
      h = state.facet + '/' + state.subcategory;
    } else if (state.search) {
      h = 'search/' + state.search;
    }
    history.replaceState(null, '', h ? '#' + h : '#products');
  }

  var cart = loadCart();
  var optionCache = {};
  var heroTimer = null;
  var heroIndex = 0;

  var $ = function (id) { return document.getElementById(id); };

  function saveCart() {
    localStorage.setItem('vapo_cart', JSON.stringify(cart));
    renderCartCount();
  }

  function loadCart() {
    try {
      var c = JSON.parse(localStorage.getItem('vapo_cart'));
      if (Array.isArray(c)) return c;
    } catch (e) {}
    return [];
  }

  function fmt(n) {
    var s = state.settings || { currency: 'Ar', currencyPosition: 'after' };
    var str = Number(n || 0).toLocaleString('fr-FR');
    return s.currencyPosition === 'before' ? s.currency + ' ' + str : str + ' ' + s.currency;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg) {
    var box = $('toasts');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 2400);
  }

  function catName(id) {
    if (id === 'flavor') return 'Par saveur';
    var c = state.categories.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  function flavorList() {
    var seen = {}, list = [];
    state.products.forEach(function (p) {
      var fs = p.flavors || (p.flavor ? String(p.flavor).split(',').map(function (x) { return x.trim(); }) : []);
      fs.forEach(function (f) {
        f = String(f || '').trim();
        if (f && !seen[f]) { seen[f] = 1; list.push(f); }
      });
    });
    return list;
  }

  var DIMS = [
    { key: 'flavor', label: '🌶 Par saveur', menu: true },
    { key: 'marque', label: '🏷 Par marque', menu: true },
    { key: 'contenance', label: '📏 Par contenance', menu: true },
    { key: 'taux', label: '💉 Par taux de nicotine' }
  ];

  var DIM_ARR = {
    flavor: 'saveurs',
    marque: 'marques',
    contenance: 'contenances',
    taux: 'taux'
  };

  function dimValues(p, key) {
    if (key === 'flavor') return p.flavors || String(p.flavor || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (key === 'marque') return [String(p.marque || '').trim()].filter(Boolean);
    if (key === 'contenance') return [String(p.contenance || '').trim()].filter(Boolean);
    if (key === 'taux') return String(p.taux || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return [];
  }

  function dimsFor(catId, key) {
    var seen = {}, list = [];
    state.products.forEach(function (p) {
      if (p.category !== catId || p.visible === false) return;
      dimValues(p, key).forEach(function (v) {
        v = String(v || '').trim();
        var lw = v.toLowerCase();
        if (v && !seen[lw]) { seen[lw] = 1; list.push(v); }
      });
    });
    return list;
  }

  function pHasDim(p, key, val) {
    if (!val) return dimValues(p, key).length > 0;
    var lower = String(val).toLowerCase();
    return dimValues(p, key).some(function (v) { return String(v).toLowerCase() === lower; });
  }

  function subName(id) {
    for (var i = 0; i < state.categories.length; i++) {
      var subs = state.categories[i].subs || [];
      var s = subs.find(function (x) { return x.id === id; });
      if (s) return s.name;
    }
    return '';
  }

  /* ---------------- Theme ---------------- */
  function applyTheme() {
    var s = state.settings;
    var root = document.documentElement.style;
    root.setProperty('--primary', s.primaryColor);
    root.setProperty('--primary-dark', s.primaryColor);
    if (s.customCss) {
      var el = document.createElement('style');
      el.id = 'customCss';
      el.textContent = s.customCss;
      document.head.appendChild(el);
    }
    document.title = s.storeName + ' - ' + s.tagline;
    $('brandName').textContent = s.logoText || s.storeName;
    $('brandTag').textContent = s.tagline;
    if (s.logoImage) {
      $('brandLogo').innerHTML = '<img src="' + esc(s.logoImage) + '" style="height:36px">';
    } else {
      $('brandLogo').textContent = '💨';
    }
    if (s.announcementEnabled && s.announcement) {
      var a = $('announce');
      a.textContent = s.announcement;
      a.classList.remove('hidden');
    }
    $('ageTitle').textContent = 'Bienvenue sur ' + s.storeName;
    $('ageText').innerHTML = 'Ce site est réservé aux personnes majeures (18 ans et plus).<br><b>NE VAPOTEZ PAS SI VOUS NE FUMEZ PAS.</b> Produits contenant de la nicotine réservés aux adultes.';
    $('ageLogo').innerHTML = s.logoImage ? '<img src="' + esc(s.logoImage) + '" style="height:60px;margin:0 auto">' : '💨';
    if (!s.ageGateEnabled) $('ageGate').classList.add('hidden');
    $('aboutTitle').textContent = s.aboutTitle;
    $('aboutText').textContent = s.aboutText;
  }

  function renderTrust() {
    var s = state.settings;
    var el = $('trust');
    el.innerHTML = (s.trustItems || []).map(function (t) {
      return '<div class="trust-card"><div class="trust-icon">' + esc(t.icon) + '</div>' +
        '<div class="trust-title">' + esc(t.title) + '</div><div class="trust-text">' + esc(t.text) + '</div></div>';
    }).join('');
  }

  function renderFooter() {
    var s = state.settings;
    var social = '';
    if (s.facebook) social += '<a href="' + esc(s.facebook) + '" target="_blank" rel="noopener">Facebook</a>';
    if (s.instagram) social += '<a href="' + esc(s.instagram) + '" target="_blank" rel="noopener">Instagram</a>';
    var pays = '';
    if (s.payMvola !== false) pays += '<span class="pay-logo pay-mvola">MVola</span>';
    if (s.payOrange !== false) pays += '<span class="pay-logo pay-orange">Orange<br>Money</span>';
    var payBlock = pays ? '<div class="footer-pay"><h4>Paiements acceptés</h4><div class="pay-logos">' + pays + '</div>' + (s.payLivraison !== false ? '<span class="cash-delivery"><i class="fas fa-hand-holding-dollar"></i>Paiement à la livraison</span>' : '') + '</div>' : '';
    $('footer').innerHTML =
      '<div class="container footer-grid">' +
        '<div><div class="footer-logo">' + esc(s.logoText || s.storeName) + '</div>' +
          '<p>' + esc(s.tagline) + '</p></div>' +
        '<div><h4>Nous contacter</h4>' +
          '<a href="https://wa.me/' + s.whatsapp.replace(/\D/g, '') + '" target="_blank" rel="noopener">WhatsApp : ' + esc(s.whatsappDisplay) + '</a>' +
          (s.phone ? '<span>' + esc(s.phone) + '</span>' : '') +
          (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : '') +
        '</div>' +
        '<div><h4>Notre boutique</h4>' +
          '<span>' + esc(s.address) + '</span>' +
          '<span>' + esc(s.hours) + '</span>' +
          (s.mapLink ? '<a href="' + esc(s.mapLink) + '" target="_blank" rel="noopener">Voir la carte</a>' : '') +
        '</div>' +
        '<div><h4>Suivez-nous</h4>' + social + '</div>' +
      '</div>' +
      payBlock +
      '<div class="container footer-note">Vente réservée aux adultes - 18 ans minimum. '+ esc(s.storeName) + ' &copy; ' + new Date().getFullYear() + '</div>';
    $('waFloat').href = 'https://wa.me/' + s.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('Bonjour ' + s.storeName + ', je voudrais des informations sur vos produits.');
    $('waTop').href = $('waFloat').href;
  }

  /* ---------------- Hero carrousel ---------------- */
  function renderHero() {
    var s = state.settings;
    var slides = (state.banners && state.banners.length ? state.banners.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }) : []);
    if (!slides.length) {
      slides = [{
        title: s.heroTitle,
        subtitle: s.heroSubtitle,
        buttonText: s.heroBtnText,
        buttonLink: s.heroBtnLink || '#products',
        image: s.heroImage || ''
      }];
    }
    var track = $('heroTrack');
    track.innerHTML = '';
    slides.forEach(function (b, i) {
      var d = document.createElement('div');
      d.className = 'hero-slide' + (i === 0 ? ' on' : '');
      if (b.image) d.style.backgroundImage = 'url("' + b.image + '")';
      d.innerHTML = '<div class="hero-slide-inner"><span class="hero-badge">' + esc(s.storeName) + '</span>' +
        '<h1>' + esc(b.title) + '</h1>' +
        (b.subtitle ? '<p>' + esc(b.subtitle) + '</p>' : '') +
        (b.buttonText ? '<a class="btn btn-glow" href="' + esc(b.buttonLink || '#products') + '"' +
          (b.buttonLink && b.buttonLink.indexOf('http') === 0 ? ' target="_blank" rel="noopener"' : '') + '>' + esc(b.buttonText) + '</a>' : '') +
        '</div>';
      track.appendChild(d);
    });
    var dots = $('heroDots');
    dots.innerHTML = '';
    slides.forEach(function (b, i) {
      var b2 = document.createElement('button');
      b2.className = i === 0 ? 'on' : '';
      b2.setAttribute('aria-label', 'Banniere ' + (i + 1));
      b2.onclick = function () { goHero(i); restartHero(); };
      dots.appendChild(b2);
    });
    heroIndex = 0;
    startHero();
  }

  function goHero(i) {
    var slides = document.querySelectorAll('.hero-slide');
    var dots = document.querySelectorAll('.hero-dots button');
    if (!slides.length) return;
    heroIndex = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle('on', k === heroIndex); });
    dots.forEach(function (d, k) { d.classList.toggle('on', k === heroIndex); });
  }

  function startHero() {
    stopHero();
    if (document.querySelectorAll('.hero-slide').length < 2) return;
    heroTimer = setInterval(function () { goHero(heroIndex + 1); }, 5500);
  }

  function stopHero() {
    if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
  }

  function restartHero() { startHero(); }

  /* ---------------- Filtres ---------------- */
  function renderFilterDrawer() {
    var body = $('filterBody');
    var html = '<a class="menu-link' + (state.subcategory === '' ? ' active' : '') + '" data-filter="sub|" href="#products">Tout</a>';
    if (state.category !== 'all') {
      var cat = state.categories.find(function (c) { return c.id === state.category; });
      if (cat) {
        var groups = [];
        DIMS.forEach(function (d) {
          var vals = dimsFor(cat.id, d.key);
          if (!vals.length) return;
          groups.push({ label: d.label, facet: d.key, items: vals.map(function (v) { return { v: v, lbl: v }; }) });
        });
        groups.forEach(function (g) {
          var openNow = state.facet === g.facet && state.subcategory !== '';
          html += '<div class="filter-group">' +
            '<button type="button" class="filter-head' + (openNow ? ' open' : '') + '" data-facet="' + esc(g.facet) + '">' +
              '<span class="menu-cat-name">' + g.label + '</span><span class="chev">❯</span>' +
            '</button>' +
            '<div class="filter-list' + (openNow ? ' open' : '') + '"><div class="ms-inner">' + g.items.map(function (it) {
              var on = state.facet === g.facet && state.subcategory === it.v;
              return '<a class="filter-opt' + (on ? ' active' : '') + '" data-filter="' + g.facet + '|' + esc(it.v) + '" href="#products">' + esc(it.lbl) + '</a>';
            }).join('') + '</div></div>' +
          '</div>';
        });
      }
    }
    body.innerHTML = html;
    body.querySelectorAll('[data-filter]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var parts = a.getAttribute('data-filter').split('|');
        state.facet = parts[0] || 'sub';
        state.subcategory = parts.slice(1).join('|') || '';
        closeFilter();
        renderProducts();
      });
    });
    body.querySelectorAll('.filter-head').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var list = btn.nextElementSibling;
        btn.classList.toggle('open');
        list.classList.toggle('open');
      });
    });
  }

  function openFilter() {
    renderFilterDrawer();
    $('cartDrawer').classList.add('hidden');
    $('menuDrawer').classList.add('hidden');
    $('filterDrawer').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  function closeFilter() {
    $('filterDrawer').classList.add('hidden');
    $('overlay').classList.add('hidden');
  }

  /* ---------------- Nav ---------------- */
  function selectCategory(catId, facet, subId) {
    state.promoOnly = false;
    state.category = catId;
    state.facet = facet || 'sub';
    state.subcategory = subId || '';
    state.search = '';
    $('searchInput').value = '';
    renderProducts();
    document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }

  function goHome() {
    state.category = 'all';
    state.facet = 'sub';
    state.subcategory = '';
    state.search = '';
    state.promoOnly = false;
    state.sort = 'pertinence';
    $('searchInput').value = '';
    $('sortSelect').value = 'pertinence';
    renderProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPromo() {
    state.category = 'all';
    state.facet = 'sub';
    state.subcategory = '';
    state.search = '';
    state.promoOnly = true;
    $('searchInput').value = '';
    renderProducts();
    document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }

  function applyNavActive() {
    var links = document.querySelectorAll('.nav-link');
    links.forEach(function (x) {
      x.classList.toggle('active', x.getAttribute('data-cat') === state.category && state.category !== 'all');
    });
    document.querySelectorAll('.menu-link').forEach(function (x) {
      x.classList.toggle('active', x.getAttribute('data-menu-cat') === state.category && state.category !== 'all');
    });
    document.querySelectorAll('.menu-cat').forEach(function (x) {
      x.classList.toggle('active', x.getAttribute('data-menu-cat') === state.category && state.category !== 'all');
    });
    document.querySelectorAll('.menu-sub, .menu-sub2').forEach(function (x) {
      x.classList.toggle('active',
        x.getAttribute('data-menu-sub') === state.subcategory &&
        x.getAttribute('data-menu-cat') === state.category &&
        x.getAttribute('data-menu-facet') === state.facet);
    });
  }

  function renderNav() {
    var nav = $('navInner');
    var html = '<a class="nav-link active" data-cat="all" href="#products">Tous les produits</a>';
    html += state.categories.map(function (c) {
      return '<a class="nav-link" data-cat="' + esc(c.id) + '" href="#products">' + esc(c.name) + '</a>';
    }).join('');
    html += '<a class="nav-link nav-promo" data-promo="1" href="#promo">🔥 Destockage / Promo</a>';
    nav.innerHTML = html;
    nav.querySelectorAll('.nav-link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (a.getAttribute('data-promo')) { goPromo(); return; }
        var cat = a.getAttribute('data-cat');
        selectCategory(cat, 'sub', '');
        padNav();
      });
    });

    var m = '<a class="menu-link" data-menu-cat="all" href="#products">🛍️ Tous les produits</a>';
    m += state.categories.map(function (c) {
      var subs = (c.subs || []).map(function (s) {
        return '<a class="menu-sub" data-menu-cat="' + esc(c.id) + '" data-menu-facet="sub" data-menu-sub="' + esc(s.id) + '" href="#products">' + esc(s.name) + '</a>';
      }).join('');
      var extra = '';
      var noFlavorCat = (c.id === 'c2'); /* Cigarettes électroniques : pas de saveur */
      DIMS.forEach(function (d) {
        if (!d.menu) return;
        if (noFlavorCat && d.key === 'flavor') return;
        var vals = dimsFor(c.id, d.key);
        if (!vals.length) return;
        extra += '<div class="menu-subgrp"><button type="button" class="menu-cat2" data-menu-cat="' + esc(c.id) + '" data-menu-facet="' + d.key + '"><span class="menu-cat-name">' + d.label + '</span><span class="chev">❯</span></button>' +
          '<div class="menu-subs2"><div class="ms-inner">' + vals.map(function (v) {
            return '<a class="menu-sub2" data-menu-cat="' + esc(c.id) + '" data-menu-facet="' + d.key + '" data-menu-sub="' + esc(v) + '" href="#products">' + esc(v) + '</a>';
          }).join('') + '</div></div></div>';
      });
      return '<div class="menu-group" data-group="' + esc(c.id) + '">' +
        '<button type="button" class="menu-cat" data-menu-cat="' + esc(c.id) + '" data-hassub="1">' +
          '<span class="menu-cat-name">' + esc(c.name) + '</span><span class="chev">❯</span>' +
        '</button>' +
        '<div class="menu-subs"><div class="ms-inner">' + subs + extra + '</div></div>' +
      '</div>';
    }).join('');
    m += '<a class="menu-link menu-promo" data-promo="1" href="#promo">🔥 Destockage / Promo</a>';
    $('menuBody').innerHTML = m;

    $('menuBody').querySelectorAll('.menu-link, .menu-sub, .menu-sub2').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (a.getAttribute('data-promo')) { closeMenu(); goPromo(); return; }
        selectCategory(a.getAttribute('data-menu-cat'), a.getAttribute('data-menu-facet') || 'sub', a.getAttribute('data-menu-sub'));
        closeMenu();
      });
    });
    $('menuBody').querySelectorAll('.menu-cat').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.closest('.menu-group');
        var subBox = group ? group.querySelector('.menu-subs') : null;
        var inner = subBox ? subBox.querySelector('.ms-inner') : null;
        if (!inner || !inner.children.length) {
          selectCategory(btn.getAttribute('data-menu-cat'), 'sub', '');
          closeMenu();
          return;
        }
        btn.classList.toggle('open');
        subBox.classList.toggle('open');
      });
    });
    $('menuBody').querySelectorAll('.menu-cat2').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var grp = btn.closest('.menu-subgrp');
        var subBox = grp ? grp.querySelector('.menu-subs2') : null;
        if (!subBox) return;
        btn.classList.toggle('open');
        subBox.classList.toggle('open');
      });
    });
  }

  function padNav() {
    applyNavActive();
  }

  function openMenu() {
    $('cartDrawer').classList.add('hidden');
    $('menuDrawer').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  function closeMenu() {
    $('menuDrawer').classList.add('hidden');
    $('overlay').classList.add('hidden');
  }

  /* ---------------- Products ---------------- */
  function visibleProducts() {
    var list = state.products.filter(function (p) {
      if (!p.visible) return false;
      if (state.promoOnly) {
        var pi = p.promoPrice != null && p.promoPrice !== '';
        var pb = /promo|prix/i.test(p.badge || '');
        if (!pi && !pb) return false;
      }
      if (state.category !== 'all' && p.category !== state.category) return false;
      var dimActive = false;
      for (var di = 0; di < DIMS.length; di++) {
        if (state.facet === DIMS[di].key) { dimActive = true; break; }
      }
      if (dimActive) {
        if (!pHasDim(p, state.facet, state.subcategory)) return false;
      } else if (state.subcategory && p.subcategory !== state.subcategory) {
        return false;
      }
      if (state.search) {
        var hay = (p.name + ' ' + (p.description || '') + ' ' + catName(p.category) + ' ' + subName(p.subcategory) + ' ' + (p.flavors || []).join(' ') + ' ' + String(p.marque || '') + ' ' + String(p.contenance || '') + ' ' + String(p.taux || '')).toLowerCase();
        if (hay.indexOf(state.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var q = state.search.toLowerCase();
    var sort = state.sort;
    list.sort(function (a, b) {
      var pa = a.promoPrice != null && a.promoPrice !== '' ? a.promoPrice : a.price;
      var pb = b.promoPrice != null && b.promoPrice !== '' ? b.promoPrice : b.price;
      if (sort === 'price-asc') return pa - pb;
      if (sort === 'price-desc') return pb - pa;
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'new') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sort === 'pertinence' && q) {
        var starts = function (p) { return p.name.toLowerCase().indexOf(q) === 0 ? 0 : 1; };
        return starts(a) - starts(b) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      }
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.rating || 0) - (a.rating || 0);
    });
    return list;
  }

  function stars(r) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += i <= Math.round(r) ? '★' : '☆';
    return out;
  }

  function discountPct(p) {
    var base = Number(p.price);
    var promo = Number(p.promoPrice);
    if (!base || !(p.promoPrice != null && p.promoPrice !== '') || isNaN(promo)) return '';
    var pct = Math.round((1 - promo / base) * 100);
    if (pct <= 0) return '';
    return pct + '%';
  }

  function cardPrice(p) {
    if (p.promoPrice != null && p.promoPrice !== '') {
      return '<span class="old">' + fmt(p.price) + '</span>' +
        '<span class="price promo">' + fmt(p.promoPrice) + '</span>';
    }
    return '<span class="price">' + fmt(p.price) + '</span>';
  }

  function renderProducts() {
    var list = visibleProducts();
    var grid = $('grid');
    $('empty').hidden = list.length > 0;
    var catT = state.category === 'all' ? 'Tous les produits' : catName(state.category);
    $('sectionTitle').textContent = catT;
    var subCount = '';
    if (state.subcategory) {
      var lbl = state.facet !== 'sub' ? state.subcategory
        : subName(state.subcategory);
      subCount = ' · ' + lbl;
    }
    $('sectionSub').textContent = list.length + ' produit(s)' + subCount;
    var fLbl = state.subcategory ? (state.facet !== 'sub' ? state.subcategory : subName(state.subcategory)) : '';
    $('filterBtn').textContent = fLbl ? 'Filtrer · ' + fLbl + ' ▾' : 'Filtrer ▾';
    applyNavActive();
    grid.innerHTML = list.map(function (p) {
      var badge = '';
      if (p.badge) {
        var bcol = /promo|prix/i.test(p.badge) ? 'red' : /nouveaut/i.test(p.badge) ? 'blue' : '';
        var pct = discountPct(p);
        badge = '<span class="card-badge ' + bcol + '">' + esc(p.badge) + (pct && bcol === 'red' ? ' <span class="badge-pct">-' + pct + '</span>' : '') + '</span>';
      }
      var rupt = p.available === false ? '<span class="card-stock">Rupture</span>' : '';
      var rating = p.rating ? '<div class="card-rating">' + stars(p.rating) + ' <span class="count">' + p.rating.toFixed(1) + ' (' + (p.reviews || 0) + ')</span></div>' : '';
      var catTxt = p.subcategory ? esc(catName(p.category)) + ' · ' + esc(subName(p.subcategory)) : esc(catName(p.category));
      return '<div class="card' + (p.available === false ? ' off' : '') + '" data-id="' + p.id + '">' +
        badge + rupt +
        '<div class="card-img"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy"></div>' +
        '<div class="card-body">' +
          '<div class="card-cat">' + catTxt + '</div>' +
          '<div class="card-name">' + esc(p.name) + '</div>' + rating +
          '<div class="card-foot">' + cardPrice(p) +
            '<button class="add-btn" data-add="' + p.id + '">' + (p.available === false ? 'Rupture' : (p.options && p.options.length ? 'Choisir' : 'Ajouter')) + '</button>' +
          '</div>' +
        '</div></div>';
    }).join('');

    grid.querySelectorAll('.card').forEach(function (c) {
      c.addEventListener('click', function (e) {
        if (e.target.closest('.add-btn')) return;
        var p = state.products.find(function (x) { return x.id === c.getAttribute('data-id'); });
        if (p && hasDetail(p)) openProductDetail(p.id);
        else openProduct(c.getAttribute('data-id'));
      });
    });
    grid.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var pid = btn.getAttribute('data-add');
        var p = state.products.find(function (x) { return x.id === pid; });
        if (!p) return;
        if (p.available === false) { toast('Produit momentanément en rupture'); return; }
        if (p.options && p.options.length) { openProduct(pid); return; }
        addToCart(p.id, '', 1);
      });
    });
    writeHash();
  }

  /* ---------------- Product modal ---------------- */
  function openProduct(id) {
    var p = state.products.find(function (x) { return x.id === id; });
    if (!p) return;
    optionCache[id] = p.options && p.options.length ? p.options[0] : '';
    var qty = 1;
    $('pmBadge').textContent = p.badge || '';
    $('pmBadge').style.display = p.badge ? '' : 'none';
    $('pmImage').src = p.image;
    $('pmName').textContent = p.name;
    $('pmRating').innerHTML = p.rating ? stars(p.rating) + ' ' + p.rating.toFixed(1) + ' (' + (p.reviews || 0) + ' avis)' : 'Nouveau produit';
    if (p.promoPrice != null && p.promoPrice !== '') {
      var pct = discountPct(p);
      $('pmPrice').innerHTML = '<span class="old">' + fmt(p.price) + '</span>' +
        '<span class="pm-promo">' + fmt(p.promoPrice) + '</span>' +
        (pct ? '<span class="discount-badge">-' + pct + '</span>' : '');
    } else {
      $('pmPrice').textContent = fmt(p.price);
    }
    $('pmDesc').textContent = p.description;
    var optEl = $('pmOptions');
    if (p.options && p.options.length) {
      optEl.innerHTML = p.options.map(function (o, i) {
        return '<button class="opt-btn' + (i === 0 ? ' on' : '') + '" data-opt="' + esc(o) + '">' + esc(o) + '</button>';
      }).join('');
      optEl.querySelectorAll('.opt-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          optEl.querySelectorAll('.opt-btn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          optionCache[id] = b.getAttribute('data-opt');
        });
      });
    } else {
      optEl.innerHTML = '';
    }
    $('pmQty').textContent = qty;
    $('pmStock').innerHTML = p.available === false
      ? '<span class="ko">✖ Momentanément en rupture de stock</span>'
      : '<span class="ok">✔ Disponible</span>';
    var addBtn = $('pmAdd');
    addBtn.disabled = p.available === false;
    addBtn.style.opacity = p.available === false ? 0.5 : 1;
    addBtn.textContent = p.available === false ? 'En rupture' : 'Ajouter au panier';
    $('pmPlus').onclick = function () { qty++; $('pmQty').textContent = qty; };
    $('pmMinus').onclick = function () { if (qty > 1) { qty--; $('pmQty').textContent = qty; } };
    addBtn.onclick = function () {
      if (p.available === false) { toast('Produit momentanément en rupture'); return; }
      addToCart(p.id, optionCache[id] || '', qty);
      closeModals(null);
    };
    show(null, 'productModal');
  }

  function hasDetail(p) {
    if (!p) return false;
    if (p.longDescription && String(p.longDescription).trim()) return true;
    if (Array.isArray(p.gallery) && p.gallery.length) return true;
    return false;
  }

  function galleryFor(p) {
    var imgs = [p.image].concat(p.gallery || []).filter(function (u) { return !!u; });
    return imgs;
  }

  function renderDetailDesc(raw) {
    var txt = String(raw || '');
    if (!txt.trim()) return '';
    var html = '';
    var re = /\[image\]([\s\S]*?)\[\/image\]/g;
    var last = 0;
    var m;
    while ((m = re.exec(txt)) !== null) {
      var before = txt.slice(last, m.index);
      if (before.trim()) {
        html += before.split(/\n+/).map(function (par) {
          var p = par.trim();
          return p ? '<p>' + esc(p) + '</p>' : '';
        }).join('');
      }
      var url = m[1].split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
      if (url) html += '<figure class="dl-fig"><img src="' + esc(url) + '" alt="" loading="lazy"></figure>';
      last = m.index + m[0].length;
    }
    var tail = txt.slice(last);
    if (tail.trim()) {
      html += tail.split(/\n+/).map(function (par) {
        var p = par.trim();
        return p ? '<p>' + esc(p) + '</p>' : '';
      }).join('');
    }
    return html;
  }

  function openProductDetail(id) {
    var p = state.products.find(function (x) { return x.id === id; });
    if (!p) return;
    optionCache[id] = p.options && p.options.length ? p.options[0] : '';
    var qty = 1;
    var s = state.settings || {};
    var imgs = galleryFor(p);
    $('dlBadge').textContent = p.badge || '';
    $('dlBadge').style.display = p.badge ? '' : 'none';
    $('dlName').textContent = p.name;
    $('dlRating').innerHTML = p.rating ? stars(p.rating) + ' ' + p.rating.toFixed(1) + ' (' + (p.reviews || 0) + ' avis)' : 'Nouveau produit';
    if (p.promoPrice != null && p.promoPrice !== '') {
      var pct = discountPct(p);
      $('dlPrice').innerHTML = '<span class="old">' + fmt(p.price) + '</span>' +
        '<span class="pm-promo">' + fmt(p.promoPrice) + '</span>' +
        (pct ? '<span class="discount-badge">-' + pct + '</span>' : '');
    } else {
      $('dlPrice').textContent = fmt(p.price);
    }
    var meta = [];
    if (p.marque) meta.push('<span>Marque : <b>' + esc(p.marque) + '</b></span>');
    if (p.contenance) meta.push('<span>Contenance : <b>' + esc(p.contenance) + '</b></span>');
    if (p.taux) meta.push('<span>Taux : <b>' + esc(p.taux) + '</b></span>');
    if ((p.flavors || []).length) meta.push('<span>Saveurs : <b>' + esc(p.flavors.join(', ')) + '</b></span>');
    $('dlMeta').innerHTML = meta.join('');
    $('dlMeta').style.display = meta.length ? '' : 'none';
    var optEl = $('dlOptions');
    if (p.options && p.options.length) {
      optEl.innerHTML = p.options.map(function (o, i) {
        return '<button class="opt-btn' + (i === 0 ? ' on' : '') + '" data-opt="' + esc(o) + '">' + esc(o) + '</button>';
      }).join('');
      optEl.querySelectorAll('.opt-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          optEl.querySelectorAll('.opt-btn').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          optionCache[id] = b.getAttribute('data-opt');
        });
      });
    } else {
      optEl.innerHTML = '';
    }
    $('dlQty').textContent = qty;
    $('dlStock').innerHTML = p.available === false
      ? '<span class="ko">✖ Momentanément en rupture de stock</span>'
      : '<span class="ok">✔ Disponible</span>';
    var addBtn = $('dlAdd');
    addBtn.disabled = p.available === false;
    addBtn.style.opacity = p.available === false ? 0.5 : 1;
    addBtn.textContent = p.available === false ? 'En rupture' : 'Ajouter au panier';
    var wa = s.whatsapp ? 'https://wa.me/' + s.whatsapp.replace(/\D/g, '') + '?text=' :
      ('https://wa.me/?text=');
    $('dlWa').href = wa + encodeURIComponent('Bonjour ' + (s.storeName || '') + ', je suis intéressé(e) par : ' + p.name + (p.promoPrice != null && p.promoPrice !== '' ? ' (' + fmt(p.promoPrice) + ')' : ' (' + fmt(p.price) + ')'));
    var main = $('dlMain');
    main.src = imgs[0] || '';
    var thumbs = $('dlThumbs');
    thumbs.innerHTML = imgs.map(function (u, i) {
      return '<button type="button" class="dl-thumb' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"><img src="' + esc(u) + '" alt=""></button>';
    }).join('');
    thumbs.querySelectorAll('.dl-thumb').forEach(function (t) {
      t.addEventListener('click', function () {
        thumbs.querySelectorAll('.dl-thumb').forEach(function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        main.src = imgs[+t.getAttribute('data-i')];
      });
    });
    var body = $('dlDesc');
    var txt = String(p.longDescription || '').trim();
    body.innerHTML = renderDetailDesc(txt) || '<p>' + esc(p.description || '') + '</p>';
    $('dlPlus').onclick = function () { qty++; $('dlQty').textContent = qty; };
    $('dlMinus').onclick = function () { if (qty > 1) { qty--; $('dlQty').textContent = qty; } };
    addBtn.onclick = function () {
      if (p.available === false) { toast('Produit momentanément en rupture'); return; }
      addToCart(p.id, optionCache[id] || '', qty);
      closeModals(null);
    };
    show(null, 'detailModal');
  }

  /* ---------------- Cart ---------------- */
  function addToCart(pid, option, qty) {
    var p = state.products.find(function (x) { return x.id === pid; });
    if (!p) return;
    var existing = cart.find(function (x) { return x.productId === pid && x.option === option; });
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({
        productId: pid,
        name: p.name,
        option: option || '',
        price: p.promoPrice != null && p.promoPrice !== '' ? p.promoPrice : p.price,
        image: p.image,
        qty: qty
      });
    }
    saveCart();
    toast('Ajouté au panier ✔');
    renderCart();
  }

  function cartTotal() {
    return cart.reduce(function (s, x) { return s + x.price * x.qty; }, 0);
  }

  function renderCartCount() {
    $('cartCount').textContent = cart.reduce(function (s, x) { return s + x.qty; }, 0);
  }

  function renderCart() {
    renderCartCount();
    var body = $('cartBody');
    if (!cart.length) {
      body.innerHTML = '<div class="cart-empty"><span class="big">🛒</span>Votre panier est vide.<br>Ajoutez des produits pour commencer.</div>';
      $('cartTotal').textContent = fmt(0);
      return;
    }
    body.innerHTML = cart.map(function (x, i) {
      return '<div class="cart-item">' +
        '<img src="' + esc(x.image) + '" alt="">' +
        '<div class="cart-item-info">' +
          '<div class="cart-item-name">' + esc(x.name) + '</div>' +
          (x.option ? '<div class="cart-item-opt">' + esc(x.option) + '</div>' : '') +
          '<div class="cart-item-price">' + fmt(x.price * x.qty) + '</div>' +
          '<div class="cart-item-actions">' +
            '<div class="stepper"><button data-dec="' + i + '">−</button><span>' + x.qty + '</span><button data-inc="' + i + '">+</button></div>' +
            '<button class="cart-remove" data-rm="' + i + '">Retirer</button>' +
          '</div>' +
        '</div></div>';
    }).join('');
    $('cartTotal').textContent = fmt(cartTotal());
    body.querySelectorAll('[data-inc]').forEach(function (b) {
      b.onclick = function () { cart[+b.getAttribute('data-inc')].qty++; saveCart(); renderCart(); };
    });
    body.querySelectorAll('[data-dec]').forEach(function (b) {
      b.onclick = function () {
        var x = cart[+b.getAttribute('data-dec')];
        x.qty--;
        if (x.qty < 1) cart.splice(+b.getAttribute('data-dec'), 1);
        saveCart(); renderCart();
      };
    });
    body.querySelectorAll('[data-rm]').forEach(function (b) {
      b.onclick = function () { cart.splice(+b.getAttribute('data-rm'), 1); saveCart(); renderCart(); };
    });
  }

  /* ---------------- Checkout ---------------- */
  function openCheckout(method) {
    if (!cart.length) { toast('Votre panier est vide'); return; }
    $('coTitle').textContent = method === 'pickup' ? 'Commande en retrait boutique' : 'Commande en livraison';
    $('coAddressWrap').style.display = method === 'delivery' ? '' : 'none';
    $('coFees').hidden = method !== 'delivery';
    $('coAddress').required = method === 'delivery';
    $('checkoutModal').dataset.method = method;
    var lines = cart.map(function (x) {
      return '<div class="line"><span>' + x.qty + 'x ' + esc(x.name) + (x.option ? ' (' + esc(x.option) + ')' : '') + '</span>' +
        '<span>' + fmt(x.price * x.qty) + '</span></div>';
    }).join('');
    var totalLine = '<div class="line total-line"><span>Total</span><span>' + fmt(cartTotal()) + '</span></div>';
    if (method === 'delivery') {
      totalLine += '<div class="line co-fees-line"><span>Frais de livraison</span><span>À confirmer</span></div>';
    }
    $('coSummary').innerHTML = lines + totalLine;
    closeModals('cartDrawer');
    show(null, 'checkoutModal');
  }

  function submitOrder(e) {
    e.preventDefault();
    var method = $('checkoutModal').dataset.method || 'delivery';
    var payload = {
      name: $('coName').value.trim(),
      phone: $('coPhone').value.trim(),
      email: $('coEmail').value.trim(),
      address: method === 'delivery' ? $('coAddress').value.trim() : '',
      note: $('coNote').value.trim(),
      method: method,
      items: cart.map(function (x) { return { productId: x.productId, option: x.option, qty: x.qty }; })
    };
    if (!payload.name || !payload.phone) { toast('Veuillez remplir votre nom et votre téléphone'); return; }
    $('coSubmit').disabled = true;
    $('coSubmit').textContent = 'Envoi...';
    fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || 'Erreur');
        var d = res.d;
        cart = [];
        saveCart();
        renderCart();
        closeModals('checkoutModal');
        var type = method === 'pickup' ? 'retrait en boutique' : 'livraison';
        var txt = 'Commande ' + d.ref + ' enregistrée ✔ Nous ouvrons WhatsApp pour envoyer le récapitulatif de votre commande (' + type + ').';
        $('successText').textContent = txt;
        show(null, 'successModal');
        if (d.whatsappLink) {
          setTimeout(function () { window.open(d.whatsappLink, '_blank'); }, 300);
        }
      })
      .catch(function (err) {
        toast(err.message || 'Erreur lors de la commande');
      })
      .finally(function () {
        $('coSubmit').disabled = false;
        $('coSubmit').textContent = 'Envoyer ma commande';
      });
  }

  /* ---------------- Overlay / modals helpers ---------------- */
  function show(overlayId, modalId) {
    if (overlayId) { $(overlayId).classList.remove('hidden'); }
    if (modalId) { $(modalId).classList.remove('hidden'); }
    var ov = $('overlay');
    if (modalId && modalId !== 'cartDrawer') {
      ov.classList.remove('hidden');
    } else if (modalId === 'cartDrawer') {
      ov.classList.remove('hidden');
    }
  }

  function closeModals(except) {
    var ov = $('overlay');
    if (except !== 'cartDrawer') $('cartDrawer').classList.add('hidden');
    if (except !== 'menuDrawer') $('menuDrawer').classList.add('hidden');
    if (except !== 'filterDrawer') $('filterDrawer').classList.add('hidden');
    if (except !== 'checkoutModal') $('checkoutModal').classList.add('hidden');
    if (except !== 'productModal') $('productModal').classList.add('hidden');
    if (except !== 'detailModal') $('detailModal').classList.add('hidden');
    if (except !== 'successModal') $('successModal').classList.add('hidden');
    ov.classList.add('hidden');
  }

  function openCart() {
    closeMenu();
    renderCart();
    $('cartDrawer').classList.remove('hidden');
    $('overlay').classList.remove('hidden');
  }

  /* ---------------- Age gate ---------------- */
  function initAgeGate() {
    var s = state.settings;
    if (!s || !s.ageGateEnabled) return;
    var yesBtn = $('ageYes');
    if (!yesBtn) return;
    var noBtn = $('ageNo');
    if (!noBtn) {
      noBtn = document.createElement('button');
      noBtn.className = 'btn btn-no';
      noBtn.id = 'ageNo';
      noBtn.textContent = "Non, j'ai moins de 18 ans";
      var btns = $('ageGate').querySelector('.age-buttons');
      if (btns) btns.appendChild(noBtn);
    }
    $('ageGate').classList.remove('hidden');
    yesBtn.onclick = function () {
      $('ageGate').classList.add('hidden');
    };
    noBtn.onclick = function () {
      if (noBtn.getAttribute('data-leaving') === '1') return;
      noBtn.setAttribute('data-leaving', '1');
      noBtn.textContent = 'Au revoir…';
      setTimeout(function () { window.location.href = 'https://www.google.com'; }, 400);
    };
  }

  /* ---------------- Init ---------------- */
  function init() {
    $('cartBtn').onclick = openCart;
    $('cartClose').onclick = function () { closeModals(null); };
    $('overlay').onclick = function () { closeMenu(); closeFilter(); closeModals(null); };
    $('burgerBtn').onclick = openMenu;
    $('menuClose').onclick = closeMenu;
    $('brand').addEventListener('click', function (e) {
      e.preventDefault();
      goHome();
    });
    $('filterBtn').onclick = openFilter;
    $('filterClose').onclick = closeFilter;
    $('pmClose').onclick = function () { closeModals(null); };
    $('dlClose').onclick = function () { closeModals(null); };
    $('coClose').onclick = function () { closeModals(null); };
    $('successBtn').onclick = function () { closeModals(null); };
    $('checkoutForm').addEventListener('submit', submitOrder);
    $('checkoutWa').onclick = function () { openCheckout('delivery'); };
    $('checkoutPickup').onclick = function () { openCheckout('pickup'); };

    $('heroPrev').onclick = function () { goHero(heroIndex - 1); restartHero(); };
    $('heroNext').onclick = function () { goHero(heroIndex + 1); restartHero(); };

    $('sortSelect').onchange = function () {
      state.sort = this.value;
      renderProducts();
    };

    var st;
    function commitSearch(withScroll) {
      state.search = $('searchInput').value.trim();
      var navLinks = document.querySelectorAll('.nav-link');
      navLinks.forEach(function (x) { x.classList.remove('active'); });
      state.promoOnly = false;
      state.category = 'all';
      state.subcategory = '';
      renderProducts();
      if (withScroll) {
        var el = $('products');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('searchInput').blur();
      }
    }
    $('searchInput').addEventListener('input', function () {
      clearTimeout(st);
      st = setTimeout(function () { commitSearch(false); }, 250);
    });
    $('searchInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        clearTimeout(st);
        commitSearch(true);
      }
    });

    window.addEventListener('hashchange', function () { readHash(); });

    fetch('/api/store')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.settings = d.settings;
        state.categories = d.categories;
        state.products = d.products;
        state.banners = d.banners || [];
        applyTheme();
        renderHero();
        renderTrust();
        renderFooter();
        renderNav();
        if (location.hash && location.hash !== '#products' && location.hash !== '#/') {
          readHash();
        } else {
          renderProducts();
        }
        renderCart();
        initAgeGate();
      })
      .catch(function () {
        toast('Impossible de charger la boutique. Vérifiez que le serveur est démarré.');
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();