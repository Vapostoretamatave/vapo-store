const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const LOCAL_DATA_DIR = path.join(ROOT, 'data');
const LOCAL_UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const DATA_DIR = process.env.DATA_DIR || LOCAL_DATA_DIR;
const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(ROOT, 'admin');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PUBLIC_DIR, 'uploads');
const PORT = process.env.PORT || 3000;
const MAX_BODY = 30 * 1024 * 1024;

for (const d of [DATA_DIR, PUBLIC_DIR, ADMIN_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// En production (DATA_DIR != local), on amène la base existante sur le disque
// persistant au premier démarrage pour ne pas repartir vide.
if (DATA_DIR !== LOCAL_DATA_DIR) {
  try {
    if (!fs.existsSync(path.join(DATA_DIR, 'settings.json'))) {
      if (fs.existsSync(LOCAL_DATA_DIR)) {
        fs.readdirSync(LOCAL_DATA_DIR).forEach((f) => {
          const src = path.join(LOCAL_DATA_DIR, f);
          if (fs.statSync(src).isFile()) {
            fs.copyFileSync(src, path.join(DATA_DIR, f));
          }
        });
      }
      if (fs.existsSync(LOCAL_UPLOAD_DIR) && UPLOAD_DIR !== LOCAL_UPLOAD_DIR) {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        fs.readdirSync(LOCAL_UPLOAD_DIR).forEach((f) => {
          const src = path.join(LOCAL_UPLOAD_DIR, f);
          if (fs.statSync(src).isFile() && !fs.existsSync(path.join(UPLOAD_DIR, f))) {
            fs.copyFileSync(src, path.join(UPLOAD_DIR, f));
          }
        });
      }
    }
  } catch (e) {
    console.error('seed err', e);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function readData(name, fallback) {
  const p = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeData(name, value) {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2));
}

function getSettings() {
  return readData('settings.json', {
    adminPassword: 'vapostore2026',
    lastOrderNumber: 0
  });
}

function getDict() {
  return readData('dict.json', { saveurs: [], marques: [], contenances: [], taux: [] });
}

function addToDict(keys) {
  const dict = getDict();
  const merge = (field, vals) => {
    const seen = new Set();
    const base = (dict[field] || []).map((x) => String(x).trim()).filter(Boolean);
    base.forEach((x) => seen.add(x.toLowerCase()));
    (Array.isArray(vals) ? vals : []).forEach((v) => {
      const s = String(v == null ? '' : v).trim();
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); base.push(s); }
    });
    return base;
  };
  dict.saveurs = merge('saveurs', keys.saveurs);
  dict.marques = merge('marques', keys.marques);
  dict.contenances = merge('contenances', keys.contenances);
  writeData('dict.json', dict);
  return dict;
}

function publicSettings(s) {
  const copy = Object.assign({}, s);
  delete copy.adminPassword;
  return copy;
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Corps de requete trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJSON(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

const TOKENS = new Map();
const LOGIN_ATTEMPTS = new Map();

function isAuthed(req) {
  const h = req.headers['authorization'] || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  const s = TOKENS.get(token);
  if (!s || s.exp < Date.now()) {
    if (s) TOKENS.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  sendJSON(res, 401, { error: 'Non autorise' });
  return false;
}

async function serveStatic(rootDir, pathname, res) {
  let rel = pathname || '/';
  if (rel === '/' || rel === '') rel = '/index.html';
  let filePath = path.normalize(path.join(rootDir, path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '')));
  if (!filePath.startsWith(rootDir)) {
    sendJSON(res, 403, { error: 'Interdit' });
    return;
  }
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath)) {
        sendJSON(res, 404, { error: 'Introuvable' });
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    sendJSON(res, 404, { error: 'Introuvable' });
  }
}

function methodLabel(m) {
  if (m === 'pickup') return 'Retrait en magasin';
  if (m === 'delivery') return 'Livraison';
  return 'Commande WhatsApp';
}

function formatPrice(n, s) {
  const num = Number(n || 0);
  const str = num.toLocaleString('fr-FR');
  return s.currencyPosition === 'before' ? s.currency + ' ' + str : str + ' ' + s.currency;
}

function buildWhatsAppMessage(order, s) {
  const lines = order.items.map((it) => {
    let parts = ['• ' + it.qty + 'x ' + it.name];
    if (it.option) parts.push('(' + it.option + ')');
    parts.push('= ' + formatPrice(it.price * it.qty, s));
    return parts.join(' ');
  });
  const nom = order.customer.name || '';
  const tel = order.customer.phone || '';
  const note = order.note ? '\n📝 Note : ' + order.note : '';
  const adr = order.customer.address ? '\n📍 Adresse : ' + order.customer.address : '';
  return [
    '🛒 *NOUVELLE COMMANDE ' + order.ref + '*',
    '',
    '👤 Nom : ' + nom,
    '📞 Telephone : ' + tel,
    '🏪 Methode : ' + methodLabel(order.method),
    adr,
    '',
    '----------------------',
    lines.join('\n'),
    '----------------------',
    '💰 *TOTAL : ' + formatPrice(order.total, s) + '*',
    order.method === 'delivery' ? '\n🚚 Frais de livraison a confirmer par WhatsApp selon votre quartier.' : '',
    note,
    '',
    'Merci !'
  ].filter(Boolean).join('\n');
}

function buildWhatsAppLink(order, s) {
  const msg = buildWhatsAppMessage(order, s);
  return 'https://wa.me/' + (s.whatsapp || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(msg);
}

const like = (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase());

function sortCats(cats) {
  return (cats || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((c) => Object.assign({}, c, {
      subs: (c.subs || []).slice().sort((x, y) => (x.order || 0) - (y.order || 0))
    }));
}

function reorderList(list, ids, id, dir) {
  let order;
  if (Array.isArray(ids) && ids.length) {
    order = ids.slice();
  } else if (id && dir) {
    order = list.map((x) => x.id);
    const i = order.indexOf(id);
    const j = i + Number(dir);
    if (i === -1 || j < 0 || j >= order.length) return list;
    order.splice(i, 1);
    order.splice(j, 0, id);
  } else {
    return list;
  }
  const sorted = [];
  order.forEach((oid, i) => {
    const item = list.find((x) => x.id === oid);
    if (item) { item.order = i + 1; sorted.push(item); }
  });
  list.forEach((item) => {
    if (!sorted.find((x) => x.id === item.id)) sorted.push(item);
  });
  sorted.forEach((item, i) => { item.order = i + 1; });
  return sorted;
}

async function handleApi(req, res, pathname) {
  const m = req.method;
  try {
    if (m === 'GET' && pathname === '/api/store') {
      const s = getSettings();
      return sendJSON(res, 200, {
        settings: publicSettings(s),
        categories: sortCats(readData('categories.json', [])),
        products: readData('products.json', []),
        banners: readData('banners.json', [])
      });
    }

    if (m === 'POST' && pathname === '/api/order') {
      const body = await parseJSON(req);
      const s = getSettings();
      const products = readData('products.json', []);
      const name = String(body.name || '').trim();
      const phone = String(body.phone || '').trim();
      if (!name || !phone) return sendJSON(res, 400, { error: 'Nom et telephone requis' });
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendJSON(res, 400, { error: 'Panier vide' });
      const lines = [];
      for (const it of items) {
        const p = products.find((x) => x.id === it.productId);
        if (!p) return sendJSON(res, 400, { error: 'Produit introuvable dans le panier' });
        if (p.available === false) return sendJSON(res, 400, { error: 'Produit en rupture de stock : ' + p.name });
        const uprice = p.promoPrice != null && p.promoPrice !== '' ? Number(p.promoPrice) : Number(p.price);
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        lines.push({
          name: p.name,
          option: String(it.option || ''),
          price: uprice,
          qty: qty,
          image: p.image || ''
        });
      }
      const total = lines.reduce((acc, x) => acc + x.price * x.qty, 0);
      s.lastOrderNumber = (s.lastOrderNumber || 0) + 1;
      writeData('settings.json', s);
      const ref = 'CMD-' + String(s.lastOrderNumber).padStart(4, '0');
      const method = ['whatsapp', 'pickup', 'delivery'].includes(body.method) ? body.method : 'whatsapp';
      const order = {
        id: crypto.randomUUID(),
        ref: ref,
        date: new Date().toISOString(),
        customer: {
          name: name,
          phone: phone,
          email: String(body.email || '').trim(),
          address: String(body.address || '').trim()
        },
        method: method,
        note: String(body.note || '').trim(),
        items: lines,
        total: total,
        status: 'Nouvelle'
      };
      order.whatsappLink = buildWhatsAppLink(order, s);
      const orders = readData('orders.json', []);
      orders.unshift(order);
      writeData('orders.json', orders);
      return sendJSON(res, 200, { ref: ref, whatsappLink: order.whatsappLink, order: order });
    }

    if (m === 'POST' && pathname === '/api/admin/login') {
      const ip = req.socket.remoteAddress || '?';
      const a = LOGIN_ATTEMPTS.get(ip) || { n: 0, until: 0 };
      if (a.until > Date.now()) {
        return sendJSON(res, 429, { error: "Trop d'essais. Reessayez dans 30 secondes." });
      }
      const body = await parseJSON(req);
      const s = getSettings();
      if (body.password && body.password === s.adminPassword) {
        a.n = 0;
        a.until = 0;
        LOGIN_ATTEMPTS.set(ip, a);
        const token = crypto.randomBytes(24).toString('hex');
        TOKENS.set(token, { exp: Date.now() + 3 * 3600 * 1000 });
        return sendJSON(res, 200, { token: token });
      }
      a.n++;
      if (a.n >= 5) {
        a.until = Date.now() + 30000;
        a.n = 0;
      }
      LOGIN_ATTEMPTS.set(ip, a);
      return sendJSON(res, 401, { error: 'Mot de passe incorrect' });
    }

    if (pathname.startsWith('/api/admin')) {
      if (!requireAuth(req, res)) return;

      if (m === 'GET' && pathname === '/api/admin/check') return sendJSON(res, 200, { ok: true });

      if (m === 'GET' && pathname === '/api/admin/data') {
        return sendJSON(res, 200, {
          settings: getSettings(),
          categories: sortCats(readData('categories.json', [])),
          products: readData('products.json', []),
          orders: readData('orders.json', []),
          banners: readData('banners.json', []),
          dict: getDict()
        });
      }

      if (m === 'PUT' && pathname === '/api/admin/settings') {
        const body = await parseJSON(req);
        const cur = getSettings();
        const next = Object.assign({}, cur, body.newSettings || {});
        if (body.newPassword) {
          if (!body.currentPassword || body.currentPassword !== cur.adminPassword) {
            return sendJSON(res, 400, { error: 'Mot de passe actuel incorrect' });
          }
        }
        if (body.newPassword) next.adminPassword = body.newPassword;
        next.lastOrderNumber = cur.lastOrderNumber || 0;
        writeData('settings.json', next);
        return sendJSON(res, 200, { ok: true, settings: next });
      }

      if (m === 'POST' && pathname === '/api/admin/dict') {
        const body = await parseJSON(req);
        const clean = (arr) => {
          const seen = new Set();
          return (Array.isArray(arr) ? arr : [])
            .map((x) => String(x || '').trim())
            .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
        };
        const dict = {
          saveurs: clean(body.saveurs),
          marques: clean(body.marques),
          contenances: clean(body.contenances),
          taux: clean(body.taux)
        };
        writeData('dict.json', dict);
        return sendJSON(res, 200, { ok: true, dict: dict });
      }

      if (m === 'POST' && pathname === '/api/admin/products') {
        const body = await parseJSON(req);
        const products = readData('products.json', []);
        const prod = normalizeProduct(Object.assign({}, body, { id: crypto.randomUUID() }));
        products.unshift(prod);
        writeData('products.json', products);
        const dict = addToDict({
          marques: [prod.marque],
          saveurs: String(prod.flavor || '').split(',').map((x) => x.trim()),
          contenances: [prod.contenance]
        });
        return sendJSON(res, 200, { ok: true, product: prod, dict: dict });
      }

      let mm = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if (mm && m === 'PUT') {
        const body = await parseJSON(req);
        const products = readData('products.json', []);
        const idx = products.findIndex((p) => p.id === mm[1]);
        if (idx === -1) return sendJSON(res, 404, { error: 'Produit introuvable' });
        const merged = Object.assign({}, products[idx], body);
        products[idx] = normalizeProduct(merged);
        writeData('products.json', products);
        const dict = addToDict({
          marques: [products[idx].marque],
          saveurs: String(products[idx].flavor || '').split(',').map((x) => x.trim()),
          contenances: [products[idx].contenance]
        });
        return sendJSON(res, 200, { ok: true, product: products[idx], dict: dict });
      }
      if (mm && m === 'DELETE') {
        const products = readData('products.json', []);
        const next = products.filter((p) => p.id !== mm[1]);
        writeData('products.json', next);
        return sendJSON(res, 200, { ok: true });
      }

      if (m === 'POST' && pathname === '/api/admin/categories') {
        const body = await parseJSON(req);
        const categories = readData('categories.json', []);
        const max = categories.reduce((a, c) => Math.max(a, Number(c.order) || 0), 0);
        const cat = {
          id: crypto.randomUUID(),
          name: String(body.name || '').trim(),
          image: String(body.image || ''),
          order: max + 1,
          subs: []
        };
        categories.push(cat);
        writeData('categories.json', categories);
        return sendJSON(res, 200, { ok: true, category: cat });
      }

      if (m === 'PUT' && pathname === '/api/admin/categories/order') {
        const body = await parseJSON(req);
        const categories = readData('categories.json', []);
        const sorted = reorderList(categories, body.ids, body.id, body.dir);
        writeData('categories.json', sorted);
        return sendJSON(res, 200, { ok: true, categories: sorted });
      }

      mm = pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
      if (mm && m === 'PUT') {
        const body = await parseJSON(req);
        const categories = readData('categories.json', []);
        const idx = categories.findIndex((c) => c.id === mm[1]);
        if (idx === -1) return sendJSON(res, 404, { error: 'Categorie introuvable' });
        const upd = Object.assign({}, categories[idx], body);
        if (upd.subs !== undefined) {
          upd.subs = (Array.isArray(upd.subs) ? upd.subs : [])
            .map((x, i) => {
              const name = typeof x === 'string' ? x : (x && x.name);
              return {
                id: (x && x.id) || crypto.randomUUID(),
                name: String(name || '').trim(),
                order: Number(x && x.order) || (i + 1)
              };
            })
            .filter((x) => x.name)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        categories[idx] = upd;
        writeData('categories.json', categories);
        return sendJSON(res, 200, { ok: true, category: categories[idx] });
      }
      if (mm && m === 'DELETE') {
        const categories = readData('categories.json', []);
        const next = categories.filter((c) => c.id !== mm[1]);
        writeData('categories.json', next);
        return sendJSON(res, 200, { ok: true });
      }

      if (m === 'POST' && pathname === '/api/admin/banners') {
        const body = await parseJSON(req);
        const banners = readData('banners.json', []);
        const b = {
          id: crypto.randomUUID(),
          title: String(body.title || '').trim(),
          subtitle: String(body.subtitle || ''),
          buttonText: String(body.buttonText || ''),
          buttonLink: String(body.buttonLink || ''),
          image: String(body.image || ''),
          order: banners.length + 1
        };
        banners.push(b);
        writeData('banners.json', banners);
        return sendJSON(res, 200, { ok: true, banner: b });
      }

      if (m === 'PUT' && pathname === '/api/admin/banners/order') {
        const body = await parseJSON(req);
        const banners = readData('banners.json', []);
        const sorted = reorderList(banners, body.ids, body.id, body.dir);
        writeData('banners.json', sorted);
        return sendJSON(res, 200, { ok: true, banners: sorted });
      }

      mm = pathname.match(/^\/api\/admin\/banners\/([^/]+)$/);
      if (mm && m === 'PUT') {
        const body = await parseJSON(req);
        const banners = readData('banners.json', []);
        const idx = banners.findIndex((b) => b.id === mm[1]);
        if (idx === -1) return sendJSON(res, 404, { error: 'Banniere introuvable' });
        banners[idx] = Object.assign({}, banners[idx], body);
        writeData('banners.json', banners);
        return sendJSON(res, 200, { ok: true, banner: banners[idx] });
      }
      if (mm && m === 'DELETE') {
        const banners = readData('banners.json', []);
        writeData('banners.json', banners.filter((b) => b.id !== mm[1]));
        return sendJSON(res, 200, { ok: true });
      }

      mm = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
      if (mm && m === 'PUT') {
        const body = await parseJSON(req);
        const orders = readData('orders.json', []);
        const idx = orders.findIndex((o) => o.id === mm[1]);
        if (idx === -1) return sendJSON(res, 404, { error: 'Commande introuvable' });
        orders[idx] = Object.assign({}, orders[idx], body);
        writeData('orders.json', orders);
        return sendJSON(res, 200, { ok: true, order: orders[idx] });
      }
      if (mm && m === 'DELETE') {
        const orders = readData('orders.json', []);
        const next = orders.filter((o) => o.id !== mm[1]);
        writeData('orders.json', next);
        return sendJSON(res, 200, { ok: true });
      }

      if (m === 'POST' && pathname === '/api/admin/upload') {
        const body = await parseJSON(req);
        let data = String(body.data || '');
        if (data.startsWith('data:')) data = data.split(',')[1];
        let buf;
        try {
          buf = Buffer.from(data, 'base64');
        } catch (e) {
          return sendJSON(res, 400, { error: 'Image invalide' });
        }
        let ext = path.extname(String(body.name || '')).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) ext = '.png';
        const finalName = Date.now() + '-' + crypto.randomBytes(3).toString('hex') + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, finalName), buf);
        return sendJSON(res, 200, { url: '/uploads/' + finalName });
      }

      return sendJSON(res, 404, { error: 'Route inconnue' });
    }

    return sendJSON(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    return sendJSON(res, 500, { error: 'Erreur serveur : ' + e.message });
  }
}

function normalizeProduct(p) {
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  const opts = Array.isArray(p.options)
    ? p.options.map((o) => String(o).trim()).filter(Boolean)
    : String(p.options || '')
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean);
  const hasFlavorProp = Object.prototype.hasOwnProperty.call(p, 'flavor');
  const rawFlavors = hasFlavorProp
    ? String(p.flavor || '').split(',').map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(p.flavors) ? p.flavors : []);
  const flavors = [];
  rawFlavors.forEach((f) => {
    if (f && !flavors.some((x) => x.toLowerCase() === f.toLowerCase())) flavors.push(f);
  });
  return {
    id: p.id,
    name: String(p.name || '').trim(),
    description: String(p.description || ''),
    price: num(p.price),
    promoPrice: p.promoPrice !== null && p.promoPrice !== undefined && String(p.promoPrice).trim() !== '' ? num(p.promoPrice) : null,
    category: String(p.category || ''),
    subcategory: String(p.subcategory || ''),
    flavor: flavors.join(', '),
    flavors: flavors,
    marque: String(p.marque || '').trim(),
    contenance: String(p.contenance || '').trim(),
    taux: String(p.taux || '').trim(),
    image: String(p.image || ''),
    badge: String(p.badge || ''),
    available: p.available === undefined ? (parseInt(p.stock, 10) > 0) : !!p.available,
    rating: num(p.rating),
    reviews: parseInt(p.reviews, 10) || 0,
    options: opts,
    featured: p.featured ? true : false,
    visible: p.visible === undefined ? true : p.visible ? true : false,
    longDescription: String(p.longDescription || ''),
    gallery: Array.isArray(p.gallery)
      ? p.gallery.map((g) => String(g || '').trim()).filter(Boolean)
      : String(p.gallery || '').split('\n').map((g) => g.trim()).filter(Boolean),
    createdAt: p.createdAt || new Date().toISOString()
  };
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    sendJSON(res, 400, { error: 'URL invalide' });
    return;
  }
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname);
    return;
  }
  if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/')) {
    serveStatic(ADMIN_DIR, pathname.replace(/^\/admin/, '') || '/', res);
    return;
  }
  if (pathname === '/uploads' || pathname.startsWith('/uploads/')) {
    serveStatic(UPLOAD_DIR, pathname.replace(/^\/uploads/, '') || '/', res);
    return;
  }
  serveStatic(PUBLIC_DIR, pathname, res);
});

server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  VAPO STORE est demarre !');
  console.log('  Boutique  : http://localhost:' + PORT);
  console.log('  Admin     : http://localhost:' + PORT + '/admin');
  console.log('------------------------------------------');
  console.log('  Appuyez sur Ctrl+C dans cette fenetre');
  console.log('  pour arreter le serveur.');
  console.log('==========================================');
});