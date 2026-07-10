(() => {
  const BASE_URL = "https://dtrvserbryhenyrpxuzh.supabase.co";
  const API_KEY = "sb_publishable_VXlTbehfkszw1yGaFsde4Q_1v2wv_yu";
  const EMAIL = "276485848@qq.com";
  const SESSION_KEY = "hf_cloud_session_v1";
  const PASSWORD_PREFIX = "hefei-property-tools:v1:";

  let session = null;
  let options = null;
  let overlay = null;
  let panel = null;
  let status = null;
  let saveTimer = null;

  function addUi() {
    const style = document.createElement("style");
    style.textContent = `
      .cloud-lock { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 18px; background: #f4f6f8; }
      .cloud-lock[hidden] { display: none; }
      .cloud-panel { width: min(390px, 100%); background: #fff; border: 1px solid #cfd7e3; border-radius: 8px; padding: 22px; box-shadow: 0 12px 30px rgba(16, 24, 40, .12); }
      .cloud-panel h2 { margin: 0 0 8px; font-size: 21px; }
      .cloud-panel p { margin: 0 0 16px; color: #667085; line-height: 1.7; }
      .cloud-panel form, .cloud-actions { display: grid; gap: 10px; }
      .cloud-panel input { height: 44px; width: 100%; border: 1px solid #cfd7e3; border-radius: 6px; padding: 0 12px; font-size: 16px; }
      .cloud-panel button { min-height: 42px; border: 0; border-radius: 6px; padding: 0 14px; font-weight: 800; background: #13715f; color: #fff; }
      .cloud-panel button.secondary { background: #edf3f8; color: #172033; }
      .cloud-error { min-height: 20px; margin-top: 10px; color: #b42318; font-size: 13px; }
      .cloud-status { display: inline-block; margin-left: 8px; padding: 3px 7px; border-radius: 5px; background: #e8f2ef; color: #13715f; font-size: 11px; font-weight: 800; vertical-align: middle; }
      .cloud-status.saving { background: #fff5df; color: #b54708; }
      .cloud-status.error { background: #fff0ed; color: #b42318; }
    `;
    document.head.appendChild(style);

    overlay = document.createElement("section");
    overlay.className = "cloud-lock";
    overlay.innerHTML = '<div class="cloud-panel" id="cloudPanel"></div>';
    document.body.appendChild(overlay);
    panel = overlay.querySelector("#cloudPanel");

    status = document.createElement("span");
    status.className = "cloud-status";
    status.textContent = "连接云端";
    document.querySelector("h1")?.appendChild(status);
  }

  function setStatus(text, kind = "") {
    if (!status) return;
    status.textContent = text;
    status.className = `cloud-status ${kind}`.trim();
  }

  function saveSession(value) {
    session = value;
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function api(path, init = {}) {
    const response = await fetch(BASE_URL + path, {
      ...init,
      headers: { apikey: API_KEY, ...(init.headers || {}) }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || "云端连接失败");
    return data;
  }

  async function passwordFor(passcode) {
    const bytes = new TextEncoder().encode(PASSWORD_PREFIX + passcode);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function signIn(passcode) {
    const data = await api("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: await passwordFor(passcode) })
    });
    data.expires_at = data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in;
    saveSession(data);
    return data;
  }

  async function validSession() {
    const saved = session || readSession();
    if (!saved) return null;
    if (saved.expires_at > Math.floor(Date.now() / 1000) + 60) {
      session = saved;
      return saved;
    }
    if (!saved.refresh_token) return null;
    try {
      const data = await api("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: saved.refresh_token })
      });
      data.expires_at = data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in;
      saveSession(data);
      return data;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async function cloudHeaders() {
    const current = await validSession();
    if (!current) throw new Error("请重新输入密码");
    return {
      Authorization: `Bearer ${current.access_token}`,
      "Content-Type": "application/json"
    };
  }

  async function loadRow(dataset) {
    const rows = await api(`/rest/v1/app_data?dataset=eq.${encodeURIComponent(dataset)}&select=payload,updated_at`, {
      headers: await cloudHeaders()
    });
    return rows?.[0] || null;
  }

  async function putRow(dataset, payload) {
    const current = await validSession();
    if (!current) throw new Error("请重新输入密码");
    await api("/rest/v1/app_data?on_conflict=owner_id,dataset", {
      method: "POST",
      headers: {
        ...(await cloudHeaders()),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        owner_id: current.user.id,
        dataset,
        payload,
        updated_at: new Date().toISOString()
      })
    });
  }

  function unlock() {
    overlay.hidden = true;
    setStatus("云端已同步");
  }

  function showLogin(message = "") {
    overlay.hidden = false;
    panel.innerHTML = `
      <h2>${options.title}</h2>
      <p>输入固定密码后，公司、家里和手机看到的是同一份数据。</p>
      <form id="cloudLoginForm">
        <input id="cloudPassword" type="password" inputmode="numeric" autocomplete="current-password" placeholder="请输入密码" required>
        <button type="submit">登录</button>
      </form>
      <div class="cloud-error" id="cloudError">${message}</div>
    `;
    panel.querySelector("#cloudLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button");
      button.disabled = true;
      button.textContent = "正在登录";
      try {
        await signIn(panel.querySelector("#cloudPassword").value);
        await connect();
      } catch {
        showLogin("密码不正确或网络暂时不可用");
      }
    });
  }

  function showMigration(localData) {
    overlay.hidden = false;
    const count = Array.isArray(localData) ? localData.length : 0;
    if (count) {
      panel.innerHTML = `
        <h2>发现本机旧数据</h2>
        <p>检测到 ${count} 条记录。上传后，其他电脑和手机就能同步查看。</p>
        <div class="cloud-actions">
          <button id="cloudUpload">上传本机数据</button>
          <button class="secondary" id="cloudRetry">重新检查云端</button>
        </div>
        <div class="cloud-error" id="cloudError"></div>
      `;
      panel.querySelector("#cloudUpload").addEventListener("click", async () => {
        try {
          setStatus("正在迁移", "saving");
          await putRow(options.dataset, localData);
          options.setData(localData);
          unlock();
        } catch (error) {
          panel.querySelector("#cloudError").textContent = error.message;
          setStatus("迁移失败", "error");
        }
      });
    } else {
      panel.innerHTML = `
        <h2>等待旧数据迁移</h2>
        <p>请在保存过旧记录的公司电脑打开这个链接并输入密码，再点击“上传本机数据”。完成后，这台电脑即可同步查看。</p>
        <div class="cloud-actions">
          <button id="cloudRetry">重新检查云端</button>
          <button class="secondary" id="cloudEmpty">确认没有旧数据，建立空表</button>
        </div>
        <div class="cloud-error" id="cloudError"></div>
      `;
      panel.querySelector("#cloudEmpty").addEventListener("click", async () => {
        if (!confirm("确定没有需要保留的旧数据吗？")) return;
        try {
          await putRow(options.dataset, []);
          options.setData([]);
          unlock();
        } catch (error) {
          panel.querySelector("#cloudError").textContent = error.message;
        }
      });
    }
    panel.querySelector("#cloudRetry").addEventListener("click", connect);
  }

  async function connect() {
    setStatus("正在同步", "saving");
    const openWhileSyncing = options.seedWhenEmpty;
    if (openWhileSyncing) overlay.hidden = true;
    try {
      const row = await loadRow(options.dataset);
      if (row) {
        options.setData(Array.isArray(row.payload) ? row.payload : []);
        unlock();
        return;
      }
      const localData = options.getData();
      if (options.seedWhenEmpty) {
        await putRow(options.dataset, localData);
        options.setData(localData);
        unlock();
        return;
      }
      setStatus("等待迁移", "saving");
      showMigration(localData);
    } catch (error) {
      setStatus("同步失败", "error");
      if (openWhileSyncing) return;
      showLogin(error.message);
    }
  }

  async function init(config) {
    options = config;
    addUi();
    if (await validSession()) await connect();
    else showLogin();
  }

  function save(payload) {
    if (!session || !options) return;
    clearTimeout(saveTimer);
    setStatus("正在保存", "saving");
    saveTimer = setTimeout(async () => {
      try {
        await putRow(options.dataset, payload);
        setStatus("云端已同步");
      } catch {
        setStatus("保存失败", "error");
      }
    }, 250);
  }

  window.CloudStore = { init, save };
})();
