/**
 * Світло Миколаїв PWA - Головний додаток (Vanilla JS)
 * SPA-архітектура, робота з API off.energy.mk.ua, офлайн-режим, Service Worker
 */

// Базовий URL для API
// Пріоритет: 1) збережений користувачем Cloudflare Worker у налаштуваннях; 2) відносний шлях /api/...
function getApiBase() {
  const custom = localStorage.getItem('lightmk_custom_api');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/$/, '');
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
    const d = new Date(item.from);
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
  if (!state.selectedDateLabel || !map[state.selectedDateLabel]) {
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
  } else {
    nextEventEl.textContent = 'Змін до кінця поточної доби не заплановано';
  }
}

/**
 * Рендеринг 48-сегментної шкали на головній сторінці
 */
function renderHomeTimeline() {
  const container = document.getElementById('homeTimeline');
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
      if (type === 'OFF') typeClass = 'item-off';
      if (type === 'SURE_OFF') typeClass = 'item-sure-off';
      if (type === 'PROBABLY_OFF') typeClass = 'item-probably';
    }

    return `<div class="timeline-slot ${typeClass} ${isCurrent ? 'current-hour item-active' : ''}" 
                 title="${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)}"></div>`;
  }).join('');
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
