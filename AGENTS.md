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
- État actuel (à mettre à jour) : boutique = app.v41.js + styles.css?v=31 ; admin = admin.v30.js + admin.css?v=10. Prochains bumps : styles.css?v=32, admin.css?v=11 (selon fichiers touchés).
- Il existe des copies numérotées : public/app.v5..v41.js, admin/admin.v5..v30.js. TOUJOURS resync toutes quand on change la source.
- **Pagination boutique (app.v38 / styles.css?v=29)** : grille paginée 18 produits/page (`PAGE_SIZE`), barre `‹ 1 2 3 … ›` (`renderPager()` + `#pager`). Page reset à 1 quand la signature des filtres change (catégorie/sous-cat/facet/recherche/promo/tri). Hash inchangé.
- **Barre nav mobile défilable (styles.css?v=30)** : `.nav` n'est plus masqué sous 860px (était `display:none`) → s'affiche sous le header sticky, défilable gauche/droite déjà géré par `.nav-inner` (overflow-x auto + scrollbar cachée). Cliquer une catégorie = afficher TOUS ses produits (selectCategory 'sub'=''), filtre ensuite via bouton Filtrer/burger.

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
- ⚠️ **Workflow DONNÉES** : les produits se créent/modifient depuis l'ADMIN EN LIGNE (instantané, rupture de stock/prix). Git ne sert QUE pour le code. Le disque (/data) est la source de vérité et le redéploiement ne l'écrase jamais.
- **Variables d'env en prod** : `DATA_DIR=/data`, `UPLOAD_DIR=/data/uploads`.
- Servir fichier : `DATA_DIR`/`UPLOAD_DIR` sont lus depuis l'env en prod, local sinon (voir début de server.js : **LE DISQUE (/data) EST LA SOURCE DE VÉRITÉ des données**. L'admin EN LIGNE écrit directement dessus (produits, commandes, catégories, bannières, réglages, images). `syncCatalogToDisk()` ne copie `data/` + `public/uploads/` → disque QUE si `settings.json` absent (1er boot d'un disque neuf). Ensuite le redéploiement ne touche JAMAIS au disque → les modifs en ligne ne sont jamais écrasées. ⚠️ **Ne PAS modifier les produits en LOCAL et les pousser** : git = code seulement. Sauvegarde : admin en ligne → Réglages → « 💾 Télécharger la sauvegarde » (`GET /api/admin/backup` : JSON avec produits+commandes+settings+images base64) → à conserver sur Google Drive.
- Git exécutable : `C:\Program Files\Git\cmd\git.exe` (pas dans le PATH de la session opencode actuelle).
- Structure des prix Render : Starter ≈ 7$/mois (Web Service) + disque 0,25$/Go/mois. Free = pas de disque (données perdues au restart) + mise en veille après 15 min.

## Historique / état
- **Rupture par option (app.v41 / admin.v30 / styles.css?v=31 / server.js)** : un produit avec options peut avoir une variante en rupture sans bloquer les autres via `optionStock` (objet option→false). Admin : champ « Options en rupture » (une option par ligne, nom exact tel que dans Options/variantes ; `p_optionStock` parsé dans `saveProduct`, prérempli dans `openProductForm`). Boutique : les options en rupture sont grisées avec badge « Rupture » (`.opt-btn.off` + `.opt-rupt`), l'option sélectionnée par défaut est la première dispo (`firstAvailableOption`), le statut « ✔ Disponible / ✖ Rupture » et le bouton suivent l'option cliquée (`optionOutOfStock`/`productUnavailable`), l'ajout panier est bloqué côté client ET côté serveur (`/api/order` rejette « Variante en rupture » via `parseOptionStock` dans `normalizeProduct`). Si TOUTES les options sont en rupture → le produit s'affiche « Rupture » comme avant (`productUnavailable`).
- **Prix par variante (app.v40 / admin.v29 / server.js)** : un produit avec options peut avoir un prix DIFFÉRENT selon l'option choisie via `optionPrices` (objet option→prix, ex. `{"10 mg sel de nicotine":15000,"20 mg sel de nicotine":18000}`). Admin : champ « Prix pour chaque option » (texte `OPTION PRIX` une ligne par variante, séparateur = espace ou flèche →, parseur dans `saveProduct`). Boutique : quand on clique une option dans la petite modale OU la fiche détaillée, le prix affiché se met à jour (`renderOptionPrice`/`optionPriceOf`) et le panier/commande stocke le bon prix (`addToCart`, `/api/order` côté serveur via `parseOptionPrices` dans `normalizeProduct`). Lien WhatsApp fiche détaillée aussi mis à jour (`refreshDlWa`).
- **Test persistance disque (en cours)** : produits effacés en ligne le 17/09/2026 (0 produit en ligne) pour vérifier que le disque `/data` sur Render persiste à travers les redéploiements.
- **Hash routing + liens bannières (app.v31 / admin.v22)** : chaque filtre a une URL propre via `#` : `#cat/<id>`, `#cat/<id>/sub/<subId>`, `#marque/<nom>`, `#saveur/<nom>`, `#search/<texte>`, `#promo`. Liens lus au chargement + à chaque `hashchange` ; `writeHash()` met à jour l'URL à chaque `renderProducts()`. **`promoOnly`** (état) filtre la grille sur les produits en promo (promoPrice OU badge promo/prix).
- **Hash multi-facettes + burger saveur/taux (app.v39)** : le bug « copier-coller d'URL de filtre → grille vide » (ex. `#cat/c1/sub/Boisson`) est corrigé : l'URL encode désormais le TYPE de filtre — `cat/<cat>/sub/<id>` (catégorie), `cat/<cat>/saveur/<v>`, `cat/<cat>/marque/<v>`, `cat/<cat>/contenance/<v>`, `cat/<cat>/taux/<v>` — via `TOKEN_FACET` + `facetToken()` dans readHash/writeHash (`public/app.js`). Le facet interne `flavor` correspond au token URL `saveur` (unifié, avant `saveur` ne matchait pas DIMS). Burger : émoji « 🍓 Par saveur » (plus 🌶), « 🧪 Par taux de nicotine » ajouté au menu (DIMS : flavor 🍓, taux 🧪, marque 🏷, contenance 📏 — tous `menu:true`).
- **Admin bannières** : le champ « Lien du bouton » devient un sélecteur `#b_dest` (Tous les produits / Produits en promo / Catégories ▾ / Marques ▾ / Saveurs ▾ / Recherche libre) qui remplit automatiquement `#b_buttonLink` ; `populateBannerDest(link)` reverse-map le lien existant, `bannerValueToLink()` convertit le choix en hash.
- **Prix promo clairs (app.v33 / styles.css?v=25)** : badge `-X%` calculé et affiché DANS le badge promo en haut de l'image (`discountPct()`, `.badge-pct`) ; barré corrigé (`.old` = line-through gris + petit) ; prix promo rouge plus gros (`.price.promo`, `.pm-promo` 24px nowrap). **Mobile <600px** : l'ancien prix barré passe sur sa propre ligne AU-DESSUS du prix promo (`flex-wrap: wrap` + `.card-foot .old{width:100%}`) — même comportement que pav-mdg.mg. Bouton « Ajouter/Choisir » NON modifié (reste compact à droite). Produit « Enfer Pod kiwi Passion » a un mauvais prix promo (20.000 > prix normal 15.000) → à corriger en admin.
- **Bouton « 🔥 Destockage / Promo » + filtre promo (app.v34)** : bouton visible dans la barre nav (`.nav-promo`, fin des catégories) ET dans le menu burger (`menu-promo`, placé TOUT EN BAS, après toutes les catégories, donc toujours dernier même si on en ajoute). `goPromo()` → `state.promoOnly=true` → filtre `#promo` qui montre TOUS les produits avec promoPrice OU badge promo/prix, sans quitter leur catégorie. Pour « destocker » un produit = lui mettre un prix promo en admin (il reste dans sa catégorie ET apparaît dans Promo).
- **Image qui suit l'option (app.v37 / admin.v27)** : champ produit « Image pour chaque option » (`optionImages` = objet nom→URL), formaté en admin au format `NOM URL` (ou `NOM → URL`), une ligne par option, séparateur = espace OU flèche → (les deux acceptés). À la boutique, quand le client clique une option (`opt-btn`) dans la petite modale OU la fiche détaillée, si `optionImages[option]` existe → la grande photo change (`pmImage`/`dlMain`) via `imageForOption(p, opt)` ; sinon l'image ne bouge pas (retour arrière complet). `normalizeProduct()` conserve `optionImages`.
- **Fiche produit détaillée (app.v36 / admin.v24)** : champs optionnels produits « Description complète » (`longDescription`) + « Galerie d'images » (`gallery` = liste d'URL une par ligne ; upload multiple `bindGalleryUpload`). La description longue accepte des **images insérées au milieu du texte** via la balise `[image]\n<url>\n[/image]` — `renderDetailDesc()` (boutique) les transforme en `<figure class="dl-fig">` entre les paragraphes ; chaque image garde ses proportions (photo classique ou banderole large). Admin : bouton « ＋ Insérer une image dans la description » (`bindDescImageInsert`) téléverse et insère automatiquement la balise. Boutique : clic sur image/NOM d'une carte → **si le produit a une description longue OU une galerie** → ouvre la **modale fiche détaillée** (`openProductDetail`, `#detailModal` : grande photo + miniatures `.dl-thumbs`, méta marque/contenance/taux/saveurs, description avec images, bouton « 💬 Commander sur WhatsApp ») ; **sinon** → modale actuelle intacte. Le bouton « Ajouter/Choisir » n'est jamais modifié. `hasDetail(p)` décide. Serveur `normalizeProduct()` conserve `longDescription`/`gallery` (sinon les perdait).
- Footer « Paiements acceptés » style pav-mdg.mg : badges MVola (#00a859/#ffeb3b gras italique), Orange Money (#ff6600/blanc, 2 lignes), + badge « Paiement à la livraison » pill doré ; configurable admin (payMvola/payOrange/payLivraison). Airtel Money = retiré (l'utilisateur ne le reçoit pas).
- Saveurs & Marques : gérés dans Réglages, carte repliable (« Afficher / modifier »), bouton « Marques & saveurs » dans Produits (switch+scroll+ouvre), recherche dans les listes, listes avec max-height+scroll.
- Menu burger sous-catégories + Par saveur/marque/contenance ; recherche live + admin (focus conservé, débounce 250ms).
- Logo → accueil (goHome) ; zoom mobile (16px recherche, touch-action); checkout livraison/retrait → WhatsApp avec mention méthode ; frais de livraison « À confirmer ».
- Catégories/sous-catégories réordonnables dans admin (endpoint PUT /api/admin/categories/order).
- Bannière/hero : état.state via renderHero ; ordre des bannières réordonnable.
- **Optimisation images 3G (admin.v28 / server.js)** : dépendance `sharp` ajoutée (`npm install`). À l'upload (`POST /api/admin/upload`), chaque image est **compressée automatiquement** : max 1000 px de large, JPEG qualité 90 (fond blanc aplati) ou PNG optimisé si vraie transparence. Endpoint admin `POST /api/admin/compress-images` = traitement **en masse** des images déjà en ligne (disque) : convertit les PNG opaques en JPEG (~-90% de poids), renomme `.png`→`.jpg` et met à jour les références dans products.json/banners.json/settings.json (`replaceRefs`). Bouton « 🗜️ Optimiser les images » dans l'admin → Réglages. Recommandé : faire la sauvegarde complète avant.

## Commandes utiles
- Backups rapides : copier `data/` et `public/uploads/` avant un test destructif.
- Tests API : démarrer server.js, requêtes sur `/api/store` (public), login admin `/api/admin/login` (password), produits/admin/dict/CAT, etc.