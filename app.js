/**
 * Світло Миколаїв PWA - Головний додаток (Vanilla JS)
 * SPA-архітектура, робота з API off.energy.mk.ua, офлайн-режим, Service Worker
 */

// Базовий URL для API
// Пріоритет: 1) збережений користувачем Cloudflare Worker у налаштуваннях; 
// 2) Якщо відкрито на GitHub Pages (github.io) -> проксі на Vercel;
// 3) Відносний шлях /api/... (для localhost або Vercel)
function getApiBase() {
  const custom = localStorage.getItem('lightmk_custom_api');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/$/, '');
  }
  if (window.location.hostname.includes('github.io')) {
    return 'https://energy-mk-pwa-test.vercel.app';
  }
  return '';
}
let API_BASE = getApiBase();

// Ключі сховища LocalStorage
const STORAGE_KEYS = {
  MY_ADDRESS: 'lightmk_my_address',
  MY_QUEUE: 'lightmk_my_queue',
  FILTER_SELECTION: 'lightmk_filter_selection',
  CACHED_DATA: 'lightmk_cached_data',
  LAST_UPDATE: 'lightmk_last_update'
};

// Стан додатку (App State)
const state = {
  isOnline: navigator.onLine,
  deferredPrompt: null,
  activeTab: 'tab-home',
  
  // Дані графіків
  queuesGpv: [],       // Черги ГПВ 1.1-6.2 (by-type/3)
  queuesGav: [],       // Аварійні ГАВ (by-type/1)
  queuesSgav: [],      // Спеціальні СГАВ (by-type/2)
  timeSeries: [],      // 48 інтервалів часу по 30 хв
  schedulesMap: {},    // Графіки, розбиті за датами
  selectedDateLabel: null,
  
  // Фільтри та обрана черга
  myQueue: null,           // { id: 17, name: '2.2' }
  selectedFilterQueues: [],// масив id черг, що відображаються
  scheduleViewMode: 'cards',// 'cards' або 'table'
  
  // Каскад пошуку адреси
  filiiList: [],
  selectedFilial: null,
  selectedNaspunkt: null,
  selectedStreet: null,
  selectedDom: null
};

/* ==========================================================================
   1. ІНІЦІАЛІЗАЦІЯ ДОДАТКА ТА SERVICE WORKER
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initPwaInstallPrompt();
  initNetworkListeners();
  initNavigation();
  initLiveClock();
  loadSavedPreferences();
  
  // Первинне завантаження даних
  loadAllData();
  
  // Ініціалізація форми адрес
  initAddressSearch();
  initDiagnostics();
  initMultiLocations();
  initCalendarExport();
  initShareAndNotifications();
});

/**
 * Реєстрація Service Worker
 */
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker зареєстровано успішно:', reg.scope);
          
          // Перевірка наявності оновлень
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] Доступна нова версія додатку.');
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[PWA] Помилка реєстрації Service Worker:', err);
        });
    });
  }
}

/**
 * Обробник події встановлення PWA (Add to Home Screen)
 */
function initPwaInstallPrompt() {
  const btnInstall = document.getElementById('btnInstallPwa');
  
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    btnInstall.classList.remove('hidden');
  });

  btnInstall.addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    console.log('[PWA] Результат запиту встановлення:', outcome);
    state.deferredPrompt = null;
    btnInstall.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Додаток встановлено на пристрій.');
    btnInstall.classList.add('hidden');
  });
}

/**
 * Відстеження стану підключення до мережі (Online / Offline)
 */
function initNetworkListeners() {
  const updateStatus = () => {
    state.isOnline = navigator.onLine;
    const statusEl = document.getElementById('connectionStatus');
    const offlineNotice = document.getElementById('offlineNotice');
    
    if (state.isOnline) {
      statusEl.className = 'status-pill status-online';
      statusEl.querySelector('.status-text').textContent = 'Онлайн';
      offlineNotice.classList.add('hidden');
    } else {
      statusEl.className = 'status-pill status-offline';
      statusEl.querySelector('.status-text').textContent = 'Офлайн';
      offlineNotice.classList.remove('hidden');
    }
  };

  window.addEventListener('online', () => {
    updateStatus();
    loadAllData(); // Автооновлення при появі мережі
  });
  window.addEventListener('offline', updateStatus);
  updateStatus();

  // Кнопка примусового оновлення даних
  document.getElementById('btnRefresh').addEventListener('click', () => {
    const icon = document.getElementById('btnRefresh');
    icon.style.transition = 'transform 0.6s ease';
    icon.style.transform = 'rotate(360deg)';
    setTimeout(() => { icon.style.transform = ''; }, 600);
    loadAllData(true);
  });
}

/**
 * Маршрутизація SPA між вкладками
 */
function initNavigation() {
  const tabs = document.querySelectorAll('[data-tab]');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      switchTab(targetId);
    });
  });

  // Кнопка переходу з картки Hero до графіка
  document.getElementById('btnGoToSchedule').addEventListener('click', () => {
    switchTab('tab-schedule');
  });

  // Кнопки перемикання вигляду графіка (картки / таблиця)
  document.getElementById('viewBtnCards').addEventListener('click', () => {
    state.scheduleViewMode = 'cards';
    document.getElementById('viewBtnCards').classList.add('active');
    document.getElementById('viewBtnTable').classList.remove('active');
    document.getElementById('scheduleCardsContainer').classList.remove('hidden');
    document.getElementById('scheduleTableContainer').classList.add('hidden');
    renderSchedule();
  });

  document.getElementById('viewBtnTable').addEventListener('click', () => {
    state.scheduleViewMode = 'table';
    document.getElementById('viewBtnTable').classList.add('active');
    document.getElementById('viewBtnCards').classList.remove('active');
    document.getElementById('scheduleTableContainer').classList.remove('hidden');
    document.getElementById('scheduleCardsContainer').classList.add('hidden');
    renderSchedule();
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  
  // Оновлюємо активні кнопки у десктопній та мобільній панелях
  document.querySelectorAll('[data-tab]').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Ховаємо всі сторінки та показуємо цільову
  document.querySelectorAll('.spa-page').forEach(page => {
    page.classList.remove('active');
  });
  const targetPage = document.getElementById(tabId);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  // При відкритті графіка оновлюємо його рендер
  if (tabId === 'tab-schedule') {
    renderSchedule();
  }
}

/**
 * Годинник реального часу та щохвилинний перерахунок статусів
 */
function initLiveClock() {
  const clockEl = document.getElementById('liveClock');
  
  const updateClock = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    if (clockEl) {
      clockEl.textContent = `${hours}:${minutes}:${seconds}`;
    }
    
    // Якщо змінилася хвилина (0-я секунда), оновлюємо поточний статус черги
    if (now.getSeconds() === 0) {
      updateHeroStatus();
    }
  };
  
  setInterval(updateClock, 1000);
  updateClock();
}

/* ==========================================================================
   2. ЗАВАНТАЖЕННЯ ТА ЗБЕРЕЖЕННЯ ДАНИХ (NETWORK & CACHE)
   ========================================================================== */

/**
 * Завантаження всіх даних: черги ГПВ, ГАВ, СГАВ, часові ряди та графік
 */
async function loadAllData(forced = false) {
  try {
    // Паралельні запити до API
    const [gpvRes, gavRes, sgavRes, timeRes, schedRes] = await Promise.allSettled([
      fetchApi('/api/outage-queue/by-type/3'),
      fetchApi('/api/outage-queue/by-type/1'),
      fetchApi('/api/outage-queue/by-type/2'),
      fetchApi('/api/schedule/time-series'),
      fetchApi('/api/v2/schedule/active')
    ]);

    if (gpvRes.status === 'fulfilled' && Array.isArray(gpvRes.value)) {
      state.queuesGpv = gpvRes.value;
    }
    if (gavRes.status === 'fulfilled' && Array.isArray(gavRes.value)) {
      state.queuesGav = gavRes.value;
    }
    if (sgavRes.status === 'fulfilled' && Array.isArray(sgavRes.value)) {
      state.queuesSgav = sgavRes.value;
    }
    if (timeRes.status === 'fulfilled' && Array.isArray(timeRes.value)) {
      state.timeSeries = timeRes.value;
    }
    if (schedRes.status === 'fulfilled' && Array.isArray(schedRes.value)) {
      buildSchedulesMap(schedRes.value);
    }

    // Якщо API повернуло порожнечу (наприклад відсутній зв'язок з бекендом), завантажуємо кеш або фікстуру
    if (!state.queuesGpv.length || !state.timeSeries.length) {
      console.warn('[PWA] Неповні дані від API, підключаємо резервний офлайн-кеш');
      loadFromOfflineCache();
    } else {
      // Зберігаємо свіжі дані в LocalStorage як надійний офлайн-кеш
      const cachePayload = {
        queuesGpv: state.queuesGpv,
        queuesGav: state.queuesGav,
        queuesSgav: state.queuesSgav,
        timeSeries: state.timeSeries,
        schedulesMap: state.schedulesMap,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(cachePayload));
      localStorage.setItem(STORAGE_KEYS.LAST_UPDATE, new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }));
    }

    updateOfflineNoticeTime();
  } catch (err) {
    console.warn('[PWA] Помилка мережі при завантаженні API, застосовуємо офлайн-кеш:', err);
    loadFromOfflineCache();
  }

  // Оновлюємо інтерфейс
  renderEmergencyGav();
  initQueueSelectors();
  updateHeroStatus();
  renderHomeTimeline();
  renderSchedule();
}

/**
 * Універсальний запит до API через внутрішній проксі
 */
async function fetchApi(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE}${cleanEndpoint}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} for ${url}`);
  }
  return await response.json();
}

/**
 * Обробка та групування розкладу за днями
 */
function buildSchedulesMap(data) {
  const map = {};
  const today = new Date();
  const todayLabel = formatDate(today);

  data.forEach(item => {
    // Враховуємо часовий пояс: item.from у форматі UTC (наприклад 2026-11-03T22:00:00Z відповідає 04.11 за Києвом).
    // Беремо середину між from та to, щоб отримати дату саме активного дня графіка
    let d;
    if (item.from && item.to) {
      d = new Date((new Date(item.from).getTime() + new Date(item.to).getTime()) / 2);
    } else {
      d = new Date(item.from || item.to || Date.now());
    }
    const label = formatDate(d);

    if (!map[label]) {
      map[label] = {
        label,
        date: d,
        series: item.series ? [...item.series] : []
      };
    } else if (item.series && item.series.length) {
      map[label].series = map[label].series.concat(item.series);
    }
  });

  // Якщо сьогоднішній день відсутній - додаємо порожній запис
  if (!map[todayLabel]) {
    map[todayLabel] = {
      label: todayLabel,
      date: today,
      series: []
    };
  }

  state.schedulesMap = map;
  
  // Якщо для сьогодні серія порожня, але є серія для іншої дати - вибираємо дату з даними
  const datesWithData = Object.keys(map).filter(k => map[k].series && map[k].series.length > 0);
  if (map[todayLabel] && map[todayLabel].series && map[todayLabel].series.length > 0) {
    state.selectedDateLabel = todayLabel;
  } else if (datesWithData.length > 0) {
    state.selectedDateLabel = datesWithData[0];
  } else {
    state.selectedDateLabel = todayLabel;
  }
  renderDayTabs();
}

/**
 * Форматування дати у формат DD.MM.YYYY
 */
function formatDate(d) {
  return String(d.getDate()).padStart(2, '0') + '.' +
         String(d.getMonth() + 1).padStart(2, '0') + '.' +
         d.getFullYear();
}

/**
 * Завантаження збережених параметрів користувача
 */
function loadSavedPreferences() {
  try {
    const savedQueue = localStorage.getItem(STORAGE_KEYS.MY_QUEUE);
    if (savedQueue) {
      state.myQueue = JSON.parse(savedQueue);
    }
    const savedFilter = localStorage.getItem(STORAGE_KEYS.FILTER_SELECTION);
    if (savedFilter) {
      state.selectedFilterQueues = JSON.parse(savedFilter);
    }
  } catch (e) {
    console.error('Помилка читання LocalStorage:', e);
  }
}

/**
 * Завантаження з резервного офлайн-кешу
 */
function loadFromOfflineCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
    if (raw) {
      const data = JSON.parse(raw);
      state.queuesGpv = data.queuesGpv || [];
      state.queuesGav = data.queuesGav || [];
      state.queuesSgav = data.queuesSgav || [];
      state.timeSeries = data.timeSeries || [];
      state.schedulesMap = data.schedulesMap || {};
      state.selectedDateLabel = Object.keys(state.schedulesMap)[0] || formatDate(new Date());
      updateOfflineNoticeTime();
      renderDayTabs();
      return;
    }
  } catch (e) {
    console.error('Помилка завантаження кешу:', e);
  }
  // Якщо кешу немає взагалі, завантажуємо тестовий test.json
  loadTestFixtureData();
}

function updateOfflineNoticeTime() {
  const lastTime = localStorage.getItem(STORAGE_KEYS.LAST_UPDATE) || 'щойно';
  const noticeEl = document.getElementById('lastUpdatedTime');
  if (noticeEl) {
    noticeEl.textContent = lastTime;
  }
}

/* ==========================================================================
   3. ВІДОБРАЖЕННЯ НА ГОЛОВНІЙ (HERO & GAV)
   ========================================================================== */

/**
 * Відображення стану черг ГАВ / СГАВ
 */
function renderEmergencyGav() {
  const gavListEl = document.getElementById('gavList');
  const sgavListEl = document.getElementById('sgavList');
  const overallBadge = document.getElementById('gavOverallStatus');

  let hasActiveGav = false;

  // ГАВ
  if (state.queuesGav && state.queuesGav.length) {
    gavListEl.innerHTML = state.queuesGav.map(q => {
      const isActive = q.enabled === 1;
      if (isActive) hasActiveGav = true;
      return `<div class="queue-panel-item ${isActive ? 'item-sure-off item-active' : 'item-enable'}">
        <span>Черга ${q.name}</span> <span style="font-size:0.8rem; margin-left:4px;">${isActive ? '🔴 ДІЄ' : '🟢 Ні'}</span>
      </div>`;
    }).join('');
  } else {
    gavListEl.innerHTML = '<span class="text-muted">Дані відсутні</span>';
  }

  // СГАВ
  if (state.queuesSgav && state.queuesSgav.length) {
    sgavListEl.innerHTML = state.queuesSgav.map(q => {
      const isActive = q.enabled === 1;
      if (isActive) hasActiveGav = true;
      return `<div class="queue-panel-item ${isActive ? 'item-sure-off item-active' : 'item-enable'}">
        <span>Черга ${q.name}</span> <span style="font-size:0.8rem; margin-left:4px;">${isActive ? '🔴 ДІЄ' : '🟢 Ні'}</span>
      </div>`;
    }).join('');
  } else {
    sgavListEl.innerHTML = '<span class="text-muted">Дані відсутні</span>';
  }

  if (hasActiveGav) {
    overallBadge.className = 'badge badge-danger';
    overallBadge.textContent = 'УВАГА: Діють аварійні відключення!';
  } else {
    overallBadge.className = 'badge badge-success';
    overallBadge.textContent = 'ГАВ не застосовується';
  }
}

/**
 * Оновлення головної картки "Моя черга" та розрахунок часу до наступної події
 */
function updateHeroStatus() {
  const nameEl = document.getElementById('heroQueueName');
  const subEl = document.getElementById('heroAddressSubtitle');
  const badgeEl = document.getElementById('heroStatusBadge');
  const iconEl = document.getElementById('heroStatusIcon');
  const textEl = document.getElementById('heroStatusText');
  const nextEventEl = document.getElementById('heroNextChange');

  if (!state.myQueue) {
    nameEl.textContent = 'Не вибрано';
    subEl.textContent = 'Натисніть нижче для швидкого вибору або перейдіть до вкладки "Адреса"';
    badgeEl.className = 'hero-badge badge-unknown';
    iconEl.textContent = '❓';
    textEl.textContent = 'Черга не задана';
    nextEventEl.textContent = 'Оберіть чергу для моніторингу';
    return;
  }

  nameEl.textContent = `Черга ${state.myQueue.name}`;
  
  const savedAddr = localStorage.getItem(STORAGE_KEYS.MY_ADDRESS);
  if (savedAddr) {
    try {
      const addrObj = JSON.parse(savedAddr);
      subEl.textContent = `${addrObj.street || ''}, ${addrObj.dom || ''}`;
    } catch (_) {
      subEl.textContent = 'Збережена користувацька черга';
    }
  } else {
    subEl.textContent = 'Швидкий ручний вибір';
  }

  // Визначаємо поточний інтервал часу
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayLabel = formatDate(now);
  const todaySchedule = state.schedulesMap[todayLabel];

  if (!todaySchedule || !state.timeSeries.length) {
    badgeEl.className = 'hero-badge badge-unknown';
    iconEl.textContent = '⏳';
    textEl.textContent = 'Очікування даних';
    nextEventEl.textContent = 'Графік оновлюється';
    return;
  }

  // Карта розкладу: key = queueId_timeSeriesId
  const scheduleMatrix = {};
  (todaySchedule.series || []).forEach(item => {
    const key = `${item.outage_queue_id}_${item.time_series_id}`;
    scheduleMatrix[key] = item.type;
  });

  let currentSlot = null;
  let nextChangeSlot = null;
  let currentStatus = 'ENABLE';

  for (let i = 0; i < state.timeSeries.length; i++) {
    const slot = state.timeSeries[i];
    const [sH, sM] = slot.start.split(':').map(Number);
    const [eH, eM] = slot.end.split(':').map(Number);
    
    const startMins = sH * 60 + sM;
    const endMins = (eH === 0 && eM === 0) ? 24 * 60 : (eH * 60 + eM);

    const key = `${state.myQueue.id}_${slot.id}`;
    const slotType = scheduleMatrix[key] || 'ENABLE';

    if (currentMinutes >= startMins && currentMinutes < endMins) {
      currentSlot = slot;
      currentStatus = slotType;
    } else if (currentSlot && !nextChangeSlot) {
      // Шукаємо перший наступний слот, де статус відрізняється
      if (slotType !== currentStatus) {
        nextChangeSlot = { slot, type: slotType, startMins };
      }
    }
  }

  // Оформлення бейджа відповідно до поточного статусу
  if (currentStatus === 'ENABLE') {
    badgeEl.className = 'hero-badge badge-on';
    iconEl.textContent = '💡';
    textEl.textContent = 'СВІТЛО Є';
  } else if (currentStatus === 'OFF' || currentStatus === 'SURE_OFF') {
    badgeEl.className = 'hero-badge badge-off';
    iconEl.textContent = '🔌';
    textEl.textContent = 'ВІДКЛЮЧЕНО';
  } else if (currentStatus === 'PROBABLY_OFF') {
    badgeEl.className = 'hero-badge badge-probably';
    iconEl.textContent = '⚠️';
    textEl.textContent = 'МОЖЛИВЕ ВІДКЛЮЧЕННЯ';
  }

  // Розрахунок часу до наступної зміни
  if (nextChangeSlot) {
    const diffMins = nextChangeSlot.startMins - currentMinutes;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    const timeStr = hours > 0 ? `${hours} год ${mins} хв` : `${mins} хв`;
    const actionStr = nextChangeSlot.type === 'ENABLE' ? 'Увімкнення світла' : 'Вимкнення світла';
    nextEventEl.textContent = `${actionStr} о ${nextChangeSlot.slot.start.slice(0, 5)} (через ${timeStr})`;

    // ПОПЕРЕДЖЕННЯ ЗА 1 ГОДИНУ ТА ЗА 10 ХВИЛИН ДО ВІДКЛЮЧЕННЯ
    if (nextChangeSlot.type !== 'ENABLE' && diffMins > 0) {
      if (diffMins <= 60 && diffMins > 15) {
        checkAndSendPreOutageWarning(nextChangeSlot, 60);
      } else if (diffMins <= 10) {
        checkAndSendPreOutageWarning(nextChangeSlot, 10);
      }
    }
  } else {
    nextEventEl.textContent = 'Змін до кінця поточної доби не заплановано';
  }

  // Відправка браузерного сповіщення та звукового сигналу при фактичній зміні стану
  if (lastNotifiedStatus && lastNotifiedStatus !== currentStatus) {
    const isPowerOn = currentStatus === 'ENABLE';
    playStatusSound(isPowerOn);

    const title = isPowerOn ? '💡 Світло знову є!' : '🔌 Світло вимкнено за графіком';
    const body = `Черга ${state.myQueue.name}: поточний стан змінився на "${textEl.textContent}".`;
    sendSystemNotification(title, body);
  }
  lastNotifiedStatus = currentStatus;
}

/**
 * Перевірка та відправка попередження за 1 годину (або за 10 хв) до відключення
 */
function checkAndSendPreOutageWarning(nextSlot, warningType) {
  if (!state.myQueue) return;
  const todayLabel = formatDate(new Date());
  const notifKey = `notif_${warningType}m_${todayLabel}_${state.myQueue.id}_${nextSlot.slot.id}`;

  // Уникаємо повторних сповіщень для того самого інтервалу
  if (sessionStorage.getItem(notifKey)) {
    return;
  }

  sessionStorage.setItem(notifKey, 'true');

  const timeLabel = nextSlot.slot.start.slice(0, 5);
  let title = '';
  let body = '';

  if (warningType === 60) {
    title = `⏳ Черга ${state.myQueue.name}: відключення через 1 годину!`;
    body = `О ${timeLabel} заплановано відключення світла. Залишилась 1 година — час підзарядити пристрої та завершити справи! 🔋`;
  } else {
    title = `⚠️ Черга ${state.myQueue.name}: відключення через 10 хвилин!`;
    body = `О ${timeLabel} світло буде вимкнено за графіком. Будь ласка, збережіть важливі файли!`;
  }

  // Звуковий сигнал і вібрація
  playWarningBeep();
  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 300, 100, 300]);
  }

  sendSystemNotification(title, body);
}

/**
 * Відтворення аудіосигналу попередження через Web Audio API
 */
function playWarningBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };

    // Подвійний тривожний сигнал
    playTone(880, 0, 0.18);
    playTone(660, 0.22, 0.28);
  } catch (_) {}
}

/**
 * Універсальна відправка системного сповіщення (через Service Worker або Web Notifications)
 */
async function sendSystemNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        return reg.showNotification(title, {
          body,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          vibrate: [300, 100, 300],
          data: { url: './' }
        });
      }
    }
  } catch (err) {
    console.warn('Помилка Service Worker сповіщення, використовуємо fallback:', err);
  }

  try {
    new Notification(title, {
      body,
      icon: './icons/icon-192.png'
    });
  } catch (e) {
    console.warn('Notification error:', e);
  }
}

/**
 * Рендеринг 48-сегментної шкали на головній сторінці та підрахунок годин
 */
function renderHomeTimeline() {
  const container = document.getElementById('homeTimeline');
  const lightHoursEl = document.getElementById('summaryLightHours');
  const darkHoursEl = document.getElementById('summaryDarkHours');
  if (!container || !state.timeSeries.length) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayLabel = formatDate(now);
  const todaySchedule = state.schedulesMap[todayLabel];

  const scheduleMatrix = {};
  if (todaySchedule && state.myQueue) {
    (todaySchedule.series || []).forEach(item => {
      const key = `${item.outage_queue_id}_${item.time_series_id}`;
      scheduleMatrix[key] = item.type;
    });
  }

  let lightSlots = 0;
  let darkSlots = 0;

  container.innerHTML = state.timeSeries.map(slot => {
    const [sH, sM] = slot.start.split(':').map(Number);
    const [eH, eM] = slot.end.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = (eH === 0 && eM === 0) ? 24 * 60 : (eH * 60 + eM);

    const isCurrent = currentMinutes >= startMins && currentMinutes < endMins;
    let typeClass = 'item-enable';

    if (state.myQueue) {
      const key = `${state.myQueue.id}_${slot.id}`;
      const type = scheduleMatrix[key] || 'ENABLE';
      if (type === 'OFF') { typeClass = 'item-off'; darkSlots++; }
      else if (type === 'SURE_OFF') { typeClass = 'item-sure-off'; darkSlots++; }
      else if (type === 'PROBABLY_OFF') { typeClass = 'item-probably'; }
      else { lightSlots++; }
    } else {
      lightSlots++;
    }

    return `<div class="timeline-slot ${typeClass} ${isCurrent ? 'current-hour item-active' : ''}" 
                 title="${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)}"></div>`;
  }).join('');

  if (lightHoursEl && darkHoursEl) {
    const lightHours = (lightSlots * 0.5).toFixed(1).replace('.0', '');
    const darkHours = (darkSlots * 0.5).toFixed(1).replace('.0', '');
    lightHoursEl.textContent = `💡 Світло: ${lightHours} год`;
    darkHoursEl.textContent = `🔌 Відключення: ${darkHours} год`;
  }
}

/**
 * Приємний звуковий сигнал зміни стану через Web Audio API (без зовнішніх аудіофайлів)
 */
function playStatusSound(isPowerOn) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;

    if (isPowerOn) {
      // Підвищений оптимістичний акорд при увімкненні світла (C5 -> E5)
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
    } else {
      // М'який затихаючий тон при вимкненні (E5 -> C5)
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.2);
    }

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  } catch (_) {
    // Ігноруємо якщо браузер блокує звук до взаємодії
  }
}

/* ==========================================================================
   4. ДЕТАЛЬНИЙ РОЗКЛАД ГПВ (SCHEDULE)
   ========================================================================== */

/**
 * Рендеринг кнопок дат (Сьогодні, Завтра тощо)
 */
function renderDayTabs() {
  const container = document.getElementById('scheduleDaysTabs');
  if (!container) return;

  const dates = Object.keys(state.schedulesMap);
  if (!dates.length) {
    container.innerHTML = '<button class="btn btn-pill active">Немає графіків</button>';
    return;
  }

  container.innerHTML = dates.map(dateKey => {
    const isActive = dateKey === state.selectedDateLabel;
    return `<button class="btn btn-pill ${isActive ? 'active' : ''}" onclick="onSelectScheduleDate('${dateKey}')">
      ${dateKey}
    </button>`;
  }).join('');
}

window.onSelectScheduleDate = function(dateKey) {
  state.selectedDateLabel = dateKey;
  renderDayTabs();
  renderSchedule();
};

/**
 * Ініціалізація фільтрів черг та вибору
 */
function initQueueSelectors() {
  const filterContainer = document.getElementById('queueFilterPills');
  const manualContainer = document.getElementById('manualQueueSelector');
  const modalGrid = document.getElementById('modalQueueGrid');

  if (!state.queuesGpv.length) return;

  // За замовчуванням, якщо фільтр не налаштований - показуємо всі
  if (!state.selectedFilterQueues.length) {
    state.selectedFilterQueues = state.queuesGpv.map(q => q.id);
  }

  // 1. Чіпи фільтра у розділі "Розклад"
  if (filterContainer) {
    filterContainer.innerHTML = state.queuesGpv.map(q => {
      const isSelected = state.selectedFilterQueues.includes(q.id);
      return `<button class="chip-btn ${isSelected ? 'selected' : ''}" onclick="toggleQueueFilter(${q.id})">
        Черга ${q.name}
      </button>`;
    }).join('');
  }

  // 2. Чіпи ручного вибору черги
  const renderSelectorBtns = (containerEl) => {
    if (!containerEl) return;
    containerEl.innerHTML = state.queuesGpv.map(q => {
      const isMy = state.myQueue && state.myQueue.id === q.id;
      return `<button class="chip-large ${isMy ? 'selected' : ''}" onclick="selectMyQueueDirect(${q.id}, '${q.name}')">
        ${q.name}
      </button>`;
    }).join('');
  };

  renderSelectorBtns(manualContainer);
  renderSelectorBtns(modalGrid);

  // Кнопки фільтрів швидкої дії
  document.getElementById('filterSelectAll').onclick = () => {
    state.selectedFilterQueues = state.queuesGpv.map(q => q.id);
    saveQueueFilter();
    initQueueSelectors();
    renderSchedule();
  };

  document.getElementById('filterClear').onclick = () => {
    state.selectedFilterQueues = [];
    saveQueueFilter();
    initQueueSelectors();
    renderSchedule();
  };

  document.getElementById('filterSelectMy').onclick = () => {
    if (state.myQueue) {
      state.selectedFilterQueues = [state.myQueue.id];
    } else {
      alert('Будь ласка, спочатку вкажіть або оберіть вашу чергу');
    }
    saveQueueFilter();
    initQueueSelectors();
    renderSchedule();
  };

  // Модальне вікно швидкого вибору
  const modal = document.getElementById('quickQueueModal');
  document.getElementById('btnQuickSelectQueue').onclick = () => modal.classList.remove('hidden');
  document.getElementById('btnCloseModal').onclick = () => modal.classList.add('hidden');
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };
}

window.toggleQueueFilter = function(queueId) {
  const index = state.selectedFilterQueues.indexOf(queueId);
  if (index > -1) {
    state.selectedFilterQueues.splice(index, 1);
  } else {
    state.selectedFilterQueues.push(queueId);
  }
  saveQueueFilter();
  initQueueSelectors();
  renderSchedule();
};

function saveQueueFilter() {
  localStorage.setItem(STORAGE_KEYS.FILTER_SELECTION, JSON.stringify(state.selectedFilterQueues));
}

window.selectMyQueueDirect = function(id, name) {
  state.myQueue = { id, name };
  localStorage.setItem(STORAGE_KEYS.MY_QUEUE, JSON.stringify(state.myQueue));
  
  // Закриваємо модалку, якщо відкрита
  document.getElementById('quickQueueModal').classList.add('hidden');
  
  initQueueSelectors();
  updateHeroStatus();
  renderHomeTimeline();
  renderSchedule();
};

/**
 * Головний рендеринг розкладу (картки або таблиця)
 */
function renderSchedule() {
  if (state.scheduleViewMode === 'cards') {
    renderScheduleCards();
  } else {
    renderScheduleTable();
  }
}

/**
 * Мобільний вигляд карток для кожної черги
 */
function renderScheduleCards() {
  const container = document.getElementById('scheduleCardsContainer');
  if (!container) return;

  const activeSchedule = state.schedulesMap[state.selectedDateLabel];
  if (!activeSchedule || !state.timeSeries.length) {
    container.innerHTML = '<div class="card"><p class="text-muted">Дані графіка для цієї дати відсутні</p></div>';
    return;
  }

  // Фільтруємо черги, які потрібно показати
  const visibleQueues = state.queuesGpv.filter(q => state.selectedFilterQueues.includes(q.id));
  if (!visibleQueues.length) {
    container.innerHTML = '<div class="card"><p class="text-muted">Жодної черги не вибрано у фільтрі вище</p></div>';
    return;
  }

  const matrix = {};
  (activeSchedule.series || []).forEach(item => {
    matrix[`${item.outage_queue_id}_${item.time_series_id}`] = item.type;
  });

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isSelectedDayToday = state.selectedDateLabel === formatDate(now);

  container.innerHTML = visibleQueues.map(queue => {
    const isMy = state.myQueue && state.myQueue.id === queue.id;

    const slotsHtml = state.timeSeries.map(slot => {
      const type = matrix[`${queue.id}_${slot.id}`] || 'ENABLE';
      const [sH, sM] = slot.start.split(':').map(Number);
      const [eH, eM] = slot.end.split(':').map(Number);
      const startMins = sH * 60 + sM;
      const endMins = (eH === 0 && eM === 0) ? 24 * 60 : (eH * 60 + eM);

      const isCurrent = isSelectedDayToday && (currentMinutes >= startMins && currentMinutes < endMins);

      let typeClass = 'item-enable';
      let typeLabel = 'Світло є';
      if (type === 'OFF') { typeClass = 'item-off'; typeLabel = 'Відкл.'; }
      if (type === 'SURE_OFF') { typeClass = 'item-sure-off'; typeLabel = 'Точно відкл.'; }
      if (type === 'PROBABLY_OFF') { typeClass = 'item-probably'; typeLabel = 'Можливо'; }

      return `<div class="slot-item ${typeClass} ${isCurrent ? 'item-active' : ''}">
        <span class="slot-time">${slot.start.slice(0, 5)}-${slot.end.slice(0, 5)}</span>
        <span>${typeLabel}</span>
      </div>`;
    }).join('');

    return `
      <div class="queue-card">
        <div class="queue-card-header">
          <div class="queue-card-title">
            <span>Черга ${queue.name}</span>
            ${isMy ? '<span class="badge badge-success">Ваша черга</span>' : ''}
          </div>
          <button class="btn btn-outline btn-sm" onclick="selectMyQueueDirect(${queue.id}, '${queue.name}')">
            ${isMy ? '✓ Обрано' : 'Обрати моєю'}
          </button>
        </div>
        <div class="queue-card-slots">
          ${slotsHtml}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Класичний табличний вигляд сітки розкладу (десктопний/табличний варіант)
 */
function renderScheduleTable() {
  const headEl = document.getElementById('scheduleTableHead');
  const bodyEl = document.getElementById('scheduleTableBody');
  if (!headEl || !bodyEl) return;

  const activeSchedule = state.schedulesMap[state.selectedDateLabel];
  if (!activeSchedule || !state.timeSeries.length) {
    headEl.innerHTML = '';
    bodyEl.innerHTML = '<tr><td colspan="13">Графіки відсутні</td></tr>';
    return;
  }

  const visibleQueues = state.queuesGpv.filter(q => state.selectedFilterQueues.includes(q.id));
  if (!visibleQueues.length) {
    bodyEl.innerHTML = '<tr><td colspan="13">Оберіть черги у фільтрі</td></tr>';
    return;
  }

  const matrix = {};
  (activeSchedule.series || []).forEach(item => {
    matrix[`${item.outage_queue_id}_${item.time_series_id}`] = item.type;
  });

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = state.selectedDateLabel === formatDate(now);

  // Рендер Thead
  headEl.innerHTML = `
    <tr>
      <th style="min-width: 90px;">Час</th>
      ${visibleQueues.map(q => `<th>Черга ${q.name}</th>`).join('')}
    </tr>
  `;

  // Рендер Tbody (48 рядків по 30 хв)
  bodyEl.innerHTML = state.timeSeries.map(slot => {
    const timeLabel = `${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)}`;
    const [sH, sM] = slot.start.split(':').map(Number);
    const [eH, eM] = slot.end.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = (eH === 0 && eM === 0) ? 24 * 60 : (eH * 60 + eM);

    const isCurrent = isToday && (currentMinutes >= startMins && currentMinutes < endMins);

    const cols = visibleQueues.map(q => {
      const type = matrix[`${q.id}_${slot.id}`] || 'ENABLE';
      let typeClass = 'item-enable';
      if (type === 'OFF') typeClass = 'item-off';
      if (type === 'SURE_OFF') typeClass = 'item-sure-off';
      if (type === 'PROBABLY_OFF') typeClass = 'item-probably';

      return `<td class="${typeClass} ${isCurrent ? 'item-active' : ''}">${q.name}</td>`;
    }).join('');

    return `
      <tr>
        <td style="font-weight: 600;">${timeLabel}</td>
        ${cols}
      </tr>
    `;
  }).join('');
}

/* ==========================================================================
   5. ПОШУК ЧЕРГИ ЗА АДРЕСОЮ (КАСКАДНИЙ ВИБІР)
   ========================================================================== */

function initAddressSearch() {
  const selFilial = document.getElementById('selectFilial');
  const selNaspunkt = document.getElementById('selectNaspunkt');
  const selStreet = document.getElementById('selectStreet');
  const selDom = document.getElementById('selectDom');
  const btnCheck = document.getElementById('btnCheckAddress');
  const btnReset = document.getElementById('btnResetAddress');

  // Завантажуємо філії з API або кешу
  loadFiliiOptions();

  selFilial.addEventListener('change', async (e) => {
    const filialId = e.target.value;
    resetSelect(selNaspunkt, 'Оберіть населений пункт...');
    resetSelect(selStreet, 'Спочатку оберіть населений пункт...');
    resetSelect(selDom, 'Спочатку оберіть вулицю...');
    btnCheck.disabled = true;

    if (!filialId) return;

    selNaspunkt.disabled = true;
    try {
      const list = await fetchApi(`/api/addr/filii/${filialId}/ns`);
      populateSelect(selNaspunkt, list, 'idnaspunkt', 'naznaspunkt');
      selNaspunkt.disabled = false;
    } catch (err) {
      console.warn('Помилка завантаження населених пунктів:', err);
    }
  });

  selNaspunkt.addEventListener('change', async (e) => {
    const nsId = e.target.value;
    resetSelect(selStreet, 'Оберіть вулицю...');
    resetSelect(selDom, 'Спочатку оберіть вулицю...');
    btnCheck.disabled = true;

    if (!nsId) return;

    selStreet.disabled = true;
    try {
      const list = await fetchApi(`/api/addr/ns/${nsId}/street`);
      populateSelect(selStreet, list, 'idstreet', 'nazstreet');
      selStreet.disabled = false;
    } catch (err) {
      console.warn('Помилка завантаження вулиць:', err);
    }
  });

  selStreet.addEventListener('change', async (e) => {
    const streetId = e.target.value;
    resetSelect(selDom, 'Оберіть номер будинку...');
    btnCheck.disabled = true;

    if (!streetId) return;

    selDom.disabled = true;
    try {
      const list = await fetchApi(`/api/addr/street/${streetId}/dom`);
      populateSelect(selDom, list, 'iddom', 'nazdom');
      selDom.disabled = false;
    } catch (err) {
      console.warn('Помилка завантаження будинків:', err);
    }
  });

  selDom.addEventListener('change', (e) => {
    btnCheck.disabled = !e.target.value;
  });

  // Кнопка пошуку відключення для вибраного будинку
  btnCheck.addEventListener('click', async () => {
    const domId = selDom.value;
    if (!domId) return;

    btnCheck.disabled = true;
    btnCheck.textContent = 'Перевірка...';

    try {
      const data = await fetchApi(`/api/addr/dom/${domId}/outage-queue`);
      displayAddressResult(data);
    } catch (err) {
      alert('Не вдалося отримати чергу для вказаного будинку. Спробуйте пізніше або оберіть чергу вручну.');
    } finally {
      btnCheck.disabled = false;
      btnCheck.textContent = 'Знайти відключення';
    }
  });

  btnReset.addEventListener('click', () => {
    selFilial.value = '';
    resetSelect(selNaspunkt, 'Спочатку оберіть філію...');
    resetSelect(selStreet, 'Спочатку оберіть населений пункт...');
    resetSelect(selDom, 'Спочатку оберіть вулицю...');
    btnCheck.disabled = true;
    document.getElementById('addressResultCard').classList.add('hidden');
  });
}

async function loadFiliiOptions() {
  const selFilial = document.getElementById('selectFilial');
  try {
    const filii = await fetchApi('/api/addr/filii');
    state.filiiList = filii;
    populateSelect(selFilial, filii, 'idfilial', 'fullname');
  } catch (err) {
    console.warn('Не вдалося завантажити список філій:', err);
  }
}

function resetSelect(el, placeholder) {
  el.innerHTML = `<option value="">${placeholder}</option>`;
  el.disabled = true;
}

function populateSelect(selectEl, items, idKey, labelKey) {
  selectEl.innerHTML = '<option value="">Оберіть зі списку...</option>' + 
    items.map(item => `<option value="${item[idKey]}">${item[labelKey]}</option>`).join('');
}

function displayAddressResult(data) {
  const resultCard = document.getElementById('addressResultCard');
  const resultContent = document.getElementById('addressResultContent');
  const btnSave = document.getElementById('btnSaveMyAddress');

  resultCard.classList.remove('hidden');

  if (!data || !data.length) {
    resultContent.innerHTML = '<p class="text-warning">Для цієї адреси планових або аварійних відключень не зафіксовано.</p>';
    btnSave.classList.add('hidden');
    return;
  }

  let foundQueue = null;

  const html = data.map(item => {
    const typeName = item.outageType ? item.outageType.name : '';
    const queueName = item.outage ? item.outage.name : '';
    const isGpv = item.outageType && item.outageType.id === 3;
    
    if (isGpv && item.outage) {
      foundQueue = { id: item.outage.id, name: item.outage.name };
    }

    return `<p><strong>${typeName}:</strong> Черга <strong>${queueName}</strong> ${isGpv ? '(ГПВ)' : ''}</p>`;
  }).join('');

  resultContent.innerHTML = html;

  if (foundQueue) {
    btnSave.classList.remove('hidden');
    btnSave.onclick = () => {
      const selFil = document.getElementById('selectFilial');
      const selNs = document.getElementById('selectNaspunkt');
      const selSt = document.getElementById('selectStreet');
      const selD = document.getElementById('selectDom');

      const addrObj = {
        filial: selFil.options[selFil.selectedIndex]?.text,
        naspunkt: selNs.options[selNs.selectedIndex]?.text,
        street: selSt.options[selSt.selectedIndex]?.text,
        dom: selD.options[selD.selectedIndex]?.text,
        queue: foundQueue
      };

      localStorage.setItem(STORAGE_KEYS.MY_ADDRESS, JSON.stringify(addrObj));
      selectMyQueueDirect(foundQueue.id, foundQueue.name);
      alert(`Адресу та чергу ${foundQueue.name} успішно збережено як основну!`);
    };
  } else {
    btnSave.classList.add('hidden');
  }
}

/* ==========================================================================
   6. ДІАГНОСТИКА ТА ТЕСТОВІ ДАНІ (TEST.JSON & LOCALSTORAGE)
   ========================================================================== */

function initDiagnostics() {
  // Налаштування користувацького проксі (Cloudflare Worker)
  const apiInput = document.getElementById('customApiInput');
  const btnSaveApi = document.getElementById('btnSaveCustomApi');
  if (apiInput && btnSaveApi) {
    apiInput.value = localStorage.getItem('lightmk_custom_api') || '';
    btnSaveApi.addEventListener('click', () => {
      const val = apiInput.value.trim();
      if (val) {
        localStorage.setItem('lightmk_custom_api', val);
      } else {
        localStorage.removeItem('lightmk_custom_api');
      }
      API_BASE = getApiBase();
      alert('Налаштування API успішно збережено! Додаток перезавантажується...');
      location.reload();
    });
  }

  // Кнопка завантаження тестового маніфесту test.json
  document.getElementById('btnLoadTestFixture').addEventListener('click', async () => {
    await loadTestFixtureData();
    alert('Тестовий набір даних test.json успішно завантажено в пам\'ять додатку!');
    switchTab('tab-home');
  });

  // Кнопка повного очищення збережених налаштувань
  document.getElementById('btnClearSavedData').addEventListener('click', () => {
    if (confirm('Очистити всі збережені налаштування, адресу та кеш додатку?')) {
      localStorage.removeItem(STORAGE_KEYS.MY_ADDRESS);
      localStorage.removeItem(STORAGE_KEYS.MY_QUEUE);
      localStorage.removeItem(STORAGE_KEYS.FILTER_SELECTION);
      localStorage.removeItem(STORAGE_KEYS.CACHED_DATA);
      localStorage.removeItem(STORAGE_KEYS.LAST_UPDATE);
      state.myQueue = null;
      state.selectedFilterQueues = [];
      alert('Кеш очищено.');
      location.reload();
    }
  });
}

/**
 * Завантаження локального файлу test.json для тестування функціоналу
 */
async function loadTestFixtureData() {
  try {
    const res = await fetch('./test.json');
    if (!res.ok) throw new Error('Cannot load test.json');
    const data = await res.json();
    
    state.queuesGpv = data.queues_gpv || [];
    state.queuesGav = data.queues_gav || [];
    state.queuesSgav = data.queues_sgav || [];
    state.timeSeries = data.time_series || [];

    if (data.sample_schedule) {
      buildSchedulesMap(data.sample_schedule);
    }
    if (data.sample_saved_address) {
      state.myQueue = {
        id: data.sample_saved_address.queue_id,
        name: data.sample_saved_address.queue
      };
      localStorage.setItem(STORAGE_KEYS.MY_QUEUE, JSON.stringify(state.myQueue));
    }

    renderEmergencyGav();
    initQueueSelectors();
    updateHeroStatus();
    renderHomeTimeline();
    renderSchedule();
    console.log('[PWA] Тестовий набір test.json завантажено.');
  } catch (err) {
    console.error('Помилка завантаження test.json:', err);
  }
}

/* ==========================================================================
   7. МУЛЬТИ-ЛОКАЦІЇ ТА ЕКСПОРТ У КАЛЕНДАР (.ICS)
   ========================================================================== */

const LOCATIONS_STORAGE_KEY = 'lightmk_saved_locations';

function initMultiLocations() {
  const modal = document.getElementById('saveLocationModal');
  const btnOpenModal = document.getElementById('btnSaveCurrentLocationModal');
  const btnCloseModal = document.getElementById('btnCloseLocationModal');
  const btnConfirm = document.getElementById('btnConfirmSaveLocation');
  const nameInput = document.getElementById('locationNameInput');

  if (btnOpenModal && modal) {
    btnOpenModal.addEventListener('click', () => {
      if (!state.myQueue) {
        alert('Спочатку оберіть або вкажіть чергу!');
        return;
      }
      nameInput.value = '';
      modal.classList.remove('hidden');
      nameInput.focus();
    });

    btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });

    btnConfirm.addEventListener('click', () => {
      const name = nameInput.value.trim() || `Черга ${state.myQueue.name}`;
      saveLocation(name, state.myQueue);
      modal.classList.add('hidden');
      renderLocationChips();
    });
  }

  renderLocationChips();
}

function getSavedLocations() {
  try {
    return JSON.parse(localStorage.getItem(LOCATIONS_STORAGE_KEY)) || [];
  } catch (_) {
    return [];
  }
}

function saveLocation(name, queue) {
  const list = getSavedLocations();
  const existingIdx = list.findIndex(loc => loc.name.toLowerCase() === name.toLowerCase());
  if (existingIdx > -1) {
    list[existingIdx].queue = queue;
  } else {
    list.push({ name, queue });
  }
  localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(list));
}

window.deleteLocation = function(index, event) {
  if (event) event.stopPropagation();
  const list = getSavedLocations();
  list.splice(index, 1);
  localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(list));
  renderLocationChips();
};

function renderLocationChips() {
  const container = document.getElementById('savedLocationsBar');
  if (!container) return;

  const list = getSavedLocations();
  if (!list.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = list.map((loc, idx) => {
    const isCurrent = state.myQueue && state.myQueue.id === loc.queue.id;
    return `
      <div class="chip-btn ${isCurrent ? 'selected' : ''}" style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="selectMyQueueDirect(${loc.queue.id}, '${loc.queue.name}')">
        <span>📍 ${loc.name} (${loc.queue.name})</span>
        <span onclick="deleteLocation(${idx}, event)" style="opacity:0.7; font-weight:bold; padding:0 2px;" title="Видалити">&times;</span>
      </div>
    `;
  }).join('');
}

/**
 * Експорт графіку відключень у формат iCalendar (.ics)
 */
function initCalendarExport() {
  const btnExport = document.getElementById('btnExportCalendar');
  if (!btnExport) return;

  btnExport.addEventListener('click', () => {
    if (!state.myQueue) {
      alert('Будь ласка, спочатку оберіть вашу чергу для експорту в календар!');
      return;
    }

    const activeSchedule = state.schedulesMap[state.selectedDateLabel];
    if (!activeSchedule || !state.timeSeries.length) {
      alert('Дані графіка для обраної дати відсутні.');
      return;
    }

    const matrix = {};
    (activeSchedule.series || []).forEach(item => {
      matrix[`${item.outage_queue_id}_${item.time_series_id}`] = item.type;
    });

    // Збираємо слоти з відключеннями (OFF та SURE_OFF)
    const offIntervals = [];
    let currentInterval = null;

    state.timeSeries.forEach(slot => {
      const type = matrix[`${state.myQueue.id}_${slot.id}`];
      const isOff = type === 'OFF' || type === 'SURE_OFF';

      if (isOff) {
        if (!currentInterval) {
          currentInterval = { start: slot.start, end: slot.end };
        } else {
          currentInterval.end = slot.end; // об'єднуємо суміжні півгодини
        }
      } else {
        if (currentInterval) {
          offIntervals.push(currentInterval);
          currentInterval = null;
        }
      }
    });
    if (currentInterval) {
      offIntervals.push(currentInterval);
    }

    if (!offIntervals.length) {
      alert(`Для черги ${state.myQueue.name} на дату ${state.selectedDateLabel} відключень немає! Світло буде весь день 💡`);
      return;
    }

    // Формуємо .ics файл
    const [d, m, y] = state.selectedDateLabel.split('.');
    const pad = (n) => String(n).padStart(2, '0');

    let icsEvents = '';
    offIntervals.forEach((interval, idx) => {
      const [sh, sm] = interval.start.split(':');
      const [eh, em] = interval.end.split(':');

      const dtStart = `${y}${m}${d}T${pad(sh)}${pad(sm)}00`;
      let dtEnd = `${y}${m}${d}T${pad(eh)}${pad(em)}00`;
      if (eh === '00' && em === '00') {
        // Наступна доба о 00:00
        const nextDay = new Date(Number(y), Number(m) - 1, Number(d) + 1);
        dtEnd = `${nextDay.getFullYear()}${pad(nextDay.getMonth() + 1)}${pad(nextDay.getDate())}T000000`;
      }

      icsEvents += `
BEGIN:VEVENT
UID:svitlo-${y}${m}${d}-${state.myQueue.name}-${idx}@energy.mk.ua
DTSTAMP:${dtStart}Z
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:⚡ Відключення світла (Черга ${state.myQueue.name})
DESCRIPTION:Планове відключення за графіком Миколаївобленерго: ${interval.start.slice(0, 5)} - ${interval.end.slice(0, 5)}
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
DESCRIPTION:Нагадування: через 15 хвилин відключення світла!
END:VALARM
END:VEVENT`;
    });

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Svitlo MK PWA//UA
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Відключення світла (Черга ${state.myQueue.name})
${icsEvents}
END:VCALENDAR`;

    // Завантаження файлу
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `svitlo_cherha_${state.myQueue.name}_${d}_${m}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

/* ==========================================================================
   8. WEB SHARE API ТА БРАУЗЕРНІ СПОВІЩЕННЯ
   ========================================================================== */

let lastNotifiedStatus = null;

function initShareAndNotifications() {
  const btnShare = document.getElementById('btnShareSchedule');
  const btnNotif = document.getElementById('btnToggleNotifications');

  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      if (!state.myQueue) {
        alert('Будь ласка, спочатку оберіть вашу чергу!');
        return;
      }

      const statusText = document.getElementById('heroStatusText')?.textContent || '';
      const nextChangeText = document.getElementById('heroNextChange')?.textContent || '';
      const shareData = {
        title: `Світло МК — Черга ${state.myQueue.name}`,
        text: `⚡ Статус по черзі ${state.myQueue.name} (Миколаїв):\n• Зараз: ${statusText}\n• Очікується: ${nextChangeText}\n\nПереглянути повний графік:`,
        url: window.location.href
      };

      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch (_) {
          // Користувач скасував діалог
        }
      } else {
        // Fallback: копіюємо в буфер обміну
        navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`).then(() => {
          alert('Текст графіка успішно скопійовано в буфер обміну! Можна надіслати у Viber або Telegram.');
        });
      }
    });
  }

  if (btnNotif) {
    const updateBtnText = () => {
      if ('Notification' in window && Notification.permission === 'granted') {
        btnNotif.textContent = '🔔 Сповіщення за 1 год (Активні)';
        btnNotif.style.opacity = '1';
      } else {
        btnNotif.textContent = '🔔 Увімкнути сповіщення за 1 год';
      }
    };
    updateBtnText();

    btnNotif.addEventListener('click', async () => {
      if (!('Notification' in window)) {
        alert('Ваш браузер не підтримує системні сповіщення.');
        return;
      }

      if (Notification.permission === 'granted') {
        // Пропонуємо тестове сповіщення
        if (confirm('Сповіщення вже увімкнені!\n\nБажаєте надіслати тестове попередження за 1 годину, щоб перевірити звук, вібрацію та пуш?')) {
          playWarningBeep();
          if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
          sendSystemNotification(
            '⏳ Світло МК: Відключення через 1 годину! (Тест)',
            'Це перевірка. Залишилась 1 година до відключення — час підзарядити телефони та завершити термінові справи!'
          );
        }
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        updateBtnText();
        playWarningBeep();
        sendSystemNotification(
          '🔔 Сповіщення активовано!',
          'Світло МК обов\'язково попередить вас за 1 годину до планового відключення!'
        );
      } else {
        alert('Дозвіл на сповіщення відхилено в налаштуваннях браузера.');
      }
    });
  }
}
