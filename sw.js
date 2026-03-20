// ═══════════════════════════════════════════════════════════════
// TM Engenharia — PCM System Service Worker v1.0
// Cache offline + notificações push
// ═══════════════════════════════════════════════════════════════

const SW_VERSION   = 'pcm-v1.0.0';
const CACHE_NAME   = 'pcm-cache-' + SW_VERSION;
const OFFLINE_PAGE = './index_corrigido.html';

// Arquivos para cache offline
const CACHE_URLS = [
  './index_corrigido.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap'
];

// ── INSTALL — faz cache dos arquivos estáticos ────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS.map(url => new Request(url, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install parcial:', err))
  );
});

// ── ACTIVATE — limpa caches antigos ──────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Ativando', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — cache-first para estáticos, network-first para Firebase ───────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase Realtime DB — sempre network, fallback para cache
  if(url.includes('firebaseio.com') || url.includes('googleapis.com/identitytoolkit')){
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // EmailJS, Groq API, Anthropic — sempre network (nunca cache)
  if(url.includes('emailjs.com') || url.includes('groq.com') || url.includes('anthropic.com')){
    event.respondWith(fetch(event.request));
    return;
  }

  // Fontes do Google — stale-while-revalidate
  if(url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')){
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const network = fetch(event.request).then(res => { cache.put(event.request, res.clone()); return res; });
          return cached || network;
        })
      )
    );
    return;
  }

  // HTML principal e assets — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(res => {
        if(res && res.status === 200){
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        }
        return res;
      }).catch(() => {
        // Offline — retorna página principal do cache
        if(event.request.mode === 'navigate') return caches.match(OFFLINE_PAGE);
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if(!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'PCM TM', body: event.data.text() }; }

  const title   = data.title || 'PCM TM Engenharia';
  const options = {
    body:    data.body    || 'Nova notificação',
    icon:    data.icon    || './icons/icon-192.png',
    badge:   data.badge   || './icons/icon-72.png',
    tag:     data.tag     || 'pcm-notif',
    data:    data.url     ? { url: data.url } : {},
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: data.urgent || false,
    silent:  false
  };

  // Adiciona ação padrão se não houver
  if(!options.actions.length){
    options.actions = [
      { action: 'open', title: 'Abrir PCM' },
      { action: 'dismiss', title: 'Fechar' }
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if(event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || './index_corrigido.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Se já tem uma janela aberta, foca ela
      for(const client of clientList){
        if(client.url.includes('index_corrigido') && 'focus' in client){
          client.focus();
          client.postMessage({ type: 'NOTIF_CLICK', url: targetUrl });
          return;
        }
      }
      // Senão abre nova janela
      if(clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── SYNC — sincronizar dados quando voltar online ─────────────────────────────
self.addEventListener('sync', event => {
  if(event.tag === 'pcm-sync'){
    event.waitUntil(
      clients.matchAll().then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'SW_SYNC' }));
      })
    );
  }
});

// ── MESSAGE — comunicação com a página ───────────────────────────────────────
self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if(event.data?.type === 'GET_VERSION'){
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

console.log('[SW] TM PCM Service Worker carregado —', SW_VERSION);
