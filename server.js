const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

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

// En production (DATA_DIR != local) : le DISQUE (/data) est la SOURCE DE VÉRITÉ
// pour les données (produits, commandes, catégories, bannières, réglages, images).
// L'admin EN LIGNE écrit directement dessus. Le PC (via git) n'apporte que le CODE.
// On ne copie les données locales vers le disque QUE si le disque est VIDE
// (tout premier démarrage d'un disque neuf), pour ne pas repartir de zéro.
// Après ce premier amorçage, on ne touche JAMAIS au disque : sinon chaque
// redéploiement écraserait les modifications faites en ligne.

function syncCatalogToDisk() {
  if (fs.existsSync(path.join(DATA_DIR, 'settings.json'))) return;
  if (fs.existsSync(LOCAL_DATA_DIR)) {
    fs.readdirSync(LOCAL_DATA_DIR).forEach((f) => {
      const src = path.join(LOCAL_DATA_DIR, f);
      if (!fs.statSync(src).isFile()) return;
      if (f === 'orders.json') return;
      fs.copyFileSync(src, path.join(DATA_DIR, f));
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

if (DATA_DIR !== LOCAL_DATA_DIR) {
  try {
    syncCatalogToDisk();
  } catch (e) {
    console.error('sync err', e);
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
  dict.taux = merge('taux', keys.taux);
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

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function siteBase(req) {
  const env = String(process.env.SITE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT)).split(',')[0].trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|\b)/i.test(host);
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (isLocal ? 'http' : 'https');
  return proto + '://' + host;
}

function sendText(res, type, body, cache) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': cache || 'public, max-age=3600'
  });
  res.end(buf);
}

function sendHtml(res, code, html, cache) {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': cache || 'public, max-age=60'
  });
  res.end(buf);
}

function slugify(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

// URL publique d'un produit : /produit/<nom-slug>-<8 premiers caracteres de l'id>
function productSegment(p) {
  const id = String((p && p.id) || '').replace(/-/g, '').toLowerCase();
  const slug = slugify(p && p.name) || 'produit';
  return id ? slug + '-' + id.slice(0, 8) : slug;
}

function productPath(p) {
  return '/produit/' + productSegment(p);
}

function absoluteUrl(base, u) {
  const raw = String(u == null ? '' : u).trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return base + (raw.startsWith('/') ? raw : '/' + raw);
}

function findProductBySegment(products, seg) {
  const s = String(seg || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  // 1) URL canonique exacte
  const canon = products.find((x) => productSegment(x) === s);
  if (canon) return canon;
  // 2) id complet (UUID ou id court)
  const exact = products.find((x) => String(x.id || '').toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  // 3) tolerance : suffixe = debut de l'id (ex. slug different / id court)
  let i = s.lastIndexOf('-');
  while (i > -1) {
    const tok = s.slice(i + 1).toLowerCase();
    if (tok.length >= 2) {
      const hit = products.find((x) => String(x.id || '').replace(/-/g, '').toLowerCase() === tok)
        || products.find((x) => String(x.id || '').replace(/-/g, '').toLowerCase().startsWith(tok));
      if (hit) return hit;
    }
    i = s.lastIndexOf('-', i - 1);
  }
  return null;
}

function allOptionsOut(p) {
  const opts = Array.isArray(p.options) ? p.options.filter(Boolean) : [];
  if (!opts.length) return p.available === false;
  const st = p.optionStock && typeof p.optionStock === 'object' ? p.optionStock : {};
  return opts.every((o) => st[o] === false) || p.available === false;
}

function effectivePrice(p) {
  const price = Number(p.price) || 0;
  const promo = p.promoPrice === null || p.promoPrice === undefined || String(p.promoPrice).trim() === ''
    ? null
    : Number(p.promoPrice) || 0;
  const usePromo = promo !== null && promo > 0 && promo < price;
  return { price: price, promo: usePromo ? promo : null, final: usePromo ? promo : price };
}

function renderLongDescServer(raw) {
  const txt = String(raw || '');
  if (!txt.trim()) return '';
  let html = '';
  const re = /\[image\]([\s\S]*?)\[\/image\]/gi;
  let last = 0;
  let m;
  const para = (block) => block.split(/\n+/).map((par) => {
    const t = par.trim();
    if (!t) return '';
    if (/^[-•*]\s+/.test(t)) return '<p class="li">' + xmlEscape(t) + '</p>';
    return '<p>' + xmlEscape(t) + '</p>';
  }).join('');
  while ((m = re.exec(txt)) !== null) {
    if (txt.slice(last, m.index).trim()) html += para(txt.slice(last, m.index));
    const url = m[1].split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
    if (url) html += '<figure class="fig"><img src="' + xmlEscape(absoluteUrl('', url)) + '" alt="' + xmlEscape('') + '" loading="lazy"></figure>';
    last = m.index + m[0].length;
  }
  if (txt.slice(last).trim()) html += para(txt.slice(last));
  return html;
}

function buildSitemap(req) {
  const base = siteBase(req);
  const products = readData('products.json', []);
  const visible = products.filter((p) => p && p.visible !== false && p.name && p.id);
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">');
  lines.push('  <url>');
  lines.push('    <loc>' + xmlEscape(base + '/') + '</loc>');
  lines.push('    <lastmod>' + today + '</lastmod>');
  lines.push('    <changefreq>daily</changefreq>');
  lines.push('    <priority>1.0</priority>');
  lines.push('  </url>');
  visible.forEach((p) => {
    const lm = String(p.createdAt || '').slice(0, 10) || today;
    lines.push('  <url>');
    lines.push('    <loc>' + xmlEscape(base + productPath(p)) + '</loc>');
    lines.push('    <lastmod>' + lm + '</lastmod>');
    lines.push('    <changefreq>weekly</changefreq>');
    lines.push('    <priority>0.8</priority>');
    const img = absoluteUrl(base, p.image);
    if (img) {
      lines.push('    <image:image>');
      lines.push('      <image:loc>' + xmlEscape(img) + '</image:loc>');
      lines.push('      <image:title>' + xmlEscape(p.name) + '</image:title>');
      lines.push('    </image:image>');
    }
    lines.push('  </url>');
  });
  lines.push('</urlset>');
  return lines.join('\n');
}

function buildRobots(req) {
  const base = siteBase(req);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /uploads/tmp',
    '',
    'Sitemap: ' + base + '/sitemap.xml',
    ''
  ].join('\n');
}

const PRODUCT_CSS = [
  ':root{--p:#00c795;--ink:#0d1b1e;--muted:#6b8087;--line:#e3eaee;--bg:#f6f9fa}',
  '*{box-sizing:border-box}',
  'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}',
  'a{color:inherit}',
  '.wrap{max-width:1060px;margin:0 auto;padding:0 16px}',
  '.top{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}',
  '.top .wrap{display:flex;align-items:center;gap:12px;justify-content:space-between;min-height:60px}',
  '.brand{display:flex;align-items:center;gap:10px;font-weight:800;text-decoration:none}',
  '.brand img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#eef3f8}',
  '.back{font-size:14px;font-weight:700;text-decoration:none;border:1px solid var(--line);padding:8px 14px;border-radius:100px;background:#fff}',
  '.crumbs{font-size:13px;color:var(--muted);padding:14px 0 0}',
  '.crumbs a{text-decoration:none}.crumbs a:hover{text-decoration:underline}',
  '.prod{display:grid;grid-template-columns:1fr 1fr;gap:32px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin:16px 0 26px}',
  '.pimg{background:#eef3f8;border-radius:14px;display:flex;align-items:center;justify-content:center;aspect-ratio:1;overflow:hidden}',
  '.pimg img{width:100%;height:100%;object-fit:contain}',
  '.gal{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}',
  '.gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#eef3f8}',
  'h1{font-size:26px;line-height:1.2;margin:0 0 12px}',
  '.metas{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
  '.chip{font-size:12px;font-weight:700;background:#f1f6f7;border:1px solid var(--line);border-radius:100px;padding:5px 10px;color:#33525a}',
  '.price{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 6px}',
  '.price .now{font-size:28px;font-weight:900}',
  '.price .old{font-size:16px;color:var(--muted);text-decoration:line-through}',
  '.price .off{font-size:12px;font-weight:900;color:#fff;background:#e23838;border-radius:100px;padding:4px 9px}',
  '.stock{font-size:13px;font-weight:800;margin:0 0 14px}',
  '.stock.ok{color:#0a8f5b}.stock.ko{color:#cf2b2b}',
  '.desc{font-size:15px;line-height:1.55;color:#25454d;margin:0 0 18px;white-space:pre-line}',
  '.cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--p);color:#042018;font-weight:900;font-size:16px;text-decoration:none;padding:14px 18px;border-radius:100px}',
  '.cta:hover{filter:brightness(0.96)}',
  '.cta2{display:inline-flex;align-items:center;justify-content:center;width:100%;margin-top:10px;background:#fff;border:1px solid var(--line);color:var(--ink);font-weight:700;font-size:14px;text-decoration:none;padding:12px 18px;border-radius:100px}',
  '.opts{margin:16px 0 0;font-size:14px}',
  '.opts .t{font-weight:800;margin-bottom:6px}',
  '.opt{display:inline-block;font-size:13px;border:1px solid var(--line);background:#fff;border-radius:100px;padding:6px 12px;margin:0 6px 6px 0}',
  '.opt.off{color:#b3c0c5;text-decoration:line-through}',
  '.long{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin:0 0 26px}',
  '.long h2{font-size:18px;margin:0 0 10px}',
  '.long p{font-size:15px;line-height:1.6;color:#25454d;margin:0 0 10px}',
  '.long p.li{padding-left:14px;margin:0 0 6px}',
  '.long .fig{margin:14px 0}',
  '.long .fig img{max-width:100%;height:auto;border-radius:12px;display:block}',
  '.foot{background:#0d1b1e;color:#c9d8dc;font-size:13px;padding:22px 0;line-height:1.7}',
  '.foot a{color:#fff;text-decoration:none}',
  '.foot .wrap{display:flex;flex-wrap:wrap;gap:10px 26px;justify-content:space-between}',
  '@media(max-width:760px){.prod{grid-template-columns:1fr;gap:18px;padding:16px}h1{font-size:21px}.price .now{font-size:24px}}'
].join('\n');

function renderProductPage(req, p, s, cats, canonical) {
  const base = siteBase(req);
  const store = String(s.storeName || 'Vapo Store');
  const ep = effectivePrice(p);
  const out = allOptionsOut(p);
  const img = absoluteUrl(base, p.image || '/images/placeholder.svg');
  const cat = (cats || []).find((c) => c.id === p.category);
  const sub = cat && (cat.subs || []).find((x) => x.id === p.subcategory);
  const catName = cat ? String(cat.name || '') : '';
  const subName = sub ? String(sub.name || '') : '';
  const flavors = Array.isArray(p.flavors) ? p.flavors.filter(Boolean) : String(p.flavor || '').split(',').map((x) => x.trim()).filter(Boolean);
  const short = String(p.description || '').trim();
  const plainLong = String(p.longDescription || '').replace(/\[image\][\s\S]*?\[\/image\]/gi, ' ').replace(/\s+/g, ' ').trim();
  const metaDesc = (short || plainLong || (p.name + ' disponible chez ' + store)).slice(0, 300);
  const priceTxt = formatPrice(ep.final, s);
  const wa = 'https://wa.me/' + String(s.whatsapp || '').replace(/\D/g, '') + '?text=' +
    encodeURIComponent('Bonjour, je souhaite commander :\n• ' + p.name + '\n• Prix : ' + priceTxt + '\n\n' + canonical);

  const chips = [];
  if (p.marque) chips.push('Marque : ' + p.marque);
  if (p.contenance) chips.push(p.contenance);
  if (p.taux) chips.push(p.taux);
  if (p.badge) chips.push(p.badge);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: [img],
    description: metaDesc,
    sku: String(p.id || ''),
    brand: { '@type': 'Brand', name: String(p.marque || store) },
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'MGA',
      price: String(ep.final),
      availability: out ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: store }
    }
  };

  const gallery = (Array.isArray(p.gallery) ? p.gallery : []).filter(Boolean).slice(0, 8);
  const opts = Array.isArray(p.options) ? p.options.filter(Boolean) : [];

  const crumbs = ['<a href="/">Accueil</a>'];
  if (cat) crumbs.push('<a href="/#cat/' + encodeURIComponent(cat.id) + '">' + xmlEscape(catName) + '</a>');
  if (sub) crumbs.push('<a href="/#cat/' + encodeURIComponent(cat.id) + '/sub/' + encodeURIComponent(sub.id) + '">' + xmlEscape(subName) + '</a>');
  crumbs.push('<span>' + xmlEscape(p.name) + '</span>');

  return '<!DOCTYPE html>\n' +
    '<html lang="fr">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + xmlEscape(p.name + ' | ' + store) + '</title>\n' +
    '<meta name="description" content="' + xmlEscape(metaDesc) + '">\n' +
    '<meta name="robots" content="index, follow">\n' +
    '<link rel="canonical" href="' + xmlEscape(canonical) + '">\n' +
    '<meta property="og:type" content="product">\n' +
    '<meta property="og:site_name" content="' + xmlEscape(store) + '">\n' +
    '<meta property="og:title" content="' + xmlEscape(p.name) + '">\n' +
    '<meta property="og:description" content="' + xmlEscape(metaDesc) + '">\n' +
    '<meta property="og:url" content="' + xmlEscape(canonical) + '">\n' +
    '<meta property="og:image" content="' + xmlEscape(img) + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'80\' font-size=\'80\'>💨</text></svg>">\n' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>\n' +
    '<style>\n' + PRODUCT_CSS + '\n</style>\n' +
    '</head>\n<body>\n' +
    '<header class="top"><div class="wrap">' +
      '<a class="brand" href="/">' + (s.logoImage ? '<img src="' + xmlEscape(s.logoImage) + '" alt="">' : '') + '<span>' + xmlEscape(store) + '</span></a>' +
      '<a class="back" href="/">← Toute la boutique</a>' +
    '</div></header>\n' +
    '<div class="wrap"><nav class="crumbs">' + crumbs.join(' › ') + '</nav></div>\n' +
    '<main class="wrap">\n' +
      '<article class="prod">' +
        '<div><div class="pimg"><img src="' + xmlEscape(img) + '" alt="' + xmlEscape(p.name) + '" fetchpriority="high"></div>' +
          (gallery.length ? '<div class="gal">' + gallery.map((g) => '<img src="' + xmlEscape(absoluteUrl('', g)) + '" alt="' + xmlEscape(p.name) + '" loading="lazy">').join('') + '</div>' : '') +
        '</div>' +
        '<div class="pinfo">' +
          '<h1>' + xmlEscape(p.name) + '</h1>' +
          (chips.length ? '<div class="metas">' + chips.map((c) => '<span class="chip">' + xmlEscape(c) + '</span>').join('') + '</div>' : '') +
          '<div class="price">' +
            (ep.promo !== null ? '<span class="now">' + xmlEscape(formatPrice(ep.promo, s)) + '</span><span class="old">' + xmlEscape(formatPrice(ep.price, s)) + '</span><span class="off">-' + Math.round((1 - ep.promo / ep.price) * 100) + '%</span>' : '<span class="now">' + xmlEscape(priceTxt) + '</span>') +
          '</div>' +
          '<div class="stock ' + (out ? 'ko' : 'ok') + '">' + (out ? 'Rupture de stock' : '✔ En stock') + '</div>' +
          (short ? '<p class="desc">' + xmlEscape(short) + '</p>' : '') +
          '<a class="cta" href="' + xmlEscape(wa) + '" target="_blank" rel="noopener">Commander sur WhatsApp</a>' +
          '<a class="cta2" href="/">Voir tous nos produits</a>' +
          (opts.length ? '<div class="opts"><div class="t">Options disponibles</div>' + opts.map((o) => {
            const off = p.optionStock && p.optionStock[o] === false;
            const op = p.optionPrices && p.optionPrices[o] != null ? ' — ' + formatPrice(Number(p.optionPrices[o]), s) : '';
            return '<span class="opt' + (off ? ' off' : '') + '">' + xmlEscape(o + op) + (off ? ' (rupture)' : '') + '</span>';
          }).join('') + '</div>' : '') +
        '</div>' +
      '</article>\n' +
      (p.longDescription ? '<section class="long"><h2>Description</h2>' + renderLongDescServer(p.longDescription) + '</section>' : '') +
    '</main>\n' +
    '<footer class="foot"><div class="wrap">' +
      '<div><strong>' + xmlEscape(store) + '</strong>' + (s.address ? '<br>' + xmlEscape(String(s.address).trim()) : '') + (s.hours ? '<br>' + xmlEscape(String(s.hours).trim()) : '') + '</div>' +
      '<div>' + (s.phone ? 'Tél : <a href="tel:' + xmlEscape(String(s.phone).replace(/[^\d+]/g, '')) + '">' + xmlEscape(String(s.phone).trim()) + '</a><br>' : '') +
        '<a href="/">Boutique</a> · <a href="' + xmlEscape(wa) + '" target="_blank" rel="noopener">WhatsApp</a></div>' +
    '</div></footer>\n' +
    '</body>\n</html>';
}

function renderNotFoundPage(req, s) {
  const base = siteBase(req);
  const store = String((s && s.storeName) || 'Vapo Store');
  return '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="robots" content="noindex, follow"><title>Produit introuvable | ' + xmlEscape(store) + '</title>' +
    '<link rel="canonical" href="' + xmlEscape(base + '/') + '"><style>' + PRODUCT_CSS + '</style></head><body>' +
    '<main class="wrap" style="padding:60px 16px;text-align:center">' +
    '<h1>Produit introuvable</h1><p style="color:#6b8087">Ce produit n\'existe plus ou a été retiré de la boutique.</p>' +
    '<p><a class="cta" style="max-width:320px;margin:18px auto 0" href="/">Retour à la boutique</a></p>' +
    '</main></body></html>';
}

function serveProductPage(req, res, seg) {
  const products = readData('products.json', []);
  const p = findProductBySegment(products, seg);
  const s = getSettings();
  if (!p || p.visible === false) {
    return sendHtml(res, 404, renderNotFoundPage(req, s), 'no-store');
  }
  const canonicalPath = productPath(p);
  if (String(seg).replace(/\/+$/, '') !== productSegment(p)) {
    res.writeHead(301, { Location: siteBase(req) + canonicalPath, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const cats = readData('categories.json', []);
  return sendHtml(res, 200, renderProductPage(req, p, s, cats, siteBase(req) + canonicalPath));
}


function buildRobots(req) {
  const base = siteBase(req);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /uploads/tmp',
    '',
    'Sitemap: ' + base + '/sitemap.xml',
    ''
  ].join('\n');
}

const IMG_MAX_WIDTH = 1000;
const IMG_QUALITY = 90;

async function hasRealTransparency(buf) {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return false;
  const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const ch = r.info.channels;
  if (ch < 4) return false;
  for (let i = 3; i < r.data.length; i += ch) {
    if (r.data[i] < 250) return true;
  }
  return false;
}

async function optimizeImage(buf, origExt, opts) {
  if (!sharp) return { buf, ext: origExt, changed: false };
  const o = opts || {};
  const maxWidth = Math.max(320, Math.min(3840, Number(o.maxWidth) || IMG_MAX_WIDTH));
  const quality = Math.max(50, Math.min(100, Number(o.quality) || IMG_QUALITY));
  let meta;
  try { meta = await sharp(buf).metadata(); } catch (e) { return { buf, ext: origExt, changed: false }; }
  const fmt = String(meta.format || '').toLowerCase();
  if (fmt === 'svg' || fmt === 'gif') return { buf, ext: origExt, changed: false };
  let keepPng = false;
  try { keepPng = await hasRealTransparency(buf); } catch (e) { /* JPEG par defaut */ }
  let pipeline = sharp(buf).rotate();
  if (meta.width && meta.width > maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }
  let outBuf;
  let outExt;
  try {
    if (keepPng) {
      outBuf = await pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer();
      outExt = '.png';
    } else {
      outBuf = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: quality, mozjpeg: true }).toBuffer();
      outExt = '.jpg';
    }
  } catch (e) { return { buf, ext: origExt, changed: false }; }
  if (outBuf.length >= buf.length) return { buf, ext: origExt, changed: false };
  return { buf: outBuf, ext: outExt, changed: true };
}

function methodLabel(m) {
  if (m === 'pickup') return 'Retrait en magasin';
  if (m === 'delivery') return 'Livraison';
  return 'Commande WhatsApp';
}

function formatPrice(n, s) {
  const num = Number(n || 0);
  const str = num.toLocaleString('fr-FR');
  const cur = (s && s.currency) || 'Ar';
  return s && s.currencyPosition === 'before' ? cur + ' ' + str : str + ' ' + cur;
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
        const optInStock = String(it.option || '').trim();
        if (optInStock && p.optionStock && typeof p.optionStock === 'object' && p.optionStock[optInStock] === false) {
          return sendJSON(res, 400, { error: 'Variante en rupture de stock : ' + p.name + ' (' + optInStock + ')' });
        }
        const uprice = (p.optionPrices && typeof p.optionPrices === 'object' && p.optionPrices[it.option] != null)
          ? Number(p.optionPrices[it.option])
          : (p.promoPrice != null && p.promoPrice !== '' ? Number(p.promoPrice) : Number(p.price));
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

      if (m === 'GET' && pathname === '/api/admin/backup') {
        const head = {
          date: new Date().toISOString(),
          settings: getSettings(),
          categories: readData('categories.json', []),
          products: readData('products.json', []),
          orders: readData('orders.json', []),
          banners: readData('banners.json', []),
          dict: getDict()
        };
        res.on('error', () => { /* connexion coupée, on arrête d'écrire */ });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.write(JSON.stringify(head).slice(0, -1) + ',"uploads":{');
        let first = true;
        try {
          if (fs.existsSync(UPLOAD_DIR)) {
            fs.readdirSync(UPLOAD_DIR).forEach((f) => {
              const p = path.join(UPLOAD_DIR, f);
              let st;
              try { st = fs.statSync(p); } catch (e) { return; }
              if (st.isFile() && !f.startsWith('.')) {
                res.write((first ? '' : ',') + JSON.stringify(f) + ':' + JSON.stringify(fs.readFileSync(p).toString('base64')));
                first = false;
              }
            });
          }
        } catch (e) { /* certains fichiers peuvent échouer, on continue */ }
        res.write('}}');
        res.end();
        return;
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

      if (m === 'POST' && pathname === '/api/admin/compress-images') {
        if (!fs.existsSync(UPLOAD_DIR)) return sendJSON(res, 200, { ok: true, done: 0, skipped: 0, saved: 0 });
        const replaceRefs = (oldUrl, newUrl) => {
          const files = ['products.json', 'banners.json', 'settings.json'];
          for (const f of files) {
            const p = path.join(DATA_DIR, f);
            let txt;
            try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
            if (!txt.includes(oldUrl)) continue;
            fs.writeFileSync(p, txt.split(oldUrl).join(newUrl));
          }
        };
        let done = 0, skipped = 0, savedBytes = 0, failed = 0;
        const files = fs.readdirSync(UPLOAD_DIR);
        for (const f of files) {
          if (f.startsWith('.')) continue;
          const origExt = path.extname(f).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(origExt)) { skipped++; continue; }
          const fp = path.join(UPLOAD_DIR, f);
          let buf;
          try { buf = fs.readFileSync(fp); } catch (e) { failed++; continue; }
          let resOpt;
          try { resOpt = await optimizeImage(buf, origExt); } catch (e) { failed++; continue; }
          if (!resOpt.changed) { skipped++; continue; }
          let newName = f;
          if (resOpt.ext !== origExt) {
            newName = f.replace(/\.[^.]+$/, '') + resOpt.ext;
            if (newName !== f) {
              const newFp = path.join(UPLOAD_DIR, newName);
              if (fs.existsSync(newFp)) { skipped++; continue; }
              fs.writeFileSync(newFp, resOpt.buf);
              replaceRefs('/uploads/' + f, '/uploads/' + newName);
              try { fs.unlinkSync(fp); } catch (e) { /* on ignore */ }
            } else {
              fs.writeFileSync(fp, resOpt.buf);
            }
          } else {
            fs.writeFileSync(fp, resOpt.buf);
          }
          savedBytes += (buf.length - resOpt.buf.length);
          done++;
        }
        return sendJSON(res, 200, { ok: true, done, skipped, failed, savedBytes, total: files.length });
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
          contenances: [prod.contenance],
          taux: String(prod.taux || '').split(',').map((x) => x.trim())
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
          contenances: [products[idx].contenance],
          taux: String(products[idx].taux || '').split(',').map((x) => x.trim())
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
        const origExt = path.extname(String(body.name || '')).toLowerCase();
        let ext = origExt;
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) ext = '.png';
        let finalBuf = buf;
        try {
          const opt = await optimizeImage(buf, ext, { maxWidth: body.maxWidth, quality: body.quality });
          if (opt.changed) { finalBuf = opt.buf; ext = opt.ext; }
        } catch (e) { /* on garde l'original si echec */ }
        const finalName = Date.now() + '-' + crypto.randomBytes(3).toString('hex') + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, finalName), finalBuf);
        return sendJSON(res, 200, { url: '/uploads/' + finalName });
      }

      return sendJSON(res, 404, { error: 'Route inconnue' });
    }

    return sendJSON(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    return sendJSON(res, 500, { error: 'Erreur serveur : ' + e.message });
  }
}

function parseOptionPrices(src) {
  const out = {};
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    Object.keys(src).forEach((k) => {
      const key = String(k).trim();
      const n = parseFloat(String(src[k] || '').replace(/[^\d.,]/g, '').replace(',', '.'));
      if (key && !isNaN(n) && n > 0) out[key] = Number(n.toFixed(2));
    });
  } else {
    String(src || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        let m = line.match(/^(.*?)(?:→|->)\s*([\d\s.,]+)$/);
        if (m) {
          const key = m[1].trim();
          const n = parseFloat(m[2].replace(/[^\d.,]/g, '').replace(',', '.'));
          if (key && !isNaN(n) && n > 0) out[key] = Number(n.toFixed(2));
          return;
        }
        m = line.match(/^(.*?)\s+(\d[\d\s.,]*)$/);
        if (m) {
          const key = m[1].trim();
          const n = parseFloat(m[2].replace(/[^\d.,]/g, '').replace(',', '.'));
          if (key && !isNaN(n) && n > 0) out[key] = Number(n.toFixed(2));
        }
      });
  }
  return out;
}

function parseOptionStock(src, opts) {
  const out = {};
  const list = Array.isArray(opts) ? opts : [];
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    Object.keys(src).forEach((k) => {
      const key = String(k).trim();
      if (!key) return;
      const v = String(src[k] || '').trim().toLowerCase();
      if (v === 'false' || v === '0' || v === '0%' || String(v) === '' && src[k] === false) {
        if (!list.length || list.indexOf(key) !== -1) out[key] = false;
      }
    });
  } else {
    String(src || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        let opt = line;
        const m = line.match(/^(.*?)\s+(0|rupture|epuise|epuis\w*|false)$/i);
        if (m) opt = m[1].trim();
        if (opt && (!list.length || list.indexOf(opt) !== -1)) out[opt] = false;
      });
  }
  return out;
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
    optionImages: p.optionImages && typeof p.optionImages === 'object' && !Array.isArray(p.optionImages)
      ? Object.keys(p.optionImages).reduce(function (acc, k) {
          const v = String(p.optionImages[k] || '').trim();
          if (String(k).trim() && v) acc[String(k).trim()] = v;
          return acc;
        }, {})
      : {},
    optionPrices: parseOptionPrices(p.optionPrices),
    optionStock: parseOptionStock(p.optionStock, opts),
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

  if (pathname === '/sitemap.xml') {
    sendText(res, 'application/xml; charset=utf-8', buildSitemap(req), 'public, max-age=600');
    return;
  }
  if (pathname === '/robots.txt') {
    sendText(res, 'text/plain; charset=utf-8', buildRobots(req), 'public, max-age=600');
    return;
  }
  if (pathname === '/produit' || pathname === '/produit/') {
    res.writeHead(301, { Location: '/', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const productMatch = pathname.match(/^\/produit\/(.+)$/);
  if (productMatch) {
    serveProductPage(req, res, productMatch[1]);
    return;
  }

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