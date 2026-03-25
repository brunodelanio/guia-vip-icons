// ===== GUIA VIP =====
// Firebase config carregado do config.js (arquivo privado)
const db = firebase.firestore();
const storage = firebase.storage();

// ===== NORMALIZE TEXT (remove accents for search) =====
function normalizeText(str) {
  if (!str) return '';
  var r = str.toLowerCase().normalize('NFD');
  var result = '';
  for (var i = 0; i < r.length; i++) {
    var code = r.charCodeAt(i);
    if (code < 0x0300 || code > 0x036f) result += r[i];
  }
  return result;
}
// Offline persistence disabled - was caching corrupt data and freezing the app

// ===== STATE =====
let appData = {
  cities: [], categories: {}, companies: [], subcategories: {},
  banners: { home: [] }, cityBanners: {}, footerBanners: {},
  visual: { bgUrl:'', mascotUrl:'', advertiseLink:'', reviewAndroid:'', reviewIos:'' }
};
let currentCityId = null, currentCategoryId = null;
let homeBannerIndex = 0, cityBannerIndex = 0;
let homeBannerTimer = null, cityBannerTimer = null;
let editingCompanyId = null, adminLoggedIn = false;


// ===== LOADING =====
function showLoading(msg = 'Carregando...') {
  let el = document.getElementById('gv-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gv-loading';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(26,10,2,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px';
    el.innerHTML = `<div style="width:44px;height:44px;border:3px solid #f0c050;border-top-color:transparent;border-radius:50%;animation:gvspin 0.7s linear infinite"></div><p id="gv-loading-msg" style="color:#f0c050;font-family:Cinzel,serif;font-size:14px;letter-spacing:1px">${msg}</p>`;
    const s = document.createElement('style');
    s.textContent = '@keyframes gvspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
    document.body.appendChild(el);
  } else {
    el.style.display = 'flex';
    document.getElementById('gv-loading-msg').textContent = msg;
  }
}
function hideLoading() { const el = document.getElementById('gv-loading'); if (el) el.style.display = 'none'; }

// ===== IMAGE COMPRESSION (substitui o Storage) =====
// Reduz a imagem para no máximo 800px e qualidade 75%, mantendo abaixo de ~600KB
function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth; }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', quality);
        // Avisa se ainda for grande demais
        const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
        if (sizeKB > 900) {
          console.warn(`Imagem comprimida ficou ${sizeKB}KB — pode ser grande para o Firestore.`);
        }
        resolve(base64);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Wrapper para compatibilidade com o restante do código
// Compress image and return a Blob for Storage upload
function compressImageToBlob(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Upload to Firebase Storage and return download URL
async function uploadImageFile(file, maxWidth = 800, quality = 0.75) {
  try {
    const blob = await compressImageToBlob(file, maxWidth, quality);
    const filename = `images/${Date.now()}_${Math.random().toString(36).substr(2,8)}.jpg`;
    const ref = storage.ref(filename);
    await ref.put(blob, { contentType: 'image/jpeg' });
    const url = await ref.getDownloadURL();
    return url;
  } catch(e) {
    console.error('Storage upload failed, falling back to base64:', e);
    return await compressImage(file, maxWidth, quality);
  }
}

// ===== DEFAULT DATA =====
const DEFAULT_CITIES = [
  { id: 'colinas', name: 'Colinas', order: 0 },
  { id: 'colmeia', name: 'Colméia', order: 1 },
  { id: 'guarai', name: 'Guaraí', order: 2 },
  { id: 'pedro-afonso', name: 'Pedro Afonso', order: 3 },
  { id: 'miracema', name: 'Miracema', order: 4 },
  { id: 'miranorte', name: 'Miranorte', order: 5 },
  { id: 'pres-kennedy', name: 'Presidente Kennedy', order: 6 },
  { id: 'tabocao', name: 'Tabocão', order: 7 }
];
const DEFAULT_CAT_NAMES = [
  'Ouvir a Rádio','Influenciadores Digitais','Açaí, Doces e Sorvetes','Advocacia',
  'Agronegócio','Barbearias','Bares e Bebidas','Beleza e Estética',
  'Carros, Peças e Náutica','Clínicas e Hospitais','Contabilidade',
  'Cosméticos e Perfumaria','Drogarias','Engenharia, Arquitetura e Topografia',
  'Escolas e Cursos','Festas e Eventos','Floricultura e Jardinagem','Fotografia',
  'Gás, Açougue e Peixaria','Hotéis, Pousadas e Lazer','Imóveis e Construções',
  'Indústrias e Lojas Gerais','Informática e Celulares','Internet e Tecnologia',
  'Jóias e Relógios','Lava Rápido','Malharias e Estamparias','Moda',
  'Móveis, Eletrodomésticos e Decoração','Oficinas, Motos e Bicicletas',
  'Óticas e Dentistas','Panificadoras, Cafeterias e Mercearias',
  'Papelarias, Gráficas e Anúncios','Pet Shop e Veterinária',
  'Pizzas, Lanches e Caldos','Refrigeração','Restaurantes, Assados e Sushi',
  'Serviços Gerais','Som, Baterias e Acessórios','Supermercados e Hortifrúti',
  'Táxi','Telefones Úteis','Transportes e Fretes','Treino e Esportes','Variedades e Utilidades'
];
const CAT_EMOJI = {
  'Ouvir a Rádio':'📻','Influenciadores Digitais':'📱','Açaí, Doces e Sorvetes':'🍦',
  'Advocacia':'⚖️','Agronegócio':'🌾','Barbearias':'✂️','Bares e Bebidas':'🍺',
  'Beleza e Estética':'💅','Carros, Peças e Náutica':'🚗','Clínicas e Hospitais':'🏥',
  'Contabilidade':'📊','Cosméticos e Perfumaria':'💄','Drogarias':'💊',
  'Engenharia, Arquitetura e Topografia':'🏗️','Escolas e Cursos':'📚',
  'Festas e Eventos':'🎉','Floricultura e Jardinagem':'🌸','Fotografia':'📷',
  'Gás, Açougue e Peixaria':'🔥','Hotéis, Pousadas e Lazer':'🏨',
  'Imóveis e Construções':'🏠','Indústrias e Lojas Gerais':'🏭',
  'Informática e Celulares':'💻','Internet e Tecnologia':'🌐',
  'Jóias e Relógios':'💍','Lava Rápido':'🚿','Malharias e Estamparias':'👕',
  'Moda':'👗','Móveis, Eletrodomésticos e Decoração':'🛋️',
  'Oficinas, Motos e Bicicletas':'🔧','Óticas e Dentistas':'👓',
  'Panificadoras, Cafeterias e Mercearias':'☕','Papelarias, Gráficas e Anúncios':'🖨️',
  'Pet Shop e Veterinária':'🐾','Pizzas, Lanches e Caldos':'🍕',
  'Refrigeração':'❄️','Restaurantes, Assados e Sushi':'🍽️','Serviços Gerais':'🔨',
  'Som, Baterias e Acessórios':'🔊','Supermercados e Hortifrúti':'🛒',
  'Táxi':'🚕','Telefones Úteis':'📞','Transportes e Fretes':'🚚',
  'Treino e Esportes':'💪','Variedades e Utilidades':'🛍️'
};

// ===== LOCAL CACHE SYSTEM =====
// Caches Firestore data locally to reduce daily read quota usage
const CACHE_KEY = 'guiavip_cache';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function saveToCache(data) {
  try {
    const cache = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch(e) { console.warn('Cache save failed:', e); }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    const age = Date.now() - cache.timestamp;
    if (age > CACHE_TTL) return null; // expired
    console.log('Loaded from cache — saved Firestore reads!');
    return cache.data;
  } catch(e) { return null; }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch(e) {}
}

// ===== LOAD FROM FIRESTORE =====
async function loadAllData() {
  showLoading('Carregando Guia Vip...');

  // Try loading from local cache first (saves Firestore reads)
  const cached = loadFromCache();
  if (cached) {
    appData.cities = cached.cities || [];
    appData.categories = cached.categories || {};
    appData.companies = cached.companies || [];
    appData.banners = cached.banners || { home: [] };
    appData.cityBanners = cached.cityBanners || {};
    appData.footerBanners = cached.footerBanners || {};
    appData.homeFooterBanners = cached.homeFooterBanners || [];
    appData.subcategories = cached.subcategories || {};
    appData.visual = { ...appData.visual, ...(cached.visual || {}) };
    hideLoading();
    return; // Skip Firestore — use cache
  }

  try {
    const citiesSnap = await db.collection('cities').orderBy('order').get();
    if (citiesSnap.empty) { await seedDefaultData(); }
    else { appData.cities = citiesSnap.docs.map(d => d.data()); }

    const catsSnap = await db.collection('categories').get();
    appData.categories = {};
    catsSnap.docs.forEach(d => {
      const cat = d.data();
      if (!appData.categories[cat.cityId]) appData.categories[cat.cityId] = [];
      appData.categories[cat.cityId].push(cat);
    });

    const cosSnap = await db.collection('companies').get();
    appData.companies = cosSnap.docs.map(d => d.data());

    // Load subcategories
    const subCatsSnap = await db.collection('subcategories').get();
    appData.subcategories = {};
    subCatsSnap.docs.forEach(d => {
      const sc = d.data();
      if (!appData.subcategories[sc.categoryId]) appData.subcategories[sc.categoryId] = [];
      appData.subcategories[sc.categoryId].push(sc);
    });

    const bannersSnap = await db.collection('banners').get();
    appData.banners = { home: [] }; appData.cityBanners = {};
    bannersSnap.docs.forEach(d => {
      const b = d.data();
      if (b.location === 'home') appData.banners.home.push(b);
      else {
        if (!appData.cityBanners[b.location]) appData.cityBanners[b.location] = [];
        appData.cityBanners[b.location].push(b);
      }
    });
    appData.banners.home.sort((a,b) => (a.order||0)-(b.order||0));

    // Load home footer banners
    const homeFooterSnap = await db.collection('homeFooterBanners').get();
    appData.homeFooterBanners = homeFooterSnap.docs.map(d => d.data()).sort((a,b) => (a.order||0)-(b.order||0));

    const footerSnap = await db.collection('footerBanners').get();
    appData.footerBanners = {};
    footerSnap.docs.forEach(d => {
      const b = d.data();
      if (!appData.footerBanners[b.cityId]) appData.footerBanners[b.cityId] = [];
      appData.footerBanners[b.cityId].push(b);
    });

    const settingsDoc = await db.collection('settings').doc('main').get();
    if (settingsDoc.exists) {
      const data = settingsDoc.data();
      // Strip any large image fields that may have corrupted the document
      const safeFields = ['advertiseLink','reviewAndroid','reviewIos','reviewInstagram'];
      const safeData = {};
      safeFields.forEach(k => { if (data[k] !== undefined) safeData[k] = data[k]; });
      appData.visual = { ...appData.visual, ...safeData };

      // Clean up corrupt image fields from settings/main if they exist
      const badFields = ['emergencyCardImg','advertiseCardImg','reviewCardImg','bgUrl','mascotUrl'];
      const hasCorrupt = badFields.some(k => data[k] && data[k].length > 100);
      if (hasCorrupt) {
        try {
          const cleanData = { ...safeData };
          await db.collection('settings').doc('main').set(cleanData);
          console.log('Cleaned corrupt image fields from settings/main');
        } catch(e) {}
      }
    }

    // Load background image from separate document
    try {
      const bgDoc = await db.collection('settings').doc('bgImg').get();
      if (bgDoc.exists && bgDoc.data().imgData) appData.visual.bgUrl = bgDoc.data().imgData;
    } catch(e) {}

    // Load mascot from separate document
    try {
      const mascotDoc = await db.collection('settings').doc('mascotImg').get();
      if (mascotDoc.exists && mascotDoc.data().imgData) appData.visual.mascotUrl = mascotDoc.data().imgData;
    } catch(e) {}

    // Load home header image
    try {
      const headerDoc = await db.collection('settings').doc('homeHeaderImg').get();
      if (headerDoc.exists && headerDoc.data().imgData) {
        appData.visual.homeHeaderImg = headerDoc.data().imgData;
      }
    } catch(e) {}

    // Load special card images from separate documents
    for (const key of ['emergency','advertise','review']) {
      try {
        const cardDoc = await db.collection('settings').doc('cardimg_' + key).get();
        if (cardDoc.exists && cardDoc.data().imgData) {
          appData.visual[key + 'CardImg'] = cardDoc.data().imgData;
        }
      } catch(e) {}
    }

    // Save loaded data to local cache
    saveToCache({
      cities: appData.cities,
      categories: appData.categories,
      companies: appData.companies,
      banners: appData.banners,
      cityBanners: appData.cityBanners,
      footerBanners: appData.footerBanners,
      homeFooterBanners: appData.homeFooterBanners || [],
      subcategories: appData.subcategories || {},
      visual: appData.visual
    });

  } catch(e) {
    console.error('Firestore error:', e);
    // Try loading from cache as fallback
    const fallback = loadFromCache();
    if (fallback) {
      appData.cities = fallback.cities || [];
      appData.categories = fallback.categories || {};
      appData.companies = fallback.companies || [];
      appData.banners = fallback.banners || { home: [] };
      appData.cityBanners = fallback.cityBanners || {};
      appData.footerBanners = fallback.footerBanners || {};
      appData.homeFooterBanners = fallback.homeFooterBanners || [];
      appData.subcategories = fallback.subcategories || {};
      appData.visual = { ...appData.visual, ...(fallback.visual || {}) };
      console.log('Loaded from cache as fallback after Firestore error');
    } else {
      alert('Erro ao conectar. Verifique sua conexão.');
    }
  }
  hideLoading();
}

async function seedDefaultData() {
  showLoading('Configurando dados iniciais...');
  const batch = db.batch();
  DEFAULT_CITIES.forEach(city => {
    batch.set(db.collection('cities').doc(city.id), city);
    appData.cities.push(city);
    const cats = DEFAULT_CAT_NAMES.map((name, i) => ({
      id: `cat_${city.id}_${i}`, name, cityId: city.id, order: i, imgUrl: ''
    }));
    appData.categories[city.id] = cats;
    cats.forEach(cat => batch.set(db.collection('categories').doc(cat.id), cat));
  });
  await batch.commit();
}

// ===== REAL-TIME LISTENERS =====
function setupListeners() {
  db.collection('subcategories').onSnapshot(snap => {
    appData.subcategories = {};
    snap.docs.forEach(d => {
      const sc = d.data();
      if (!appData.subcategories[sc.categoryId]) appData.subcategories[sc.categoryId] = [];
      appData.subcategories[sc.categoryId].push(sc);
    });
    if (currentCategoryId && document.getElementById('screen-category')?.classList.contains('active')) renderCompanies();
    if (adminLoggedIn) renderAdminSubcategories();
  });
  db.collection('companies').onSnapshot(snap => {
    appData.companies = snap.docs.map(d => d.data());
    if (currentCategoryId && document.getElementById('screen-category')?.classList.contains('active')) renderCompanies();
    if (adminLoggedIn) renderAdminCompanies();
  });
  db.collection('categories').onSnapshot(snap => {
    appData.categories = {};
    snap.docs.forEach(d => {
      const c = d.data();
      if (!appData.categories[c.cityId]) appData.categories[c.cityId] = [];
      appData.categories[c.cityId].push(c);
    });
    if (currentCityId && document.getElementById('screen-city')?.classList.contains('active')) renderCategories();
    if (adminLoggedIn) renderAdminCategories();
  });
  db.collection('cities').onSnapshot(snap => {
    appData.cities = snap.docs.map(d => d.data()).sort((a,b) => (a.order||0)-(b.order||0));
    if (document.getElementById('screen-home')?.classList.contains('active')) renderCities();
    if (adminLoggedIn) { renderAdminCities(); populateAdminSelects(); }
  });
  db.collection('banners').onSnapshot(snap => {
    appData.banners = { home: [] }; appData.cityBanners = {};
    snap.docs.forEach(d => {
      const b = d.data();
      if (b.location === 'home') appData.banners.home.push(b);
      else {
        if (!appData.cityBanners[b.location]) appData.cityBanners[b.location] = [];
        appData.cityBanners[b.location].push(b);
      }
    });
    appData.banners.home.sort((a,b) => (a.order||0)-(b.order||0));
    if (document.getElementById('screen-home')?.classList.contains('active')) renderHomeBanner();
    else if (document.getElementById('screen-city')?.classList.contains('active')) renderCityBanner();
    if (adminLoggedIn) renderBannerList();
  });
  db.collection('settings').doc('colors').onSnapshot(doc => {
    if (doc.exists) {
      const colors = { ...DEFAULT_COLORS, ...doc.data() };
      appData.visual.colors = colors;
      applyColors(colors);
    }
  });
  db.collection('settings').doc('main').onSnapshot(doc => {
    if (doc.exists) { appData.visual = { ...appData.visual, ...doc.data() }; applyVisual(); applySpecialCardImages(); }
  });
  // Card images are hardcoded in CSS - no listener needed
  db.collection('homeFooterBanners').onSnapshot(snap => {
    appData.homeFooterBanners = snap.docs.map(d => d.data()).sort((a,b) => (a.order||0)-(b.order||0));
    if (document.getElementById('screen-home')?.classList.contains('active')) renderHomeFooterBanner();
    if (adminLoggedIn) renderHomeFooterBannerList();
  });
  db.collection('footerBanners').onSnapshot(snap => {
    appData.footerBanners = {};
    snap.docs.forEach(d => {
      const b = d.data();
      if (!appData.footerBanners[b.cityId]) appData.footerBanners[b.cityId] = [];
      appData.footerBanners[b.cityId].push(b);
    });
    if (currentCityId && document.getElementById('screen-city')?.classList.contains('active')) renderFooterBanner();
    if (adminLoggedIn) renderFooterBannerList();
  });
}

// ===== NAVIGATION =====
let savedCityScrollY = 0;
let savedCityScrollEl = null;
let restoreCityScroll = false;

function forceScrollTo(y) {
  window.scrollTo({ top: y, behavior: 'instant' });
  document.documentElement.scrollTop = y;
  document.body.scrollTop = y;
  if (savedCityScrollEl) savedCityScrollEl.scrollTop = y;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  if (restoreCityScroll && id === 'screen-city') {
    restoreCityScroll = false;
    const y = savedCityScrollY;
    setTimeout(() => forceScrollTo(y), 0);
    setTimeout(() => forceScrollTo(y), 50);
    setTimeout(() => forceScrollTo(y), 150);
  } else {
    forceScrollTo(0);
    el.scrollTop = 0;
  }
  updateCityBadge(id);
  const nav = document.getElementById('bottom-nav');
  if (nav) {
    if (id === 'screen-home') {
      nav.classList.remove('visible');
    } else {
      nav.classList.add('visible');
    }
  }
}

function updateCityBadge(screenId) {
  const badge = document.getElementById('city-badge');
  const badgeName = document.getElementById('city-badge-name');
  if (!badge || !badgeName) return;
  if (screenId === 'screen-category' && currentCityId) {
    const city = appData.cities.find(c => c.id === currentCityId);
    if (city) {
      badgeName.textContent = city.name;
      badge.classList.add('visible');
      return;
    }
  }
  badge.classList.remove('visible');
}
function goHome() { window.location.hash = 'home'; }
function goToCity() { window.location.hash = 'city-' + currentCityId; }

function goBackFromCategory() {
  if (currentSubCategoryId) {
    currentSubCategoryId = null;
    const coSearch = document.getElementById('company-search');
    if (coSearch) coSearch.value = '';
    renderCompanies();
  } else {
    const coSearch = document.getElementById('company-search');
    if (coSearch) coSearch.value = '';
    restoreCityScroll = true;
    window.history.back();
  }
}
function openCity(cityId) {
  currentCityId = cityId;
  window.location.hash = 'city-' + cityId;
}
function openCategory(categoryId) {
  const cityEl = document.getElementById('screen-city');
  savedCityScrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || cityEl?.scrollTop || 0;
  savedCityScrollEl = (cityEl && cityEl.scrollTop > 0) ? cityEl : null;
  currentCategoryId = categoryId;
  window.location.hash = 'category-' + currentCityId + '-' + categoryId;
}

// ===== NAVEGAÇÃO POR HASH (funciona no WebView Android e iOS) =====
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (!hash || hash === 'home') {
    showScreen('screen-home'); renderHomeBanner();
  } else if (hash === 'admin') {
    checkAdminRoute();
  } else if (hash.startsWith('city-')) {
    const cityId = hash.replace('city-', '');
    currentCityId = cityId;
    const city = appData.cities.find(c => c.id === cityId);
    document.getElementById('city-title').textContent = city ? city.name : 'Cidade';
    ['city-search','city-cat-search','company-search'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    showScreen('screen-city'); renderCityBanner(); renderCategories(); renderFooterBanner();
    if (restoreCityScroll) {
      restoreCityScroll = false;
      const y = savedCityScrollY;
      setTimeout(() => forceScrollTo(y), 0);
      setTimeout(() => forceScrollTo(y), 50);
      setTimeout(() => forceScrollTo(y), 150);
    }
  } else if (hash.startsWith('category-')) {
    const parts = hash.replace('category-', '').split('-');
    const cityId = parts[0];
    const categoryId = parts.slice(1).join('-');
    currentCityId = cityId; currentCategoryId = categoryId;
    const cat = (appData.categories[cityId]||[]).find(c => c.id === categoryId);
    document.getElementById('category-title').textContent = cat ? cat.name : 'Categoria';
    const searchEl = document.getElementById('company-search');
    if (searchEl) searchEl.value = '';
    currentSubCategoryId = null;
    showScreen('screen-category'); renderCompanies();
  }
});

function showExitConfirm() {
  let el = document.getElementById('exit-confirm');
  if (el) { el.style.display = 'flex'; return; }
  el = document.createElement('div');
  el.id = 'exit-confirm';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#3d1f0a,#2a1005);border:2px solid var(--gold);border-radius:14px;padding:28px 24px;width:100%;max-width:320px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.7)">
      <h3 style="font-family:Cinzel,serif;color:var(--gold);font-size:17px;margin-bottom:10px">Sair do Guia Vip?</h3>
      <p style="color:var(--text-muted);font-size:14px;margin-bottom:22px">Tem certeza que deseja sair?</p>
      <div style="display:flex;gap:12px">
        <button onclick="document.getElementById('exit-confirm').style.display='none'" style="flex:1;padding:12px;background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:50px;color:var(--text-main);font-family:Cinzel,serif;font-size:13px;cursor:pointer">Não</button>
        <button onclick="navigator.app?.exitApp?.() || window.close?.() || history.go(-(history.length))" style="flex:1;padding:12px;background:linear-gradient(135deg,var(--gold),var(--amber));border:none;border-radius:50px;color:#1a0a02;font-family:Cinzel,serif;font-size:13px;font-weight:700;cursor:pointer">Sim, sair</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}





// ===== HOME =====
function initHome() { applyVisual(); applySpecialCardImages(); applyHomeHeader(); renderHomeBanner(); renderCities(); renderHomeFooterBanner(); }
function applyVisual() {
  document.body.style.backgroundImage = appData.visual.bgUrl ? `url(${appData.visual.bgUrl})` : 'none';
}

function renderHomeBanner() {
  const slides = appData.banners.home || [];
  const container = document.getElementById('home-banner-slides');
  const dots = document.getElementById('home-banner-dots');
  if (!container) return;
  if (!slides.length) {
    container.innerHTML = `<div class="banner-slide"><div class="banner-placeholder">🦜 Guia Vip</div></div>`;
    dots.innerHTML = ''; return;
  }
  container.innerHTML = slides.map((s,i) => `
    <div class="banner-slide" onclick="${s.link ? `window.open('${s.link}','_blank')` : ''}">
      <img src="${s.imgUrl}" alt="Banner ${i+1}" loading="eager">
    </div>`).join('');
  dots.innerHTML = slides.map((_,i) => `<div class="banner-dot ${i===0?'active':''}" onclick="goBannerSlide('home',${i})"></div>`).join('');
  homeBannerIndex = 0; updateBannerPosition('home');
  clearInterval(homeBannerTimer);
  if (slides.length > 1) homeBannerTimer = setInterval(() => nextSlide('home'), 4000);
  setTimeout(() => document.querySelectorAll('#home-banner .banner-slide').forEach(addPulse), 50);
}

function cityCardHtml(city) {
  return `<div class="city-card ${city.imgUrl ? 'has-img' : ''}" onclick="openCity('${city.id}')" ontouchstart="event.stopPropagation()" ${city.imgUrl ? `style="background-image:url('${city.imgUrl}');background-size:cover;background-position:center"` : ''}>
    ${!city.imgUrl ? '<div class="city-card-icon">🏙️</div>' : ''}
    <div class="city-card-name">${city.name}</div>
  </div>`;
}
function renderCities() {
  const grid = document.getElementById('cities-grid');
  const sorted = [...appData.cities]
    .filter(c => !c.hidden)
    .sort((a,b) => (a.order||0)-(b.order||0));
  grid.innerHTML = sorted.map(cityCardHtml).join('');
  setTimeout(() => { document.querySelectorAll('.city-card').forEach(addPulse); document.querySelectorAll('.special-card').forEach(addPulse); }, 50);
}
function filterCities(val) {
  const grid = document.getElementById('cities-grid');
  const sorted = [...appData.cities]
    .filter(c => !c.hidden && normalizeText(c.name).includes(normalizeText(val)))
    .sort((a,b) => (a.order||0)-(b.order||0));
  grid.innerHTML = sorted.map(cityCardHtml).join('');
}

// ===== CITY =====
function renderCityBanner() {
  const slides = appData.cityBanners[currentCityId] || [];
  const container = document.getElementById('city-banner-slides');
  const dots = document.getElementById('city-banner-dots');
  if (!container) return;
  if (!slides.length) {
    const city = appData.cities.find(c => c.id === currentCityId);
    container.innerHTML = `<div class="banner-slide"><div class="banner-placeholder">🏙️ ${city?.name||''}</div></div>`;
    dots.innerHTML = ''; return;
  }
  container.innerHTML = slides.map((s,i) => `
    <div class="banner-slide" onclick="${s.link ? `window.open('${s.link}','_blank')` : ''}">
      <img src="${s.imgUrl}" alt="Banner" loading="eager">
    </div>`).join('');
  dots.innerHTML = slides.map((_,i) => `<div class="banner-dot ${i===0?'active':''}" onclick="goBannerSlide('city',${i})"></div>`).join('');
  cityBannerIndex = 0; updateBannerPosition('city');
  clearInterval(cityBannerTimer);
  if (slides.length > 1) cityBannerTimer = setInterval(() => nextSlide('city'), 4000);
  setTimeout(() => document.querySelectorAll('#city-banner .banner-slide').forEach(addPulse), 50);
}
let footerBannerIndex = 0;
let footerBannerTimer = null;

function renderFooterBanner() {
  const banners = (appData.footerBanners[currentCityId] || []).sort((a,b) => (a.order||0)-(b.order||0));
  const el = document.getElementById('city-footer-banner');
  if (!el) return;
  if (!banners.length) { el.innerHTML = ''; return; }
  if (banners.length === 1) {
    const b = banners[0];
    el.innerHTML = `<img src="${b.imgUrl}" alt="Rodapé" style="cursor:${b.link?'pointer':'default'}" onclick="${b.link ? `window.open('${b.link}','_blank')` : ''}">`;
    setTimeout(() => document.querySelectorAll('.city-footer-banner img').forEach(addPulse), 50);
    return;
  }
  // Multiple - rotate
  el.innerHTML = `<div class="footer-banner-slides" id="footer-slides" style="position:relative;overflow:hidden;border-radius:16px">
    ${banners.map((b,i) => `<img src="${b.imgUrl}" alt="Rodapé" class="footer-slide" style="display:${i===0?'block':'none'};width:100%;max-height:80px;object-fit:cover;cursor:${b.link?'pointer':'default'}" onclick="${b.link?`window.open('${b.link}','_blank')`:''}">`).join('')}
  </div>`;
  footerBannerIndex = 0;
  clearInterval(footerBannerTimer);
  setTimeout(() => document.querySelectorAll('.footer-slide, .city-footer-banner img').forEach(addPulse), 50);
  footerBannerTimer = setInterval(() => {
    const slides = document.querySelectorAll('.footer-slide');
    if (!slides.length) return;
    slides[footerBannerIndex].style.display = 'none';
    footerBannerIndex = (footerBannerIndex + 1) % slides.length;
    slides[footerBannerIndex].style.display = 'block';
  }, 4000);
}
function renderCategories(searchVal = '') {
  const grid = document.getElementById('categories-grid');
  const cats = (appData.categories[currentCityId]||[]).sort((a,b) => (a.order||0)-(b.order||0));
  const filtered = searchVal ? cats.filter(c => c.name.toLowerCase().includes(searchVal.toLowerCase())) : cats;
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>📂</span>Nenhuma categoria encontrada.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(cat => `
    <div class="category-card" onclick="openCategory('${cat.id}')">
      ${cat.imgUrl
        ? `<img src="${cat.imgUrl}" alt="${cat.name}" class="category-card-img" loading="lazy">`
        : `<div class="category-card-img-placeholder">${CAT_EMOJI[cat.name]||'📂'}</div>`}
      <div class="category-card-name">${cat.name}</div>
    </div>`).join('');
}
// pulse applied after renderCategories
const _origRenderCategories = renderCategories;
renderCategories = function(searchVal = '') {
  _origRenderCategories(searchVal);
  setTimeout(() => document.querySelectorAll('.category-card').forEach(addPulse), 50);
};

function filterCategories(val) {
  const grid = document.getElementById('categories-grid');
  if (!val.trim()) {
    renderCategories('');
    return;
  }
  const s = normalizeText(val);
  const cats = (appData.categories[currentCityId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));

  // Find matching companies in this city
  const matchedCompanies = appData.companies.filter(c =>
    c.cityId === currentCityId && (
      normalizeText(c.name).includes(s) ||
      normalizeText(c.desc||'').includes(s) ||
      normalizeText(c.hours||'').includes(s)
    )
  ).sort((a,b)=>(a.order||0)-(b.order||0));

  // Find matching categories by name
  const matchedCats = cats.filter(c => normalizeText(c.name).includes(s));

  // If there are company results, show them directly as cards
  if (matchedCompanies.length > 0) {
    const isRadio = false; // never radio in search
    grid.innerHTML = `
      <div style="grid-column:1/-1">
        <p style="color:var(--amber);font-family:Cinzel,serif;font-size:12px;padding:4px 0 10px;letter-spacing:0.5px">
          🔍 ${matchedCompanies.length} empresa${matchedCompanies.length>1?'s':''} encontrada${matchedCompanies.length>1?'s':''}
        </p>
        <div class="companies-list" style="padding:0">
          ${matchedCompanies.map(co => `
            <div class="company-card">
              <div class="company-card-header">
                ${co.logoUrl ? `<img src="${co.logoUrl}" alt="${co.name}" class="company-logo">` : ''}
                <div class="company-info">
                  <div class="company-name">${co.name}</div>
                  ${co.desc ? `<div class="company-desc">${co.desc}</div>` : ''}
                  ${co.hours ? `<div class="company-hours">⏰ ${co.hours}</div>` : ''}
                </div>
              </div>
              <div class="company-actions">
                ${co.phone ? `<a href="tel:${co.phone}" class="company-btn btn-phone">📞 ${co.phone}</a>` : ''}
                ${co.whatsapp ? `<a href="https://wa.me/55${co.whatsapp.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp</a>` : ''}
                ${co.whatsapp2 ? `<a href="https://wa.me/55${co.whatsapp2.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp 2</a>` : ''}
                ${co.whatsapp3 ? `<a href="https://wa.me/55${co.whatsapp3.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp 3</a>` : ''}
                ${co.instagram ? `<a href="${co.instagram}" target="_blank" class="company-btn btn-instagram">📸 Instagram</a>` : ''}
                ${co.tiktok ? `<a href="${co.tiktok}" target="_blank" class="company-btn btn-tiktok">🎵 TikTok</a>` : ''}
                ${co.site ? `<a href="${co.site}" target="_blank" class="company-btn btn-site">🌐 Site</a>` : ''}
                ${co.cardapio ? `<a href="${co.cardapio}" target="_blank" class="company-btn btn-cardapio">🍽️ Cardápio</a>` : ''}
                ${co.agenda ? `<a href="${co.agenda}" target="_blank" class="company-btn btn-agenda">📅 Agendar</a>` : ''}
                ${co.email ? `<a href="mailto:${co.email}" class="company-btn btn-email">✉️ E-mail</a>` : ''}
                ${co.maps ? `<a href="${co.maps}" target="_blank" class="company-btn btn-maps">📍 Localização</a>` : ''}
              </div>
            </div>`).join('')}
        </div>
        ${matchedCats.length > 0 ? `
          <p style="color:var(--amber);font-family:Cinzel,serif;font-size:12px;padding:14px 0 8px;letter-spacing:0.5px">📂 Categorias encontradas</p>
          <div class="categories-grid" style="padding:0">
            ${matchedCats.map(cat => `
              <div class="category-card" onclick="openCategory('${cat.id}')">
                ${cat.imgUrl ? `<img src="${cat.imgUrl}" alt="${cat.name}" class="category-card-img" loading="lazy">` : `<div class="category-card-img-placeholder">${CAT_EMOJI[cat.name]||'📂'}</div>`}
                <div class="category-card-name">${cat.name}</div>
              </div>`).join('')}
          </div>` : ''}
      </div>`;
    return;
  }

  // Only category matches
  if (matchedCats.length > 0) {
    grid.innerHTML = matchedCats.map(cat => `
      <div class="category-card" onclick="openCategory('${cat.id}')">
        ${cat.imgUrl ? `<img src="${cat.imgUrl}" alt="${cat.name}" class="category-card-img" loading="lazy">` : `<div class="category-card-img-placeholder">${CAT_EMOJI[cat.name]||'📂'}</div>`}
        <div class="category-card-name">${cat.name}</div>
      </div>`).join('');
    return;
  }

  grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>🔍</span>Nenhum resultado encontrado.</div>`;
}

function openCategoryAndSearch(categoryId, searchVal) {
  openCategory(categoryId);
  setTimeout(() => {
    const el = document.getElementById('company-search');
    if (el) { el.value = searchVal; filterCompanies(searchVal); }
  }, 100);
}

// ===== COMPANIES =====
// ===== RADIO PLAYER =====
let currentAudio = null;
let currentRadioId = null;

function isWebsite(url) {
  if (!url) return false;
  // If it's clearly just a website homepage (no path or only /)
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    // No port and no meaningful path = website
    if (!u.port && (path === '' || path === '/index.html')) return true;
  } catch(e) {}
  return false;
}

async function resolveStreamUrl(url) {
  // Try to resolve .pls and .m3u playlist files to get actual stream URL
  if (/\.(pls|m3u)(\?.*)?$/i.test(url)) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      // Parse .pls
      const plsMatch = text.match(/File1=(.*)/i);
      if (plsMatch) return plsMatch[1].trim();
      // Parse .m3u
      const m3uLines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      if (m3uLines.length) return m3uLines[0].trim();
    } catch(e) {}
  }
  return url;
}

async function playRadio(id, url, name) {
  // Stop previous
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  if (currentRadioId === id) {
    currentRadioId = null;
    updateRadioCards();
    hideRadioPlayer();
    return;
  }

  currentRadioId = id;
  updateRadioCards();

  // If clearly a website, open in browser
  if (isWebsite(url)) {
    window.open(url, '_blank');
    currentRadioId = null;
    updateRadioCards();
    return;
  }

  // Try to resolve playlist files
  const resolvedUrl = await resolveStreamUrl(url);

  // Try to play inside app
  currentAudio = new Audio(resolvedUrl);
  currentAudio.play().then(() => {
    showRadioPlayer(name, id);
  }).catch(() => {
    // Fallback to browser
    window.open(url, '_blank');
    currentRadioId = null;
    updateRadioCards();
    hideRadioPlayer();
  });
}

function showRadioPlayer(name, id) {
  document.body.classList.add('radio-playing');
  let player = document.getElementById('radio-mini-player');
  if (!player) {
    player = document.createElement('div');
    player.id = 'radio-mini-player';
    player.className = 'radio-mini-player';
    document.body.appendChild(player);
  }
  // Get logo from company if available
  const co = appData.companies.find(c => c.id === id);
  const iconHtml = co && co.logoUrl
    ? `<img src="${co.logoUrl}" style="width:42px;height:42px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
    : `<div class="rmp-icon">📻</div>`;
  player.innerHTML = `
    ${iconHtml}
    <div class="rmp-info">
      <div class="rmp-name">${name}</div>
      <div class="rmp-status">Ao vivo</div>
    </div>
    <button class="rmp-btn" onclick="toggleRadioPlay()">⏸</button>
    <button class="rmp-btn rmp-close" onclick="stopRadio()">✕</button>
  `;
  player.classList.add('active');
}

function hideRadioPlayer() {
  const player = document.getElementById('radio-mini-player');
  if (player) player.classList.remove('active');
  document.body.classList.remove('radio-playing');
}

function toggleRadioPlay() {
  if (!currentAudio) return;
  const btn = document.querySelector('.rmp-btn:not(.rmp-close)');
  if (currentAudio.paused) { currentAudio.play(); if (btn) btn.textContent = '⏸'; }
  else { currentAudio.pause(); if (btn) btn.textContent = '▶'; }
}

function stopRadio() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  currentRadioId = null;
  updateRadioCards();
  hideRadioPlayer();
}

function updateRadioCards() {
  document.querySelectorAll('.radio-card').forEach(card => {
    const id = card.dataset.id;
    const btn = card.querySelector('.radio-play-btn');
    if (btn) btn.textContent = id === currentRadioId ? '⏸' : '▶';
    card.classList.toggle('playing', id === currentRadioId);
  });
}

// ===== COMPANY ACTIONS HTML =====
function companyActionsHtml(co) {
  return `
    ${co.phone ? `<a href="tel:${co.phone}" class="company-btn btn-phone">📞 ${co.phone}</a>` : ''}
    ${co.whatsapp ? `<a href="https://wa.me/55${co.whatsapp.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp</a>` : ''}
    ${co.whatsapp2 ? `<a href="https://wa.me/55${co.whatsapp2.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp 2</a>` : ''}
    ${co.whatsapp3 ? `<a href="https://wa.me/55${co.whatsapp3.replace(/\D/g,'')}" target="_blank" class="company-btn btn-whatsapp">💬 WhatsApp 3</a>` : ''}
    ${co.instagram ? `<a href="${co.instagram}" target="_blank" class="company-btn btn-instagram">📸 Instagram</a>` : ''}
    ${co.tiktok ? `<a href="${co.tiktok}" target="_blank" class="company-btn btn-tiktok">🎵 TikTok</a>` : ''}
    ${co.site ? `<a href="${co.site}" target="_blank" class="company-btn btn-site">🌐 Site</a>` : ''}
    ${co.cardapio ? `<a href="${co.cardapio}" target="_blank" class="company-btn btn-cardapio">🍽️ Cardápio</a>` : ''}
    ${co.agenda ? `<a href="${co.agenda}" target="_blank" class="company-btn btn-agenda">📅 Agendar</a>` : ''}
    ${co.email ? `<a href="mailto:${co.email}" class="company-btn btn-email">✉️ E-mail</a>` : ''}
    ${co.maps ? `<a href="${co.maps}" target="_blank" class="company-btn btn-maps">📍 Localização</a>` : ''}`;
}

// ===== COMPANY MODAL =====
function shareCompany(id) {
  var co = appData.companies.find(function(c){return c.id===id;});
  if (!co) return;
  var city = appData.cities.find(function(c){return c.id===co.cityId;});
  var parts = [];
  parts.push('*' + co.name + '*');
  if (city) parts.push(city.name + ' - TO');
  parts.push('');
  if (co.phone) parts.push('Tel: ' + co.phone);
  if (co.whatsapp) parts.push('WhatsApp: ' + co.whatsapp);
  if (co.whatsapp2) parts.push('WhatsApp 2: ' + co.whatsapp2);
  if (co.hours) parts.push(co.hours);
  if (co.desc) parts.push('', co.desc);
  parts.push('', 'Empresa cadastrada no *Guia Vip*!');
  parts.push('https://go.applink.com.br/2203439');
  var msg = parts.join(String.fromCharCode(10));
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function openCompanyModal(id) {
  const co = appData.companies.find(c => c.id === id);
  if (!co) return;

  // Remove existing modal if any
  const existing = document.getElementById('company-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'company-modal-overlay';
  overlay.className = 'company-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closeCompanyModal(); };

  overlay.innerHTML = `
    <div class="company-modal">
      <div class="company-modal-img-wrap">
        ${co.logoUrl
          ? `<img src="${co.logoUrl}" class="company-modal-logo" alt="${co.name}">`
          : `<div class="company-modal-logo-placeholder">🏢</div>`}
        <button class="company-modal-close" onclick="closeCompanyModal()">✕</button>
      </div>
      <div class="company-modal-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div class="company-modal-name" style="flex:1">${co.name}</div>
          <div id="share-btn-slot" style="flex-shrink:0"></div>
        </div>
        ${co.desc ? `<div class="company-modal-desc">${co.desc}</div>` : ''}
        ${co.hours ? `<div class="company-modal-hours">⏰ ${co.hours}</div>` : ''}
        <div class="company-modal-actions">${companyActionsHtml(co)}</div>
      </div>
    </div>`;

  // Add share button via JS to avoid template literal conflicts
  const shareBtn = document.createElement('button');
  shareBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f0c050" stroke-width="2.5" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
  shareBtn.title = 'Compartilhar no WhatsApp';
  shareBtn.setAttribute('onclick', 'shareCompany(' + JSON.stringify(id) + ')');
  shareBtn.style.cssText = 'width:36px;height:36px;background:rgba(61,31,10,0.85);border:1.5px solid rgba(240,192,80,0.4);border-radius:50%;color:#f0c050;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.4);flex-shrink:0;';
  const slot = overlay.querySelector('#share-btn-slot');
  if (slot) slot.appendChild(shareBtn);

  document.body.appendChild(overlay);
}

function closeCompanyModal() {
  const overlay = document.getElementById('company-modal-overlay');
  if (overlay) {
    overlay.style.animation = 'fadeOut 0.2s ease forwards';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  }
}

// ===== ACCORDION TOGGLE =====
function toggleCompany(id) {
  const details = document.getElementById('co-details-' + id);
  const arrow = document.getElementById('co-arrow-' + id);
  if (!details) return;
  const isOpen = details.style.display !== 'none';
  // Close all others first
  document.querySelectorAll('.company-details').forEach(d => { d.style.display = 'none'; });
  document.querySelectorAll('.co-arrow').forEach(a => { a.textContent = '▼'; });
  if (!isOpen) {
    details.style.display = 'block';
    if (arrow) arrow.textContent = '▲';
  }
}

let currentSubCategoryId = null;

function renderCompanies(searchVal = '') {
  const list = document.getElementById('companies-list');
  const cats = appData.categories[currentCityId] || [];
  const cat = cats.find(c => c.id === currentCategoryId);
  const isRadio = cat?.name === 'Ouvir a Rádio';

  // Check if this category has subcategories
  const subCats = (appData.subcategories[currentCategoryId] || []).sort((a,b) => (a.order||0)-(b.order||0));
  if (subCats.length > 0 && !currentSubCategoryId) {
    // Show subcategory selection
    list.innerHTML = `
      <div class="subcategories-grid">
        ${subCats.map(sc => `
          <div class="subcategory-card" onclick="openSubCategory('${sc.id}')">
            ${sc.imgUrl ? `<img src="${sc.imgUrl}" alt="${sc.name}" class="category-card-img" loading="lazy">` : `<div class="category-card-img-placeholder">${sc.emoji || '🚗'}</div>`}
            <div class="category-card-name">${sc.name}</div>
          </div>`).join('')}
      </div>`;
    return;
  }
  let companies = appData.companies
    .filter(c => c.cityId === currentCityId && c.categoryId === currentCategoryId &&
      (!currentSubCategoryId || (c.subCategoryId||'') === currentSubCategoryId))
    .sort((a,b) => (a.order||0)-(b.order||0));
  if (searchVal) {
    const s = normalizeText(searchVal);
    companies = companies.filter(c => normalizeText(c.name).includes(s) || normalizeText(c.desc||'').includes(s));
  }
  if (!companies.length) {
    list.innerHTML = `<div class="empty-state"><span>${CAT_EMOJI[cat?.name]||'🏢'}</span>Nenhuma empresa cadastrada nesta categoria.</div>`;
    return;
  }

  // ===== RADIO CARDS =====
  if (isRadio) {
    list.innerHTML = companies.map(co => {
      const url = co.radioLink || co.cardapio || '';
      const isPlaying = currentRadioId === co.id;
      return `
        <div class="radio-card ${isPlaying ? 'playing' : ''}" data-id="${co.id}" onclick="playRadio('${co.id}','${url}','${co.name.replace(/'/g,"\'")}')">
          ${co.logoUrl ? `<img src="${co.logoUrl}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0">` : '<div class="radio-icon">📻</div>'}
          <div class="radio-info">
            <div class="radio-name">${co.name}</div>
            ${co.desc ? `<div class="radio-desc">${co.desc}</div>` : ''}
          </div>
          <span class="radio-play-btn">${isPlaying ? '⏸' : '▶'}</span>
        </div>`;
    }).join('');
    return;
  }

  // ===== COMPANY CARDS — tap to open modal =====
  list.innerHTML = companies.map(co => `
    <div class="company-card company-card-summary" onclick="openCompanyModal('${co.id}')">
      ${co.logoUrl ? `<img src="${co.logoUrl}" alt="${co.name}" class="company-logo">` : '<div style="width:54px;height:54px;border-radius:10px;background:linear-gradient(135deg,#3d1f0a,#2a1005);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🏢</div>'}
      <div class="company-info">
        <div class="company-name">${co.name}</div>
        ${co.desc ? `<div class="company-desc">${co.desc}</div>` : ''}
      </div>
      <span style="color:var(--text-muted);font-size:16px;flex-shrink:0">›</span>
    </div>`).join('');
}
function openSubCategory(subCatId) {
  currentSubCategoryId = subCatId;
  renderCompanies();
}

function filterCompanies(val) { renderCompanies(val); }
// Apply pulse after any render
const _origRenderCompanies = renderCompanies;
renderCompanies = function(searchVal = '') {
  _origRenderCompanies(searchVal);
  setTimeout(() => document.querySelectorAll('.company-card, .radio-card, .subcategory-card').forEach(addPulse), 50);
};

// ===== BANNER SLIDER =====
function prevSlide(type) {
  if (type === 'home') { const t = appData.banners.home.length; if (!t) return; homeBannerIndex = (homeBannerIndex-1+t)%t; updateBannerPosition('home'); }
  else { const t = (appData.cityBanners[currentCityId]||[]).length; if (!t) return; cityBannerIndex = (cityBannerIndex-1+t)%t; updateBannerPosition('city'); }
}
function nextSlide(type) {
  if (type === 'home') { const t = appData.banners.home.length; if (!t) return; homeBannerIndex = (homeBannerIndex+1)%t; updateBannerPosition('home'); }
  else { const t = (appData.cityBanners[currentCityId]||[]).length; if (!t) return; cityBannerIndex = (cityBannerIndex+1)%t; updateBannerPosition('city'); }
}
function goBannerSlide(type, index) {
  if (type === 'home') { homeBannerIndex = index; updateBannerPosition('home'); }
  else { cityBannerIndex = index; updateBannerPosition('city'); }
}
function updateBannerPosition(type) {
  const prefix = type === 'home' ? 'home' : 'city';
  const idx = type === 'home' ? homeBannerIndex : cityBannerIndex;
  const slides = document.getElementById(`${prefix}-banner-slides`);
  const dots = document.getElementById(`${prefix}-banner-dots`);
  if (slides) slides.style.transform = `translateX(-${idx*100}%)`;
  if (dots) dots.querySelectorAll('.banner-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
}

// ===== MODALS =====
function showEmergency() { document.getElementById('emergency-modal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function openAdvertise() { const l = appData.visual.advertiseLink; if (l) window.open(l, '_blank'); }
function openReview() {
  document.getElementById('review-android-btn').href = appData.visual.reviewAndroid || '#';
  document.getElementById('review-ios-btn').href = appData.visual.reviewIos || '#';
  const igBtn = document.getElementById('review-instagram-btn');
  if (igBtn) {
    const igLink = appData.visual.reviewInstagram;
    if (igLink) {
      igBtn.href = igLink.startsWith('http') ? igLink : 'https://instagram.com/' + igLink.replace(/^@/,'');
      igBtn.style.display = 'flex';
    } else {
      igBtn.style.display = 'none';
    }
  }
  document.getElementById('review-modal').classList.add('open');
}

// ===== ADMIN AUTH =====
function checkAdminRoute() {
  if (window.location.hash === '#admin' || window.location.href.includes('#admin')) {
    if (adminLoggedIn) openAdmin(); else showAdminLogin();
  }
}
function showAdminLogin() { document.getElementById('admin-login').classList.add('open'); }
// Hash SHA-256 via Web Crypto API (senha nunca trafega em texto puro)
async function hashPassword(pw) {
  const encoded = new TextEncoder().encode(pw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Cria o documento de auth no Firestore na primeira vez
async function seedAuthIfNeeded() {
  const doc = await db.collection('settings').doc('auth').get();
  if (!doc.exists) {
    // Hash SHA-256 pré-calculado da senha padrão (senha não está no código)
    const hash = '6d699ca8022b46a8174ca7e1f65bb4dac5570b627b182a7e191fa983b080f30a';
    await db.collection('settings').doc('auth').set({ hash });
  }
}

async function checkAdminLogin() {
  const pw = document.getElementById('admin-password').value;
  const err = document.getElementById('login-error');
  const btn = document.querySelector('#admin-login .admin-btn');
  if (btn) { btn.textContent = '🔄 Verificando...'; btn.disabled = true; }
  try {
    const enteredHash = await hashPassword(pw);
    const doc = await db.collection('settings').doc('auth').get();
    const storedHash = doc.exists ? doc.data().hash : null;
    if (enteredHash === storedHash) {
      adminLoggedIn = true;
      document.getElementById('admin-login').classList.remove('open');
      openAdmin();
    } else {
      err.style.display = 'block';
      setTimeout(() => err.style.display = 'none', 2500);
    }
  } catch(e) {
    alert('Erro ao verificar senha. Verifique sua conexão.');
  } finally {
    if (btn) { btn.textContent = 'Entrar'; btn.disabled = false; }
  }
}
function openAdmin() {
  if (!adminLoggedIn) { showAdminLogin(); return; }
  document.getElementById('admin-panel').classList.remove('hidden');
  populateAdminSelects(); renderAdminCities(); renderAdminCategories(); renderAdminCompanies(); renderBannerList(); renderFooterBannerList(); renderHomeFooterBannerList(); renderAdminSubcategories(); loadVisualAdmin();
}
function closeAdmin() { document.getElementById('admin-panel').classList.add('hidden'); window.location.hash = ''; }

async function changeAdminPassword() {
  const current = document.getElementById('change-pw-current').value;
  const newPw   = document.getElementById('change-pw-new').value.trim();
  const confirm = document.getElementById('change-pw-confirm').value.trim();
  const msg     = document.getElementById('change-pw-msg');

  const show = (text, color) => { msg.textContent = text; msg.style.color = color; msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); };

  if (!current || !newPw || !confirm) return show('Preencha todos os campos.', '#ffaa44');
  if (newPw !== confirm) return show('As senhas novas não coincidem.', '#ff6b6b');
  if (newPw.length < 6) return show('A nova senha deve ter pelo menos 6 caracteres.', '#ffaa44');

  const currentHash = await hashPassword(current);
  const doc = await db.collection('settings').doc('auth').get();
  if (!doc.exists || doc.data().hash !== currentHash) return show('Senha atual incorreta.', '#ff6b6b');

  const newHash = await hashPassword(newPw);
  await db.collection('settings').doc('auth').set({ hash: newHash });
  document.getElementById('change-pw-current').value = '';
  document.getElementById('change-pw-new').value = '';
  document.getElementById('change-pw-confirm').value = '';
  show('✅ Senha alterada com sucesso!', '#44ff88');
}
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.admin-tab[onclick="switchAdminTab('${tab}')"]`).classList.add('active');
  document.getElementById(`admin-tab-${tab}`).classList.add('active');
}

// ===== ADMIN SELECTS =====
function populateAdminSelects() {
  const cities = [...appData.cities].sort((a,b) => (a.order||0)-(b.order||0));
  ['cat-city-select','co-city','filter-co-city','footer-banner-city'].forEach(selId => {
    const sel = document.getElementById(selId); if (!sel) return;
    const prev = sel.value;
    if (selId === 'cat-city-select') {
      sel.innerHTML = `<option value="__todos__">🌐 Todos (todas as cidades)</option>` + cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } else {
      sel.innerHTML = cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
    if (prev) sel.value = prev;
  });
  const bannerLoc = document.getElementById('banner-location');
  if (bannerLoc) {
    const prev = bannerLoc.value;
    bannerLoc.innerHTML = `<option value="home">Tela Inicial</option>` + cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (prev) bannerLoc.value = prev;
  }
  updateCoCatSelect(); populateFilterCat();
  // Populate subcat selects
  ['subcat-city-select','subcat-add-city'].forEach(selId => {
    const sel = document.getElementById(selId); if (!sel) return;
    const prev = sel.value;
    if (selId === 'subcat-city-select') {
      sel.innerHTML = `<option value="__todos__">🌐 Todas as cidades</option>` + cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } else {
      sel.innerHTML = cities.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
    if (prev) sel.value = prev;
  });
  loadSubcatsForEdit();
  loadSubcatsAddCat();
}
function updateCoSubcatSelect() {
  const catId = document.getElementById('co-category')?.value;
  const sel = document.getElementById('co-subcategory'); if (!sel) return;
  const subCats = (appData.subcategories[catId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));
  sel.innerHTML = `<option value="">Sem subcategoria</option>` + subCats.map(sc => `<option value="${sc.id}">${sc.name}</option>`).join('');
}

function updateCoCatSelect() {
  const cityId = document.getElementById('co-city')?.value;
  const sel = document.getElementById('co-category'); if (!sel || !cityId) return;
  const cats = (appData.categories[cityId]||[]).sort((a,b) => (a.order||0)-(b.order||0));
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}
function populateFilterCat() {
  const cityId = document.getElementById('filter-co-city')?.value;
  const sel = document.getElementById('filter-co-cat'); if (!sel) return;
  const cats = appData.categories[cityId] || [];
  sel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ===== ADMIN SUBCATEGORIES =====
async function seedTaxiSubcategories() {
  // Add Carro and Moto subcategories to all Táxi categories
  showLoading('Criando subcategorias de Táxi...');
  const batch = db.batch();
  appData.cities.forEach(city => {
    const cats = appData.categories[city.id] || [];
    const taxiCat = cats.find(c => c.name === 'Táxi');
    if (taxiCat) {
      const existing = appData.subcategories[taxiCat.id] || [];
      if (existing.length === 0) {
        const sc1 = { id: `sc_${taxiCat.id}_carro`, name: 'Carro', categoryId: taxiCat.id, cityId: city.id, order: 0, imgUrl: '', emoji: '🚗' };
        const sc2 = { id: `sc_${taxiCat.id}_moto`, name: 'Moto', categoryId: taxiCat.id, cityId: city.id, order: 1, imgUrl: '', emoji: '🏍️' };
        batch.set(db.collection('subcategories').doc(sc1.id), sc1);
        batch.set(db.collection('subcategories').doc(sc2.id), sc2);
      }
    }
  });
  await batch.commit();
  hideLoading();
  alert('✅ Subcategorias Carro e Moto criadas em todas as cidades!');
}

async function addSubcategory(categoryId, name, emoji) {
  if (!name) return alert('Digite o nome da subcategoria.');
  showLoading('Adicionando subcategoria...');
  const existing = appData.subcategories[categoryId] || [];
  const catData = Object.values(appData.categories).flat().find(c => c.id === categoryId);
  const id = `sc_${categoryId}_${Date.now()}`;
  await db.collection('subcategories').doc(id).set({
    id, name, categoryId, cityId: catData?.cityId || '', order: existing.length, imgUrl: '', emoji: emoji || '📂'
  });
  hideLoading();
}

async function removeSubcategory(id) {
  const ok = await confirmDelete('Remover esta subcategoria?');
  if (!ok) return;
  showLoading('Removendo...');
  await db.collection('subcategories').doc(id).delete();
  hideLoading();
}

async function updateSubcatImg(id, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Atualizando imagem...');
  const imgUrl = await uploadImageFile(file);
  await db.collection('subcategories').doc(id).update({ imgUrl });
  invalidateCache();
  hideLoading();
}

function renderAdminSubcategories() {
  const list = document.getElementById('admin-subcategories-list'); if (!list) return;
  const cityId = document.getElementById('subcat-city-select')?.value;
  const catId = document.getElementById('subcat-cat-select')?.value;
  if (!catId) { list.innerHTML = '<p style="color:var(--text-muted)">Selecione uma categoria.</p>'; return; }

  // If "Todos" selected — show unique subcat names with global sync
  if (cityId === '__todos__') {
    // Get subcats from first city's taxi
    const firstCity = appData.cities[0];
    if (!firstCity) return;
    const firstCats = appData.categories[firstCity.id] || [];
    const firstTaxi = firstCats.find(c => c.name === 'Táxi');
    const subCats = firstTaxi ? (appData.subcategories[firstTaxi.id] || []).sort((a,b) => (a.order||0)-(b.order||0)) : [];
    if (!subCats.length) { list.innerHTML = '<p style="color:var(--text-muted)">Nenhuma subcategoria encontrada.</p>'; return; }
    list.innerHTML = `<p style="color:var(--text-muted);font-size:12px;margin-bottom:10px">🌐 Alterar imagem aqui aplica em <strong style="color:var(--gold)">todas as cidades</strong>.</p>` +
      subCats.map(sc => `
        <div class="admin-list-item">
          ${sc.imgUrl ? `<img src="${sc.imgUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : `<span style="font-size:24px">${sc.emoji||'📂'}</span>`}
          <span class="admin-list-item-name">${sc.name}</span>
          <div class="admin-item-actions">
            <label class="admin-mini-btn edit" style="cursor:pointer;background:rgba(240,192,80,0.18)" title="Trocar imagem em TODAS as cidades">
              🌐🖼
              <input type="file" accept="image/*" style="display:none" onchange="updateSubcatImgAllCities('${sc.name.replace(/'/g,"\'")}',this)">
            </label>
          </div>
        </div>`).join('');
    return;
  }

  const subCats = (appData.subcategories[catId] || []).sort((a,b) => (a.order||0)-(b.order||0));
  if (!subCats.length) { list.innerHTML = '<p style="color:var(--text-muted)">Nenhuma subcategoria.</p>'; return; }
  list.innerHTML = subCats.map(sc => `
    <div class="admin-list-item">
      ${sc.imgUrl ? `<img src="${sc.imgUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : `<span style="font-size:24px">${sc.emoji||'📂'}</span>`}
      <span class="admin-list-item-name">${sc.name}</span>
      <div class="admin-item-actions">
        <label class="admin-mini-btn edit" style="cursor:pointer" title="Trocar imagem">
          🖼
          <input type="file" accept="image/*" style="display:none" onchange="updateSubcatImg('${sc.id}',this)">
        </label>
        <button class="admin-mini-btn del" onclick="removeSubcategory('${sc.id}')">🗑</button>
      </div>
    </div>`).join('');
}

async function updateSubcatImgAllCities(subcatName, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Sincronizando imagem em todas as cidades...');
  const imgUrl = await uploadImageFile(file);
  const batch = db.batch();
  // Find all subcategories with this name across all cities
  Object.values(appData.subcategories).flat().forEach(sc => {
    if (sc.name === subcatName) {
      batch.update(db.collection('subcategories').doc(sc.id), { imgUrl });
    }
  });
  await batch.commit();
  hideLoading();
  alert(`✅ Imagem de "${subcatName}" atualizada em todas as cidades!`);
}

function loadSubcatsForEdit() {
  const cityId = document.getElementById('subcat-city-select')?.value || '__todos__';
  const sel = document.getElementById('subcat-cat-select'); if (!sel) return;
  let cats = [];
  if (cityId === '__todos__') {
    const firstCity = appData.cities[0];
    cats = firstCity ? (appData.categories[firstCity.id]||[]).sort((a,b)=>(a.order||0)-(b.order||0)) : [];
  } else {
    cats = (appData.categories[cityId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));
  }
  sel.innerHTML = `<option value="">— Selecione a categoria —</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  // Auto-select Táxi if exists
  const taxiOpt = Array.from(sel.options).find(o => o.text === 'Táxi');
  if (taxiOpt) { sel.value = taxiOpt.value; renderAdminSubcategories(); }
}

function loadSubcatsAddCat() {
  const cityId = document.getElementById('subcat-add-city')?.value;
  const sel = document.getElementById('subcat-add-cat'); if (!sel || !cityId) return;
  const cats = (appData.categories[cityId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));
  sel.innerHTML = `<option value="">— Selecione a categoria —</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function addSubcategoryFromForm() {
  const catId = document.getElementById('subcat-add-cat')?.value;
  const name = document.getElementById('new-subcat-name')?.value;
  const emoji = document.getElementById('new-subcat-emoji')?.value;
  addSubcategory(catId, name, emoji);
}

function updateSubcatCatSelect() {
  const cityId = document.getElementById('subcat-city-select')?.value;
  const sel = document.getElementById('subcat-cat-select'); if (!sel || !cityId) return;
  if (cityId === '__todos__') {
    // Show category names only (no IDs needed)
    const firstCity = appData.cities[0];
    const cats = firstCity ? (appData.categories[firstCity.id]||[]).sort((a,b)=>(a.order||0)-(b.order||0)) : [];
    sel.innerHTML = `<option value="">Selecione a categoria</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } else {
    const cats = (appData.categories[cityId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));
    sel.innerHTML = `<option value="">Selecione a categoria</option>` + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
}

// ===== ADMIN CITIES =====
function previewCityImg(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('city-img-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}

// Clear cache when admin saves changes so users get fresh data
function invalidateCache() { clearCache(); }

async function addCity() {
  const name = document.getElementById('new-city-name').value.trim();
  if (!name) return alert('Digite o nome da cidade.');
  const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (appData.cities.find(c => c.id === id)) return alert('Cidade já existe.');
  showLoading('Adicionando cidade...');
  let imgUrl = '';
  const imgFile = document.getElementById('new-city-img').files[0];
  if (imgFile) imgUrl = await uploadImageFile(imgFile);
  const batch = db.batch();
  batch.set(db.collection('cities').doc(id), { id, name, order: appData.cities.length, imgUrl });
  DEFAULT_CAT_NAMES.forEach((catName, i) => {
    const cat = { id: `cat_${id}_${i}`, name: catName, cityId: id, order: i, imgUrl: '' };
    batch.set(db.collection('categories').doc(cat.id), cat);
  });
  await batch.commit();
  document.getElementById('new-city-name').value = '';
  document.getElementById('new-city-img').value = '';
  document.getElementById('city-img-preview').style.display = 'none';
  hideLoading();
}
async function removeCity(id) {
  const city = appData.cities.find(c => c.id === id);
  const ok = await confirmDelete(`Remover a cidade "<strong>${city?.name}</strong>" e todas suas categorias e empresas?`);
  if (!ok) return;
  showLoading('Removendo...');
  const batch = db.batch();
  batch.delete(db.collection('cities').doc(id));
  (appData.categories[id]||[]).forEach(cat => batch.delete(db.collection('categories').doc(cat.id)));
  appData.companies.filter(c => c.cityId === id).forEach(co => batch.delete(db.collection('companies').doc(co.id)));
  await batch.commit(); hideLoading();
}
async function toggleCityVisibility(id) {
  const city = appData.cities.find(c => c.id === id);
  if (!city) return;
  const action = city.hidden ? 'mostrar' : 'ocultar';
  const ok = await confirmDelete(`Deseja ${action} a cidade "<strong>${city.name}</strong>"?`);
  if (!ok) return;
  showLoading(city.hidden ? 'Exibindo cidade...' : 'Ocultando cidade...');
  await db.collection('cities').doc(id).update({ hidden: !city.hidden });
  hideLoading();
}

async function moveCityUp(id) {
  const sorted = [...appData.cities].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(c => c.id === id); if (idx <= 0) return;
  const orderA = sorted[idx-1].order ?? (idx-1);
  const orderB = sorted[idx].order ?? idx;
  await db.collection('cities').doc(sorted[idx-1].id).update({ order: orderB });
  await db.collection('cities').doc(sorted[idx].id).update({ order: orderA });
}
async function moveCityDown(id) {
  const sorted = [...appData.cities].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(c => c.id === id); if (idx >= sorted.length-1) return;
  const orderA = sorted[idx].order ?? idx;
  const orderB = sorted[idx+1].order ?? (idx+1);
  await db.collection('cities').doc(sorted[idx].id).update({ order: orderB });
  await db.collection('cities').doc(sorted[idx+1].id).update({ order: orderA });
}
function renderAdminCities() {
  const list = document.getElementById('admin-cities-list');
  const sorted = [...appData.cities].sort((a,b) => (a.order||0)-(b.order||0));
  list.innerHTML = sorted.map(city => `
    <div class="admin-list-item" style="${city.hidden ? 'opacity:0.5' : ''}">
      ${city.imgUrl ? `<img src="${city.imgUrl}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : '<span style="font-size:26px">🏙️</span>'}
      <div class="admin-list-item-name">
        <strong>${city.name}</strong><br>
        ${city.hidden
          ? `<small style="color:#ffaa44">👁️‍🗨️ Oculta</small>`
          : `<small style="color:#aaffaa">👁️ Visível</small>`}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
        <div style="display:flex;gap:5px">
          <button class="admin-mini-btn" onclick="moveCityUp('${city.id}')">↑</button>
          <button class="admin-mini-btn" onclick="moveCityDown('${city.id}')">↓</button>
          <button class="admin-mini-btn" onclick="toggleCityVisibility('${city.id}')" title="${city.hidden ? 'Mostrar cidade' : 'Ocultar cidade'}" style="${city.hidden ? 'color:#ffaa44;border-color:#ffaa44' : 'color:#aaffaa;border-color:#44cc44'}">
            ${city.hidden ? '🙈 Oculta' : '👁️ Visível'}
          </button>
        </div>
        <div style="display:flex;gap:5px">
          <label class="admin-mini-btn edit" title="Trocar imagem" style="cursor:pointer">
            🖼
            <input type="file" accept="image/*" style="display:none" onchange="updateCityImg('${city.id}',this)">
          </label>
          ${city.imgUrl ? `<button class="admin-mini-btn" onclick="removeCityImg('${city.id}')" style="color:#ffaa44;font-size:11px">✕img</button>` : ''}
          <button class="admin-mini-btn del" onclick="removeCity('${city.id}')">🗑</button>
        </div>
      </div>
    </div>`).join('') || '<p style="color:var(--text-muted);text-align:center">Nenhuma cidade.</p>';
}

async function updateCityImg(cityId, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Atualizando imagem...');
  const imgUrl = await uploadImageFile(file);
  await db.collection('cities').doc(cityId).update({ imgUrl });
  invalidateCache();
  hideLoading();
}

async function removeCityImg(cityId) {
  if (!confirm('Remover imagem do card desta cidade?')) return;
  showLoading('Removendo imagem...');
  await db.collection('cities').doc(cityId).update({ imgUrl: '' });
  hideLoading();
}

// ===== ADMIN CATEGORIES =====
function previewCatImg(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('cat-img-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}
async function addCategory() {
  const cityId = document.getElementById('cat-city-select').value;
  const name = document.getElementById('new-cat-name').value.trim();
  if (!name) return alert('Digite o nome da categoria.');
  showLoading('Salvando categoria...');
  const id = 'cat_' + cityId + '_' + Date.now();
  const cats = appData.categories[cityId] || [];
  let imgUrl = '';
  const imgFile = document.getElementById('new-cat-img').files[0];
  if (imgFile) imgUrl = await uploadImageFile(imgFile);
  await db.collection('categories').doc(id).set({ id, name, cityId, order: cats.length, imgUrl });
  document.getElementById('new-cat-name').value = '';
  document.getElementById('new-cat-img').value = '';
  document.getElementById('cat-img-preview').style.display = 'none';
  hideLoading();
}
async function removeCategory(cityId, catId) {
  const cats = appData.categories[cityId] || [];
  const cat = cats.find(c => c.id === catId);
  const ok = await confirmDelete(`Remover a categoria "<strong>${cat?.name}</strong>" e todas suas empresas?`);
  if (!ok) return;
  showLoading('Removendo...');
  const batch = db.batch();
  batch.delete(db.collection('categories').doc(catId));
  appData.companies.filter(c => c.categoryId === catId).forEach(co => batch.delete(db.collection('companies').doc(co.id)));
  await batch.commit(); hideLoading();
}
async function moveCatUp(cityId, catId) {
  const cats = (appData.categories[cityId]||[]).sort((a,b) => (a.order??0)-(b.order??0));
  const idx = cats.findIndex(c => c.id === catId); if (idx <= 0) return;
  const orderA = cats[idx-1].order ?? (idx-1);
  const orderB = cats[idx].order ?? idx;
  await db.collection('categories').doc(cats[idx-1].id).update({ order: orderB });
  await db.collection('categories').doc(cats[idx].id).update({ order: orderA });
}
async function moveCatDown(cityId, catId) {
  const cats = (appData.categories[cityId]||[]).sort((a,b) => (a.order??0)-(b.order??0));
  const idx = cats.findIndex(c => c.id === catId); if (idx >= cats.length-1) return;
  const orderA = cats[idx].order ?? idx;
  const orderB = cats[idx+1].order ?? (idx+1);
  await db.collection('categories').doc(cats[idx].id).update({ order: orderB });
  await db.collection('categories').doc(cats[idx+1].id).update({ order: orderA });
}
function renderAdminCategories() {
  const cityId = document.getElementById('cat-city-select')?.value;
  const list = document.getElementById('admin-categories-list'); if (!list || !cityId) return;

  // TODOS — show all unique categories with global sync button
  if (cityId === '__todos__') {
    const firstCity = appData.cities[0];
    const cats = firstCity ? (appData.categories[firstCity.id]||[]).sort((a,b)=>(a.order||0)-(b.order||0)) : [];
    list.innerHTML = `<p style="color:var(--text-muted);font-size:12px;margin-bottom:10px">🌐 Alterar imagem aqui aplica em <strong style="color:var(--gold)">todas as cidades</strong> de uma vez.</p>` +
      cats.map(cat => `
        <div class="admin-list-item">
          ${cat.imgUrl ? `<img src="${cat.imgUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : `<span style="font-size:24px">${CAT_EMOJI[cat.name]||'📂'}</span>`}
          <span class="admin-list-item-name" style="font-size:13px">${cat.name}</span>
          <div class="admin-item-actions">
            <label class="admin-mini-btn edit" title="Alterar imagem em TODAS as cidades" style="cursor:pointer;background:rgba(240,192,80,0.18)">
              🌐🖼
              <input type="file" accept="image/*" style="display:none" onchange="updateCatImgAllCities('${cat.name.replace(/'/g,"\'")}',this)">
            </label>
          </div>
        </div>`).join('') || '<p style="color:var(--text-muted)">Nenhuma categoria.</p>';
    return;
  }

  // Single city
  const cats = (appData.categories[cityId]||[]).sort((a,b)=>(a.order||0)-(b.order||0));
  list.innerHTML = cats.map(cat => `
    <div class="admin-list-item">
      ${cat.imgUrl ? `<img src="${cat.imgUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : `<span style="font-size:24px">${CAT_EMOJI[cat.name]||'📂'}</span>`}
      <span class="admin-list-item-name">${cat.name}</span>
      <div class="admin-item-actions">
        <button class="admin-mini-btn" onclick="moveCatUp('${cityId}','${cat.id}')">↑</button>
        <button class="admin-mini-btn" onclick="moveCatDown('${cityId}','${cat.id}')">↓</button>
        <label class="admin-mini-btn edit" title="Trocar imagem" style="cursor:pointer">
          🖼
          <input type="file" accept="image/*" style="display:none" onchange="updateCatImg('${cityId}','${cat.id}',this)">
        </label>
        <button class="admin-mini-btn del" onclick="removeCategory('${cityId}','${cat.id}')">🗑</button>
      </div>
    </div>`).join('') || '<p style="color:var(--text-muted)">Nenhuma categoria.</p>';
}

// ===== SYNC CATEGORY IMAGE TO ALL CITIES =====
async function updateCatImgAllCities(catName, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Sincronizando imagem em todas as cidades...');
  const imgUrl = await uploadImageFile(file);
  const batch = db.batch();
  appData.cities.forEach(city => {
    const cats = appData.categories[city.id] || [];
    const cat = cats.find(c => c.name === catName);
    if (cat) batch.update(db.collection('categories').doc(cat.id), { imgUrl });
  });
  await batch.commit();
  invalidateCache();
  hideLoading();
  alert(`✅ Imagem atualizada em todas as cidades para "${catName}"!`);
}

async function updateCatImg(cityId, catId, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Atualizando imagem...');
  const imgUrl = await uploadImageFile(file);
  await db.collection('categories').doc(catId).update({ imgUrl });
  invalidateCache();
  hideLoading();
}

// ===== ADMIN COMPANIES =====
function previewCoLogo(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('co-logo-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}
function normalizeInstagram(val) {
  if (!val) return '';
  // Already a full URL
  if (val.startsWith('http')) return val;
  // Remove @ if typed
  val = val.replace(/^@/, '');
  return 'https://instagram.com/' + val;
}

// Same for TikTok
function normalizeTiktok(val) {
  if (!val) return '';
  if (val.startsWith('http')) return val;
  val = val.replace(/^@/, '');
  return 'https://www.tiktok.com/@' + val;
}

async function saveCompany() {
  const name = document.getElementById('co-name').value.trim();
  const phone = document.getElementById('co-phone').value.trim();
  if (!name) return alert('Nome da empresa é obrigatório.');
  showLoading('Salvando empresa...');
  const id = editingCompanyId || ('co_' + Date.now());
  const cityId = document.getElementById('co-city').value;
  const categoryId = document.getElementById('co-category').value;
  const logoFile = document.getElementById('co-logo').files[0];
  let logoUrl = editingCompanyId ? (appData.companies.find(c => c.id === editingCompanyId)?.logoUrl || '') : '';
  if (logoFile) logoUrl = await uploadImageFile(logoFile, 900, 0.82);
  const existingOrder = editingCompanyId ? (appData.companies.find(c => c.id === editingCompanyId)?.order ?? 0) : appData.companies.filter(c => c.categoryId === categoryId).length;
  invalidateCache();
  await db.collection('companies').doc(id).set({
    id, name, cityId, categoryId, phone,
    whatsapp: document.getElementById('co-whatsapp').value.trim(),
    whatsapp2: document.getElementById('co-whatsapp2').value.trim(),
    whatsapp3: document.getElementById('co-whatsapp3').value.trim(),
    desc: document.getElementById('co-desc').value.trim(),
    hours: document.getElementById('co-hours').value.trim(),
    cardapio: document.getElementById('co-cardapio').value.trim(),
    email: document.getElementById('co-email').value.trim(),
    agenda: document.getElementById('co-agenda').value.trim(),
    instagram: normalizeInstagram(document.getElementById('co-instagram').value.trim()),
    tiktok: normalizeTiktok(document.getElementById('co-tiktok').value.trim()),
    site: document.getElementById('co-site').value.trim(),
    maps: document.getElementById('co-maps').value.trim(),
    radioLink: document.getElementById('co-radio').value.trim(),
    subCategoryId: document.getElementById('co-subcategory')?.value.trim() || '',
    logoUrl, order: existingOrder
  });
  clearCompanyForm(); hideLoading();
}
function editCompany(id) {
  const co = appData.companies.find(c => c.id === id); if (!co) return;
  editingCompanyId = id;
  document.getElementById('co-name').value = co.name;
  document.getElementById('co-city').value = co.cityId;
  updateCoCatSelect();
  setTimeout(() => { document.getElementById('co-category').value = co.categoryId; }, 80);
  // For display in edit form, show just the handle for instagram/tiktok
  const instagramVal = co.instagram ? co.instagram.replace('https://instagram.com/','').replace('https://www.instagram.com/','') : '';
  const tiktokVal = co.tiktok ? co.tiktok.replace('https://tiktok.com/@','').replace('https://www.tiktok.com/@','') : '';
  document.getElementById('co-instagram').value = instagramVal;
  document.getElementById('co-tiktok').value = tiktokVal;
  ['phone','whatsapp','whatsapp2','whatsapp3','desc','hours','cardapio','site','maps','radio'].forEach(f => {
    const el = document.getElementById('co-' + f);
    if (el) el.value = co[f] || '';
  });
  if (co.logoUrl) { const p = document.getElementById('co-logo-preview'); p.src = co.logoUrl; p.style.display = 'block'; }
  document.getElementById('co-save-btn').textContent = '💾 Salvar Alterações';
  document.getElementById('co-cancel-btn').classList.remove('hidden');
  switchAdminTab('companies');
  document.getElementById('co-name').scrollIntoView({ behavior: 'smooth' });
}
function cancelEditCompany() { clearCompanyForm(); }
function clearCompanyForm() {
  editingCompanyId = null;
  ['co-name','co-phone','co-whatsapp','co-whatsapp2','co-whatsapp3','co-desc','co-hours','co-cardapio','co-email','co-agenda','co-instagram','co-tiktok','co-site','co-maps','co-radio'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('co-logo').value = '';
  const p = document.getElementById('co-logo-preview'); p.src = ''; p.style.display = 'none';
  document.getElementById('co-save-btn').textContent = '+ Adicionar Empresa';
  document.getElementById('co-cancel-btn').classList.add('hidden');
}
async function removeCompany(id) {
  const co = appData.companies.find(c => c.id === id);
  const ok = await confirmDelete(`Remover a empresa "<strong>${co?.name}</strong>"?`);
  if (!ok) return;
  showLoading('Removendo...'); await db.collection('companies').doc(id).delete(); hideLoading();
}
async function moveCoUp(id) {
  const co = appData.companies.find(c => c.id === id); if (!co) return;
  const same = appData.companies.filter(c => c.categoryId === co.categoryId && c.cityId === co.cityId).sort((a,b) => (a.order??0)-(b.order??0));
  const idx = same.findIndex(c => c.id === id); if (idx <= 0) return;
  const orderA = same[idx-1].order ?? (idx-1);
  const orderB = same[idx].order ?? idx;
  await db.collection('companies').doc(same[idx-1].id).update({ order: orderB });
  await db.collection('companies').doc(same[idx].id).update({ order: orderA });
}
async function moveCoDown(id) {
  const co = appData.companies.find(c => c.id === id); if (!co) return;
  const same = appData.companies.filter(c => c.categoryId === co.categoryId && c.cityId === co.cityId).sort((a,b) => (a.order??0)-(b.order??0));
  const idx = same.findIndex(c => c.id === id); if (idx >= same.length-1) return;
  const orderA = same[idx].order ?? idx;
  const orderB = same[idx+1].order ?? (idx+1);
  await db.collection('companies').doc(same[idx].id).update({ order: orderB });
  await db.collection('companies').doc(same[idx+1].id).update({ order: orderA });
}
function renderAdminCompanies() {
  const list = document.getElementById('admin-companies-list'); if (!list) return;
  const cityId = document.getElementById('filter-co-city')?.value;
  const catId = document.getElementById('filter-co-cat')?.value;
  const search = (document.getElementById('admin-co-search')?.value || '').toLowerCase().trim();

  // Global counter (always all companies)
  const allCompanies = appData.companies;
  const globalTotal = allCompanies.length;
  const globalWithPhoto = allCompanies.filter(c => c.logoUrl).length;
  const globalWithout = globalTotal - globalWithPhoto;
  const globalCounter = document.getElementById('admin-global-counter');
  if (globalCounter) {
    globalCounter.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:5px;width:100%">
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(240,192,80,0.1);border:1px solid rgba(240,192,80,0.3);border-radius:6px;padding:4px 8px">
          <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Total</span>
          <span style="font-family:Cinzel,serif;font-size:12px;color:var(--gold);font-weight:700">${globalTotal}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(45,122,45,0.15);border:1px solid rgba(45,122,45,0.3);border-radius:6px;padding:4px 8px">
          <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Com foto</span>
          <span style="font-family:Cinzel,serif;font-size:12px;color:#6dba6d;font-weight:700">${globalWithPhoto}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(192,80,80,0.15);border:1px solid rgba(192,80,80,0.3);border-radius:6px;padding:4px 8px">
          <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase">Sem foto</span>
          <span style="font-family:Cinzel,serif;font-size:12px;color:#e07070;font-weight:700">${globalWithout}</span>
        </div>
      </div>`;
  }

  let companies = appData.companies;
  if (cityId) companies = companies.filter(c => c.cityId === cityId);
  if (catId) companies = companies.filter(c => c.categoryId === catId);
  if (search) companies = companies.filter(c => normalizeText(c.name).includes(normalizeText(search)));
  companies = companies.sort((a,b) => (a.order||0)-(b.order||0));

  // Counters
  const total = companies.length;
  const withPhoto = companies.filter(c => c.logoUrl).length;
  const withoutPhoto = total - withPhoto;
  let counterEl = document.getElementById('admin-co-counter');
  if (!counterEl) {
    counterEl = document.createElement('div');
    counterEl.id = 'admin-co-counter';
    counterEl.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px';
    list.parentNode.insertBefore(counterEl, list);
  }
  counterEl.innerHTML = `
    <div style="background:rgba(240,192,80,0.12);border:1px solid var(--border);border-radius:8px;padding:8px 14px;flex:1;text-align:center">
      <div style="font-family:Cinzel,serif;font-size:20px;color:var(--gold);font-weight:700">${total}</div>
      <div style="font-size:11px;color:var(--text-muted)">Total</div>
    </div>
    <div style="background:rgba(240,192,80,0.12);border:1px solid var(--border);border-radius:8px;padding:8px 14px;flex:1;text-align:center">
      <div style="font-family:Cinzel,serif;font-size:20px;color:#aaffaa;font-weight:700">${withPhoto}</div>
      <div style="font-size:11px;color:var(--text-muted)">Com foto</div>
    </div>
    <div style="background:rgba(240,192,80,0.12);border:1px solid var(--border);border-radius:8px;padding:8px 14px;flex:1;text-align:center">
      <div style="font-family:Cinzel,serif;font-size:20px;color:#ffaa88;font-weight:700">${withoutPhoto}</div>
      <div style="font-size:11px;color:var(--text-muted)">Sem foto</div>
    </div>`;

  if (!companies.length) { list.innerHTML = '<p style="color:var(--text-muted);text-align:center">Nenhuma empresa encontrada.</p>'; return; }
  list.innerHTML = companies.map(co => {
    const city = appData.cities.find(c => c.id === co.cityId);
    const cat = (appData.categories[co.cityId]||[]).find(c => c.id === co.categoryId);
    return `
      <div class="admin-list-item">
        ${co.logoUrl ? `<img src="${co.logoUrl}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--border)">` : '<span style="font-size:24px">🏢</span>'}
        <div class="admin-list-item-name">
          <strong>${co.name}</strong><br>
          <small style="color:var(--text-muted)">${city?.name||''} • ${cat?.name||''}</small>
        </div>
        <div class="admin-item-actions">
          <button class="admin-mini-btn" onclick="moveCoUp('${co.id}')">↑</button>
          <button class="admin-mini-btn" onclick="moveCoDown('${co.id}')">↓</button>
          ${co.logoUrl ? `<button class="admin-mini-btn" onclick="downloadCompanyLogo('${co.name.replace(/'/g,"\'")}','${co.logoUrl}')" title="Baixar logo">⬇️</button>` : ''}
          <button class="admin-mini-btn edit" onclick="editCompany('${co.id}')">✏️</button>
          <button class="admin-mini-btn del" onclick="removeCompany('${co.id}')">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ===== DOWNLOAD COMPANY LOGO =====
function downloadCompanyLogo(name, logoUrl) {
  if (!logoUrl) return alert('Esta empresa não tem logo cadastrada.');
  const a = document.createElement('a');
  a.href = logoUrl;
  a.download = name.replace(/[^a-z0-9]/gi, '_') + '_logo.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===== ADMIN BANNERS =====
function previewBannerImg(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('banner-img-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}
async function addBanner() {
  const loc = document.getElementById('banner-location').value;
  const link = document.getElementById('banner-link').value.trim();
  const file = document.getElementById('banner-img-upload').files[0];
  if (!file) return alert('Selecione uma imagem.');
  showLoading('Salvando banner...');
  const id = 'bn_' + Date.now();
  // Banners podem ser maiores, usar qualidade menor
  const imgUrl = await uploadImageFile(file, 1200, 0.70);
  const existing = loc === 'home' ? (appData.banners.home||[]) : (appData.cityBanners[loc]||[]);
  await db.collection('banners').doc(id).set({ id, location: loc, link, imgUrl, order: existing.length });
  document.getElementById('banner-link').value = '';
  document.getElementById('banner-img-upload').value = '';
  document.getElementById('banner-img-preview').style.display = 'none';
  hideLoading();
}
async function moveBannerUp(loc, id) {
  const banners = loc === 'home' ? (appData.banners.home||[]) : (appData.cityBanners[loc]||[]);
  const sorted = [...banners].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(b => b.id === id); if (idx <= 0) return;
  const orderA = sorted[idx-1].order ?? (idx-1);
  const orderB = sorted[idx].order ?? idx;
  const batch = db.batch();
  batch.update(db.collection('banners').doc(sorted[idx-1].id), { order: orderB });
  batch.update(db.collection('banners').doc(sorted[idx].id), { order: orderA });
  await batch.commit();
  invalidateCache();
}

async function moveBannerDown(loc, id) {
  const banners = loc === 'home' ? (appData.banners.home||[]) : (appData.cityBanners[loc]||[]);
  const sorted = [...banners].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(b => b.id === id); if (idx >= sorted.length-1) return;
  const orderA = sorted[idx].order ?? idx;
  const orderB = sorted[idx+1].order ?? (idx+1);
  const batch = db.batch();
  batch.update(db.collection('banners').doc(sorted[idx].id), { order: orderB });
  batch.update(db.collection('banners').doc(sorted[idx+1].id), { order: orderA });
  await batch.commit();
  invalidateCache();
}

// ===== EDIT FULL BANNER (image + link) =====
function editBanner(id, collection) {
  // Create edit modal
  const existing = document.getElementById('banner-edit-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'banner-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:linear-gradient(135deg,#3d1f0a,#2a1005);border:2px solid var(--gold);border-radius:14px;padding:24px;width:100%;max-width:340px;box-shadow:0 10px 40px rgba(0,0,0,0.7)">
      <h3 style="font-family:Cinzel,serif;color:var(--gold);font-size:16px;margin-bottom:16px">✏️ Editar Banner</h3>
      <label style="color:var(--gold-light);font-size:12px;font-family:Cinzel,serif;text-transform:uppercase">Nova imagem (opcional):</label>
      <input type="file" id="banner-edit-img" accept="image/*" class="admin-file-input" style="margin:8px 0">
      <label style="color:var(--gold-light);font-size:12px;font-family:Cinzel,serif;text-transform:uppercase;margin-top:8px;display:block">Link (opcional):</label>
      <input type="text" id="banner-edit-link" class="admin-input" style="margin:8px 0" placeholder="https://...">
      <div style="display:flex;gap:10px;margin-top:16px">
        <button onclick="document.getElementById('banner-edit-modal').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:50px;color:var(--text-main);font-family:Cinzel,serif;font-size:13px;cursor:pointer">Cancelar</button>
        <button onclick="saveBannerEdit('${id}','${collection}')" style="flex:1;padding:12px;background:linear-gradient(135deg,var(--gold),var(--amber));border:none;border-radius:50px;color:#1a0a02;font-family:Cinzel,serif;font-size:13px;font-weight:700;cursor:pointer">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function saveBannerEdit(id, collection) {
  const file = document.getElementById('banner-edit-img')?.files[0];
  const link = document.getElementById('banner-edit-link')?.value.trim();
  if (!file && link === undefined) return;
  showLoading('Salvando...');
  const updates = {};
  if (file) updates.imgUrl = await uploadImageFile(file, 1200, 0.70);
  if (link !== undefined) updates.link = link;
  await db.collection(collection).doc(id).update(updates);
  invalidateCache();
  document.getElementById('banner-edit-modal')?.remove();
  hideLoading();
}

async function editBannerLink(id, currentLink) {
  const newLink = prompt('Link do banner (deixe vazio para remover):', currentLink || '');
  if (newLink === null) return; // cancelled
  showLoading('Salvando...');
  await db.collection('banners').doc(id).update({ link: newLink.trim() });
  invalidateCache();
  hideLoading();
}

async function editFooterBannerLink(id, currentLink) {
  const newLink = prompt('Link do banner (deixe vazio para remover):', currentLink || '');
  if (newLink === null) return;
  showLoading('Salvando...');
  await db.collection('footerBanners').doc(id).update({ link: newLink.trim() });
  invalidateCache();
  hideLoading();
}

async function removeBanner(loc, id) {
  showLoading('Removendo...'); await db.collection('banners').doc(id).delete(); hideLoading();
}

async function moveFooterBannerUp(cityId, id) {
  const banners = (appData.footerBanners[cityId]||[]);
  const sorted = [...banners].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(b => b.id === id); if (idx <= 0) return;
  const orderA = sorted[idx-1].order ?? (idx-1);
  const orderB = sorted[idx].order ?? idx;
  const batch = db.batch();
  batch.update(db.collection('footerBanners').doc(sorted[idx-1].id), { order: orderB });
  batch.update(db.collection('footerBanners').doc(sorted[idx].id), { order: orderA });
  await batch.commit();
  invalidateCache();
}

async function moveFooterBannerDown(cityId, id) {
  const banners = (appData.footerBanners[cityId]||[]);
  const sorted = [...banners].sort((a,b) => (a.order??0)-(b.order??0));
  const idx = sorted.findIndex(b => b.id === id); if (idx >= sorted.length-1) return;
  const orderA = sorted[idx].order ?? idx;
  const orderB = sorted[idx+1].order ?? (idx+1);
  const batch = db.batch();
  batch.update(db.collection('footerBanners').doc(sorted[idx].id), { order: orderB });
  batch.update(db.collection('footerBanners').doc(sorted[idx+1].id), { order: orderA });
  await batch.commit();
  invalidateCache();
}

async function removeFooterBanner(id) {
  showLoading('Removendo...'); await db.collection('footerBanners').doc(id).delete(); hideLoading();
}
function renderBannerList() {
  const loc = document.getElementById('banner-location')?.value;
  const list = document.getElementById('admin-banner-list'); if (!list || !loc) return;
  const banners = (loc === 'home' ? (appData.banners.home||[]) : (appData.cityBanners[loc]||[]))
    .sort((a,b) => (a.order||0)-(b.order||0));
  if (!banners.length) { list.innerHTML = '<p style="color:var(--text-muted)">Nenhum banner.</p>'; return; }
  list.innerHTML = banners.map((b, i) => `
    <div class="admin-list-item">
      <div style="position:relative;flex-shrink:0">
        <img src="${b.imgUrl}" style="width:70px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
        <span style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,0.7);color:var(--gold);font-family:Cinzel,serif;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px">${i+1}</span>
      </div>
      <div class="admin-list-item-name">
        <span style="font-size:12px;color:var(--text-muted)">${b.link||'Sem link'}</span><br>
        <span style="font-size:11px;color:var(--amber)">⏱ 3s</span>
      </div>
      <div class="admin-item-actions">
        <button class="admin-mini-btn" onclick="moveBannerUp('${loc}','${b.id}')" title="Mover para cima">↑</button>
        <button class="admin-mini-btn" onclick="moveBannerDown('${loc}','${b.id}')" title="Mover para baixo">↓</button>
        <button class="admin-mini-btn edit" onclick="editBanner('${b.id}','banners')" title="Editar banner">✏️</button>
        <button class="admin-mini-btn del" onclick="removeBanner('${loc}','${b.id}')">🗑</button>
      </div>
    </div>`).join('');
}
function renderFooterBannerList() {
  const cityId = document.getElementById('footer-banner-city')?.value;
  const list = document.getElementById('admin-footer-banner-list'); if (!list || !cityId) return;
  const banners = (appData.footerBanners[cityId] || []).sort((a,b) => (a.order||0)-(b.order||0));
  if (!banners.length) { list.innerHTML = '<p style="color:var(--text-muted)">Nenhum banner de rodapé.</p>'; return; }
  list.innerHTML = banners.map((b, i) => `
    <div class="admin-list-item">
      <div style="position:relative;flex-shrink:0">
        <img src="${b.imgUrl}" style="width:70px;height:30px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
        <span style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,0.7);color:var(--gold);font-family:Cinzel,serif;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px">${i+1}</span>
      </div>
      <div class="admin-list-item-name">
        <span style="font-size:12px;color:var(--text-muted)">${b.link||'Sem link'}</span><br>
        <span style="font-size:11px;color:var(--amber)">⏱ 3s</span>
      </div>
      <div class="admin-item-actions">
        <button class="admin-mini-btn" onclick="moveFooterBannerUp('${cityId}','${b.id}')">↑</button>
        <button class="admin-mini-btn" onclick="moveFooterBannerDown('${cityId}','${b.id}')">↓</button>
        <button class="admin-mini-btn del" onclick="removeFooterBanner('${b.id}')">🗑</button>
      </div>
    </div>`).join('');
}

// ===== HOME FOOTER BANNER =====
function previewHomeFooterBanner(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('home-footer-banner-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}

async function saveHomeFooterBanner() {
  const link = document.getElementById('home-footer-banner-link').value.trim();
  const file = document.getElementById('home-footer-banner-upload').files[0];
  if (!file) return alert('Selecione uma imagem.');
  showLoading('Salvando banner rodapé...');
  const id = 'hfb_' + Date.now();
  const imgUrl = await uploadImageFile(file, 1200, 0.70);
  const existing = appData.homeFooterBanners || [];
  await db.collection('homeFooterBanners').doc(id).set({ id, link, imgUrl, order: existing.length });
  document.getElementById('home-footer-banner-link').value = '';
  document.getElementById('home-footer-banner-upload').value = '';
  document.getElementById('home-footer-banner-preview').style.display = 'none';
  hideLoading();
}

async function removeHomeFooterBanner(id) {
  showLoading('Removendo...'); await db.collection('homeFooterBanners').doc(id).delete(); hideLoading();
}

function renderHomeFooterBannerList() {
  const list = document.getElementById('admin-home-footer-banner-list'); if (!list) return;
  const banners = (appData.homeFooterBanners || []).sort((a,b) => (a.order||0)-(b.order||0));
  if (!banners.length) { list.innerHTML = '<p style="color:var(--text-muted)">Nenhum banner.</p>'; return; }
  list.innerHTML = banners.map((b, i) => `
    <div class="admin-list-item">
      <div style="position:relative;flex-shrink:0">
        <img src="${b.imgUrl}" style="width:70px;height:30px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
        <span style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,0.7);color:var(--gold);font-family:Cinzel,serif;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px">${i+1}</span>
      </div>
      <span class="admin-list-item-name" style="font-size:12px">${b.link||'Sem link'}</span>
      <button class="admin-mini-btn del" onclick="removeHomeFooterBanner('${b.id}')">🗑</button>
    </div>`).join('');
}

function renderHomeFooterBanner() {
  const banners = (appData.homeFooterBanners || []).sort((a,b) => (a.order||0)-(b.order||0));
  const el = document.getElementById('home-footer-banner'); if (!el) return;
  if (!banners.length) { el.innerHTML = ''; return; }
  const b = banners[0];
  el.innerHTML = `<img src="${b.imgUrl}" alt="Rodapé" onclick="${b.link ? `window.open('${b.link}','_blank')` : ''}">`;
  // If multiple, rotate
  if (banners.length > 1) {
    let idx = 0;
    setInterval(() => {
      idx = (idx + 1) % banners.length;
      const b = banners[idx];
      el.innerHTML = `<img src="${b.imgUrl}" alt="Rodapé" onclick="${b.link ? `window.open('${b.link}','_blank')` : ''}">`;
    }, 4000);
  }
}

function previewFooterBanner(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader(); r.onload = e => { const p = document.getElementById('footer-banner-preview'); p.src = e.target.result; p.style.display = 'block'; }; r.readAsDataURL(file);
}
async function saveFooterBanner() {
  const cityId = document.getElementById('footer-banner-city').value;
  const link = document.getElementById('footer-banner-link').value.trim();
  const file = document.getElementById('footer-banner-upload').files[0];
  if (!file) return alert('Selecione uma imagem.');
  showLoading('Salvando rodapé...');
  const id = 'fb_' + Date.now();
  const imgUrl = await uploadImageFile(file, 1200, 0.70);
  const existing = appData.footerBanners[cityId] || [];
  const order = Array.isArray(existing) ? existing.length : 0;
  await db.collection('footerBanners').doc(id).set({ id, cityId, link, imgUrl, order });
  document.getElementById('footer-banner-link').value = '';
  document.getElementById('footer-banner-upload').value = '';
  document.getElementById('footer-banner-preview').style.display = 'none';
  hideLoading();
}

// ===== ADMIN VISUAL =====
async function uploadMascot(input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Processando mascote...');
  const url = await uploadImageFile(file, 300, 0.75);
  appData.visual.mascotUrl = url;
  await db.collection('settings').doc('mascotImg').set({ imgData: url });
  const p = document.getElementById('mascot-preview'); p.src = url; p.style.display = 'block';
  hideLoading();
}
async function uploadBg(input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Processando fundo...');
  const url = await uploadImageFile(file, 1080, 0.60);
  appData.visual.bgUrl = url;
  // Save in separate doc to avoid 1MB limit on main
  await db.collection('settings').doc('bgImg').set({ imgData: url });
  const p = document.getElementById('bg-preview'); p.src = url; p.style.display = 'block';
  applyVisual();
  hideLoading();
}
async function saveVisual() {
  showLoading('Salvando configurações...');
  try {
    // Save ONLY text settings - no images here to avoid 1MB limit
    await db.collection('settings').doc('main').set({
      advertiseLink: document.getElementById('advertise-link-input').value.trim(),
      reviewAndroid: document.getElementById('review-android-input').value.trim(),
      reviewIos: document.getElementById('review-ios-input').value.trim(),
      reviewInstagram: document.getElementById('review-instagram-input')?.value.trim() || ''
    });
    hideLoading();
    alert('✅ Configurações salvas!');
  } catch(e) {
    hideLoading();
    alert('Erro ao salvar: ' + e.message);
  }
}
function loadVisualAdmin() {
  const colors = appData.visual.colors || DEFAULT_COLORS;
  loadColorInputs(colors);
  const v = appData.visual;
  document.getElementById('advertise-link-input').value = v.advertiseLink || '';
  document.getElementById('review-android-input').value = v.reviewAndroid || '';
  document.getElementById('review-ios-input').value = v.reviewIos || '';
  const rigEl = document.getElementById('review-instagram-input'); if (rigEl) rigEl.value = v.reviewInstagram || '';
  if (v.mascotUrl) { const p = document.getElementById('mascot-preview'); p.src = v.mascotUrl; p.style.display = 'block'; }
  if (v.bgUrl) { const p = document.getElementById('bg-preview'); p.src = v.bgUrl; p.style.display = 'block'; }
  ['emergency','advertise','review'].forEach(key => {
    const img = v[key + 'CardImg'];
    if (img) { const p = document.getElementById(key + '-img-preview'); if (p) { p.src = img; p.style.display = 'block'; } }
  });
  if (v.homeHeaderImg) { const p = document.getElementById('home-header-preview'); if (p) { p.src = v.homeHeaderImg; p.style.display = 'block'; } }
}

// ===== DELETE PASSWORD =====
const DELETE_PASS = '1414';
async function confirmDelete(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:linear-gradient(135deg,#3d1f0a,#2a1005);border:2px solid #f0c050;border-radius:14px;padding:24px;width:100%;max-width:340px;box-shadow:0 10px 40px rgba(0,0,0,0.7)">
        <h3 style="font-family:Cinzel,serif;color:#f0c050;font-size:16px;margin-bottom:8px">⚠️ Confirmar Exclusão</h3>
        <p style="color:#f5deb3;font-size:14px;margin-bottom:16px;line-height:1.4">${message}</p>
        <p style="color:#c8a87a;font-size:13px;margin-bottom:10px">Digite a senha para confirmar:</p>
        <input type="password" id="del-pass-input" placeholder="Senha de exclusão" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.08);border:1.5px solid #6b3d1a;border-radius:8px;color:#f5deb3;font-size:15px;outline:none;margin-bottom:6px">
        <p id="del-pass-err" style="color:#ff6b6b;font-size:12px;display:none;margin-bottom:8px">Senha incorreta.</p>
        <div style="display:flex;gap:10px;margin-top:10px">
          <button id="del-cancel-btn" style="flex:1;padding:11px;background:rgba(255,255,255,0.08);border:1px solid #6b3d1a;border-radius:50px;color:#f5deb3;font-family:Cinzel,serif;font-size:13px;cursor:pointer">Cancelar</button>
          <button id="del-confirm-btn" style="flex:1;padding:11px;background:linear-gradient(135deg,#7a1010,#b01c1c);border:none;border-radius:50px;color:#fff;font-family:Cinzel,serif;font-size:13px;font-weight:700;cursor:pointer">🗑 Excluir</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#del-pass-input');
    const err = overlay.querySelector('#del-pass-err');
    setTimeout(() => input.focus(), 100);
    overlay.querySelector('#del-cancel-btn').onclick = () => { document.body.removeChild(overlay); resolve(false); };
    overlay.querySelector('#del-confirm-btn').onclick = () => {
      if (input.value === DELETE_PASS) { document.body.removeChild(overlay); resolve(true); }
      else { err.style.display = 'block'; input.value = ''; input.focus(); setTimeout(() => err.style.display = 'none', 2000); }
    };
    input.onkeydown = e => { if (e.key === 'Enter') overlay.querySelector('#del-confirm-btn').click(); };
  });
}

// ===== COLOR SYSTEM =====
const DEFAULT_COLORS = {
  '--bg-dark':    '#2a1005',
  '--bg-med':     '#3d1f0a',
  '--bg-card':    '#4a2510',
  '--gold':       '#f0c050',
  '--gold-light': '#f5deb3',
  '--gold-bright':'#ffd700',
  '--amber':      '#e8a020',
  '--text-main':  '#f5deb3',
  '--text-muted': '#c8a87a',
  '--border':     '#6b3d1a',
  '--topbar':     '#1a0802',
  '--cat-card':   '#4a2510',
  '--co-name':    '#f0c050',
  '--co-desc':    '#c8a87a'
};

function applyColors(colors) {
  const root = document.documentElement;
  Object.entries(colors).forEach(([key, val]) => {
    if (key.startsWith('--')) root.style.setProperty(key, val);
  });
  // Apply extras that map to CSS vars or elements
  if (colors['--topbar']) {
    document.querySelectorAll('.top-bar').forEach(el => {
      el.style.background = `linear-gradient(135deg, ${colors['--topbar']}, ${lightenColor(colors['--topbar'], 20)})`;
    });
  }
  if (colors['--cat-card']) {
    document.querySelectorAll('.category-card').forEach(el => {
      el.style.background = `linear-gradient(135deg, ${colors['--cat-card']}, ${lightenColor(colors['--cat-card'], 15)})`;
    });
  }
  if (colors['--co-name']) {
    document.querySelectorAll('.company-name').forEach(el => el.style.color = colors['--co-name']);
  }
  if (colors['--co-desc']) {
    document.querySelectorAll('.company-desc, .company-hours').forEach(el => el.style.color = colors['--co-desc']);
  }
}

function lightenColor(hex, amount) {
  try {
    const num = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch(e) { return hex; }
}

function previewColor(variable, value) {
  document.documentElement.style.setProperty(variable, value);
  // Update the hex display next to the color picker
  const inputId = 'clr-' + variable.replace('--','').replace(/-([a-z])/g, (m,p1) => p1.toUpperCase());
  const valEl = document.getElementById(inputId.replace('clr-','clr-') + '-val');
  // Simpler: find the span sibling via known IDs
  const allSpans = {
    '--bg-dark': 'clr-bg-dark-val', '--bg-card': 'clr-bg-card-val',
    '--gold': 'clr-gold-val', '--text-main': 'clr-text-main-val',
    '--text-muted': 'clr-text-muted-val', '--border': 'clr-border-val'
  };
  if (allSpans[variable]) {
    const el = document.getElementById(allSpans[variable]);
    if (el) el.textContent = value;
  }
}

function previewTopBar(value) {
  document.querySelectorAll('.top-bar').forEach(el => {
    el.style.background = `linear-gradient(135deg, ${value}, ${lightenColor(value, 20)})`;
  });
  const el = document.getElementById('clr-topbar-val'); if (el) el.textContent = value;
}

function previewCatCard(value) {
  document.querySelectorAll('.category-card').forEach(el => {
    el.style.background = `linear-gradient(135deg, ${value}, ${lightenColor(value, 15)})`;
  });
  const el = document.getElementById('clr-cat-card-val'); if (el) el.textContent = value;
}

function previewCompanyName(value) {
  document.querySelectorAll('.company-name').forEach(el => el.style.color = value);
  const el = document.getElementById('clr-co-name-val'); if (el) el.textContent = value;
}

function previewCompanyDesc(value) {
  document.querySelectorAll('.company-desc, .company-hours').forEach(el => el.style.color = value);
  const el = document.getElementById('clr-co-desc-val'); if (el) el.textContent = value;
}

async function saveColors() {
  showLoading('Salvando cores...');
  const colors = {
    '--bg-dark':    document.getElementById('clr-bg-dark')?.value    || DEFAULT_COLORS['--bg-dark'],
    '--bg-card':    document.getElementById('clr-bg-card')?.value    || DEFAULT_COLORS['--bg-card'],
    '--gold':       document.getElementById('clr-gold')?.value       || DEFAULT_COLORS['--gold'],
    '--text-main':  document.getElementById('clr-text-main')?.value  || DEFAULT_COLORS['--text-main'],
    '--text-muted': document.getElementById('clr-text-muted')?.value || DEFAULT_COLORS['--text-muted'],
    '--border':     document.getElementById('clr-border')?.value     || DEFAULT_COLORS['--border'],
    '--topbar':     document.getElementById('clr-topbar')?.value     || DEFAULT_COLORS['--topbar'],
    '--cat-card':   document.getElementById('clr-cat-card')?.value   || DEFAULT_COLORS['--cat-card'],
    '--co-name':    document.getElementById('clr-co-name')?.value    || DEFAULT_COLORS['--co-name'],
    '--co-desc':    document.getElementById('clr-co-desc')?.value    || DEFAULT_COLORS['--co-desc'],
  };
  appData.visual.colors = colors;
  await db.collection('settings').doc('colors').set(colors);
  applyColors(colors);
  hideLoading();
  alert('✅ Cores salvas com sucesso!');
}

async function resetColors() {
  if (!confirm('Restaurar todas as cores para o padrão original?')) return;
  showLoading('Restaurando...');
  await db.collection('settings').doc('colors').set(DEFAULT_COLORS);
  appData.visual.colors = DEFAULT_COLORS;
  applyColors(DEFAULT_COLORS);
  loadColorInputs(DEFAULT_COLORS);
  hideLoading();
  alert('✅ Cores restauradas!');
}

function loadColorInputs(colors) {
  const map = {
    'clr-bg-dark': '--bg-dark', 'clr-bg-card': '--bg-card',
    'clr-gold': '--gold', 'clr-text-main': '--text-main',
    'clr-text-muted': '--text-muted', 'clr-border': '--border',
    'clr-topbar': '--topbar', 'clr-cat-card': '--cat-card',
    'clr-co-name': '--co-name', 'clr-co-desc': '--co-desc',
    'clr-cat-text': '--gold'
  };
  Object.entries(map).forEach(([inputId, cssVar]) => {
    const input = document.getElementById(inputId);
    const valEl = document.getElementById(inputId + '-val');
    const val = colors[cssVar] || DEFAULT_COLORS[cssVar] || '#ffffff';
    if (input) input.value = val;
    if (valEl) valEl.textContent = val;
  });
}

async function loadColors() {
  try {
    const doc = await db.collection('settings').doc('colors').get();
    const colors = doc.exists ? { ...DEFAULT_COLORS, ...doc.data() } : DEFAULT_COLORS;
    appData.visual.colors = colors;
    applyColors(colors);
    return colors;
  } catch(e) {
    applyColors(DEFAULT_COLORS);
    return DEFAULT_COLORS;
  }
}

// ===== HOME HEADER IMAGE =====
async function uploadHomeHeader(input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Salvando cabeçalho...');
  try {
    const imgData = await uploadImageFile(file, 1200, 0.82);
    await db.collection('settings').doc('homeHeaderImg').set({ imgData });
    appData.visual.homeHeaderImg = imgData;
    invalidateCache();
    applyHomeHeader();
    const prev = document.getElementById('home-header-preview');
    if (prev) { prev.src = imgData; prev.style.display = 'block'; }
    hideLoading();
    alert('✅ Cabeçalho salvo!');
  } catch(e) { hideLoading(); alert('Erro: ' + e.message); }
}

async function removeHomeHeader() {
  showLoading('Removendo...');
  await db.collection('settings').doc('homeHeaderImg').set({ imgData: '' });
  appData.visual.homeHeaderImg = '';
  applyHomeHeader();
  const prev = document.getElementById('home-header-preview');
  if (prev) { prev.src = ''; prev.style.display = 'none'; }
  hideLoading();
}

function applyHomeHeader() {
  const el = document.getElementById('home-header-img'); if (!el) return;
  const img = appData.visual.homeHeaderImg;
  if (img) {
    el.style.display = 'block';
    el.innerHTML = `<img src="${img}" style="width:100%;display:block;height:70px;object-fit:cover;border-radius:16px">`;
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

// ===== SPECIAL CARDS IMAGES =====
async function uploadSpecialCardImg(key, input) {
  const file = input.files[0]; if (!file) return;
  showLoading('Salvando imagem do card...');
  try {
    // Compress to ~400x400 square
    const imgData = await uploadImageFile(file, 400, 0.82);
    // Save to separate Firestore document
    await db.collection('settings').doc('cardimg_' + key).set({ imgData });
    appData.visual[key + 'CardImg'] = imgData;
    // Update preview
    const prev = document.getElementById(key + '-img-preview');
    if (prev) { prev.src = imgData; prev.style.display = 'block'; }
    // Apply to card
    applySpecialCardImages();
    hideLoading();
    alert('✅ Imagem salva!');
  } catch(e) {
    hideLoading();
    alert('Erro ao salvar: ' + e.message);
  }
}
function previewSpecialCard(input, previewId) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    const p = document.getElementById(previewId);
    p.src = e.target.result; p.style.display = 'block';
  };
  r.readAsDataURL(file);
}

async function removeSpecialCardImg(key) {
  if (!confirm('Remover imagem do card?')) return;
  showLoading('Removendo...');
  appData.visual[key + 'CardImg'] = '';
  const card = document.getElementById('special-' + key);
  if (card) { card.style.backgroundImage = ''; card.classList.remove('has-bg-img'); }
  await db.collection('settings').doc('cardimg_' + key).set({ imgData: '' });
  // Also clear preview
  const prev = document.getElementById(key + '-img-preview');
  if (prev) { prev.src = ''; prev.style.display = 'none'; }
  hideLoading();
}

function applySpecialCardImages() {
  ['emergency','advertise','review'].forEach(key => {
    const img = appData.visual[key + 'CardImg'];
    const card = document.getElementById('special-' + key);
    if (!card) return;
    if (img) {
      card.style.backgroundImage = `url(${img})`;
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
      card.style.backgroundRepeat = 'no-repeat';
      card.style.filter = 'brightness(0.8)';
    } else {
      card.style.backgroundImage = '';
      card.style.backgroundSize = '';
      card.style.backgroundPosition = '';
      card.style.filter = '';
    }
  });
}

// ===== SECRET TAP (5x no rodapé) =====
let secretTapCount = 0, secretTapTimer = null;
function secretTap() {
  secretTapCount++;
  clearTimeout(secretTapTimer);
  secretTapTimer = setTimeout(() => { secretTapCount = 0; }, 2000);
  if (secretTapCount >= 5) {
    secretTapCount = 0;
    if (adminLoggedIn) openAdmin(); else showAdminLogin();
  }
}

// ===== PULSE TAP EFFECT =====
function addPulse(el) {
  if (!el || el._hasPulse) return;
  el._hasPulse = true;
  const trigger = () => {
    el.classList.remove('tapping');
    void el.offsetWidth;
    el.classList.add('tapping');
  };
  el.addEventListener('touchstart', trigger, { passive: true });
  el.addEventListener('mousedown', trigger);
  el.addEventListener('animationend', () => el.classList.remove('tapping'));
}

function applyPulseToAll() {
  // Back button pulse applied separately on direct click only
}

// Apply pulse to dynamically rendered cards
function applyPulseToDynamic() {
  document.querySelectorAll('.category-card, .company-card, .radio-card, .subcategory-card').forEach(addPulse);
}

// ===== MIGRATE IMAGES TO STORAGE =====
async function migrateImagesToStorage() {
  const btn = document.getElementById('migrate-btn');
  const progress = document.getElementById('migrate-progress');
  if (!confirm('Migrar todas as imagens de cidades e categorias pro Firebase Storage? Pode demorar alguns minutos.')) return;

  btn.disabled = true;
  btn.textContent = '⏳ Migrando...';
  progress.style.display = 'block';

  let total = 0, done = 0, skipped = 0;

  // Helper: check if already a Storage URL
  function isStorageUrl(url) {
    return url && (url.startsWith('https://firebasestorage') || url.startsWith('https://storage.googleapis'));
  }

  // Helper: convert base64 to blob
  function base64ToBlob(base64) {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Helper: upload blob to storage
  async function uploadToStorage(blob) {
    const filename = 'images/' + Date.now() + '_' + Math.random().toString(36).substr(2,8) + '.jpg';
    const ref = storage.ref(filename);
    await ref.put(blob, { contentType: 'image/jpeg' });
    return await ref.getDownloadURL();
  }

  try {
    // Migrate cities
    const cities = await db.collection('cities').get();
    total += cities.docs.filter(d => d.data().imgUrl && !isStorageUrl(d.data().imgUrl)).length;
    const cats = await db.collection('categories').get();
    total += cats.docs.filter(d => d.data().imgUrl && !isStorageUrl(d.data().imgUrl)).length;

    progress.textContent = 'Encontradas ' + total + ' imagens para migrar...';

    // Migrate city images
    for (const doc of cities.docs) {
      const data = doc.data();
      if (data.imgUrl && !isStorageUrl(data.imgUrl)) {
        try {
          progress.textContent = 'Migrando cidade: ' + data.name + '...';
          const blob = base64ToBlob(data.imgUrl);
          const url = await uploadToStorage(blob);
          await db.collection('cities').doc(doc.id).update({ imgUrl: url });
          done++;
          progress.textContent = done + '/' + total + ' migradas... (' + data.name + ' ✅)';
        } catch(e) { skipped++; }
      }
    }

    // Migrate category images
    for (const doc of cats.docs) {
      const data = doc.data();
      if (data.imgUrl && !isStorageUrl(data.imgUrl)) {
        try {
          progress.textContent = 'Migrando categoria: ' + data.name + '...';
          const blob = base64ToBlob(data.imgUrl);
          const url = await uploadToStorage(blob);
          await db.collection('categories').doc(doc.id).update({ imgUrl: url });
          done++;
          progress.textContent = done + '/' + total + ' migradas... (' + data.name + ' ✅)';
        } catch(e) { skipped++; }
      }
    }

    invalidateCache();
    progress.textContent = '✅ Concluído! ' + done + ' imagens migradas' + (skipped ? ', ' + skipped + ' puladas' : '') + '. Recarregue o app!';
    btn.textContent = '✅ Migração concluída!';

  } catch(e) {
    progress.textContent = '❌ Erro: ' + e.message;
    btn.disabled = false;
    btn.textContent = '🚀 Migrar agora';
  }
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', async () => {
  if (!window.location.hash || window.location.hash === '#') {
    window.location.replace(window.location.href.split('#')[0] + '#home');
  }
  // Back button pulse handled via CSS only
  await loadAllData();
  await seedAuthIfNeeded();
  await loadColors();
  initHome();
  setupListeners();
  checkAdminRoute();
  document.getElementById('filter-co-city')?.addEventListener('change', () => { populateFilterCat(); renderAdminCompanies(); });
  document.getElementById('cat-city-select')?.addEventListener('change', renderAdminCategories);
  document.getElementById('banner-location')?.addEventListener('change', renderBannerList);
  document.getElementById('footer-banner-city')?.addEventListener('change', renderFooterBannerList);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
