// ================= 設定區 =================
const CONFIG = {
  // 您的 GAS 部署網址 (分拆版)
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  // 您的 LIFF ID
  LIFF_ID: '2008873691-AM28m7jo' 
};

let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };

// ================= 初始化 =================
window.onload = async () => {
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

// ================= 使用者邏輯 =================
async function checkUser(uid) {
  try {
    const u = await callApi('checkUser', {uid});
    hideLoading();
    if (u) {
      currentUser = u;
      renderProfile(u);
      showView('dashboard-view');
    } else { showView('register-view'); }
  } catch (e) { alert(e.message); }
}

function renderProfile(u) {
  document.getElementById('header-name').innerText = u.name;
  document.getElementById('header-group').innerText = u.group_name;
  // 🔥 新增這一行：更新公告
  if(u.announcement) {
      document.getElementById('sys-anno').innerText = u.announcement;
  }
  document.getElementById('p-group').innerText = u.group_name;
  document.getElementById('p-email').innerText = u.email;
  document.getElementById('p-phone').innerText = u.phone;
  document.getElementById('p-receiver').innerText = u.name;
  document.getElementById('p-store').innerText = u.store;
}

async function doRegister() {
  const vals = ['email','name','receiver','phone','store'].reduce((a,k)=>{a[k]=document.getElementById('reg-'+k).value;return a},{});
  showLoading();
  try { await callApi('register', {...vals, uid:currentUid}); location.reload(); }
  catch(e) { hideLoading(); alert(e.message); }
}

// ================= 頁面切換 =================
function switchTab(tab, btn) {
  // UI 更新：先移除所有按鈕的 active，再將點擊的按鈕加上 active
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  
  // 內容更新：先隱藏所有區塊，再顯示目標區塊
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');

  // Lazy Load
  if (tab === 'markets' && !loadedData.markets) loadMarkets(currentUid);
  if (tab === 'orders' && !loadedData.orders) loadOrders(currentUid);
}

// ================= 資料載入：賣場 =================
async function loadMarkets(uid) {
  const div = document.getElementById('market-list');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';
  try {
    const mkts = await callApi('getMarkets', {uid});
    loadedData.markets = true; 
    div.innerHTML = mkts.length ? mkts.map(m => `
      <a href="${m.link}" target="_blank" class="btn-market fade-in">
        <div>
          <h6 class="mb-0 fw-bold" style="color:var(--primary-dark)">${m.sheetName}</h6>
          <small class="text-muted">${m.desc||'點擊前往'}</small>
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </a>`).join('') : '<div class="text-center text-muted p-4">目前無專屬賣場</div>';
  } catch(e) { div.innerHTML = '載入失敗'; }
}

// ================= 資料載入：訂單 =================
async function loadOrders(uid) {
  const div = document.getElementById('orders-container');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="small mt-2 text-muted">同步訂單中...</div></div>';
  
  try {
    const groups = await callApi('getOrders', {uid});
    loadedData.orders = true;

    if (!groups || groups.length === 0) {
      div.innerHTML = `<div class="text-center py-5 fade-in"><i class="bi bi-basket display-1 text-muted opacity-25"></i><p class="mt-3 text-muted">尚無訂購紀錄</p></div>`;
      return;
    }

    div.innerHTML = groups.map(g => {
      // 1. 明細
      let details = (g.details && g.details.length) ? g.details.map(d => `
        <div class="item-row">
          <div>
            <div class="item-name">${d.item}</div>
            ${d.note ? `<div class="item-note"><i class="bi bi-info-circle-fill me-1"></i>${d.note}</div>` : ''}
          </div>
          <div class="item-qty">x${d.qty}</div>
        </div>`).join('') : '<div class="text-center small text-muted py-2">無明細</div>';

      // 2. 對帳
      let summary = (g.summary && g.summary.length) ? g.summary.map(s => {
        let cls = 'status-wait';
        let badgeCls = 'st-wait';
        let st = s.status || '未標示';
        if(st.includes('✅') || st.includes('完成') || st.includes('OK')) { cls = 'status-ok'; badgeCls = 'st-ok'; }
        else if(st.includes('❌') || st.includes('有誤')) { cls = 'status-err'; badgeCls = 'st-err'; }
        
        return `
          <div class="card-box order-card ${cls} mt-2 fade-in">
            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
               <span class="status-badge ${badgeCls}">${st}</span>
               <div class="text-end">
                 <span class="d-block small text-muted">應付總額</span>
                 <span class="val-highlight">$${s.total}</span>
               </div>
            </div>
            <div class="summary-grid">
              <div class="info-block"><span class="info-label">總件數</span><span class="info-val">${s.count || '-'}</span></div>
              <div class="info-block"><span class="info-label">原價總額</span><span class="info-val">$${s.orig || '-'}</span></div>
              <div class="info-block" style="grid-column: span 2;"><span class="info-label">實收金額</span><span class="info-val val-blue">$${s.actual || '-'}</span></div>
              <div class="info-block"><span class="info-label">後五碼</span><span class="info-val">${s.last5 || '未填'}</span></div>
              <div class="info-block"><span class="info-label">收款時間</span><span class="info-val" style="font-size:0.8rem">${s.time || '-'}</span></div>
            </div>
          </div>
        `;
      }).join('') : '<div class="text-center small text-muted">待核算</div>';

      return `
        <div class="mb-4">
          <div class="group-name"><i class="bi bi-folder2-open text-primary"></i> ${g.groupName}</div>
          <div class="card-box p-0 overflow-hidden"><div class="item-list m-0 rounded-0">${details}</div></div>
          ${summary}
        </div>`;
    }).join('');
  } catch(e) { div.innerHTML = '載入失敗，請刷新重試'; }
}

// Helper
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function showView(id) {
  document.getElementById('register-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}
