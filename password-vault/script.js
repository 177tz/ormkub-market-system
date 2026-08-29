"use strict";

/* =========================================================
 * 私密保險箱 — 純本機、端對端加密的個人帳密/資料管理器
 * 所有明文只存在於記憶體中；落地儲存 (IndexedDB) 一律是
 * AES-256-GCM 密文。沒有任何伺服器端／網路傳輸。
 * ========================================================= */

const DB_NAME = "PasswordVaultDB";
const DB_STORE = "kv";
const PBKDF2_ITERATIONS = 210000;
const VERIFIER_PLAINTEXT = "vault-check-ok";
const CLIPBOARD_CLEAR_MS = 20000;

let db = null;
let cryptoKey = null; // CryptoKey, only ever held in memory
let entries = [];      // decrypted in-memory array of vault entries
let activeTypeFilter = "all";
let autoLockTimer = null;
let autoLockMinutes = Number(localStorage.getItem("pv_autolock_minutes") || "5");
let clipboardClearTimer = null;

/* ---------------- IndexedDB helpers ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Crypto helpers ---------------- */

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(len) {
  return crypto.getRandomValues(new Uint8Array(len));
}

async function deriveKey(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptString(key, plaintext) {
  const iv = randomBytes(12);
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { iv: bufToB64(iv), data: bufToB64(cipher) };
}

async function decryptString(key, payload) {
  const iv = new Uint8Array(b64ToBuf(payload.iv));
  const cipherBuf = b64ToBuf(payload.data);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBuf);
  return new TextDecoder().decode(plainBuf);
}

/* ---------------- App bootstrap ---------------- */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  db = await openDB();
  const meta = await idbGet("meta");
  wireStaticEvents();
  if (!meta) {
    showScreen("setup-view");
  } else {
    showScreen("unlock-view");
  }
}

function showScreen(id) {
  ["setup-view", "unlock-view", "main-view"].forEach((s) => {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  });
}

function showLoading(v) {
  document.getElementById("loading-overlay").classList.toggle("hidden", !v);
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  el.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.classList.add("hidden"), 300);
  }, 1800);
}

/* ---------------- Setup / Unlock / Lock ---------------- */

async function handleSetup(e) {
  e.preventDefault();
  const pw1 = document.getElementById("setup-pw1").value;
  const pw2 = document.getElementById("setup-pw2").value;
  const errEl = document.getElementById("setup-error");
  errEl.classList.add("hidden");

  if (pw1 !== pw2) {
    errEl.textContent = "兩次輸入的主密碼不一致";
    errEl.classList.remove("hidden");
    return;
  }
  if (pw1.length < 8) {
    errEl.textContent = "主密碼至少需要 8 個字元";
    errEl.classList.remove("hidden");
    return;
  }

  showLoading(true);
  try {
    const salt = randomBytes(16);
    const key = await deriveKey(pw1, salt, PBKDF2_ITERATIONS);
    const verifier = await encryptString(key, VERIFIER_PLAINTEXT);

    await idbSet("meta", {
      salt: bufToB64(salt),
      iterations: PBKDF2_ITERATIONS,
      verifier,
    });

    cryptoKey = key;
    entries = [];
    await persistVault();

    document.getElementById("setup-form").reset();
    enterMainView();
    toast("保險箱已建立");
  } catch (err) {
    console.error(err);
    errEl.textContent = "建立失敗，請再試一次";
    errEl.classList.remove("hidden");
  } finally {
    showLoading(false);
  }
}

async function handleUnlock(e) {
  e.preventDefault();
  const pw = document.getElementById("unlock-pw").value;
  const errEl = document.getElementById("unlock-error");
  errEl.classList.add("hidden");

  showLoading(true);
  try {
    const meta = await idbGet("meta");
    const salt = new Uint8Array(b64ToBuf(meta.salt));
    const key = await deriveKey(pw, salt, meta.iterations || PBKDF2_ITERATIONS);

    let ok = false;
    try {
      const plain = await decryptString(key, meta.verifier);
      ok = plain === VERIFIER_PLAINTEXT;
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      errEl.textContent = "主密碼錯誤";
      errEl.classList.remove("hidden");
      return;
    }

    cryptoKey = key;
    const vaultRec = await idbGet("vault");
    if (vaultRec) {
      const plain = await decryptString(key, vaultRec);
      entries = JSON.parse(plain);
    } else {
      entries = [];
    }

    document.getElementById("unlock-form").reset();
    enterMainView();
  } catch (err) {
    console.error(err);
    errEl.textContent = "解鎖失敗，請再試一次";
    errEl.classList.remove("hidden");
  } finally {
    showLoading(false);
  }
}

function enterMainView() {
  showScreen("main-view");
  renderList();
  resetAutoLockTimer();
}

function lockVault() {
  cryptoKey = null;
  entries = [];
  clearTimeout(autoLockTimer);
  document.getElementById("unlock-error").classList.add("hidden");
  showScreen("unlock-view");
}

async function persistVault() {
  const plain = JSON.stringify(entries);
  const enc = await encryptString(cryptoKey, plain);
  await idbSet("vault", enc);
}

/* ---------------- Auto-lock on idle ---------------- */

function resetAutoLockTimer() {
  clearTimeout(autoLockTimer);
  if (!autoLockMinutes) return; // 0 = never
  autoLockTimer = setTimeout(() => {
    if (cryptoKey) {
      lockVault();
      toast("已自動鎖定");
    }
  }, autoLockMinutes * 60 * 1000);
}

["click", "keydown", "touchstart"].forEach((evt) => {
  document.addEventListener(evt, () => {
    if (cryptoKey) resetAutoLockTimer();
  });
});

/* ---------------- Entry list rendering ---------------- */

const TYPE_META = {
  login: { label: "帳號密碼", icon: "🔑" },
  card: { label: "信用卡", icon: "💳" },
  note: { label: "安全記事", icon: "📝" },
};

function renderList() {
  const listEl = document.getElementById("entry-list");
  const emptyEl = document.getElementById("empty-state");
  const q = document.getElementById("search-input").value.trim().toLowerCase();

  const filtered = entries.filter((e) => {
    if (activeTypeFilter !== "all" && e.type !== activeTypeFilter) return false;
    if (!q) return true;
    const hay = [e.title, e.username, e.url, e.notes].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  filtered.sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hant"));

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", filtered.length !== 0);

  for (const entry of filtered) {
    const meta = TYPE_META[entry.type] || TYPE_META.note;
    const card = document.createElement("div");
    card.className = "entry-card";
    card.innerHTML = `
      <div class="entry-icon">${meta.icon}</div>
      <div class="entry-main">
        <div class="entry-title"></div>
        <div class="entry-sub"></div>
      </div>
    `;
    card.querySelector(".entry-title").textContent = entry.title || "(未命名)";
    let sub = meta.label;
    if (entry.type === "login" && entry.username) sub += " · " + entry.username;
    if (entry.type === "card" && entry.number) sub += " · **** " + entry.number.slice(-4);
    card.querySelector(".entry-sub").textContent = sub;
    card.addEventListener("click", () => openViewModal(entry.id));
    listEl.appendChild(card);
  }
}

/* ---------------- View modal ---------------- */

function openViewModal(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  document.getElementById("view-modal-title").textContent = entry.title || "(未命名)";
  const body = document.getElementById("view-modal-body");
  body.innerHTML = "";

  function addRow(label, value, opts) {
    opts = opts || {};
    if (!value) return;
    const row = document.createElement("div");
    row.className = "view-row";
    const labelEl = document.createElement("div");
    labelEl.className = "view-row-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "view-row-value" + (opts.mono ? " mono" : "");

    let displayValue = value;
    if (opts.secret) {
      let revealed = false;
      valueEl.textContent = "••••••••";
      valueEl.style.cursor = "pointer";
      valueEl.addEventListener("click", () => {
        revealed = !revealed;
        valueEl.textContent = revealed ? displayValue : "••••••••";
      });
    } else {
      valueEl.textContent = displayValue;
    }

    row.appendChild(labelEl);
    row.appendChild(valueEl);

    if (opts.copyable) {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "📋";
      btn.title = "複製";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        copyToClipboard(value);
      });
      row.appendChild(btn);
    }
    body.appendChild(row);
  }

  if (entry.type === "login") {
    addRow("帳號", entry.username, { copyable: true });
    addRow("密碼", entry.password, { secret: true, copyable: true, mono: true });
    addRow("網址", entry.url, { copyable: true });
  } else if (entry.type === "card") {
    addRow("持卡人", entry.holder, { copyable: true });
    addRow("卡號", entry.number, { secret: true, copyable: true, mono: true });
    addRow("有效期限", entry.expiry);
    addRow("安全碼", entry.cvv, { secret: true, copyable: true, mono: true });
  } else if (entry.type === "note") {
    addRow("內容", entry.content);
  }
  addRow("備註", entry.notes);

  document.getElementById("view-edit-btn").onclick = () => {
    closeAllModals();
    openEntryModal(entry.id);
  };

  document.getElementById("view-modal").classList.remove("hidden");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已複製，" + (CLIPBOARD_CLEAR_MS / 1000) + " 秒後自動清除");
  } catch (_) {
    toast("複製失敗，請手動選取");
    return;
  }
  clearTimeout(clipboardClearTimer);
  clipboardClearTimer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === text) await navigator.clipboard.writeText("");
    } catch (_) {
      /* clipboard read may be blocked; best-effort only */
    }
  }, CLIPBOARD_CLEAR_MS);
}

/* ---------------- Entry add/edit modal ---------------- */

function switchTypeFields(type) {
  document.getElementById("fields-login").classList.toggle("hidden", type !== "login");
  document.getElementById("fields-card").classList.toggle("hidden", type !== "card");
  document.getElementById("fields-note").classList.toggle("hidden", type !== "note");
}

function openEntryModal(id) {
  const form = document.getElementById("entry-form");
  form.reset();
  const isEdit = !!id;
  document.getElementById("entry-modal-title").textContent = isEdit ? "編輯資料" : "新增資料";
  document.getElementById("delete-entry-btn").classList.toggle("hidden", !isEdit);
  document.getElementById("entry-id").value = id || "";

  let entry = null;
  if (isEdit) entry = entries.find((e) => e.id === id);

  const type = entry ? entry.type : (activeTypeFilter !== "all" ? activeTypeFilter : "login");
  document.getElementById("entry-type").value = type;
  switchTypeFields(type);

  document.getElementById("entry-title").value = entry ? entry.title || "" : "";
  document.getElementById("f-username").value = entry ? entry.username || "" : "";
  document.getElementById("f-password").value = entry ? entry.password || "" : "";
  document.getElementById("f-url").value = entry ? entry.url || "" : "";
  document.getElementById("f-holder").value = entry ? entry.holder || "" : "";
  document.getElementById("f-number").value = entry ? entry.number || "" : "";
  document.getElementById("f-expiry").value = entry ? entry.expiry || "" : "";
  document.getElementById("f-cvv").value = entry ? entry.cvv || "" : "";
  document.getElementById("f-content").value = entry ? entry.content || "" : "";
  document.getElementById("f-notes").value = entry ? entry.notes || "" : "";

  document.getElementById("entry-modal").classList.remove("hidden");
}

async function handleEntrySubmit(e) {
  e.preventDefault();
  const id = document.getElementById("entry-id").value;
  const type = document.getElementById("entry-type").value;

  const data = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    type,
    title: document.getElementById("entry-title").value.trim(),
    notes: document.getElementById("f-notes").value.trim(),
    updatedAt: Date.now(),
  };

  if (type === "login") {
    data.username = document.getElementById("f-username").value.trim();
    data.password = document.getElementById("f-password").value;
    data.url = document.getElementById("f-url").value.trim();
  } else if (type === "card") {
    data.holder = document.getElementById("f-holder").value.trim();
    data.number = document.getElementById("f-number").value.trim();
    data.expiry = document.getElementById("f-expiry").value.trim();
    data.cvv = document.getElementById("f-cvv").value.trim();
  } else if (type === "note") {
    data.content = document.getElementById("f-content").value;
  }

  const existingIdx = entries.findIndex((e) => e.id === data.id);
  if (existingIdx >= 0) {
    data.createdAt = entries[existingIdx].createdAt || Date.now();
    entries[existingIdx] = data;
  } else {
    data.createdAt = Date.now();
    entries.push(data);
  }

  showLoading(true);
  try {
    await persistVault();
    closeAllModals();
    renderList();
    toast("已儲存");
  } finally {
    showLoading(false);
  }
}

async function handleDeleteEntry() {
  const id = document.getElementById("entry-id").value;
  if (!id) return;
  if (!confirm("確定要刪除這筆資料嗎？此動作無法復原。")) return;
  entries = entries.filter((e) => e.id !== id);
  showLoading(true);
  try {
    await persistVault();
    closeAllModals();
    renderList();
    toast("已刪除");
  } finally {
    showLoading(false);
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden"));
}

/* ---------------- Password generator ---------------- */

function generatePassword(opts) {
  const sets = [];
  if (opts.upper) sets.push("ABCDEFGHJKLMNPQRSTUVWXYZ");
  if (opts.lower) sets.push("abcdefghijkmnpqrstuvwxyz");
  if (opts.digits) sets.push("23456789");
  if (opts.symbols) sets.push("!@#$%^&*()-_=+[]{}");
  if (sets.length === 0) sets.push("abcdefghijkmnpqrstuvwxyz");

  const all = sets.join("");
  const len = opts.length;
  const bytes = randomBytes(len);
  let result = "";

  // guarantee at least one char from each selected set
  const guaranteed = sets.map((set) => set[randomBytes(1)[0] % set.length]);
  for (let i = 0; i < len; i++) {
    if (i < guaranteed.length) {
      result += guaranteed[i];
    } else {
      result += all[bytes[i] % all.length];
    }
  }
  // shuffle
  const arr = result.split("");
  const rnd = randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

function refreshPwgenOutput() {
  const opts = {
    length: Number(document.getElementById("pwgen-len").value),
    upper: document.getElementById("pwgen-upper").checked,
    lower: document.getElementById("pwgen-lower").checked,
    digits: document.getElementById("pwgen-digits").checked,
    symbols: document.getElementById("pwgen-symbols").checked,
  };
  document.getElementById("pwgen-output").textContent = generatePassword(opts);
}

/* ---------------- Export / Import ---------------- */

async function handleExport() {
  const meta = await idbGet("meta");
  const vault = await idbGet("vault");
  const payload = {
    app: "password-vault-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    meta,
    vault,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "password-vault-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("已匯出加密備份");
}

async function handleImportConfirm() {
  const fileInput = document.getElementById("import-file");
  const errEl = document.getElementById("import-error");
  errEl.classList.add("hidden");
  const file = fileInput.files[0];
  if (!file) {
    errEl.textContent = "請先選擇備份檔";
    errEl.classList.remove("hidden");
    return;
  }
  if (!confirm("還原備份將會覆蓋目前保險箱的所有資料，確定要繼續嗎？")) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !payload.meta || !payload.meta.salt || !payload.meta.verifier) {
      throw new Error("invalid backup file");
    }
    await idbSet("meta", payload.meta);
    if (payload.vault) {
      await idbSet("vault", payload.vault);
    } else {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete("vault");
    }
    cryptoKey = null;
    entries = [];
    closeAllModals();
    lockVault();
    toast("還原完成，請用備份當時的主密碼解鎖");
  } catch (err) {
    console.error(err);
    errEl.textContent = "備份檔格式錯誤或已損毀";
    errEl.classList.remove("hidden");
  }
}

/* ---------------- Change master password ---------------- */

async function handleChangePassword(e) {
  e.preventDefault();
  const current = document.getElementById("cp-current").value;
  const new1 = document.getElementById("cp-new1").value;
  const new2 = document.getElementById("cp-new2").value;
  const errEl = document.getElementById("changepw-error");
  errEl.classList.add("hidden");

  if (new1 !== new2) {
    errEl.textContent = "兩次輸入的新主密碼不一致";
    errEl.classList.remove("hidden");
    return;
  }
  if (new1.length < 8) {
    errEl.textContent = "新主密碼至少需要 8 個字元";
    errEl.classList.remove("hidden");
    return;
  }

  showLoading(true);
  try {
    const meta = await idbGet("meta");
    const salt = new Uint8Array(b64ToBuf(meta.salt));
    const currentKey = await deriveKey(current, salt, meta.iterations || PBKDF2_ITERATIONS);

    let ok = false;
    try {
      const plain = await decryptString(currentKey, meta.verifier);
      ok = plain === VERIFIER_PLAINTEXT;
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      errEl.textContent = "目前主密碼不正確";
      errEl.classList.remove("hidden");
      return;
    }

    const newSalt = randomBytes(16);
    const newKey = await deriveKey(new1, newSalt, PBKDF2_ITERATIONS);
    const newVerifier = await encryptString(newKey, VERIFIER_PLAINTEXT);

    await idbSet("meta", {
      salt: bufToB64(newSalt),
      iterations: PBKDF2_ITERATIONS,
      verifier: newVerifier,
    });

    cryptoKey = newKey;
    await persistVault();

    document.getElementById("changepw-form").reset();
    closeAllModals();
    toast("主密碼已更新");
  } catch (err) {
    console.error(err);
    errEl.textContent = "變更失敗，請再試一次";
    errEl.classList.remove("hidden");
  } finally {
    showLoading(false);
  }
}

/* ---------------- Wipe all data ---------------- */

async function handleWipe() {
  if (!confirm("這會永久刪除保險箱裡的所有資料與主密碼設定，無法復原。確定要繼續嗎？")) return;
  if (!confirm("請再次確認：真的要清除所有資料嗎？")) return;
  await idbClear();
  cryptoKey = null;
  entries = [];
  closeAllModals();
  showScreen("setup-view");
  toast("已清除所有資料");
}

/* ---------------- Wire up events ---------------- */

function wireStaticEvents() {
  document.getElementById("setup-form").addEventListener("submit", handleSetup);
  document.getElementById("unlock-form").addEventListener("submit", handleUnlock);
  document.getElementById("lock-btn").addEventListener("click", lockVault);

  document.getElementById("search-input").addEventListener("input", renderList);

  document.querySelectorAll(".type-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTypeFilter = btn.dataset.type;
      renderList();
    });
  });

  document.getElementById("fab-add").addEventListener("click", () => openEntryModal(null));
  document.getElementById("entry-form").addEventListener("submit", handleEntrySubmit);
  document.getElementById("entry-type").addEventListener("change", (e) => switchTypeFields(e.target.value));
  document.getElementById("delete-entry-btn").addEventListener("click", handleDeleteEntry);

  document.getElementById("gen-pw-btn").addEventListener("click", () => {
    document.getElementById("pwgen-modal").classList.remove("hidden");
    refreshPwgenOutput();
  });
  document.getElementById("pwgen-len").addEventListener("input", (e) => {
    document.getElementById("pwgen-len-val").textContent = e.target.value;
    refreshPwgenOutput();
  });
  ["pwgen-upper", "pwgen-lower", "pwgen-digits", "pwgen-symbols"].forEach((id) => {
    document.getElementById(id).addEventListener("change", refreshPwgenOutput);
  });
  document.getElementById("pwgen-refresh").addEventListener("click", refreshPwgenOutput);
  document.getElementById("pwgen-use").addEventListener("click", () => {
    document.getElementById("f-password").value = document.getElementById("pwgen-output").textContent;
    document.getElementById("pwgen-modal").classList.add("hidden");
  });

  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("autolock-select").value = String(autoLockMinutes);
    document.getElementById("settings-modal").classList.remove("hidden");
  });
  document.getElementById("autolock-select").addEventListener("change", (e) => {
    autoLockMinutes = Number(e.target.value);
    localStorage.setItem("pv_autolock_minutes", String(autoLockMinutes));
    resetAutoLockTimer();
  });

  document.getElementById("export-btn").addEventListener("click", handleExport);
  document.getElementById("change-pw-btn").addEventListener("click", () => {
    document.getElementById("changepw-modal").classList.remove("hidden");
  });
  document.getElementById("changepw-form").addEventListener("submit", handleChangePassword);
  document.getElementById("wipe-btn").addEventListener("click", handleWipe);

  const openImport = () => {
    closeAllModals();
    document.getElementById("import-error").classList.add("hidden");
    document.getElementById("import-file").value = "";
    document.getElementById("import-modal").classList.remove("hidden");
  };
  document.getElementById("show-import-btn").addEventListener("click", openImport);
  document.getElementById("show-import-btn-2").addEventListener("click", openImport);
  document.getElementById("import-confirm-btn").addEventListener("click", handleImportConfirm);

  document.querySelectorAll(".close-modal").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".modal-overlay").classList.add("hidden"));
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });
}
