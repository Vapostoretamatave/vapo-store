# VAPO STORE TAMATAVE — Mémoire du projet

Boutique vape en ligne + section admin. Node.js pur (aucun framework), stockage = fichiers JSON dans `data/`, uploads images dans `public/uploads/`.

## Démarrer (local)
- Lancer **DEMARRER.bat** (démarre `node server.js` sur port 3000).
- Node : `C:\Program Files\nodejs\node.exe`.
- Boutique : `http://localhost:3000` · Admin : `http://localhost:3000/admin`.
- **Admin password : `vapostore2026`** (stocké dans `data/settings.json`).
- ⚠️ Aucun serveur ne doit tourner au moment d'une modification : après chaque modif l'utilisateur relance DEMARRER.bat. Un process node lancé pour test doit être arrêté (`Stop-Process`).
- Vérif syntaxe : `node --check server.js` / `node --check public\app.js` / `node --check admin\admin.js`.

## Technique anti-cache (IMPORTANT)
- `public/index.html` référence `/app.vN.js` et `/styles.css?v=N`.
- `admin/index.html` référence `/admin/admin.vN.js` et `/admin/admin.css?v=N`.
- **Règle** : quand on modifie `public/app.js`, bump vers app.v(N+1) et copier LA SOURCE sur TOUTES les versions numérotées (v5..N+1). Idem admin. Quand on modifie un CSS, bumper son `?v=`.
- État actuel (à mettre à jour) : boutique = app.v30.js + styles.css?v=20 ; admin = admin.v21.js + admin.css?v=9. Prochains bumps : app.v31, admin.v22, styles.css?v=21, admin.css?v=10 (selon fichiers touchés).
- Il existe des copies numérotées : public/app.v5..v30.js, admin/admin.v5..v21.js. TOUJOURS resync toutes quand on change la source.

## Structure
- `server.js` : tout le backend (API, fichiers statiques, auth). `handleApi()`, `normalizeProduct()`, `serveStatic()`.
- `public/` : boutique (index.html, app.js = renderFooter/renderHero/etc., styles.css, images/, uploads/).
- `admin/` : panel admin (index.html, admin.js, admin.css).
- `data/` : produits, commandes, catégories, bannières, réglages, dict. Modifiés au runtime.
- `render.yaml` : blueprint Render (service + disque `/data`).
- `.gitignore` : node_modules + fichiers OS.

## Base de données = fichiers JSON dans data/
- `products.json`, `orders.json`, `categories.json`, `banners.json`, `settings.json`, `dict.json`.
- `dict.json` : saveurs/marques/contenances/taux. **Les nouvelles marques/saveurs/contenances créées dans un produit s'auto-enregistrent** dans dict (côté serveur `addToDict()`).

## Déploiement (EN LIGNE)
- **Repo GitHub** : `https://github.com/Vapostoretamatave/vapo-store.git` (branche `main`).
- **Site : https://vapo-store.onrender.com** (forfait Starter, disque persistant 1 Go monté sur `/data`).
- Mise à jour : `git add .` → `git commit` → `git push origin main` → Render redéploie automatiquement en ~2-3 min.
- **Variables d'env en prod** : `DATA_DIR=/data`, `UPLOAD_DIR=/data/uploads`.
- Servir fichier : `DATA_DIR`/`UPLOAD_DIR` sont lus depuis l'env en prod, local sinon (voir début de server.js : LOGIQUE DE SEED — au 1er boot en prod, si `/data/settings.json` absent, copie `data/` + `public/uploads/` vers le disque).
- Git exécutable : `C:\Program Files\Git\cmd\git.exe` (pas dans le PATH de la session opencode actuelle).
- Structure des prix Render : Starter ≈ 7$/mois (Web Service) + disque 0,25$/Go/mois. Free = pas de disque (données perdues au restart) + mise en veille après 15 min.

## Historique / état
- Footer « Paiements acceptés » style pav-mdg.mg : badges MVola (#00a859/#ffeb3b gras italique), Orange Money (#ff6600/blanc, 2 lignes), + badge « Paiement à la livraison » pill doré ; configurable admin (payMvola/payOrange/payLivraison). Airtel Money = retiré (l'utilisateur ne le reçoit pas).
- Saveurs & Marques : gérés dans Réglages, carte repliable (« Afficher / modifier »), bouton « Marques & saveurs » dans Produits (switch+scroll+ouvre), recherche dans les listes, listes avec max-height+scroll.
- Marques dédupliquées insensible à la casse (boutique dimsFor : dédup via lowercase).
- Menu burger sous-catégories + Par saveur/marque/contenance ; recherche live + admin (focus conservé, débounce 250ms).
- Logo → accueil (goHome) ; zoom mobile (16px recherche, touch-action); checkout livraison/retrait → WhatsApp avec mention méthode ; frais de livraison « À confirmer ».
- Catégories/sous-catégories réordonnables dans admin (endpoint PUT /api/admin/categories/order).
- Bannière/hero : état.state via renderHero ; ordre des bannières réordonnable.

## Commandes utiles
- Backups rapides : copier `data/` et `public/uploads/` avant un test destructif.
- Tests API : démarrer server.js, requêtes sur `/api/store` (public), login admin `/api/admin/login` (password), produits/admin/dict/CAT, etc.