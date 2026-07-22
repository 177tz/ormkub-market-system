const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  // ✅ 新 Provider 的 Login LIFF：日常登入的唯一身分來源，取得的 userId 對應 Users I 欄 line_user_id。
  // ⚠️ 外部相依：這個 LIFF App 在 LINE Developers Console 的 Endpoint URL 必須指向這個網站，
  //    這件事無法從程式碼驗證，請務必人工確認。
  LIFF_ID: '2008874129-yXMzEm9u'
};

// ============================================================
// 🔐 舊會員轉移驗證模式（LINE Bot 綁定流程專用）
// ------------------------------------------------------------
// 舊 Provider 的 LIFF App，只用於「舊會員轉移」：liff.getProfile().userId
// 對應 Users A 欄 liff_uid。跟上面 CONFIG.LIFF_ID（新 Provider，日常登入）
// 是兩個不同的 LIFF App，不可混用。網址帶 ?bind_token=xxx 時才會進入這個分支。
//
// BIND_CONFIG.BACKEND_URL 是「LINE bot liff」Apps Script 專案（處理 LINE Webhook 與
// bindByOldLiffUid 的那個專案，跟這個會員系統的 CONFIG.API_URL 是不同專案）
// 部署成 Web App 後的網址。
// ============================================================
const OLD_LIFF_CONFIG = {
  LIFF_ID: '2008873691-AM28m7jo'
};
const BIND_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyy8rTyTay0D_QYeX6ZDuywFXFQWzZFbqeChmvZFjomZVfqxtmbM-CWChbwWmUY6uJy/exec'
};

const urlParams = new URLSearchParams(window.location.search);
const FROM_LINE = urlParams.get("from") === "line";
// 防止重複回跳
const HAS_REDIRECTED = sessionStorage.getItem("__from_line_done") === "1";
// 舊會員轉移驗證模式：網址帶這個參數才會觸發，只放一次性 token，不含任何 UID。
const BIND_TOKEN = urlParams.get("bind_token");

const APP_VERSION = 'v9.0.0 (New Provider Primary)';
let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };
let currentOrdersData = [];

window.onload = async () => {
  const vEl = document.getElementById('app-version-display');
  if(vEl) vEl.innerText = APP_VERSION;

  try {
    // ✅ 新 Provider LIFF：日常登入唯一身分來源。
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    currentUid = (await liff.getProfile()).userId;
    await handleMemberLogin(currentUid);
  } catch (e) {
    console.error(e); hideLoading();
    document.getElementById('m-body').innerText = '系統連線錯誤: ' + e.message;
    new bootstrap.Modal(document.getElementById('infoModal')).show();
  }
};

/**
 * 統一的新登入判斷邏輯：用新 line_user_id 呼叫 checkUser，一律依 code 分流，
 * 不靠 message 文字判斷。
 *   FOUND              → 直接登入（不論 A 欄有無值，都視為正常會員，不要求重新註冊/綁定）
 *   DUPLICATE_NEW_UID  → 停止登入，顯示資料異常
 *   NOT_FOUND          → 有 bind_token 則進入舊會員轉移，否則顯示新會員註冊頁
 * @param {string} newUid 新 Provider 的 line_user_id
 */
async function handleMemberLogin(newUid) {
  const cacheKey = `ormkub_member_${newUid}`;
  const cachedString = sessionStorage.getItem(cacheKey);

  let cachedUser = null;
  if (cachedString) {
    try {
      cachedUser = JSON.parse(cachedString);
    } catch (e) {
      sessionStorage.removeItem(cacheKey);
    }
  }

  if (cachedUser) {
    currentUser = cachedUser;
    renderProfile(cachedUser);

    if (maybeCloseFromLine()) return;

    hideLoading();
    showView('dashboard-view');
    handleUrlTab();
    loadMarkets(newUid, true);
    loadOrders(newUid, true);
  }

  let result;
  try {
    result = await callMemberApi('checkUser', { uid: newUid });
  } catch (e) {
    if (!cachedUser) { hideLoading(); alert('系統連線錯誤：' + e.message); }
    return;
  }

  if (result.code === 'DUPLICATE_NEW_UID') {
    hideLoading();
    showBindResult(result.message || '此 LINE 帳號對應到多筆會員資料，請聯絡管理員處理。');
    return;
  }

  if (result.code === 'FOUND') {
    const u = result.data;
    sessionStorage.setItem(cacheKey, JSON.stringify(u));
    currentUser = u;
    renderProfile(u);

    if (maybeCloseFromLine()) return;

    if (!cachedUser) {
      hideLoading();
      showView('dashboard-view');
      handleUrlTab();
      loadMarkets(newUid, true);
      loadOrders(newUid, true);
    }
    return;
  }

  // NOT_FOUND：只是拿得到新 UID，不代表已註冊。再判斷網址是否帶有效綁定 token。
  if (!cachedUser) {
    hideLoading();
    if (BIND_TOKEN) {
      await runBindTokenMode(BIND_TOKEN);
    } else {
      showView('register-view');
    }
  }
}

/**
 * 封裝既有的「從 LINE 進來、登入成功後自動關窗／回跳」邏輯（原本在 checkUser 內重複兩次），
 * 純粹抽成共用函式，行為完全不變。回傳 true 代表已處理（呼叫端應該直接 return）。
 */
function maybeCloseFromLine() {
  if (!(FROM_LINE && !HAS_REDIRECTED && window.liff)) return false;

  hideLoading();
  if (window.__closing) return true;
  window.__closing = true;
  sessionStorage.setItem("__from_line_done", "1");

  setTimeout(() => {
    if (window.history && window.location.search.includes("from=line")) {
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
    try {
      if (liff.isInClient()) {
        liff.closeWindow();
      } else {
        window.location.replace("line://app");
      }
    } catch (e) {
      window.location.replace("line://app");
    }
  }, 500);

  return true;
}

/**
 * 舊會員轉移驗證模式：用「舊 Provider」LIFF App 登入取得 oldLiffUid，
 * 連同一次性 bind_token 一起送到「LINE bot liff」專案的 bindByOldLiffUid，
 * 只顯示結果訊息，不進入會員 dashboard。
 * ⚠️ 這裡故意不重新呼叫 liff.init() 切換 LIFF ID（LIFF SDK 同一頁面切換不同
 * liffId 的行為未有官方保證），而是在最外層就已經走完全獨立的分支，
 * 全頁生命週期內只會用到一個 LIFF App，降低風險。
 * @param {string} bindToken 網址帶入的一次性 token
 */
async function runBindTokenMode(bindToken) {
  try {
    await liff.init({ liffId: OLD_LIFF_CONFIG.LIFF_ID }); // 舊 Provider，僅供舊會員轉移
    if (!liff.isLoggedIn()) { liff.login(); return; } // 登入完成後會帶著同一個 bind_token 重新載入本頁

    const profile = await liff.getProfile();
    const oldLiffUid = profile.userId;

    if (!BIND_CONFIG.BACKEND_URL || BIND_CONFIG.BACKEND_URL.indexOf('http') !== 0) {
      hideLoading();
      showBindResult('系統尚未設定完成，請聯繫管理員。');
      return;
    }

    const resp = await fetch(BIND_CONFIG.BACKEND_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'bindByOldLiffUid',
        bindToken: bindToken,
        oldLiffUid: oldLiffUid
      })
    });
    const result = await resp.json();

    hideLoading();

    const successCodes = ['BIND_SUCCESS', 'ALREADY_BOUND'];
    if (result && successCodes.indexOf(result.code) !== -1) {
      await showBindSuccessAndClose(result.message || '綁定完成');
    } else {
      showBindResult((result && result.message) || '系統錯誤，請聯繫管理員。');
    }
  } catch (e) {
    console.error(e);
    hideLoading();
    showBindResult('系統錯誤，請聯繫管理員。');
  }
}

/**
 * 綁定成功／已完成綁定（ALREADY_BOUND）時：顯示完成訊息，等待約 1 秒，
 * 在 LINE App 內優先嘗試自動關閉；不是 LINE App，或 closeWindow 失敗，
 * 都會提供明確的 fallback 文字，不會停在沒有下一步指引的畫面，
 * 也不會把已顯示的成功狀態改回失敗、更不會導回註冊頁。
 */
async function showBindSuccessAndClose(message) {
  showBindResult(message);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (!liff.isInClient()) {
    showBindResult((message ? message + '\n\n' : '') + '請返回 LINE 繼續使用。');
    return;
  }

  try {
    liff.closeWindow();
  } catch (e) {
    console.error(e);
    // closeWindow 失敗：成功狀態不變，但要給使用者明確可執行的下一步。
    showBindResult((message ? message + '\n\n' : '') + '請手動關閉此頁面，或返回 LINE 繼續使用。');
  }
}

/** 沿用既有的系統訊息 Modal 顯示結果，不新增任何 HTML 結構。 */
function showBindResult(text) {
  document.getElementById('m-body').innerText = text;
  new bootstrap.Modal(document.getElementById('infoModal')).show();
}

/** getMarkets / getOrders 等既有查詢沿用：只靠 status 文字判斷，行為完全不變。 */
async function callApi(act, pay={}) {
  const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({action: act, payload: pay}) });
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message);
  return j.data;
}

/**
 * 專供會員識別相關 action（checkUser / register）使用：回傳完整 {success,code,message,data}，
 * 由呼叫端依 code 判斷，不像 callApi() 只靠 status 文字丟例外。
 */
async function callMemberApi(act, pay={}) {
  const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({action: act, payload: pay}) });
  return await r.json();
}

function forceUpdate() {
  sessionStorage.clear();
  showLoading();
  location.reload();
}

function toggleGroup(header) {
  header.classList.toggle('active');
  const content = header.nextElementSibling;
  content.style.display = (content.style.display === 'none' || content.style.display === '') ? 'block' : 'none';
}

function handleUrlTab() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetTab = urlParams.get('tab');
  if (targetTab) {
    const navBtns = document.querySelectorAll('.nav-btn');
    let targetBtn = navBtns[0];
    if (targetTab === 'markets') targetBtn = navBtns[1];
    if (targetTab === 'orders') targetBtn = navBtns[2];
    if (targetTab === 'profile') targetBtn = navBtns[3];
    switchTab(targetTab, targetBtn);
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
    const result = await callMemberApi('register', {...vals, uid: currentUid});

    if (result.code === 'DUPLICATE_NEW_UID') {
      hideLoading();
      alert('系統資料異常，請聯絡管理員處理。');
      return;
    }

    // REGISTER_SUCCESS（新註冊）或 FOUND（重複送出，沿用既有會員）都視為完成，不新增重複會員列。
    if (result.data) {
      sessionStorage.setItem(`ormkub_member_${currentUid}`, JSON.stringify(result.data));
      currentUser = result.data;
    }

    alert('✅ 綁定成功');

    setTimeout(() => {
      // ⭐ 只有「LINE進來」才關
      if (FROM_LINE && window.liff && liff.isInClient()) {
        liff.closeWindow();
      } else {
        // 非LINE → 留在頁面
        forceUpdate();
      }
    }, 800);
  } catch(e) { hideLoading(); alert('綁定失敗: ' + e.message); }
}

function renderProfile(u) {
  document.getElementById('header-name').innerText = u.name;
  document.getElementById('header-group').innerText = u.group_name;
  
  const annoBox = document.getElementById('announcement-container');
  if (u.announcements && u.announcements.length > 0) {
    annoBox.innerHTML = u.announcements.map(a => {
      let typeClass = 'type-info'; let icon = 'bi-info-circle-fill';
      if (a.type === 'alert') { typeClass = 'type-alert'; icon = 'bi-exclamation-triangle-fill'; } 
      else if (a.type === 'success') { typeClass = 'type-success'; icon = 'bi-check-circle-fill'; }
      return `<div class="anno-card ${typeClass} fade-in"><div class="anno-title"><i class="bi ${icon}"></i> ${a.title}</div><div class="anno-content">${a.content}</div></div>`;
    }).join('');
  } else {
    annoBox.innerHTML = `<div class="anno-card type-info"><div class="anno-title"><i class="bi bi-megaphone-fill"></i> 最新公告</div><div class="anno-content">目前沒有新公告。</div></div>`;
  }
  ['group','email','phone','receiver','store'].forEach(k => { document.getElementById('p-'+k).innerText = u[k==='group'?'group_name':(k==='receiver'?'name':k)]; });
}

function switchTab(tab, btn) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'markets' && !loadedData.markets) loadMarkets(currentUid);
  if (tab === 'orders' && !loadedData.orders) loadOrders(currentUid);
}

async function loadMarkets(uid, isBackground = false) {
  const div = document.getElementById('market-list');
  const cacheKey = `ormkub_markets_${uid}`;
  const cachedStr = sessionStorage.getItem(cacheKey);

  if (cachedStr) {
    try { renderMarkets(JSON.parse(cachedStr)); loadedData.markets = true; } catch(e){}
  } else if (!isBackground) {
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  }
  try {
    const mkts = await callApi('getMarkets', {uid});
    sessionStorage.setItem(cacheKey, JSON.stringify(mkts));
    loadedData.markets = true;
    const currentTab = document.getElementById('tab-markets');
    if (!currentTab.classList.contains('hidden') || !cachedStr) renderMarkets(mkts);
  } catch(e) { if (!cachedStr && !isBackground) div.innerHTML = '載入失敗'; }
}

function renderMarkets(mkts) {
  const div = document.getElementById('market-list');
  div.innerHTML = mkts.length ? mkts.map(m => `<a href="${m.link}" target="_blank" class="btn-market fade-in"><div class="market-info"><h6>${m.sheetName}</h6><small>${m.desc||'點擊前往專屬賣場'}</small></div><i class="bi bi-chevron-right"></i></a>`).join('') : '<div class="text-center text-muted p-4">目前無專屬賣場</div>';
}

async function loadOrders(uid, isBackground = false) {
  const div = document.getElementById('orders-container');
  const cacheKey = `ormkub_orders_${uid}`;
  const cachedStr = sessionStorage.getItem(cacheKey);

  if (cachedStr) {
    try { 
      currentOrdersData = JSON.parse(cachedStr) || []; 
      handleSortOrders(); loadedData.orders = true; 
    } catch(e){}
  } else if (!isBackground) {
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="small mt-2 text-muted">同步訂單中...</div></div>';
  }

  try {
    const groups = await callApi('getOrders', {uid});
    sessionStorage.setItem(cacheKey, JSON.stringify(groups || []));
    loadedData.orders = true;
    currentOrdersData = groups || []; 
    const currentTab = document.getElementById('tab-orders');
    if (!currentTab.classList.contains('hidden') || !cachedStr) handleSortOrders();
  } catch(e) { if (!cachedStr && !isBackground) div.innerHTML = '載入失敗，請刷新重試'; }
}

function handleSortOrders() {
  const sortSelect = document.getElementById('order-sort');
  const method = sortSelect ? sortSelect.value : 'nameDesc'; 
  
  if (!currentOrdersData || !Array.isArray(currentOrdersData) || currentOrdersData.length === 0) {
    renderOrders([]); return;
  }

  let sortedGroups = [...currentOrdersData];
  const getStatusWeight = (st) => {
    if(!st) return 0;
    if(st.includes('✅') || st.includes('完成') || st.includes('OK') || st.includes('面交')) return 1;
    return 0; 
  };

  sortedGroups.sort((a, b) => {
    let nameA = a.groupName || ""; let nameB = b.groupName || "";
    let wA = getStatusWeight(a.summary?.[0]?.status); let wB = getStatusWeight(b.summary?.[0]?.status);
    if (method === 'nameDesc') return nameB.localeCompare(nameA, 'zh-TW'); 
    if (method === 'nameAsc') return nameA.localeCompare(nameB, 'zh-TW'); 
    if (method === 'statusWait') { if (wA !== wB) return wA - wB; return nameB.localeCompare(nameA, 'zh-TW'); }
    if (method === 'statusOk') { if (wA !== wB) return wB - wA; return nameB.localeCompare(nameA, 'zh-TW'); }
    return 0;
  });
  renderOrders(sortedGroups);
}

function renderOrders(groups) {
  const div = document.getElementById('orders-container');
  if (!groups || groups.length === 0) {
    div.innerHTML = `<div class="text-center py-5 fade-in"><i class="bi bi-basket display-1 text-muted opacity-25"></i><p class="mt-3 text-muted">尚無訂購紀錄</p></div>`; return;
  }
  const formatTime = (t) => {
    if (!t) return '-';
    try {
      let d = new Date(t); if (isNaN(d.getTime())) return t; 
      return d.getFullYear() + '/' + (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0') + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
    } catch(e) { return t; }
  };

  div.innerHTML = groups.map((g, index) => {
    const isFirst = index === 0; const displayStyle = isFirst ? 'block' : 'none'; const activeClass = isFirst ? 'active' : '';

    let details = (g.details && g.details.length) ? g.details.map(d => `<div class="item-row"><div><div class="item-name">${d.item}</div>${d.note ? `<div class="item-note">${d.note}</div>` : ''}</div><div class="item-qty">x${d.qty}</div></div>`).join('') : '<div class="text-center small text-muted py-2">無明細</div>';

    let summaryHtml = ''; let rowTotal = '0'; let rowStatus = '未標示'; let badgeCls = 'st-wait'; let rowDate = '-';
    
    if (g.summary && g.summary.length > 0) {
      let s = g.summary[0]; rowTotal = s.total; rowStatus = s.status || '未標示'; rowDate = formatTime(s.time);
      if(rowStatus.includes('✅') || rowStatus.includes('完成') || rowStatus.includes('OK') || rowStatus.includes('面交')) { badgeCls = 'st-ok'; }
      else if(rowStatus.includes('❌') || rowStatus.includes('有誤') || rowStatus.includes('不符')) { badgeCls = 'st-err'; }

      let noteHtml = s.note ? `<div class="mt-3 p-3 bg-warning bg-opacity-10 rounded-3 text-warning border border-warning border-opacity-25" style="font-size: 14px; font-weight: 600; white-space: pre-wrap;"><i class="bi bi-exclamation-circle-fill me-1"></i>備註：${s.note}</div>` : '';
      let actionBtn = s.formLink ? `<div class="mt-3"><a href="${s.formLink}" target="_blank" class="action-btn">前往匯款 / 填寫表單</a></div>` : '';

      summaryHtml = `<div class="info-grid"><div class="info-item"><span class="info-label">總件數</span><span class="info-value">${s.count || '-'} 件</span></div><div class="info-item"><span class="info-label">實收金額</span><span class="info-value val-blue">$${s.actual || '-'}</span></div><div class="info-item"><span class="info-label">後五碼</span><span class="info-value">${s.last5 || '未填'}</span></div><div class="info-item"><span class="info-label">收款時間</span><span class="info-value">${rowDate}</span></div></div>${noteHtml}${actionBtn}`;
    } else { summaryHtml = '<div class="text-center small text-muted">待核算</div>'; }

    return `<div class="transaction-row fade-in"><div class="group-header-clickable ${activeClass}" onclick="toggleGroup(this)"><div class="tx-left"><div class="tx-icon"><i class="bi bi-bag-check"></i></div><div class="tx-title"><span class="group-name">${g.groupName}</span><span class="tx-date">${rowDate}</span></div></div><div class="tx-right" style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;"><span style="font-size: 11px; font-weight: 700; color: #8E8E93; letter-spacing: 0.5px;">應付預收款項</span><span class="tx-amount" style="line-height: 1;">$${rowTotal}</span><span class="status-badge ${badgeCls}">${rowStatus}</span></div></div><div class="group-content" style="display: ${displayStyle};"><div class="item-list">${details}</div>${summaryHtml}</div></div>`;
  }).join('');
}

function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function showView(id) {
  document.getElementById('register-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}
