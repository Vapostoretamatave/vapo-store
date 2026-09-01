(function () {
  'use strict';

    function showDiag(msg) {
    var el = document.getElementById('jsDiag');
    if (!el) {
      el = document.createElement('div');
      el.id = 'jsDiag';
      el.setAttribute('style', 'position:fixed;top:8px;left:8px;right:8px;z-index:99999;background:#7a1c1c;color:#fff;padding:10px 14px;border-radius:8px;font:12px/1.4 monospace;white-space:pre-wrap;box-shadow:0 6px 18px rgba(0,0,0,.4)');
      el.onclick = function () { el.remove(); };
      document.body.appendChild(el);
    }
    el.textContent = 'DIAGNOSTIC : ' + msg + '   (cliquez pour fermer)';
  }

  window.addEventListener('error', function (ev) {
    var errorMsg = 'Erreur JS : ' + (ev.message || 'erreur inconnue') + ' @' + (ev.filename || '') + ':' + (ev.lineno || '');
    try { toast(errorMsg, true, 10000); showDiag(errorMsg); } catch (e) {}
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    var detail = r ? (r.message || String(r)) : 'raison inconnue';
    var cap = 'Echec silencieux capte : ' + detail;
    try { toast(cap, true, 10000); showDiag(cap); } catch (e) {}
  });
var $ = function (id) { return document.getElementById(id); };

  var STATUSES = ['Nouvelle', 'Confirmée', 'En préparation', 'Prête', 'Terminée', 'Annulée'];
  var METHODS = { whatsapp: 'Commande WhatsApp', pickup: 'Retrait en magasin', delivery: 'Livraison' };
  var STATUS_PILLS = {
    'Nouvelle': 'green', 'Confirmée': 'blue', 'En préparation': 'orange',
    'Prête': 'purple', 'Terminée': 'gray', 'Annulée': 'red'
  };

  var state = {
    token: sessionStorage.getItem('vapo_admin_token') || null,
    settings: null,
    categories: [],
    products: [],
    orders: [],
    view: 'dashboard',
    productFilter: '',
    prodCat: 'all',
    orderFilter: 'all',
    dict: { saveurs: [], marques: [], contenances: [], taux: [] }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, isErr, ms) {
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || (isErr ? 6000 : 2600));
  }

  function fmt(n) {
    var s = state.settings || { currency: 'Ar', currencyPosition: 'after' };
    var str = Number(n || 0).toLocaleString('fr-FR');
    return s.currencyPosition === 'before' ? s.currency + ' ' + str : str + ' ' + s.currency;
  }

  function catName(id) {
    var c = state.categories.find(function (x) { return x.id === id; });
    return c ? c.name : '';
  }

  function subName(id) {
    for (var i = 0; i < state.categories.length; i++) {
      var subs = state.categories[i].subs || [];
      var s = subs.find(function (x) { return x.id === id; });
      if (s) return s.name;
    }
    return '';
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    var timeoutMs = opts.timeout || 30000;
    var timer = null;
    return Promise.race([
      fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }),
      new Promise(function (resolve, rej) {
        timer = setTimeout(function () {
          rej(new Error('Délai dépassé (serveur occupé ?)'));
        }, timeoutMs);
      })
    ]).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (d) { return { ok: r.ok, d: d, status: r.status }; });
    }).catch(function (err) {
      clearTimeout(timer);
      return { ok: false, d: { error: err.message || 'Erreur réseau' } };
    });
  }

  /* ---------------- Login ---------------- */
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('loginPassword').value;
    $('loginError').textContent = '';
    $('loginBtn').disabled = true;
    api('/api/admin/login', { method: 'POST', body: { password: pw } }).then(function (res) {
      if (res.ok && res.d.token) {
        state.token = res.d.token;
        sessionStorage.setItem('vapo_admin_token', res.d.token);
        boot();
      } else {
        $('loginError').textContent = res.d.error || 'Erreur de connexion';
      }
    }).catch(function () {
      $('loginError').textContent = 'Serveur injoignable';
    }).finally(function () {
      $('loginBtn').disabled = false;
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    state.token = null;
    sessionStorage.removeItem('vapo_admin_token');
    document.location.reload();
  });

  /* ---------------- Init / auth gate ---------------- */
  function boot() {
    if (!state.token) {
      showLogin();
      return;
    }
    api('/api/admin/check').then(function (res) {
      if (res.ok) {
        loadData();
      } else {
        state.token = null;
        sessionStorage.removeItem('vapo_admin_token');
        showLogin();
      }
    }).catch(function () {
      showLogin();
    });
  }

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('appView').classList.add('hidden');
  }

  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
  }

  function loadData() {
    api('/api/admin/data').then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Erreur');
      state.settings = res.d.settings;
      state.categories = res.d.categories;
      state.products = res.d.products;
      state.orders = res.d.orders;
      state.banners = res.d.banners || [];
      state.dict = res.d.dict || { saveurs: [], marques: [], contenances: [], taux: [] };
      showApp();
      $('sideStoreName').textContent = state.settings.storeName;
      render();
      updateOrdersBadge();
    }).catch(function (err) {
      toast(err.message || 'Erreur de chargement', true);
    });
  }

  function refreshAll() {
    api('/api/admin/data').then(function (res) {
      if (!res.ok) return toast('Erreur de rafraîchissement', true);
      state.settings = res.d.settings;
      state.categories = res.d.categories;
      state.products = res.d.products;
      state.orders = res.d.orders;
      state.banners = res.d.banners || [];
      state.dict = res.d.dict || { saveurs: [], marques: [], contenances: [], taux: [] };
      render();
      updateOrdersBadge();
      window.scrollTo(0, 0);
    });
  }

  function updateOrdersBadge() {
    var n = state.orders.filter(function (o) { return o.status === 'Nouvelle'; }).length;
    var el = $('newOrdersBadge');
    el.textContent = n;
    el.classList.toggle('warn', n > 0);
    el.title = n + ' nouvelle(s) commande(s)';
  }

  /* ---------------- View switching ---------------- */
  var TITLES = {
    dashboard: 'Tableau de bord',
    products: 'Produits',
    categories: 'Catégories',
    banners: 'Banderoles',
    orders: 'Commandes',
    settings: 'Réglages'
  };

  function switchView(v) {
    state.view = v;
    document.querySelectorAll('.side-link[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === v);
    });
    $('pageTitle').textContent = TITLES[v];
    render();
  }

  document.querySelectorAll('.side-link[data-view]').forEach(function (a) {
    a.addEventListener('click', function () { switchView(a.getAttribute('data-view')); });
  });

  $('menuToggle').onclick = function () {
    $('sidebar').classList.toggle('open');
  };
  document.querySelectorAll('.side-link').forEach(function (a) {
    a.addEventListener('click', function () { $('sidebar').classList.remove('open'); });
  });

  function render() {
    var fns = {
      dashboard: renderDashboard,
      products: renderProducts,
      categories: renderCategories,
      banners: renderBanners,
      orders: renderOrders,
      settings: renderSettings
    };
    fns[state.view]();
  }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard() {
    var prods = state.products;
    var orders = state.orders;
    var newOrders = orders.filter(function (o) { return o.status === 'Nouvelle'; });
    var active = orders.filter(function (o) { return o.status !== 'Annulée'; });
    var revenue = active.reduce(function (s, o) { return s + o.total; }, 0);
    var out = '';
    out += '<div class="cards">' +
      '<div class="stat"><div class="num">' + prods.length + '</div><div class="lbl">Produits</div><div class="sub">' + prods.filter(function (p) { return p.visible; }).length + ' visibles</div></div>' +
      '<div class="stat"><div class="num">' + state.categories.length + '</div><div class="lbl">Catégories</div></div>' +
      '<div class="stat"><div class="num">' + orders.length + '</div><div class="lbl">Commandes</div><div class="sub">' + newOrders.length + ' nouvelle(s)</div></div>' +
      '<div class="stat"><div class="num">' + fmt(revenue) + '</div><div class="lbl">Total encaissé (hors annulées)</div></div>' +
      '</div>';

    out += '<div class="card"><div class="card-head"><h3>Actions rapides</h3></div><div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" id="qaNewProd">➕ Nouveau produit</button>' +
      '<button class="btn btn-outline" data-go="orders">📦 Voir les commandes</button>' +
      '<button class="btn btn-outline" data-go="settings">⚙️ Réglages du site</button>' +
      '</div></div>';

    var recent = orders.slice(0, 6);
    var rows = recent.length ? recent.map(function (o) {
      return '<tr>' +
        '<td><b>' + esc(o.ref) + '</b></td>' +
        '<td>' + esc(o.customer.name) + '</td>' +
        '<td>' + fmt(o.total) + '</td>' +
        '<td>' + (METHODS[o.method] || o.method) + '</td>' +
        '<td>' + pill(o.status) + '</td>' +
        '<td>' + dateFmt(o.date) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Aucune commande pour le moment.</td></tr>';

    out += '<div class="card"><div class="card-head"><h3>Dernières commandes</h3>' +
      '<button class="btn btn-sm btn-outline" data-go="orders">Tout voir</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Réf</th><th>Client</th><th>Total</th><th>Méthode</th><th>Statut</th><th>Date</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';

    $('content').innerHTML = out;
    $('qaNewProd').onclick = function () { openProductForm(null); };
    document.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () { switchView(b.getAttribute('data-go')); };
    });
  }

  function pill(st) {
    return '<span class="pill ' + (STATUS_PILLS[st] || 'gray') + '">' + esc(st) + '</span>';
  }

  function dateFmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- Products ---------------- */
  var prodSearchTimer = null;
  var prodKeepFocus = false;

  function renderProducts() {
    var q = state.productFilter.toLowerCase();
    var list = state.products.filter(function (p) {
      if (state.prodCat !== 'all' && p.category !== state.prodCat) return false;
      if (q && (p.name + ' ' + (p.description || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var catOpts = '<option value="all">Toutes les catégories</option>' + state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
    var rows = list.map(function (p) {
      var price = p.promoPrice != null && p.promoPrice !== '' ? '<span style="text-decoration:line-through;color:var(--muted)">' + fmt(p.price) + '</span> <b style="color:var(--danger)">' + fmt(p.promoPrice) + '</b>' : fmt(p.price);
      var dispo = p.available === false
        ? '<span class="pill red">Rupture</span>'
        : '<span class="pill green">Disponible</span>';
      return '<tr>' +
        '<td><img class="t-img" src="' + esc(p.image) + '" alt=""></td>' +
        '<td><b>' + esc(p.name) + '</b>' + (p.badge ? ' <span class="pill blue">' + esc(p.badge) + '</span>' : '') + '</td>' +
        '<td>' + esc(catName(p.category)) + '</td>' +
        '<td>' + (p.subcategory ? esc(subName(p.subcategory)) : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + price + '</td>' +
        '<td>' + dispo + '</td>' +
        '<td>' + (p.featured ? '⭐' : '') + '</td>' +
        '<td>' + (p.visible ? '<span class="pill green">Visible</span>' : '<span class="pill gray">Masqué</span>') + '</td>' +
        '<td class="t-actions">' +
          '<button class="btn btn-sm btn-outline" data-edit="' + p.id + '">✏️ Modifier</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">🗑️</button>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:30px">Aucun produit.</td></tr>';

    $('content').innerHTML =
      '<div class="toolbar">' +
          '<input class="search-input" id="prodSearch" placeholder="Rechercher un produit..." value="' + esc(state.productFilter) + '">' +
          '<select id="prodCatSel"><option>loading</option></select>' +
          '<button class="btn btn-primary" id="newProdBtn">? Nouveau produit</button>' +
          '<button class="btn btn-outline" id="manageDictBtn" data-go="settings">? Marques & saveurs</button>' +
        '</div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr>' +
        '<th></th><th>Nom</th><th>Catégorie</th><th>Sous-catégorie</th><th>Prix</th><th>Dispo</th><th>En avant</th><th>Visibilité</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    $('prodCatSel').outerHTML = '<select id="prodCatSel">' + catOpts + '</select>';
    $('prodCatSel').value = state.prodCat;
    $('prodCatSel').onchange = function () { state.prodCat = this.value; renderProducts(); };
    $('prodSearch').addEventListener('input', function () {
      state.productFilter = this.value;
      prodKeepFocus = true;
      clearTimeout(prodSearchTimer);
      prodSearchTimer = setTimeout(renderProducts, 250);
    });
    $('newProdBtn').onclick = function () { openProductForm(null); };
    var manageDictBtn = $('manageDictBtn');
    if (manageDictBtn) manageDictBtn.onclick = function () { switchView('settings'); setTimeout(function () { var c = $('dictCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); var b = $('dictBody'); var t = $('dictToggle'); if (b && b.classList.contains('hidden')) { b.classList.remove('hidden'); if (t) t.textContent = 'Masquer'; } }, 60); };
    document.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openProductForm(b.getAttribute('data-edit')); };
    });
    document.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-del');
        if (!confirm('Supprimer ce produit ?')) return;
        api('/api/admin/products/' + id, { method: 'DELETE' }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          toast('Produit supprimé');
          refreshAll();
        });
      };
    });

    if (prodKeepFocus) {
      prodKeepFocus = false;
      var pi = $('prodSearch');
      if (pi) {
        pi.focus();
        var pl = pi.value.length;
        pi.setSelectionRange(pl, pl);
      }
    }
  }

  function fillCatSelect() {
    $('p_category').innerHTML = state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
  }

  function fillSubSelect(catId) {
    var cat = state.categories.find(function (c) { return c.id === catId; });
    var subs = (cat && cat.subs) || [];
    var html = '<option value="">Aucune</option>';
    html += subs.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
    $('p_subcategory').innerHTML = html;
  }

  function openProductForm(id) {
    var p = id ? state.products.find(function (x) { return x.id === id; }) : null;
    $('prodTitle').textContent = p ? 'Modifier le produit' : 'Nouveau produit';
    $('p_id').value = p ? p.id : '';
    $('p_name').value = p ? p.name : '';
    $('p_badge').value = p ? p.badge || '' : '';
    $('p_price').value = p ? p.price : '';
    $('p_promoPrice').value = p && p.promoPrice != null ? p.promoPrice : '';
    $('p_available').value = p && p.available === false ? '0' : '1';
    $('p_rating').value = p ? p.rating || 0 : 0;
    $('p_reviews').value = p ? p.reviews || 0 : 0;
    $('p_image').value = p ? p.image : '';
    $('p_imageImg').src = p ? p.image : '';
    $('p_options').value = p && p.options && p.options.length ? p.options.join('\n') : '';
    $('p_description').value = p ? p.description || '' : '';
    $('p_featured').checked = p ? !!p.featured : false;
    $('p_visible').checked = p ? p.visible !== false : true;
    fillCatSelect();
    $('p_category').value = p ? p.category : (state.categories[0] ? state.categories[0].id : '');
    fillSubSelect($('p_category').value);
    $('p_subcategory').value = p ? p.subcategory || '' : '';
    renderFlavorChips(p);
    fillMarqueSelect(p);
    renderContenanceSelect(p);
    renderTauxChips(p);
    $('productModal').classList.remove('hidden');
    $('p_name').focus();
  }

  function splitFlav(f) {
    if (!f) return [];
    if (Array.isArray(f)) return f.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(f).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function renderFlavorChips(p) {
    var cur = splitFlav(p ? (p.flavor || (p.flavors && p.flavors.join(', ')) || '') : '');
    var base = state.dict.saveurs.slice();
    cur.forEach(function (f) { if (base.indexOf(f) === -1) base.push(f); });
    var box = $('p_flavorChips');
    box.innerHTML = base.length ? base.map(function (f) {
      return '<button type="button" class="chip' + (cur.indexOf(f) !== -1 ? ' on' : '') + '" data-f="' + esc(f) + '">' + esc(f) + '</button>';
    }).join('') : '<span class="muted-txt">Aucune saveur. Ajoutez-en ou gérez-les dans Réglages.</span>';
    box.querySelectorAll('[data-f]').forEach(function (b) {
      b.onclick = function () {
        var val = b.getAttribute('data-f');
        var hidden = $('p_flavors');
        var list = splitFlav(hidden.value);
        var i = list.indexOf(val);
        if (i === -1) list.push(val); else list.splice(i, 1);
        hidden.value = list.join(', ');
        renderFlavorChips({ flavor: list.join(', ') });
      };
    });
    $('p_flavors').value = cur.join(', ');
    $('p_flavorNew').value = '';
  }

  function fillMarqueSelect(p) {
    var cur = p ? String(p.marque || '').trim() : '';
    var opts = state.dict.marques.slice();
    if (cur && opts.indexOf(cur) === -1) opts.push(cur);
    $('p_marque').innerHTML = '<option value="">— Aucune marque —</option>' + opts.map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    $('p_marqueNew').value = '';
  }

  function addMarqueFromForm() {
    var input = $('p_marqueNew');
    var v = input.value.trim();
    if (!v) return toast('Tapez d\'abord le nom de la marque', true);
    var sel = $('p_marque');
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === v) { exists = true; break; }
    }
    if (!exists) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
    input.value = '';
    toast('Marque « ' + v + ' » choisie ✔');
  }

  function addFlavorFromForm() {
    var input = $('p_flavorNew');
    var v = input.value.trim();
    if (!v) return toast('Tapez d\'abord le nom de la saveur', true);
    var hidden = $('p_flavors');
    var list = splitFlav(hidden.value);
    if (list.indexOf(v) === -1) list.push(v);
    hidden.value = list.join(', ');
    renderFlavorChips({ flavor: list.join(', ') });
    toast('Saveur « ' + v + ' » ajoutée ✔');
  }

  function renderContenanceSelect(p) {
    var cur = p ? String(p.contenance || '').trim() : '';
    var opts = state.dict.contenances.slice();
    if (cur && opts.indexOf(cur) === -1) opts.push(cur);
    $('p_contenance').innerHTML = '<option value="">— Aucune —</option>' + opts.map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    $('p_contenanceNew').value = '';
  }

  function addContenanceFromForm() {
    var input = $('p_contenanceNew');
    var v = input.value.trim();
    if (!v) return toast('Tapez d\'abord la contenance', true);
    var sel = $('p_contenance');
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === v) { exists = true; break; }
    }
    if (!exists) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
    input.value = '';
    toast('Contenance « ' + v + ' » choisie ✔');
  }

  function renderTauxChips(p) {
    var cur = splitFlav(p ? (p.taux || '') : '');
    var base = state.dict.taux.slice();
    cur.forEach(function (f) { if (base.indexOf(f) === -1) base.push(f); });
    var box = $('p_tauxChips');
    box.innerHTML = base.length ? base.map(function (f) {
      return '<button type="button" class="chip' + (cur.indexOf(f) !== -1 ? ' on' : '') + '" data-t="' + esc(f) + '">' + esc(f) + '</button>';
    }).join('') : '<span class="muted-txt">Aucun taux.</span>';
    box.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () {
        var val = b.getAttribute('data-t');
        var hidden = $('p_taux');
        var list = splitFlav(hidden.value);
        var i = list.indexOf(val);
        if (i === -1) list.push(val); else list.splice(i, 1);
        hidden.value = list.join(', ');
        renderTauxChips({ taux: list.join(', ') });
      };
    });
    $('p_taux').value = cur.join(', ');
    $('p_tauxNew').value = '';
  }

  function addTauxFromForm() {
    var input = $('p_tauxNew');
    var v = input.value.trim();
    if (!v) return toast('Tapez d\'abord le taux', true);
    var hidden = $('p_taux');
    var list = splitFlav(hidden.value);
    if (list.indexOf(v) === -1) list.push(v);
    hidden.value = list.join(', ');
    renderTauxChips({ taux: list.join(', ') });
    toast('Taux « ' + v + ' » ajouté ✔');
  }

  function closeProductForm() {
    $('productModal').classList.add('hidden');
  }

  function saveProduct(e) {
    e.preventDefault();
    var id = $('p_id').value;
    var flavSel = [];
    document.querySelectorAll('#p_flavorChips .chip.on').forEach(function (c) {
      flavSel.push(c.getAttribute('data-f'));
    });
    $('p_flavors').value = flavSel.join(', ');
    var tauxSel = [];
    document.querySelectorAll('#p_tauxChips .chip.on').forEach(function (c) {
      tauxSel.push(c.getAttribute('data-t'));
    });
    $('p_taux').value = tauxSel.join(', ');
    var data = {
      name: $('p_name').value.trim(),
      category: $('p_category').value,
      subcategory: $('p_subcategory').value,
      flavor: flavSel.join(', '),
      marque: $('p_marque').value.trim(),
      contenance: $('p_contenance').value.trim(),
      taux: tauxSel.join(', '),
      badge: $('p_badge').value.trim(),
      price: $('p_price').value,
      promoPrice: $('p_promoPrice').value === '' ? null : $('p_promoPrice').value,
      available: $('p_available').value === '1',
      rating: $('p_rating').value,
      reviews: $('p_reviews').value,
      image: $('p_image').value.trim(),
      options: $('p_options').value,
      description: $('p_description').value,
      featured: $('p_featured').checked,
      visible: $('p_visible').checked
    };
    if (!data.name) return toast('Le nom du produit est requis', true);
    var url = id ? '/api/admin/products/' + id : '/api/admin/products';
    api(url, { method: id ? 'PUT' : 'POST', body: data }).then(function (res) {
      if (!res.ok) return toast(res.d.error || 'Erreur', true);
      if (res.d.dict) state.dict = res.d.dict;
      toast('Produit enregistré ✔');
      closeProductForm();
      refreshAll();
    });
  }

  $('productForm').addEventListener('submit', saveProduct);
  $('p_category').addEventListener('change', function () {
    fillSubSelect($('p_category').value);
    $('p_subcategory').value = '';
  });
  $('prodClose').onclick = closeProductForm;
  $('prodCancel').onclick = closeProductForm;
  $('p_marqueAdd').onclick = addMarqueFromForm;
  $('p_marqueNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addMarqueFromForm(); } });
  $('p_flavorAdd').onclick = addFlavorFromForm;
  $('p_flavorNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addFlavorFromForm(); } });
  $('p_contenanceAdd').onclick = addContenanceFromForm;
  $('p_contenanceNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addContenanceFromForm(); } });
  $('p_tauxAdd').onclick = addTauxFromForm;
  $('p_tauxNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addTauxFromForm(); } });
  bindUpload($('p_file'), $('p_image'), $('p_imageImg'));

  /* ---------------- Image upload ---------------- */
  function bindUpload(fileInput, urlInput, previewImg) {
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return toast('Image trop lourde (max 15 Mo)', true);
      var type = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.svg$/i.test(file.name) ? 'image/svg+xml' : 'image/jpeg');
      var isSvg = /svg/i.test(type);
      toast('Téléversement en cours…');
      var reader = new FileReader();
      reader.onerror = function () {
        toast('Impossible de lire le fichier (encore "en ligne" sur Google Drive ?). Téléchargez-le d\'abord sur le PC.', true);
      };
      reader.onload = function (ev) {
        var raw = ev.target.result;
        if (previewImg) previewImg.src = raw;
        if (isSvg) {
          sendUpload(file.name, raw, urlInput, previewImg);
          return;
        }
        var img = new Image();
        img.onerror = function () {
          toast('Format d\'image non reconnu par le navigateur.', true);
        };
        img.onload = function () {
          try {
            var max = 800;
            var w = img.width, h = img.height;
            if (!w || !h) { sendUpload(file.name, raw, urlInput, previewImg); return; }
            if (w <= max && h <= max && file.size <= 2.5 * 1024 * 1024) {
              sendUpload(file.name, raw, urlInput, previewImg);
              return;
            }
            var scale = Math.min(1, max / Math.max(w, h));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            var outType = /png/i.test(type) ? 'image/png' : 'image/jpeg';
            sendUpload(file.name.replace(/\.[^.]+$/, '') + (outType === 'image/png' ? '.png' : '.jpg'), canvas.toDataURL(outType, 0.8), urlInput, previewImg);
          } catch (err) {
            toast('Redimensionnement impossible, envoi de l\'image d\'origine…');
            sendUpload(file.name, raw, urlInput, previewImg);
          }
        };
        img.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }

function markImg(previewImg, url, ok) {
  if (!previewImg) return;
  var box = previewImg.closest('.img-preview');
  if (!box) return;
  box.classList.toggle('ok', ok);
  box.classList.toggle('err', !ok);
  var st = box.querySelector('.img-status');
  if (!st) {
    st = document.createElement('div');
    st.className = 'img-status';
    box.appendChild(st);
  }
  st.textContent = ok ? '✔ Image enregistrée : ' + url : '✖ Échec du téléversement';
}

function sendUpload(name, dataUrl, urlInput, previewImg) {
  api('/api/admin/upload', { method: 'POST', body: { name: name, data: dataUrl }, timeout: 45000 }).then(function (res) {
    if (!res.ok) {
      markImg(previewImg, '', false);
      return toast(res.d.error || 'Erreur image', true);
    }
    if (urlInput) urlInput.value = res.d.url;
    if (previewImg) previewImg.src = res.d.url;
    markImg(previewImg, res.d.url, true);
    toast('Image envoyée ✔');
  });
}

  /* ---------------- Categories ---------------- */
  function renderCategories() {
    var rows = state.categories.map(function (c, i) {
      var count = state.products.filter(function (p) { return p.category === c.id; }).length;
      return '<div class="cat-row">' +
        '<span>' + (i + 1) + '.</span>' +
        '<small style="flex:0 0 46px;height:40px;width:46px;border-radius:8px;overflow:hidden;background:#eef3f8;display:flex;align-items:center;justify-content:center">' +
        (c.image ? '<img style="width:100%;height:100%;object-fit:contain" src="' + esc(c.image) + '">' : '🗂️') + '</small>' +
        '<span class="name">' + esc(c.name) + '</span>' +
        '<span class="pill gray">' + count + ' produit(s)</span>' +
        '<div class="cat-actions">' +
          '<button class="arrow-btn" data-cup="' + c.id + '" data-cid="' + c.id + '" ' + (i === 0 ? 'disabled' : '') + ' title="Monter dans le menu">↑</button>' +
          '<button class="arrow-btn" data-cdown="' + c.id + '" data-cid="' + c.id + '" ' + (i === state.categories.length - 1 ? 'disabled' : '') + ' title="Descendre dans le menu">↓</button>' +
          '<button class="arrow-btn" data-cedit="' + c.id + '" title="Modifier">✏️</button>' +
          '<button class="arrow-btn" data-cdel="' + c.id + '" title="Supprimer">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join('') || '<p style="color:var(--muted)">Aucune catégorie.</p>';

    $('content').innerHTML =
      '<div class="cards"><div class="stat"><div class="num">' + state.categories.length + '</div><div class="lbl">Catégories</div></div></div>' +
      '<div class="card"><div class="card-head"><h3>Créer une catégorie</h3></div>' +
        '<form id="catForm" class="form-grid">' +
          '<div class="fspan2"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
            '<label style="flex:1;min-width:200px">Nom de la catégorie<input type="text" id="catName" required placeholder="Ex : E-liquides"></label>' +
            '<button type="submit" class="btn btn-primary">➕ Ajouter</button>' +
          '</div></div>' +
        '</form></div>' +
      '<div class="card"><h3>Catégories existantes</h3>' + rows + '</div>';

    $('catForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('catName').value.trim();
      if (!name) return;
      api('/api/admin/categories', { method: 'POST', body: { name: name } }).then(function (res) {
        if (!res.ok) return toast(res.d.error || 'Erreur', true);
        toast('Catégorie ajoutée ✔');
        refreshAll();
      });
    });
    document.querySelectorAll('[data-cedit]').forEach(function (b) {
      b.onclick = function () {
        openCatModal(b.getAttribute('data-cedit'));
      };
    });
    document.querySelectorAll('[data-cup]').forEach(moveCat(-1));
    document.querySelectorAll('[data-cdown]').forEach(moveCat(1));
    document.querySelectorAll('[data-cdel]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-cdel');
        if (!confirm('Supprimer cette catégorie ? Les produits qu\'elle contient conserveront leur catégorie.')) return;
        api('/api/admin/categories/' + id, { method: 'DELETE' }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          toast('Catégorie supprimée');
          refreshAll();
        });
      };
    });
  }

  function moveCat(dir) {
    return function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-cid');
        api('/api/admin/categories/order', { method: 'PUT', body: { id: id, dir: dir } }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          toast('Ordre mis à jour ✔');
          refreshAll();
        });
      };
    };
  }

  /* ---------------- Banners ---------------- */
  function renderBanners() {
    var banners = state.banners.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var rows = banners.map(function (b, i) {
      return '<div class="banner-card">' +
        '<div class="banner-thumb">' + (b.image ? '<img src="' + esc(b.image) + '" alt="">' : '<span style="color:var(--muted)">pas d\'image</span>') + '</div>' +
        '<div class="banner-info">' +
          '<div class="t">' + esc(b.title) + '</div>' +
          '<div class="s">' + esc(b.subtitle || '') + (b.buttonText ? ' · [' + esc(b.buttonText) + ']' : '') + '</div>' +
        '</div>' +
        '<div class="banner-actions">' +
          '<button class="arrow-btn" data-bup="' + b.id + '" data-bid="' + b.id + '" ' + (i === 0 ? 'disabled' : '') + ' title="Monter">↑</button>' +
          '<button class="arrow-btn" data-bdown="' + b.id + '" data-bid="' + b.id + '" ' + (i === banners.length - 1 ? 'disabled' : '') + ' title="Descendre">↓</button>' +
          '<button class="arrow-btn" data-bed="' + b.id + '" title="Modifier">✏️</button>' +
          '<button class="arrow-btn" data-bdel="' + b.id + '" title="Supprimer">🗑️</button>' +
        '</div>' +
      '</div>';
    }).join('') || '<div class="empty-note">Aucune banderole. Créez la première :</div>';

    $('content').innerHTML =
      '<div class="toolbar">' +
        '<button class="btn btn-primary" id="newBannerBtn">➕ Nouvelle banderole</button>' +
      '</div>' +
      '<div class="card" style="margin-top:16px"><h3>Banderoles de la page d\'accueil</h3>' +
        '<div style="margin-top:14px">' + rows + '</div>' +
        '<div class="empty-note" style="margin-top:10px">Astuce : plus la banderole est en haut de cette liste, plus elle apparaît en premier. Le carrousel défila automatiquement toutes les 5,5 s.</div>' +
      '</div>';

    $('newBannerBtn').onclick = function () { openBannerForm(null); };
    document.querySelectorAll('[data-bup]').forEach(moveBanner(-1));
    document.querySelectorAll('[data-bdown]').forEach(moveBanner(1));
    document.querySelectorAll('[data-bed]').forEach(function (b) {
      b.onclick = function () { openBannerForm(b.getAttribute('data-bed')); };
    });
    document.querySelectorAll('[data-bdel]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-bdel');
        if (!confirm('Supprimer cette banderole ?')) return;
        api('/api/admin/banners/' + id, { method: 'DELETE' }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          toast('Banderole supprimée');
          refreshAll();
        });
      };
    });
  }

  function moveBanner(dir) {
    return function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-bid');
        api('/api/admin/banners/order', { method: 'PUT', body: { id: id, dir: dir } }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          state.banners = res.d.banners || state.banners;
          renderBanners();
        });
      };
    };
  }

  function openBannerForm(id) {
    var b = id ? state.banners.find(function (x) { return x.id === id; }) : null;
    $('bannerTitle').textContent = b ? 'Modifier la banderole' : 'Nouvelle banderole';
    $('b_id').value = b ? b.id : '';
    $('b_title').value = b ? b.title : '';
    $('b_subtitle').value = b ? b.subtitle || '' : '';
    $('b_buttonText').value = b ? b.buttonText || '' : '';
    $('b_buttonLink').value = b ? b.buttonLink || '#products' : '#products';
    $('b_image').value = b ? (b.image || '') : '';
    $('b_imageImg').src = b && b.image ? b.image : '';
    $('bannerModal').classList.remove('hidden');
    $('b_title').focus();
  }

  function closeBannerForm() {
    $('bannerModal').classList.add('hidden');
  }

  $('bannerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('b_id').value;
    var data = {
      title: $('b_title').value.trim(),
      subtitle: $('b_subtitle').value.trim(),
      buttonText: $('b_buttonText').value.trim(),
      buttonLink: $('b_buttonLink').value.trim(),
      image: $('b_image').value.trim()
    };
    if (!data.title) return toast('Le titre est requis', true);
    var url = id ? '/api/admin/banners/' + id : '/api/admin/banners';
    api(url, { method: id ? 'PUT' : 'POST', body: data }).then(function (res) {
      if (!res.ok) return toast(res.d.error || 'Erreur', true);
      toast('Banderole enregistrée ✔');
      closeBannerForm();
      refreshAll();
    });
  });

  /* ---------------- Categories (subs) ---------------- */
  function renderSubsRows() {
    var cat = state.categories.find(function (c) { return c.id === catEditingId; });
    var subs = (cat && cat.subs) || [];
    var html = subs.length ? subs.map(function (s, i) {
      return '<div class="sub-row" data-id="' + esc(s.id) + '">' +
        '<button type="button" class="arrow-btn sub-move" data-dir="up" title="Monter" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button type="button" class="arrow-btn sub-move" data-dir="down" title="Descendre" ' + (i === subs.length - 1 ? 'disabled' : '') + '>↓</button>' +
        '<input class="sub-name" value="' + esc(s.name) + '" placeholder="Nom de la sous-catégorie">' +
        '<button type="button" class="sub-del" title="Retirer">✕</button>' +
      '</div>';
    }).join('') : '<div class="empty-note">Aucune sous-catégorie pour le moment.</div>';
    $('subsList').innerHTML = html;
    bindSubRowBtns();
  }

  function bindSubRowBtns() {
    document.querySelectorAll('.sub-del').forEach(function (b) {
      b.onclick = function () { b.closest('.sub-row').remove(); };
    });
    document.querySelectorAll('.sub-move').forEach(function (b) {
      b.onclick = function () {
        var row = b.closest('.sub-row');
        var p = row.parentNode;
        var dir = b.getAttribute('data-dir');
        if (dir === 'up') {
          if (row.previousElementSibling) p.insertBefore(row, row.previousElementSibling);
        } else {
          if (row.nextElementSibling) p.insertBefore(row.nextElementSibling, row);
        }
        bindSubRowBtns();
      };
    });
  }

  var catEditingId = null;

  function openCatModal(id) {
    var c = state.categories.find(function (x) { return x.id === id; });
    if (!c) return;
    catEditingId = id;
    $('c_id').value = c.id;
    $('c_name').value = c.name;
    renderSubsRows();
    $('catModal').classList.remove('hidden');
    $('c_name').focus();
  }

  $('addSubBtn').onclick = function () {
    var name = $('newSubName').value.trim();
    if (!name) { toast('Saisissez un nom', true); return; }
    var empty = document.querySelector('#subsList .empty-note');
    if (empty) empty.remove();
    var row = document.createElement('div');
    row.className = 'sub-row';
    row.innerHTML = '<button type="button" class="arrow-btn sub-move" data-dir="up" title="Monter">↑</button>' +
      '<button type="button" class="arrow-btn sub-move" data-dir="down" title="Descendre">↓</button>' +
      '<input class="sub-name" value="' + esc(name) + '" placeholder="Nom de la sous-catégorie">' +
      '<button type="button" class="sub-del" title="Retirer">✕</button>';
    $('subsList').appendChild(row);
    $('newSubName').value = '';
    bindSubRowBtns();
  };

  $('catEditForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('c_name').value.trim();
    if (!name) return toast('Le nom est requis', true);
    var subs = Array.prototype.map.call(document.querySelectorAll('#subsList .sub-row'), function (row, i) {
      var inp = row.querySelector('.sub-name');
      return { id: row.getAttribute('data-id') || '', name: inp.value.trim(), order: i + 1 };
    }).filter(function (x) { return x.name !== ''; });
    api('/api/admin/categories/' + catEditingId, { method: 'PUT', body: { name: name, subs: subs } }).then(function (res) {
      if (!res.ok) return toast(res.d.error || 'Erreur', true);
      toast('Catégorie enregistrée ✔');
      $('catModal').classList.add('hidden');
      refreshAll();
    });
  });

  $('catClose').onclick = function () { $('catModal').classList.add('hidden'); };
  $('catCancel').onclick = function () { $('catModal').classList.add('hidden'); };
  $('bannerClose').onclick = closeBannerForm;
  $('bannerCancel').onclick = closeBannerForm;
  bindUpload($('b_file'), $('b_image'), $('b_imageImg'));

  /* ---------------- Orders ---------------- */
  function renderOrders() {
    var list = state.orders;
    if (state.orderFilter !== 'all') list = list.filter(function (o) { return o.status === state.orderFilter; });
    var chips = '<button class="chip' + (state.orderFilter === 'all' ? ' on' : '') + '" data-of="all">Toutes (' + state.orders.length + ')</button>' +
      STATUSES.map(function (st) {
        var n = state.orders.filter(function (o) { return o.status === st; }).length;
        return '<button class="chip' + (state.orderFilter === st ? ' on' : '') + '" data-of="' + st + '">' + st + ' (' + n + ')</button>';
      }).join('');

    var rows = list.map(function (o) {
      var items = o.items.map(function (it) { return it.qty + 'x ' + it.name + (it.option ? ' (' + it.option + ')' : ''); }).join(', ');
      return '<tr>' +
        '<td><b>' + esc(o.ref) + '</b></td>' +
        '<td>' + esc(o.customer.name) + '<br><small style="color:var(--muted)">' + esc(o.customer.phone) + '</small></td>' +
        '<td>' + esc(items) + '</td>' +
        '<td>' + fmt(o.total) + '</td>' +
        '<td>' + (METHODS[o.method] || o.method) + '</td>' +
        '<td>' + pill(o.status) + '</td>' +
        '<td>' + dateFmt(o.date) + '</td>' +
        '<td class="t-actions">' +
          '<button class="btn btn-sm btn-outline" data-view-order="' + o.id + '">👁️</button>' +
          '<button class="btn btn-sm btn-danger" data-del-order="' + o.id + '">🗑️</button>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px">Aucune commande.</td></tr>';

    $('content').innerHTML =
      '<div class="chips">' + chips + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="table-wrap"><table><thead><tr>' +
        '<th>Réf</th><th>Client</th><th>Produits</th><th>Total</th><th>Méthode</th><th>Statut</th><th>Date</th><th>Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    document.querySelectorAll('[data-of]').forEach(function (c) {
      c.onclick = function () { state.orderFilter = c.getAttribute('data-of'); renderOrders(); };
    });
    document.querySelectorAll('[data-view-order]').forEach(function (b) {
      b.onclick = function () { openOrder(b.getAttribute('data-view-order')); };
    });
    document.querySelectorAll('[data-del-order]').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-del-order');
        if (!confirm('Supprimer définitivement cette commande ?')) return;
        api('/api/admin/orders/' + id, { method: 'DELETE' }).then(function (res) {
          if (!res.ok) return toast(res.d.error || 'Erreur', true);
          toast('Commande supprimée');
          refreshAll();
        });
      };
    });
  }

  function openOrder(id) {
    var o = state.orders.find(function (x) { return x.id === id; });
    if (!o) return;
    var items = (o.items || []).map(function (it) {
      return '<div class="oi"><span>' + it.qty + 'x ' + esc(it.name) + (it.option ? ' (' + esc(it.option) + ')' : '') + '</span><span>' + fmt(it.price * it.qty) + '</span></div>';
    }).join('');
    var opts = STATUSES.map(function (st) {
      return '<option' + (o.status === st ? ' selected' : '') + '>' + st + '</option>';
    }).join('');
    $('orderDetail').innerHTML =
      '<div class="order-detail">' +
        '<h3>Commande ' + esc(o.ref) + '</h3>' +
        '<p style="color:var(--muted)">Créée le ' + dateFmt(o.date) + '</p>' +
        '<div class="order-meta">' +
          '<div class="m"><div class="k">Client</div><div class="v">' + esc(o.customer.name) + '</div></div>' +
          '<div class="m"><div class="k">Téléphone</div><div class="v">' + esc(o.customer.phone) + '</div></div>' +
          (o.customer.email ? '<div class="m"><div class="k">Email</div><div class="v">' + esc(o.customer.email) + '</div></div>' : '') +
          '<div class="m"><div class="k">Méthode</div><div class="v">' + (METHODS[o.method] || o.method) + '</div></div>' +
          (o.customer.address ? '<div class="m"><div class="k">Adresse</div><div class="v">' + esc(o.customer.address) + '</div></div>' : '') +
          '<div class="m"><div class="k">Statut</div><div class="v"><select class="status-select" id="statusSel">' + opts + '</select></div></div>' +
        '</div>' +
        '<div class="order-items">' + items + '</div>' +
        '<div class="order-total"><span>Total</span><span>' + fmt(o.total) + '</span></div>' +
        (o.note ? '<div class="order-note">📝 ' + esc(o.note) + '</div>' : '') +
        '<div class="form-actions" style="margin-top:18px">' +
          (o.whatsappLink ? '<a class="btn btn-outline" href="' + esc(o.whatsappLink) + '" target="_blank" rel="noopener">💬 Suivre sur WhatsApp</a>' : '') +
          '<button class="btn btn-primary" id="saveStatus">💾 Enregistrer le statut</button>' +
        '</div>' +
      '</div>';
    $('orderModal').classList.remove('hidden');
    $('saveStatus').onclick = function () {
      api('/api/admin/orders/' + o.id, { method: 'PUT', body: { status: $('statusSel').value } }).then(function (res) {
        if (!res.ok) return toast(res.d.error || 'Erreur', true);
        toast('Statut mis à jour ✔');
        $('orderModal').classList.add('hidden');
        refreshAll();
      });
    };
  }
  $('orderClose').onclick = function () { $('orderModal').classList.add('hidden'); };
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) {
      if (e.target === m) m.classList.add('hidden');
    });
  });

  /* ---------------- Settings ---------------- */
  function renderSettings() {
    var s = state.settings;
    var trust = (s.trustItems && s.trustItems.length ? s.trustItems : [{}, {}, {}]).map(function (t, i) {
      return '<div class="form-grid f3">' +
        '<label>Icône<input type="text" class="s-trust-icon" value="' + esc(t.icon || '') + '" placeholder="Ex : 🛡️"></label>' +
        '<label>Titre<input type="text" class="s-trust-title" value="' + esc(t.title || '') + '" placeholder="Qualité garantie"></label>' +
        '<label>Texte<input type="text" class="s-trust-text" value="' + esc(t.text || '') + '" placeholder="Descriptif court"></label>' +
      '</div>';
    }).join('');

    $('content').innerHTML =
      '<div class="settings-sec">' +
      '<div class="card"><h3>🏪 Informations de la boutique</h3><div class="form-grid">' +
        '<label>Nom du site<input type="text" class="s" data-k="storeName" value="' + esc(s.storeName) + '"></label>' +
        '<label>Slogan<input type="text" class="s" data-k="tagline" value="' + esc(s.tagline) + '"></label>' +
        '<label>Texte du logo<input type="text" class="s" data-k="logoText" value="' + esc(s.logoText) + '"><div class="small">Texte affiché à la place de l\'image</div></label>' +
        '<div class="fspan2"><label>Logo / image de la marque' +
          '<div class="img-row"><div class="img-preview"><img id="brandPrev" src="' + esc(s.logoImage) + '"></div>' +
          '<div class="img-controls"><input type="file" id="brandFile" accept="image/*"><input type="text" class="s" data-k="logoImage" id="brandUrl" value="' + esc(s.logoImage) + '"></div></div>' +
          '<div class="small">La photo s\'affiche à côté du nom du site en haut de la boutique.</div></label></div>' +
        '<label>Bandeau annonce<input type="text" class="s" data-k="announcement" value="' + esc(s.announcement) + '"></label>' +
        '<label class="check"><input type="checkbox" class="s" data-k="announcementEnabled"' + (s.announcementEnabled ? ' checked' : '') + '> Afficher le bandeau</label>' +
        '<label>Devise (libellé)<input type="text" class="s" data-k="currency" value="' + esc(s.currency) + '"></label>' +
        '<label>Position de la devise<select class="s" data-k="currencyPosition">' +
          '<option value="after"' + (s.currencyPosition === 'after' ? ' selected' : '') + '>Après le prix (25 000 Ar)</option>' +
          '<option value="before"' + (s.currencyPosition === 'before' ? ' selected' : '') + '>Avant le prix (Ar 25 000)</option>' +
        '</select></label>' +
      '</div><div class="form-actions"><button class="btn btn-primary btn-save-sec" data-sec="shop">💾 Enregistrer la section</button></div></div>' +

      '<div class="card"><h3>💬 Contact & WhatsApp</h3><div class="grid2">' +
        '<label>Numéro WhatsApp (pour les commandes)<input type="text" class="s" data-k="whatsapp" value="' + esc(s.whatsapp) + '"><div class="small">Format international sans + ex : 261340000000</div></label>' +
        '<label>Numéro affiché<input type="text" class="s" data-k="whatsappDisplay" value="' + esc(s.whatsappDisplay) + '"></label>' +
        '<label>Téléphone<input type="text" class="s" data-k="phone" value="' + esc(s.phone) + '"></label>' +
        '<label>Email<input type="text" class="s" data-k="email" value="' + esc(s.email) + '"></label>' +
        '<label>Adresse du magasin<input type="text" class="s" data-k="address" value="' + esc(s.address) + '"></label>' +
        '<label>Horaires<input type="text" class="s" data-k="hours" value="' + esc(s.hours) + '"></label>' +
        '<label>Lien Google Maps<input type="text" class="s" data-k="mapLink" value="' + esc(s.mapLink) + '"><div class="small">Lien vers votre position sur Google Maps</div></label>' +
        '<label>Facebook<div class="color-row" style="justify-content:flex-start"><input type="text" class="s" data-k="facebook" value="' + esc(s.facebook) + '" placeholder="URL"></div></label>' +
        '<label>Instagram<div class="color-row" style="justify-content:flex-start"><input type="text" class="s" data-k="instagram" value="' + esc(s.instagram) + '" placeholder="URL"></div></label>' +
      '</div><div class="form-actions"><button class="btn btn-primary btn-save-sec" data-sec="contact">💾 Enregistrer la section</button></div></div>' +

      '<div class="card"><h3>🖼️ Page d\'accueil</h3><div class="form-grid">' +
        '<label>Titre principal (hero)<input type="text" class="s" data-k="heroTitle" value="' + esc(s.heroTitle) + '"></label>' +
        '<label>Sous-titre<input type="text" class="s" data-k="heroSubtitle" value="' + esc(s.heroSubtitle) + '"></label>' +
        '<label>Texte du bouton<input type="text" class="s" data-k="heroBtnText" value="' + esc(s.heroBtnText) + '"></label>' +
        '<label>Lien du bouton<input type="text" class="s" data-k="heroBtnLink" value="' + esc(s.heroBtnLink) + '"><div class="small">#products ou une URL</div></label>' +
        '<div class="fspan2"><label>Image de fond du haut de page' +
          '<div class="img-row"><div class="img-preview"><img id="heroPrev" src="' + esc(s.heroImage) + '"></div>' +
          '<div class="img-controls"><input type="file" id="heroFile" accept="image/*"><input type="text" class="s" data-k="heroImage" id="heroUrl" value="' + esc(s.heroImage) + '"></div></div></label></div>' +
        '<label>Titre "À propos"<input type="text" class="s" data-k="aboutTitle" value="' + esc(s.aboutTitle) + '"></label>' +
        '<label>Texte "À propos"<textarea class="s" data-k="aboutText">' + esc(s.aboutText) + '</textarea></label>' +
        '<div class="fspan2"><label>3 blocs de confiance (qualité, livraison...)</label>' + trust + '</div>' +
      '</div><div class="form-actions"><button class="btn btn-primary btn-save-sec" data-sec="home">💾 Enregistrer la section</button></div></div>' +

      '<div class="card"><h3>🎨 Apparence</h3><div class="form-grid">' +
        '<label>Couleur principale<div class="color-row"><input type="color" class="s" data-k="primaryColor" value="' + esc(s.primaryColor) + '"><span id="colorVal">' + esc(s.primaryColor) + '</span></div></label>' +
        '<label class="check" style="align-self:flex-end"><input type="checkbox" class="s" data-k="ageGateEnabled"' + (s.ageGateEnabled ? ' checked' : '') + '> Afficher la page "18 ans et plus"</label>' +
        '<div class="fspan2"><label>CSS personnalisé (avancé)<textarea class="s mono" data-k="customCss" style="min-height:120px;font-family:monospace">' + esc(s.customCss) + '</textarea><div class="small">Pour les utilisateurs avancés. Ici vous pouvez tout transformer.</div></label></div>' +
      '</div><div class="form-actions"><button class="btn btn-primary btn-save-sec" data-sec="appearance">💾 Enregistrer la section</button></div></div>' +

      '<div class="card"><h3>💳 Moyens de paiement (affichés en bas de page)</h3>' +
        '<div class="grid2">' +
          '<label class="check"><input type="checkbox" class="s" data-k="payMvola"' + (s.payMvola !== false ? ' checked' : '') + '> <span class="pay-logo pay-mvola">MVola</span> MVola</label>' +
          '<label class="check"><input type="checkbox" class="s" data-k="payOrange"' + (s.payOrange !== false ? ' checked' : '') + '> <span class="pay-logo pay-orange">Orange Money</span> Orange Money</label>' +
          '<label class="check"><input type="checkbox" class="s" data-k="payLivraison"' + (s.payLivraison !== false ? ' checked' : '') + '> <span class="pay-logo pay-cash">Paiement à la livraison</span> Paiement à la livraison</label>' +
        '</div>' +
      '<div class="form-actions"><button class="btn btn-primary btn-save-sec" data-sec="payment">💾 Enregistrer les moyens de paiement</button></div></div>' +

      '<div class="card" id="dictCard"><div class="coll-head"><h3>🌶 Saveurs & 🏷 Marques</h3><button type="button" class="btn btn-outline btn-coll" id="dictToggle">Afficher / modifier</button></div>' +
        '<div class="coll-body hidden" id="dictBody">' +
        '<div class="grid2">' +
          '<div>' +
            '<label>Saveurs disponibles <span class="small">(cliquables dans les produits)</span></label>' +
            '<div id="dictSaveurSearch" class="dict-search"><input type="text" placeholder="Rechercher une saveur..." data-dictsearch="saveurs"></div>' +
            '<div id="dictSaveurs" class="tag-cluster"></div>' +
            '<div class="addrow"><input type="text" id="dictSaveurNew" placeholder="Nouvelle saveur…">' +
            '<button type="button" class="btn btn-ghost" id="dictSaveurAdd">＋ Ajouter</button></div>' +
          '</div>' +
          '<div>' +
            '<label>Marques disponibles</label>' +
            '<div id="dictMarqueSearch" class="dict-search"><input type="text" placeholder="Rechercher une marque..." data-dictsearch="marques"></div>' +
            '<div id="dictMarques" class="tag-cluster"></div>' +
            '<div class="addrow"><input type="text" id="dictMarqueNew" placeholder="Nouvelle marque…">' +
            '<button type="button" class="btn btn-ghost" id="dictMarqueAdd">＋ Ajouter</button></div>' +
          '</div>' +
          '<div>' +
            '<label>Contenances disponibles <span class="small">(10 ml, 30 ml…)</span></label>' +
            '<div id="dictContenances" class="tag-cluster"></div>' +
            '<div class="addrow"><input type="text" id="dictContenNew" placeholder="Ex : 10 ml">' +
            '<button type="button" class="btn btn-ghost" id="dictContenAdd">＋ Ajouter</button></div>' +
          '</div>' +
          '<div>' +
            '<label>Taux de nicotine disponibles <span class="small">(0 mg, 3 mg…)</span></label>' +
            '<div id="dictTaux" class="tag-cluster"></div>' +
            '<div class="addrow"><input type="text" id="dictTauxNew" placeholder="Ex : 3 mg">' +
            '<button type="button" class="btn btn-ghost" id="dictTauxAdd">＋ Ajouter</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="form-actions"><button class="btn btn-primary" id="btnSaveDict">💾 Enregistrer les saveurs & marques</button></div>' +
        '<div class="small">Si vous supprimez une saveur ou une marque, les produits qui en portaient une garderont quand même leur étiquette sur la boutique.</div>' +
        '</div>' +
      '</div>' +

      '<div class="card"><h3>🔒 Sécurité</h3><div class="form-grid">' +
        '<label>Mot de passe actuel<input type="password" id="curPw"></label>' +
        '<label>Nouveau mot de passe<input type="password" id="newPw"></label>' +
        '<label>Confirmer le nouveau mot de passe<input type="password" id="newPw2"></label>' +
      '</div><div class="form-actions"><button class="btn btn-primary" id="btnPw">🔑 Changer le mot de passe</button></div>' +
      '<div class="small" style="margin-top:10px">Mot de passe actuel : <b>' + esc(s.adminPassword) + '</b></div></div>' +
      '</div>';

    /* bind color preview */
    var colorInput = document.querySelector('[data-k="primaryColor"]');
    if (colorInput) {
      colorInput.addEventListener('input', function () {
        $('colorVal').textContent = colorInput.value;
      });
    }

    bindUpload($('heroFile'), $('heroUrl'), $('heroPrev'));
    bindUpload($('brandFile'), $('brandUrl'), $('brandPrev'));

    renderDictChips('dictSaveurs', state.dict.saveurs);
    renderDictChips('dictMarques', state.dict.marques);
    renderDictChips('dictContenances', state.dict.contenances);
    renderDictChips('dictTaux', state.dict.taux);
    var dictToggle = $('dictToggle'), dictBody = $('dictBody');
    if (dictToggle && dictBody) dictToggle.onclick = function () {
      var hiddenNow = dictBody.classList.contains('hidden');
      dictBody.classList.toggle('hidden', !hiddenNow);
      dictToggle.textContent = hiddenNow ? 'Masquer' : 'Afficher / modifier';
    };
    $('dictSaveurAdd').onclick = function () { addDictItem('saveur'); };
    $('dictMarqueAdd').onclick = function () { addDictItem('marque'); };
    $('dictContenAdd').onclick = function () { addDictItem('contenance'); };
    $('dictTauxAdd').onclick = function () { addDictItem('taux'); };
    $('dictSaveurNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addDictItem('saveur'); } });
    $('dictMarqueNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addDictItem('marque'); } });
    $('dictContenNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addDictItem('contenance'); } });
    $('dictTauxNew').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addDictItem('taux'); } });
    var dictSearchMap = { saveurs: 'dictSaveurs', marques: 'dictMarques' };
    document.querySelectorAll('.dict-search input[data-dictsearch]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        renderDictChips(dictSearchMap[inp.getAttribute('data-dictsearch')], state.dict[inp.getAttribute('data-dictsearch')]);
      });
    });
    $('btnSaveDict').onclick = function () {
      api('/api/admin/dict', { method: 'POST', body: { saveurs: state.dict.saveurs, marques: state.dict.marques, contenances: state.dict.contenances, taux: state.dict.taux } }).then(function (res) {
        if (!res.ok) return toast(res.d.error || 'Erreur', true);
        toast('Saveurs & marques enregistrées ✔');
        refreshAll();
      });
    };

    document.querySelectorAll('.btn-save-sec').forEach(function (btn) {
      btn.onclick = function () { saveSettingsSection(btn.getAttribute('data-sec')); };
    });

    $('btnPw').onclick = function () {
      var cur = $('curPw').value;
      var n1 = $('newPw').value;
      var n2 = $('newPw2').value;
      if (!cur || !n1) return toast('Renseignez le mot de passe actuel et le nouveau', true);
      if (n1 !== n2) return toast('Les nouveaux mots de passe ne correspondent pas', true);
      if (n1.length < 4) return toast('Le nouveau mot de passe est trop court', true);
      api('/api/admin/settings', { method: 'PUT', body: { currentPassword: cur, newPassword: n1 } }).then(function (res) {
        if (!res.ok) return toast(res.d.error || 'Erreur', true);
        toast('Mot de passe changé ✔');
        refreshAll();
      });
    };
  }

  function renderDictChips(boxId, arr) {
    var box = $(boxId);
    var map = { dictSaveurs: 'saveur', dictMarques: 'marque', dictContenances: 'contenance', dictTaux: 'taux' };
    var searchMap = { dictSaveurs: 'dictSaveurSearch', dictMarques: 'dictMarqueSearch' };
    var type = map[boxId] || 'saveur';
    var arrKey = { saveur: 'saveurs', marque: 'marques', contenance: 'contenances', taux: 'taux' }[type];
    var filter = '';
    var searchId = searchMap[boxId];
    var sEl = searchId ? $(searchId) : null;
    var sInput = sEl ? sEl.querySelector('input[data-dictsearch]') : null;
    if (sInput) filter = sInput.value.trim().toLowerCase();
    var list = arr;
    if (filter) list = arr.filter(function (v) { return v.toLowerCase().indexOf(filter) !== -1; });
    box.innerHTML = list.length ? list.map(function (v) {
      return '<span class="tag"><span>' + esc(v) + '</span><button type="button" class="tag-x" data-type="' + type + '" data-value="' + esc(v) + '" title="Retirer">✕</button></span>';
    }).join('') : (filter ? '<span class="muted-txt">Aucun résultat</span>' : '<span class="muted-txt">Liste vide</span>');
    box.querySelectorAll('.tag-x').forEach(function (b) {
      b.onclick = function () {
        var v = b.getAttribute('data-value');
        var target = state.dict[arrKey];
        target.splice(target.indexOf(v), 1);
        renderDictChips(boxId, target);
      };
    });
  }

  function addDictItem(kind) {
    var ids = {
      saveur: ['dictSaveurNew', 'dictSaveurs'],
      marque: ['dictMarqueNew', 'dictMarques'],
      contenance: ['dictContenNew', 'dictContenances'],
      taux: ['dictTauxNew', 'dictTaux']
    }[kind];
    if (!ids) return;
    var input = $(ids[0]);
    var v = input.value.trim();
    if (!v) return toast('Tapez d\'abord le nom', true);
    var arrKey = { saveur: 'saveurs', marque: 'marques', contenance: 'contenances', taux: 'taux' }[kind];
    var arr = state.dict[arrKey];
    var found = arr.some(function (x) { return x.toLowerCase() === v.toLowerCase(); });
    if (!found) arr.push(v);
    renderDictChips(ids[1], arr);
    input.value = '';
  }

  function collectSection(sec) {
    var pick = {
      shop: ['storeName', 'tagline', 'logoText', 'logoImage', 'announcement', 'announcementEnabled', 'currency', 'currencyPosition'],
      contact: ['whatsapp', 'whatsappDisplay', 'phone', 'email', 'address', 'hours', 'mapLink', 'facebook', 'instagram'],
      home: ['heroTitle', 'heroSubtitle', 'heroBtnText', 'heroBtnLink', 'heroImage', 'aboutTitle', 'aboutText'],
      appearance: ['primaryColor', 'ageGateEnabled', 'customCss'],
      payment: ['payMvola', 'payOrange', 'payLivraison']
    };
    var keys = pick[sec] || [];
    var out = {};
    keys.forEach(function (k) {
      var el = document.querySelector('.s[data-k="' + k + '"]');
      if (!el) return;
      if (el.type === 'checkbox') out[k] = el.checked;
      else out[k] = el.value;
    });
    if (sec === 'home') {
      var items = [];
      document.querySelectorAll('.s-trust-icon').forEach(function (el, i) {
        items.push({
          icon: el.value,
          title: document.querySelectorAll('.s-trust-title')[i].value,
          text: document.querySelectorAll('.s-trust-text')[i].value
        });
      });
      out.trustItems = items;
    }
    return out;
  }

  function saveSettingsSection(sec) {
    api('/api/admin/settings', { method: 'PUT', body: { newSettings: collectSection(sec) } }).then(function (res) {
      if (!res.ok) return toast(res.d.error || 'Erreur', true);
      toast('Section enregistrée ✔');
      refreshAll();
    });
  }

  /* ---------------- Start ---------------- */
  boot();
})();