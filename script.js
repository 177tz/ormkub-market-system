// ================= 設定區 =================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  LIFF_ID: '2008873691-AM28m7jo'
};

const APP_VERSION = 'v8.1.0 (Speed Boost)';

let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };
let currentOrdersData = []; // 🔥 新增：用來儲存當前訂單資料以供排序

// ================= 初始化 =================
window.onload = async () => {
  const vEl = document.getElementById('app-version-display');
  if(vEl) vEl.innerText = APP_VERSION;

  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    
    currentUid = (await liff.getProfile()).userId;
    await checkUser(currentUid);
  } catch (e) { 
    console.error(e); 
    hideLoading(); 
    document.getElementById('m-body').innerText = '系統連線錯誤: ' + e.message;
    new bootstrap.Modal(document.getElementById('infoModal')).show();
  }
};

// ================= API 核心 =================
async function callApi(act, pay={}) {
  const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({action: act, payload: pay}) });
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message);
  return j.data;
}

function forceUpdate() {
  sessionStorage.clear();
  showLoading();
  location.reload();
}

// 🔥 手風琴切換功能 (必須放在全域)
function toggleGroup(header) {
  header.classList.toggle('active');
  const content = header.nextElementSibling;
  if (content.style.display === 'none' || content.style.display === '') {
    content.style.display = 'block';
  } else {
    content.style.display = 'none';
  }
}

// ================= 使用者邏輯 =================
async function checkUser(uid) {
  const cacheKey = `ormkub_user_${uid}`;
  const cached = sessionStorage.getItem(cacheKey);

  // 1. 若有快取，先秒速渲染畫面
  if (cached) {
    const u = JSON.parse(cached);
    currentUser = u;
    renderProfile(u);
    hideLoading();
    showView('dashboard-view');
    
    // 背景預先載入其他分頁資料
    loadMarkets(uid, true);
    loadOrders(uid, true);
  }

  // 2. 背景向 GAS 請求最新資料
  try {
    const u = await callApi('checkUser', {uid});
    if (u) {
      sessionStorage.setItem(cacheKey, JSON.stringify(u));
      currentUser = u;
      renderProfile(u); // 更新為最新資料
      
      if (!cached) {
        hideLoading();
        showView('dashboard-view');
        loadMarkets(uid, true);
        loadOrders(uid, true);
      }
    } else { 
      if (!cached) {
        hideLoading();
        showView('register-view'); 
      }
    }
  } catch (e) { 
    if (!cached) {
      hideLoading();
      alert(e.message); 
    }
  }
}

async function doRegister() {
  const ids = ['email','name','receiver','phone','store'];
  let vals = {};
  for (let k of ids) {
    let el = document.getElementById('reg-' + k);
    if (!el || !el.value.trim()) { alert('請填寫所有欄位'); return; }
    vals[k] = el.value.trim();
  }
  showLoading();
  try { 
    await callApi('register', {...vals, uid:currentUid}); 
    alert('綁定成功！');
    forceUpdate(); 
  } catch(e) { hideLoading(); alert('綁定失敗: ' + e.message); }
}

function renderProfile(u) {
  document.getElementById('header-name').innerText = u.name;
  document.getElementById('header-group').innerText = u.group_name;
  
  // 1. 首頁公告
  const annoBox = document.getElementById('announcement-container');
  if (u.announcements && u.announcements.length > 0) {
    annoBox.innerHTML = u.announcements.map(a => {
      let typeClass = 'type-info'; 
      let icon = 'bi-info-circle-fill';
      if (a.type === 'alert') { typeClass = 'type-alert'; icon = 'bi-exclamation-triangle-fill'; } 
      else if (a.type === 'success') { typeClass = 'type-success'; icon = 'bi-check-circle-fill'; }
      return `
        <div class="anno-card ${typeClass} fade-in">
          <div class="anno-title"><i class="bi ${icon}"></i> ${a.title}</div>
          <div class="anno-content">${a.content}</div>
        </div>`;
    }).join('');
  } else {
    annoBox.innerHTML = `
      <div class="anno-card type-info">
        <div class="anno-title"><i class="bi bi-megaphone-fill"></i> 最新公告</div>
        <div class="anno-content">目前沒有新公告。</div>
      </div>`;
  }

  // 3. 個人資料
  document.getElementById('p-group').innerText = u.group_name;
  document.getElementById('p-email').innerText = u.email;
  document.getElementById('p-phone').innerText = u.phone;
  document.getElementById('p-receiver').innerText = u.name;
  document.getElementById('p-store').innerText = u.store;
}

// ================= 頁面切換 =================
function switchTab(tab, btn) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');

  // 如果還沒載入過，且沒有快取，就觸發載入 (通常背景已經在載了)
  if (tab === 'markets' && !loadedData.markets) loadMarkets(currentUid);
  if (tab === 'orders' && !loadedData.orders) loadOrders(currentUid);
}

// ================= 資料載入：賣場 =================
async function loadMarkets(uid, isBackground = false) {
  const div = document.getElementById('market-list');
  const cacheKey = `ormkub_markets_${uid}`;
  const cached = sessionStorage.getItem(cacheKey);

  if (cached) {
    renderMarkets(JSON.parse(cached));
    loadedData.markets = true;
  } else if (!isBackground) {
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  }

  try {
    const mkts = await callApi('getMarkets', {uid});
    sessionStorage.setItem(cacheKey, JSON.stringify(mkts));
    loadedData.markets = true;
    
    // 如果目前停留在賣場 tab，或是原本沒有快取，就更新畫面
    const currentTab = document.getElementById('tab-markets');
    if (!currentTab.classList.contains('hidden') || !cached) {
      renderMarkets(mkts);
    }
  } catch(e) { 
    if (!cached && !isBackground) div.innerHTML = '載入失敗'; 
  }
}

function renderMarkets(mkts) {
  const div = document.getElementById('market-list');
  div.innerHTML = mkts.length ? mkts.map(m => `
    <a href="${m.link}" target="_blank" class="btn-market fade-in">
      <div class="market-info">
        <h6>${m.sheetName}</h6>
        <small>${m.desc||'點擊前往專屬賣場'}</small>
      </div>
      <i class="bi bi-chevron-right"></i>
    </a>`).join('') : '<div class="text-center text-muted p-4">目前無專屬賣場</div>';
}

// ================= 資料載入：訂單 =================
async function loadOrders(uid, isBackground = false) {
  const div = document.getElementById('orders-container');
  const cacheKey = `ormkub_orders_${uid}`;
  const cached = sessionStorage.getItem(cacheKey);

  if (cached) {
    currentOrdersData = JSON.parse(cached) || [];
    handleSortOrders();
    loadedData.orders = true;
  } else if (!isBackground) {
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="small mt-2 text-muted">同步訂單中...</div></div>';
  }

  try {
    const groups = await callApi('getOrders', {uid});
    sessionStorage.setItem(cacheKey, JSON.stringify(groups || []));
    loadedData.orders = true;
    currentOrdersData = groups || []; // 🔥 加上 || [] 避免空資料時報錯
    
    const currentTab = document.getElementById('tab-orders');
    if (!currentTab.classList.contains('hidden') || !cached) {
      handleSortOrders();
    }
  } catch(e) { 
    if (!cached && !isBackground) div.innerHTML = '載入失敗，請刷新重試'; 
  }
}

// 🔥 排序邏輯 (加入防呆機制)
function handleSortOrders() {
  const sortSelect = document.getElementById('order-sort');
  const method = sortSelect ? sortSelect.value : 'nameDesc'; 
  
  // 🔥 防呆：確保 currentOrdersData 裡面真的有東西，沒有就直接渲染空畫面，避免當機
  if (!currentOrdersData || !Array.isArray(currentOrdersData) || currentOrdersData.length === 0) {
    renderOrders([]);
    return;
  }

  let sortedGroups = [...currentOrdersData];
  
  const getStatusWeight = (st) => {
    if(!st) return 0;
    if(st.includes('✅') || st.includes('完成') || st.includes('OK') || st.includes('面交')) return 1;
    return 0; 
  };

  sortedGroups.sort((a, b) => {
    let nameA = a.groupName || "";
    let nameB = b.groupName || "";

    let wA = getStatusWeight(a.summary?.[0]?.status);
    let wB = getStatusWeight(b.summary?.[0]?.status);

    if (method === 'nameDesc') return nameB.localeCompare(nameA, 'zh-TW'); 
    if (method === 'nameAsc') return nameA.localeCompare(nameB, 'zh-TW'); 
    
    if (method === 'statusWait') {
      if (wA !== wB) return wA - wB; 
      return nameB.localeCompare(nameA, 'zh-TW'); 
    }
    if (method === 'statusOk') {
      if (wA !== wB) return wB - wA; 
      return nameB.localeCompare(nameA, 'zh-TW'); 
    }
    return 0;
  });

  renderOrders(sortedGroups);
}

function renderOrders(groups) {
  const div = document.getElementById('orders-container');
  if (!groups || groups.length === 0) {
    div.innerHTML = `<div class="text-center py-5 fade-in"><i class="bi bi-basket display-1 text-muted opacity-25"></i><p class="mt-3 text-muted">尚無訂購紀錄</p></div>`;
    return;
  }

  const formatTime = (t) => {
    if (!t) return '-';
    try {
      let d = new Date(t);
      if (isNaN(d.getTime())) return t; 
      return d.getFullYear() + '/' + (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0') + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    } catch(e) { return t; }
  };

  div.innerHTML = groups.map((g, index) => {
    const isFirst = index === 0;
    const displayStyle = isFirst ? 'block' : 'none';
    const activeClass = isFirst ? 'active' : '';

    // 🔥 已經將 <i class="bi bi-info-circle-fill me-1"></i> 移除
    let details = (g.details && g.details.length) ? g.details.map(d => `
      <div class="item-row">
        <div>
          <div class="item-name">${d.item}</div>
          ${d.note ? `<div class="item-note">${d.note}</div>` : ''}
        </div>
        <div class="item-qty">x${d.qty}</div>
      </div>`).join('') : '<div class="text-center small text-muted py-2">無明細</div>';

    let summaryHtml = '';
    let rowTotal = '0';
    let rowStatus = '未標示';
    let badgeCls = 'st-wait';
    let rowDate = '-';
    
    if (g.summary && g.summary.length > 0) {
      let s = g.summary[0];
      rowTotal = s.total;
      rowStatus = s.status || '未標示';
      rowDate = formatTime(s.time);
      
      if(rowStatus.includes('✅') || rowStatus.includes('完成') || rowStatus.includes('OK') || rowStatus.includes('面交')) { badgeCls = 'st-ok'; }
      else if(rowStatus.includes('❌') || rowStatus.includes('有誤') || rowStatus.includes('不符')) { badgeCls = 'st-err'; }

      let noteHtml = s.note ? `<div class="mt-3 p-3 bg-warning bg-opacity-10 rounded-3 text-warning border border-warning border-opacity-25" style="font-size: 14px; font-weight: 600; white-space: pre-wrap;"><i class="bi bi-exclamation-circle-fill me-1"></i>備註：${s.note}</div>` : '';
      
      let actionBtn = s.formLink ? `
        <div class="mt-3">
          <a href="${s.formLink}" target="_blank" class="action-btn">前往匯款 / 填寫表單</a>
        </div>
      ` : '';

      summaryHtml = `
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">總件數</span>
            <span class="info-value">${s.count || '-'} 件</span>
          </div>
          <div class="info-item">
            <span class="info-label">實收金額</span>
            <span class="info-value val-blue">$${s.actual || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">後五碼</span>
            <span class="info-value">${s.last5 || '未填'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">收款時間</span>
            <span class="info-value">${rowDate}</span>
          </div>
        </div>
        ${noteHtml}
        ${actionBtn}
      `;
    } else {
      summaryHtml = '<div class="text-center small text-muted">待核算</div>';
    }

    return `
      <div class="transaction-row fade-in">
        <div class="group-header-clickable ${activeClass}" onclick="toggleGroup(this)">
          <div class="tx-left">
            <div class="tx-icon"><i class="bi bi-bag-check"></i></div>
            <div class="tx-title">
              <span class="group-name">${g.groupName}</span>
              <span class="tx-date">${rowDate}</span>
            </div>
          </div>
          <div class="tx-right" style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
            <span style="font-size: 11px; font-weight: 700; color: #8E8E93; letter-spacing: 0.5px;">應付預收款項</span>
            <span class="tx-amount" style="line-height: 1;">$${rowTotal}</span>
            <span class="status-badge ${badgeCls}">${rowStatus}</span>
          </div>
        </div>
        <div class="group-content" style="display: ${displayStyle};">
          <div class="item-list">${details}</div>
          ${summaryHtml}
        </div>
      </div>`;
  }).join('');
}
