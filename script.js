// ============================================================
// 🔑 LIFF ID 固定常數（唯一來源）
// ------------------------------------------------------------
// 兩個 LIFF App 的 ID 只能是這裡列出的固定字串，任何地方都不得從網址參數
// （liffId、bind_token、mode 等使用者可修改的值）直接組出或覆寫這兩個值。
//   newProvider：日常登入唯一身分來源，取得的 userId 對應 Users I 欄 line_user_id。
//   oldProvider：僅供「舊會員轉移」比對，取得的 userId 對應 Users A 欄 liff_uid。
// ⚠️ 外部相依：這兩個 LIFF App 在 LINE Developers Console 的 Endpoint URL 都必須指向
//    這個網站，這件事無法從程式碼驗證，請務必人工確認。
// ============================================================
const LIFF_CONFIG = Object.freeze({
  newProvider: '2008874129-yXMzEm9u',
  oldProvider: '2008873691-AM28m7jo'
});

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  LIFF_ID: LIFF_CONFIG.newProvider
};

// ============================================================
// 🔐 舊會員轉移驗證模式（LINE Bot 綁定流程 + 直接開站自助轉移共用）
// ------------------------------------------------------------
// 舊 Provider 的 LIFF App，只用於「舊會員轉移」：liff.getProfile().userId
// 對應 Users A 欄 liff_uid。跟 CONFIG.LIFF_ID（新 Provider，日常登入）
// 是兩個不同的 LIFF App，同一次頁面生命週期只能 init 其中一個（見下方 MODE）。
//
// BIND_CONFIG.BACKEND_URL 是「LINE bot liff」Apps Script 專案（處理 LINE Webhook 與
// bindByOldLiffUid 的那個專案，跟這個會員系統的 CONFIG.API_URL 是不同專案）
// 部署成 Web App 後的網址。
// ============================================================
const OLD_LIFF_CONFIG = {
  LIFF_ID: LIFF_CONFIG.oldProvider
};
const BIND_CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbyy8rTyTay0D_QYeX6ZDuywFXFQWzZFbqeChmvZFjomZVfqxtmbM-CWChbwWmUY6uJy/exec'
};

/**
 * LIFF ID 格式防呆：只接受「數字-英數/底線/連字號」這種官方 LIFF ID 格式
 * （例如 2008874129-yXMzEm9u），拒絕完整 https://liff.line.me/... URL、
 * 空字串、undefined、null，或任何未解析過的原始值。
 */
function isValidLiffId(value) {
  return typeof value === 'string'
    && /^\d+-[A-Za-z0-9_-]+$/.test(value.trim());
}

/**
 * 全站唯一呼叫 liff.init() 的入口。呼叫前先印診斷資訊、做格式防呆；
 * 失敗時記錄詳細診斷（但絕不把 bind_token 或其他一次性 token 印在畫面上，
 * 只印在 console）。liffId 一律來自 LIFF_CONFIG 固定常數，不接受外部傳入的原始字串。
 * @param {string} liffId 必須是 LIFF_CONFIG.newProvider 或 LIFF_CONFIG.oldProvider
 * @param {string} mode 診斷用途的流程名稱，例如 'new-primary' / 'old-bind-token' / 'old-self-transfer'
 */
async function initLiff_(liffId, mode) {
  console.log('[LIFF_INIT]', { mode: mode, selectedProvider: liffId, liffId: liffId, href: window.location.href });

  if (!isValidLiffId(liffId)) {
    const err = new Error('liffId 格式不符，拒絕呼叫 liff.init()');
    err.code = 'INVALID_LIFF_ID_FORMAT';
    console.error('[LIFF_INIT_FAILED]', { code: err.code, message: err.message, liffId: liffId, mode: mode, href: window.location.href });
    throw err;
  }

  try {
    await liff.init({ liffId: liffId });
  } catch (err) {
    console.error('[LIFF_INIT_FAILED]', { code: err && err.code, message: err && err.message, liffId: liffId, mode: mode, href: window.location.href });
    throw err;
  }
}

// ============================================================
// 🧯 安全版 sessionStorage 包裝
// ------------------------------------------------------------
// LINE App 內建瀏覽器或部分外部瀏覽器的無痕/隱私模式可能讓
// sessionStorage 完全不可用（讀寫直接 throw）。這裡一律 try/catch，
// 並額外用 localStorage 當作第二層備援（用於登入嘗試旗標等需要
// 跨這次導轉存活的資料），最後才落到記憶體變數，確保任何環境都
// 不會直接整頁掛掉，也不會因為存不住旗標而造成登入迴圈判斷失效。
// ============================================================
const __memoryStorage = {};

function safeSessionGet_(key) {
  try {
    const v = sessionStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* sessionStorage 不可用，往下層備援 */ }
  try {
    const v = localStorage.getItem('__sf_' + key);
    if (v !== null) return v;
  } catch (e) { /* localStorage 也不可用 */ }
  return __memoryStorage[key] !== undefined ? __memoryStorage[key] : null;
}

function safeSessionSet_(key, value) {
  try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  try { localStorage.setItem('__sf_' + key, value); } catch (e) { /* ignore */ }
  __memoryStorage[key] = value;
}

function safeSessionRemove_(key) {
  try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
  try { localStorage.removeItem('__sf_' + key); } catch (e) { /* ignore */ }
  delete __memoryStorage[key];
}

function safeSessionClear_() {
  try { sessionStorage.clear(); } catch (e) { /* ignore */ }
  Object.keys(__memoryStorage).forEach((k) => delete __memoryStorage[k]);
}

const urlParams = new URLSearchParams(window.location.search);
const FROM_LINE = urlParams.get("from") === "line";
// 防止重複回跳
const HAS_REDIRECTED = safeSessionGet_("__from_line_done") === "1";
// 舊會員轉移驗證模式（LINE Bot 綁定流程專用）：網址帶這個參數才會觸發，只放一次性 token，不含任何 UID。
const BIND_TOKEN = urlParams.get("bind_token");
// 使用者直接開站、新 UID 查 I 欄找不到時，自助「舊會員帳號轉移」流程：見 startOldAccountTransfer() / runSelfTransferMode()。
const SELF_TRANSFER = urlParams.get("self_transfer") === "1";

/**
 * 這次頁面生命週期要走哪個流程，只由「網址有沒有帶對應參數」決定，不會讀取
 * 任何使用者可修改的值來當作 liffId。三種模式互斥，且只有其中一種模式會被
 * window.onload 執行，確保同一次頁面生命週期只會呼叫一次 liff.init()。
 *   old-self-transfer → 只 init LIFF_CONFIG.oldProvider（runSelfTransferMode）
 *   old-bind-token    → 只 init LIFF_CONFIG.oldProvider（runBindTokenMode）
 *   new-primary       → 只 init LIFF_CONFIG.newProvider（一般會員登入）
 */
const MODE = SELF_TRANSFER ? 'old-self-transfer' : (BIND_TOKEN ? 'old-bind-token' : 'new-primary');

const APP_VERSION = 'v9.2.0 (Single LIFF Init Per Page)';
let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };
let currentOrdersData = [];

window.onload = async () => {
  const vEl = document.getElementById('app-version-display');
  if(vEl) vEl.innerText = APP_VERSION;

  // MODE 在網址參數解析當下就已經決定好，這裡只是照 MODE 分流，
  // 三個分支互斥、每個分支各自只呼叫一次 liff.init()，同一次頁面生命週期
  // 絕不會先 init 一個 LIFF ID、又在同一頁再 init 另一個 LIFF ID
  // （這正是先前「Invalid LIFF ID」的根因：舊版程式碼會先 init 新 Provider，
  // 直到 checkUser 回 NOT_FOUND 才發現網址帶 bind_token，才回頭 init 舊 Provider）。
  if (MODE === 'old-self-transfer') {
    await runSelfTransferMode();
    return;
  }
  if (MODE === 'old-bind-token') {
    await runBindTokenMode(BIND_TOKEN);
    return;
  }

  // MODE === 'new-primary'：一般會員登入，唯一身分來源。
  try {
    await initLiff_(LIFF_CONFIG.newProvider, MODE);

    if (!liff.isLoggedIn()) {
      // 防止登入迴圈：同一頁只允許自動呼叫一次 liff.login()。
      // 若上一次已經呼叫過、這次回來仍是未登入狀態，代表 callback 沒有成功建立登入狀態，
      // 停下來讓使用者看到明確錯誤與「重新登入」按鈕，不再自動重導。
      const alreadyAttempted = safeSessionGet_('__login_attempted_new') === '1';
      if (alreadyAttempted) {
        showLoginError_('登入未完成或已逾時，請重新登入。');
        return;
      }
      safeSessionSet_('__login_attempted_new', '1');
      liff.login();
      return;
    }

    safeSessionRemove_('__login_attempted_new');
    currentUid = (await liff.getProfile()).userId;
    await handleMemberLogin(currentUid);
  } catch (e) {
    console.error(e); hideLoading();
    if (e && e.code === 'INVALID_LIFF_ID_FORMAT') {
      showLoginError_('系統設定錯誤，請聯絡管理員。');
    } else {
      showLoginError_('系統連線錯誤: ' + e.message);
    }
  }
};

/**
 * 統一的新登入判斷邏輯：用新 line_user_id 呼叫 checkUser，一律依 code 分流，
 * 不靠 message 文字判斷。只會在 MODE === 'new-primary' 時被呼叫
 * （bind_token / self_transfer 模式在 window.onload 就已經分流走了，不會進來這裡）。
 *   FOUND              → 直接登入（不論 A 欄有無值，都視為正常會員，不要求重新註冊/綁定）
 *   DUPLICATE_NEW_UID  → 停止登入，顯示資料異常
 *   NOT_FOUND          → 先給「舊會員帳號轉移」選項，不直接跳去新會員註冊頁
 * @param {string} newUid 新 Provider 的 line_user_id
 */
async function handleMemberLogin(newUid) {
  const cacheKey = `ormkub_member_${newUid}`;
  const cachedString = safeSessionGet_(cacheKey);

  let cachedUser = null;
  if (cachedString) {
    try {
      cachedUser = JSON.parse(cachedString);
    } catch (e) {
      safeSessionRemove_(cacheKey);
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
    safeSessionSet_(cacheKey, JSON.stringify(u));
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
    // 成功登入且確定不是「等待關窗回跳」的流程時，清掉網址上的 callback 參數，回到乾淨首頁網址。
    cleanupUrlIfNeeded_();
    return;
  }

  // NOT_FOUND：只是拿得到新 UID，不代表已註冊。這裡一定是 new-primary 模式
  // （bind_token 模式已經在 window.onload 分流掉，不會執行到這行），
  // 先給「舊會員帳號轉移」選項，不要直接跳去新會員註冊。
  if (!cachedUser) {
    hideLoading();
    showView('old-member-transfer-view');
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
  safeSessionSet_("__from_line_done", "1");

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
 * 只會在 MODE === 'old-bind-token' 時被呼叫，這次頁面生命週期不會再有任何
 * 其他分支呼叫 liff.init()，全頁只 init 這一個 LIFF App。
 * @param {string} bindToken 網址帶入的一次性 token
 */
async function runBindTokenMode(bindToken) {
  try {
    await initLiff_(LIFF_CONFIG.oldProvider, 'old-bind-token'); // 舊 Provider，僅供舊會員轉移

    if (!liff.isLoggedIn()) {
      // 防止登入迴圈：同一頁只允許自動呼叫一次 liff.login()。
      const alreadyAttempted = safeSessionGet_('__login_attempted_old') === '1';
      if (alreadyAttempted) {
        showLoginError_('舊帳號登入未完成或已逾時，請重新登入。');
        return;
      }
      safeSessionSet_('__login_attempted_old', '1');
      liff.login(); // 登入完成後會帶著同一個 bind_token 重新載入本頁
      return;
    }
    safeSessionRemove_('__login_attempted_old');

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
    if (e && e.code === 'INVALID_LIFF_ID_FORMAT') {
      showLoginError_('系統設定錯誤，請聯絡管理員。');
    } else {
      showLoginError_('系統錯誤，請聯繫管理員。');
    }
  }
}

/**
 * 使用者直接開站、新 UID 查 I 欄找不到時的「舊會員帳號轉移」自助流程（無 bind_token）。
 * 只會在 MODE === 'old-self-transfer' 時被呼叫，這次頁面生命週期不會再有任何
 * 其他分支呼叫 liff.init()，全頁只 init 這一個 LIFF App。新 UID 透過 safeSession
 * 存起來跨這次 reload 傳遞，不放進網址，維持既有「UID 不進網址」的安全原則。
 */
async function runSelfTransferMode() {
  try {
    const pendingNewUid = safeSessionGet_('pendingNewUid');
    if (!pendingNewUid) {
      // 沒有暫存的新 UID（例如被直接開啟 ?self_transfer=1），視為異常，導回乾淨首頁重新走正常登入。
      window.location.replace(window.location.origin + window.location.pathname);
      return;
    }

    await initLiff_(LIFF_CONFIG.oldProvider, 'old-self-transfer'); // 舊 Provider，僅供舊會員轉移

    if (!liff.isLoggedIn()) {
      const alreadyAttempted = safeSessionGet_('__login_attempted_old') === '1';
      if (alreadyAttempted) {
        showLoginError_('舊帳號登入未完成或已逾時，請重新登入。');
        return;
      }
      safeSessionSet_('__login_attempted_old', '1');
      liff.login();
      return;
    }
    safeSessionRemove_('__login_attempted_old');

    const profile = await liff.getProfile();
    const oldLiffUid = profile.userId;

    showLoading();
    const result = await callMemberApi('linkOldAccount', { oldLiffUid: oldLiffUid, newLineUserId: pendingNewUid });
    hideLoading();

    const successCodes = ['BIND_SUCCESS', 'ALREADY_BOUND'];
    if (result && successCodes.indexOf(result.code) !== -1 && result.data) {
      // 轉移完成：交回一般登入流程重新確認並進入 dashboard，不在這裡另外維護一份 render 邏輯。
      safeSessionRemove_('pendingNewUid');
      cleanupUrlIfNeeded_();
      return;
    }

    if (result && result.code === 'OLD_MEMBER_NOT_FOUND') {
      currentUid = pendingNewUid;
      safeSessionRemove_('pendingNewUid');
      showView('register-view');
      return;
    }

    // DUPLICATE_NEW_UID / BIND_CONFLICT / DUPLICATE_OLD_UID 等資料衝突：一律不自動處理，交由人工。
    safeSessionRemove_('pendingNewUid');
    showBindResult((result && result.message) || '系統資料異常，請聯絡管理員處理。');
  } catch (e) {
    console.error(e);
    hideLoading();
    if (e && e.code === 'INVALID_LIFF_ID_FORMAT') {
      showLoginError_('系統設定錯誤，請聯絡管理員。');
    } else {
      showLoginError_('系統連線錯誤: ' + e.message);
    }
  }
}

/**
 * 「驗證並轉移舊帳號」按鈕：把目前已知的新 UID 暫存起來，帶 self_transfer=1 重新整理頁面，
 * 讓 runSelfTransferMode 在乾淨的頁面生命週期內完成舊帳號驗證。
 */
function startOldAccountTransfer() {
  if (!currentUid) {
    showBindResult('系統尚未取得您的登入資訊，請重新整理頁面後再試一次。');
    return;
  }
  safeSessionSet_('pendingNewUid', currentUid);
  showLoading();
  window.location.replace(window.location.origin + window.location.pathname + '?self_transfer=1');
}

/**
 * 清除網址上的一次性 callback／模式參數（from、bind_token、self_transfer 等），
 * 回到乾淨的官方首頁網址。用 location.replace 是刻意的：不留在瀏覽紀錄裡，
 * 避免使用者按上一頁又帶著舊參數重新觸發一次登入流程。
 * 網址上已經沒有任何查詢參數時直接跳過，避免無意義的重複導轉。
 */
function cleanupUrlIfNeeded_() {
  try {
    if (!window.location.search) return;
    const cleanUrl = window.location.origin + window.location.pathname;
    window.location.replace(cleanUrl);
  } catch (e) {
    console.error(e);
  }
}

/**
 * 登入／callback 發生無法自動復原的錯誤時的統一顯示：清楚錯誤訊息 + 「重新登入」按鈕，
 * 不會自動重導回 LINE 登入，交由使用者主動點擊才會重新嘗試。
 */
function showLoginError_(message) {
  hideLoading();
  const body = document.getElementById('m-body');
  const retryBtn = document.getElementById('m-retry-btn');
  if (body) body.innerText = message;
  if (retryBtn) retryBtn.classList.remove('hidden');
  new bootstrap.Modal(document.getElementById('infoModal')).show();
}

/** 使用者主動點擊「重新登入」：清掉登入嘗試旗標與暫存狀態，重新整理回乾淨首頁重新走一次登入流程。 */
function retryLoginFromError_() {
  safeSessionRemove_('__login_attempted_new');
  safeSessionRemove_('__login_attempted_old');
  safeSessionRemove_('pendingNewUid');
  window.location.replace(window.location.origin + window.location.pathname);
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

/** 沿用既有的系統訊息 Modal 顯示結果。非登入錯誤情境，重新登入按鈕維持隱藏。 */
function showBindResult(text) {
  const retryBtn = document.getElementById('m-retry-btn');
  if (retryBtn) retryBtn.classList.add('hidden');
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
  safeSessionClear_();
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
      safeSessionSet_(`ormkub_member_${currentUid}`, JSON.stringify(result.data));
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
  const cachedStr = safeSessionGet_(cacheKey);

  if (cachedStr) {
    try { renderMarkets(JSON.parse(cachedStr)); loadedData.markets = true; } catch(e){}
  } else if (!isBackground) {
    div.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  }
  try {
    const mkts = await callApi('getMarkets', {uid});
    safeSessionSet_(cacheKey, JSON.stringify(mkts));
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
  const cachedStr = safeSessionGet_(cacheKey);

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
    safeSessionSet_(cacheKey, JSON.stringify(groups || []));
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
  ['register-view', 'old-member-transfer-view', 'dashboard-view'].forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}
